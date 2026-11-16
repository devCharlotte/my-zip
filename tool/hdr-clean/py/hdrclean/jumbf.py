from __future__ import annotations

from dataclasses import dataclass, field

from .errors import MAX_BOX_DEPTH, FormatError, LimitError

UUID_SUFFIX = bytes.fromhex("00110010800000aa00389b71")
C2PA_STORE_UUID = b"c2pa" + UUID_SUFFIX
C2PA_MANIFEST_UUID = b"c2ma" + UUID_SUFFIX
C2PA_UPDATE_MANIFEST_UUID = b"c2um" + UUID_SUFFIX
C2PA_CLAIM_UUID = b"c2cl" + UUID_SUFFIX
C2PA_ASSERTIONS_UUID = b"c2as" + UUID_SUFFIX
C2PA_SIGNATURE_UUID = b"c2cs" + UUID_SUFFIX
CBOR_UUID = b"cbor" + UUID_SUFFIX
JSON_UUID = b"json" + UUID_SUFFIX


@dataclass
class Box:
    type: bytes
    payload: bytes
    label: str | None = None
    uuid: bytes | None = None
    children: list[Box] = field(default_factory=list)

    @property
    def is_superbox(self) -> bool:
        return self.type == b"jumb"

    def content(self) -> list[Box]:
        return [c for c in self.children if c.type != b"jumd"]

    def find(self, label: str) -> Box | None:
        for c in self.children:
            if c.label == label:
                return c
        return None


def iter_boxes(data: bytes, start: int = 0, end: int | None = None):
    pos = start
    end = len(data) if end is None else end
    while pos < end:
        if pos + 8 > end:
            raise FormatError("Truncated JUMBF box header")
        lbox = int.from_bytes(data[pos:pos + 4], "big")
        tbox = data[pos + 4:pos + 8]
        hdr = 8
        if lbox == 1:
            if pos + 16 > end:
                raise FormatError("Truncated JUMBF XLBox")
            lbox = int.from_bytes(data[pos + 8:pos + 16], "big")
            hdr = 16
        elif lbox == 0:
            lbox = end - pos
        if lbox < hdr or pos + lbox > end:
            raise FormatError("Invalid JUMBF box length")
        yield tbox, data[pos + hdr:pos + lbox], pos, pos + lbox
        pos += lbox


def parse_box(tbox: bytes, payload: bytes, depth: int = 0) -> Box:
    if depth > MAX_BOX_DEPTH:
        raise LimitError("JUMBF nesting too deep")
    box = Box(tbox, payload if tbox != b"jumb" else b"")
    if tbox != b"jumb":
        return box
    children = []
    for ctype, cpayload, _, _ in iter_boxes(payload):
        if ctype == b"jumd":
            if len(cpayload) < 17:
                raise FormatError("Truncated JUMBF description box")
            box.uuid = cpayload[:16]
            toggles = cpayload[16]
            if toggles & 0x02:
                nul = cpayload.find(b"\x00", 17)
                if nul < 0:
                    raise FormatError("Unterminated JUMBF label")
                box.label = cpayload[17:nul].decode("utf-8", "replace")
            children.append(Box(ctype, cpayload))
        else:
            children.append(parse_box(ctype, cpayload, depth + 1))
    if not children or children[0].type != b"jumd":
        raise FormatError("JUMBF superbox without description box")
    box.children = children
    return box


def parse(data: bytes) -> list[Box]:
    return [parse_box(t, p) for t, p, _, _ in iter_boxes(data)]


@dataclass
class App11Group:
    instance: bytes
    segments: list[tuple[int, int]]
    data: bytes
    complete: bool
    problem: str | None = None


def reassemble_app11(payloads: list[tuple[int, int, bytes]]) -> list[App11Group]:
    groups: dict[bytes, list[tuple[int, int, int, bytes]]] = {}
    for start, end, body in payloads:
        if len(body) < 8 or body[:2] != b"JP":
            continue
        groups.setdefault(body[2:4], []).append((int.from_bytes(body[4:8], "big"), start, end, body[8:]))
    out = []
    for en, parts in groups.items():
        parts.sort(key=lambda p: p[0])
        seq = [p[0] for p in parts]
        problem = None
        if seq != list(range(1, len(parts) + 1)):
            problem = f"APP11 packet sequence is {seq}, expected 1..{len(parts)}"
        first = parts[0][3]
        data = bytearray(first)
        for _, _, _, body in parts[1:]:
            hdr = 16 if body[:4] == b"\x00\x00\x00\x01" else 8
            if len(body) < hdr or body[4:8] != first[4:8]:
                problem = problem or "APP11 continuation header does not repeat the box header"
                data += body
                continue
            data += body[hdr:]
        complete = False
        if len(data) >= 8:
            lbox = int.from_bytes(data[:4], "big")
            if lbox == 1 and len(data) >= 16:
                lbox = int.from_bytes(data[8:16], "big")
            complete = lbox == len(data)
            if not complete and problem is None:
                problem = f"Reassembled JUMBF length {len(data)} != declared {lbox}"
        out.append(App11Group(en, [(p[1], p[2]) for p in parts], bytes(data), complete, problem))
    return out


def looks_like_c2pa(data: bytes) -> bool:
    try:
        boxes = parse(data)
    except (FormatError, LimitError):
        return C2PA_STORE_UUID in data[:64]
    return any(b.type == b"jumb" and b.uuid == C2PA_STORE_UUID for b in boxes)
