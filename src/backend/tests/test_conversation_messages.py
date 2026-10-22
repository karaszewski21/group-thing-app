"""`GET/POST /api/conversations/{id}/messages` (spec requirements 17 and 18):
body validation as a plain Polish 400, the `(created_at, id)` keyset pages
with `before`/`after` cursors, the sender fields, strictly increasing
`created_at`, moderation rejection, unavailability and timeout, the
30-per-minute send limit counted per attempt, and sends
to ITEM threads after the item is deleted or changes owner."""

from __future__ import annotations

import logging
import time
import uuid
from collections.abc import Generator
from datetime import datetime
from typing import NamedTuple

import pytest
from httpx import AsyncClient, Response
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.circulation.models import InventoryItem
from app.config import settings
from app.groups import service as groups_service
from app.groups.models import Group
from app.messaging.application import messages
from app.messaging.infrastructure import repository
from app.messaging.models import Message
from app.moderation import text_guard
from app.notifications.models import Notification
from app.users.models import UserProfile

BODY_ERROR = "Wiadomość musi mieć od 1 do 1000 znaków"
MESSAGE_KEYS = {"id", "body", "created_at", "is_mine", "sender_name", "sender_is_organizer"}


class _RejectingClassifier:
    model_id = "fake/bielik-guard"

    def scores(self, text: str) -> dict[str, float]:
        return {"SEX": 1.0}


@pytest.fixture
def _restore_classifier() -> Generator[None, None, None]:
    yield
    text_guard.set_classifier(None)


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _register(client: AsyncClient, email: str, role: str = "GUEST") -> tuple[str, uuid.UUID]:
    response = await client.post(
        "/api/auth/register", json={"role": role, "email": email, "password": "secret123"}
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
    categories = await client.get("/api/categories", headers=_auth(token))
    assert categories.status_code == 200, categories.text
    product = await client.post(
        "/api/products/resolve",
        json={"name": name, "category_id": categories.json()[0]["id"]},
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


class _Thread(NamedTuple):
    owner_token: str
    asker_token: str
    asker_party_id: uuid.UUID
    id: str
    item_id: uuid.UUID


async def _item_thread(client: AsyncClient, prefix: str, name: str) -> _Thread:
    owner_token, _ = await _register(client, f"{prefix}.owner@example.com")
    asker_token, asker_party_id = await _register(client, f"{prefix}.asker@example.com")
    item_id = await _create_item(
        client, owner_token, await _create_inventory(client, owner_token), name
    )
    response = await client.post(
        "/api/conversations/item", json={"item_id": str(item_id)}, headers=_auth(asker_token)
    )
    assert response.status_code == 201, response.text
    return _Thread(owner_token, asker_token, asker_party_id, response.json()["id"], item_id)


async def _send(client: AsyncClient, token: str, conversation_id: str, body: str) -> Response:
    return await client.post(
        f"/api/conversations/{conversation_id}/messages", json={"body": body}, headers=_auth(token)
    )


async def _display_name(db_session: AsyncSession, party_id: uuid.UUID) -> str:
    return (
        await db_session.execute(
            select(UserProfile.display_name).where(UserProfile.party_id == party_id)
        )
    ).scalar_one()


async def _count(db_session: AsyncSession, model: type) -> int:
    return (await db_session.execute(select(func.count()).select_from(model))).scalar_one()


async def test_sendMessage_invalidBodyAndAccess_returnsPolish400Then404And403(
    client: AsyncClient,
) -> None:
    owner_token, asker_token, _, conversation_id, _ = await _item_thread(
        client, "cm.body", "Cm skrzypce"
    )
    outsider_token, _ = await _register(client, "cm.body.outsider@example.com")

    blank = await _send(client, asker_token, conversation_id, "   \n\t ")
    too_long = await _send(client, asker_token, conversation_id, "x" * 1001)
    unknown = await _send(client, asker_token, str(uuid.uuid4()), "Cześć")
    denied = await _send(client, outsider_token, conversation_id, "Cześć")
    denied_list = await client.get(
        f"/api/conversations/{conversation_id}/messages", headers=_auth(outsider_token)
    )
    longest = await _send(client, owner_token, conversation_id, "  " + "y" * 1000 + "  ")

    for response in (blank, too_long):
        assert response.status_code == 400, response.text
        assert response.json()["message"] == BODY_ERROR
        assert response.json()["fieldErrors"] is None
    assert unknown.status_code == 404
    assert denied.status_code == 403
    assert denied_list.status_code == 403
    assert longest.status_code == 201, longest.text
    assert longest.json()["body"] == "y" * 1000


async def test_listMessages_sixtyMessages_pagesWithBeforeAndAfterCursors(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner_token, _, asker_party_id, conversation_id, _ = await _item_thread(
        client, "cm.page", "Cm wiolonczela"
    )
    _, other_asker_token, _, foreign_conversation_id, _ = await _item_thread(
        client, "cm.page.other", "Cm altówka"
    )
    foreign = await _send(client, other_asker_token, foreign_conversation_id, "Obcy")
    assert foreign.status_code == 201, foreign.text
    conversation_uuid = uuid.UUID(conversation_id)
    for index in range(60):
        last = await repository.lock_conversation_for_send(db_session, conversation_uuid)
        message = await repository.insert_message(
            db_session, conversation_uuid, asker_party_id, f"Wiadomość {index}", last
        )
        await repository.bump_last_message_at(db_session, conversation_uuid, message.created_at)
    await db_session.commit()
    url = f"/api/conversations/{conversation_id}/messages"

    newest = (await client.get(url, headers=_auth(owner_token))).json()
    older = await client.get(
        url, params={"before": newest["items"][0]["id"]}, headers=_auth(owner_token)
    )
    sent = await _send(client, owner_token, conversation_id, "Najnowsza")
    newer = await client.get(
        url, params={"after": newest["items"][-1]["id"]}, headers=_auth(owner_token)
    )
    both = await client.get(
        url,
        params={"before": newest["items"][0]["id"], "after": newest["items"][-1]["id"]},
        headers=_auth(owner_token),
    )
    foreign_cursor = await client.get(
        url, params={"after": foreign.json()["id"]}, headers=_auth(owner_token)
    )
    unknown_cursor = await client.get(
        url, params={"before": str(uuid.uuid4())}, headers=_auth(owner_token)
    )

    assert [m["body"] for m in newest["items"]] == [f"Wiadomość {i}" for i in range(10, 60)]
    assert newest["has_more"] is True
    assert set(newest) == {"items", "has_more"}
    assert set(newest["items"][0]) == MESSAGE_KEYS
    assert older.status_code == 200, older.text
    assert [m["body"] for m in older.json()["items"]] == [f"Wiadomość {i}" for i in range(10)]
    assert older.json()["has_more"] is False
    assert sent.status_code == 201, sent.text
    assert newer.status_code == 200, newer.text
    assert [m["id"] for m in newer.json()["items"]] == [sent.json()["id"]]
    assert newer.json()["has_more"] is False
    assert both.status_code == 400
    assert foreign_cursor.status_code == 400
    assert unknown_cursor.status_code == 400


async def test_sendMessage_groupChat_senderFieldsIncreasingTimesAndNoNotification(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    org_token, org_party_id = await _register(client, "cm.fields.org@example.com", "ORGANIZER")
    member_token, member_party_id = await _register(client, "cm.fields.member@example.com")
    response = await client.post(
        "/api/groups/mine/new",
        json={"name": "Cm grupa", "visibility": "PRIVATE"},
        headers=_auth(org_token),
    )
    assert response.status_code == 201, response.text
    group_id = uuid.UUID(response.json()["id"])
    await groups_service.add_active_membership(db_session, group_id, member_party_id)
    await db_session.commit()
    opened = await client.post(
        "/api/conversations/group", json={"group_id": str(group_id)}, headers=_auth(member_token)
    )
    assert opened.status_code == 201, opened.text
    conversation_id = opened.json()["id"]
    notifications_before = await _count(db_session, Notification)

    first = await _send(client, org_token, conversation_id, "Od organizatora")
    second = await _send(client, member_token, conversation_id, "Od członka")
    page = await client.get(
        f"/api/conversations/{conversation_id}/messages", headers=_auth(member_token)
    )

    assert first.status_code == 201, first.text
    assert second.status_code == 201, second.text
    assert set(first.json()) == MESSAGE_KEYS
    assert first.json()["is_mine"] is True and first.json()["sender_is_organizer"] is True
    assert datetime.fromisoformat(second.json()["created_at"]) > datetime.fromisoformat(
        first.json()["created_at"]
    )
    by_org, by_member = page.json()["items"]
    assert by_org["is_mine"] is False and by_org["sender_is_organizer"] is True
    assert by_org["sender_name"] == await _display_name(db_session, org_party_id)
    assert by_member["is_mine"] is True and by_member["sender_is_organizer"] is False
    assert by_member["sender_name"] == await _display_name(db_session, member_party_id)
    assert await _count(db_session, Notification) == notifications_before


@pytest.mark.usefixtures("_restore_classifier")
async def test_sendMessage_moderationRejectedAttemptCountsTowardLimit_writesNoRowLogsNoBody(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    _, asker_token, asker_party_id, conversation_id, _ = await _item_thread(
        client, "cm.guard", "Cm harfa"
    )
    monkeypatch.setattr(settings, "moderation_text_enabled", True)
    text_guard.set_classifier(_RejectingClassifier())
    caplog.set_level(logging.INFO, logger="app.messaging.application.messages")

    rejected = await _send(client, asker_token, conversation_id, "coś niestosownego")

    assert rejected.status_code == 400, rejected.text
    assert rejected.json()["message"] == text_guard.MESSAGES[text_guard.TextField.MESSAGE_BODY]
    assert await _count(db_session, Message) == 0

    # The rejected attempt took one of the 30 slots; a success takes exactly one.
    monkeypatch.setattr(settings, "moderation_text_enabled", False)
    for index in range(29):
        response = await _send(client, asker_token, conversation_id, f"Wiadomość {index}")
        assert response.status_code == 201, response.text
    limited = await _send(client, asker_token, conversation_id, "Trzydziesta")

    assert limited.status_code == 429, limited.text
    assert limited.json()["message"] == "Za dużo wiadomości — spróbuj ponownie za chwilę."
    assert "Retry-After" in limited.headers
    assert await _count(db_session, Message) == 29
    logged = [record.getMessage() for record in caplog.records]
    assert any(
        line.startswith("Message rejected by moderation") and str(asker_party_id) in line
        for line in logged
    )
    assert any(line.startswith("Message send rate-limited") for line in logged)
    assert "niestosownego" not in caplog.text and "Trzydziesta" not in caplog.text


class _FailingClassifier:
    model_id = "fake/bielik-guard"

    def scores(self, text: str) -> dict[str, float]:
        raise RuntimeError("model crashed")


class _SlowClassifier:
    model_id = "fake/bielik-guard"

    def scores(self, text: str) -> dict[str, float]:
        time.sleep(0.5)
        return {}


@pytest.mark.usefixtures("_restore_classifier")
async def test_sendMessage_moderationUnavailable_returns503WritesNoRowAndCountsAttempts(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    _, asker_token, _, conversation_id, _ = await _item_thread(client, "cm.down", "Cm flet")
    monkeypatch.setattr(settings, "moderation_text_enabled", True)
    text_guard.set_classifier(_FailingClassifier())

    unavailable = [await _send(client, asker_token, conversation_id, "Cześć") for _ in range(29)]
    text_guard.set_classifier(None)
    caplog.set_level(logging.WARNING, logger="app.moderation.text_guard")
    missing = await _send(client, asker_token, conversation_id, "Cześć")
    monkeypatch.setattr(settings, "moderation_text_enabled", False)
    limited = await _send(client, asker_token, conversation_id, "Cześć ponownie")

    assert all(response.status_code == 503 for response in unavailable), unavailable[0].text
    assert (
        unavailable[0].json()["message"]
        == "Moderacja jest chwilowo niedostępna — spróbuj za chwilę."
    )
    assert missing.status_code == 503, missing.text
    assert "reason=missing" in caplog.text
    assert limited.status_code == 429, limited.text
    assert await _count(db_session, Message) == 0


@pytest.mark.usefixtures("_restore_classifier")
async def test_sendMessage_moderationTimeout_returns503AndWritesNoRow(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    _, asker_token, _, conversation_id, _ = await _item_thread(client, "cm.slow", "Cm obój")
    monkeypatch.setattr(settings, "moderation_text_enabled", True)
    monkeypatch.setattr(text_guard, "INFERENCE_TIMEOUT_SECONDS", 0.05)
    text_guard.set_classifier(_SlowClassifier())
    caplog.set_level(logging.WARNING, logger="app.moderation.text_guard")

    timed_out = await _send(client, asker_token, conversation_id, "Cześć")

    assert timed_out.status_code == 503, timed_out.text
    assert timed_out.json()["message"] == "Moderacja jest chwilowo niedostępna — spróbuj za chwilę."
    assert "reason=timeout" in caplog.text
    assert await _count(db_session, Message) == 0


async def test_sendMessage_groupDeletedDuringModeration_recheckedUnderLockReturns409(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    org_token, _ = await _register(client, "cm.race.org@example.com", "ORGANIZER")
    response = await client.post(
        "/api/groups/mine/new",
        json={"name": "Cm wyścig", "visibility": "PRIVATE"},
        headers=_auth(org_token),
    )
    assert response.status_code == 201, response.text
    group_id = uuid.UUID(response.json()["id"])
    opened = await client.post(
        "/api/conversations/group", json={"group_id": str(group_id)}, headers=_auth(org_token)
    )
    assert opened.status_code == 201, opened.text

    async def _delete_group_while_moderating(field: object, new: str | None) -> None:
        assert not db_session.in_transaction()
        await db_session.execute(
            update(Group).where(Group.id == group_id).values(deleted_at=datetime.utcnow())
        )

    monkeypatch.setattr(messages, "check_text", _delete_group_while_moderating)
    refused = await _send(client, org_token, opened.json()["id"], "Cześć")

    assert refused.status_code == 409, refused.text
    assert refused.json()["message"] == "Grupa usunięta — czat jest tylko do odczytu"
    assert await _count(db_session, Message) == 0


async def test_sendMessage_deletedItemAndOwnershipChange_itemThreadStaysWritable(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner_token, asker_token, _, conversation_id, item_id = await _item_thread(
        client, "cm.item", "Cm trąbka"
    )
    new_owner_token, _ = await _register(client, "cm.item.new@example.com")
    item = await db_session.get(InventoryItem, item_id)
    assert item is not None
    item.inventory_id = await _create_inventory(client, new_owner_token)
    await db_session.commit()

    after_transfer_owner = await _send(client, owner_token, conversation_id, "Już nie moja")
    after_transfer_asker = await _send(client, asker_token, conversation_id, "Rozumiem")
    by_new_owner = await _send(client, new_owner_token, conversation_id, "Hej")
    item.deleted_at = datetime.utcnow()
    await db_session.commit()
    after_delete = await _send(client, asker_token, conversation_id, "Szkoda")

    assert after_transfer_owner.status_code == 201, after_transfer_owner.text
    assert after_transfer_asker.status_code == 201, after_transfer_asker.text
    assert by_new_owner.status_code == 403
    assert after_delete.status_code == 201, after_delete.text
