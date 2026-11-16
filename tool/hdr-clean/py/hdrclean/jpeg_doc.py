from __future__ import annotations

from . import c2pa as c2pa_mod
from . import exif as exif_mod
from . import jpeg, jpeg_build, jumbf, model, xmp
from .errors import FormatError, UnsafeOperationError, UnsupportedError, ValidationError

APPLE_TYPE = xmp.APPLE_GAINMAP_AUX


class JpegDoc:
    format = "jpeg"

    def __init__(self, raw: bytes) -> None:
        self.raw = raw
        self.layout = jpeg.parse_layout(raw)
        self.items: list[model.Item] = []
        self.notes: list[str] = []
        self.warnings: list[str] = list(self.layout.warnings)
        self.unrelated_jumbf: list[str] = []
        for idx, img in enumerate(self.layout.images):
            self._scan_image(idx, img)
        self.warnings += jpeg_build.check_container(raw, self.layout)

    def _loc(self, idx: int) -> str:
        return "primary image" if idx == 0 else f"image #{idx + 1} ({self.image_role(idx)})"

    def _scan_image(self, idx: int, img: jpeg.JpegImage) -> None:
        raw = self.raw
        app11 = [(s.start, s.end, s.payload(raw)) for s in img.segments if s.marker == jpeg.APP11]
        for g in jumbf.reassemble_app11(app11):
            loc = f"{self._loc(idx)} APP11 En=0x{g.instance.hex()} ({len(g.segments)} segment(s))"
            if not jumbf.looks_like_c2pa(g.data):
                self.unrelated_jumbf.append(loc)
                continue
            summary = c2pa_mod.summarize_store(g.data)
            if g.problem:
                summary.setdefault("problems", []).append(g.problem)
            self.items.append(model.Item(
                f"c2pa:{idx}:{g.instance.hex()}", "c2pa", "C2PA manifest store", loc,
                f"{sum(b - a for a, b in g.segments)} bytes", c2pa_mod.evidence(summary),
                ref={"segments": g.segments, "summary": summary}))
        for seg in img.segments:
            payload = seg.payload(raw)
            if seg.marker == jpeg.APP1 and payload.startswith(jpeg.EXIF_ID):
                try:
                    tiff = exif_mod.parse(payload[len(jpeg.EXIF_ID):])
                except FormatError as exc:
                    self.notes.append(f"{self._loc(idx)}: EXIF unreadable ({exc})")
                    continue
                items, notes = model.scan_exif(tiff, f"{self._loc(idx)} APP1 EXIF", f"exif:{idx}")
                for it in items:
                    it.ref = {"base": seg.payload_start + len(jpeg.EXIF_ID), "field": it.ref}
                self.items += items
                self.notes += notes
            elif seg.marker == jpeg.APP1 and payload.startswith(jpeg.XMP_ID):
                packet = payload[len(jpeg.XMP_ID):]
                try:
                    text = packet.decode("utf-8").rstrip("\x00")
                    editable = True
                except UnicodeDecodeError:
                    text = xmp.decode_packet(packet)
                    editable = False
                    self.notes.append(f"{self._loc(idx)}: XMP is not valid UTF-8; not editable")
                items, notes = model.scan_xmp(text, f"{self._loc(idx)} APP1 XMP", f"xmp:{idx}:{seg.start}",
                                              editable=editable)
                for it in items:
                    it.ref = {"segment": seg, "field": it.ref, "text": text}
                self.items += items
                self.notes += notes
            elif seg.marker == jpeg.APP1 and payload.startswith(jpeg.XMP_EXT_ID):
                body = payload[len(jpeg.XMP_EXT_ID) + 40:]
                items, _ = model.scan_xmp(xmp.decode_packet(body), f"{self._loc(idx)} extended XMP chunk",
                                          f"xmpext:{idx}:{seg.start}", editable=False)
                for it in items:
                    it.removable = False
                    it.note = "Extended XMP is reported only; edits are not supported"
                self.items += [it for it in items if it.evidence or it.category != "mention"]

    def image_signals(self, idx: int) -> dict:
        raw = self.raw
        img = self.layout.images[idx]
        sig: dict = {}
        for seg in img.app(raw, jpeg.APP1, jpeg.XMP_ID):
            try:
                text = seg.payload(raw)[len(jpeg.XMP_ID):].decode("utf-8")
            except UnicodeDecodeError:
                continue
            sig.update(xmp.hdr_signals(text))
        if img.app(raw, jpeg.APP2, jpeg.ISO_GAINMAP_ID):
            iso = img.app(raw, jpeg.APP2, jpeg.ISO_GAINMAP_ID)[0].payload(raw)[len(jpeg.ISO_GAINMAP_ID):]
            sig["iso21496"] = "version_only" if len(iso) <= 8 else "gain_map_metadata"
        if img.app(raw, jpeg.APP2, jpeg.ICC_ID):
            sig["icc"] = True
        return sig

    def image_role(self, idx: int) -> str:
        if idx == 0:
            return "primary"
        sig = self.image_signals(idx)
        primary = self.image_signals(0)
        container = primary.get("container") or []
        if idx < len(container) and container[idx].get("semantic") == "GainMap":
            return "gain_map"
        if "hdrgm_version" in sig or sig.get("iso21496") == "gain_map_metadata":
            return "gain_map"
        if sig.get("apple_aux_type") == APPLE_TYPE or "apple_gainmap_version" in sig:
            return "gain_map"
        entry = self.layout.images[idx].mpf_entry
        if entry is not None and entry.type_code in (0x010001, 0x010002):
            return "preview"
        return "other"

    def gain_map_index(self) -> int | None:
        maps = [i for i in range(1, len(self.layout.images)) if self.image_role(i) == "gain_map"]
        if len(maps) > 1:
            raise UnsupportedError("More than one gain map image; not supported")
        return maps[0] if maps else None

    def hdr_info(self) -> dict:
        primary = self.image_signals(0)
        kinds = []
        gm = self.gain_map_index()
        if gm is not None:
            gsig = self.image_signals(gm)
            if "hdrgm_version" in gsig or primary.get("container"):
                kinds.append("ultrahdr_gainmap")
            if gsig.get("iso21496") or primary.get("iso21496"):
                kinds.append("iso_21496_1")
            if gsig.get("apple_aux_type") == APPLE_TYPE or "apple_gainmap_version" in gsig:
                kinds.append("apple_gainmap")
            if not kinds:
                kinds.append("gainmap_unknown_flavor")
        info: dict = {"kind": kinds or ["no_gain_map"], "images": []}
        for i, img in enumerate(self.layout.images):
            f = img.frame
            info["images"].append({
                "index": i, "role": self.image_role(i), "bytes": img.end - img.start,
                "width": f.width if f else None, "height": f.height if f else None,
                "progressive": f.progressive if f else None,
                "sampling": [f"{h}x{v}" for _, h, v in f.components] if f else None,
                "signals": {k: v for k, v in self.image_signals(i).items() if k != "container"},
            })
        if gm is not None:
            p, g = self.layout.primary.frame, self.layout.images[gm].frame
            if p and g:
                info["gain_map"] = {"index": gm, "width": g.width, "height": g.height,
                                    "scale_x": p.width / g.width, "scale_y": p.height / g.height}
        protected = []
        if self.layout.mpf_segment:
            protected.append("MPF index (APP2)")
        if primary.get("icc"):
            protected.append("ICC profile (APP2)")
        if "hdrgm_version" in primary or "hdrgm" in primary:
            protected.append("Ultra HDR hdrgm XMP (primary)")
        if primary.get("container"):
            protected.append("Google container directory XMP")
        if primary.get("iso21496"):
            protected.append("ISO 21496-1 APP2 (primary)")
        if gm is not None:
            protected.append(f"Gain map codestream + metadata (image #{gm + 1})")
        info["protected_structures"] = protected
        return info

    def apply(self, selected: list[model.Item], *, mode: str = "fixed") -> bytes:
        if mode not in ("fixed", "compact"):
            raise ValueError("mode must be 'fixed' or 'compact'")
        buf = bytearray(self.raw)
        allowed: list[tuple[int, int]] = []
        drop_segments: set[int] = set()
        xmp_groups: dict[int, list] = {}
        for it in selected:
            ref = it.ref
            if it.category == "c2pa":
                for a, b in ref["segments"]:
                    if self.raw[a:a + 2] != b"\xff\xeb":
                        raise UnsafeOperationError("Unusual APP11 marker encoding; refusing")
                    if mode == "fixed":
                        buf[a + 1] = jpeg.APP15
                        buf[a + 4:b] = bytes(b - a - 4)
                        allowed.append((a, b))
                    else:
                        drop_segments.add(a)
            elif isinstance(ref.get("field"), exif_mod.Field):
                f = ref["field"]
                pos = ref["base"] + f.value_pos
                buf[pos:pos + f.byte_len] = bytes(f.byte_len)
                allowed.append((pos, pos + f.byte_len))
            elif isinstance(ref.get("field"), xmp.XmpField):
                xmp_groups.setdefault(ref["segment"].start, []).append(ref)
            else:
                raise UnsafeOperationError(f"No JPEG edit rule for {it.id}")
        for refs in xmp_groups.values():
            seg = refs[0]["segment"]
            text = refs[0]["text"]
            new_text = xmp.blank_spans(text, [r["field"].span for r in refs])
            start = seg.payload_start + len(jpeg.XMP_ID)
            encoded = new_text.encode("utf-8")
            if self.raw[start:start + len(encoded)].decode("utf-8") != text:
                raise UnsafeOperationError("XMP packet offsets are inconsistent; refusing")
            buf[start:start + len(encoded)] = encoded
            allowed.append((start, start + len(encoded)))
        result = bytes(buf)
        if mode == "compact" and drop_segments:
            result = self._compact(result, drop_segments)
            self._verify_compact(result, drop_segments)
        else:
            self._verify_fixed(result, allowed)
        return result

    def _compact(self, data: bytes, drop: set[int]) -> bytes:
        lay = self.layout
        if lay.trailing:
            raise UnsupportedError("compact mode refused: unknown bytes after the last image; use fixed mode")
        spans = sorted((im.start, im.end) for im in lay.images)
        if spans[0][0] != 0 or any(a[1] != b[0] for a, b in zip(spans, spans[1:])):
            raise UnsupportedError("compact mode refused: gaps between MPF images; use fixed mode")
        if len(lay.images) > 1 and lay.mpf_segment is None:
            raise UnsupportedError("compact mode refused: multiple images without MPF")
        parts = []
        for img in sorted(lay.images, key=lambda im: im.start):
            segs = [data[s.start:s.end] for s in img.segments[1:] if s.start not in drop]
            attr = img.mpf_entry.attribute if img.mpf_entry else 0
            parts.append(jpeg_build.ImagePart(segs, data[img.sos:img.end], attr))
        template = None
        if lay.mpf_segment is not None and lay.mpf is not None:
            base = lay.mpf_segment.payload_start + len(jpeg.MPF_ID)
            template = (data[base:lay.mpf_segment.end], lay.mpf)
            if [e.start for e in lay.images] != [s[0] for s in spans]:
                raise UnsupportedError("compact mode refused: MPF order differs from file order")
        return jpeg_build.assemble(parts, mpf_template=template)

    def _verify_fixed(self, result: bytes, allowed: list[tuple[int, int]]) -> None:
        if len(result) != len(self.raw):
            raise ValidationError("JPEG length changed in fixed-offset mode")
        pos = 0
        for a, b in sorted(allowed) + [(len(result), len(result))]:
            if a > pos and self.raw[pos:a] != result[pos:a]:
                raise ValidationError("Bytes outside the selected metadata changed")
            pos = max(pos, b)
        new = jpeg.parse_layout(result)
        if [(i.start, i.end, i.sos) for i in new.images] != [(i.start, i.end, i.sos) for i in self.layout.images]:
            raise ValidationError("Image layout changed")
        for old, nw in zip(self.layout.images, new.images):
            if self.raw[old.sos:old.end] != result[nw.sos:nw.end]:
                raise ValidationError("Compressed image data changed")

    def _verify_compact(self, result: bytes, dropped: set[int]) -> None:
        new = jpeg.parse_layout(result)
        if len(new.images) != len(self.layout.images):
            raise ValidationError("Image count changed")
        for old, nw in zip(sorted(self.layout.images, key=lambda i: i.start), new.images):
            if self.raw[old.sos:old.end] != result[nw.sos:nw.end]:
                raise ValidationError("Compressed image data changed")
            kept = [s for s in old.segments[1:] if s.start not in dropped]
            if len(kept) != len(nw.segments) - 1:
                raise ValidationError("Unexpected header segment count")
            for o, n in zip(kept, nw.segments[1:]):
                ob, nb = self.raw[o.start:o.end], result[n.start:n.end]
                is_mpf = o.marker == jpeg.APP2 and ob[4:8] == jpeg.MPF_ID
                is_xmp = o.marker == jpeg.APP1 and ob[4:4 + len(jpeg.XMP_ID)] == jpeg.XMP_ID
                if ob != nb and not is_mpf and not is_xmp:
                    raise ValidationError(f"Header segment {o.name} changed")
        problems = jpeg_build.check_container(result, new)
        if problems:
            raise ValidationError("; ".join(problems))
        if new.mpf is not None:
            for e in new.mpf.entries[1:]:
                if e.size == 0:
                    raise ValidationError("Empty MPF entry after rebuild")
