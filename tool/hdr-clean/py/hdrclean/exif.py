from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from .errors import MAX_IFD_ENTRIES, FormatError

TYPE_SIZES = {1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 13: 4}

TAG_NAMES = {
    0x000B: "ProcessingSoftware",
    0x010E: "ImageDescription",
    0x010F: "Make",
    0x0110: "Model",
    0x0112: "Orientation",
    0x0131: "Software",
    0x013B: "Artist",
    0x8298: "Copyright",
    0x9286: "UserComment",
    0x927C: "MakerNote",
    0xA002: "PixelXDimension",
    0xA003: "PixelYDimension",
    0xA420: "ImageUniqueID",
    0xA433: "LensMake",
    0x0201: "JPEGInterchangeFormat",
    0x0202: "JPEGInterchangeFormatLength",
}
SOFTWARE_TAGS = {0x000B, 0x0131}
IFD_POINTERS = {0x8769: "Exif", 0x8825: "GPS", 0xA005: "Interop"}


_BIG: Literal["big"] = "big"
_LITTLE: Literal["little"] = "little"


@dataclass(frozen=True)
class Field:
    ifd: str
    tag: int
    type: int
    count: int
    value_pos: int
    entry_pos: int

    @property
    def name(self) -> str:
        return TAG_NAMES.get(self.tag, f"0x{self.tag:04X}")

    @property
    def byte_len(self) -> int:
        return TYPE_SIZES.get(self.type, 1) * self.count


@dataclass
class Tiff:
    data: bytes
    byte_order: str
    fields: list[Field]
    ifd0_next_pos: int | None
    ifd1_offset: int

    def _int(self, pos: int, size: int) -> int:
        return int.from_bytes(self.data[pos:pos + size], _BIG if self.byte_order == ">" else _LITTLE)

    def get(self, tag: int, ifd: str | None = None) -> Field | None:
        for f in self.fields:
            if f.tag == tag and (ifd is None or f.ifd == ifd):
                return f
        return None

    def ascii(self, f: Field) -> str:
        raw = self.data[f.value_pos:f.value_pos + f.byte_len]
        return raw.split(b"\x00", 1)[0].decode("utf-8", "replace")

    def text(self, f: Field) -> str:
        raw = self.data[f.value_pos:f.value_pos + min(f.byte_len, 4096)]
        if f.tag == 0x9286 and len(raw) >= 8:
            charset, raw = raw[:8], raw[8:]
            if charset.startswith(b"UNICODE"):
                enc = "utf-16-be" if self.byte_order == ">" else "utf-16-le"
                return raw.decode(enc, "replace").rstrip("\x00 ")
        return raw.split(b"\x00", 1)[0].decode("utf-8", "replace").strip()

    def number(self, f: Field) -> int:
        size = TYPE_SIZES.get(f.type, 1)
        if size not in (1, 2, 4) or f.count < 1:
            raise FormatError(f"EXIF {f.name} is not an integer field")
        return self._int(f.value_pos, size)

    @property
    def orientation(self) -> int:
        f = self.get(0x0112, "IFD0")
        if f is None:
            return 1
        try:
            v = self.number(f)
        except FormatError:
            return 1
        return v if 1 <= v <= 8 else 1

    def thumbnail_span(self) -> tuple[int, int] | None:
        off = self.get(0x0201, "IFD1")
        ln = self.get(0x0202, "IFD1")
        if off is None or ln is None:
            return None
        start, length = self.number(off), self.number(ln)
        if length == 0 or start + length > len(self.data):
            return None
        return start, start + length


def parse(data: bytes) -> Tiff:
    if len(data) < 8:
        raise FormatError("Truncated TIFF header")
    if data[:4] == b"MM\x00*":
        bo = ">"
    elif data[:4] == b"II*\x00":
        bo = "<"
    else:
        raise FormatError("Invalid TIFF header")
    endian = _BIG if bo == ">" else _LITTLE

    def u(pos: int, size: int) -> int:
        if pos + size > len(data):
            raise FormatError("TIFF read out of bounds")
        return int.from_bytes(data[pos:pos + size], endian)

    fields: list[Field] = []
    visited: set[int] = set()
    ifd0_next_pos = None
    ifd1_offset = 0
    queue: list[tuple[str, int]] = [("IFD0", u(4, 4))]
    while queue:
        name, off = queue.pop(0)
        if off == 0 or off in visited:
            continue
        if off + 2 > len(data) or len(visited) > 64:
            raise FormatError(f"TIFF {name} offset out of bounds")
        visited.add(off)
        count = u(off, 2)
        if count > MAX_IFD_ENTRIES or off + 2 + 12 * count + 4 > len(data):
            raise FormatError(f"TIFF {name} has an invalid entry count")
        for i in range(count):
            p = off + 2 + 12 * i
            tag, typ, cnt = u(p, 2), u(p + 2, 2), u(p + 4, 4)
            size = TYPE_SIZES.get(typ)
            if size is None:
                continue
            total = size * cnt
            value_pos = p + 8 if total <= 4 else u(p + 8, 4)
            if value_pos + total > len(data):
                continue
            fields.append(Field(name, tag, typ, cnt, value_pos, p))
            if tag in IFD_POINTERS and typ in (4, 13) and cnt == 1:
                queue.append((IFD_POINTERS[tag], u(p + 8, 4)))
        nxt_pos = off + 2 + 12 * count
        if name == "IFD0":
            ifd0_next_pos = nxt_pos
            ifd1_offset = u(nxt_pos, 4)
            if ifd1_offset:
                queue.append(("IFD1", ifd1_offset))
    return Tiff(data, bo, fields, ifd0_next_pos, ifd1_offset)


def blank_value(data: bytearray, f: Field) -> None:
    data[f.value_pos:f.value_pos + f.byte_len] = bytes(f.byte_len)


def set_number(data: bytearray, tiff: Tiff, f: Field, value: int) -> None:
    size = TYPE_SIZES[f.type]
    if size not in (2, 4):
        raise FormatError(f"Cannot rewrite EXIF {f.name}")
    if value >= 1 << (8 * size):
        raise FormatError(f"EXIF {f.name} value {value} does not fit")
    data[f.value_pos:f.value_pos + size] = value.to_bytes(size, _BIG if tiff.byte_order == ">" else _LITTLE)


def scrub_thumbnail(data: bytearray, tiff: Tiff) -> bool:
    span = tiff.thumbnail_span()
    changed = False
    if span:
        data[span[0]:span[1]] = bytes(span[1] - span[0])
        changed = True
    if tiff.ifd0_next_pos is not None and tiff.ifd1_offset:
        data[tiff.ifd0_next_pos:tiff.ifd0_next_pos + 4] = bytes(4)
        changed = True
    return changed
