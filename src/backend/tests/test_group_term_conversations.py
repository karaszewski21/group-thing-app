"""`POST /api/conversations/group|term` get-or-create (spec requirement 13's
order: missing 404 → access 403 → existing 200 → deleted group 404 →
PUBLIC group 409 → insert 201) and `GET /api/conversations/{id}` for GROUP
and TERM chats: server-built titles, `participant_count` over
account-backed parties only, and `read_only_reason` GROUP_DELETED before
GROUP_PUBLIC."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta

from httpx import AsyncClient, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import clock
from app.groups import service as groups_service
from app.groups.models import Group, GroupVisibility, Term


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _register(client: AsyncClient, role: str, email: str) -> tuple[str, uuid.UUID]:
    response = await client.post(
        "/api/auth/register", json={"role": role, "email": email, "password": "secret123"}
    )
    assert response.status_code == 201, response.text
    return response.json()["token"], uuid.UUID(response.json()["party_id"])


async def _create_circle(client: AsyncClient, token: str, name: str, visibility: str) -> uuid.UUID:
    response = await client.post(
        "/api/groups/mine/new", json={"name": name, "visibility": visibility}, headers=_auth(token)
    )
    assert response.status_code == 201, response.text
    return uuid.UUID(response.json()["id"])


async def _create_term(
    client: AsyncClient, token: str, group_id: uuid.UUID, occurs_on: datetime
) -> uuid.UUID:
    response = await client.post(
        "/api/terms",
        json={"circle_group_id": str(group_id), "occurs_on": occurs_on.isoformat()},
        headers=_auth(token),
    )
    assert response.status_code == 201, response.text
    return uuid.UUID(response.json()["id"])


async def _rsvp(
    client: AsyncClient, group_id: uuid.UUID, term_id: uuid.UUID, token: str | None = None
) -> uuid.UUID:
    response = await client.post(
        f"/api/groups/public/{group_id}/rsvp",
        json={"term_id": str(term_id), "guardian_name": "Gość Gtc", "child_count": 1},
        headers=_auth(token) if token else {},
    )
    assert response.status_code == 201, response.text
    return uuid.UUID(response.json()["id"])


async def _open(
    client: AsyncClient, token: str, kind: str, target_id: uuid.UUID
) -> tuple[int, dict]:
    response = await client.post(
        f"/api/conversations/{kind}", json={f"{kind}_id": str(target_id)}, headers=_auth(token)
    )
    return response.status_code, response.json()


async def _update_group(db_session: AsyncSession, group_id: uuid.UUID, **values: object) -> None:
    group = await db_session.get(Group, group_id)
    assert group is not None
    for key, value in values.items():
        setattr(group, key, value)
    await db_session.commit()


async def test_openGroupConversation_privateGroup_accessOrderAndReadOnlyStates(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "gtc.group.org@example.com")
    member_token, member_party_id = await _register(client, "GUEST", "gtc.group.member@example.com")
    outsider_token, _ = await _register(client, "GUEST", "gtc.group.outsider@example.com")
    group_id = await _create_circle(client, org_token, "Gtc prywatny", "PRIVATE")
    public_group = await _create_circle(client, org_token, "Gtc publiczny", "PUBLIC")
    deleted_group = await _create_circle(client, org_token, "Gtc usunięty", "PRIVATE")
    await groups_service.add_active_membership(db_session, group_id, member_party_id)
    await db_session.commit()
    await _update_group(db_session, deleted_group, deleted_at=datetime.utcnow())

    outsider_status, _ = await _open(client, outsider_token, "group", group_id)
    missing_status, _ = await _open(client, org_token, "group", uuid.uuid4())
    created_status, created = await _open(client, member_token, "group", group_id)
    reopened_status, reopened = await _open(client, org_token, "group", group_id)
    public_status, public = await _open(client, org_token, "group", public_group)
    deleted_status, _ = await _open(client, org_token, "group", deleted_group)

    assert outsider_status == 403
    assert missing_status == 404
    assert created_status == 201, created
    assert reopened_status == 200 and reopened["id"] == created["id"]
    assert public_status == 409
    assert public["message"] == "Czat grupy jest dostępny tylko w grupach prywatnych"
    assert deleted_status == 404
    assert created["kind"] == "GROUP"
    assert created["title"] == created["group_name"] == "Gtc prywatny"
    assert created["participant_count"] == 2
    assert created["read_only_reason"] is None
    assert created["item"] is None and created["counterpart_name"] is None

    by_outsider = await client.get(
        f"/api/conversations/{created['id']}", headers=_auth(outsider_token)
    )
    assert by_outsider.status_code == 403

    await _update_group(db_session, group_id, visibility=GroupVisibility.PUBLIC)
    public_reopen_status, public_reopen = await _open(client, member_token, "group", group_id)
    assert public_reopen_status == 200
    assert public_reopen["read_only_reason"] == "GROUP_PUBLIC"

    await _update_group(db_session, group_id, deleted_at=datetime.utcnow())
    by_member = await client.get(f"/api/conversations/{created['id']}", headers=_auth(member_token))
    assert by_member.status_code == 200, by_member.text
    assert by_member.json()["read_only_reason"] == "GROUP_DELETED"


async def test_openTermConversation_attendeesAndOrganizer_withdrawnDeniedPastTermOpens(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "gtc.term.org@example.com")
    attendee_token, _ = await _register(client, "GUEST", "gtc.term.attendee@example.com")
    withdrawn_token, _ = await _register(client, "GUEST", "gtc.term.withdrawn@example.com")
    outsider_token, _ = await _register(client, "GUEST", "gtc.term.outsider@example.com")
    group_id = await _create_circle(client, org_token, "Gtc terminy", "PUBLIC")
    occurs_on = (clock.local_now() + timedelta(days=3)).replace(microsecond=0)
    term_id = await _create_term(client, org_token, group_id, occurs_on)
    await _rsvp(client, group_id, term_id, attendee_token)
    await _rsvp(client, group_id, term_id)  # an account-less guest
    withdrawn = await _rsvp(client, group_id, term_id, withdrawn_token)
    response = await client.post(
        f"/api/groups/mine/attendances/{withdrawn}/withdraw", headers=_auth(withdrawn_token)
    )
    assert response.status_code == 200, response.text
    past = occurs_on - timedelta(days=10)
    term = await db_session.get(Term, term_id)
    assert term is not None
    term.occurs_on = past
    await db_session.commit()

    withdrawn_status, _ = await _open(client, withdrawn_token, "term", term_id)
    outsider_status, _ = await _open(client, outsider_token, "term", term_id)
    missing_status, _ = await _open(client, attendee_token, "term", uuid.uuid4())
    created_status, created = await _open(client, attendee_token, "term", term_id)
    reopened_status, reopened = await _open(client, org_token, "term", term_id)

    assert withdrawn_status == 403
    assert outsider_status == 403
    assert missing_status == 404
    assert created_status == 201, created
    assert reopened_status == 200 and reopened["id"] == created["id"]
    assert created["kind"] == "TERM"
    assert created["title"] == f"Termin: {clock.format_term_day(past)} {past:%H:%M}"
    assert created["group_name"] == "Gtc terminy"
    assert created["term_occurs_on"] == past.isoformat()
    assert created["participant_count"] == 2
    assert created["read_only_reason"] is None

    by_withdrawn = await client.get(
        f"/api/conversations/{created['id']}", headers=_auth(withdrawn_token)
    )
    assert by_withdrawn.status_code == 403


async def _send(client: AsyncClient, token: str, conversation_id: str, body: str) -> Response:
    return await client.post(
        f"/api/conversations/{conversation_id}/messages", json={"body": body}, headers=_auth(token)
    )


async def _inbox_ids(client: AsyncClient, token: str) -> list[str]:
    response = await client.get("/api/conversations", headers=_auth(token))
    assert response.status_code == 200, response.text
    return [row["id"] for row in response.json()]


async def test_groupChat_softDeletedGroup_readableMarkableListedButSendIs409(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "gtc.ro.deleted.org@example.com")
    member_token, member_party_id = await _register(
        client, "GUEST", "gtc.ro.deleted.member@example.com"
    )
    group_id = await _create_circle(client, org_token, "Gtc tylko odczyt", "PRIVATE")
    await groups_service.add_active_membership(db_session, group_id, member_party_id)
    await db_session.commit()
    _, conversation = await _open(client, member_token, "group", group_id)
    conversation_id = conversation["id"]
    sent = await _send(client, org_token, conversation_id, "Zanim usunę grupę")
    assert sent.status_code == 201, sent.text
    await _update_group(db_session, group_id, deleted_at=datetime.utcnow())

    for token in (member_token, org_token):
        fetched = await client.get(f"/api/conversations/{conversation_id}", headers=_auth(token))
        messages = await client.get(
            f"/api/conversations/{conversation_id}/messages", headers=_auth(token)
        )
        read = await client.post(
            f"/api/conversations/{conversation_id}/read",
            json={"message_id": sent.json()["id"]},
            headers=_auth(token),
        )
        refused = await _send(client, token, conversation_id, "Po usunięciu")

        assert fetched.status_code == 200, fetched.text
        assert fetched.json()["read_only_reason"] == "GROUP_DELETED"
        assert messages.status_code == 200, messages.text
        assert [m["body"] for m in messages.json()["items"]] == ["Zanim usunę grupę"]
        assert read.status_code == 204, read.text
        assert refused.status_code == 409, refused.text
        assert refused.json()["message"] == "Grupa usunięta — czat jest tylko do odczytu"
        assert conversation_id in await _inbox_ids(client, token)


async def test_groupChat_privateToPublicToggle_sendIs409ThenAllowedAgain(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "gtc.ro.public.org@example.com")
    group_id = await _create_circle(client, org_token, "Gtc przełącznik", "PRIVATE")
    _, conversation = await _open(client, org_token, "group", group_id)
    conversation_id = conversation["id"]
    await _update_group(db_session, group_id, visibility=GroupVisibility.PUBLIC)

    fetched = await client.get(f"/api/conversations/{conversation_id}", headers=_auth(org_token))
    refused = await _send(client, org_token, conversation_id, "Publicznie")
    reopened_status, _ = await _open(client, org_token, "group", group_id)
    await _update_group(db_session, group_id, visibility=GroupVisibility.PRIVATE)
    allowed = await _send(client, org_token, conversation_id, "Znowu prywatnie")

    assert fetched.json()["read_only_reason"] == "GROUP_PUBLIC"
    assert refused.status_code == 409, refused.text
    assert refused.json()["message"] == "Grupa jest publiczna — czat jest tylko do odczytu"
    assert reopened_status == 200
    assert allowed.status_code == 201, allowed.text


async def test_termChat_softDeletedGroup_attendeeReadsAndReopensButSendIs409(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "gtc.ro.term.org@example.com")
    attendee_token, _ = await _register(client, "GUEST", "gtc.ro.term.attendee@example.com")
    group_id = await _create_circle(client, org_token, "Gtc terminy usunięte", "PUBLIC")
    occurs_on = (clock.local_now() + timedelta(days=2)).replace(microsecond=0)
    term_id = await _create_term(client, org_token, group_id, occurs_on)
    await _rsvp(client, group_id, term_id, attendee_token)
    _, conversation = await _open(client, attendee_token, "term", term_id)
    conversation_id = conversation["id"]
    sent = await _send(client, org_token, conversation_id, "Do zobaczenia")
    assert sent.status_code == 201, sent.text
    await _update_group(db_session, group_id, deleted_at=datetime.utcnow())

    fetched = await client.get(
        f"/api/conversations/{conversation_id}", headers=_auth(attendee_token)
    )
    reopened_status, reopened = await _open(client, attendee_token, "term", term_id)
    refused = await _send(client, attendee_token, conversation_id, "Po usunięciu")

    assert conversation["read_only_reason"] is None
    assert fetched.status_code == 200, fetched.text
    assert fetched.json()["read_only_reason"] == "GROUP_DELETED"
    assert reopened_status == 200 and reopened["id"] == conversation_id
    assert refused.status_code == 409, refused.text
    assert refused.json()["message"] == "Grupa usunięta — czat jest tylko do odczytu"
    assert conversation_id in await _inbox_ids(client, attendee_token)
