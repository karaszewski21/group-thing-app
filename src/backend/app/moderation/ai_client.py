"""HTTP client of the VPS B image moderation endpoint (`POST
/v1/moderate/image`, ShieldGemma-2). VPS B returns only scores; the
thresholds and the decision stay here (`service.decide_photo`). Any
transport error, non-2xx status or incomplete response raises, which the
worker counts as a failed attempt."""

from __future__ import annotations

import base64
import logging
import time
from typing import Any

import httpx

from .classifiers import IMAGE_CATEGORIES, ImageModerationResult

logger = logging.getLogger(__name__)

MODERATE_IMAGE_PATH = "/v1/moderate/image"


class ImageModerationError(Exception):
    """VPS B answered 2xx with a body that is not a complete score set."""


def _parse(body: Any) -> ImageModerationResult:
    if not isinstance(body, dict):
        raise ImageModerationError("response is not a JSON object")
    model = body.get("model")
    scores = body.get("scores")
    if not isinstance(model, str) or not isinstance(scores, dict):
        raise ImageModerationError("response lacks `model` or `scores`")
    parsed: dict[str, float] = {}
    for category in IMAGE_CATEGORIES:
        value = scores.get(category)
        if isinstance(value, bool) or not isinstance(value, int | float):
            raise ImageModerationError(f"response lacks a numeric `{category}` score")
        parsed[category] = float(value)
    return ImageModerationResult(model=model, scores=parsed)


class HttpxImageModerationClient:
    def __init__(
        self,
        base_url: str,
        token: str,
        timeout: float,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._base_url = base_url
        self._token = token
        self._timeout = timeout
        self._transport = transport

    async def moderate(self, image: bytes) -> ImageModerationResult:
        body = {"image_base64": base64.b64encode(image).decode("ascii")}
        started = time.monotonic()
        try:
            async with httpx.AsyncClient(
                base_url=self._base_url, timeout=self._timeout, transport=self._transport
            ) as http:
                response = await http.post(
                    MODERATE_IMAGE_PATH,
                    json=body,
                    headers={"Authorization": f"Bearer {self._token}"},
                )
        finally:
            logger.info("VPS B image moderation call took %.2f s", time.monotonic() - started)
        response.raise_for_status()
        return _parse(response.json())
