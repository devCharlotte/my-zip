from __future__ import annotations

import io
import math
import struct
import zlib
from dataclasses import dataclass

from .errors import MAX_PIXELS, FormatError, LimitError, UnsupportedError


def pil():
    try:
        from PIL import Image
    except ImportError as exc:
        raise UnsupportedError("Pillow is required for pixel operations (pip install Pillow)") from exc
    Image.MAX_IMAGE_PIXELS = MAX_PIXELS
    return Image


def open_image(data: bytes):
    image_mod = pil()
    try:
        im = image_mod.open(io.BytesIO(data))
        im.load()
    except image_mod.DecompressionBombError as exc:
        raise LimitError(str(exc)) from None
    except (OSError, SyntaxError, ValueError) as exc:
        raise FormatError(f"Image decoder failed: {exc}") from None
    return im


@dataclass
class Comparison:
    identical: bool
    max_abs_diff: int
    mean_abs_diff: float
    psnr_db: float | None
    interior_identical: bool | None = None
    interior_margin: int | None = None

    def to_dict(self) -> dict:
        return {k: (round(v, 4) if isinstance(v, float) else v) for k, v in self.__dict__.items()}


def compare(a, b, *, margin: int | None = None) -> Comparison:
    from PIL import ImageChops, ImageStat

    if a.size != b.size:
        raise FormatError(f"Size mismatch {a.size} vs {b.size}")
    if a.mode != b.mode:
        b = b.convert(a.mode)
    diff = ImageChops.difference(a, b)
    ext = diff.getextrema()
    bands = ext if isinstance(ext[0], tuple) else (ext,)
    mx = max(hi for _, hi in bands)
    stat = ImageStat.Stat(diff)
    mean = sum(stat.mean) / len(stat.mean)
    mse = sum(r * r for r in stat.rms) / len(stat.rms)
    psnr = None if mse == 0 else 10 * math.log10(255 * 255 / mse)
    c = Comparison(mx == 0, int(mx), mean, psnr)
    if margin is not None and a.size[0] > 2 * margin and a.size[1] > 2 * margin:
        box = (margin, margin, a.size[0] - margin, a.size[1] - margin)
        c.interior_identical = a.crop(box).tobytes() == b.crop(box).tobytes()
        c.interior_margin = margin
    return c


def _paeth(a: int, b: int, c: int) -> int:
    p = a + b - c
    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
    if pa <= pb and pa <= pc:
        return a
    return b if pb <= pc else c


def png_unfilter(data: bytes, width: int, height: int, bpp: int) -> list[bytes]:
    stride = width * bpp
    if len(data) != height * (stride + 1):
        raise FormatError("PNG image data has the wrong length")
    rows: list[bytes] = []
    prev = bytearray(stride)
    pos = 0
    for _ in range(height):
        ftype = data[pos]
        cur = bytearray(data[pos + 1:pos + 1 + stride])
        pos += stride + 1
        if ftype == 1:
            for i in range(bpp, stride):
                cur[i] = (cur[i] + cur[i - bpp]) & 0xFF
        elif ftype == 2:
            cur = bytearray((x + y) & 0xFF for x, y in zip(cur, prev))
        elif ftype == 3:
            for i in range(stride):
                left = cur[i - bpp] if i >= bpp else 0
                cur[i] = (cur[i] + ((left + prev[i]) >> 1)) & 0xFF
        elif ftype == 4:
            for i in range(stride):
                left = cur[i - bpp] if i >= bpp else 0
                ul = prev[i - bpp] if i >= bpp else 0
                cur[i] = (cur[i] + _paeth(left, prev[i], ul)) & 0xFF
        elif ftype != 0:
            raise FormatError(f"Invalid PNG filter type {ftype}")
        rows.append(bytes(cur))
        prev = cur
    return rows


def png_decode_rows(idat: bytes, width: int, height: int, bpp: int) -> list[bytes]:
    expected = height * (width * bpp + 1)
    d = zlib.decompressobj()
    try:
        data = d.decompress(idat, expected + 1)
    except zlib.error as exc:
        raise FormatError(f"PNG zlib stream invalid: {exc}") from None
    if len(data) > expected:
        raise FormatError("PNG image data longer than IHDR implies")
    return png_unfilter(data, width, height, bpp)


def png_encode_idat(rows: list[bytes], chunk_size: int = 1 << 20) -> list[bytes]:
    raw = b"".join(b"\x00" + r for r in rows)
    comp = zlib.compress(raw, 6)
    return [comp[i:i + chunk_size] for i in range(0, len(comp), chunk_size)] or [b""]


def png_ihdr(width: int, height: int, bit_depth: int, color_type: int) -> bytes:
    return struct.pack(">IIBBBBB", width, height, bit_depth, color_type, 0, 0, 0)
