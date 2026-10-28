"""`POST /api/conversations/item` get-or-create (spec requirement 12's exact
check order: unknown 404 → own item 409 → existing 200 → deleted 404 →
limiter 429 → insert 201) and `GET /api/conversations/{id}` access for
ITEM threads (asker or owner only, 404 before 403). The thread is keyed by
the item's *current permanent* owner, so an ownership change opens a new
thread while the old one stays readable for its two parties."""

from __future__ import annotations

import uuid
from datetime import datetime

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.circulation.models import InventoryItem
from app.messaging.application.send_limiter import limiter
from app.messaging.infrastructure import repository
from app.messaging.models import Conversation
from app.users.models import UserProfile
from tests.conftest import leaf_category_ids

CONVERSATION_KEYS = {
    "id",
    "kind",
    "title",
    "item",
    "counterpart_name",
    "group_name",
    "term_occurs_on",
    "unread_count",
    "read_only_reason",
    "participant_count",
}


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _register(client: AsyncClient, email: str) -> tuple[str, uuid.UUID]:
    response = await client.post(
        "/api/auth/register", json={"role": "GUEST", "email": email, "password": "secret123"}
    )
    assert response.status_code == 201, response.text
    return response.json()["token"], uuid.UUID(response.json()["party_id"])


async def _create_inventory(client: AsyncClient, token: str) -> uuid.UUID:
    response = await client.post(
        "/api/inventories",
        json={"inventory_type": "PERSONAL", "location": None},
        headers=_auth(token),
    )
    assert response.status_code == 201, response.text
    return uuid.UUID(response.json()["id"])


async def _create_item(
    client: AsyncClient, token: str, inventory_id: uuid.UUID, name: str
) -> uuid.UUID:
    product = await client.post(
        "/api/products/resolve",
        json={"name": name, "category_id": (await leaf_category_ids(client, _auth(token)))[0]},
        headers=_auth(token),
    )
    assert product.status_code == 200, product.text
    item = await client.post(
        "/api/inventory-items",
        json={
            "inventory_id": str(inventory_id),
            "product_id": product.json()["id"],
            "condition": "GOOD",
        },
        headers=_auth(token),
    )
    assert item.status_code == 201, item.text
    return uuid.UUID(item.json()["id"])


async def _open(client: AsyncClient, token: str, item_id: uuid.UUID | str) -> tuple[int, dict]:
    response = await client.post(
        "/api/conversations/item", json={"item_id": str(item_id)}, headers=_auth(token)
    )
    return response.status_code, response.json()


async def _display_name(db_session: AsyncSession, party_id: uuid.UUID) -> str:
    return (
        await db_session.execute(
            select(UserProfile.display_name).where(UserProfile.party_id == party_id)
        )
    ).scalar_one()


async def _update_item(db_session: AsyncSession, item_id: uuid.UUID, **values: object) -> None:
    item = await db_session.get(InventoryItem, item_id)
    assert item is not None
    for key, value in values.items():
        setattr(item, key, value)
    await db_session.commit()


async def test_openItemConversation_newThenExisting_returns201Then200WithAccessRules(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner_token, owner_party_id = await _register(client, "ic.basic.owner@example.com")
    asker_token, asker_party_id = await _register(client, "ic.basic.asker@example.com")
    outsider_token, _ = await _register(client, "ic.basic.outsider@example.com")
    item_id = await _create_item(
        client, owner_token, await _create_inventory(client, owner_token), "Ic gitara"
    )

    created_status, created = await _open(client, asker_token, item_id)
    reopened_status, reopened = await _open(client, asker_token, item_id)
    own_status, own = await _open(client, owner_token, item_id)
    unknown_status, _ = await _open(client, asker_token, uuid.uuid4())

    assert created_status == 201, created
    assert reopened_status == 200 and reopened["id"] == created["id"]
    assert own_status == 409 and own["message"] == "Nie możesz zapytać o własną rzecz"
    assert unknown_status == 404
    assert set(created) == CONVERSATION_KEYS
    assert set(created["item"]) == {"id", "name", "deleted"}
    assert created["kind"] == "ITEM" and created["title"] == "Ic gitara"
    assert created["item"] == {"id": str(item_id), "name": "Ic gitara", "deleted": False}
    assert created["counterpart_name"] == await _display_name(db_session, owner_party_id)
    assert created["group_name"] is None and created["term_occurs_on"] is None
    assert created["participant_count"] is None and created["read_only_reason"] is None
    assert created["unread_count"] == 0

    by_owner = await client.get(f"/api/conversations/{created['id']}", headers=_auth(owner_token))
    by_outsider = await client.get(
        f"/api/conversations/{created['id']}", headers=_auth(outsider_token)
    )
    missing = await client.get(f"/api/conversations/{uuid.uuid4()}", headers=_auth(owner_token))

    assert by_owner.status_code == 200, by_owner.text
    assert set(by_owner.json()) == CONVERSATION_KEYS
    assert by_owner.json()["counterpart_name"] == await _display_name(db_session, asker_party_id)
    assert by_outsider.status_code == 403
    assert missing.status_code == 404


async def test_openItemConversation_lentOutItem_resolvesPermanentOwner(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner_token, owner_party_id = await _register(client, "ic.lent.owner@example.com")
    borrower_token, _ = await _register(client, "ic.lent.borrower@example.com")
    owner_inventory = await _create_inventory(client, owner_token)
    item_id = await _create_item(client, owner_token, owner_inventory, "Ic rowerek")
    await _update_item(
        db_session,
        item_id,
        home_inventory_id=owner_inventory,
        inventory_id=await _create_inventory(client, borrower_token),
    )

    borrower_status, borrower_view = await _open(client, borrower_token, item_id)
    owner_status, _ = await _open(client, owner_token, item_id)

    assert borrower_status == 201, borrower_view
    assert borrower_view["counterpart_name"] == await _display_name(db_session, owner_party_id)
    assert owner_status == 409


async def test_openItemConversation_deletedItem_404WithoutThreadAnd200WithThread(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner_token, _ = await _register(client, "ic.deleted.owner@example.com")
    asker_token, _ = await _register(client, "ic.deleted.asker@example.com")
    late_token, _ = await _register(client, "ic.deleted.late@example.com")
    item_id = await _create_item(
        client, owner_token, await _create_inventory(client, owner_token), "Ic bęben"
    )
    created_status, created = await _open(client, asker_token, item_id)
    assert created_status == 201, created
    await _update_item(db_session, item_id, deleted_at=datetime.utcnow())

    late_status, _ = await _open(client, late_token, item_id)
    reopened_status, reopened = await _open(client, asker_token, item_id)
    own_status, _ = await _open(client, owner_token, item_id)

    assert late_status == 404
    assert reopened_status == 200 and reopened["id"] == created["id"]
    assert reopened["item"]["deleted"] is True
    assert own_status == 409


async def test_openItemConversation_ownershipChange_opensNewThreadAndOldStaysReadable(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    first_owner_token, first_owner_party_id = await _register(client, "ic.give.first@example.com")
    new_owner_token, new_owner_party_id = await _register(client, "ic.give.new@example.com")
    asker_token, _ = await _register(client, "ic.give.asker@example.com")
    item_id = await _create_item(
        client, first_owner_token, await _create_inventory(client, first_owner_token), "Ic flet"
    )
    _, old_thread = await _open(client, asker_token, item_id)
    await _update_item(
        db_session, item_id, inventory_id=await _create_inventory(client, new_owner_token)
    )

    new_status, new_thread = await _open(client, asker_token, item_id)
    first_owner_status, _ = await _open(client, first_owner_token, item_id)
    old_by_asker = await client.get(
        f"/api/conversations/{old_thread['id']}", headers=_auth(asker_token)
    )
    old_by_first_owner = await client.get(
        f"/api/conversations/{old_thread['id']}", headers=_auth(first_owner_token)
    )
    old_by_new_owner = await client.get(
        f"/api/conversations/{old_thread['id']}", headers=_auth(new_owner_token)
    )

    assert new_status == 201 and new_thread["id"] != old_thread["id"]
    assert new_thread["counterpart_name"] == await _display_name(db_session, new_owner_party_id)
    assert first_owner_status == 201
    assert old_by_asker.status_code == 200
    assert old_by_asker.json()["counterpart_name"] == await _display_name(
        db_session, first_owner_party_id
    )
    assert old_by_first_owner.status_code == 200
    assert old_by_new_owner.status_code == 403


async def test_openItemConversation_raceLoser_reselectsWinnerWith200AndRecordsNothing(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner_token, _ = await _register(client, "ic.race.owner@example.com")
    asker_token, asker_party_id = await _register(client, "ic.race.asker@example.com")
    inventory_id = await _create_inventory(client, owner_token)
    raced_item = await _create_item(client, owner_token, inventory_id, "Ic bębenek")
    next_item = await _create_item(client, owner_token, inventory_id, "Ic grzechotka")
    winner_status, winner = await _open(client, asker_token, raced_item)
    for _ in range(18):
        limiter.record_new_conversation(asker_party_id)
    real_find = repository.find_item_conversation
    calls: list[None] = []

    async def find_missing_the_winner_once(
        db: AsyncSession, item_id: uuid.UUID, asker: uuid.UUID, owner: uuid.UUID
    ) -> Conversation | None:
        calls.append(None)
        return None if len(calls) == 1 else await real_find(db, item_id, asker, owner)

    monkeypatch.setattr(repository, "find_item_conversation", find_missing_the_winner_once)
    loser_status, loser = await _open(client, asker_token, raced_item)
    monkeypatch.undo()
    twentieth_status, _ = await _open(client, asker_token, next_item)
    threads = await db_session.execute(
        select(func.count()).select_from(Conversation).where(Conversation.item_id == raced_item)
    )

    assert winner_status == 201, winner
    assert loser_status == 200, loser
    assert loser["id"] == winner["id"]
    assert threads.scalar_one() == 1
    assert twentieth_status == 201


async def test_openItemConversation_atNewConversationLimit_newIs429AndReopenIs200(
    client: AsyncClient,
) -> None:
    owner_token, _ = await _register(client, "ic.limit.owner@example.com")
    asker_token, asker_party_id = await _register(client, "ic.limit.asker@example.com")
    inventory_id = await _create_inventory(client, owner_token)
    first_item = await _create_item(client, owner_token, inventory_id, "Ic klocki")
    second_item = await _create_item(client, owner_token, inventory_id, "Ic puzzle")
    first_status, first = await _open(client, asker_token, first_item)
    for _ in range(19):
        limiter.record_new_conversation(asker_party_id)

    limited = await client.post(
        "/api/conversations/item", json={"item_id": str(second_item)}, headers=_auth(asker_token)
    )
    reopened_status, reopened = await _open(client, asker_token, first_item)

    assert first_status == 201
    assert limited.status_code == 429, limited.text
    assert limited.json()["message"].startswith("Za dużo nowych rozmów")
    assert "Retry-After" in limited.headers
    assert reopened_status == 200 and reopened["id"] == first["id"]
