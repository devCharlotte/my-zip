from __future__ import annotations

from dataclasses import dataclass
from fractions import Fraction
from math import gcd

from .errors import UnsafeOperationError


@dataclass(frozen=True)
class Rect:
    x: int
    y: int
    w: int
    h: int

    def as_list(self) -> list[int]:
        return [self.x, self.y, self.w, self.h]

    @classmethod
    def parse(cls, text: str) -> Rect:
        parts = [p.strip() for p in text.replace("x", ",").replace("+", ",").split(",")]
        if len(parts) != 4:
            raise ValueError("Rectangle must be 'x,y,w,h'")
        return cls(*(int(p) for p in parts))


def display_size(width: int, height: int, orientation: int) -> tuple[int, int]:
    return (height, width) if orientation in (5, 6, 7, 8) else (width, height)


def display_to_stored_point(dx: int, dy: int, w: int, h: int, orientation: int) -> tuple[int, int]:
    if orientation == 1:
        return dx, dy
    if orientation == 2:
        return w - 1 - dx, dy
    if orientation == 3:
        return w - 1 - dx, h - 1 - dy
    if orientation == 4:
        return dx, h - 1 - dy
    if orientation == 5:
        return dy, dx
    if orientation == 6:
        return dy, h - 1 - dx
    if orientation == 7:
        return w - 1 - dy, h - 1 - dx
    if orientation == 8:
        return w - 1 - dy, dx
    raise ValueError(f"Invalid EXIF orientation {orientation}")


def display_to_stored(rect: Rect, w: int, h: int, orientation: int) -> Rect:
    validate(rect, *display_size(w, h, orientation))
    a = display_to_stored_point(rect.x, rect.y, w, h, orientation)
    b = display_to_stored_point(rect.x + rect.w - 1, rect.y + rect.h - 1, w, h, orientation)
    x0, x1 = sorted((a[0], b[0]))
    y0, y1 = sorted((a[1], b[1]))
    return Rect(x0, y0, x1 - x0 + 1, y1 - y0 + 1)


def stored_to_display_point(sx: int, sy: int, w: int, h: int, orientation: int) -> tuple[int, int]:
    return {
        1: (sx, sy), 2: (w - 1 - sx, sy), 3: (w - 1 - sx, h - 1 - sy), 4: (sx, h - 1 - sy),
        5: (sy, sx), 6: (h - 1 - sy, sx), 7: (h - 1 - sy, w - 1 - sx), 8: (sy, w - 1 - sx),
    }[orientation]


def stored_to_display(rect: Rect, w: int, h: int, orientation: int) -> Rect:
    a = stored_to_display_point(rect.x, rect.y, w, h, orientation)
    b = stored_to_display_point(rect.x + rect.w - 1, rect.y + rect.h - 1, w, h, orientation)
    x0, x1 = sorted((a[0], b[0]))
    y0, y1 = sorted((a[1], b[1]))
    return Rect(x0, y0, x1 - x0 + 1, y1 - y0 + 1)


def stored_size_for_display(out_w: int, out_h: int, orientation: int) -> tuple[int, int]:
    return (out_h, out_w) if orientation in (5, 6, 7, 8) else (out_w, out_h)


def validate(rect: Rect, width: int, height: int) -> None:
    if rect.w <= 0 or rect.h <= 0:
        raise UnsafeOperationError("Crop width and height must be positive")
    if rect.x < 0 or rect.y < 0 or rect.x + rect.w > width or rect.y + rect.h > height:
        raise UnsafeOperationError(
            f"Crop {rect.as_list()} exceeds the {width}x{height} image",
            detail={"image": [width, height], "rect": rect.as_list()})


def lcm(a: int, b: int) -> int:
    return a * b // gcd(a, b)


def exact_step(full: int, gain: int) -> int:
    return full // gcd(full, gain)


def lossless_gain_step(full: int, gain: int, gain_block: int) -> int:
    ratio = Fraction(gain, full)
    g_step = lcm(gain_block, ratio.numerator)
    x = Fraction(g_step) / ratio
    if x.denominator != 1:
        x = x * x.denominator
    return int(x)


def scale_rect(rect: Rect, full: tuple[int, int], gain: tuple[int, int]) -> tuple[Fraction, ...]:
    fx = Fraction(gain[0], full[0])
    fy = Fraction(gain[1], full[1])
    return (rect.x * fx, rect.y * fy, rect.w * fx, rect.h * fy)


def snap(rect: Rect, step: tuple[int, int], width: int, height: int) -> Rect:
    sx, sy = step
    x0 = rect.x - rect.x % sx
    y0 = rect.y - rect.y % sy
    x1 = rect.x + rect.w
    y1 = rect.y + rect.h
    x1 = min(width, x1 + (-x1) % sx)
    y1 = min(height, y1 + (-y1) % sy)
    return Rect(x0, y0, x1 - x0, y1 - y0)
