"""`app.groups` tests: `create_own_circle` idempotency (mirrors
`app.organizations.service.create_own_organization`'s resolve-or-create
shape), `create_term` happy path, and basic `NeededItem` creation."""

from __future__ import annotations

from datetime import date

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.groups.models import Group, Leadership, Term, TermAttendance
from app.party.models import Party, PartyType


async def _register_organizer(client: AsyncClient, email: str) -> str:
    response = await client.post(
        "/api/auth/register",
        json={"role": "ORGANIZER", "email": email, "password": "secret123"},
    )
    assert response.status_code == 201
    return response.json()["token"]


def _auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def test_createMyCircle_secondCall_returnsSameCircle_notADuplicate(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token = await _register_organizer(client, "circle.owner1@example.com")

    first = await client.post(
        "/api/groups/mine", json={"name": "Pierwsza Nazwa"}, headers=_auth_headers(token)
    )
    second = await client.post(
        "/api/groups/mine", json={"name": "Druga Nazwa (ignorowana)"}, headers=_auth_headers(token)
    )

    assert first.status_code == 201
    assert second.status_code == 201
    assert first.json()["id"] == second.json()["id"]
    # The second call's name is ignored — idempotent create returns the
    # EXISTING circle, it does not rename it.
    assert second.json()["name"] == "Pierwsza Nazwa"

    # Row-count assertion, not just a 200-shape check: exactly one Group
    # and one active Leadership were ever created for this party.
    group_count = (
        await db_session.execute(select(func.count()).select_from(Group))
    ).scalar_one()
    leadership_count = (
        await db_session.execute(select(func.count()).select_from(Leadership))
    ).scalar_one()
    assert group_count == 1
    assert leadership_count == 1


async def test_createTerm_happyPath_returns201WithTermFields(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token = await _register_organizer(client, "circle.owner2@example.com")
    circle = await client.post(
        "/api/groups/mine", json={"name": "Muzyczne Skrzaty"}, headers=_auth_headers(token)
    )
    circle_group_id = circle.json()["id"]

    response = await client.post(
        "/api/terms",
        json={
            "circle_group_id": circle_group_id,
            "occurs_on": date.today().isoformat(),
            "description": "Pierwsze spotkanie",
        },
        headers=_auth_headers(token),
    )

    assert response.status_code == 201
    body = response.json()
    assert body["circle_group_id"] == circle_group_id
    assert body["description"] == "Pierwsze spotkanie"


async def test_createNeededItem_happyPath_returns201WithCategory(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token = await _register_organizer(client, "circle.owner3@example.com")
    circle = await client.post(
        "/api/groups/mine", json={"name": "Krąg Rodzinny"}, headers=_auth_headers(token)
    )
    circle_group_id = circle.json()["id"]
    term = await client.post(
        "/api/terms",
        json={"circle_group_id": circle_group_id, "occurs_on": date.today().isoformat()},
        headers=_auth_headers(token),
    )
    term_id = term.json()["id"]

    response = await client.post(
        "/api/needed-items",
        json={"term_id": term_id, "category": "INSTRUMENT", "description": "Bębenek"},
        headers=_auth_headers(token),
    )

    assert response.status_code == 201
    body = response.json()
    assert body["term_id"] == term_id
    assert body["category"] == "INSTRUMENT"
    assert body["description"] == "Bębenek"


async def _create_group_and_term(db_session: AsyncSession) -> tuple[Party, Term]:
    """Model-layer helper: a bare `Party`+`Group`+`Term` chain, just enough
    to give a `TermAttendance` row valid FK targets — no HTTP round-trip,
    since `TermAttendance` has no router/service yet (data-layer group)."""
    organizer_party = Party(party_type=PartyType.PERSON, active=True)
    db_session.add(organizer_party)
    await db_session.flush()

    group = Group(party_id=organizer_party.id, name="Krąg Testowy")
    db_session.add(group)
    await db_session.flush()

    term = Term(circle_group_id=group.id, occurs_on=date.today(), description=None)
    db_session.add(term)
    await db_session.flush()

    return organizer_party, term


async def test_termAttendance_create_persistsTermPartyIdAndChildCount(
    db_session: AsyncSession,
) -> None:
    _organizer_party, term = await _create_group_and_term(db_session)
    guest_party = Party(party_type=PartyType.PERSON, active=True)
    db_session.add(guest_party)
    await db_session.flush()

    attendance = TermAttendance(term_id=term.id, party_id=guest_party.id, child_count=2)
    db_session.add(attendance)
    await db_session.flush()

    assert attendance.id is not None
    assert attendance.term_id == term.id
    assert attendance.party_id == guest_party.id
    assert attendance.child_count == 2


async def test_termAttendance_childCount_defaultsToZero(db_session: AsyncSession) -> None:
    _organizer_party, term = await _create_group_and_term(db_session)
    guest_party = Party(party_type=PartyType.PERSON, active=True)
    db_session.add(guest_party)
    await db_session.flush()

    attendance = TermAttendance(term_id=term.id, party_id=guest_party.id)
    db_session.add(attendance)
    await db_session.flush()

    assert attendance.child_count == 0


async def test_termAttendance_unknownTermOrPartyId_violatesForeignKeyConstraint(
    db_session: AsyncSession,
) -> None:
    _organizer_party, term = await _create_group_and_term(db_session)
    guest_party = Party(party_type=PartyType.PERSON, active=True)
    db_session.add(guest_party)
    await db_session.flush()

    db_session.add(TermAttendance(term_id=999_999_999, party_id=guest_party.id, child_count=0))
    with pytest.raises(IntegrityError):
        await db_session.flush()
    await db_session.rollback()

    db_session.add(TermAttendance(term_id=term.id, party_id=999_999_999, child_count=0))
    with pytest.raises(IntegrityError):
        await db_session.flush()


async def test_getPublicCircle_noAuthHeader_returnsExpectedShape(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token = await _register_organizer(client, "circle.owner4@example.com")
    circle = await client.post(
        "/api/groups/mine", json={"name": "Krąg Publiczny"}, headers=_auth_headers(token)
    )
    circle_group_id = circle.json()["id"]
    term = await client.post(
        "/api/terms",
        json={
            "circle_group_id": circle_group_id,
            "occurs_on": date.today().isoformat(),
            "description": "Termin publiczny",
        },
        headers=_auth_headers(token),
    )
    term_id = term.json()["id"]
    await client.post(
        "/api/needed-items",
        json={"term_id": term_id, "category": "INSTRUMENT", "description": "Bębenek"},
        headers=_auth_headers(token),
    )

    # No Authorization header at all — this must succeed unauthenticated.
    response = await client.get(f"/api/groups/public/{circle_group_id}")

    assert response.status_code == 200
    body = response.json()
    assert body["id"] == circle_group_id
    assert body["name"] == "Krąg Publiczny"
    assert body["organizer_display_name"] is not None
    assert body["next_term"]["id"] == term_id
    assert body["next_term"]["needed_items"][0]["description"] == "Bębenek"
    assert body["guardians"] == []


async def test_getPublicCircle_unknownId_returns404(client: AsyncClient) -> None:
    response = await client.get("/api/groups/public/999999999")
    assert response.status_code == 404


async def test_getPublicCircle_responseSchema_hasNoChildIdentifyingField(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Schema-level guarantee: `PublicCircleResponse` never carries a
    per-child field — there is nothing to hide since no per-child data is
    ever fetched (see `get_public_circle_view`'s docstring)."""
    from app.groups.schemas import PublicCircleResponse

    field_names = set(PublicCircleResponse.model_fields.keys())
    assert not any("child" in name.lower() for name in field_names)
