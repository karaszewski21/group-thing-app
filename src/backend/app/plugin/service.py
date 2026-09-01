"""Plugin business logic: `PluginDescriptorService`, `PluginDataService`,
`PluginObjectService` equivalents (spec.md's Plugin descriptor/data/object
route groups). Follows `app/category/service.py` and `app/product/
service.py`'s function-based pattern (Groups 7/8's reference modules)
rather than a class wrapper — the `*Service` names in section comments
below are spec.md's Java terminology, ported here as function groups.
"""

from __future__ import annotations

import re
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import EntityNotFoundException
from app.product.models import Product

from . import query_service
from .models import PluginDescriptor, PluginObject

_PLUGIN_ID_PATTERN = re.compile(r"^[a-zA-Z0-9_-]+$")
_URL_PATTERN = re.compile(r"^https?://.*")

# --- PluginDescriptorService -------------------------------------------


def _validate_manifest(plugin_id: str, manifest: dict[str, Any]) -> None:
    """Verbatim messages per spec.md's manifest upload validation."""
    if not _PLUGIN_ID_PATTERN.match(plugin_id):
        raise ValueError(
            "pluginId must contain only alphanumeric characters, underscores, or hyphens"
        )

    name = manifest.get("name")
    if not isinstance(name, str) or not name.strip():
        raise ValueError("Manifest must contain a non-blank 'name' field")

    url = manifest.get("url")
    if url is not None and not (isinstance(url, str) and _URL_PATTERN.match(url)):
        raise ValueError("Manifest 'url' must be an HTTP(S) URL")


async def upsert_manifest(
    db: AsyncSession, plugin_id: str, manifest: dict[str, Any]
) -> PluginDescriptor:
    _validate_manifest(plugin_id, manifest)

    descriptor = await db.get(PluginDescriptor, plugin_id)
    if descriptor is None:
        descriptor = PluginDescriptor(
            id=plugin_id,
            name=manifest["name"],
            version=manifest.get("version"),
            url=manifest.get("url"),
            description=manifest.get("description"),
            enabled=True,
            manifest=manifest,
        )
        db.add(descriptor)
    else:
        # Upsert on an existing plugin: refresh descriptor fields and the
        # manifest blob, but leave `enabled` untouched (only the dedicated
        # PATCH /enabled route changes that flag).
        descriptor.name = manifest["name"]
        descriptor.version = manifest.get("version")
        descriptor.url = manifest.get("url")
        descriptor.description = manifest.get("description")
        descriptor.manifest = manifest
    await db.commit()
    await db.refresh(descriptor)
    return descriptor


async def list_enabled_plugins(db: AsyncSession) -> list[PluginDescriptor]:
    result = await db.execute(select(PluginDescriptor).where(PluginDescriptor.enabled.is_(True)))
    return list(result.scalars().all())


async def get_plugin(db: AsyncSession, plugin_id: str) -> PluginDescriptor:
    """Plain find — returns even if disabled. Used only by plain `GET
    /api/plugins/{pluginId}` and the management routes (delete/enable),
    which must operate on a disabled plugin too; everything else uses
    `find_enabled_or_throw` below."""
    descriptor = await db.get(PluginDescriptor, plugin_id)
    if descriptor is None:
        raise EntityNotFoundException("Plugin", plugin_id)
    return descriptor


async def find_enabled_or_throw(db: AsyncSession, plugin_id: str) -> PluginDescriptor:
    """Disabled plugin -> same 404 as nonexistent (indistinguishable),
    exactly `EntityNotFoundException("Plugin", pluginId)` either way."""
    descriptor = await db.get(PluginDescriptor, plugin_id)
    if descriptor is None or not descriptor.enabled:
        raise EntityNotFoundException("Plugin", plugin_id)
    return descriptor


async def delete_plugin(db: AsyncSession, plugin_id: str) -> None:
    descriptor = await get_plugin(db, plugin_id)
    await db.delete(descriptor)
    await db.commit()


async def set_enabled(db: AsyncSession, plugin_id: str, enabled: bool) -> PluginDescriptor:
    descriptor = await get_plugin(db, plugin_id)
    descriptor.enabled = enabled
    await db.commit()
    await db.refresh(descriptor)
    return descriptor


# --- PluginDataService ---------------------------------------------------


async def _require_product(db: AsyncSession, product_id: int) -> Product:
    product = await db.get(Product, product_id)
    if product is None:
        raise EntityNotFoundException("Product", product_id)
    return product


async def get_plugin_data(db: AsyncSession, plugin_id: str, product_id: int) -> dict[str, Any]:
    await find_enabled_or_throw(db, plugin_id)
    product = await _require_product(db, product_id)
    plugin_data = product.plugin_data or {}
    return dict(plugin_data.get(plugin_id, {}))


async def replace_plugin_data(
    db: AsyncSession, plugin_id: str, product_id: int, data: dict[str, Any]
) -> dict[str, Any]:
    """Confirmed REPLACE-at-key semantics (fixed decision #5): copy the
    existing `plugin_data` map, whole-blob-overwrite the `pluginId` key,
    save. Response echoes back the **input** `data`, never the freshly
    persisted map — a sibling plugin's data at a different key is
    untouched (a fresh dict copy is assigned so SQLAlchemy's change
    tracking notices the mutation)."""
    await find_enabled_or_throw(db, plugin_id)
    product = await _require_product(db, product_id)
    updated = dict(product.plugin_data or {})
    updated[plugin_id] = data
    product.plugin_data = updated
    await db.commit()
    return data


async def delete_plugin_data(db: AsyncSession, plugin_id: str, product_id: int) -> None:
    await find_enabled_or_throw(db, plugin_id)
    product = await _require_product(db, product_id)
    if product.plugin_data and plugin_id in product.plugin_data:
        updated = dict(product.plugin_data)
        del updated[plugin_id]
        product.plugin_data = updated
        await db.commit()


# --- PluginObjectService --------------------------------------------------


def _require_both_entity_fields(entity_type: str | None, entity_id: int | None) -> None:
    """Cross-type listing: both `entityType`/`entityId` are mandatory
    together (neither is truly optional here, despite the query-string
    `?` in spec.md's route table)."""
    if entity_type is None or entity_id is None:
        raise ValueError("Both entityType and entityId are required for cross-type listing")


def _require_paired_entity_fields(entity_type: str | None, entity_id: int | None) -> None:
    """Per-type listing and object PUT: both-or-neither — distinct message
    from the cross-type case above."""
    if (entity_type is None) != (entity_id is None):
        raise ValueError("Both entityType and entityId must be provided together or both absent")


async def list_cross_type_objects(
    db: AsyncSession,
    plugin_id: str,
    *,
    entity_type: str | None,
    entity_id: int | None,
    filter_expr: str | None,
    limit: int,
) -> list[PluginObject]:
    await find_enabled_or_throw(db, plugin_id)
    _require_both_entity_fields(entity_type, entity_id)
    return await query_service.list_plugin_objects(
        db,
        plugin_id=plugin_id,
        object_type=None,
        entity_type=entity_type,
        entity_id=entity_id,
        filter_expr=filter_expr,
        limit=limit,
    )


async def list_per_type_objects(
    db: AsyncSession,
    plugin_id: str,
    object_type: str,
    *,
    entity_type: str | None,
    entity_id: int | None,
    filter_expr: str | None,
    limit: int,
) -> list[PluginObject]:
    await find_enabled_or_throw(db, plugin_id)
    _require_paired_entity_fields(entity_type, entity_id)
    return await query_service.list_plugin_objects(
        db,
        plugin_id=plugin_id,
        object_type=object_type,
        entity_type=entity_type,
        entity_id=entity_id,
        filter_expr=filter_expr,
        limit=limit,
    )


async def _get_object_or_throw(
    db: AsyncSession, plugin_id: str, object_type: str, object_id: str
) -> PluginObject:
    result = await db.execute(
        select(PluginObject).where(
            PluginObject.plugin_id == plugin_id,
            PluginObject.object_type == object_type,
            PluginObject.object_id == object_id,
        )
    )
    obj = result.scalar_one_or_none()
    if obj is None:
        raise EntityNotFoundException("PluginObject", f"{object_type}/{object_id}")
    return obj


async def get_object(
    db: AsyncSession, plugin_id: str, object_type: str, object_id: str
) -> PluginObject:
    await find_enabled_or_throw(db, plugin_id)
    return await _get_object_or_throw(db, plugin_id, object_type, object_id)


async def put_object(
    db: AsyncSession,
    plugin_id: str,
    object_type: str,
    object_id: str,
    data: dict[str, Any],
    *,
    entity_type: str | None,
    entity_id: int | None,
) -> PluginObject:
    await find_enabled_or_throw(db, plugin_id)
    _require_paired_entity_fields(entity_type, entity_id)

    result = await db.execute(
        select(PluginObject).where(
            PluginObject.plugin_id == plugin_id,
            PluginObject.object_type == object_type,
            PluginObject.object_id == object_id,
        )
    )
    obj = result.scalar_one_or_none()
    if obj is None:
        obj = PluginObject(
            plugin_id=plugin_id,
            object_type=object_type,
            object_id=object_id,
            data=data,
            entity_type=entity_type,
            entity_id=entity_id,
        )
        db.add(obj)
    else:
        obj.data = data
        obj.entity_type = entity_type
        obj.entity_id = entity_id
    await db.commit()
    await db.refresh(obj)
    return obj


async def delete_object(db: AsyncSession, plugin_id: str, object_type: str, object_id: str) -> None:
    await find_enabled_or_throw(db, plugin_id)
    obj = await _get_object_or_throw(db, plugin_id, object_type, object_id)
    await db.delete(obj)
    await db.commit()
