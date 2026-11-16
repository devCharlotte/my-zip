from __future__ import annotations

import hashlib
from fractions import Fraction

from . import engine, jpeg, pixels
from .errors import UnsupportedError
from .geometry import Rect
from .jpeg_doc import JpegDoc


def _oriented(data: bytes):
    from PIL import ImageOps

    im = pixels.open_image(data)
    return ImageOps.exif_transpose(im)


def verify_pair(original: bytes, processed: bytes, rect: Rect | None = None) -> dict:
    fa, fb = engine.detect_format(original), engine.detect_format(processed)
    out: dict = {"original_sha256": hashlib.sha256(original).hexdigest(),
                 "processed_sha256": hashlib.sha256(processed).hexdigest(),
                 "format": [fa, fb]}
    if fa != fb:
        out["verdict"] = "different_formats"
        return out
    if fa == "heif":
        raise UnsupportedError("HEIF pixel comparison needs a HEIF decoder, which is not bundled")
    a = _oriented(original)
    b = _oriented(processed)
    if rect is None:
        if a.size != b.size:
            out["verdict"] = "size_differs_give_rect"
            return out
        cmp = pixels.compare(a, b)
        out["primary"] = cmp.to_dict()
        out["verdict"] = "metadata_only_pixels_identical" if cmp.identical else "pixels_changed"
    else:
        region = a.crop((rect.x, rect.y, rect.x + rect.w, rect.y + rect.h))
        if region.size != b.size:
            out["verdict"] = "size_mismatch"
            out["expected_size"] = list(region.size)
            out["actual_size"] = list(b.size)
            return out
        cmp = pixels.compare(region, b, margin=16)
        out["primary"] = cmp.to_dict()
        if cmp.identical:
            out["verdict"] = "crop_only_pixels_identical"
        elif cmp.interior_identical:
            out["verdict"] = "crop_only_block_aligned_lossless"
        elif cmp.psnr_db is not None and cmp.psnr_db >= 35:
            out["verdict"] = "consistent_with_crop_and_reencode"
        else:
            out["verdict"] = "not_explained_by_crop"
    if fa == "jpeg":
        out["gain_map"] = _gain_map_check(original, processed, rect)
    out["note"] = ("Evidence of correspondence only. It cannot rule out edits that are smaller than "
                   "the re-encoding error, and it says nothing about pixel watermarks.")
    return out


def _gain_map_check(original: bytes, processed: bytes, rect: Rect | None) -> dict:
    da, db = JpegDoc(original), JpegDoc(processed)
    ga, gb = da.gain_map_index(), db.gain_map_index()
    if ga is None and gb is None:
        return {"status": "no_gain_map"}
    if ga is None or gb is None:
        return {"status": "gain_map_missing_in_" + ("processed" if gb is None else "original")}
    ia, ib = da.layout.images[ga], db.layout.images[gb]
    pa, pb = da.layout.primary.frame, db.layout.primary.frame
    assert ia.frame and ib.frame and pa and pb
    ra = (pa.width / ia.frame.width, pa.height / ia.frame.height)
    rb = (pb.width / ib.frame.width, pb.height / ib.frame.height)
    result: dict = {"status": "present", "scale_original": [round(v, 4) for v in ra],
                    "scale_processed": [round(v, 4) for v in rb]}
    ga_img = pixels.open_image(original[ia.start:ia.end])
    gb_img = pixels.open_image(processed[ib.start:ib.end])
    if rect is None:
        result["pixels"] = pixels.compare(ga_img, gb_img).to_dict() if ga_img.size == gb_img.size else "size differs"
        return result
    crop_doc_orientation = engine._dimensions(da)["orientation"]
    from .geometry import display_to_stored

    s = display_to_stored(rect, pa.width, pa.height, crop_doc_orientation)
    fx, fy = Fraction(ia.frame.width, pa.width), Fraction(ia.frame.height, pa.height)
    g = [s.x * fx, s.y * fy, s.w * fx, s.h * fy]
    if all(v.denominator == 1 for v in g):
        gx, gy, gw, gh = (int(v) for v in g)
        region = ga_img.crop((gx, gy, gx + gw, gy + gh))
        if region.size == gb_img.size:
            result["pixels"] = pixels.compare(region, gb_img, margin=16).to_dict()
        else:
            result["pixels"] = f"size differs: expected {list(region.size)}, got {list(gb_img.size)}"
    else:
        result["pixels"] = "gain-map region is fractional (resampled); compared by scale only"
    _ = jpeg
    return result
