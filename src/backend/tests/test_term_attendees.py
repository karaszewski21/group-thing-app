"""Organizer attendees listing (`GET /api/groups/{id}/terms/{id}/attendees`)
— per-attendee child birth years, the term<->group consistency check (shared
with `formalize`), and deterministic (oldest-wins) family resolution.

Flat `tests/` placement, same convention as `test_group_privacy.py`."""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta

from httpx import AsyncClient
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.families.members import create_lightweight_family_member
from app.families.models import Family, FamilyRoleType
from app.families.service import bootstrap_family_for_party


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _register(client: AsyncClient, role: str, email: str) -> tuple[str, str]:
    r = await client.post(
        "/api/auth/register", json={"role": role, "email": email, "password": "secret123"}
    )
    assert r.status_code == 201
    return r.json()["token"], r.json()["party_id"]


async def _create_circle_and_term(
    client: AsyncClient, org_token: str, prefix: str
) -> tuple[str, str]:
    circle = await client.post(
        "/api/groups/mine", json={"name": f"Krąg {prefix}"}, headers=_auth(org_token)
    )
    assert circle.status_code == 201
    term = await client.post(
        "/api/terms",
        json={
            "circle_group_id": circle.json()["id"],
            "occurs_on": (date.today() + timedelta(days=7)).isoformat(),
        },
        headers=_auth(org_token),
    )
    assert term.status_code == 201
    return circle.json()["id"], term.json()["id"]


async def _rsvp(client: AsyncClient, token: str, group_id: str, term_id: str) -> str:
    r = await client.post(
        f"/api/groups/public/{group_id}/rsvp",
        json={"term_id": term_id, "guardian_name": "ignored", "child_count": 1},
        headers=_auth(token),
    )
    assert r.status_code == 201
    return r.json()["id"]


async def _add_members(client: AsyncClient, token: str, members: list[dict[str, object]]) -> None:
    r = await client.post(
        "/api/families/mine/members", json={"members": members}, headers=_auth(token)
    )
    assert r.status_code == 201


async def _get_attendees(
    client: AsyncClient, token: str, group_id: str, term_id: str
) -> list[dict[str, object]]:
    r = await client.get(f"/api/groups/{group_id}/terms/{term_id}/attendees", headers=_auth(token))
    assert r.status_code == 200
    return r.json()


async def test_listAttendees_familyWithChildren_returnsChildBirthYearsOnly(
    client: AsyncClient,
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "att.children.org@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "att1")
    guardian_token, party_id = await _register(client, "GUEST", "att.children.guardian@example.com")
    await _add_members(
        client,
        guardian_token,
        [
            {"name": "Starszy", "role_type": "CHILD", "birth_year": 2018},
            {"name": "Bez Roku", "role_type": "CHILD"},
            {"name": "Młodszy", "role_type": "CHILD", "birth_year": 2021},
            {"name": "Babcia", "role_type": "GUARDIAN"},
        ],
    )
    await _rsvp(client, guardian_token, group_id, term_id)

    attendees = await _get_attendees(client, org_token, group_id, term_id)

    attendee = next(a for a in attendees if a["party_id"] == party_id)
    assert attendee["children"] == [
        {"birth_year": 2021},
        {"birth_year": 2018},
        {"birth_year": None},
    ]
    assert all(set(child) == {"birth_year"} for child in attendee["children"])


async def test_listAttendees_attendeeWithoutFamilyOrChildren_returnsEmptyChildren(
    client: AsyncClient,
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "att.empty.org@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "att2")
    anonymous = await client.post(
        f"/api/groups/public/{group_id}/rsvp",
        json={"term_id": term_id, "guardian_name": "Gość Anonimowy", "child_count": 0},
    )
    assert anonymous.status_code == 201

    attendees = await _get_attendees(client, org_token, group_id, term_id)

    attendee = next(a for a in attendees if a["display_name"] == "Gość Anonimowy")
    assert attendee["children"] == []


async def test_listAttendees_withdrawnRsvp_excluded(client: AsyncClient) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "att.withdrawn.org@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "att3")
    guest_token, party_id = await _register(client, "GUEST", "att.withdrawn.guest@example.com")
    await _add_members(
        client, guest_token, [{"name": "Dziecko", "role_type": "CHILD", "birth_year": 2019}]
    )
    attendance_id = await _rsvp(client, guest_token, group_id, term_id)
    withdraw = await client.post(
        f"/api/groups/mine/attendances/{attendance_id}/withdraw", headers=_auth(guest_token)
    )
    assert withdraw.status_code == 200

    attendees = await _get_attendees(client, org_token, group_id, term_id)

    assert all(a["party_id"] != party_id for a in attendees)


async def test_listAttendees_nonOrganizer_returns403(client: AsyncClient) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "att.forbidden.org@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "att4")
    outsider_token, _ = await _register(client, "GUEST", "att.forbidden.outsider@example.com")

    response = await client.get(
        f"/api/groups/{group_id}/terms/{term_id}/attendees", headers=_auth(outsider_token)
    )

    assert response.status_code == 403


async def test_listAttendees_termOfOtherGroup_returns404(client: AsyncClient) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "att.othergroup.org1@example.com")
    group_id, _own_term_id = await _create_circle_and_term(client, org_token, "att5a")
    other_org_token, _ = await _register(client, "ORGANIZER", "att.othergroup.org2@example.com")
    _other_group_id, other_term_id = await _create_circle_and_term(client, other_org_token, "att5b")

    foreign = await client.get(
        f"/api/groups/{group_id}/terms/{other_term_id}/attendees", headers=_auth(org_token)
    )
    unknown = await client.get(
        f"/api/groups/{group_id}/terms/{uuid.uuid4()}/attendees", headers=_auth(org_token)
    )

    assert foreign.status_code == 404
    assert unknown.status_code == 404


async def test_listAttendees_partyInTwoFamilies_resolvesOldestFamily(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "att.twofamilies.org@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "att6")
    guardian_token, party_id = await _register(
        client, "GUEST", "att.twofamilies.guardian@example.com"
    )
    await _add_members(
        client, guardian_token, [{"name": "Z Nowszej", "role_type": "CHILD", "birth_year": 2015}]
    )
    await _rsvp(client, guardian_token, group_id, term_id)

    # The second family is inserted later but backdated, so it is the
    # oldest by `created_at` while being the last row physically.
    older = await bootstrap_family_for_party(db_session, "Rodzina Najstarsza", uuid.UUID(party_id))
    await create_lightweight_family_member(
        db_session, older.id, "Z Najstarszej", FamilyRoleType.CHILD, 2020
    )
    await db_session.execute(
        update(Family).where(Family.id == older.id).values(created_at=datetime(2000, 1, 1))
    )
    await db_session.flush()

    for _ in range(2):
        attendees = await _get_attendees(client, org_token, group_id, term_id)
        attendee = next(a for a in attendees if a["party_id"] == party_id)
        assert attendee["family_id"] == str(older.id)
        assert attendee["family_name"] == "Rodzina Najstarsza"
        assert attendee["children"] == [{"birth_year": 2020}]


async def test_formalize_termOfOtherGroup_returns404AndCreatesNoMembership(
    client: AsyncClient,
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "att.formalize.org1@example.com")
    group_id, _own_term_id = await _create_circle_and_term(client, org_token, "att7a")
    other_org_token, _ = await _register(client, "ORGANIZER", "att.formalize.org2@example.com")
    other_group_id, other_term_id = await _create_circle_and_term(client, other_org_token, "att7b")
    guest_token, party_id = await _register(client, "GUEST", "att.formalize.guest@example.com")
    await _rsvp(client, guest_token, other_group_id, other_term_id)

    response = await client.post(
        f"/api/groups/{group_id}/terms/{other_term_id}/formalize",
        json={"party_ids": [party_id]},
        headers=_auth(org_token),
    )

    assert response.status_code == 404
    memberships = await client.get(f"/api/groups/{group_id}/memberships", headers=_auth(org_token))
    assert memberships.status_code == 200
    assert all(m["member_party_id"] != party_id for m in memberships.json())


async def test_listAttendees_patchedYearShownAndRemovedChildExcluded(client: AsyncClient) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "att.patched.org@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "att8")
    guardian_token, party_id = await _register(client, "GUEST", "att.patched.guardian@example.com")
    await _add_members(
        client,
        guardian_token,
        [
            {"name": "Bez Roku Jeszcze", "role_type": "CHILD"},
            {"name": "Do Usunięcia", "role_type": "CHILD", "birth_year": 2014},
        ],
    )
    await _rsvp(client, guardian_token, group_id, term_id)
    family_id = (await client.get("/api/families/mine", headers=_auth(guardian_token))).json()[0][
        "id"
    ]
    members = (
        await client.get(f"/api/families/{family_id}/guardians", headers=_auth(guardian_token))
    ).json()
    by_name = {m["display_name"]: m["family_membership_id"] for m in members}

    patched = await client.patch(
        f"/api/families/{family_id}/guardians/{by_name['Bez Roku Jeszcze']}",
        json={"birth_year": 2019},
        headers=_auth(guardian_token),
    )
    assert patched.status_code == 200
    removed = await client.delete(
        f"/api/families/{family_id}/guardians/{by_name['Do Usunięcia']}",
        headers=_auth(guardian_token),
    )
    assert removed.status_code == 204

    attendees = await _get_attendees(client, org_token, group_id, term_id)

    attendee = next(a for a in attendees if a["party_id"] == party_id)
    assert attendee["children"] == [{"birth_year": 2019}]
