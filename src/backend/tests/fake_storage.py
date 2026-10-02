"""In-memory stand-in for `app.storage.service.SpacesStorage`, injected via
the `get_storage` dependency override in `conftest.client` (and passed
directly to service calls). Records each object's bytes, content type and
public flag so tests can assert what reached the bucket."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class StoredObject:
    data: bytes
    content_type: str
    public: bool


class FakeStorage:
    def __init__(self) -> None:
        self.objects: dict[str, StoredObject] = {}

    async def put(self, key: str, data: bytes, content_type: str, *, public: bool) -> None:
        self.objects[key] = StoredObject(data, content_type, public)

    async def get(self, key: str) -> bytes:
        return self.objects[key].data

    async def delete(self, keys: list[str]) -> None:
        for key in keys:
            self.objects.pop(key, None)

    async def set_public(self, key: str, public: bool) -> None:
        self.objects[key].public = public

    def public_url(self, key: str) -> str:
        return f"https://cdn.test/{key}"

    def presigned_url(self, key: str) -> str:
        return f"https://origin.test/{key}?signed"
