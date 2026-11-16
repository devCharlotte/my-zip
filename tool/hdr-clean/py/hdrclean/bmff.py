from __future__ import annotations

from dataclasses import dataclass, field

from . import c2pa as c2pa_mod
from . import exif as exif_mod
from . import model, xmp
from .errors import MAX_BOX_DEPTH, MAX_SEGMENTS, FormatError, LimitError, UnsafeOperationError, ValidationError

C2PA_BMFF_UUID = bytes.fromhex("d8fec3d61b0e483c92975828877ec481")
CONTAINER_BOXES = {b"meta": 4, b"iprp": 0, b"ipco": 0, b"dinf": 0, b"iref": 4}
APPLE_GAINMAP = "urn:com:apple:photo:2020:aux:hdrgainmap"


@dataclass
class Box:
    type: bytes
    start: int
    header: int
    end: int
    usertype: bytes | None = None
    children: list[Box] = field(default_factory=list)

    @property
    def body(self) -> int:
        return self.start + self.header


def read_boxes(raw: bytes, start: int, end: int, depth: int = 0, counter: list[int] | None = None) -> list[Box]:
    if depth > MAX_BOX_DEPTH:
        raise LimitError("BMFF nesting too deep")
    counter = counter if counter is not None else [0]
    out = []
    pos = start
    while pos < end:
        counter[0] += 1
        if counter[0] > MAX_SEGMENTS:
            raise LimitError("Too many BMFF boxes")
        if pos + 8 > end:
            raise FormatError("Truncated BMFF box header")
        size = int.from_bytes(raw[pos:pos + 4], "big")
        typ = raw[pos + 4:pos + 8]
        hdr = 8
        if size == 1:
            if pos + 16 > end:
                raise FormatError("Truncated BMFF largesize")
            size = int.from_bytes(raw[pos + 8:pos + 16], "big")
            hdr = 16
        elif size == 0:
            size = end - pos
        if size < hdr or pos + size > end:
            raise FormatError(f"Invalid BMFF box size for {typ!r} at {pos}")
        box = Box(typ, pos, hdr, pos + size)
        if typ == b"uuid":
            if hdr + 16 > size:
                raise FormatError("Truncated uuid box")
            box.usertype = raw[pos + hdr:pos + hdr + 16]
            box.header += 16
        if typ in CONTAINER_BOXES:
            skip = CONTAINER_BOXES[typ]
            box.children = read_boxes(raw, box.body + skip, box.end, depth + 1, counter)
        elif typ == b"iinf":
            version = raw[box.body] if box.body < box.end else 0
            skip = 4 + (2 if version == 0 else 4)
            box.children = read_boxes(raw, box.body + skip, box.end, depth + 1, counter)
        out.append(box)
        pos += size
    return out


def _cstr(raw: bytes, pos: int, end: int) -> tuple[str, int]:
    nul = raw.find(b"\x00", pos, end)
    if nul < 0:
        return raw[pos:end].decode("utf-8", "replace"), end
    return raw[pos:nul].decode("utf-8", "replace"), nul + 1


@dataclass
class ItemLoc:
    method: int
    dref: int
    base: int
    extents: list[tuple[int, int]]


class HeifDoc:
    format = "heif"

    def __init__(self, raw: bytes) -> None:
        self.raw = raw
        if len(raw) < 12 or raw[4:8] != b"ftyp":
            raise FormatError("Not an ISO BMFF file (no ftyp)")
        self.boxes = read_boxes(raw, 0, len(raw))
        ftyp = self.boxes[0]
        self.brands = [raw[i:i + 4].decode("latin-1") for i in range(ftyp.body, ftyp.end, 4) if i + 4 <= ftyp.end]
        self.items: list[model.Item] = []
        self.notes: list[str] = []
        self.item_types: dict[int, tuple[str, str]] = {}
        self.locations: dict[int, ItemLoc] = {}
        self.aux_types: list[str] = []
        self.colr: list[dict] = []
        meta = [b for b in self.boxes if b.type == b"meta"]
        if len(meta) == 1:
            self._parse_meta(meta[0])
        elif not meta:
            self.notes.append("No top-level meta box (not a HEIF still image?)")
        else:
            raise FormatError("Multiple top-level meta boxes")
        for i, b in enumerate(self.boxes):
            if b.type == b"uuid" and b.usertype == C2PA_BMFF_UUID:
                self._scan_c2pa(i, b)
        self._scan_items()

    def _parse_meta(self, meta: Box) -> None:
        raw = self.raw
        for b in meta.children:
            if b.type == b"iinf":
                for infe in b.children:
                    if infe.type != b"infe":
                        continue
                    v = raw[infe.body]
                    p = infe.body + 4
                    if v < 2:
                        continue
                    iid = int.from_bytes(raw[p:p + (2 if v == 2 else 4)], "big")
                    p += 2 if v == 2 else 4
                    p += 2
                    itype = raw[p:p + 4].decode("latin-1")
                    p += 4
                    _, p = _cstr(raw, p, infe.end)
                    ctype = ""
                    if itype == "mime":
                        ctype, p = _cstr(raw, p, infe.end)
                    self.item_types[iid] = (itype, ctype)
            elif b.type == b"iloc":
                self._parse_iloc(b)
            elif b.type == b"iprp":
                for ipco in b.children:
                    for prop in ipco.children:
                        if prop.type == b"auxC":
                            s, _ = _cstr(raw, prop.body + 4, prop.end)
                            self.aux_types.append(s)
                        elif prop.type == b"colr" and raw[prop.body:prop.body + 4] == b"nclx":
                            d = raw[prop.body + 4:prop.body + 11]
                            if len(d) == 7:
                                self.colr.append({"primaries": int.from_bytes(d[0:2], "big"),
                                                  "transfer": int.from_bytes(d[2:4], "big"),
                                                  "matrix": int.from_bytes(d[4:6], "big")})

    def _parse_iloc(self, b: Box) -> None:
        raw = self.raw
        p = b.body
        v = raw[p]
        p += 4
        if p + 2 > b.end:
            raise FormatError("Truncated iloc")
        osz, lsz = raw[p] >> 4, raw[p] & 15
        bsz, isz = raw[p + 1] >> 4, raw[p + 1] & 15
        p += 2
        if any(x not in (0, 4, 8) for x in (osz, lsz, bsz)) or (v in (1, 2) and isz not in (0, 4, 8)):
            raise FormatError("Invalid iloc field sizes")

        def rd(n: int) -> int:
            nonlocal p
            if p + n > b.end:
                raise FormatError("Truncated iloc entry")
            val = int.from_bytes(raw[p:p + n], "big") if n else 0
            p += n
            return val

        count = rd(2 if v < 2 else 4)
        if count > 100_000:
            raise LimitError("Too many iloc items")
        for _ in range(count):
            iid = rd(2 if v < 2 else 4)
            method = rd(2) & 15 if v in (1, 2) else 0
            dref = rd(2)
            base = rd(bsz)
            ext = []
            for _ in range(rd(2)):
                if v in (1, 2) and isz:
                    rd(isz)
                ext.append((rd(osz), rd(lsz)))
            self.locations[iid] = ItemLoc(method, dref, base, ext)

    def item_span(self, iid: int) -> tuple[int, int] | None:
        loc = self.locations.get(iid)
        if loc is None or loc.method != 0 or loc.dref != 0 or len(loc.extents) != 1:
            return None
        off, ln = loc.extents[0]
        start = loc.base + off
        if ln == 0 or start + ln > len(self.raw):
            return None
        return start, start + ln

    def _scan_c2pa(self, i: int, b: Box) -> None:
        raw = self.raw
        p = b.body + 4
        purpose, p = _cstr(raw, p, b.end)
        if purpose == "manifest":
            p += 8
        data = raw[p:b.end]
        summary = c2pa_mod.summarize_store(data)
        self.items.append(model.Item(f"c2pa:{i}", "c2pa", "C2PA manifest store",
                                     f"top-level uuid box @{b.start} (purpose={purpose})",
                                     f"{b.end - b.start} bytes", c2pa_mod.evidence(summary),
                                     ref={"box": b, "summary": summary}))

    def _scan_items(self) -> None:
        raw = self.raw
        for iid, (itype, ctype) in sorted(self.item_types.items()):
            is_exif = itype == "Exif"
            is_xmp = itype == "mime" and "rdf+xml" in ctype
            if not (is_exif or is_xmp):
                continue
            span = self.item_span(iid)
            loc = f"HEIF item {iid} ({'Exif' if is_exif else 'XMP'})"
            if span is None:
                self.notes.append(f"{loc}: stored in a way this tool does not edit (idat/multi-extent)")
                continue
            data = raw[span[0]:span[1]]
            if is_exif:
                if len(data) < 4:
                    continue
                skip = 4 + int.from_bytes(data[:4], "big")
                try:
                    tiff = exif_mod.parse(data[skip:])
                except FormatError as exc:
                    self.notes.append(f"{loc}: EXIF unreadable ({exc})")
                    continue
                items, notes = model.scan_exif(tiff, loc, f"exif{iid}")
                for it in items:
                    it.ref = {"base": span[0] + skip, "field": it.ref}
            else:
                try:
                    text, editable = data.decode("utf-8").rstrip("\x00"), True
                except UnicodeDecodeError:
                    text, editable = xmp.decode_packet(data), False
                items, notes = model.scan_xmp(text, loc, f"xmp{iid}", editable=editable)
                for it in items:
                    it.ref = {"start": span[0], "field": it.ref, "text": text}
            self.items += items
            self.notes += notes

    def hdr_info(self) -> dict:
        kinds = []
        types = {t for t, _ in self.item_types.values()}
        if "tmap" in types:
            kinds.append("iso_21496_1_tmap")
        if APPLE_GAINMAP in self.aux_types:
            kinds.append("apple_gainmap")
        for c in self.colr:
            if c["transfer"] in (16, 18):
                kinds.append({16: "pq", 18: "hlg"}[c["transfer"]])
        return {"kind": kinds or ["no_gain_map_detected"], "brands": self.brands,
                "item_types": sorted(types), "aux_types": self.aux_types, "nclx": self.colr,
                "protected_structures": ["all image items, iloc/iinf/iprp/iref and mdat (never moved)"]}

    def apply(self, selected: list[model.Item]) -> bytes:
        buf = bytearray(self.raw)
        allowed: list[tuple[int, int]] = []
        xmp_groups: dict[int, list] = {}
        for it in selected:
            ref = it.ref
            if it.category == "c2pa":
                b: Box = ref["box"]
                if b not in self.boxes:
                    raise UnsafeOperationError("Only top-level C2PA boxes are neutralized")
                buf[b.start + 4:b.start + 8] = b"free"
                hdr = b.header - 16
                buf[b.start + hdr:b.end] = bytes(b.end - b.start - hdr)
                allowed.append((b.start, b.end))
            elif isinstance(ref.get("field"), exif_mod.Field):
                f = ref["field"]
                pos = ref["base"] + f.value_pos
                buf[pos:pos + f.byte_len] = bytes(f.byte_len)
                allowed.append((pos, pos + f.byte_len))
            elif isinstance(ref.get("field"), xmp.XmpField):
                xmp_groups.setdefault(ref["start"], []).append(ref)
            else:
                raise UnsafeOperationError(f"No HEIF edit rule for {it.id}")
        for start, refs in xmp_groups.items():
            new = xmp.blank_spans(refs[0]["text"], [r["field"].span for r in refs]).encode("utf-8")
            buf[start:start + len(new)] = new
            allowed.append((start, start + len(new)))
        result = bytes(buf)
        if len(result) != len(self.raw):
            raise ValidationError("HEIF length changed")
        pos = 0
        for a, b2 in sorted(allowed) + [(len(result), len(result))]:
            if a > pos and self.raw[pos:a] != result[pos:a]:
                raise ValidationError("HEIF bytes outside the selected metadata changed")
            pos = max(pos, b2)
        again = HeifDoc(result)
        if again.locations != self.locations or again.item_types != self.item_types:
            raise ValidationError("HEIF item table changed")
        return result
