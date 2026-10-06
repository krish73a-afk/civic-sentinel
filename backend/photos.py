"""Local evidence storage. Firestore holds references; image bytes remain on disk."""
from io import BytesIO
from pathlib import Path
from uuid import UUID, uuid4
import os
import warnings
from PIL import Image, ImageOps, UnidentifiedImageError
from fastapi import HTTPException

PHOTO_DIR = Path(__file__).resolve().parent / "uploads"
Image.MAX_IMAGE_PIXELS = 25_000_000


def photo_path(incident_id):
    try:
        canonical_id = str(UUID(incident_id))
    except (ValueError, TypeError):
        raise HTTPException(422, "Invalid incident ID.")
    return PHOTO_DIR / f"{canonical_id}.jpg"


def prepare_photo(data):
    if not data or len(data) > 10 * 1024 * 1024:
        raise HTTPException(400, "Provide a JPG, PNG or WebP image up to 10 MB.")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(data)) as original:
                if original.format not in ("JPEG", "PNG", "WEBP"):
                    raise HTTPException(400, "Only genuine JPG, PNG and WebP images are supported.")
                original.load()
                oriented = ImageOps.exif_transpose(original)
                oriented.thumbnail((2048, 2048))
                # Copy pixels into a fresh image so EXIF, GPS and other metadata are omitted.
                rgba = oriented.convert("RGBA")
                clean = Image.new("RGB", rgba.size, "white")
                clean.paste(rgba, mask=rgba.getchannel("A"))
                output = BytesIO()
                clean.save(output, format="JPEG", quality=88)
                return output.getvalue()
    except HTTPException:
        raise
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise HTTPException(400, "The image is corrupt, unsupported or too large to decode safely.")


def store_photo(incident_id, data):
    target = photo_path(incident_id)
    PHOTO_DIR.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(f".{target.stem}-{uuid4()}.tmp")
    try:
        temporary.write_bytes(data)
        os.replace(temporary, target)
    finally:
        temporary.unlink(missing_ok=True)
    return photo_metadata(incident_id)


def photo_metadata(incident_id):
    target = photo_path(incident_id)
    if not target.is_file():
        return None
    return {"storage": "LOCAL", "content_type": "image/jpeg", "size_bytes": target.stat().st_size,
            "url": f"/incidents/{str(UUID(incident_id))}/photo"}
