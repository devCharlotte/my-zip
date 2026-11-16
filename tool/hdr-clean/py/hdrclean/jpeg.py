from __future__ import annotations

from dataclasses import dataclass, field

from . import mpf as mpf_mod
from .errors import MAX_SEGMENTS, FormatError, LimitError

SOI = 0xD8
EOI = 0xD9
SOS = 0xDA
APP0 = 0xE0
APP1 = 0xE1
APP2 = 0xE2
APP11 = 0xEB
APP15 = 0xEF
STANDALONE = {0x01, SOI, EOI, *range(0xD0, 0xD8)}
SOF_MARKERS = {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}

EXIF_ID = b"Exif\x00\x00"
XMP_ID = b"http://ns.adobe.com/xap/1.0/\x00"
XMP_EXT_ID = b"http://ns.adobe.com/xmp/extension/\x00"
ICC_ID = b"ICC_PROFILE\x00"
MPF_ID = b"MPF\x00"
ISO_GAINMAP_ID = b"urn:iso:std:iso:ts:21496:-1\x00"


@dataclass(frozen=True)
class Segment:
    marker: int
    start: int
    end: int

    @property
    def has_length(self) -> bool:
        return self.marker not in STANDALONE

    @property
    def payload_start(self) -> int:
        return self.start + 4 if self.has_length else self.end

    def payload(self, raw: bytes) -> bytes:
        return raw[self.payload_start:self.end]

    @property
    def name(self) -> str:
        if 0xE0 <= self.marker <= 0xEF:
            return f"APP{self.marker - 0xE0}"
        return {0xDB: "DQT", 0xC4: "DHT", 0xDD: "DRI", 0xFE: "COM", SOI: "SOI"}.get(
            self.marker, "SOF" if self.marker in SOF_MARKERS else f"0x{self.marker:02X}")


@dataclass(frozen=True)
class FrameInfo:
    marker: int
    precision: int
    width: int
    height: int
    components: tuple[tuple[int, int, int], ...]

    @property
    def progressive(self) -> bool:
        return self.marker in (0xC2, 0xC6, 0xCA, 0xCE)

    @property
    def arithmetic(self) -> bool:
        return self.marker in (0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF)

    @property
    def imcu(self) -> tuple[int, int]:
        if len(self.components) == 1:
            return 8, 8
        return 8 * max(c[1] for c in self.components), 8 * max(c[2] for c in self.components)


@dataclass
class JpegImage:
    start: int
    end: int
    segments: list[Segment]
    sos: int
    frame: FrameInfo
    role: str = "primary"
    mpf_entry: mpf_mod.MPEntry | None = None

    def header(self, raw: bytes) -> list[tuple[Segment, bytes]]:
        return [(s, s.payload(raw)) for s in self.segments]

    def app(self, raw: bytes, marker: int, ident: bytes) -> list[Segment]:
        return [s for s in self.segments
                if s.marker == marker and raw[s.payload_start:s.end].startswith(ident)]


@dataclass
class JpegLayout:
    images: list[JpegImage]
    mpf: mpf_mod.MPFIndex | None
    mpf_segment: Segment | None
    trailing: tuple[int, int] | None
    warnings: list[str] = field(default_factory=list)

    @property
    def primary(self) -> JpegImage:
        return self.images[0]


def parse_header(raw: bytes, base: int = 0) -> tuple[list[Segment], int]:
    if raw[base:base + 2] != b"\xff\xd8":
        raise FormatError(f"Not a JPEG image at offset {base} (missing SOI)")
    pos = base + 2
    result = [Segment(SOI, base, base + 2)]
    n = len(raw)
    while pos < n:
        if len(result) > MAX_SEGMENTS:
            raise LimitError("Too many JPEG segments")
        start = pos
        if raw[pos] != 0xFF:
            raise FormatError(f"Invalid JPEG marker at offset {pos}")
        while pos < n and raw[pos] == 0xFF:
            pos += 1
        if pos >= n:
            raise FormatError("Truncated JPEG marker")
        marker = raw[pos]
        pos += 1
        if marker == SOS:
            if pos + 2 > n:
                raise FormatError("Truncated SOS")
            return result, start
        if marker == 0x00:
            raise FormatError(f"Invalid JPEG marker 0xFF00 at offset {start}")
        if marker in STANDALONE:
            if marker in (SOI, EOI):
                raise FormatError(f"Unexpected {'SOI' if marker == SOI else 'EOI'} before SOS at {start}")
            result.append(Segment(marker, start, pos))
            continue
        if pos + 2 > n:
            raise FormatError("Truncated JPEG segment length")
        length = int.from_bytes(raw[pos:pos + 2], "big")
        if length < 2 or pos + length > n:
            raise FormatError(f"Invalid JPEG segment length at offset {start}")
        result.append(Segment(marker, start, pos + length))
        pos += length
    raise FormatError("JPEG has no SOS")


def find_eoi(raw: bytes, sos: int) -> int:
    n = len(raw)
    pos = sos
    segments_seen = 0
    while pos < n:
        if raw[pos] != 0xFF or pos + 4 > n:
            raise FormatError(f"Invalid marker in JPEG frame at offset {pos}")
        marker = raw[pos + 1]
        length = int.from_bytes(raw[pos + 2:pos + 4], "big")
        if length < 2 or pos + 2 + length > n:
            raise FormatError(f"Invalid frame segment length at offset {pos}")
        pos += 2 + length
        segments_seen += 1
        if segments_seen > MAX_SEGMENTS:
            raise LimitError("Too many JPEG frame segments")
        if marker != SOS:
            continue
        while True:
            pos = raw.find(b"\xff", pos)
            if pos < 0 or pos + 1 >= n:
                raise FormatError("JPEG scan is not terminated by EOI")
            nxt = raw[pos + 1]
            if nxt == 0x00 or 0xD0 <= nxt <= 0xD7:
                pos += 2
                continue
            if nxt == 0xFF:
                pos += 1
                continue
            break
        if raw[pos + 1] == EOI:
            return pos + 2
        if raw[pos + 1] in STANDALONE:
            raise FormatError(f"Unexpected marker 0x{raw[pos + 1]:02X} in JPEG frame at {pos}")
    raise FormatError("JPEG frame is not terminated by EOI")


def frame_info(raw: bytes, segments: list[Segment]) -> FrameInfo | None:
    for seg in segments:
        if seg.marker in SOF_MARKERS:
            p = seg.payload(raw)
            if len(p) < 6:
                raise FormatError("Truncated SOF")
            ncomp = p[5]
            if len(p) < 6 + 3 * ncomp or ncomp == 0:
                raise FormatError("Invalid SOF component table")
            comps = tuple((p[6 + 3 * i], p[7 + 3 * i] >> 4, p[7 + 3 * i] & 0x0F) for i in range(ncomp))
            if any(h == 0 or v == 0 for _, h, v in comps):
                raise FormatError("Invalid SOF sampling factor")
            return FrameInfo(seg.marker, p[0], int.from_bytes(p[3:5], "big"),
                             int.from_bytes(p[1:3], "big"), comps)
    return None


def parse_image(raw: bytes, base: int) -> JpegImage:
    segments, sos = parse_header(raw, base)
    end = find_eoi(raw, sos)
    frame = frame_info(raw, segments)
    if frame is None:
        raise FormatError(f"JPEG image at offset {base} has no SOF frame header before SOS")
    if frame.width == 0 or frame.height == 0:
        raise FormatError("JPEG with zero width/height (DNL) is not supported")
    return JpegImage(base, end, segments, sos, frame)


def parse_layout(raw: bytes) -> JpegLayout:
    primary = parse_image(raw, 0)
    images = [primary]
    warnings: list[str] = []
    mpf_segs = primary.app(raw, APP2, MPF_ID)
    index = None
    mpf_seg = None
    if len(mpf_segs) > 1:
        raise FormatError("Multiple MPF segments in primary image")
    if mpf_segs:
        mpf_seg = mpf_segs[0]
        base = mpf_seg.payload_start + len(MPF_ID)
        index = mpf_mod.parse(raw[base:mpf_seg.end])
        for i, entry in enumerate(index.entries):
            if i == 0:
                if entry.offset != 0:
                    raise FormatError("MPF primary entry has non-zero offset")
                if entry.size not in (0, primary.end):
                    warnings.append(f"MPF primary size {entry.size} != codestream size {primary.end}")
                primary.mpf_entry = entry
                continue
            if entry.offset == 0 and entry.size == 0:
                warnings.append(f"MPF entry {i} is empty; ignored")
                continue
            start = base + entry.offset
            if start >= len(raw) or start + entry.size > len(raw):
                raise FormatError(f"MPF entry {i} points outside the file")
            img = parse_image(raw, start)
            if img.end - img.start != entry.size:
                raise FormatError(
                    f"MPF entry {i} size {entry.size} != codestream size {img.end - img.start}")
            img.role = "secondary"
            img.mpf_entry = entry
            images.append(img)
    spans = sorted((im.start, im.end) for im in images)
    for (_a0, a1), (b0, _b1) in zip(spans, spans[1:]):
        if b0 < a1:
            raise FormatError("MPF images overlap")
    last = spans[-1][1]
    trailing = (last, len(raw)) if last < len(raw) else None
    if trailing:
        warnings.append(f"{len(raw) - last} bytes follow the last known image (unknown trailer)")
    return JpegLayout(images, index, mpf_seg, trailing, warnings)


def make_segment(marker: int, payload: bytes) -> bytes:
    if len(payload) + 2 > 0xFFFF:
        raise FormatError(f"JPEG segment payload too large ({len(payload)} bytes)")
    return bytes((0xFF, marker)) + (len(payload) + 2).to_bytes(2, "big") + payload
