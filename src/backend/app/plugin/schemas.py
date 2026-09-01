"""Pydantic request/response models for the plugin descriptor/data/object
route groups (spec.md's API Route Spec, Plugin sections). Follows
`app/product/schemas.py`'s pattern (Group 8's reference module).

`PluginResponse` cannot be built with a plain `model_validate(from_attributes)`
call like `ProductResponse` — its `extension_points` field is derived from
`manifest["extensionPoints"]`, not a plain ORM attribute — so
`plugin_response_from_descriptor` below is the construction entry point
routers use instead.
"""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING, Any

from pydantic import BaseModel, ConfigDict

if TYPE_CHECKING:
    from .models import PluginDescriptor


class PluginResponse(BaseModel):
    """Field order mirrors the Java DTO: `id, name, version, url,
    description, enabled, extension_points`."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    version: str | None
    url: str | None
    description: str | None
    enabled: bool
    extension_points: list[dict[str, Any]]


def plugin_response_from_descriptor(descriptor: PluginDescriptor) -> PluginResponse:
    """`extension_points` extracted from `manifest["extensionPoints"]` if a
    list, else `[]` — per spec.md's `PluginResponse` note."""
    extension_points_raw = descriptor.manifest.get("extensionPoints")
    extension_points = extension_points_raw if isinstance(extension_points_raw, list) else []
    return PluginResponse(
        id=descriptor.id,
        name=descriptor.name,
        version=descriptor.version,
        url=descriptor.url,
        description=descriptor.description,
        enabled=descriptor.enabled,
        extension_points=extension_points,
    )


class SetEnabledRequest(BaseModel):
    enabled: bool


class PluginObjectResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    plugin_id: str
    object_type: str
    object_id: str
    data: dict[str, Any]
    entity_type: str | None
    entity_id: int | None
    created_at: datetime
    updated_at: datetime
