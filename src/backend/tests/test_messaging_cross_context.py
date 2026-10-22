"""Public cross-context functions messaging relies on: the groups chat
audience (soft-deleted Circles included, ended memberships and withdrawn
RSVPs excluded), the batched group/term/organizer refs, `circulation.
list_item_refs` and `users.list_chat_profiles_by_party_ids` — each batched
lookup one statement for non-empty input and none for empty input."""

from __future__ import annotations

import uuid
from datetime import datetime

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from app.circulation import service as circulation_service
from app.circulation.models import InventoryItem
from app.groups import service
from app.groups.models import Group, GroupVisibility
from app.users import service as users_service
from app.users.models import UserProfile
from tests.conftest import count_queries
from tests.test_organizer_page import _circle, _in_days, _term
from tests.test_term_item_listings import _auth, _register, _resolve_product, _rsvp


async def _soft_delete_group(db_session: AsyncSession, group_id: uuid.UUID) -> datetime:
    group = await db_session.get(Group, group_id)
    assert group is not None
    group.deleted_at = datetime.utcnow()
    await db_session.commit()
    return group.deleted_at


async def _register_items(client: AsyncClient, token: str, names: list[str]) -> list[uuid.UUID]:
    inventory = await client.post(
        "/api/inventories",
        json={"inventory_type": "PERSONAL", "location": None},
        headers=_auth(token),
    )
    assert inventory.status_code == 201, inventory.text
    item_ids = []
    for name in names:
        item = await client.post(
            "/api/inventory-items",
            json={
                "inventory_id": inventory.json()["id"],
                "product_id": await _resolve_product(client, token, name),
                "condition": "GOOD",
            },
            headers=_auth(token),
        )
        assert item.status_code == 201, item.text
        item_ids.append(uuid.UUID(item.json()["id"]))
    return item_ids


async def test_isActiveGroupMemberAndOrganizer_softDeletedGroup_trueUntilMembershipEnds(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    org_token, org_party_id = await _register(client, "ORGANIZER", "mcc.member.org@example.com")
    group_id = await _circle(client, org_token, "Mcc usunięty", "PRIVATE")
    _, member_party_id = await _register(client, "GUEST", "mcc.member.guest@example.com")
    membership = await service.add_active_membership(db_session, group_id, member_party_id)
    await db_session.commit()
    await _soft_delete_group(db_session, group_id)

    assert await service.is_active_group_organizer(db_session, group_id, org_party_id) is True
    assert await service.has_active_membership(db_session, group_id, member_party_id) is True
    assert await service.has_active_membership(db_session, group_id, org_party_id) is False
    assert await service.list_group_member_party_ids(db_session, group_id) == [member_party_id]

    membership.valid_to = _in_days(0).date()
    await db_session.commit()

    assert await service.has_active_membership(db_session, group_id, member_party_id) is False
    assert await service.list_group_member_party_ids(db_session, group_id) == []


async def test_getChatAudienceForParty_allVisibilitiesAndDeleted_excludesWithdrawnAttendance(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "mcc.aud.org@example.com")
    public_group = await _circle(client, org_token, "Mcc publiczny")
    private_group = await _circle(client, org_token, "Mcc prywatny", "PRIVATE")
    attended_term = await _term(client, org_token, public_group, _in_days(3))
    withdrawn_term = await _term(client, org_token, public_group, _in_days(10))
    party_token, party_id = await _register(client, "ORGANIZER", "mcc.aud.party@example.com")
    led_group = await _circle(client, party_token, "Mcc prowadzony")
    for group_id in (public_group, private_group):
        await service.add_active_membership(db_session, group_id, party_id)
    await db_session.commit()
    await _rsvp(client, party_token, public_group, attended_term)
    withdrawn = await _rsvp(client, party_token, public_group, withdrawn_term)
    response = await client.post(
        f"/api/groups/mine/attendances/{withdrawn}/withdraw", headers=_auth(party_token)
    )
    assert response.status_code == 200, response.text
    await _soft_delete_group(db_session, led_group)
    await _soft_delete_group(db_session, private_group)

    audience = await service.get_chat_audience_for_party(db_session, party_id)

    assert led_group in audience.led_group_ids
    assert audience.member_group_ids == {public_group, private_group}
    assert audience.attended_term_ids == {attended_term}
    assert await service.list_active_attendee_party_ids(db_session, attended_term) == [party_id]
    assert await service.list_active_attendee_party_ids(db_session, withdrawn_term) == []
    assert await service.has_active_attendance(db_session, attended_term, party_id) is True
    assert await service.has_active_attendance(db_session, withdrawn_term, party_id) is False


async def test_listChatRefs_batched_returnTupleShapesInOneQueryAndNoneForEmpty(
    client: AsyncClient, db_session: AsyncSession, engine: AsyncEngine
) -> None:
    org_token, org_party_id = await _register(client, "ORGANIZER", "mcc.refs.org@example.com")
    public_group = await _circle(client, org_token, "Mcc refs publiczny")
    deleted_group = await _circle(client, org_token, "Mcc refs usunięty", "PRIVATE")
    occurs_on = _in_days(4)
    term_id = await _term(client, org_token, deleted_group, occurs_on)
    deleted_at = await _soft_delete_group(db_session, deleted_group)

    with count_queries(engine) as group_statements:
        groups = await service.list_chat_group_refs(db_session, [public_group, deleted_group])
    with count_queries(engine) as term_statements:
        terms = await service.list_chat_term_refs(db_session, [term_id])
    with count_queries(engine) as organizer_statements:
        organizers = await service.list_current_organizer_party_ids(
            db_session, [public_group, deleted_group]
        )
    with count_queries(engine) as empty_statements:
        assert await service.list_chat_group_refs(db_session, []) == {}
        assert await service.list_chat_term_refs(db_session, []) == {}
        assert await service.list_current_organizer_party_ids(db_session, []) == {}

    assert groups == {
        public_group: ("Mcc refs publiczny", GroupVisibility.PUBLIC, None),
        deleted_group: ("Mcc refs usunięty", GroupVisibility.PRIVATE, deleted_at),
    }
    assert terms == {term_id: (deleted_group, occurs_on)}
    assert organizers == {public_group: org_party_id, deleted_group: org_party_id}
    assert len(group_statements) == len(term_statements) == len(organizer_statements) == 1
    assert empty_statements == []


async def test_listItemRefs_includesSoftDeleted_queryCountIndependentOfItemCount(
    client: AsyncClient, db_session: AsyncSession, engine: AsyncEngine
) -> None:
    token, _ = await _register(client, "GUEST", "mcc.items@example.com")
    first, second, third = await _register_items(
        client, token, ["Mcc gitara", "Mcc bęben", "Mcc flet"]
    )
    item = await db_session.get(InventoryItem, third)
    assert item is not None
    item.deleted_at = datetime.utcnow()
    await db_session.commit()

    with count_queries(engine) as one_item:
        single = await circulation_service.list_item_refs(db_session, [first])
    with count_queries(engine) as three_items:
        refs = await circulation_service.list_item_refs(db_session, [first, second, third])
    with count_queries(engine) as no_items:
        assert await circulation_service.list_item_refs(db_session, []) == {}

    assert single == {first: ("Mcc gitara", None)}
    assert refs == {
        first: ("Mcc gitara", None),
        second: ("Mcc bęben", None),
        third: ("Mcc flet", item.deleted_at),
    }
    assert len(one_item) == len(three_items) == 1
    assert no_items == []


async def test_listChatProfilesByPartyIds_guestProfile_hasAccountFalse(
    client: AsyncClient, db_session: AsyncSession, engine: AsyncEngine
) -> None:
    org_token, account_party_id = await _register(client, "ORGANIZER", "mcc.profiles@example.com")
    group_id = await _circle(client, org_token, "Mcc profile")
    term_id = await _term(client, org_token, group_id, _in_days(2))
    rsvp = await client.post(
        f"/api/groups/public/{group_id}/rsvp",
        json={"term_id": str(term_id), "guardian_name": "Gość Mcc", "child_count": 1},
    )
    assert rsvp.status_code == 201, rsvp.text
    guest_party_id = (
        await db_session.execute(
            select(UserProfile.party_id).where(
                UserProfile.id == uuid.UUID(rsvp.json()["user_profile_id"])
            )
        )
    ).scalar_one()
    account_profile = await users_service.get_profile_by_party(db_session, account_party_id)

    with count_queries(engine) as statements:
        profiles = await users_service.list_chat_profiles_by_party_ids(
            db_session, [account_party_id, guest_party_id]
        )

    assert profiles == {
        account_party_id: (account_profile.display_name, True),
        guest_party_id: ("Gość Mcc", False),
    }
    assert len(statements) == 1
    assert await users_service.list_chat_profiles_by_party_ids(db_session, []) == {}
