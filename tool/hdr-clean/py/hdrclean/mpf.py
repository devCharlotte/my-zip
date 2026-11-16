from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Literal

from .errors import MAX_IFD_ENTRIES, FormatError

TAG_VERSION = 0xB000
TAG_COUNT = 0xB001
TAG_ENTRY = 0xB002

TYPE_BASELINE_PRIMARY = 0x030000
TYPE_UNDEFINED = 0x000000


_BIG: Literal["big"] = "big"
_LITTLE: Literal["little"] = "little"


@dataclass(frozen=True)
class MPEntry:
    attribute: int
    size: int
    offset: int
    dep1: int
    dep2: int
    field_pos: int

    @property
    def type_code(self) -> int:
        return self.attribute & 0xFFFFFF

    @property
    def data_format(self) -> int:
        return (self.attribute >> 24) & 0x7


@dataclass(frozen=True)
class MPFIndex:
    byte_order: str
    entries: list[MPEntry]


def _u16(b: bytes, pos: int, bo: str) -> int:
    return int.from_bytes(b[pos:pos + 2], _BIG if bo == ">" else _LITTLE)


def _u32(b: bytes, pos: int, bo: str) -> int:
    return int.from_bytes(b[pos:pos + 4], _BIG if bo == ">" else _LITTLE)


def parse(payload: bytes) -> MPFIndex:
    if len(payload) < 8:
        raise FormatError("Truncated MPF header")
    if payload[:4] == b"MM\x00*":
        bo = ">"
    elif payload[:4] == b"II*\x00":
        bo = "<"
    else:
        raise FormatError("Invalid MPF byte-order header")
    ifd = _u32(payload, 4, bo)
    if ifd + 2 > len(payload):
        raise FormatError("MPF IFD outside segment")
    count = _u16(payload, ifd, bo)
    if count > MAX_IFD_ENTRIES or ifd + 2 + 12 * count > len(payload):
        raise FormatError("Invalid MPF IFD entry count")
    number = None
    entry_off = entry_len = None
    for i in range(count):
        p = ifd + 2 + 12 * i
        tag = _u16(payload, p, bo)
        cnt = _u32(payload, p + 4, bo)
        if tag == TAG_COUNT:
            number = _u32(payload, p + 8, bo)
        elif tag == TAG_ENTRY:
            entry_len = cnt
            entry_off = _u32(payload, p + 8, bo) if cnt > 4 else p + 8
    if number is None or entry_off is None or entry_len is None:
        raise FormatError("MPF index lacks NumberOfImages or MPEntry")
    if number == 0 or number > 256 or entry_len != 16 * number:
        raise FormatError("Inconsistent MPF NumberOfImages / MPEntry size")
    if entry_off + entry_len > len(payload):
        raise FormatError("MPF entry table outside segment")
    entries = []
    for i in range(number):
        p = entry_off + 16 * i
        entries.append(MPEntry(_u32(payload, p, bo), _u32(payload, p + 4, bo),
                               _u32(payload, p + 8, bo), _u16(payload, p + 12, bo),
                               _u16(payload, p + 14, bo), p))
    return MPFIndex(bo, entries)


def patch(payload: bytes, index: MPFIndex, sizes_offsets: list[tuple[int, int]]) -> bytes:
    if len(sizes_offsets) != len(index.entries):
        raise FormatError("MPF patch needs one (size, offset) per entry")
    out = bytearray(payload)
    endian = _BIG if index.byte_order == ">" else _LITTLE
    for entry, (size, offset) in zip(index.entries, sizes_offsets):
        out[entry.field_pos + 4:entry.field_pos + 8] = size.to_bytes(4, endian)
        out[entry.field_pos + 8:entry.field_pos + 12] = offset.to_bytes(4, endian)
    return bytes(out)


def updated(index: MPFIndex, sizes_offsets: list[tuple[int, int]]) -> MPFIndex:
    return MPFIndex(index.byte_order, [replace(e, size=s, offset=o)
                                       for e, (s, o) in zip(index.entries, sizes_offsets)])


def minimal_length(count: int) -> int:
    return 8 + 2 + 3 * 12 + 4 + 16 * count


def build_minimal(attributes: list[int], sizes_offsets: list[tuple[int, int]],
                  byte_order: str = ">") -> bytes:
    endian = _BIG if byte_order == ">" else _LITTLE

    def u16(v: int) -> bytes:
        return v.to_bytes(2, endian)

    def u32(v: int) -> bytes:
        return v.to_bytes(4, endian)

    n = len(attributes)
    entry_off = 8 + 2 + 3 * 12 + 4
    out = bytearray(b"MM\x00*" if byte_order == ">" else b"II*\x00")
    out += u32(8) + u16(3)
    out += u16(TAG_VERSION) + u16(7) + u32(4) + b"0100"
    out += u16(TAG_COUNT) + u16(4) + u32(1) + u32(n)
    out += u16(TAG_ENTRY) + u16(7) + u32(16 * n) + u32(entry_off)
    out += u32(0)
    for attr, (size, offset) in zip(attributes, sizes_offsets):
        out += u32(attr) + u32(size) + u32(offset) + u16(0) + u16(0)
    assert len(out) == minimal_length(n)
    return bytes(out)
