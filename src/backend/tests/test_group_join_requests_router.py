"""Requester side of the PRIVATE-group join-request lifecycle:
`POST /api/groups/public/{group_id}/join-requests` (create, idempotent) and
`POST /api/groups/public/{group_id}/join-requests/{request_id}/withdraw`.

Flat `tests/` placement, same convention as `test_group_privacy.py`.
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import AuthenticationRequiredException, Principal
from app.groups import service
from app.groups.infrastructure import repository


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _register(client: AsyncClient, role: str, email: str) -> tuple[str, int]:
    r = await client.post(
        "/api/auth/register", json={"role": role, "email": email, "password": "secret123"}
    )
    assert r.status_code == 201
    return r.json()["token"], r.json()["party_id"]


async def _create_circle_and_term(
    client: AsyncClient, org_token: str, prefix: str, *, private: bool = True
) -> tuple[int, int]:
    circle = await client.post(
        "/api/groups/mine", json={"name": f"Krąg {prefix}"}, headers=_auth(org_token)
    )
    assert circle.status_code == 201
    group_id = circle.json()["id"]
    term = await client.post(
        "/api/terms",
        json={
            "circle_group_id": group_id,
            "occurs_on": (date.today() + timedelta(days=7)).isoformat(),
        },
        headers=_auth(org_token),
    )
    assert term.status_code == 201
    if private:
        patch = await client.patch(
            f"/api/groups/{group_id}",
            json={"name": f"Krąg {prefix}", "visibility": "PRIVATE"},
            headers=_auth(org_token),
        )
        assert patch.status_code == 200
    return group_id, term.json()["id"]


async def _join_request_notifications(client: AsyncClient, org_token: str) -> list[dict[str, Any]]:
    response = await client.get("/api/notifications/mine", headers=_auth(org_token))
    assert response.status_code == 200
    return [n for n in response.json() if n["kind"] == "GROUP_JOIN_REQUESTED"]


async def test_createJoinRequest_anonymous_returns401(client: AsyncClient) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "jr.anon.org@example.com")
    group_id, _term_id = await _create_circle_and_term(client, org_token, "jr-anon")

    response = await client.post(f"/api/groups/public/{group_id}/join-requests", json={})

    assert response.status_code == 401


async def test_createJoinRequest_publicGroup_returns404(client: AsyncClient) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "jr.public.org@example.com")
    group_id, _term_id = await _create_circle_and_term(
        client, org_token, "jr-public", private=False
    )
    guest_token, _ = await _register(client, "GUEST", "jr.public.guest@example.com")

    response = await client.post(
        f"/api/groups/public/{group_id}/join-requests", json={}, headers=_auth(guest_token)
    )

    assert response.status_code == 404


async def test_createJoinRequest_success_returns201PendingAndNotifiesOrganizer(
    client: AsyncClient,
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "jr.ok.org@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "jr-ok")
    guest_token, guest_party_id = await _register(client, "GUEST", "jr.ok.guest@example.com")

    response = await client.post(
        f"/api/groups/public/{group_id}/join-requests",
        json={"term_id": term_id},
        headers=_auth(guest_token),
    )

    assert response.status_code == 201
    body = response.json()
    assert body["status"] == "PENDING"
    assert body["group_id"] == group_id
    assert body["requester_party_id"] == guest_party_id
    assert body["term_id"] == term_id
    notifications = await _join_request_notifications(client, org_token)
    assert len(notifications) == 1
    assert notifications[0]["join_request_id"] == body["id"]
    assert notifications[0]["link_path"] == "/panel"
    assert "prosi o dostęp do grupy „Krąg jr-ok”" in notifications[0]["message"]


async def test_createJoinRequest_duplicate_returnsSameIdWithoutSecondNotification(
    client: AsyncClient,
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "jr.dup.org@example.com")
    group_id, _term_id = await _create_circle_and_term(client, org_token, "jr-dup")
    guest_token, _ = await _register(client, "GUEST", "jr.dup.guest@example.com")
    url = f"/api/groups/public/{group_id}/join-requests"

    first = await client.post(url, json={}, headers=_auth(guest_token))
    second = await client.post(url, json={}, headers=_auth(guest_token))

    assert first.status_code == 201
    assert second.status_code == 201
    assert second.json()["id"] == first.json()["id"]
    notifications = await _join_request_notifications(client, org_token)
    assert len(notifications) == 1
    assert notifications[0]["link_path"] == "/panel"


async def test_createJoinRequest_memberOrOrganizer_returns409(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "jr.member.org@example.com")
    group_id, _term_id = await _create_circle_and_term(client, org_token, "jr-member")
    member_token, member_party_id = await _register(client, "GUEST", "jr.member.guest@example.com")
    await service.add_active_membership(db_session, group_id, member_party_id)
    url = f"/api/groups/public/{group_id}/join-requests"

    as_member = await client.post(url, json={}, headers=_auth(member_token))
    as_organizer = await client.post(url, json={}, headers=_auth(org_token))

    assert as_member.status_code == 409
    assert as_member.json()["message"] == "Masz już dostęp do tej grupy"
    assert as_organizer.status_code == 409


async def test_createJoinRequest_foreignOrUnknownTermId_returns201WithNullTermId(
    client: AsyncClient,
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "jr.foreign.org@example.com")
    group_id, _term_id = await _create_circle_and_term(client, org_token, "jr-foreign")
    other_org_token, _ = await _register(client, "ORGANIZER", "jr.foreign.org2@example.com")
    _other_group_id, foreign_term_id = await _create_circle_and_term(
        client, other_org_token, "jr-foreign2"
    )
    foreign_guest_token, _ = await _register(client, "GUEST", "jr.foreign.guest@example.com")
    unknown_guest_token, _ = await _register(client, "GUEST", "jr.unknown.guest@example.com")
    url = f"/api/groups/public/{group_id}/join-requests"

    foreign = await client.post(
        url, json={"term_id": foreign_term_id}, headers=_auth(foreign_guest_token)
    )
    unknown = await client.post(
        url, json={"term_id": 999_999_999}, headers=_auth(unknown_guest_token)
    )

    assert foreign.status_code == 201
    assert foreign.json()["term_id"] is None
    assert unknown.status_code == 201
    assert unknown.json()["term_id"] is None
    assert len(await _join_request_notifications(client, org_token)) == 2


async def test_createJoinRequest_afterRecentWithdrawOrReject_createsRequestWithoutNotification(
    client: AsyncClient,
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "jr.spam.org@example.com")
    group_id, _term_id = await _create_circle_and_term(client, org_token, "jr-spam")
    guest_token, _ = await _register(client, "GUEST", "jr.spam.guest@example.com")
    url = f"/api/groups/public/{group_id}/join-requests"
    first = await client.post(url, json={}, headers=_auth(guest_token))
    withdrawn = await client.post(
        f"{url}/{first.json()['id']}/withdraw", headers=_auth(guest_token)
    )
    assert withdrawn.status_code == 200

    after_withdraw = await client.post(url, json={}, headers=_auth(guest_token))
    rejected = await client.post(
        f"/api/groups/{group_id}/join-requests/{after_withdraw.json()['id']}/reject",
        headers=_auth(org_token),
    )
    assert rejected.status_code == 200
    after_reject = await client.post(url, json={}, headers=_auth(guest_token))

    assert after_withdraw.status_code == 201
    assert after_reject.status_code == 201
    assert after_reject.json()["status"] == "PENDING"
    assert len({first.json()["id"], after_withdraw.json()["id"], after_reject.json()["id"]}) == 3
    assert len(await _join_request_notifications(client, org_token)) == 1
    pending = await client.get("/api/groups/mine/join-requests", headers=_auth(org_token))
    assert [item["id"] for item in pending.json()] == [after_reject.json()["id"]]


async def test_createJoinRequest_afterRejectOlderThan24h_notifiesOrganizerAgain(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "jr.old.org@example.com")
    group_id, _term_id = await _create_circle_and_term(client, org_token, "jr-old")
    guest_token, _ = await _register(client, "GUEST", "jr.old.guest@example.com")
    url = f"/api/groups/public/{group_id}/join-requests"
    first = await client.post(url, json={}, headers=_auth(guest_token))
    rejected = await client.post(
        f"/api/groups/{group_id}/join-requests/{first.json()['id']}/reject",
        headers=_auth(org_token),
    )
    assert rejected.status_code == 200
    await db_session.execute(
        text(
            "UPDATE group_join_requests SET updated_at = updated_at - interval '25 hours' "
            "WHERE id = :id"
        ),
        {"id": first.json()["id"]},
    )

    again = await client.post(url, json={}, headers=_auth(guest_token))

    assert again.status_code == 201
    assert len(await _join_request_notifications(client, org_token)) == 2


async def test_createJoinRequest_concurrentPendingInsert_returnsWinnerWithoutNotification(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Deterministic stand-in for two concurrent creates: the pre-check is
    patched so that, right after it finds nothing, a competing PENDING row
    is inserted (as the racing transaction would). The ORM insert then hits
    `uq_group_join_requests_pending_requester_group` inside its SAVEPOINT
    and the use case must fall back to the competing row."""
    org_token, _ = await _register(client, "ORGANIZER", "jr.race.org@example.com")
    group_id, _term_id = await _create_circle_and_term(client, org_token, "jr-race")
    guest_token, guest_party_id = await _register(client, "GUEST", "jr.race.guest@example.com")
    original_find = repository.find_pending_join_request
    competing_ids: list[int] = []

    async def find_then_lose_race(
        db: AsyncSession, requester_party_id: int, target_group_id: int
    ) -> Any:
        found = await original_find(db, requester_party_id, target_group_id)
        if not competing_ids:
            inserted = await db.execute(
                text(
                    "INSERT INTO group_join_requests "
                    "(id, group_id, requester_party_id, term_id, status, created_at, updated_at) "
                    "VALUES (nextval('group_join_request_seq'), :group_id, :party_id, NULL, "
                    "'PENDING', now(), now()) RETURNING id"
                ),
                {"group_id": target_group_id, "party_id": requester_party_id},
            )
            competing_ids.append(inserted.scalar_one())
        return found

    monkeypatch.setattr(repository, "find_pending_join_request", find_then_lose_race)

    response = await client.post(
        f"/api/groups/public/{group_id}/join-requests", json={}, headers=_auth(guest_token)
    )

    assert response.status_code == 201
    assert response.json()["id"] == competing_ids[0]
    assert response.json()["requester_party_id"] == guest_party_id
    assert response.json()["status"] == "PENDING"
    assert await _join_request_notifications(client, org_token) == []


async def test_joinRequestUseCases_principalWithoutProfile_raiseAuthenticationRequired(
    db_session: AsyncSession,
) -> None:
    ghost = Principal(username="jr.ghost@example.com", authorities=frozenset())

    with pytest.raises(AuthenticationRequiredException):
        await service.list_my_pending_join_requests(db_session, ghost)
    with pytest.raises(AuthenticationRequiredException):
        await service.list_group_pending_join_requests(db_session, ghost, 999_999_999)
    with pytest.raises(AuthenticationRequiredException):
        await service.withdraw_join_request(db_session, ghost, 999_999_999, 999_999_999)
    with pytest.raises(AuthenticationRequiredException):
        await service.approve_join_request(db_session, ghost, 999_999_999, 999_999_999)
    with pytest.raises(AuthenticationRequiredException):
        await service.reject_join_request(db_session, ghost, 999_999_999, 999_999_999)


async def test_withdrawJoinRequest_stranger_returns403(client: AsyncClient) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "jr.wstranger.org@example.com")
    group_id, _term_id = await _create_circle_and_term(client, org_token, "jr-wstranger")
    guest_token, _ = await _register(client, "GUEST", "jr.wstranger.guest@example.com")
    stranger_token, _ = await _register(client, "GUEST", "jr.wstranger.other@example.com")
    created = await client.post(
        f"/api/groups/public/{group_id}/join-requests", json={}, headers=_auth(guest_token)
    )
    assert created.status_code == 201

    response = await client.post(
        f"/api/groups/public/{group_id}/join-requests/{created.json()['id']}/withdraw",
        headers=_auth(stranger_token),
    )

    assert response.status_code == 403


async def test_withdrawJoinRequest_owner_setsWithdrawnWithoutNotification(
    client: AsyncClient,
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "jr.wowner.org@example.com")
    group_id, _term_id = await _create_circle_and_term(client, org_token, "jr-wowner")
    guest_token, _ = await _register(client, "GUEST", "jr.wowner.guest@example.com")
    created = await client.post(
        f"/api/groups/public/{group_id}/join-requests", json={}, headers=_auth(guest_token)
    )
    assert created.status_code == 201
    withdraw_url = f"/api/groups/public/{group_id}/join-requests/{created.json()['id']}/withdraw"
    notifications_before = await client.get("/api/notifications/mine", headers=_auth(org_token))

    response = await client.post(withdraw_url, headers=_auth(guest_token))

    assert response.status_code == 200
    assert response.json()["id"] == created.json()["id"]
    assert response.json()["status"] == "WITHDRAWN"
    notifications_after = await client.get("/api/notifications/mine", headers=_auth(org_token))
    assert len(notifications_after.json()) == len(notifications_before.json())

    again = await client.post(withdraw_url, headers=_auth(guest_token))

    assert again.status_code == 409
    assert again.json()["message"] == "Ta prośba została już rozstrzygnięta"


async def test_createJoinRequest_noActiveOrganizer_returns409WithoutRequest(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "jr.noorg.org@example.com")
    group_id, _term_id = await _create_circle_and_term(client, org_token, "jr-noorg")
    guest_token, _ = await _register(client, "GUEST", "jr.noorg.guest@example.com")
    leadership = await service.get_current_leadership(db_session, group_id)
    assert leadership is not None
    await service.remove_leadership(db_session, leadership.id, date.today())

    response = await client.post(
        f"/api/groups/public/{group_id}/join-requests", json={}, headers=_auth(guest_token)
    )

    assert response.status_code == 409
    assert response.json()["message"] == "Ta grupa nie ma teraz organizatora"
    access = await client.get(f"/api/groups/public/{group_id}/access", headers=_auth(guest_token))
    assert access.json()["access"]["join_request"] is None


async def test_withdrawJoinRequest_afterApproval_returns409AndKeepsApproved(
    client: AsyncClient,
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "jr.wdecided.org@example.com")
    group_id, _term_id = await _create_circle_and_term(client, org_token, "jr-wdecided")
    guest_token, _ = await _register(client, "GUEST", "jr.wdecided.guest@example.com")
    created = await client.post(
        f"/api/groups/public/{group_id}/join-requests", json={}, headers=_auth(guest_token)
    )
    request_id = created.json()["id"]
    approved = await client.post(
        f"/api/groups/{group_id}/join-requests/{request_id}/approve", headers=_auth(org_token)
    )
    assert approved.status_code == 200

    response = await client.post(
        f"/api/groups/public/{group_id}/join-requests/{request_id}/withdraw",
        headers=_auth(guest_token),
    )

    assert response.status_code == 409
    assert response.json()["message"] == "Ta prośba została już rozstrzygnięta"
    access = await client.get(f"/api/groups/public/{group_id}/access", headers=_auth(guest_token))
    assert access.json()["access"]["is_member"] is True
