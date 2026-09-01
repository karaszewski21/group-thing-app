"""`/api/plugins` routes (spec.md's API Route Spec, Plugin descriptor /
data / object sections) — 3 route groups in one router. Follows
`app/product/router.py`'s pattern (Group 8's reference module).

Permission matrix (spec.md rows 14-24): GET -> `READ`; PUT/DELETE on
objects and data -> `EDIT`; manifest/enabled/delete on the descriptor
itself -> `PLUGIN_MANAGEMENT`. Deliberately **no** `mcp:*` bridge anywhere
in this module (unlike category/product) — do not add one.
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import Principal, require_any
from app.db import get_db

from . import service
from .schemas import (
    PluginObjectResponse,
    PluginResponse,
    SetEnabledRequest,
    plugin_response_from_descriptor,
)

router = APIRouter(prefix="/api/plugins", tags=["plugins"])

DbSession = Annotated[AsyncSession, Depends(get_db)]
ReadPrincipal = Annotated[Principal, Depends(require_any("READ"))]
EditPrincipal = Annotated[Principal, Depends(require_any("EDIT"))]
ManagementPrincipal = Annotated[Principal, Depends(require_any("PLUGIN_MANAGEMENT"))]

EntityType = Annotated[str | None, Query(alias="entityType")]
EntityId = Annotated[int | None, Query(alias="entityId")]


# --- Plugin descriptor -----------------------------------------------------


@router.put("/{plugin_id}/manifest", response_model=PluginResponse)
async def upload_manifest(
    plugin_id: str, manifest: dict[str, Any], db: DbSession, principal: ManagementPrincipal
) -> PluginResponse:
    descriptor = await service.upsert_manifest(db, plugin_id, manifest)
    return plugin_response_from_descriptor(descriptor)


@router.get("", response_model=list[PluginResponse])
async def list_plugins(db: DbSession, principal: ReadPrincipal) -> list[PluginResponse]:
    """Enabled-only listing."""
    descriptors = await service.list_enabled_plugins(db)
    return [plugin_response_from_descriptor(descriptor) for descriptor in descriptors]


@router.get("/{plugin_id}", response_model=PluginResponse)
async def get_plugin(plugin_id: str, db: DbSession, principal: ReadPrincipal) -> PluginResponse:
    """Plain find — returns even if disabled (not `findEnabledOrThrow`)."""
    descriptor = await service.get_plugin(db, plugin_id)
    return plugin_response_from_descriptor(descriptor)


@router.delete("/{plugin_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def delete_plugin(plugin_id: str, db: DbSession, principal: ManagementPrincipal) -> None:
    await service.delete_plugin(db, plugin_id)


@router.patch("/{plugin_id}/enabled", response_model=PluginResponse)
async def set_enabled(
    plugin_id: str, body: SetEnabledRequest, db: DbSession, principal: ManagementPrincipal
) -> PluginResponse:
    descriptor = await service.set_enabled(db, plugin_id, body.enabled)
    return plugin_response_from_descriptor(descriptor)


# --- Plugin data ------------------------------------------------------------


@router.get("/{plugin_id}/products/{product_id}/data")
async def get_plugin_data(
    plugin_id: str, product_id: int, db: DbSession, principal: ReadPrincipal
) -> dict[str, Any]:
    return await service.get_plugin_data(db, plugin_id, product_id)


@router.put("/{plugin_id}/products/{product_id}/data")
async def replace_plugin_data(
    plugin_id: str,
    product_id: int,
    data: dict[str, Any],
    db: DbSession,
    principal: EditPrincipal,
) -> dict[str, Any]:
    return await service.replace_plugin_data(db, plugin_id, product_id, data)


@router.delete(
    "/{plugin_id}/products/{product_id}/data",
    status_code=status.HTTP_204_NO_CONTENT,
    response_model=None,
)
async def delete_plugin_data(
    plugin_id: str, product_id: int, db: DbSession, principal: EditPrincipal
) -> None:
    await service.delete_plugin_data(db, plugin_id, product_id)


# --- Plugin objects ----------------------------------------------------------


@router.get("/{plugin_id}/objects", response_model=list[PluginObjectResponse])
async def list_cross_type_objects(
    plugin_id: str,
    db: DbSession,
    principal: ReadPrincipal,
    entity_type: EntityType = None,
    entity_id: EntityId = None,
    filter: str | None = None,
    limit: int = 1000,
) -> list[PluginObjectResponse]:
    objects = await service.list_cross_type_objects(
        db,
        plugin_id,
        entity_type=entity_type,
        entity_id=entity_id,
        filter_expr=filter,
        limit=limit,
    )
    return [PluginObjectResponse.model_validate(obj) for obj in objects]


@router.get("/{plugin_id}/objects/{object_type}", response_model=list[PluginObjectResponse])
async def list_per_type_objects(
    plugin_id: str,
    object_type: str,
    db: DbSession,
    principal: ReadPrincipal,
    entity_type: EntityType = None,
    entity_id: EntityId = None,
    filter: str | None = None,
    limit: int = 1000,
) -> list[PluginObjectResponse]:
    objects = await service.list_per_type_objects(
        db,
        plugin_id,
        object_type,
        entity_type=entity_type,
        entity_id=entity_id,
        filter_expr=filter,
        limit=limit,
    )
    return [PluginObjectResponse.model_validate(obj) for obj in objects]


@router.get("/{plugin_id}/objects/{object_type}/{object_id}", response_model=PluginObjectResponse)
async def get_object(
    plugin_id: str, object_type: str, object_id: str, db: DbSession, principal: ReadPrincipal
) -> PluginObjectResponse:
    obj = await service.get_object(db, plugin_id, object_type, object_id)
    return PluginObjectResponse.model_validate(obj)


@router.put("/{plugin_id}/objects/{object_type}/{object_id}", response_model=PluginObjectResponse)
async def put_object(
    plugin_id: str,
    object_type: str,
    object_id: str,
    data: dict[str, Any],
    db: DbSession,
    principal: EditPrincipal,
    entity_type: EntityType = None,
    entity_id: EntityId = None,
) -> PluginObjectResponse:
    obj = await service.put_object(
        db,
        plugin_id,
        object_type,
        object_id,
        data,
        entity_type=entity_type,
        entity_id=entity_id,
    )
    return PluginObjectResponse.model_validate(obj)


@router.delete(
    "/{plugin_id}/objects/{object_type}/{object_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_model=None,
)
async def delete_object(
    plugin_id: str, object_type: str, object_id: str, db: DbSession, principal: EditPrincipal
) -> None:
    await service.delete_object(db, plugin_id, object_type, object_id)
