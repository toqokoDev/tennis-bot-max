"""Shared font loading for bracket images (Cyrillic-safe)."""

from __future__ import annotations

import os
import sys
from functools import lru_cache
from typing import List, Optional, Tuple

from PIL import ImageFont

from .paths import FONTS_DIR


def _candidate_paths(regular: bool) -> List[str]:
    """Ordered list of font files that support Cyrillic."""
    if regular:
        bundled = [
            str(FONTS_DIR / "DejaVuSans.ttf"),
            str(FONTS_DIR / "Circe-Regular.ttf"),
            str(FONTS_DIR / "Circe.ttf"),
        ]
        win = [
            r"C:\Windows\Fonts\arial.ttf",
            r"C:\Windows\Fonts\segoeui.ttf",
            r"C:\Windows\Fonts\tahoma.ttf",
            r"C:\Windows\Fonts\calibri.ttf",
        ]
        linux = [
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
            "/usr/share/fonts/truetype/freefont/FreeSans.ttf",
            "/usr/share/fonts/TTF/DejaVuSans.ttf",
        ]
        bare = ["arial.ttf", "DejaVuSans.ttf", "LiberationSans-Regular.ttf"]
    else:
        bundled = [
            str(FONTS_DIR / "DejaVuSans-Bold.ttf"),
            str(FONTS_DIR / "Circe-Bold.ttf"),
        ]
        win = [
            r"C:\Windows\Fonts\arialbd.ttf",
            r"C:\Windows\Fonts\segoeuib.ttf",
            r"C:\Windows\Fonts\tahomabd.ttf",
            r"C:\Windows\Fonts\calibrib.ttf",
        ]
        linux = [
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
            "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
            "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf",
            "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
        ]
        bare = ["arialbd.ttf", "DejaVuSans-Bold.ttf", "LiberationSans-Bold.ttf"]

    paths: List[str] = []
    paths.extend(bundled)
    if sys.platform.startswith("win"):
        paths.extend(win)
    else:
        paths.extend(linux)
        paths.extend(win)  # WSL may see Windows fonts via /mnt/c — not listed here
    paths.extend(bare)
    return paths


def _supports_cyrillic(font: ImageFont.ImageFont) -> bool:
    try:
        mask = font.getmask("Ж")
        bbox = mask.getbbox()
        return bool(bbox)
    except Exception:
        return False


@lru_cache(maxsize=32)
def load_font(size: int, bold: bool = False) -> ImageFont.ImageFont:
    """Load a TrueType font that can render Cyrillic. Never returns bitmap default if possible."""
    for path in _candidate_paths(regular=not bold):
        if not path or (os.path.isabs(path) and not os.path.exists(path)):
            continue
        try:
            font = ImageFont.truetype(path, size)
            if _supports_cyrillic(font):
                return font
        except Exception:
            continue

    # Last resort: any truetype that opens, even without glyph check
    for path in _candidate_paths(regular=not bold):
        try:
            return ImageFont.truetype(path, size)
        except Exception:
            continue

    return ImageFont.load_default()


def load_font_pair(size: int) -> Tuple[ImageFont.ImageFont, ImageFont.ImageFont]:
    """Return (regular, bold) fonts of the given size."""
    regular = load_font(size, bold=False)
    bold = load_font(size, bold=True)
    return regular, bold


def load_bracket_fonts(
    *,
    title: int = 18,
    body: int = 18,
    header: int = 18,
    cell: int = 24,
    small: int = 16,
) -> dict:
    """Common font set for round-robin / text images."""
    return {
        "title": load_font(title, bold=True),
        "subtitle": load_font(body, bold=False),
        "header": load_font(header, bold=True),
        "cell": load_font(cell, bold=False),
        "small": load_font(small, bold=False),
    }
