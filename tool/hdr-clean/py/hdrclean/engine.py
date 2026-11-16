from __future__ import annotations

import hashlib
from dataclasses import dataclass, field

from . import __version__, jpeg, model, pixels
from . import c2pa as c2pa_mod
from . import crop as crop_mod
from . import exif as exif_mod
from . import geometry as geo
from .bmff import HeifDoc
from .errors import FormatError, ProvenanceError, UnsupportedError, ValidationError, check_size
from .jpeg_doc import JpegDoc
from .png import PngDoc
from .webp import WebpDoc

MIME = {"jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp", "heif": "image/heif"}
EXT = {"jpeg": ".jpg", "png": ".png", "webp": ".webp", "heif": ".heic"}
HEIF_BRANDS = {b"heic", b"heix", b"heim", b"heis", b"hevc", b"hevx", b"mif1", b"msf1", b"avif", b"avis", b"mif2"}

LIMITATIONS = [
    "Pixel-level watermarks are not detected or removed; they are not metadata.",
    "C2PA signatures, certificate chains and hash bindings are not cryptographically verified by this "
    "tool unless the optional c2pa-python package is installed.",
    "Provider evidence shows which tool wrote or signed metadata, not who created the pixels.",
    "An absence of findings is not proof that no AI tool was involved.",
]


def detect_format(raw: bytes) -> str:
    if raw[:3] == b"\xff\xd8\xff":
        return "jpeg"
    if raw[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if raw[:4] == b"RIFF" and raw[8:12] == b"WEBP":
        return "webp"
    if raw[4:8] == b"ftyp":
        brands = {raw[8:12]} | {raw[i:i + 4] for i in range(16, min(len(raw), 8 + int.from_bytes(raw[:4], "big")), 4)}
        if brands & HEIF_BRANDS:
            return "heif"
        raise UnsupportedError(f"ISO BMFF brand {raw[8:12]!r} is not a supported still-image format")
    raise UnsupportedError("Unsupported file type (supported: JPEG, PNG, WebP, HEIF/HEIC/AVIF)")


def open_doc(raw: bytes):
    check_size(raw)
    fmt = detect_format(raw)
    return {"jpeg": JpegDoc, "png": PngDoc, "webp": WebpDoc, "heif": HeifDoc}[fmt](raw)


def _dimensions(doc) -> dict:
    w = h = None
    orientation = 1
    if isinstance(doc, JpegDoc):
        f = doc.layout.primary.frame
        w, h = (f.width, f.height) if f else (None, None)
        for seg in doc.layout.primary.app(doc.raw, jpeg.APP1, jpeg.EXIF_ID):
            try:
                orientation = exif_mod.parse(seg.payload(doc.raw)[6:]).orientation
            except FormatError:
                pass
            break
    elif isinstance(doc, PngDoc):
        w, h = doc.header.width, doc.header.height
        orientation = crop_mod._png_orientation(doc)
    elif isinstance(doc, WebpDoc):
        try:
            im = pixels.open_image(doc.raw)
            w, h = im.size
        except ProvenanceError:
            pass
    out = {"width": w, "height": h, "orientation": orientation}
    if w and h:
        out["display_width"], out["display_height"] = geo.display_size(w, h, orientation)
    return out


def _crop_support(doc) -> dict:
    if isinstance(doc, JpegDoc):
        try:
            info = {"supported": True, **crop_mod.grid_info(doc)}
        except ProvenanceError as exc:
            return {"supported": False, "reason": str(exc)}
        if doc.layout.trailing:
            return {"supported": False, "reason": "data after the last image (Motion Photo / vendor trailer)"}
        return info
    if isinstance(doc, PngDoc):
        h = doc.header
        if h.interlace or h.bit_depth not in (8, 16):
            return {"supported": False, "reason": "interlaced or sub-8-bit PNG"}
        return {"supported": True, "lossless_primary": [1, 1], "lossless_all": [1, 1], "jpegtran": None}
    return {"supported": False, "reason": f"cropping {doc.format} would need lossy re-encoding; not offered"}


def _c2pa_section(doc) -> dict:
    stores = [it for it in doc.items if it.category == "c2pa"]
    if not stores:
        return {"status": "absent", "stores": [], "generative_declarations": []}
    out = []
    gen = []
    for it in stores:
        s = it.ref["summary"]
        out.append({"item": it.id, "location": it.location, "parsed": s.get("parsed", False),
                    "active_manifest": s.get("active_manifest"), "manifests": s.get("manifests", []),
                    "problems": s.get("problems", [])})
        gen += c2pa_mod.generative_declarations(s)
    status = "present" if all(o["parsed"] for o in out) else "present_unparsed"
    return {"status": status, "stores": out, "generative_declarations": gen}


def inspect(raw: bytes, *, name: str | None = None, verify_signature: bool = True) -> dict:
    doc = open_doc(raw)
    return build_report(doc, name=name, verify_signature=verify_signature)


def build_report(doc, *, name: str | None = None, verify_signature: bool = True) -> dict:
    raw = doc.raw
    items = [it.to_dict() for it in doc.items]
    evidence = [dict(e, item=it.id) for it in doc.items for e in it.evidence]
    providers = sorted({e["provider"] for e in evidence})
    c2 = _c2pa_section(doc)
    unanalyzed = [n for n in doc.notes if not n.startswith(model.NOT_INSPECTED)]
    not_inspected = [n[len(model.NOT_INSPECTED):] for n in doc.notes if n.startswith(model.NOT_INSPECTED)]
    if c2["status"] == "present_unparsed":
        unanalyzed.append("A C2PA manifest store is present but could not be fully parsed")
    if providers:
        detection = "identified"
    elif unanalyzed:
        detection = "inconclusive"
    else:
        detection = "none_found"
    report = {
        "tool": {"name": "hdr-clean", "version": __version__},
        "name": name, "format": doc.format, "bytes": len(raw),
        "sha256": hashlib.sha256(raw).hexdigest(),
        "dimensions": _dimensions(doc),
        "hdr": doc.hdr_info(),
        "c2pa": c2,
        "providers": providers,
        "detection": detection,
        "evidence": evidence,
        "items": items,
        "unanalyzed": unanalyzed,
        "not_inspected": not_inspected,
        "warnings": getattr(doc, "warnings", []),
        "unrelated_jumbf": getattr(doc, "unrelated_jumbf", []),
        "crop": _crop_support(doc),
        "limitations": LIMITATIONS,
    }
    if verify_signature and c2["status"] != "absent":
        report["c2pa"]["signature_validation"] = c2pa_mod.validate_with_c2pa_library(raw, MIME[doc.format])
    return report


@dataclass
class ProcessOptions:
    categories: tuple[str, ...] = model.DEFAULT_CATEGORIES
    scope: str = "provider"
    item_ids: list[str] | None = None
    jpeg_mode: str = "fixed"
    crop: crop_mod.CropOptions | None = None
    verify_signature: bool = True
    extra: dict = field(default_factory=dict)

    @classmethod
    def from_dict(cls, d: dict) -> ProcessOptions:
        cats = d.get("categories", list(model.DEFAULT_CATEGORIES))
        return cls(tuple(cats), d.get("scope", "provider"), d.get("item_ids"),
                   d.get("jpeg_mode", "fixed"),
                   crop_mod.CropOptions.from_dict(d["crop"]) if d.get("crop") else None,
                   bool(d.get("verify_signature", True)))


def _verifiability(before: dict, after: dict, removed_c2pa: bool, cropped: bool) -> str:
    b, a = before["c2pa"]["status"], after["c2pa"]["status"]
    if b == "absent":
        return "No C2PA provenance existed; nothing verifiable was lost."
    if a == "absent":
        return ("C2PA provenance removed: the output can no longer be verified against the original "
                "signed manifest. Keep the original file if provenance may be needed.")
    if cropped:
        return ("C2PA manifest kept but the pixels changed: validators will report the hash binding as "
                "mismatched (tampered).")
    return "C2PA provenance unchanged."


def _decoded_equal(fmt: str, a: bytes, b: bytes) -> dict:
    if fmt == "heif":
        return {"status": "not_decoded", "reason": "no HEIF decoder; byte-level checks apply"}
    try:
        ia, ib = pixels.open_image(a), pixels.open_image(b)
    except ProvenanceError as exc:
        return {"status": "not_decoded", "reason": str(exc)}
    same = ia.size == ib.size and ia.mode == ib.mode and ia.tobytes() == ib.tobytes()
    if not same:
        raise ValidationError("Decoded pixels differ after a metadata-only operation")
    out = {"status": "identical", "size": list(ia.size), "mode": ia.mode}
    if fmt == "jpeg":
        la, lb = jpeg.parse_layout(a), jpeg.parse_layout(b)
        for i, (x, y) in enumerate(zip(la.images[1:], lb.images[1:]), start=2):
            ga = pixels.open_image(a[x.start:x.end])
            gb = pixels.open_image(b[y.start:y.end])
            if ga.tobytes() != gb.tobytes():
                raise ValidationError(f"Decoded image #{i} differs after a metadata-only operation")
            out[f"image_{i}"] = "identical"
    return out


def process(raw: bytes, options: ProcessOptions, *, name: str | None = None) -> tuple[bytes | None, dict]:
    doc = open_doc(raw)
    before = build_report(doc, name=name, verify_signature=options.verify_signature)
    selected = model.select(doc.items, options.categories, options.scope, options.item_ids)
    result: dict = {"input": before, "options": {
        "categories": list(options.categories), "scope": options.scope, "item_ids": options.item_ids,
        "jpeg_mode": options.jpeg_mode, "crop": options.crop.__dict__ if options.crop else None}}
    if options.crop:
        result["options"]["crop"] = {**options.crop.__dict__, "rect": options.crop.rect.as_list()}
    data = raw
    checks: dict = {}
    if selected:
        if isinstance(doc, JpegDoc):
            data = doc.apply(selected, mode=options.jpeg_mode)
        else:
            data = doc.apply(selected)
        checks["metadata_edit"] = "byte-level invariants passed"
        checks["decoded_pixels"] = _decoded_equal(doc.format, raw, data)
    crop_report = None
    if options.crop:
        if doc.format == "jpeg":
            data, crop_report = crop_mod.crop_jpeg(data, options.crop)
        elif doc.format == "png":
            data, crop_report = crop_mod.crop_png(data, options.crop)
        else:
            raise UnsupportedError(f"Cropping {doc.format.upper()} is not supported")
    found = [it for it in doc.items if it.evidence or it.category in ("c2pa", "generative-declaration")]
    sel_ids = {it.id for it in selected}
    result["found"] = [it.to_dict() for it in found]
    result["targeted"] = sorted(sel_ids)
    result["not_targeted"] = [{"id": it.id, "category": it.category,
                               "reason": (it.note or "not editable") if not it.removable
                               else "not selected"} for it in found if it.id not in sel_ids]
    if not selected and not options.crop:
        result["status"] = "nothing_to_do"
        result["processed"] = []
        result["remaining_identifiers"] = before["evidence"]
        result["verifiability"] = "Unchanged (no output written)."
        return None, result
    after_doc = open_doc(data)
    after = build_report(after_doc, verify_signature=options.verify_signature)
    if not options.crop:
        after_keys = {(x.category, x.label, x.value) for x in after_doc.items}
        survivors = [it.id for it in selected if (it.category, it.label, it.value) in after_keys
                     and it.category != "c2pa"]
        if any(x.category == "c2pa" for x in after_doc.items) and any(it.category == "c2pa" for it in selected):
            if len([x for x in after_doc.items if x.category == "c2pa"]) >= \
                    len([x for x in doc.items if x.category == "c2pa"]):
                survivors.append("c2pa")
        if survivors:
            raise ValidationError(f"Selected items still present after processing: {sorted(survivors)}")
    result["processed"] = sorted(sel_ids)
    result["retained_for_hdr"] = before["hdr"].get("protected_structures", [])
    result["unanalyzed"] = before["unanalyzed"]
    result["remaining_identifiers"] = after["evidence"]
    removed_c2pa = any(it.category == "c2pa" for it in selected)
    result["verifiability"] = _verifiability(before, after, removed_c2pa, bool(options.crop))
    result["crop"] = crop_report
    result["checks"] = checks
    result["output"] = {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(), "format": doc.format,
                        "report": after}
    result["status"] = "success"
    return data, result
