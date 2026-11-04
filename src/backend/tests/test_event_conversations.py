"""`POST /api/conversations/event` get-or-create (404 → 403 → existing 200 →
insert 201), EVENT access for the author and active attendees only, EVENT
rows in the inbox and the unread badge, and the cascade that removes an
event's chat with the event."""

from __future__ import annotations

import uuid
from datetime import timedelta
from typing import Any

from httpx import AsyncClient, Response
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import clock
from app.groups import service as groups_service
from tests.conftest import create_location

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


async def _register(client: AsyncClient, email: str, role: str = "GUEST") -> tuple[str, uuid.UUID]:
    response = await client.post(
        "/api/auth/register", json={"role": role, "email": email, "password": "secret123"}
    )
    assert response.status_code == 201, response.text
    return response.json()["token"], uuid.UUID(response.json()["party_id"])


async def _create_event(client: AsyncClient, token: str, name: str) -> str:
    starts_at = (clock.local_now() + timedelta(days=3)).replace(second=0, microsecond=0)
    response = await client.post(
        "/api/events",
        json={
            "location_id": await create_location(client, _auth(token)),
            "name": name,
            "starts_at": starts_at.isoformat(),
        },
        headers=_auth(token),
    )
    assert response.status_code == 201, response.text
    return str(response.json()["id"])


async def _sign_up(client: AsyncClient, event_id: str, token: str | None = None) -> None:
    response = await client.post(
        f"/api/events/{event_id}/attendances",
        json={} if token else {"guest_name": "Gość Wydarzenia"},
        headers=_auth(token) if token else {},
    )
    assert response.status_code == 201, response.text


async def _withdraw(client: AsyncClient, event_id: str, token: str) -> None:
    response = await client.post(
        f"/api/events/{event_id}/attendances/withdraw", headers=_auth(token)
    )
    assert response.status_code == 204, response.text


async def _open(
    client: AsyncClient, token: str | None, event_id: str
) -> tuple[int, dict[str, Any]]:
    response = await client.post(
        "/api/conversations/event",
        json={"event_id": event_id},
        headers=_auth(token) if token else {},
    )
    return response.status_code, response.json()


async def _send(client: AsyncClient, token: str, conversation_id: str, body: str) -> Response:
    return await client.post(
        f"/api/conversations/{conversation_id}/messages", json={"body": body}, headers=_auth(token)
    )


async def test_openEventConversation_firstThenSecond_returns201Then200(
    client: AsyncClient,
) -> None:
    author, _ = await _register(client, "evc.open.author@example.com")
    attendee, _ = await _register(client, "evc.open.attendee@example.com")
    event_id = await _create_event(client, author, "Wymiana zabawek")
    await _sign_up(client, event_id, attendee)
    await _sign_up(client, event_id)  # an account-less guest is not counted

    created_status, created = await _open(client, author, event_id)
    reopened_status, reopened = await _open(client, attendee, event_id)

    assert created_status == 201, created
    assert reopened_status == 200, reopened
    assert reopened["id"] == created["id"]
    assert set(created) == CONVERSATION_KEYS
    assert created["kind"] == "EVENT"
    assert created["title"] == "Wymiana zabawek"
    assert created["group_name"] is None and created["term_occurs_on"] is None
    assert created["item"] is None and created["counterpart_name"] is None
    assert created["read_only_reason"] is None
    assert created["participant_count"] == 2
    assert created["unread_count"] == 0


async def test_openEventConversation_access_authorAndAttendeeOk_withdrawnGets403_anonymousGets401(
    client: AsyncClient,
) -> None:
    author, _ = await _register(client, "evc.access.author@example.com")
    attendee, _ = await _register(client, "evc.access.attendee@example.com")
    withdrawn, _ = await _register(client, "evc.access.withdrawn@example.com")
    stranger, _ = await _register(client, "evc.access.stranger@example.com")
    event_id = await _create_event(client, author, "Wymiana książek")
    await _sign_up(client, event_id, attendee)
    await _sign_up(client, event_id, withdrawn)

    attendee_status, conversation = await _open(client, attendee, event_id)
    withdrawn_before_status, _ = await _open(client, withdrawn, event_id)
    await _withdraw(client, event_id, withdrawn)

    assert attendee_status == 201, conversation
    assert withdrawn_before_status == 200
    assert (await _open(client, author, event_id))[0] == 200
    assert (await _open(client, withdrawn, event_id))[0] == 403
    assert (await _open(client, stranger, event_id))[0] == 403
    assert (await _open(client, None, event_id))[0] == 401
    assert (await _open(client, author, str(uuid.uuid4())))[0] == 404

    conversation_id = conversation["id"]
    by_withdrawn = await client.get(
        f"/api/conversations/{conversation_id}", headers=_auth(withdrawn)
    )
    assert by_withdrawn.status_code == 403
    assert (await _send(client, withdrawn, conversation_id, "Jeszcze ja")).status_code == 403
    assert (await _send(client, attendee, conversation_id, "Będę")).status_code == 201
    by_author = await client.get(f"/api/conversations/{conversation_id}", headers=_auth(author))
    assert by_author.status_code == 200, by_author.text
    assert by_author.json()["unread_count"] == 1


async def test_inbox_mixedKinds_showsEventTitleAndUnreadCount(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    author, _ = await _register(client, "evc.inbox.author@example.com", role="ORGANIZER")
    attendee, attendee_party = await _register(client, "evc.inbox.attendee@example.com")
    circle = await client.post(
        "/api/groups/mine/new",
        json={"name": "Evc krąg", "visibility": "PRIVATE"},
        headers=_auth(author),
    )
    assert circle.status_code == 201, circle.text
    group_id = uuid.UUID(circle.json()["id"])
    await groups_service.add_active_membership(db_session, group_id, attendee_party)
    await db_session.commit()
    group_chat = await client.post(
        "/api/conversations/group", json={"group_id": str(group_id)}, headers=_auth(attendee)
    )
    assert group_chat.status_code == 201, group_chat.text
    event_id = await _create_event(client, author, "Piknik wymiany")
    await _sign_up(client, event_id, attendee)
    _, event_chat = await _open(client, author, event_id)

    assert (await _send(client, attendee, group_chat.json()["id"], "W grupie")).status_code == 201
    assert (await _send(client, attendee, event_chat["id"], "Na pikniku")).status_code == 201
    assert (await _send(client, attendee, event_chat["id"], "Do zobaczenia")).status_code == 201

    inbox = await client.get("/api/conversations", headers=_auth(author))
    unread = await client.get("/api/conversations/unread-count", headers=_auth(author))

    assert inbox.status_code == 200, inbox.text
    rows = {row["kind"]: row for row in inbox.json()}
    assert set(rows) == {"EVENT", "GROUP"}
    event_row = rows["EVENT"]
    assert event_row["id"] == event_chat["id"]
    assert event_row["title"] == "Piknik wymiany"
    assert event_row["group_name"] is None and event_row["term_occurs_on"] is None
    assert event_row["read_only_reason"] is None
    assert event_row["unread_count"] == 2
    assert event_row["last_message"]["body"] == "Do zobaczenia"
    assert event_row["last_message"]["sender_is_organizer"] is False
    assert rows["GROUP"]["unread_count"] == 1
    assert unread.json() == {"count": 3}

    attendee_inbox = await client.get("/api/conversations", headers=_auth(attendee))
    assert {row["kind"] for row in attendee_inbox.json()} == {"EVENT", "GROUP"}
    await _withdraw(client, event_id, attendee)
    after_withdraw = await client.get("/api/conversations", headers=_auth(attendee))
    assert {row["kind"] for row in after_withdraw.json()} == {"GROUP"}


async def test_deleteEvent_afterWithdrawals_cascadesConversationMessagesAndReads(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    author, _ = await _register(client, "evc.cascade.author@example.com")
    attendee, _ = await _register(client, "evc.cascade.attendee@example.com")
    event_id = await _create_event(client, author, "Wymiana na usunięcie")
    await _sign_up(client, event_id, attendee)
    _, conversation = await _open(client, attendee, event_id)
    conversation_id = conversation["id"]
    sent = await _send(client, attendee, conversation_id, "Cześć")
    assert sent.status_code == 201, sent.text
    read = await client.post(
        f"/api/conversations/{conversation_id}/read",
        json={"message_id": sent.json()["id"]},
        headers=_auth(author),
    )
    assert read.status_code == 204, read.text
    await _withdraw(client, event_id, attendee)

    deleted = await client.delete(f"/api/events/{event_id}", headers=_auth(author))

    assert deleted.status_code == 204, deleted.text
    for table, column in (
        ("conversations", "id"),
        ("messages", "conversation_id"),
        ("conversation_reads", "conversation_id"),
    ):
        remaining = (
            await db_session.execute(
                text(f"SELECT count(*) FROM {table} WHERE {column} = :id"),  # noqa: S608
                {"id": conversation_id},
            )
        ).scalar_one()
        assert remaining == 0, table
