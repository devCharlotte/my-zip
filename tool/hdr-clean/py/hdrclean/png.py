from __future__ import annotations

import struct
import zlib
from dataclasses import dataclass

from . import exif as exif_mod
from . import model, xmp
from .errors import MAX_SEGMENTS, FormatError, LimitError, UnsafeOperationError, ValidationError

SIGNATURE = b"\x89PNG\r\n\x1a\n"
COLOR_CHUNKS = (b"iCCP", b"sRGB", b"gAMA", b"cHRM", b"cICP", b"mDCv", b"cLLi", b"sBIT")
TEXT_CHUNKS = (b"tEXt", b"zTXt", b"iTXt")
XMP_KEYWORD = b"XML:com.adobe.xmp"
_SOFTWARE_KEYWORDS = {b"Software"}
_TEXT_KEYWORDS = {b"Comment", b"Description", b"Author", b"Title", b"Source", b"Disclaimer", b"Warning"}
MAX_TEXT_INFLATE = 16 * 1024 * 1024


@dataclass(frozen=True)
class Chunk:
    type: bytes
    start: int
    end: int

    def data(self, raw: bytes) -> bytes:
        return raw[self.start + 8:self.end - 4]


def chunk_bytes(ctype: bytes, payload: bytes) -> bytes:
    return (struct.pack(">I", len(payload)) + ctype + payload
            + struct.pack(">I", zlib.crc32(ctype + payload) & 0xFFFFFFFF))


def chunks(raw: bytes) -> list[Chunk]:
    if not raw.startswith(SIGNATURE):
        raise FormatError("Not a PNG (missing signature)")
    pos = 8
    out: list[Chunk] = []
    n = len(raw)
    while pos < n:
        if len(out) > MAX_SEGMENTS:
            raise LimitError("Too many PNG chunks")
        if pos + 12 > n:
            raise FormatError("Truncated PNG chunk")
        size = int.from_bytes(raw[pos:pos + 4], "big")
        typ = raw[pos + 4:pos + 8]
        if size > 0x7FFFFFFF:
            raise FormatError("PNG chunk length exceeds 2^31-1")
        if not all(65 <= x <= 90 or 97 <= x <= 122 for x in typ):
            raise FormatError("Invalid PNG chunk name")
        end = pos + 12 + size
        if end > n:
            raise FormatError("Truncated PNG chunk data")
        if zlib.crc32(raw[pos + 4:end - 4]) & 0xFFFFFFFF != int.from_bytes(raw[end - 4:end], "big"):
            raise FormatError(f"PNG CRC mismatch in {typ.decode('ascii')} chunk at offset {pos}")
        out.append(Chunk(typ, pos, end))
        pos = end
        if typ == b"IEND":
            break
    if not out or out[0].type != b"IHDR" or out[-1].type != b"IEND":
        raise FormatError("Malformed PNG chunk sequence (IHDR/IEND)")
    if pos != n:
        raise FormatError(f"{n - pos} bytes of data after PNG IEND")
    if not any(c.type == b"IDAT" for c in out):
        raise FormatError("PNG has no IDAT")
    return out


@dataclass(frozen=True)
class Header:
    width: int
    height: int
    bit_depth: int
    color_type: int
    interlace: int

    @property
    def channels(self) -> int:
        return {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[self.color_type]


def header(raw: bytes, chs: list[Chunk]) -> Header:
    d = chs[0].data(raw)
    if len(d) != 13:
        raise FormatError("Invalid IHDR length")
    w, h, bd, ct, comp, filt, il = struct.unpack(">IIBBBBB", d)
    if w == 0 or h == 0 or ct not in (0, 2, 3, 4, 6) or comp or filt or il not in (0, 1):
        raise FormatError("Invalid IHDR values")
    return Header(w, h, bd, ct, il)


def parse_text(ctype: bytes, data: bytes) -> tuple[bytes, str | None, bool]:
    nul = data.find(b"\x00")
    if nul <= 0:
        return b"", None, False
    key = data[:nul]
    try:
        if ctype == b"tEXt":
            return key, data[nul + 1:].decode("latin-1"), False
        if ctype == b"zTXt":
            return key, _inflate(data[nul + 2:]).decode("latin-1"), True
        flag = data[nul + 1]
        rest = data[nul + 3:]
        lang_end = rest.find(b"\x00")
        tk_end = rest.find(b"\x00", lang_end + 1)
        if lang_end < 0 or tk_end < 0:
            return key, None, bool(flag)
        body = rest[tk_end + 1:]
        if flag:
            body = _inflate(body)
        return key, body.decode("utf-8"), bool(flag)
    except (zlib.error, UnicodeDecodeError, LimitError):
        return key, None, False


def _inflate(data: bytes) -> bytes:
    d = zlib.decompressobj()
    out = d.decompress(data, MAX_TEXT_INFLATE)
    if d.unconsumed_tail:
        raise LimitError("Compressed PNG text too large")
    return out


def rebuild_itxt(data: bytes, new_text: str) -> bytes:
    nul = data.find(b"\x00")
    flag = data[nul + 1]
    rest = data[nul + 3:]
    lang_end = rest.find(b"\x00")
    tk_end = rest.find(b"\x00", lang_end + 1)
    body = new_text.encode("utf-8")
    if flag:
        body = zlib.compress(body, 9)
    return data[:nul + 3] + rest[:tk_end + 1] + body


class PngDoc:
    format = "png"

    def __init__(self, raw: bytes) -> None:
        self.raw = raw
        self.chunks = chunks(raw)
        self.header = header(raw, self.chunks)
        self.items: list[model.Item] = []
        self.notes: list[str] = []
        self._scan()

    def _scan(self) -> None:
        from . import c2pa as c2pa_mod

        raw = self.raw
        cab = [c for c in self.chunks if c.type == b"caBX"]
        for i, c in enumerate(cab):
            data = c.data(raw)
            summary = c2pa_mod.summarize_store(data)
            ev = c2pa_mod.evidence(summary)
            self.items.append(model.Item(
                f"c2pa:{i}", "c2pa", "C2PA manifest store", f"PNG caBX chunk @{c.start}",
                f"{len(data)} bytes", ev, ref={"chunks": [c], "summary": summary}))
        for i, c in enumerate(self.chunks):
            if c.type == b"eXIf":
                try:
                    tiff = exif_mod.parse(c.data(raw))
                except FormatError as exc:
                    self.notes.append(f"eXIf chunk unreadable: {exc}")
                    continue
                items, notes = model.scan_exif(tiff, f"PNG eXIf @{c.start}", f"exif{i}")
                for it in items:
                    it.ref = {"chunk": c, "field": it.ref}
                self.items += items
                self.notes += notes
            elif c.type in TEXT_CHUNKS:
                key, text, _ = parse_text(c.type, c.data(raw))
                loc = f"PNG {c.type.decode()} '{key.decode('latin-1')}' @{c.start}"
                if text is None:
                    self.notes.append(f"{loc}: text could not be decoded")
                    continue
                if key == XMP_KEYWORD:
                    items, notes = model.scan_xmp(text, loc, f"xmp{i}", editable=c.type == b"iTXt")
                    for it in items:
                        it.ref = {"chunk": c, "field": it.ref, "text": text}
                    self.items += items
                    self.notes += notes
                elif key in _SOFTWARE_KEYWORDS:
                    self.items.append(model.Item(
                        f"text{i}:{key.decode()}", "software-tags", f"PNG text {key.decode()}", loc,
                        text[:200], model.evidence_for(text, "png_text", f"PNG {key.decode()}"),
                        ref={"chunk": c, "drop": True}))
                elif key in _TEXT_KEYWORDS:
                    ev = model.evidence_for(text, "text_mention", f"PNG {key.decode()}")
                    if ev:
                        self.items.append(model.Item(f"text{i}:{key.decode()}", "text-mention",
                                                     f"PNG text {key.decode()}", loc, text[:200], ev,
                                                     ref={"chunk": c, "drop": True}))

    def hdr_info(self) -> dict:
        present = [c.type.decode() for c in self.chunks if c.type in COLOR_CHUNKS]
        info: dict = {"structures": present, "bit_depth": self.header.bit_depth}
        cicp = next((c for c in self.chunks if c.type == b"cICP"), None)
        if cicp:
            d = cicp.data(self.raw)
            if len(d) == 4:
                info["cicp"] = {"primaries": d[0], "transfer": d[1], "matrix": d[2], "full_range": d[3]}
                info["kind"] = [{16: "pq", 18: "hlg"}.get(d[1], "cicp")]
        info.setdefault("kind", ["no_gain_map"])
        info["protected_structures"] = [f"{t} chunk" for t in present] + ["IDAT (pixel data)"]
        return info

    def apply(self, selected: list[model.Item]) -> bytes:
        raw = self.raw
        drop: set[int] = set()
        replace: dict[int, bytes] = {}
        exif_edits: dict[int, list[exif_mod.Field]] = {}
        xmp_edits: dict[int, list] = {}
        for it in selected:
            ref = it.ref
            if it.category == "c2pa":
                drop.update(c.start for c in ref["chunks"])
            elif ref.get("drop"):
                drop.add(ref["chunk"].start)
            elif isinstance(ref.get("field"), exif_mod.Field):
                exif_edits.setdefault(ref["chunk"].start, []).append(ref["field"])
            elif isinstance(ref.get("field"), xmp.XmpField):
                xmp_edits.setdefault(ref["chunk"].start, []).append(ref)
            else:
                raise UnsafeOperationError(f"No PNG edit rule for {it.id}")
        for c in self.chunks:
            if c.start in exif_edits:
                buf = bytearray(c.data(raw))
                for f in exif_edits[c.start]:
                    exif_mod.blank_value(buf, f)
                replace[c.start] = chunk_bytes(c.type, bytes(buf))
            if c.start in xmp_edits:
                refs = xmp_edits[c.start]
                text = refs[0]["text"]
                new_text = xmp.blank_spans(text, [r["field"].span for r in refs])
                replace[c.start] = chunk_bytes(c.type, rebuild_itxt(c.data(raw), new_text))
        out = bytearray(SIGNATURE)
        for c in self.chunks:
            if c.start in drop:
                continue
            out += replace.get(c.start, raw[c.start:c.end])
        result = bytes(out)
        self._verify(result, drop, set(replace))
        return result

    def _verify(self, result: bytes, dropped: set[int], replaced: set[int]) -> None:
        new = chunks(result)
        kept = [c for c in self.chunks if c.start not in dropped]
        if [c.type for c in kept] != [c.type for c in new]:
            raise ValidationError("PNG chunk sequence changed unexpectedly")
        for old, nw in zip(kept, new):
            if old.start in replaced:
                if old.type in (b"IDAT", b"IHDR") or old.type in COLOR_CHUNKS:
                    raise ValidationError("Protected PNG chunk was modified")
                continue
            if self.raw[old.start:old.end] != result[nw.start:nw.end]:
                raise ValidationError(f"PNG {old.type.decode()} chunk changed")
