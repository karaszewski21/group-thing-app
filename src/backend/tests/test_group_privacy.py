"""`Group.visibility` (PUBLIC/PRIVATE), `formalize_group_from_term`, and
`join_private_group` — integration tests for the approved plan
`crystalline-drifting-koala.md`'s Backend sections 1-4.

Flat `tests/` placement, same convention as `test_circles_router.py`."""

from __future__ import annotations

from datetime import date, timedelta

from httpx import AsyncClient


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _register(client: AsyncClient, role: str, email: str) -> tuple[str, int]:
    r = await client.post(
        "/api/auth/register", json={"role": role, "email": email, "password": "secret123"}
    )
    assert r.status_code == 201
    return r.json()["token"], r.json()["party_id"]


async def _create_circle_and_term(
    client: AsyncClient, org_token: str, prefix: str
) -> tuple[int, int]:
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


async def _rsvp_with_family(
    client: AsyncClient, group_id: int, term_id: int, guardian_email: str, family_name: str
) -> tuple[str, int]:
    """Registers a real GUEST account, gives it a Family (so it's eligible
    for formalization), then RSVPs to `term_id` as that logged-in principal
    (attaches to the existing party rather than minting an anonymous one)."""
    guardian_token, party_id = await _register(client, "GUEST", guardian_email)
    family = await client.post(
        "/api/families/mine", json={"name": family_name}, headers=_auth(guardian_token)
    )
    assert family.status_code == 201
    rsvp = await client.post(
        f"/api/groups/public/{group_id}/rsvp",
        json={"term_id": term_id, "guardian_name": guardian_email, "child_count": 1},
        headers=_auth(guardian_token),
    )
    assert rsvp.status_code == 201
    return guardian_token, party_id


async def test_createRsvp_privateGroupAnonymous_returns403(client: AsyncClient) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "priv.rsvp.org1@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "priv1")
    patch = await client.patch(
        f"/api/groups/{group_id}",
        json={"name": "Krąg priv1", "visibility": "PRIVATE"},
        headers=_auth(org_token),
    )
    assert patch.status_code == 200
    assert patch.json()["visibility"] == "PRIVATE"

    response = await client.post(
        f"/api/groups/public/{group_id}/rsvp",
        json={"term_id": term_id, "guardian_name": "Anonim", "child_count": 0},
    )

    assert response.status_code == 403


async def test_createRsvp_privateGroupOutsider_returns403(client: AsyncClient) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "priv.rsvp.org2@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "priv2")
    await client.patch(
        f"/api/groups/{group_id}",
        json={"name": "Krąg priv2", "visibility": "PRIVATE"},
        headers=_auth(org_token),
    )
    outsider_token, _ = await _register(client, "GUEST", "priv.rsvp.outsider2@example.com")

    response = await client.post(
        f"/api/groups/public/{group_id}/rsvp",
        json={"term_id": term_id, "guardian_name": "X", "child_count": 0},
        headers=_auth(outsider_token),
    )

    assert response.status_code == 403


async def test_createRsvp_publicGroupAnonymous_stillWorks(client: AsyncClient) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "priv.rsvp.org3@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "priv3")

    response = await client.post(
        f"/api/groups/public/{group_id}/rsvp",
        json={"term_id": term_id, "guardian_name": "Gość", "child_count": 2},
    )

    assert response.status_code == 201
    assert response.json()["attached_to_account"] is False


async def test_formalizeGroupFromTerm_organizer_createsMembershipStaysPublic(
    client: AsyncClient,
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "priv.formalize.org4@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "priv4")
    _guardian_token, party_id = await _rsvp_with_family(
        client, group_id, term_id, "priv.formalize.guardian4@example.com", "Rodzina F4"
    )

    response = await client.post(
        f"/api/groups/{group_id}/terms/{term_id}/formalize",
        json={"party_ids": [party_id]},
        headers=_auth(org_token),
    )

    assert response.status_code == 200
    assert response.json()["visibility"] == "PUBLIC"

    memberships = await client.get(
        f"/api/groups/{group_id}/memberships", headers=_auth(org_token)
    )
    assert memberships.status_code == 200
    assert any(m["member_party_id"] == party_id for m in memberships.json())


async def test_formalizeGroupFromTerm_familyLessAttendee_createsMembership(
    client: AsyncClient,
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "priv.formalize.org4b@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "priv4b")

    rsvp = await client.post(
        f"/api/groups/public/{group_id}/rsvp",
        json={"term_id": term_id, "guardian_name": "Gość Bezrodzinny", "child_count": 0},
    )
    assert rsvp.status_code == 201

    attendees = await client.get(
        f"/api/groups/{group_id}/terms/{term_id}/attendees", headers=_auth(org_token)
    )
    assert attendees.status_code == 200
    attendee = next(
        a for a in attendees.json() if a["display_name"] == "Gość Bezrodzinny"
    )
    party_id = attendee["party_id"]

    response = await client.post(
        f"/api/groups/{group_id}/terms/{term_id}/formalize",
        json={"party_ids": [party_id]},
        headers=_auth(org_token),
    )

    assert response.status_code == 200

    memberships = await client.get(
        f"/api/groups/{group_id}/memberships", headers=_auth(org_token)
    )
    assert memberships.status_code == 200
    assert any(m["member_party_id"] == party_id for m in memberships.json())


async def test_createRsvp_publicGroupWithExistingMembers_stillAcceptsAnonymousRsvp(
    client: AsyncClient,
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "priv.formalize.org4c@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "priv4c")
    _guardian_token, party_id = await _rsvp_with_family(
        client, group_id, term_id, "priv.formalize.guardian4c@example.com", "Rodzina F4c"
    )

    formalize = await client.post(
        f"/api/groups/{group_id}/terms/{term_id}/formalize",
        json={"party_ids": [party_id]},
        headers=_auth(org_token),
    )
    assert formalize.status_code == 200
    assert formalize.json()["visibility"] == "PUBLIC"

    response = await client.post(
        f"/api/groups/public/{group_id}/rsvp",
        json={"term_id": term_id, "guardian_name": "Nowy Gość", "child_count": 0},
    )

    assert response.status_code == 201


async def test_formalizeGroupFromTerm_nonOrganizer_returns403(client: AsyncClient) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "priv.formalize.org5@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "priv5")
    outsider_token, _ = await _register(client, "GUEST", "priv.formalize.outsider5@example.com")

    response = await client.post(
        f"/api/groups/{group_id}/terms/{term_id}/formalize",
        json={"party_ids": [1]},
        headers=_auth(outsider_token),
    )

    assert response.status_code == 403


async def test_joinPrivateGroup_publicGroup_returns404(client: AsyncClient) -> None:
    """Still exercises the PUBLIC-group-returns-404 path (not the auth gate):
    the anonymous join path is gone (Core Requirement 10), so an
    unauthenticated request against this same PUBLIC group would now 401
    before the visibility check ever runs (see
    `test_circles_router.py::test_joinPrivateGroup_unauthenticated_returns401`
    for that gate itself) — an authenticated principal is required here so
    the request actually reaches `join_private_group`'s
    `group.visibility != PRIVATE` check."""
    org_token, _ = await _register(client, "ORGANIZER", "priv.join.org6@example.com")
    group_id, _term_id = await _create_circle_and_term(client, org_token, "priv6")
    caller_token, _ = await _register(client, "GUEST", "priv.join.caller6@example.com")

    response = await client.post(
        f"/api/groups/public/{group_id}/join",
        json={"guardian_name": "Nowy", "child_count": 0},
        headers=_auth(caller_token),
    )

    assert response.status_code == 404


# NOTE: the former `test_joinPrivateGroup_anonymous_createsStandingMembership`
# tested a code path removed by Core Requirement 10 (the anonymous join
# branch no longer exists). It is deleted rather than rewritten — the
# authenticated-join-creates-membership behavior it was partially covering is
# already exercised, without duplication, by
# `test_circles_router.py::test_joinPrivateGroup_authenticatedAccountBackedPrincipal_attachesExistingMembership`
# and the unauthenticated-rejection behavior by
# `test_circles_router.py::test_joinPrivateGroup_unauthenticated_returns401`.


async def test_formalizeGroupFromTerm_idempotent_skipsStaleSelection(
    client: AsyncClient,
) -> None:
    """Calling `formalize` twice with the same still-eligible `party_id`
    must not create a second `Membership` row (verification-phase fix for
    the gap Group 7 flagged: `formalize_group_from_term` previously only
    excluded stale-attendance `party_id`s, never already-active-member
    `party_id`s, so a retry/double-submit duplicated the row)."""
    org_token, _ = await _register(client, "ORGANIZER", "priv.formalize.org7@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "priv7")
    _guardian_token, party_id = await _rsvp_with_family(
        client, group_id, term_id, "priv.formalize.guardian7@example.com", "Rodzina F7"
    )

    first = await client.post(
        f"/api/groups/{group_id}/terms/{term_id}/formalize",
        json={"party_ids": [party_id]},
        headers=_auth(org_token),
    )
    assert first.status_code == 200

    second = await client.post(
        f"/api/groups/{group_id}/terms/{term_id}/formalize",
        json={"party_ids": [party_id]},
        headers=_auth(org_token),
    )
    assert second.status_code == 200

    memberships = await client.get(
        f"/api/groups/{group_id}/memberships", headers=_auth(org_token)
    )
    assert memberships.status_code == 200
    matching = [m for m in memberships.json() if m["member_party_id"] == party_id]
    assert len(matching) == 1


async def test_updateGroup_visibilityChange_doesNotCreateMemberships(
    client: AsyncClient,
) -> None:
    """`PATCH /groups/{id}`'s visibility change and standing-membership
    creation are two fully independent actions post-decoupling: flipping a
    group PUBLIC -> PRIVATE via the manual visibility patch must never, by
    itself, mint any `Membership` rows."""
    org_token, _ = await _register(client, "ORGANIZER", "priv.patchvis.org4e@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "priv4e")
    await _rsvp_with_family(
        client, group_id, term_id, "priv.patchvis.guardian4e@example.com", "Rodzina F4e"
    )

    patch = await client.patch(
        f"/api/groups/{group_id}",
        json={"name": "Krąg priv4e", "visibility": "PRIVATE"},
        headers=_auth(org_token),
    )
    assert patch.status_code == 200
    assert patch.json()["visibility"] == "PRIVATE"

    memberships = await client.get(
        f"/api/groups/{group_id}/memberships", headers=_auth(org_token)
    )
    assert memberships.status_code == 200
    assert memberships.json() == []


async def test_createMyCircle_calledTwice_returnsSameCircleBothTimes(client: AsyncClient) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "priv.mine.org8@example.com")

    first = await client.post(
        "/api/groups/mine", json={"name": "Pierwszy"}, headers=_auth(org_token)
    )
    second = await client.post(
        "/api/groups/mine", json={"name": "Drugi"}, headers=_auth(org_token)
    )

    assert first.status_code == 201
    assert second.status_code == 201
    assert first.json()["id"] == second.json()["id"]


async def test_createAdditionalMyCircle_calledTwice_createsTwoDistinctCircles(
    client: AsyncClient,
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "priv.mine.org9@example.com")

    first = await client.post(
        "/api/groups/mine/new", json={"name": "Pierwszy"}, headers=_auth(org_token)
    )
    second = await client.post(
        "/api/groups/mine/new",
        json={"name": "Drugi", "visibility": "PRIVATE"},
        headers=_auth(org_token),
    )

    assert first.status_code == 201
    assert second.status_code == 201
    assert first.json()["id"] != second.json()["id"]
    assert second.json()["name"] == "Drugi"
    assert second.json()["visibility"] == "PRIVATE"

    my_groups = await client.get("/api/groups", headers=_auth(org_token))
    assert my_groups.status_code == 200
    group_ids = {g["id"] for g in my_groups.json()}
    assert {first.json()["id"], second.json()["id"]} <= group_ids
