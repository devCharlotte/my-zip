from __future__ import annotations

import struct
from dataclasses import dataclass
from typing import Any

from .errors import MAX_CBOR_DEPTH, MAX_CBOR_ITEMS, FormatError, LimitError


@dataclass(frozen=True)
class Tagged:
    tag: int
    value: Any


class _Break:
    pass


_BREAK = _Break()


class _Decoder:
    def __init__(self, data: bytes) -> None:
        self.data = data
        self.pos = 0
        self.items = 0

    def take(self, n: int) -> bytes:
        if n < 0 or self.pos + n > len(self.data):
            raise FormatError("Truncated CBOR")
        out = self.data[self.pos:self.pos + n]
        self.pos += n
        return out

    def arg(self, info: int) -> int | None:
        if info < 24:
            return info
        if info in (24, 25, 26, 27):
            return int.from_bytes(self.take(1 << (info - 24)), "big")
        if info == 31:
            return None
        raise FormatError("Invalid CBOR additional information")

    def item(self, depth: int = 0, allow_break: bool = False) -> Any:
        if depth > MAX_CBOR_DEPTH:
            raise LimitError("CBOR nesting too deep")
        self.items += 1
        if self.items > MAX_CBOR_ITEMS:
            raise LimitError("Too many CBOR items")
        ib = self.take(1)[0]
        major, info = ib >> 5, ib & 0x1F
        if major == 7:
            if info == 20:
                return False
            if info == 21:
                return True
            if info in (22, 23):
                return None
            if info == 25:
                return struct.unpack(">e", self.take(2))[0]
            if info == 26:
                return struct.unpack(">f", self.take(4))[0]
            if info == 27:
                return struct.unpack(">d", self.take(8))[0]
            if info == 31:
                if not allow_break:
                    raise FormatError("Unexpected CBOR break")
                return _BREAK
            if info < 24:
                return Tagged(-1, info)
            if info == 24:
                return Tagged(-1, self.take(1)[0])
            raise FormatError("Invalid CBOR simple value")
        n = self.arg(info)
        if n is None and major in (0, 1, 6):
            raise FormatError("Indefinite length is invalid for this CBOR major type")
        if major == 0:
            return n
        if major == 1:
            return -1 - _req(n)
        if major in (2, 3):
            if n is None:
                chunks = []
                while True:
                    part = self.item(depth + 1, allow_break=True)
                    if part is _BREAK:
                        break
                    if not isinstance(part, bytes if major == 2 else str):
                        raise FormatError("Invalid chunk in indefinite-length CBOR string")
                    chunks.append(part)
                joined = b"".join(c if isinstance(c, bytes) else c.encode() for c in chunks)
                return joined if major == 2 else joined.decode("utf-8", "replace")
            raw = self.take(n)
            return raw if major == 2 else raw.decode("utf-8", "replace")
        if major == 4:
            out = []
            if n is None:
                while (v := self.item(depth + 1, allow_break=True)) is not _BREAK:
                    out.append(v)
            else:
                if n > len(self.data) - self.pos:
                    raise FormatError("CBOR array longer than input")
                out = [self.item(depth + 1) for _ in range(n)]
            return out
        if major == 5:
            result: dict = {}
            count = 0
            while n is None or count < n:
                if n is not None and n > len(self.data) - self.pos:
                    raise FormatError("CBOR map longer than input")
                k = self.item(depth + 1, allow_break=n is None)
                if k is _BREAK:
                    break
                v = self.item(depth + 1)
                result[_hashable(k)] = v
                count += 1
            return result
        if major == 6:
            return Tagged(_req(n), self.item(depth + 1))
        raise FormatError("Invalid CBOR major type")


def _req(n: int | None) -> int:
    if n is None:
        raise FormatError("Indefinite length is invalid here")
    return n


def _hashable(k: Any) -> Any:
    if isinstance(k, (list, dict)):
        return repr(k)
    return k


def loads(data: bytes) -> Any:
    dec = _Decoder(data)
    return dec.item()


def untag(value: Any) -> Any:
    while isinstance(value, Tagged) and value.tag >= 0:
        value = value.value
    return value
