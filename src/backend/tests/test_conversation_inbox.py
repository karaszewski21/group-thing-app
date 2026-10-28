"""`GET /api/conversations` (the inbox), `GET /api/conversations/unread-count`
and `POST /api/conversations/{id}/read` (spec requirements 14, 15 and 19):
exact uncapped unread math that ignores the caller's own messages, the
GREATEST read marker, a fixed query count whatever the number of
conversations (M1), and the inbox row shape."""

from __future__ import annotations

import uuid
from datetime import timedelta

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from app.core import clock
from app.groups import service as groups_service
from tests.conftest import count_queries, leaf_category_ids

INBOX_ROW_KEYS = {
    "id",
    "kind",
    "title",
    "item",
    "counterpart_name",
    "group_name",
    "term_occurs_on",
    "unread_count",
    "read_only_reason",
    "last_message",
}
LAST_MESSAGE_KEYS = {"body", "sender_name", "is_mine", "sender_is_organizer", "created_at"}


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


async def _create_circle(client: AsyncClient, token: str, name: str, visibility: str) -> uuid.UUID:
    response = await client.post(
        "/api/groups/mine/new", json={"name": name, "visibility": visibility}, headers=_auth(token)
    )
    assert response.status_code == 201, response.text
    return uuid.UUID(response.json()["id"])


async def _create_term(client: AsyncClient, token: str, group_id: uuid.UUID) -> uuid.UUID:
    occurs_on = (clock.local_now() + timedelta(days=3)).replace(microsecond=0)
    response = await client.post(
        "/api/terms",
        json={"circle_group_id": str(group_id), "occurs_on": occurs_on.isoformat()},
        headers=_auth(token),
    )
    assert response.status_code == 201, response.text
    return uuid.UUID(response.json()["id"])


async def _rsvp(
    client: AsyncClient, group_id: uuid.UUID, term_id: uuid.UUID, token: str | None = None
) -> None:
    response = await client.post(
        f"/api/groups/public/{group_id}/rsvp",
        json={"term_id": str(term_id), "guardian_name": "Gość Ci", "child_count": 1},
        headers=_auth(token) if token else {},
    )
    assert response.status_code == 201, response.text


async def _open(client: AsyncClient, token: str, kind: str, target_id: uuid.UUID) -> str:
    response = await client.post(
        f"/api/conversations/{kind}", json={f"{kind}_id": str(target_id)}, headers=_auth(token)
    )
    assert response.status_code in (200, 201), response.text
    return str(response.json()["id"])


async def _send(client: AsyncClient, token: str, conversation_id: str, body: str) -> str:
    response = await client.post(
        f"/api/conversations/{conversation_id}/messages", json={"body": body}, headers=_auth(token)
    )
    assert response.status_code == 201, response.text
    return str(response.json()["id"])


async def _read(client: AsyncClient, token: str, conversation_id: str, message_id: str) -> int:
    response = await client.post(
        f"/api/conversations/{conversation_id}/read",
        json={"message_id": message_id},
        headers=_auth(token),
    )
    return response.status_code


async def _unread(client: AsyncClient, token: str) -> int:
    response = await client.get("/api/conversations/unread-count", headers=_auth(token))
    assert response.status_code == 200, response.text
    assert set(response.json()) == {"count"}
    return int(response.json()["count"])


async def test_unreadCount_markersAndOwnMessages_exactUncappedAndGreatest(
    client: AsyncClient,
) -> None:
    owner_token, _ = await _register(client, "ci.unread.owner@example.com")
    asker_token, _ = await _register(client, "ci.unread.asker@example.com")
    outsider_token, _ = await _register(client, "ci.unread.outsider@example.com")
    item_id = await _create_item(
        client, owner_token, await _create_inventory(client, owner_token), "Ci gramofon"
    )
    other_asker_token, _ = await _register(client, "ci.unread.other@example.com")
    conversation_id = await _open(client, asker_token, "item", item_id)
    other_conversation_id = await _open(client, other_asker_token, "item", item_id)
    foreign_message_id = await _send(client, other_asker_token, other_conversation_id, "Obca")
    sent = [await _send(client, owner_token, conversation_id, f"Nr {i}") for i in range(12)]

    assert await _unread(client, asker_token) == 12
    inbox = (await client.get("/api/conversations", headers=_auth(asker_token))).json()
    assert [row["unread_count"] for row in inbox] == [12]
    assert await _unread(client, owner_token) == 1  # the other asker's message only

    assert await _read(client, asker_token, conversation_id, sent[2]) == 204
    assert await _unread(client, asker_token) == 9
    assert await _read(client, asker_token, conversation_id, sent[-1]) == 204
    assert await _unread(client, asker_token) == 0
    assert await _read(client, asker_token, conversation_id, sent[0]) == 204
    assert await _unread(client, asker_token) == 0
    assert await _read(client, asker_token, conversation_id, foreign_message_id) == 400
    assert await _read(client, outsider_token, conversation_id, sent[0]) == 403
    assert await _read(client, asker_token, str(uuid.uuid4()), sent[0]) == 404

    await _send(client, asker_token, conversation_id, "Dzięki")
    assert await _unread(client, asker_token) == 0
    assert await _unread(client, owner_token) == 2


async def _add_one_of_each(
    client: AsyncClient,
    db_session: AsyncSession,
    me: tuple[str, uuid.UUID],
    org_token: str,
    owner: tuple[str, uuid.UUID],
    index: int,
) -> None:
    my_token, my_party_id = me
    owner_token, owner_inventory = owner
    item_id = await _create_item(client, owner_token, owner_inventory, f"Ci rzecz {index}")
    await _send(client, owner_token, await _open(client, my_token, "item", item_id), "Rzecz")

    group_id = await _create_circle(client, org_token, f"Ci grupa {index}", "PRIVATE")
    await groups_service.add_active_membership(db_session, group_id, my_party_id)
    await db_session.commit()
    await _send(client, org_token, await _open(client, my_token, "group", group_id), "Grupa")

    term_group_id = await _create_circle(client, org_token, f"Ci terminy {index}", "PUBLIC")
    term_id = await _create_term(client, org_token, term_group_id)
    await _rsvp(client, term_group_id, term_id, my_token)
    await _send(client, org_token, await _open(client, my_token, "term", term_id), "Termin")


async def test_inboxAndUnreadCount_threeVersusNineConversations_sameQueryCount(
    client: AsyncClient, db_session: AsyncSession, engine: AsyncEngine
) -> None:
    me = await _register(client, "ci.budget.me@example.com")
    org_token, _ = await _register(client, "ci.budget.org@example.com", "ORGANIZER")
    owner_token, _ = await _register(client, "ci.budget.owner@example.com")
    owner = (owner_token, await _create_inventory(client, owner_token))
    await _add_one_of_each(client, db_session, me, org_token, owner, 0)

    with count_queries(engine) as inbox_three:
        three = await client.get("/api/conversations", headers=_auth(me[0]))
    with count_queries(engine) as unread_three:
        unread_count_three = await _unread(client, me[0])
    for index in (1, 2):
        await _add_one_of_each(client, db_session, me, org_token, owner, index)
    with count_queries(engine) as inbox_nine:
        nine = await client.get("/api/conversations", headers=_auth(me[0]))
    with count_queries(engine) as unread_nine:
        unread_count_nine = await _unread(client, me[0])

    assert three.status_code == 200, three.text
    assert sorted(row["kind"] for row in three.json()) == ["GROUP", "ITEM", "TERM"]
    assert len(nine.json()) == 9
    assert unread_count_three == 3 and unread_count_nine == 9
    assert len(inbox_nine) == len(inbox_three)
    assert len(unread_nine) == len(unread_three)


async def test_inboxRow_termWithGuestAttendee_exactShapeAndParticipantCount(
    client: AsyncClient,
) -> None:
    org_token, _ = await _register(client, "ci.shape.org@example.com", "ORGANIZER")
    attendee_token, _ = await _register(client, "ci.shape.attendee@example.com")
    group_id = await _create_circle(client, org_token, "Ci kształt", "PUBLIC")
    term_id = await _create_term(client, org_token, group_id)
    await _rsvp(client, group_id, term_id, attendee_token)
    await _rsvp(client, group_id, term_id)  # an account-less guest
    conversation_id = await _open(client, attendee_token, "term", term_id)
    empty_inbox = (await client.get("/api/conversations", headers=_auth(attendee_token))).json()
    await _send(client, org_token, conversation_id, "Do zobaczenia")

    conversation = await client.get(
        f"/api/conversations/{conversation_id}", headers=_auth(attendee_token)
    )
    inbox = (await client.get("/api/conversations", headers=_auth(attendee_token))).json()

    assert empty_inbox == []
    assert conversation.json()["participant_count"] == 2
    assert len(inbox) == 1
    row = inbox[0]
    assert set(row) == INBOX_ROW_KEYS
    assert set(row["last_message"]) == LAST_MESSAGE_KEYS
    assert row["id"] == conversation_id and row["kind"] == "TERM"
    assert row["title"] == conversation.json()["title"]
    assert row["group_name"] == "Ci kształt" and row["unread_count"] == 1
    assert row["last_message"]["body"] == "Do zobaczenia"
    assert row["last_message"]["is_mine"] is False
    assert row["last_message"]["sender_is_organizer"] is True
