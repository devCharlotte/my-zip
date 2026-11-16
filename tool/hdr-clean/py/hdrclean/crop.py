from __future__ import annotations

import io
import os
import shutil
import subprocess
from dataclasses import dataclass
from fractions import Fraction

from . import exif as exif_mod
from . import geometry as geo
from . import jpeg, jpeg_build, jumbf, pixels, xmp
from . import png as png_mod
from .errors import FormatError, UnsafeOperationError, UnsupportedError, ValidationError
from .geometry import Rect
from .jpeg_doc import JpegDoc


@dataclass
class CropOptions:
    rect: Rect
    output_size: tuple[int, int] | None = None
    allow_resample: bool = False
    lossless: str = "auto"
    allow_gainmap_resample: bool = False

    @classmethod
    def from_dict(cls, d: dict) -> CropOptions:
        out = d.get("output_size")
        return cls(Rect(*[int(v) for v in d["rect"]]),
                   tuple(int(v) for v in out) if out else None,
                   bool(d.get("allow_resample", False)), str(d.get("lossless", "auto")),
                   bool(d.get("allow_gainmap_resample", False)))


def jpegtran_path() -> str | None:
    env = os.environ.get("HDR_PROVENANCE_JPEGTRAN")
    if env:
        return env if os.access(env, os.X_OK) else None
    return shutil.which("jpegtran")


def jpegtran_crop(code: bytes, rect: Rect, progressive: bool) -> bytes:
    tool = jpegtran_path()
    if tool is None:
        raise UnsupportedError("jpegtran (libjpeg-turbo) is not installed; lossless crop unavailable")
    args = [tool, "-copy", "none", "-optimize"] + (["-progressive"] if progressive else [])
    args += ["-crop", f"{rect.w}x{rect.h}+{rect.x}+{rect.y}"]
    proc = subprocess.run(args, input=code, capture_output=True, timeout=300, check=False)
    if proc.returncode != 0 or not proc.stdout.startswith(b"\xff\xd8"):
        raise FormatError(f"jpegtran failed: {proc.stderr.decode('utf-8', 'replace')[:300]}")
    return proc.stdout


def _frame_parts(code: bytes) -> tuple[list[bytes], bytes]:
    segs, sos = jpeg.parse_header(code)
    keep = [code[s.start:s.end] for s in segs[1:]
            if not (0xE0 <= s.marker <= 0xEF or s.marker == 0xFE)]
    end = jpeg.find_eoi(code, sos)
    return keep, code[sos:end]


def grid_info(doc: JpegDoc) -> dict:
    f = doc.layout.primary.frame
    assert f is not None
    info: dict = {"lossless_primary": list(f.imcu), "jpegtran": jpegtran_path() is not None}
    gm = doc.gain_map_index()
    if gm is not None:
        g = doc.layout.images[gm].frame
        assert g is not None
        ex = [geo.exact_step(f.width, g.width), geo.exact_step(f.height, g.height)]
        gl = [geo.lossless_gain_step(f.width, g.width, g.imcu[0]),
              geo.lossless_gain_step(f.height, g.height, g.imcu[1])]
        info["gainmap_exact"] = ex
        info["lossless_all"] = [geo.lcm(f.imcu[0], gl[0]), geo.lcm(f.imcu[1], gl[1])]
    else:
        info["lossless_all"] = list(f.imcu)
    return info


class _JpegCropper:
    def __init__(self, raw: bytes, opts: CropOptions) -> None:
        self.raw = raw
        self.opts = opts
        self.doc = JpegDoc(raw)
        self.warnings: list[str] = []
        lay = self.doc.layout
        f = lay.primary.frame
        if f is None:
            raise FormatError("JPEG has no frame header")
        if f.precision != 8:
            raise UnsupportedError("Only 8-bit JPEG can be cropped")
        if lay.trailing:
            raise UnsupportedError(
                "File has data after the last image (e.g. Motion Photo video or vendor trailer); "
                "cropping would keep an uncropped copy or break its offsets. Refused.")
        self.f = f
        self.orientation = self._orientation()
        self.stored = geo.display_to_stored(opts.rect, f.width, f.height, self.orientation)
        self.out_size = (self.stored.w, self.stored.h)
        self.resample = False
        if opts.output_size:
            ow, oh = geo.stored_size_for_display(*opts.output_size, self.orientation)
            if ow <= 0 or oh <= 0:
                raise UnsafeOperationError("Output size must be positive")
            if (ow, oh) != self.out_size:
                if not opts.allow_resample:
                    raise UnsafeOperationError(
                        f"Output {opts.output_size[0]}x{opts.output_size[1]} differs from the crop size; "
                        "this needs resampling (not a pure crop). Enable allow_resample to proceed.")
                self.resample = True
                self.out_size = (ow, oh)
        self.gm = self.doc.gain_map_index()
        container = self.doc.image_signals(0).get("container") or []
        if container and any(c["semantic"] not in ("Primary", "GainMap") for c in container):
            raise UnsupportedError("XMP container lists items other than Primary/GainMap "
                                   "(e.g. Motion Photo); crop refused")
        if container and self.gm is None:
            raise UnsupportedError("XMP container announces a gain map that could not be located")
        self.dropped = [i for i in range(1, len(lay.images)) if i != self.gm]
        for i in self.dropped:
            self.warnings.append(f"Image #{i + 1} ({self.doc.image_role(i)}) shows the uncropped scene "
                                 "and was removed from the output")

    def _orientation(self) -> int:
        for seg in self.doc.layout.primary.app(self.raw, jpeg.APP1, jpeg.EXIF_ID):
            try:
                return exif_mod.parse(seg.payload(self.raw)[len(jpeg.EXIF_ID):]).orientation
            except FormatError:
                return 1
        return 1

    def _lossless_refusal(self, reason: str, step: list[int], image: tuple[int, int]) -> UnsafeOperationError:
        snapped = geo.snap(self.stored, (step[0], step[1]), *image)
        disp = geo.stored_to_display(snapped, self.f.width, self.f.height, self.orientation)
        return UnsafeOperationError(f"Lossless crop not possible: {reason}",
                                    detail={"suggested_rect": disp.as_list(), "grid_stored": step})

    def _codestream(self, idx: int) -> bytes:
        img = self.doc.layout.images[idx]
        return self.raw[img.start:img.end]

    def _check_reencodable(self, idx: int) -> None:
        img = self.doc.layout.images[idx]
        if img.app(self.raw, 0xEE, b"Adobe"):
            raise UnsupportedError("JPEG with an Adobe APP14 colour transform cannot be re-encoded safely; "
                                   "use a lossless (grid-aligned) crop")

    def _reencode(self, idx: int, box: tuple, size: tuple[int, int]) -> tuple[list[bytes], bytes]:
        from PIL import Image, JpegImagePlugin

        self._check_reencodable(idx)
        src = pixels.open_image(self._codestream(idx))
        if src.mode not in ("L", "RGB"):
            raise UnsupportedError(f"JPEG mode {src.mode} cannot be re-encoded safely")
        ints = all(float(v).is_integer() for v in box)
        if ints and (int(box[2] - box[0]), int(box[3] - box[1])) == size:
            region = src.crop(tuple(int(v) for v in box))
        else:
            region = src.resize(size, Image.Resampling.LANCZOS, box=tuple(float(v) for v in box))
        params: dict = {"qtables": src.quantization, "optimize": True,
                        "progressive": bool(self.doc.layout.images[idx].frame.progressive)}
        sampling = JpegImagePlugin.get_sampling(src)
        if sampling >= 0 and src.mode == "RGB":
            params["subsampling"] = sampling
        buf = io.BytesIO()
        region.save(buf, "JPEG", **params)
        return _frame_parts(buf.getvalue())

    def run(self) -> tuple[bytes, dict]:
        opts = self.opts
        tool = jpegtran_path()
        ix, iy = self.f.imcu
        want_lossless = opts.lossless != "never" and not self.resample
        report: dict = {"display_rect": opts.rect.as_list(), "stored_rect": self.stored.as_list(),
                        "orientation": self.orientation, "source_size": [self.f.width, self.f.height],
                        "output_size_stored": list(self.out_size), "resampled": self.resample}
        grid = grid_info(self.doc)
        report["grid"] = grid
        s = self.stored
        aligned = s.x % ix == 0 and s.y % iy == 0
        if want_lossless and tool and aligned:
            pframe = _frame_parts(jpegtran_crop(self._codestream(0), s, self.f.progressive))
            pmethod = "lossless_dct"
        else:
            if opts.lossless == "require":
                reason = ("jpegtran is not installed" if not tool else
                          "resampling requested" if self.resample else
                          f"top-left corner not on the {ix}x{iy} block grid")
                raise self._lossless_refusal(reason, grid["lossless_all"], (self.f.width, self.f.height))
            pframe = self._reencode(0, (s.x, s.y, s.x + s.w, s.y + s.h), self.out_size)
            pmethod = "resampled" if self.resample else "reencoded"
        report["primary"] = {"method": pmethod}
        gframe = None
        if self.gm is not None:
            gimg = self.doc.layout.images[self.gm]
            g = gimg.frame
            assert g is not None
            fx = Fraction(g.width, self.f.width)
            fy = Fraction(g.height, self.f.height)
            gx, gy, gw, gh = s.x * fx, s.y * fy, s.w * fx, s.h * fy
            exact = all(v.denominator == 1 for v in (gx, gy, gw, gh))
            gbox = (gx, gy, gx + gw, gy + gh)
            ginfo: dict = {"source_size": [g.width, g.height],
                           "region": [str(v) for v in (gx, gy, gw, gh)], "exact": exact}
            if self.resample:
                gsize = (max(1, round(self.out_size[0] * g.width / self.f.width)),
                         max(1, round(self.out_size[1] * g.height / self.f.height)))
                gframe = self._reencode(self.gm, gbox, gsize)
                ginfo["method"] = "resampled"
            elif not exact:
                if not opts.allow_gainmap_resample:
                    snapped = geo.snap(s, tuple(grid["gainmap_exact"]), self.f.width, self.f.height)
                    disp = geo.stored_to_display(snapped, self.f.width, self.f.height, self.orientation)
                    raise UnsafeOperationError(
                        "The crop does not fall on whole gain-map pixels, so the HDR gain map cannot be "
                        "cropped to exactly the same region. Use a rectangle on the gain-map grid or "
                        "allow gain-map resampling.",
                        detail={"suggested_rect": disp.as_list(), "grid_stored": grid["gainmap_exact"]})
                gsize = (max(1, round(float(gw))), max(1, round(float(gh))))
                gframe = self._reencode(self.gm, gbox, gsize)
                ginfo["method"] = "resampled_fractional"
            else:
                grect = Rect(int(gx), int(gy), int(gw), int(gh))
                gix, giy = g.imcu
                if want_lossless and tool and grect.x % gix == 0 and grect.y % giy == 0:
                    gframe = _frame_parts(jpegtran_crop(self._codestream(self.gm), grect, g.progressive))
                    ginfo["method"] = "lossless_dct"
                else:
                    if opts.lossless == "require":
                        raise self._lossless_refusal("gain-map corner not on its block grid",
                                                     grid["lossless_all"], (self.f.width, self.f.height))
                    gframe = self._reencode(self.gm, gbox, (grect.w, grect.h))
                    ginfo["method"] = "reencoded"
            report["gain_map"] = ginfo
        parts = [jpeg_build.ImagePart(self._meta(0, self.out_size, keep_mpf=self.gm is not None) + pframe[0],
                                      pframe[1], self._attr(0))]
        if self.gm is not None and gframe is not None:
            gimg = self.doc.layout.images[self.gm]
            parts.append(jpeg_build.ImagePart(self._meta(self.gm, None, keep_mpf=False) + gframe[0],
                                              gframe[1], self._attr(self.gm)))
        template = None
        lay = self.doc.layout
        if lay.mpf is not None and lay.mpf_segment is not None and len(lay.images) == len(parts):
            base = lay.mpf_segment.payload_start + len(jpeg.MPF_ID)
            template = (self.raw[base:lay.mpf_segment.end], lay.mpf)
        out = jpeg_build.assemble(parts, mpf_template=template)
        report["verification"] = self._verify(out, report)
        report["dropped_images"] = [i + 1 for i in self.dropped]
        report["warnings"] = self.warnings
        report["pixel_exact_crop"] = (pmethod == "lossless_dct"
                                      and report.get("gain_map", {}).get("method", "lossless_dct") == "lossless_dct")
        return out, report

    def _attr(self, idx: int) -> int:
        e = self.doc.layout.images[idx].mpf_entry
        if e is not None:
            return e.attribute
        return 0x20030000 if idx == 0 else 0

    def _meta(self, idx: int, size: tuple[int, int] | None, *, keep_mpf: bool) -> list[bytes]:
        raw = self.raw
        out = []
        for seg in self.doc.layout.images[idx].segments[1:]:
            if not (0xE0 <= seg.marker <= 0xEF or seg.marker == 0xFE):
                continue
            payload = seg.payload(raw)
            if seg.marker == jpeg.APP15 and not any(payload):
                continue
            if seg.marker == jpeg.APP2 and payload.startswith(jpeg.MPF_ID):
                if keep_mpf:
                    out.append(raw[seg.start:seg.end])
                continue
            if seg.marker == jpeg.APP1 and payload.startswith(jpeg.EXIF_ID):
                out.append(jpeg.make_segment(jpeg.APP1, jpeg.EXIF_ID + self._exif(payload[6:], size)))
                continue
            if seg.marker == jpeg.APP1 and payload.startswith(jpeg.XMP_ID) and size is not None:
                try:
                    text = payload[len(jpeg.XMP_ID):].decode("utf-8")
                except UnicodeDecodeError:
                    out.append(raw[seg.start:seg.end])
                    continue
                new = text
                for ns, local, v in ((xmp.NS_TIFF, "ImageWidth", size[0]), (xmp.NS_TIFF, "ImageLength", size[1]),
                                     (xmp.NS_EXIF, "PixelXDimension", size[0]),
                                     (xmp.NS_EXIF, "PixelYDimension", size[1])):
                    new = xmp.set_simple_value(new, ns, local, str(v))
                if new != text and xmp.is_parseable(new):
                    out.append(jpeg.make_segment(jpeg.APP1, jpeg.XMP_ID + new.encode("utf-8")))
                else:
                    out.append(raw[seg.start:seg.end])
                continue
            if seg.marker == jpeg.APP11 and payload.startswith(b"JP") and jumbf.C2PA_STORE_UUID in payload:
                self.warnings.append("C2PA manifest kept: its hash binding no longer matches the cropped "
                                     "pixels, so validators will report it as invalid")
            elif seg.marker == 0xED:
                self.warnings.append("APP13 (Photoshop IRB/IPTC) kept verbatim; it may embed an uncropped thumbnail")
            elif seg.marker == jpeg.APP2 and payload.startswith(b"FPXR"):
                self.warnings.append("APP2 FlashPix data kept verbatim; it may embed an uncropped preview")
            out.append(raw[seg.start:seg.end])
        return out

    def _exif(self, tiff_bytes: bytes, size: tuple[int, int] | None) -> bytes:
        try:
            tiff = exif_mod.parse(tiff_bytes)
        except FormatError:
            self.warnings.append("EXIF unreadable; copied unchanged (its thumbnail could not be removed)")
            return tiff_bytes
        buf = bytearray(tiff_bytes)
        if exif_mod.scrub_thumbnail(buf, tiff):
            self.warnings.append("EXIF thumbnail (uncropped preview) removed")
        if size is not None:
            for tag, v in ((0xA002, size[0]), (0xA003, size[1])):
                f = tiff.get(tag)
                if f is not None and f.type in (3, 4) and f.count == 1:
                    exif_mod.set_number(buf, tiff, f, v)
        return bytes(buf)

    def _verify(self, out: bytes, report: dict) -> dict:
        lay = jpeg.parse_layout(out)
        checks: dict = {}
        expected_images = 2 if self.gm is not None else 1
        if len(lay.images) != expected_images:
            raise ValidationError(f"Output has {len(lay.images)} images, expected {expected_images}")
        problems = jpeg_build.check_container(out, lay)
        if problems:
            raise ValidationError("; ".join(problems))
        checks["mpf_offsets_and_container_lengths"] = "ok"
        pf = lay.primary.frame
        assert pf is not None
        if (pf.width, pf.height) != self.out_size:
            raise ValidationError(f"Primary is {pf.width}x{pf.height}, expected {self.out_size}")
        s = self.stored
        orig = pixels.open_image(self._codestream(0))
        new = pixels.open_image(out[lay.primary.start:lay.primary.end])
        if not self.resample:
            cmp = pixels.compare(orig.crop((s.x, s.y, s.x + s.w, s.y + s.h)), new, margin=max(self.f.imcu))
            checks["primary_pixels"] = cmp.to_dict()
            if report["primary"]["method"] == "lossless_dct" and cmp.interior_identical is False:
                raise ValidationError("Lossless crop changed interior pixels")
        if self.gm is not None:
            gl = lay.images[1]
            gsrc = self.doc.layout.images[self.gm]
            if self.doc.image_signals(self.gm).get("hdrgm") != _signals(out, gl).get("hdrgm"):
                raise ValidationError("Gain-map hdrgm metadata changed")
            for ident in (jpeg.ISO_GAINMAP_ID,):
                a = [self.raw[x.start:x.end] for x in gsrc.app(self.raw, jpeg.APP2, ident)]
                b = [out[x.start:x.end] for x in gl.app(out, jpeg.APP2, ident)]
                if a != b:
                    raise ValidationError("ISO 21496-1 gain-map metadata changed")
            gimg = pixels.open_image(out[gl.start:gl.end])
            checks["gain_map_size"] = list(gimg.size)
            gi = report["gain_map"]
            gi["output_size"] = list(gimg.size)
            if gi["method"] in ("lossless_dct", "reencoded"):
                gx, gy, gw, gh = (int(Fraction(v)) for v in gi["region"])
                gsrc_img = pixels.open_image(self._codestream(self.gm))
                assert gsrc.frame is not None
                cmp = pixels.compare(gsrc_img.crop((gx, gy, gx + gw, gy + gh)), gimg, margin=max(gsrc.frame.imcu))
                checks["gain_map_pixels"] = cmp.to_dict()
                if gi["method"] == "lossless_dct" and cmp.interior_identical is False:
                    raise ValidationError("Lossless gain-map crop changed interior pixels")
            pw, ph = self.out_size
            gw2, gh2 = gimg.size
            src_ratio = (self.f.width / gsrc.frame.width, self.f.height / gsrc.frame.height)
            out_ratio = (pw / gw2, ph / gh2)
            checks["gain_map_scale"] = {"source": [round(v, 4) for v in src_ratio],
                                        "output": [round(v, 4) for v in out_ratio]}
            if any(abs(a - b) / a > 0.02 for a, b in zip(src_ratio, out_ratio)) and gi["method"] != "resampled_fractional":
                raise ValidationError("Gain-map to primary scale changed")
        return checks


def _signals(raw: bytes, img: jpeg.JpegImage) -> dict:
    sig: dict = {}
    for seg in img.app(raw, jpeg.APP1, jpeg.XMP_ID):
        try:
            sig.update(xmp.hdr_signals(seg.payload(raw)[len(jpeg.XMP_ID):].decode("utf-8")))
        except UnicodeDecodeError:
            pass
    return sig


def crop_jpeg(raw: bytes, opts: CropOptions) -> tuple[bytes, dict]:
    return _JpegCropper(raw, opts).run()


_PNG_COPY = {b"PLTE", b"tRNS", b"iCCP", b"sRGB", b"gAMA", b"cHRM", b"cICP", b"mDCv", b"cLLi", b"sBIT",
             b"pHYs", b"bKGD", b"hIST", b"sPLT", b"tIME", b"tEXt", b"zTXt", b"iTXt", b"eXIf", b"caBX"}


def _png_orientation(doc: png_mod.PngDoc) -> int:
    for c in doc.chunks:
        if c.type == b"eXIf":
            try:
                return exif_mod.parse(c.data(doc.raw)).orientation
            except FormatError:
                return 1
    return 1


def png_rows(doc: png_mod.PngDoc) -> list[bytes]:
    h = doc.header
    bpp = h.channels * h.bit_depth // 8
    idat = b"".join(c.data(doc.raw) for c in doc.chunks if c.type == b"IDAT")
    if h.bit_depth == 8:
        mode = {0: "L", 2: "RGB", 3: "P", 4: "LA", 6: "RGBA"}[h.color_type]
        im = pixels.open_image(doc.raw)
        if im.mode == mode and im.size == (h.width, h.height):
            data = im.tobytes()
            stride = h.width * bpp
            return [data[i * stride:(i + 1) * stride] for i in range(h.height)]
    return pixels.png_decode_rows(idat, h.width, h.height, bpp)


def crop_png(raw: bytes, opts: CropOptions) -> tuple[bytes, dict]:
    doc = png_mod.PngDoc(raw)
    h = doc.header
    if h.interlace:
        raise UnsupportedError("Interlaced (Adam7) PNG crop is not supported")
    if h.bit_depth not in (8, 16):
        raise UnsupportedError(f"PNG bit depth {h.bit_depth} crop is not supported (8 and 16 only)")
    types = {c.type for c in doc.chunks}
    if types & {b"acTL", b"fcTL", b"fdAT"}:
        raise UnsupportedError("Animated PNG crop is not supported")
    critical = {t for t in types if 65 <= t[0] <= 90} - {b"IHDR", b"PLTE", b"IDAT", b"IEND"}
    if critical:
        raise UnsupportedError(f"Unknown critical PNG chunks {sorted(critical)}")
    orientation = _png_orientation(doc)
    s = geo.display_to_stored(opts.rect, h.width, h.height, orientation)
    out_size = (s.w, s.h)
    resample = False
    if opts.output_size:
        ow, oh = geo.stored_size_for_display(*opts.output_size, orientation)
        if (ow, oh) != out_size:
            if not opts.allow_resample:
                raise UnsafeOperationError("Output size differs from the crop size; this needs resampling. "
                                           "Enable allow_resample to proceed.")
            if h.bit_depth != 8 or h.color_type == 3:
                raise UnsupportedError("Resampling is only supported for 8-bit non-palette PNG")
            resample = True
            out_size = (ow, oh)
    bpp = h.channels * h.bit_depth // 8
    warnings: list[str] = []
    if resample:
        from PIL import Image

        im = pixels.open_image(raw).crop((s.x, s.y, s.x + s.w, s.y + s.h)).resize(out_size, Image.Resampling.LANCZOS)
        data = im.tobytes()
        stride = out_size[0] * bpp
        rows = [data[i * stride:(i + 1) * stride] for i in range(out_size[1])]
    else:
        src_rows = png_rows(doc)
        rows = [r[s.x * bpp:(s.x + s.w) * bpp] for r in src_rows[s.y:s.y + s.h]]
    out = bytearray(png_mod.SIGNATURE)
    out += png_mod.chunk_bytes(b"IHDR", pixels.png_ihdr(out_size[0], out_size[1], h.bit_depth, h.color_type))
    wrote_idat = False
    for c in doc.chunks[1:]:
        if c.type == b"IEND":
            break
        if c.type == b"IDAT":
            if not wrote_idat:
                for part in pixels.png_encode_idat(rows):
                    out += png_mod.chunk_bytes(b"IDAT", part)
                wrote_idat = True
            continue
        data = c.data(raw)
        if c.type == b"eXIf":
            try:
                tiff = exif_mod.parse(data)
                buf = bytearray(data)
                if exif_mod.scrub_thumbnail(buf, tiff):
                    warnings.append("EXIF thumbnail (uncropped preview) removed")
                for tag, v in ((0xA002, out_size[0]), (0xA003, out_size[1])):
                    f = tiff.get(tag)
                    if f is not None and f.type in (3, 4) and f.count == 1:
                        exif_mod.set_number(buf, tiff, f, v)
                data = bytes(buf)
            except FormatError:
                warnings.append("eXIf unreadable; copied unchanged")
        elif c.type == b"caBX":
            warnings.append("C2PA manifest kept: its hash binding no longer matches the cropped pixels")
        elif c.type == b"cLLi":
            warnings.append("cLLi (content light level) describes the uncropped image; kept as an upper bound")
        elif c.type not in _PNG_COPY:
            if c.type[3] & 0x20 == 0:
                warnings.append(f"Unknown chunk {c.type.decode()} is not safe-to-copy and was dropped")
                continue
            warnings.append(f"Unknown safe-to-copy chunk {c.type.decode()} copied")
        out += png_mod.chunk_bytes(c.type, data)
    out += png_mod.chunk_bytes(b"IEND", b"")
    result = bytes(out)
    new_doc = png_mod.PngDoc(result)
    if (new_doc.header.width, new_doc.header.height) != out_size:
        raise ValidationError("PNG output size mismatch")
    new_rows = pixels.png_decode_rows(b"".join(c.data(result) for c in new_doc.chunks if c.type == b"IDAT"),
                                      out_size[0], out_size[1], bpp)
    if new_rows != rows:
        raise ValidationError("PNG output pixels differ from the cropped source pixels")
    for t in png_mod.COLOR_CHUNKS:
        a = [c.data(raw) for c in doc.chunks if c.type == t]
        b = [c.data(result) for c in new_doc.chunks if c.type == t]
        if a != b:
            raise ValidationError(f"PNG {t.decode()} changed")
    report = {"display_rect": opts.rect.as_list(), "stored_rect": s.as_list(), "orientation": orientation,
              "source_size": [h.width, h.height], "output_size_stored": list(out_size), "resampled": resample,
              "primary": {"method": "resampled" if resample else "exact_pixels"},
              "verification": {"pixels": "decoded output equals source region exactly"
                               if not resample else "resampled; not comparable",
                               "color_chunks": "byte-identical"},
              "warnings": warnings, "pixel_exact_crop": not resample}
    return result, report
