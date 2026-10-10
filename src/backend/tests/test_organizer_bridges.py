"""The organizer page's cross-module reads: the organizations ACL owner
lookup, the circulation and product bridges' batched lookups, and the
`count_queries` helper the query-budget tests rely on. Seeding goes over
HTTP plus direct `db_session` writes, as in `test_term_item_listings.py`."""

from __future__ import annotations

import uuid
from datetime import date, datetime

from httpx import AsyncClient
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from app.auth.models import User
from app.circulation.models import BalanceStatus, InventoryBalance, InventoryItem, ItemCondition
from app.groups.infrastructure import circulation_bridge, organizations_acl, product_bridge
from app.moderation.status import ModerationStatus
from app.organizations import service as organizations_service
from app.organizations.models import OrganizationMembership, OrganizationRoleType
from app.organizations.schemas import CreateOwnOrganizationRequest
from app.product.models import ProductPhoto
from tests.conftest import count_queries
from tests.test_term_item_listings import _auth, _register, _resolve_product


async def _register_items(client: AsyncClient, token: str, *product_names: str) -> list[uuid.UUID]:
    """One PERSONAL inventory (a user may only have one), one item per name."""
    inventory = await client.post(
        "/api/inventories",
        json={"inventory_type": "PERSONAL", "location": None},
        headers=_auth(token),
    )
    assert inventory.status_code == 201
    item_ids = []
    for name in product_names:
        item = await client.post(
            "/api/inventory-items",
            json={
                "inventory_id": inventory.json()["id"],
                "product_id": await _resolve_product(client, token, name),
                "condition": "GOOD",
            },
            headers=_auth(token),
        )
        assert item.status_code == 201
        item_ids.append(uuid.UUID(item.json()["id"]))
    return item_ids


async def _item(db_session: AsyncSession, item_id: uuid.UUID) -> InventoryItem:
    return (
        await db_session.execute(select(InventoryItem).where(InventoryItem.id == item_id))
    ).scalar_one()


async def _set_balance(db_session: AsyncSession, item_id: uuid.UUID, status: BalanceStatus) -> None:
    balance = (
        await db_session.execute(
            select(InventoryBalance).where(InventoryBalance.item_id == item_id)
        )
    ).scalar_one()
    balance.status = status
    await db_session.flush()


async def _uploader_id(db_session: AsyncSession) -> uuid.UUID:
    user = User(username=f"bridge-{uuid.uuid4().hex[:8]}", password_hash="x")
    db_session.add(user)
    await db_session.flush()
    return user.id


def _photo(
    product_id: uuid.UUID, user_id: uuid.UUID, key: str, status: ModerationStatus, sort_order: int
) -> ProductPhoto:
    return ProductPhoto(
        product_id=product_id,
        storage_key=key,
        width=40,
        height=30,
        size_bytes=100,
        content_sha256=key.ljust(64, "0")[:64],
        status=status,
        uploaded_by_user_id=user_id,
        sort_order=sort_order,
    )


async def test_getOwnerPartyId_activeOwner_returnsPartyAndNoneOnceMembershipEnds(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    _, owner_party_id = await _register(client, "ORGANIZER", "bridge-owner@example.com")
    organization = await organizations_service.create_own_organization(
        db_session, owner_party_id, CreateOwnOrganizationRequest(name="Mostek Org")
    )

    assert await organizations_acl.get_owner_party_id(db_session, organization.id) == owner_party_id
    found = await organizations_acl.get_organization_by_slug(db_session, organization.slug)
    assert found is not None and found.id == organization.id

    membership = (
        await db_session.execute(
            select(OrganizationMembership).where(
                OrganizationMembership.to_organization_id == organization.id
            )
        )
    ).scalar_one()
    membership.valid_to = date.today()
    await db_session.flush()

    assert await organizations_acl.get_owner_party_id(db_session, organization.id) is None


async def test_getOwnerPartyId_twoActiveOwners_returnsEarliestMembershipOwner(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    _, owner_party_id = await _register(client, "ORGANIZER", "bridge-first-owner@example.com")
    _, second_party_id = await _register(client, "ORGANIZER", "bridge-second-owner@example.com")
    organization = await organizations_service.create_own_organization(
        db_session, owner_party_id, CreateOwnOrganizationRequest(name="Dwóch Właścicieli")
    )
    second_role = await organizations_service.get_or_create_active_organization_role(
        db_session, second_party_id, OrganizationRoleType.OWNER
    )
    db_session.add(
        OrganizationMembership(
            from_role_id=second_role.id,
            to_organization_id=organization.id,
            valid_from=date.today(),
            valid_to=None,
        )
    )
    await db_session.flush()

    assert await organizations_acl.get_owner_party_id(db_session, organization.id) == owner_party_id


async def test_listAvailableItemsWithProduct_onlyLiveAvailableItems_returnsViews(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token, _ = await _register(client, "GUEST", "bridge-items@example.com")
    available_id, reserved_id, deleted_id = await _register_items(
        client, token, "Mostek rower", "Mostek hulajnoga", "Mostek kask"
    )
    await _set_balance(db_session, reserved_id, BalanceStatus.RESERVED)
    (await _item(db_session, deleted_id)).deleted_at = datetime.now()
    await db_session.flush()
    available = await _item(db_session, available_id)

    views = await circulation_bridge.list_available_items_with_product(
        db_session, [available_id, reserved_id, deleted_id]
    )

    assert views == {
        available_id: circulation_bridge.AvailableItemView(
            item_id=available_id,
            product_id=available.product_id,
            product_name="Mostek rower",
            condition=ItemCondition.GOOD,
        )
    }


async def test_listAvailableItemsWithProduct_emptyInput_issuesNoStatements(
    engine: AsyncEngine, db_session: AsyncSession
) -> None:
    with count_queries(engine) as statements:
        views = await circulation_bridge.list_available_items_with_product(db_session, [])

    assert views == {}
    assert statements == []


async def test_firstApprovedPhotoByProduct_lowestSortOrderApprovedOnly_emptyInputNoStatements(
    client: AsyncClient, engine: AsyncEngine, db_session: AsyncSession
) -> None:
    token, _ = await _register(client, "GUEST", "bridge-photos@example.com")
    user_id = await _uploader_id(db_session)
    with_photos_item, pending_only_item = await _register_items(
        client, token, "Mostek lalka", "Mostek klocki"
    )
    with_photos = (await _item(db_session, with_photos_item)).product_id
    pending_only = (await _item(db_session, pending_only_item)).product_id
    db_session.add_all(
        [
            _photo(with_photos, user_id, "a-pending", ModerationStatus.PENDING, 0),
            _photo(with_photos, user_id, "b-second", ModerationStatus.APPROVED, 2),
            _photo(with_photos, user_id, "c-first", ModerationStatus.APPROVED, 1),
            _photo(pending_only, user_id, "d-review", ModerationStatus.NEEDS_REVIEW, 0),
        ]
    )
    await db_session.flush()

    photos = await product_bridge.first_approved_photo_by_product(
        db_session, [with_photos, pending_only]
    )

    assert set(photos) == {with_photos}
    assert photos[with_photos].storage_key == "c-first"

    with count_queries(engine) as statements:
        assert await product_bridge.first_approved_photo_by_product(db_session, []) == {}
    assert statements == []


async def test_countQueries_collectsStatementsAndSkipsSavepoints(
    engine: AsyncEngine, db_session: AsyncSession
) -> None:
    with count_queries(engine) as statements:
        async with db_session.begin_nested():
            await db_session.execute(text("SELECT 1"))
        await db_session.execute(text("SELECT 2"))

    assert statements == ["SELECT 1", "SELECT 2"]
