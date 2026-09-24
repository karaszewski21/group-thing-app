"""Organizer side of the PRIVATE-group join-request lifecycle: approve /
reject, the cross-group pending list (`GET /api/groups/mine/join-requests`)
and the per-group pending list (`GET /api/groups/{group_id}/join-requests`).
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

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


async def _create_private_circle_and_term(
    client: AsyncClient, org_token: str, name: str
) -> tuple[int, int]:
    circle = await client.post(
        "/api/groups/mine/new", json={"name": name}, headers=_auth(org_token)
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
    patch = await client.patch(
        f"/api/groups/{group_id}",
        json={"name": name, "visibility": "PRIVATE"},
        headers=_auth(org_token),
    )
    assert patch.status_code == 200
    return group_id, term.json()["id"]


async def _request_access(
    client: AsyncClient, token: str, group_id: int, term_id: int | None = None
) -> int:
    response = await client.post(
        f"/api/groups/public/{group_id}/join-requests",
        json={"term_id": term_id},
        headers=_auth(token),
    )
    assert response.status_code == 201
    return int(response.json()["id"])


async def _notifications(client: AsyncClient, token: str, kind: str) -> list[dict[str, Any]]:
    response = await client.get("/api/notifications/mine", headers=_auth(token))
    assert response.status_code == 200
    return [n for n in response.json() if n["kind"] == kind]


async def _active_memberships_in(db: AsyncSession, party_id: int, group_id: int) -> int:
    memberships = await service.list_memberships_for_party(db, party_id)
    return sum(1 for m in memberships if m.to_group_id == group_id)


async def test_approveJoinRequest_organizer_createsMembershipSetsApprovedAndNotifiesRequester(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "jd.approve.org@example.com")
    group_id, term_id = await _create_private_circle_and_term(client, org_token, "Krąg jd-ok")
    guest_token, guest_party_id = await _register(client, "GUEST", "jd.approve.guest@example.com")
    request_id = await _request_access(client, guest_token, group_id, term_id)

    response = await client.post(
        f"/api/groups/{group_id}/join-requests/{request_id}/approve", headers=_auth(org_token)
    )

    assert response.status_code == 200
    assert response.json()["id"] == request_id
    assert response.json()["status"] == "APPROVED"
    assert await _active_memberships_in(db_session, guest_party_id, group_id) == 1
    notifications = await _notifications(client, guest_token, "GROUP_JOIN_APPROVED")
    assert len(notifications) == 1
    slug = await service.resolve_organizer_slug(db_session, group_id)
    assert notifications[0]["link_path"] == f"/{slug}/grupa/{group_id}/term/{term_id}"
    assert notifications[0]["join_request_id"] == request_id
    assert notifications[0]["message"] == (
        "Twoja prośba o dostęp do grupy „Krąg jd-ok” została zatwierdzona"
    )


async def test_approveJoinRequest_requesterAlreadyMember_noDuplicateMembership(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "jd.dupm.org@example.com")
    group_id, _term_id = await _create_private_circle_and_term(client, org_token, "Krąg jd-dupm")
    guest_token, guest_party_id = await _register(client, "GUEST", "jd.dupm.guest@example.com")
    request_id = await _request_access(client, guest_token, group_id)
    await service.add_active_membership(db_session, group_id, guest_party_id)

    response = await client.post(
        f"/api/groups/{group_id}/join-requests/{request_id}/approve", headers=_auth(org_token)
    )

    assert response.status_code == 200
    assert response.json()["status"] == "APPROVED"
    assert await _active_memberships_in(db_session, guest_party_id, group_id) == 1


async def test_decideJoinRequest_secondDecision_returns409(client: AsyncClient) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "jd.twice.org@example.com")
    group_id, _term_id = await _create_private_circle_and_term(client, org_token, "Krąg jd-twice")
    guest_token, _ = await _register(client, "GUEST", "jd.twice.guest@example.com")
    request_id = await _request_access(client, guest_token, group_id)
    base = f"/api/groups/{group_id}/join-requests/{request_id}"

    first = await client.post(f"{base}/approve", headers=_auth(org_token))
    second = await client.post(f"{base}/reject", headers=_auth(org_token))

    assert first.status_code == 200
    assert second.status_code == 409
    assert second.json()["message"] == "Ta prośba została już rozstrzygnięta"


async def test_rejectJoinRequest_organizer_setsRejectedAndNotifiesRequester(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "jd.reject.org@example.com")
    group_id, term_id = await _create_private_circle_and_term(client, org_token, "Krąg jd-rej")
    guest_token, guest_party_id = await _register(client, "GUEST", "jd.reject.guest@example.com")
    request_id = await _request_access(client, guest_token, group_id, term_id)

    response = await client.post(
        f"/api/groups/{group_id}/join-requests/{request_id}/reject", headers=_auth(org_token)
    )

    assert response.status_code == 200
    assert response.json()["status"] == "REJECTED"
    assert await _active_memberships_in(db_session, guest_party_id, group_id) == 0
    notifications = await _notifications(client, guest_token, "GROUP_JOIN_REJECTED")
    assert len(notifications) == 1
    slug = await service.resolve_organizer_slug(db_session, group_id)
    assert notifications[0]["link_path"] == f"/{slug}/grupa/{group_id}/term/{term_id}"
    assert notifications[0]["join_request_id"] == request_id
    assert notifications[0]["message"] == (
        "Twoja prośba o dostęp do grupy „Krąg jd-rej” została odrzucona"
    )


async def test_decideJoinRequest_nonOrganizer_returns403(client: AsyncClient) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "jd.403.org@example.com")
    group_id, _term_id = await _create_private_circle_and_term(client, org_token, "Krąg jd-403")
    guest_token, _ = await _register(client, "GUEST", "jd.403.guest@example.com")
    other_org_token, _ = await _register(client, "ORGANIZER", "jd.403.other@example.com")
    request_id = await _request_access(client, guest_token, group_id)
    base = f"/api/groups/{group_id}/join-requests/{request_id}"

    as_other_organizer = await client.post(f"{base}/approve", headers=_auth(other_org_token))
    as_requester = await client.post(f"{base}/reject", headers=_auth(guest_token))

    assert as_other_organizer.status_code == 403
    assert as_requester.status_code == 403


async def test_decideJoinRequest_requestFromOtherGroupPath_returns404(
    client: AsyncClient,
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "jd.404.org@example.com")
    group_id, _term_id = await _create_private_circle_and_term(client, org_token, "Krąg jd-404a")
    other_group_id, _ = await _create_private_circle_and_term(client, org_token, "Krąg jd-404b")
    guest_token, _ = await _register(client, "GUEST", "jd.404.guest@example.com")
    request_id = await _request_access(client, guest_token, group_id)

    response = await client.post(
        f"/api/groups/{other_group_id}/join-requests/{request_id}/approve",
        headers=_auth(org_token),
    )

    assert response.status_code == 404


async def test_listMyPendingJoinRequests_returnsOnlyOrganizedGroupsOldestFirstWithNames(
    client: AsyncClient,
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "jd.mine.org@example.com")
    group_a, _ = await _create_private_circle_and_term(client, org_token, "Krąg jd-mine-a")
    group_b, _ = await _create_private_circle_and_term(client, org_token, "Krąg jd-mine-b")
    foreign_org_token, _ = await _register(client, "ORGANIZER", "jd.mine.foreign@example.com")
    foreign_group, _ = await _create_private_circle_and_term(
        client, foreign_org_token, "Krąg jd-mine-f"
    )
    anna_token, anna_party_id = await _register(client, "GUEST", "jd.mine.anna@example.com")
    bob_token, bob_party_id = await _register(client, "GUEST", "jd.mine.bob@example.com")
    first_id = await _request_access(client, anna_token, group_b)
    second_id = await _request_access(client, bob_token, group_a)
    decided_id = await _request_access(client, bob_token, group_b)
    await _request_access(client, anna_token, foreign_group)
    rejected = await client.post(
        f"/api/groups/{group_b}/join-requests/{decided_id}/reject", headers=_auth(org_token)
    )
    assert rejected.status_code == 200

    response = await client.get("/api/groups/mine/join-requests", headers=_auth(org_token))
    as_guest = await client.get("/api/groups/mine/join-requests", headers=_auth(anna_token))

    assert response.status_code == 200
    body = response.json()
    assert [item["id"] for item in body] == [first_id, second_id]
    assert body[0]["group_id"] == group_b
    assert body[0]["group_name"] == "Krąg jd-mine-b"
    assert body[0]["requester_party_id"] == anna_party_id
    assert body[1]["group_name"] == "Krąg jd-mine-a"
    assert body[1]["requester_party_id"] == bob_party_id
    assert all(item["requester_display_name"] for item in body)
    assert as_guest.status_code == 200
    assert as_guest.json() == []


async def test_listGroupJoinRequests_organizer200OnlyPending_nonOrganizer403_unknown404(
    client: AsyncClient,
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "jd.group.org@example.com")
    group_id, _ = await _create_private_circle_and_term(client, org_token, "Krąg jd-group")
    other_group_id, _ = await _create_private_circle_and_term(client, org_token, "Krąg jd-grp2")
    anna_token, _ = await _register(client, "GUEST", "jd.group.anna@example.com")
    bob_token, _ = await _register(client, "GUEST", "jd.group.bob@example.com")
    pending_id = await _request_access(client, anna_token, group_id)
    withdrawn_id = await _request_access(client, bob_token, group_id)
    await _request_access(client, anna_token, other_group_id)
    withdrawn = await client.post(
        f"/api/groups/public/{group_id}/join-requests/{withdrawn_id}/withdraw",
        headers=_auth(bob_token),
    )
    assert withdrawn.status_code == 200
    url = f"/api/groups/{group_id}/join-requests"

    as_organizer = await client.get(url, headers=_auth(org_token))
    as_guest = await client.get(url, headers=_auth(anna_token))
    unknown = await client.get("/api/groups/999999999/join-requests", headers=_auth(org_token))

    assert as_organizer.status_code == 200
    assert [item["id"] for item in as_organizer.json()] == [pending_id]
    assert as_organizer.json()[0]["group_name"] == "Krąg jd-group"
    assert as_guest.status_code == 403
    assert unknown.status_code == 404


async def test_approveJoinRequest_afterGroupMadePublic_approvesAndCreatesMembership(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "jd.public.org@example.com")
    group_id, _term_id = await _create_private_circle_and_term(client, org_token, "Krąg jd-pub")
    guest_token, guest_party_id = await _register(client, "GUEST", "jd.public.guest@example.com")
    request_id = await _request_access(client, guest_token, group_id)
    made_public = await client.patch(
        f"/api/groups/{group_id}",
        json={"name": "Krąg jd-pub", "visibility": "PUBLIC"},
        headers=_auth(org_token),
    )
    assert made_public.status_code == 200

    response = await client.post(
        f"/api/groups/{group_id}/join-requests/{request_id}/approve", headers=_auth(org_token)
    )

    assert response.status_code == 200
    assert response.json()["status"] == "APPROVED"
    assert await _active_memberships_in(db_session, guest_party_id, group_id) == 1


async def test_decideJoinRequest_afterOrganizerChange_oldOrganizer403NewOrganizer200(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    old_org_token, _ = await _register(client, "ORGANIZER", "jd.handover.old@example.com")
    group_id, _term_id = await _create_private_circle_and_term(
        client, old_org_token, "Krąg jd-handover"
    )
    new_org_token, new_org_party_id = await _register(
        client, "ORGANIZER", "jd.handover.new@example.com"
    )
    guest_token, _ = await _register(client, "GUEST", "jd.handover.guest@example.com")
    request_id = await _request_access(client, guest_token, group_id)
    await service.assign_leadership(db_session, group_id, new_org_party_id, date.today())
    base = f"/api/groups/{group_id}/join-requests/{request_id}"

    as_old = await client.post(f"{base}/approve", headers=_auth(old_org_token))
    as_new = await client.post(f"{base}/reject", headers=_auth(new_org_token))

    assert as_old.status_code == 403
    assert as_new.status_code == 200
    assert as_new.json()["status"] == "REJECTED"


async def test_approveJoinRequest_withdrawnConcurrently_returns409WithoutMembership(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Deterministic stand-in for approve racing a withdraw: right after the
    approve use case loads the (still PENDING) request, the requester's
    withdraw is committed behind the ORM's back — status and the
    `updated_at` version column change in the row while the loaded object
    stays stale. Approve's UPDATE then matches no row, `StaleDataError`
    maps to 409 and the flushed membership is rolled back with it."""
    org_token, _ = await _register(client, "ORGANIZER", "jd.race.org@example.com")
    group_id, _term_id = await _create_private_circle_and_term(client, org_token, "Krąg jd-race")
    guest_token, guest_party_id = await _register(client, "GUEST", "jd.race.guest@example.com")
    request_id = await _request_access(client, guest_token, group_id)
    original_get = repository.get_join_request

    async def get_then_withdraw_behind_orm(db: AsyncSession, target_id: int) -> Any:
        join_request = await original_get(db, target_id)
        await db.execute(
            text(
                "UPDATE group_join_requests SET status = 'WITHDRAWN', "
                "updated_at = updated_at + interval '1 second' WHERE id = :id"
            ),
            {"id": target_id},
        )
        await db.commit()
        return join_request

    monkeypatch.setattr(repository, "get_join_request", get_then_withdraw_behind_orm)

    response = await client.post(
        f"/api/groups/{group_id}/join-requests/{request_id}/approve", headers=_auth(org_token)
    )

    assert response.status_code == 409
    await db_session.rollback()
    monkeypatch.undo()
    assert await _active_memberships_in(db_session, guest_party_id, group_id) == 0
    status = await db_session.execute(
        text("SELECT status FROM group_join_requests WHERE id = :id"), {"id": request_id}
    )
    assert status.scalar_one() == "WITHDRAWN"
    assert await _notifications(client, guest_token, "GROUP_JOIN_APPROVED") == []
