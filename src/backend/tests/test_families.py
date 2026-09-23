"""`POST /api/families/mine` (idempotent create-own), `PATCH
/api/families/{family_id}` (guardian-only rename), and the derived
`child_count` on the `GET /api/families/mine` read — implementation/spec.md
R3, R4, R6. Same conftest / SAVEPOINT isolation as the sibling family tests;
`action_condition_expectedResult` naming per
`standards/testing/backend-testing.md`."""

from __future__ import annotations

from typing import cast

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.families.bootstrap import create_own_family
from app.families.models import Family, FamilyMembership, FamilyRole, FamilyRoleType
from app.families.repository import list_families_for_guardian_party
from app.party.models import PartyType
from app.party.service import create_party


async def _register_guest(client: AsyncClient, email: str) -> tuple[str, int]:
    response = await client.post(
        "/api/auth/register",
        json={"role": "GUEST", "email": email, "password": "secret123"},
    )
    assert response.status_code == 201
    body = response.json()
    return body["token"], body["party_id"]


def _auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def test_createOwnFamily_noExistingFamily_createsNamedFamilyWithCallerAsGuardian(
    db_session: AsyncSession,
) -> None:
    """`register()` now unconditionally auto-creates a solo Family for every
    new party (spec.md Core Requirements 3-4), so a party reachable through
    `/api/auth/register` is never truly family-less. To exercise
    `create_own_family`'s actual "no existing family" create-path, this test
    builds a bare `Party` directly (bypassing `register()`) and calls the
    service function itself — the genuine family-less fixture the HTTP API
    can no longer produce."""
    party = await create_party(db_session, PartyType.PERSON)
    party_id = cast(int, party.id)
    await db_session.commit()

    family = await create_own_family(db_session, party_id, "Rodzina Testowa")

    assert family.name == "Rodzina Testowa"

    families = (
        await db_session.execute(select(Family).where(Family.id == family.id))
    ).scalars().all()
    assert len(families) == 1

    roles = (
        await db_session.execute(
            select(FamilyRole).where(
                FamilyRole.party_id == party_id,
                FamilyRole.role_type == FamilyRoleType.GUARDIAN,
            )
        )
    ).scalars().all()
    assert len(roles) == 1

    memberships = (
        await db_session.execute(
            select(FamilyMembership).where(
                FamilyMembership.to_family_id == family.id,
                FamilyMembership.is_primary_contact.is_(True),
                FamilyMembership.valid_to.is_(None),
            )
        )
    ).scalars().all()
    assert len(memberships) == 1


async def test_createOwnFamily_calledTwiceWithDifferentName_returnsExistingFamilyUnchanged(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """`register()`'s auto-created solo Family is itself the "existing
    family" `create_own_family`'s idempotency check short-circuits on — both
    calls below are no-ops against that pre-existing row (never a rename,
    never a second Family), regardless of the caller-supplied name."""
    token, party_id = await _register_guest(client, "createown.twice@example.com")
    pre_existing = await list_families_for_guardian_party(db_session, party_id)
    assert len(pre_existing) == 1

    first = await client.post(
        "/api/families/mine", json={"name": "Pierwsza Nazwa"}, headers=_auth_headers(token)
    )
    second = await client.post(
        "/api/families/mine", json={"name": "Druga Nazwa"}, headers=_auth_headers(token)
    )

    assert first.status_code == 201
    assert second.status_code == 201
    assert first.json()["id"] == pre_existing[0].id
    assert second.json()["id"] == first.json()["id"]
    assert second.json()["name"] == first.json()["name"]
    assert first.json()["name"] not in ("Pierwsza Nazwa", "Druga Nazwa")

    mine = await client.get("/api/families/mine", headers=_auth_headers(token))
    assert [family["id"] for family in mine.json()] == [first.json()["id"]]


async def test_createOwnFamily_blankName_returns422(client: AsyncClient) -> None:
    token, _party_id = await _register_guest(client, "createown.blank@example.com")

    whitespace = await client.post(
        "/api/families/mine", json={"name": "   "}, headers=_auth_headers(token)
    )
    empty = await client.post(
        "/api/families/mine", json={"name": ""}, headers=_auth_headers(token)
    )

    # This codebase maps both Pydantic min_length failures and
    # field-validator ValueErrors to 400 (see
    # `app.core.errors.validation_error_handler` / `value_error_handler`),
    # not FastAPI's default 422.
    assert whitespace.status_code == 400
    assert empty.status_code == 400


async def test_createOwnFamily_unauthenticated_returns401(client: AsyncClient) -> None:
    response = await client.post("/api/families/mine", json={"name": "Bez Tokena"})
    assert response.status_code == 401


async def test_patchFamily_guardian_renamesFamilyInPlace(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token, _party_id = await _register_guest(client, "patch.guardian@example.com")
    created = await client.post(
        "/api/families/mine", json={"name": "Stara Nazwa"}, headers=_auth_headers(token)
    )
    family_id = created.json()["id"]

    response = await client.patch(
        f"/api/families/{family_id}", json={"name": "Nowa Nazwa"}, headers=_auth_headers(token)
    )

    assert response.status_code == 200
    assert response.json()["name"] == "Nowa Nazwa"
    assert response.json()["id"] == family_id

    # In-place update: the same row, renamed — not a new Family.
    rows = (
        await db_session.execute(select(Family).where(Family.id == family_id))
    ).scalars().all()
    assert len(rows) == 1
    assert rows[0].name == "Nowa Nazwa"


async def test_patchFamily_nonGuardian_returns403(client: AsyncClient) -> None:
    owner_token, _owner_party = await _register_guest(client, "patch.owner@example.com")
    # `POST /api/families/mine` is idempotent against `register()`'s
    # auto-created solo Family (spec.md Core Requirements 3-4) — it returns
    # that pre-existing row unchanged rather than a fresh "Cudza Rodzina", so
    # the name asserted below is whatever name actually came back, not the
    # requested one.
    created = await client.post(
        "/api/families/mine", json={"name": "Cudza Rodzina"}, headers=_auth_headers(owner_token)
    )
    family_id = created.json()["id"]
    original_name = created.json()["name"]

    stranger_token, _stranger_party = await _register_guest(client, "patch.stranger@example.com")
    response = await client.patch(
        f"/api/families/{family_id}",
        json={"name": "Przejeta Nazwa"},
        headers=_auth_headers(stranger_token),
    )

    assert response.status_code == 403

    unchanged = await client.get(
        f"/api/families/{family_id}", headers=_auth_headers(owner_token)
    )
    assert unchanged.json()["family"]["name"] == original_name


async def test_patchFamily_guardianOfDifferentFamily_returns403(client: AsyncClient) -> None:
    """Cross-family isolation: a caller who *is* a guardian — but of another
    family — still cannot rename family A (the service guardian check is
    scoped to the target `family_id`, not "is a guardian anywhere")."""
    owner_token, _owner_party = await _register_guest(client, "patch.crossfam.owner@example.com")
    # Idempotent against the auto-created solo Family (see note in
    # `test_patchFamily_nonGuardian_returns403` above) — capture the actual
    # returned name rather than assuming "Rodzina A" was created.
    family_a = await client.post(
        "/api/families/mine", json={"name": "Rodzina A"}, headers=_auth_headers(owner_token)
    )
    family_a_id = family_a.json()["id"]
    family_a_name = family_a.json()["name"]

    other_token, _other_party = await _register_guest(client, "patch.crossfam.other@example.com")
    other_family = await client.post(
        "/api/families/mine", json={"name": "Rodzina B"}, headers=_auth_headers(other_token)
    )
    assert other_family.status_code == 201

    response = await client.patch(
        f"/api/families/{family_a_id}",
        json={"name": "Przejeta Nazwa"},
        headers=_auth_headers(other_token),
    )

    assert response.status_code == 403

    unchanged = await client.get(
        f"/api/families/{family_a_id}", headers=_auth_headers(owner_token)
    )
    assert unchanged.json()["family"]["name"] == family_a_name


async def test_patchFamily_unknownId_returns404(client: AsyncClient) -> None:
    token, _party_id = await _register_guest(client, "patch.unknown@example.com")
    response = await client.patch(
        "/api/families/999999", json={"name": "Widmo"}, headers=_auth_headers(token)
    )
    assert response.status_code == 404


async def _sole_guardian_membership_id(client: AsyncClient, token: str, family_id: int) -> int:
    guardians = await client.get(
        f"/api/families/{family_id}/guardians", headers=_auth_headers(token)
    )
    assert guardians.status_code == 200
    return int(guardians.json()[0]["family_membership_id"])


async def test_removeFamilyMember_guardian_softClosesMembershipMemberDisappears(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token, _party_id = await _register_guest(client, "remove.softclose@example.com")
    created = await client.post(
        "/api/families/mine", json={"name": "Rodzina Do Edycji"}, headers=_auth_headers(token)
    )
    family_id = created.json()["id"]
    await client.post(
        "/api/families/mine/members",
        json={
            "members": [
                {"name": "Dziecko Zostaje", "role_type": "CHILD"},
                {"name": "Dziecko Do Usuniecia", "role_type": "CHILD"},
            ]
        },
        headers=_auth_headers(token),
    )

    guardians = (
        await client.get(f"/api/families/{family_id}/guardians", headers=_auth_headers(token))
    ).json()
    target = next(g for g in guardians if g["display_name"] == "Dziecko Do Usuniecia")

    response = await client.delete(
        f"/api/families/{family_id}/guardians/{target['family_membership_id']}",
        headers=_auth_headers(token),
    )
    assert response.status_code == 204

    after = (
        await client.get(f"/api/families/{family_id}/guardians", headers=_auth_headers(token))
    ).json()
    remaining = {g["display_name"] for g in after}
    assert "Dziecko Do Usuniecia" not in remaining
    assert "Dziecko Zostaje" in remaining

    mine = await client.get("/api/families/mine", headers=_auth_headers(token))
    assert mine.json()[0]["child_count"] == 1

    # The row is preserved, only soft-closed.
    membership = await db_session.get(FamilyMembership, target["family_membership_id"])
    assert membership is not None
    assert membership.valid_to is not None


async def test_removeFamilyMember_lastGuardian_returns409(client: AsyncClient) -> None:
    token, _party_id = await _register_guest(client, "remove.lastguardian@example.com")
    created = await client.post(
        "/api/families/mine", json={"name": "Rodzina Jednego Opiekuna"}, headers=_auth_headers(token)
    )
    family_id = created.json()["id"]
    membership_id = await _sole_guardian_membership_id(client, token, family_id)

    response = await client.delete(
        f"/api/families/{family_id}/guardians/{membership_id}", headers=_auth_headers(token)
    )
    assert response.status_code == 409

    still_there = (
        await client.get(f"/api/families/{family_id}/guardians", headers=_auth_headers(token))
    ).json()
    assert [g["family_membership_id"] for g in still_there] == [membership_id]


async def test_removeFamilyMember_nonGuardian_returns403(client: AsyncClient) -> None:
    owner_token, _owner_party = await _register_guest(client, "remove.owner@example.com")
    created = await client.post(
        "/api/families/mine", json={"name": "Cudza Rodzina"}, headers=_auth_headers(owner_token)
    )
    family_id = created.json()["id"]
    membership_id = await _sole_guardian_membership_id(client, owner_token, family_id)

    stranger_token, _stranger_party = await _register_guest(client, "remove.stranger@example.com")
    response = await client.delete(
        f"/api/families/{family_id}/guardians/{membership_id}",
        headers=_auth_headers(stranger_token),
    )
    assert response.status_code == 403


async def test_removeFamilyMember_unknownMembershipId_returns404(client: AsyncClient) -> None:
    token, _party_id = await _register_guest(client, "remove.unknown@example.com")
    created = await client.post(
        "/api/families/mine", json={"name": "Rodzina Widmo"}, headers=_auth_headers(token)
    )
    family_id = created.json()["id"]

    response = await client.delete(
        f"/api/families/{family_id}/guardians/999999", headers=_auth_headers(token)
    )
    assert response.status_code == 404


async def test_familyMineRead_reportsActiveChildCountExcludingGuardiansAndClosedMemberships(
    client: AsyncClient,
) -> None:
    token, _party_id = await _register_guest(client, "childcount.guardian@example.com")
    await client.post(
        "/api/families/mine", json={"name": "Rodzina Z Dziecmi"}, headers=_auth_headers(token)
    )
    await client.post(
        "/api/families/mine/members",
        json={
            "members": [
                {"name": "Dziecko Jeden", "role_type": "CHILD"},
                {"name": "Dziecko Dwa", "role_type": "CHILD"},
                {"name": "Opiekun Dodatkowy", "role_type": "GUARDIAN"},
            ]
        },
        headers=_auth_headers(token),
    )

    mine = await client.get("/api/families/mine", headers=_auth_headers(token))
    assert mine.status_code == 200
    assert len(mine.json()) == 1
    assert mine.json()[0]["child_count"] == 2

    # `register()` now auto-creates a solo Family for every new party (spec.md
    # Core Requirements 3-4), so a fresh registrant is no longer family-less —
    # they resolve to exactly their own solo Family, with zero children (no
    # `/members` batch was ever posted for it).
    other_token, _other_party = await _register_guest(client, "childcount.nofamily@example.com")
    solo = await client.get("/api/families/mine", headers=_auth_headers(other_token))
    assert solo.status_code == 200
    assert len(solo.json()) == 1
    assert solo.json()[0]["child_count"] == 0
