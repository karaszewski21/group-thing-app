"""Re-RSVP after a withdrawal: the withdrawn `TermAttendance` row is
reactivated, and a withdrawn row no longer counts as attending nor shows
in the public guardians list.

Isolation via the `conftest.py` TestContainers + savepoint-rollback fixtures;
naming follows `action_condition_expectedResult`
(`standards/testing/backend-testing.md`).
"""

from __future__ import annotations

from datetime import date, timedelta

from httpx import AsyncClient

from tests.conftest import create_location


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _register(client: AsyncClient, role: str, email: str) -> tuple[str, str]:
    r = await client.post(
        "/api/auth/register", json={"role": role, "email": email, "password": "secret123"}
    )
    assert r.status_code == 201
    return r.json()["token"], r.json()["party_id"]


async def _circle_and_term(client: AsyncClient, org_token: str, name: str) -> tuple[str, str]:
    circle = await client.post("/api/groups/mine", json={"name": name}, headers=_auth(org_token))
    assert circle.status_code == 201
    group_id = circle.json()["id"]
    term = await client.post(
        "/api/terms",
        json={
            "location_id": await create_location(client, _auth(org_token)),
            "group_id": group_id,
            "occurs_on": (date.today() + timedelta(days=7)).isoformat(),
        },
        headers=_auth(org_token),
    )
    assert term.status_code == 201
    return group_id, term.json()["id"]


async def _rsvp(client: AsyncClient, token: str, group_id: str, term_id: str) -> str:
    r = await client.post(
        f"/api/groups/{group_id}/rsvp",
        json={"term_id": term_id, "guardian_name": "ignored"},
        headers=_auth(token),
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def _withdraw(client: AsyncClient, token: str, attendance_id: str) -> None:
    r = await client.post(
        f"/api/groups/mine/attendances/{attendance_id}/withdraw", headers=_auth(token)
    )
    assert r.status_code == 200, r.text


async def _access(client: AsyncClient, token: str, group_id: str, term_id: str) -> dict:
    r = await client.get(
        f"/api/public/groups/{group_id}/access?term_id={term_id}", headers=_auth(token)
    )
    assert r.status_code == 200, r.text
    return r.json()


async def test_rsvp_afterWithdraw_reactivatesAttendance(client: AsyncClient) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "reactivate.org1@example.com")
    group_id, term_id = await _circle_and_term(client, org_token, "Reactivate Circle 1")
    guest_token, _ = await _register(client, "GUEST", "reactivate.guest1@example.com")
    attendance_id = await _rsvp(client, guest_token, group_id, term_id)
    await _withdraw(client, guest_token, attendance_id)

    again_id = await _rsvp(client, guest_token, group_id, term_id)
    body = await _access(client, guest_token, group_id, term_id)

    assert again_id == attendance_id
    assert body["access"]["is_attending"] is True
    assert body["access"]["is_active_attendee"] is True


async def test_access_withdrawnAttendee_notAttendingAndNotListedPublicly(
    client: AsyncClient,
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "reactivate.org2@example.com")
    group_id, term_id = await _circle_and_term(client, org_token, "Reactivate Circle 2")
    guest_token, guest_party = await _register(client, "GUEST", "reactivate.guest2@example.com")
    attendance_id = await _rsvp(client, guest_token, group_id, term_id)
    await _withdraw(client, guest_token, attendance_id)

    body = await _access(client, guest_token, group_id, term_id)

    assert body["access"]["is_attending"] is False
    assert body["access"]["is_active_attendee"] is False
    assert guest_party not in [g["party_id"] for g in body["group"]["guardians"]]
