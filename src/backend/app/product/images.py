"""Sanitizes an uploaded gallery photo before anything is stored: only a real
JPEG/PNG/WebP decodes, decompression bombs are refused, the EXIF rotation is
applied and all metadata (GPS included) is dropped by re-encoding to WebP in
two sizes. CPU-bound — callers run it in a worker thread."""

from __future__ import annotations

import hashlib
import io
import warnings
from dataclasses import dataclass

from PIL import Image, ImageOps

MAX_UPLOAD_BYTES = 15 * 1024 * 1024
_MAX_PIXELS = 50_000_000
_ALLOWED_FORMATS = ["JPEG", "PNG", "WEBP"]
LARGE_SIZE = 1600
THUMB_SIZE = 400
_WEBP_QUALITY = 80

INVALID_IMAGE_MESSAGE = "Nieobsługiwany plik — dodaj zdjęcie JPG, PNG lub WebP"
TOO_LARGE_MESSAGE = f"Zdjęcie jest za duże (maks. {MAX_UPLOAD_BYTES // (1024 * 1024)} MB)"


@dataclass(frozen=True)
class ProcessedImage:
    large: bytes
    thumb: bytes
    width: int
    height: int
    sha256: str


def _encode(image: Image.Image, size: int) -> tuple[bytes, int, int]:
    resized = ImageOps.contain(image, (size, size)) if max(image.size) > size else image
    buffer = io.BytesIO()
    # No exif=/xmp= arguments: Pillow writes no metadata unless asked to.
    resized.save(buffer, format="WEBP", quality=_WEBP_QUALITY, method=4)
    return buffer.getvalue(), resized.width, resized.height


def process_upload(data: bytes) -> ProcessedImage:
    """Raises `ValueError` with a Polish message for anything that is not a
    supported, reasonably sized image."""
    if len(data) > MAX_UPLOAD_BYTES:
        raise ValueError(TOO_LARGE_MESSAGE)
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            Image.MAX_IMAGE_PIXELS = _MAX_PIXELS
            with Image.open(io.BytesIO(data), formats=_ALLOWED_FORMATS) as opened:
                opened.load()
                image = ImageOps.exif_transpose(opened)
    except (Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
        raise ValueError(TOO_LARGE_MESSAGE) from exc
    except Exception as exc:  # any decoder failure means "not a usable image"
        raise ValueError(INVALID_IMAGE_MESSAGE) from exc

    if image.mode not in ("RGB", "RGBA"):
        image = image.convert("RGBA" if "A" in image.getbands() else "RGB")
    large, width, height = _encode(image, LARGE_SIZE)
    thumb, _, _ = _encode(image, THUMB_SIZE)
    return ProcessedImage(
        large=large,
        thumb=thumb,
        width=width,
        height=height,
        sha256=hashlib.sha256(data).hexdigest(),
    )
