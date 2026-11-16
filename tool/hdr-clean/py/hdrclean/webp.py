from __future__ import annotations

from dataclasses import dataclass

from . import c2pa as c2pa_mod
from . import exif as exif_mod
from . import model, xmp
from .errors import MAX_SEGMENTS, FormatError, LimitError, UnsafeOperationError, ValidationError

IMAGE_CHUNKS = (b"VP8 ", b"VP8L", b"ALPH", b"ANIM", b"ANMF", b"VP8X", b"ICCP")


@dataclass(frozen=True)
class Chunk:
    fourcc: bytes
    start: int
    data_start: int
    data_end: int
    end: int


def chunks(raw: bytes) -> list[Chunk]:
    if len(raw) < 12 or raw[:4] != b"RIFF" or raw[8:12] != b"WEBP":
        raise FormatError("Not a WebP file")
    riff = int.from_bytes(raw[4:8], "little")
    if riff + 8 != len(raw):
        raise FormatError(f"RIFF size {riff + 8} != file size {len(raw)}")
    pos = 12
    out: list[Chunk] = []
    while pos < len(raw):
        if len(out) > MAX_SEGMENTS:
            raise LimitError("Too many WebP chunks")
        if pos + 8 > len(raw):
            raise FormatError("Truncated WebP chunk header")
        size = int.from_bytes(raw[pos + 4:pos + 8], "little")
        end = pos + 8 + size + (size & 1)
        if pos + 8 + size > len(raw) or end > len(raw):
            raise FormatError("Truncated WebP chunk")
        out.append(Chunk(raw[pos:pos + 4], pos, pos + 8, pos + 8 + size, end))
        pos = end
    if not any(c.fourcc in (b"VP8 ", b"VP8L", b"ANMF") for c in out):
        raise FormatError("WebP has no image data chunk")
    return out


class WebpDoc:
    format = "webp"

    def __init__(self, raw: bytes) -> None:
        self.raw = raw
        self.chunks = chunks(raw)
        self.items: list[model.Item] = []
        self.notes: list[str] = []
        for i, c in enumerate(self.chunks):
            data = raw[c.data_start:c.data_end]
            loc = f"WebP {c.fourcc.decode('latin-1').strip()} chunk @{c.start}"
            if c.fourcc == b"C2PA":
                summary = c2pa_mod.summarize_store(data)
                self.items.append(model.Item(f"c2pa:{i}", "c2pa", "C2PA manifest store", loc,
                                             f"{len(data)} bytes", c2pa_mod.evidence(summary),
                                             ref={"chunk": c, "summary": summary}))
            elif c.fourcc == b"EXIF":
                skip = 6 if data.startswith(b"Exif\x00\x00") else 0
                try:
                    tiff = exif_mod.parse(data[skip:])
                except FormatError as exc:
                    self.notes.append(f"{loc}: EXIF unreadable ({exc})")
                    continue
                items, notes = model.scan_exif(tiff, loc, f"exif{i}")
                for it in items:
                    it.ref = {"base": c.data_start + skip, "field": it.ref}
                self.items += items
                self.notes += notes
            elif c.fourcc == b"XMP ":
                try:
                    text = data.decode("utf-8").rstrip("\x00")
                    editable = True
                except UnicodeDecodeError:
                    text, editable = xmp.decode_packet(data), False
                items, notes = model.scan_xmp(text, loc, f"xmp{i}", editable=editable)
                for it in items:
                    it.ref = {"chunk": c, "field": it.ref, "text": text}
                self.items += items
                self.notes += notes

    def hdr_info(self) -> dict:
        return {"kind": ["no_gain_map"],
                "protected_structures": ["ICCP chunk" for c in self.chunks if c.fourcc == b"ICCP"]
                + ["VP8/VP8L/ALPH image chunks"],
                "note": "WebP has no standardized HDR gain map; ICC profile is preserved"}

    def apply(self, selected: list[model.Item]) -> bytes:
        buf = bytearray(self.raw)
        drop: set[int] = set()
        edited: set[int] = set()
        xmp_groups: dict[int, list] = {}
        for it in selected:
            ref = it.ref
            if it.category == "c2pa":
                drop.add(ref["chunk"].start)
            elif isinstance(ref.get("field"), exif_mod.Field):
                f = ref["field"]
                pos = ref["base"] + f.value_pos
                buf[pos:pos + f.byte_len] = bytes(f.byte_len)
                edited.add(self._owner(pos))
            elif isinstance(ref.get("field"), xmp.XmpField):
                xmp_groups.setdefault(ref["chunk"].start, []).append(ref)
            else:
                raise UnsafeOperationError(f"No WebP edit rule for {it.id}")
        for refs in xmp_groups.values():
            c = refs[0]["chunk"]
            new = xmp.blank_spans(refs[0]["text"], [r["field"].span for r in refs]).encode("utf-8")
            buf[c.data_start:c.data_start + len(new)] = new
            edited.add(c.start)
        out = bytearray(buf[:12])
        for c in self.chunks:
            if c.start not in drop:
                out += buf[c.start:c.end]
        out[4:8] = (len(out) - 8).to_bytes(4, "little")
        result = bytes(out)
        new_chunks = chunks(result)
        kept = [c for c in self.chunks if c.start not in drop]
        if [c.fourcc for c in kept] != [c.fourcc for c in new_chunks]:
            raise ValidationError("WebP chunk sequence changed")
        for old, nw in zip(kept, new_chunks):
            if old.start in edited and old.fourcc not in IMAGE_CHUNKS:
                continue
            if self.raw[old.start:old.end] != result[nw.start:nw.end]:
                raise ValidationError(f"WebP {old.fourcc!r} chunk changed")
        return result

    def _owner(self, pos: int) -> int:
        for c in self.chunks:
            if c.data_start <= pos < c.data_end:
                return c.start
        raise UnsafeOperationError("Edit outside any chunk")
