"""PRIVATE-group join codes: the organizer's lazy `GET /api/groups/{id}/join-code`
and `POST .../join-code/regenerate`, and the visitor's
`POST /api/groups/public/{id}/join-code` redeem (error order, idempotent
`{created: false}`, the in-memory failure limiter and the lazy-GET
`StaleDataError` recovery)."""

from __future__ import annotations

import logging
import uuid
from datetime import timedelta
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import clock
from app.groups import service
from app.groups.application.join_code_limiter import limiter
from app.groups.infrastructure import repository

WRONG_CODE_MESSAGE = "Nieprawidłowy kod dostępu — sprawdź i spróbuj ponownie"
PUBLIC_GROUP_MESSAGE = "Grupa jest publiczna — kod dostępu nie jest potrzebny"


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _register(client: AsyncClient, role: str, email: str) -> tuple[str, uuid.UUID]:
    r = await client.post(
        "/api/auth/register", json={"role": role, "email": email, "password": "secret123"}
    )
    assert r.status_code == 201, r.text
    return r.json()["token"], uuid.UUID(r.json()["party_id"])


async def _create_circle_and_term(
    client: AsyncClient, org_token: str, prefix: str, *, private: bool = True
) -> tuple[str, str]:
    circle = await client.post(
        "/api/groups/mine/new", json={"name": f"Krąg {prefix}"}, headers=_auth(org_token)
    )
    assert circle.status_code == 201, circle.text
    group_id = circle.json()["id"]
    term = await client.post(
        "/api/terms",
        json={
            "circle_group_id": group_id,
            "occurs_on": (clock.local_now() + timedelta(days=7)).replace(microsecond=0).isoformat(),
        },
        headers=_auth(org_token),
    )
    assert term.status_code == 201, term.text
    if private:
        patch = await client.patch(
            f"/api/groups/{group_id}",
            json={"name": f"Krąg {prefix}", "visibility": "PRIVATE"},
            headers=_auth(org_token),
        )
        assert patch.status_code == 200, patch.text
    return group_id, term.json()["id"]


async def _get_code(client: AsyncClient, org_token: str, group_id: str) -> str:
    response = await client.get(f"/api/groups/{group_id}/join-code", headers=_auth(org_token))
    assert response.status_code == 200, response.text
    code: str = response.json()["code"]
    return code


async def _redeem(client: AsyncClient, token: str | None, group_id: str, code: str) -> Any:
    headers = _auth(token) if token is not None else {}
    return await client.post(
        f"/api/groups/public/{group_id}/join-code", json={"code": code}, headers=headers
    )


def _other_code(code: str) -> str:
    return f"{(int(code) + 1) % 10**6:06d}"


async def _active_memberships_in(db: AsyncSession, party_id: uuid.UUID, group_id: str) -> int:
    memberships = await service.list_memberships_for_party(db, party_id)
    return sum(1 for m in memberships if str(m.to_group_id) == group_id)


async def test_getJoinCode_twice_returnsSameCode_regenerateRotatesIt(client: AsyncClient) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "jc.rotate.org@example.com")
    group_id, _term_id = await _create_circle_and_term(client, org_token, "jc-rotate")
    guest_token, _ = await _register(client, "GUEST", "jc.rotate.guest@example.com")

    first = await _get_code(client, org_token, group_id)
    second = await _get_code(client, org_token, group_id)
    regenerated = await client.post(
        f"/api/groups/{group_id}/join-code/regenerate", headers=_auth(org_token)
    )
    assert regenerated.status_code == 200, regenerated.text
    new_code = regenerated.json()["code"]
    if new_code == first:  # 1-in-a-million collision: rotate once more
        new_code = (
            await client.post(
                f"/api/groups/{group_id}/join-code/regenerate", headers=_auth(org_token)
            )
        ).json()["code"]

    assert len(first) == 6 and first.isdigit()
    assert second == first
    assert regenerated.json().keys() == {"code"}
    old = await _redeem(client, guest_token, group_id, first)
    assert old.status_code == 409, old.text
    new = await _redeem(client, guest_token, group_id, new_code)
    assert new.status_code == 200, new.text


@pytest.mark.parametrize(
    ("method", "suffix"), [("GET", "join-code"), ("POST", "join-code/regenerate")]
)
async def test_getAndRegenerateJoinCode_errorOrder_404_403_409(
    client: AsyncClient, method: str, suffix: str
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", f"jc.order.org.{method}@example.com")
    group_id, _term_id = await _create_circle_and_term(client, org_token, f"jc-order-{method}")
    member_token, _ = await _register(client, "GUEST", f"jc.order.member.{method}@example.com")
    joined = await _redeem(
        client, member_token, group_id, await _get_code(client, org_token, group_id)
    )
    assert joined.json() == {"created": True}
    public_id, _ = await _create_circle_and_term(
        client, org_token, f"jc-order-pub-{method}", private=False
    )
    deleted_id, _ = await _create_circle_and_term(client, org_token, f"jc-order-del-{method}")
    deleted = await client.delete(f"/api/groups/{deleted_id}", headers=_auth(org_token))
    assert deleted.status_code == 204, deleted.text

    async def call(token: str, gid: str) -> Any:
        return await client.request(method, f"/api/groups/{gid}/{suffix}", headers=_auth(token))

    assert (await call(org_token, str(uuid.uuid4()))).status_code == 404
    assert (await call(org_token, deleted_id)).status_code == 404
    assert (await call(member_token, group_id)).status_code == 403
    public = await call(org_token, public_id)
    assert public.status_code == 409
    assert public.json()["message"] == PUBLIC_GROUP_MESSAGE


async def test_redeemJoinCode_validCode_createdTrue_accessViewable_rsvp201(
    client: AsyncClient,
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "jc.ok.org@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "jc-ok")
    guest_token, _ = await _register(client, "GUEST", "jc.ok.guest@example.com")
    code = await _get_code(client, org_token, group_id)

    response = await _redeem(client, guest_token, group_id, code)

    assert response.status_code == 200, response.text
    assert response.json() == {"created": True}
    access = await client.get(f"/api/groups/public/{group_id}/access", headers=_auth(guest_token))
    assert access.json()["access"]["can_view_content"] is True
    rsvp = await client.post(
        f"/api/groups/public/{group_id}/rsvp",
        json={"term_id": term_id, "guardian_name": "ignored"},
        headers=_auth(guest_token),
    )
    assert rsvp.status_code == 201, rsvp.text


async def test_redeemJoinCode_errors_401_404_400_sameMessage409(client: AsyncClient) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "jc.err.org@example.com")
    group_id, _term_id = await _create_circle_and_term(client, org_token, "jc-err")
    no_code_id, _ = await _create_circle_and_term(client, org_token, "jc-err-nocode")
    public_id, _ = await _create_circle_and_term(client, org_token, "jc-err-pub", private=False)
    guest_token, _ = await _register(client, "GUEST", "jc.err.guest@example.com")
    code = await _get_code(client, org_token, group_id)

    assert (await _redeem(client, None, group_id, code)).status_code == 401
    assert (await _redeem(client, guest_token, public_id, "123456")).status_code == 404
    assert (await _redeem(client, guest_token, str(uuid.uuid4()), "123456")).status_code == 404
    malformed = await _redeem(client, guest_token, group_id, "12345")
    assert malformed.status_code == 400, malformed.text
    wrong = await _redeem(client, guest_token, group_id, _other_code(code))
    no_code = await _redeem(client, guest_token, no_code_id, "123456")
    assert wrong.status_code == 409
    assert no_code.status_code == 409
    assert wrong.json()["message"] == no_code.json()["message"] == WRONG_CODE_MESSAGE


async def test_redeemJoinCode_memberOrOrganizer_createdFalse_noInsert_clearsUserKey(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    org_token, org_party_id = await _register(client, "ORGANIZER", "jc.idem.org@example.com")
    group_id, _term_id = await _create_circle_and_term(client, org_token, "jc-idem")
    member_token, member_party_id = await _register(client, "GUEST", "jc.idem.member@example.com")
    code = await _get_code(client, org_token, group_id)
    assert (await _redeem(client, member_token, group_id, code)).json() == {"created": True}

    for token, party_id in ((member_token, member_party_id), (org_token, org_party_id)):
        before = await _active_memberships_in(db_session, party_id, group_id)
        assert (await _redeem(client, token, group_id, _other_code(code))).status_code == 409
        assert (party_id, uuid.UUID(group_id)) in limiter._user_failures

        response = await _redeem(client, token, group_id, code)

        assert response.status_code == 200, response.text
        assert response.json() == {"created": False}
        assert await _active_memberships_in(db_session, party_id, group_id) == before
        assert (party_id, uuid.UUID(group_id)) not in limiter._user_failures
    assert uuid.UUID(group_id) in limiter._group_failures


async def test_redeemJoinCode_eleventhAttempt_returns429WithIntegerRetryAfter(
    client: AsyncClient,
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "jc.limit.org@example.com")
    group_id, _term_id = await _create_circle_and_term(client, org_token, "jc-limit")
    guest_token, _ = await _register(client, "GUEST", "jc.limit.guest@example.com")
    code = await _get_code(client, org_token, group_id)

    for _ in range(10):
        assert (await _redeem(client, guest_token, group_id, _other_code(code))).status_code == 409
    response = await _redeem(client, guest_token, group_id, code)

    assert response.status_code == 429, response.text
    assert int(response.headers["Retry-After"]) >= 1


async def test_redeemJoinCode_successAndBlocked_logsGroupIdNeverCode(
    client: AsyncClient, caplog: pytest.LogCaptureFixture
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "jc.log.org@example.com")
    group_id, _term_id = await _create_circle_and_term(client, org_token, "jc-log")
    guest_token, guest_party_id = await _register(client, "GUEST", "jc.log.guest@example.com")
    guesser_token, _ = await _register(client, "GUEST", "jc.log.guesser@example.com")
    code = await _get_code(client, org_token, group_id)
    wrong_code = _other_code(code)

    with caplog.at_level(logging.INFO, logger="app.groups.application.join_code"):
        assert (await _redeem(client, guest_token, group_id, code)).status_code == 200
        for _ in range(10):
            assert (await _redeem(client, guesser_token, group_id, wrong_code)).status_code == 409
        assert (await _redeem(client, guesser_token, group_id, wrong_code)).status_code == 429

    records = [r for r in caplog.records if r.name == "app.groups.application.join_code"]
    messages = [r.getMessage() for r in records]
    redeemed = [m for m in messages if "redeemed" in m]
    blocked = [r for r in records if r.levelno == logging.WARNING]
    assert len(redeemed) == 1
    assert f"group_id={group_id}" in redeemed[0]
    assert f"party_id={guest_party_id}" in redeemed[0]
    assert "created=True" in redeemed[0]
    assert len(blocked) == 1
    assert f"group_id={group_id}" in blocked[0].getMessage()
    assert "retry_after_seconds=" in blocked[0].getMessage()
    for message in messages:
        assert code not in message
        assert wrong_code not in message


async def test_redeemJoinCode_thirtyFailuresAcrossUsers_locksGroupForFreshUser429(
    client: AsyncClient,
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "jc.glimit.org@example.com")
    group_id, _term_id = await _create_circle_and_term(client, org_token, "jc-glimit")
    code = await _get_code(client, org_token, group_id)
    for n in range(3):
        guesser_token, _ = await _register(client, "GUEST", f"jc.glimit.g{n}@example.com")
        for _ in range(10):
            wrong = await _redeem(client, guesser_token, group_id, _other_code(code))
            assert wrong.status_code == 409, wrong.text
    fresh_token, _ = await _register(client, "GUEST", "jc.glimit.fresh@example.com")

    response = await _redeem(client, fresh_token, group_id, code)

    assert response.status_code == 429, response.text
    assert int(response.headers["Retry-After"]) >= 1


@pytest.mark.parametrize("concurrent_code", ["123456", None])
async def test_getJoinCode_staleDataError_neverNoneOr500(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    concurrent_code: str | None,
) -> None:
    """Deterministic stand-in for a concurrent write racing the lazy
    generate: the first `get_group` load is followed by a behind-the-ORM
    commit that bumps the `updated_at` version column (and, in variant A,
    sets a code), so the lazy UPDATE matches no row."""
    org_token, _ = await _register(client, "ORGANIZER", f"jc.stale.{concurrent_code}@example.com")
    group_id, _term_id = await _create_circle_and_term(
        client, org_token, f"jc-stale-{concurrent_code}"
    )
    original_get = repository.get_group
    calls = 0

    async def get_then_write_behind_orm(db: AsyncSession, target_id: uuid.UUID) -> Any:
        nonlocal calls
        calls += 1
        group = await original_get(db, target_id)
        if calls == 1:
            await db.execute(
                text(
                    "UPDATE groups SET updated_at = updated_at + interval '1 second', "
                    "join_code = COALESCE(:code, join_code) WHERE id = :id"
                ),
                {"id": target_id, "code": concurrent_code},
            )
            await db.commit()
        return group

    monkeypatch.setattr(repository, "get_group", get_then_write_behind_orm)

    response = await client.get(f"/api/groups/{group_id}/join-code", headers=_auth(org_token))

    assert response.status_code == 200, response.text
    returned = response.json()["code"]
    await db_session.rollback()
    monkeypatch.undo()
    assert calls == 2
    if concurrent_code is not None:
        assert returned == concurrent_code
    else:
        assert len(returned) == 6 and returned.isdigit()
    stored = await db_session.execute(
        text("SELECT join_code FROM groups WHERE id = :id"), {"id": uuid.UUID(group_id)}
    )
    assert stored.scalar_one() == returned
