"""Anti-corruption layer over `app.media`: the ONLY `app.pages` module that
imports the media vertical. It loads a party's approved public images and
exposes their response type, embedded by the party profile. It must not
import `..schemas`."""

from __future__ import annotations

from app.media.schemas import PublicMediaResponse
from app.media.service import load_public_media

__all__ = ["PublicMediaResponse", "load_public_media"]
