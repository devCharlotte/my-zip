from __future__ import annotations

from dataclasses import dataclass

from . import jpeg, mpf, xmp
from .errors import FormatError, UnsafeOperationError


@dataclass
class ImagePart:
    segments: list[bytes]
    tail: bytes
    mpf_attribute: int = 0

    def body_len(self) -> int:
        return 2 + sum(len(s) for s in self.segments) + len(self.tail)


def assemble(parts: list[ImagePart], *, mpf_template: tuple[bytes, mpf.MPFIndex] | None) -> bytes:
    primary = parts[0]
    secondaries = [b"\xff\xd8" + b"".join(p.segments) + p.tail for p in parts[1:]]
    sec_lens = [len(s) for s in secondaries]
    segs = list(primary.segments)
    mpf_idx = [i for i, s in enumerate(segs) if s[1] == jpeg.APP2 and s[4:8] == jpeg.MPF_ID]
    if len(parts) > 1 and len(mpf_idx) != 1:
        raise UnsafeOperationError("Multi-image JPEG needs exactly one MPF segment in the primary")
    for i, s in enumerate(segs):
        if s[1] == jpeg.APP1 and s[4:4 + len(jpeg.XMP_ID)] == jpeg.XMP_ID:
            packet = s[4 + len(jpeg.XMP_ID):]
            try:
                text = packet.decode("utf-8")
            except UnicodeDecodeError:
                continue
            items = xmp.container_items(text)
            if not items:
                continue
            if len(items) != len(parts):
                raise UnsafeOperationError(
                    f"XMP container lists {len(items)} items but the file will hold {len(parts)} images")
            if any(it.padding for it in items[1:]):
                raise UnsafeOperationError("XMP container item padding is not supported")
            for k in range(1, len(items)):
                text = xmp.set_container_length(text, k, sec_lens[k - 1])
            if not xmp.is_parseable(text):
                raise UnsafeOperationError("Updated XMP container is not well-formed")
            segs[i] = jpeg.make_segment(jpeg.APP1, jpeg.XMP_ID + text.encode("utf-8"))
    if len(parts) == 1:
        if mpf_idx:
            raise UnsafeOperationError("Single-image output must not keep an MPF index")
        return b"\xff\xd8" + b"".join(segs) + primary.tail
    k = mpf_idx[0]
    count = len(parts)
    if mpf_template is not None and len(mpf_template[1].entries) == count:
        payload_len = len(mpf_template[0])
    else:
        payload_len = mpf.minimal_length(count)
    mpf_seg_len = 4 + 4 + payload_len
    prefix_len = 2 + sum(len(s) for s in segs[:k])
    mpf_base = prefix_len + 8
    primary_len = 2 + sum(len(s) for j, s in enumerate(segs) if j != k) + mpf_seg_len + len(primary.tail)
    sizes_offsets = [(primary_len, 0)]
    pos = primary_len
    for ln in sec_lens:
        sizes_offsets.append((ln, pos - mpf_base))
        pos += ln
    if mpf_template is not None and len(mpf_template[1].entries) == count:
        payload = mpf.patch(mpf_template[0], mpf_template[1], sizes_offsets)
    else:
        bo = mpf_template[1].byte_order if mpf_template else ">"
        payload = mpf.build_minimal([p.mpf_attribute for p in parts], sizes_offsets, bo)
    segs[k] = jpeg.make_segment(jpeg.APP2, jpeg.MPF_ID + payload)
    out = b"\xff\xd8" + b"".join(segs) + primary.tail
    if len(out) != primary_len:
        raise FormatError("Internal error: primary length mismatch")
    return out + b"".join(secondaries)


def check_container(raw: bytes, layout: jpeg.JpegLayout) -> list[str]:
    problems = []
    for seg in layout.primary.app(raw, jpeg.APP1, jpeg.XMP_ID):
        try:
            text = seg.payload(raw)[len(jpeg.XMP_ID):].decode("utf-8")
        except UnicodeDecodeError:
            continue
        items = xmp.container_items(text)
        if not items:
            continue
        secs = layout.images[1:]
        if len(items) - 1 != len(secs):
            problems.append(f"XMP container has {len(items)} items, file has {len(layout.images)} images")
            continue
        for it, img in zip(items[1:], secs):
            if it.length is not None and it.length != img.end - img.start:
                problems.append(f"Container item {it.semantic} length {it.length} != {img.end - img.start}")
    return problems
