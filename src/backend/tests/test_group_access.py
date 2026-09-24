"""`GET /api/groups/public/{group_id}/access` — server-resolved caller
relationship to a Circle (is_member/is_organizer/can_view_content/join_request),
replacing the frontend's previous "any auth token = member view" heuristic.

Isolation via the `conftest.py` TestContainers + savepoint-rollback fixtures;
naming follows `action_condition_expectedResult`
(`standards/testing/backend-testing.md`).
"""

from __future__ import annotations

from datetime import date, timedelta

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.auth_deps import Principal
from app.core.security import decode_token
from app.groups import service
from app.users.service import get_profile_by_principal


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _register(client: AsyncClient, role: str, email: str) -> str:
    r = await client.post(
        "/api/auth/register", json={"role": role, "email": email, "password": "secret123"}
    )
    assert r.status_code == 201
    return r.json()["token"]


async def _create_circle(
    client: AsyncClient, token: str, name: str, visibility: str = "PUBLIC"
) -> int:
    r = await client.post("/api/groups/mine", json={"name": name}, headers=_auth(token))
    assert r.status_code == 201
    group_id = r.json()["id"]
    if visibility != "PUBLIC":
        r2 = await client.patch(
            f"/api/groups/{group_id}",
            json={"name": name, "layout_mode": "CIRCLE", "visibility": visibility},
            headers=_auth(token),
        )
        assert r2.status_code == 200
    return group_id


async def test_getGroupAccess_publicGroupUnauthenticated_canViewNoMembership(
    client: AsyncClient,
) -> None:
    org_token = await _register(client, "ORGANIZER", "access.org1@example.com")
    group_id = await _create_circle(client, org_token, "Access Public Circle")

    response = await client.get(f"/api/groups/public/{group_id}/access")

    assert response.status_code == 200
    body = response.json()
    assert body["group"]["id"] == group_id
    assert body["access"] == {
        "is_member": False,
        "is_organizer": False,
        "can_view_content": True,
        "join_request": None,
        "is_attending": False,
    }


async def test_getGroupAccess_organizerOwnGroup_reportsOrganizerAndMember(
    client: AsyncClient,
) -> None:
    org_token = await _register(client, "ORGANIZER", "access.org2@example.com")
    group_id = await _create_circle(client, org_token, "Access Organizer Circle")

    response = await client.get(f"/api/groups/public/{group_id}/access", headers=_auth(org_token))

    assert response.status_code == 200
    assert response.json()["access"] == {
        "is_member": True,
        "is_organizer": True,
        "can_view_content": True,
        "join_request": None,
        "is_attending": False,
    }


async def test_getGroupAccess_privateGroupUnrelatedLoggedInVisitor_cannotViewNoJoinRequest(
    client: AsyncClient,
) -> None:
    org_token = await _register(client, "ORGANIZER", "access.org3@example.com")
    group_id = await _create_circle(client, org_token, "Access Private Circle", "PRIVATE")
    visitor_token = await _register(client, "GUEST", "access.visitor3@example.com")

    response = await client.get(
        f"/api/groups/public/{group_id}/access", headers=_auth(visitor_token)
    )

    assert response.status_code == 200
    assert response.json()["access"] == {
        "is_member": False,
        "is_organizer": False,
        "can_view_content": False,
        "join_request": None,
        "is_attending": False,
    }


async def test_getGroupAccess_privateGroupUnauthenticated_cannotViewNoJoinRequest(
    client: AsyncClient,
) -> None:
    org_token = await _register(client, "ORGANIZER", "access.org4@example.com")
    group_id = await _create_circle(client, org_token, "Access Private Circle 4", "PRIVATE")

    response = await client.get(f"/api/groups/public/{group_id}/access")

    assert response.status_code == 200
    body = response.json()
    assert body["access"]["can_view_content"] is False
    assert body["access"]["join_request"] is None
    assert body["group"]["term"] is None
    assert body["group"]["guardians"] == []


async def test_getGroupAccess_loggedInAttendeeOfShownTerm_reportsAttending(
    client: AsyncClient,
) -> None:
    org_token = await _register(client, "ORGANIZER", "access.org5@example.com")
    group_id = await _create_circle(client, org_token, "Access Attending Circle")
    term = await client.post(
        "/api/terms",
        json={
            "circle_group_id": group_id,
            "occurs_on": (date.today() + timedelta(days=7)).isoformat(),
        },
        headers=_auth(org_token),
    )
    assert term.status_code == 201
    term_id = term.json()["id"]
    attendee_token = await _register(client, "GUEST", "access.attendee5@example.com")
    bystander_token = await _register(client, "GUEST", "access.bystander5@example.com")
    rsvp = await client.post(
        f"/api/groups/public/{group_id}/rsvp",
        json={"term_id": term_id, "guardian_name": "ignored"},
        headers=_auth(attendee_token),
    )
    assert rsvp.status_code == 201

    attendee = await client.get(
        f"/api/groups/public/{group_id}/access?term_id={term_id}", headers=_auth(attendee_token)
    )
    bystander = await client.get(
        f"/api/groups/public/{group_id}/access?term_id={term_id}", headers=_auth(bystander_token)
    )

    assert attendee.json()["access"]["is_attending"] is True
    assert bystander.json()["access"]["is_attending"] is False


async def _create_term(client: AsyncClient, org_token: str, group_id: int) -> int:
    term = await client.post(
        "/api/terms",
        json={
            "circle_group_id": group_id,
            "occurs_on": (date.today() + timedelta(days=7)).isoformat(),
        },
        headers=_auth(org_token),
    )
    assert term.status_code == 201
    return int(term.json()["id"])


async def _add_member(db_session: AsyncSession, token: str, group_id: int) -> None:
    username = decode_token(token, settings.jwt_secret)["sub"]
    profile = await get_profile_by_principal(
        db_session, Principal(username=username, authorities=frozenset())
    )
    await service.add_active_membership(db_session, group_id, profile.party_id)
    await db_session.commit()


async def _private_circle_with_member_and_term(
    client: AsyncClient, db_session: AsyncSession, prefix: str
) -> tuple[int, int, str]:
    org_token = await _register(client, "ORGANIZER", f"access.{prefix}.org@example.com")
    group_id = await _create_circle(client, org_token, f"Access {prefix}")
    term_id = await _create_term(client, org_token, group_id)
    r = await client.patch(
        f"/api/groups/{group_id}",
        json={"name": f"Access {prefix}", "layout_mode": "CIRCLE", "visibility": "PRIVATE"},
        headers=_auth(org_token),
    )
    assert r.status_code == 200
    member_token = await _register(client, "GUEST", f"access.{prefix}.member@example.com")
    await _add_member(db_session, member_token, group_id)
    return group_id, term_id, member_token


async def test_getGroupAccess_privateMember_returnsFullContentAndIsAttending(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    group_id, term_id, member_token = await _private_circle_with_member_and_term(
        client, db_session, "pm1"
    )
    rsvp = await client.post(
        f"/api/groups/public/{group_id}/rsvp",
        json={"term_id": term_id, "guardian_name": "ignored"},
        headers=_auth(member_token),
    )
    assert rsvp.status_code == 201

    response = await client.get(
        f"/api/groups/public/{group_id}/access?term_id={term_id}", headers=_auth(member_token)
    )

    assert response.status_code == 200
    body = response.json()
    assert body["group"]["term"]["id"] == term_id
    assert len(body["group"]["guardians"]) == 1
    assert body["access"]["is_member"] is True
    assert body["access"]["can_view_content"] is True
    assert body["access"]["is_attending"] is True


async def test_getGroupAccess_privateMemberForeignTermId_returns404(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    group_id, _term_id, member_token = await _private_circle_with_member_and_term(
        client, db_session, "pm2"
    )
    other_org_token = await _register(client, "ORGANIZER", "access.pm2.other@example.com")
    other_group_id = await _create_circle(client, other_org_token, "Access pm2 other")
    foreign_term_id = await _create_term(client, other_org_token, other_group_id)

    response = await client.get(
        f"/api/groups/public/{group_id}/access?term_id={foreign_term_id}",
        headers=_auth(member_token),
    )

    assert response.status_code == 404


async def test_getGroupAccess_privateOutsiderForeignTermId_keepsReduced200(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    group_id, _term_id, _member_token = await _private_circle_with_member_and_term(
        client, db_session, "pm3"
    )
    outsider_token = await _register(client, "GUEST", "access.pm3.outsider@example.com")

    response = await client.get(
        f"/api/groups/public/{group_id}/access?term_id=999999999",
        headers=_auth(outsider_token),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["group"]["term"] is None
    assert body["access"]["can_view_content"] is False


async def test_getPublicCircleView_privateGroup_staysReducedForMember(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    group_id, term_id, member_token = await _private_circle_with_member_and_term(
        client, db_session, "pm4"
    )

    response = await client.get(
        f"/api/groups/public/{group_id}?term_id={term_id}", headers=_auth(member_token)
    )

    assert response.status_code == 200
    body = response.json()
    assert body["term"] is None
    assert body["guardians"] == []


async def _private_circle_with_outsider(
    client: AsyncClient, prefix: str
) -> tuple[int, int, str, str]:
    org_token = await _register(client, "ORGANIZER", f"access.{prefix}.org@example.com")
    group_id = await _create_circle(client, org_token, f"Access {prefix}")
    term_id = await _create_term(client, org_token, group_id)
    r = await client.patch(
        f"/api/groups/{group_id}",
        json={"name": f"Access {prefix}", "layout_mode": "CIRCLE", "visibility": "PRIVATE"},
        headers=_auth(org_token),
    )
    assert r.status_code == 200
    outsider_token = await _register(client, "GUEST", f"access.{prefix}.outsider@example.com")
    return group_id, term_id, org_token, outsider_token


async def _request_access(client: AsyncClient, token: str, group_id: int, term_id: int) -> int:
    r = await client.post(
        f"/api/groups/public/{group_id}/join-requests",
        json={"term_id": term_id},
        headers=_auth(token),
    )
    assert r.status_code == 201
    return int(r.json()["id"])


async def _access(client: AsyncClient, token: str, group_id: int, term_id: int) -> dict:
    r = await client.get(
        f"/api/groups/public/{group_id}/access?term_id={term_id}", headers=_auth(token)
    )
    assert r.status_code == 200
    return r.json()


async def test_getGroupAccess_requestLifecycle_joinRequestPendingThenRejectedThenNullAfterWithdraw(
    client: AsyncClient,
) -> None:
    group_id, term_id, org_token, outsider_token = await _private_circle_with_outsider(
        client, "jr1"
    )

    first_id = await _request_access(client, outsider_token, group_id, term_id)
    pending = await _access(client, outsider_token, group_id, term_id)
    reject = await client.post(
        f"/api/groups/{group_id}/join-requests/{first_id}/reject", headers=_auth(org_token)
    )
    assert reject.status_code == 200
    rejected = await _access(client, outsider_token, group_id, term_id)
    second_id = await _request_access(client, outsider_token, group_id, term_id)
    withdraw = await client.post(
        f"/api/groups/public/{group_id}/join-requests/{second_id}/withdraw",
        headers=_auth(outsider_token),
    )
    assert withdraw.status_code == 200
    withdrawn = await _access(client, outsider_token, group_id, term_id)

    assert pending["access"]["join_request"] == {"id": first_id, "status": "PENDING"}
    assert rejected["access"]["join_request"] == {"id": first_id, "status": "REJECTED"}
    assert withdrawn["access"]["join_request"] is None
    assert withdrawn["access"]["can_view_content"] is False


async def test_getGroupAccess_pendingOrRejectedCaller_termIsNone(
    client: AsyncClient,
) -> None:
    group_id, term_id, org_token, outsider_token = await _private_circle_with_outsider(
        client, "jr2"
    )

    request_id = await _request_access(client, outsider_token, group_id, term_id)
    pending = await _access(client, outsider_token, group_id, term_id)
    reject = await client.post(
        f"/api/groups/{group_id}/join-requests/{request_id}/reject", headers=_auth(org_token)
    )
    assert reject.status_code == 200
    rejected = await _access(client, outsider_token, group_id, term_id)

    for body in (pending, rejected):
        assert body["group"]["term"] is None
        assert body["group"]["guardians"] == []
        assert body["access"]["can_view_content"] is False
        assert body["access"]["is_member"] is False


async def test_getGroupAccess_approvedMember_fullContentAndRsvpReturns201(
    client: AsyncClient,
) -> None:
    group_id, term_id, org_token, outsider_token = await _private_circle_with_outsider(
        client, "jr3"
    )
    request_id = await _request_access(client, outsider_token, group_id, term_id)
    approve = await client.post(
        f"/api/groups/{group_id}/join-requests/{request_id}/approve", headers=_auth(org_token)
    )
    assert approve.status_code == 200

    rsvp = await client.post(
        f"/api/groups/public/{group_id}/rsvp",
        json={"term_id": term_id, "guardian_name": "ignored"},
        headers=_auth(outsider_token),
    )
    body = await _access(client, outsider_token, group_id, term_id)

    assert rsvp.status_code == 201
    assert body["group"]["term"]["id"] == term_id
    assert body["access"]["is_member"] is True
    assert body["access"]["can_view_content"] is True
    assert body["access"]["is_attending"] is True
    assert body["access"]["join_request"] is None


async def test_getGroupAccess_exMemberLatestApproved_joinRequestNull(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    group_id, term_id, org_token, outsider_token = await _private_circle_with_outsider(
        client, "jr4"
    )
    request_id = await _request_access(client, outsider_token, group_id, term_id)
    approve = await client.post(
        f"/api/groups/{group_id}/join-requests/{request_id}/approve", headers=_auth(org_token)
    )
    assert approve.status_code == 200
    username = decode_token(outsider_token, settings.jwt_secret)["sub"]
    profile = await get_profile_by_principal(
        db_session, Principal(username=username, authorities=frozenset())
    )
    (membership,) = await service.list_memberships_for_party(db_session, profile.party_id)
    ended = await client.post(
        f"/api/memberships/{membership.id}/end", headers=_auth(outsider_token)
    )
    assert ended.status_code == 200

    body = await _access(client, outsider_token, group_id, term_id)

    assert body["access"]["is_member"] is False
    assert body["access"]["can_view_content"] is False
    assert body["access"]["join_request"] is None
    assert body["group"]["term"] is None
