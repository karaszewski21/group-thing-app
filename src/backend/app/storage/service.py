"""Object storage for user-uploaded files: DigitalOcean Spaces through its
S3 API. Objects are written private and made `public-read` (served by the
CDN) only once their content is approved. boto3 is blocking, so every call
runs in a worker thread."""

from __future__ import annotations

import asyncio
from functools import lru_cache
from typing import Protocol

import boto3
from botocore.config import Config

from app.config import settings

__all__ = ["ObjectStorage", "SpacesStorage", "get_storage"]

# Keys are never overwritten (a new upload gets a new key), so objects can be
# cached forever; a takedown flips the ACL back to private.
_CACHE_CONTROL = "public, max-age=31536000, immutable"
PRESIGNED_URL_SECONDS = 600


class ObjectStorage(Protocol):
    async def put(self, key: str, data: bytes, content_type: str, *, public: bool) -> None: ...

    async def get(self, key: str) -> bytes: ...

    async def delete(self, keys: list[str]) -> None: ...

    async def set_public(self, key: str, public: bool) -> None: ...

    def public_url(self, key: str) -> str: ...

    def presigned_url(self, key: str) -> str: ...


class SpacesStorage:
    def __init__(
        self,
        *,
        endpoint_url: str,
        region: str,
        bucket: str,
        key: str,
        secret: str,
        public_base_url: str,
    ) -> None:
        self._bucket = bucket
        self._public_base_url = public_base_url.rstrip("/")
        self._client = boto3.client(
            "s3",
            endpoint_url=endpoint_url,
            region_name=region,
            aws_access_key_id=key,
            aws_secret_access_key=secret,
            # boto3 >= 1.36 sends CRC checksums by default, which S3-compatible
            # stores like Spaces reject; only send them when an API requires it.
            config=Config(
                signature_version="s3v4",
                s3={"addressing_style": "virtual"},
                request_checksum_calculation="when_required",
                response_checksum_validation="when_required",
            ),
        )

    async def put(self, key: str, data: bytes, content_type: str, *, public: bool) -> None:
        await asyncio.to_thread(
            self._client.put_object,
            Bucket=self._bucket,
            Key=key,
            Body=data,
            ContentType=content_type,
            CacheControl=_CACHE_CONTROL,
            ACL="public-read" if public else "private",
        )

    async def get(self, key: str) -> bytes:
        response = await asyncio.to_thread(self._client.get_object, Bucket=self._bucket, Key=key)
        return await asyncio.to_thread(response["Body"].read)

    async def delete(self, keys: list[str]) -> None:
        if not keys:
            return
        await asyncio.to_thread(
            self._client.delete_objects,
            Bucket=self._bucket,
            Delete={"Objects": [{"Key": key} for key in keys], "Quiet": True},
        )

    async def set_public(self, key: str, public: bool) -> None:
        await asyncio.to_thread(
            self._client.put_object_acl,
            Bucket=self._bucket,
            Key=key,
            ACL="public-read" if public else "private",
        )

    def public_url(self, key: str) -> str:
        return f"{self._public_base_url}/{key}"

    def presigned_url(self, key: str) -> str:
        # Signed against the origin endpoint: the CDN does not serve private objects.
        return str(
            self._client.generate_presigned_url(
                "get_object",
                Params={"Bucket": self._bucket, "Key": key},
                ExpiresIn=PRESIGNED_URL_SECONDS,
            )
        )


@lru_cache(maxsize=1)
def _spaces_storage() -> SpacesStorage:
    return SpacesStorage(
        endpoint_url=str(settings.spaces_endpoint_url),
        region=str(settings.spaces_region),
        bucket=str(settings.spaces_bucket),
        key=str(settings.spaces_key),
        secret=str(settings.spaces_secret),
        public_base_url=str(settings.spaces_public_base_url),
    )


def get_storage() -> ObjectStorage | None:
    """FastAPI dependency; `None` while the `SPACES_*` settings are unset
    (photo upload disabled). Tests override it with an in-memory fake."""
    return _spaces_storage() if settings.photo_storage_configured else None
