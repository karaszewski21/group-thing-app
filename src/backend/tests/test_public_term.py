"""Per-term public-page tests: the `GET /api/groups/public/{group_id}?term_id=`
generalization. The URL-named term (not only the server-picked nearest one)
drives `next_term` / `needed_items` / `guardians`; a cross-circle or unknown
`term_id` is a 404; the no-`term_id` path is unchanged; `needed_items` come
back id-ordered; and `organizer_slug` resolves via the active Leadership's
organizer party's owned Organization (else `None`).

Isolation via the `conftest.py` TestContainers + savepoint-rollback fixtures;
naming follows `action_condition_expectedResult`
(`standards/testing/backend-testing.md`).
"""

from __future__ import annotations

import re
from datetime import date, datetime, timedelta

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.groups.models import NeededItem


async def _register_organizer(client: AsyncClient, email: str) -> str:
    response = await client.post(
        "/api/auth/register",
        json={"role": "ORGANIZER", "email": email, "password": "secret123"},
    )
    assert response.status_code == 201
    return response.json()["token"]


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


async def _create_circle(client: AsyncClient, token: str, name: str) -> int:
    circle = await client.post(
        "/api/groups/mine", json={"name": name}, headers=_auth_headers(token)
    )
    assert circle.status_code == 201
    return circle.json()["id"]


async def _create_term(
    client: AsyncClient,
    token: str,
    group_id: int,
    occurs_on: date,
    description: str | None = None,
) -> int:
    term = await client.post(
        "/api/terms",
        json={
            "circle_group_id": group_id,
            "occurs_on": occurs_on.isoformat(),
            "description": description,
        },
        headers=_auth_headers(token),
    )
    assert term.status_code == 201
    return term.json()["id"]


async def _create_needed_item(
    client: AsyncClient, token: str, term_id: int, product_name: str, description: str
) -> int:
    resolved = await client.post(
        "/api/products/resolve",
        json={"name": product_name, "category": "OTHER"},
        headers=_auth_headers(token),
    )
    assert resolved.status_code == 200
    item = await client.post(
        "/api/needed-items",
        json={"term_id": term_id, "product_id": resolved.json()["id"], "description": description},
        headers=_auth_headers(token),
    )
    assert item.status_code == 201
    return item.json()["id"]


async def test_getPublicCircle_withTermIdParam_returnsThatTermsItemsAndGuardians(
    client: AsyncClient,
) -> None:
    token = await _register_organizer(client, "pt.owner1@example.com")
    group_id = await _create_circle(client, token, "Nutki dla starszaków")
    nearest_term_id = await _create_term(
        client, token, group_id, date.today() + timedelta(days=7), "Najbliższy"
    )
    far_term_id = await _create_term(
        client, token, group_id, date.today() + timedelta(days=30), "17:00 Park Sołacki"
    )

    await _create_needed_item(client, token, far_term_id, "Grzechotka", "5 grzechotek")
    await _create_needed_item(client, token, nearest_term_id, "Kredki", "kredki")

    rsvp = await client.post(
        f"/api/groups/public/{group_id}/rsvp",
        json={"term_id": far_term_id, "guardian_name": "Marek Nowak", "child_count": 1},
    )
    assert rsvp.status_code == 201

    response = await client.get(f"/api/groups/public/{group_id}?term_id={far_term_id}")

    assert response.status_code == 200
    body = response.json()
    assert body["next_term"]["id"] == far_term_id
    assert [item["description"] for item in body["next_term"]["needed_items"]] == ["5 grzechotek"]
    assert body["next_term"]["needed_items"][0]["product_name"] == "Grzechotka"
    assert body["next_term"]["needed_items"][0]["product_category"] == "OTHER"
    assert body["guardians"] == [{"display_name": "Marek Nowak"}]


async def test_getPublicCircle_termIdFromAnotherGroup_returns404(client: AsyncClient) -> None:
    token_a = await _register_organizer(client, "pt.owner2a@example.com")
    group_a = await _create_circle(client, token_a, "Krąg A")

    token_b = await _register_organizer(client, "pt.owner2b@example.com")
    group_b = await _create_circle(client, token_b, "Krąg B")
    term_b = await _create_term(client, token_b, group_b, date.today())

    response = await client.get(f"/api/groups/public/{group_a}?term_id={term_b}")

    assert response.status_code == 404


async def test_getPublicCircle_nonexistentTermId_returns404(client: AsyncClient) -> None:
    token = await _register_organizer(client, "pt.owner3@example.com")
    group_id = await _create_circle(client, token, "Krąg C")
    await _create_term(client, token, group_id, date.today())

    response = await client.get(f"/api/groups/public/{group_id}?term_id=999999999")

    assert response.status_code == 404


async def test_getPublicCircle_noTermIdParam_returnsNearestTermUnchanged(
    client: AsyncClient,
) -> None:
    token = await _register_organizer(client, "pt.owner4@example.com")
    group_id = await _create_circle(client, token, "Krąg D")
    nearer_term_id = await _create_term(
        client, token, group_id, date.today() + timedelta(days=3), "Bliżej"
    )
    await _create_term(client, token, group_id, date.today() + timedelta(days=20), "Dalej")

    response = await client.get(f"/api/groups/public/{group_id}")

    assert response.status_code == 200
    body = response.json()
    assert body["next_term"]["id"] == nearer_term_id
    # Response shape unchanged apart from the additive `organizer_slug`.
    assert set(body.keys()) == {
        "id",
        "name",
        "organizer_display_name",
        "organizer_slug",
        "next_term",
        "guardians",
    }
    assert set(body["next_term"].keys()) == {"id", "occurs_on", "description", "needed_items"}


async def test_getPublicCircle_neededItems_orderedById(client: AsyncClient) -> None:
    token = await _register_organizer(client, "pt.owner5@example.com")
    group_id = await _create_circle(client, token, "Krąg E")
    term_id = await _create_term(client, token, group_id, date.today())
    id_1 = await _create_needed_item(client, token, term_id, "INSTRUMENT", "bębenek")
    id_2 = await _create_needed_item(client, token, term_id, "ART_SUPPLIES", "farby")
    id_3 = await _create_needed_item(client, token, term_id, "OTHER", "koc")

    response = await client.get(f"/api/groups/public/{group_id}?term_id={term_id}")

    assert response.status_code == 200
    returned_ids = [item["id"] for item in response.json()["next_term"]["needed_items"]]
    assert returned_ids == sorted([id_1, id_2, id_3])


async def test_getPublicCircle_afterLoggedInRsvp_stillExposesOnlyGuardianDisplayNameNoPerChildData(
    client: AsyncClient,
) -> None:
    """After the R5 logged-in attach path lands, the public view must still
    leak nothing per-child: `guardians` carries only the account profile's
    `display_name` (never the request's `guardian_name`, never a per-attendee
    child count) and `next_term` keeps its unchanged 4-key shape."""
    token = await _register_organizer(client, "pt.loggedin.owner@example.com")
    group_id = await _create_circle(client, token, "Krąg z zalogowanym rodzicem")
    term_id = await _create_term(client, token, group_id, date.today() + timedelta(days=7))

    guest_token, _guest_party_id = await _register_guest(client, "pt.loggedin.parent@example.com")
    rsvp = await client.post(
        f"/api/groups/public/{group_id}/rsvp",
        json={"term_id": term_id, "guardian_name": "Ignorowane Imie", "child_count": 3},
        headers=_auth_headers(guest_token),
    )
    assert rsvp.status_code == 201
    assert rsvp.json()["attached_to_account"] is True

    response = await client.get(f"/api/groups/public/{group_id}?term_id={term_id}")

    assert response.status_code == 200
    body = response.json()
    assert body["guardians"] == [{"display_name": "Pt Loggedin Parent"}]
    assert set(body["next_term"].keys()) == {"id", "occurs_on", "description", "needed_items"}
    assert "child_count" not in body
    assert "children" not in body


async def test_getPublicCircle_softDeletedNeededItem_notReturned(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token = await _register_organizer(client, "pt.softdel1@example.com")
    group_id = await _create_circle(client, token, "Krąg soft-delete")
    term_id = await _create_term(client, token, group_id, date.today())
    kept_id = await _create_needed_item(client, token, term_id, "INSTRUMENT", "bębenek")
    removed_id = await _create_needed_item(client, token, term_id, "ART_SUPPLIES", "kredki")

    removed = await db_session.get(NeededItem, removed_id)
    assert removed is not None
    removed.deleted_at = datetime.utcnow()
    await db_session.commit()

    response = await client.get(f"/api/groups/public/{group_id}?term_id={term_id}")

    assert response.status_code == 200
    returned_ids = [item["id"] for item in response.json()["next_term"]["needed_items"]]
    assert returned_ids == [kept_id]


async def test_getPublicCircle_termWithNeededItems_unaffectedAfterSiblingDelete(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token = await _register_organizer(client, "pt.softdel2@example.com")
    group_id = await _create_circle(client, token, "Krąg sibling")
    term_id = await _create_term(client, token, group_id, date.today())
    sibling_id = await _create_needed_item(client, token, term_id, "INSTRUMENT", "grzechotka")
    removed_id = await _create_needed_item(client, token, term_id, "OTHER", "koc")

    removed = await db_session.get(NeededItem, removed_id)
    assert removed is not None
    removed.deleted_at = datetime.utcnow()
    await db_session.commit()

    response = await client.get(f"/api/groups/public/{group_id}?term_id={term_id}")

    assert response.status_code == 200
    items = response.json()["next_term"]["needed_items"]
    assert [item["id"] for item in items] == [sibling_id]
    assert items[0]["description"] == "grzechotka"


async def test_getPublicCircle_neededItem_reflectsPledgeClaim(client: AsyncClient) -> None:
    token = await _register_organizer(client, "pt.claim@example.com")
    group_id = await _create_circle(client, token, "Krąg zgłoszeń")
    term_id = await _create_term(client, token, group_id, date.today())
    needed_item_id = await _create_needed_item(client, token, term_id, "Bębenek", "mały")

    before = await client.get(f"/api/groups/public/{group_id}?term_id={term_id}")
    item_before = before.json()["next_term"]["needed_items"][0]
    assert item_before["claimed"] is False
    assert item_before["claimed_by_name"] is None

    guest_token, _ = await _register_guest(client, "pt.claim.guest@example.com")
    pledge = await client.post(
        "/api/pledges",
        json={"needed_item_id": needed_item_id},
        headers=_auth_headers(guest_token),
    )
    assert pledge.status_code == 201

    after = await client.get(f"/api/groups/public/{group_id}?term_id={term_id}")
    item_after = after.json()["next_term"]["needed_items"][0]
    assert item_after["claimed"] is True
    assert item_after["claimed_by_name"] is not None


async def test_getPublicCircle_organizerSlug_isOrgSlugWhenOrgExists_elseStableHash(
    client: AsyncClient,
) -> None:
    # Organizer who owns an Organization -> `organizer_slug` is that org's slug.
    token_with = await _register_organizer(client, "pt.owner6a@example.com")
    group_with = await _create_circle(client, token_with, "Krąg z organizacją")
    await _create_term(client, token_with, group_with, date.today())
    org = await client.post(
        "/api/organizations/mine",
        json={"name": "Muzyczne Skrzaty"},
        headers=_auth_headers(token_with),
    )
    assert org.status_code == 201
    slug = org.json()["slug"]

    response_with = await client.get(f"/api/groups/public/{group_with}")
    assert response_with.status_code == 200
    assert response_with.json()["organizer_slug"] == slug

    # Organizer who owns no Organization -> a stable `k-<hash>` pseudo-slug,
    # never null, so per-term links still work without an Organization.
    token_without = await _register_organizer(client, "pt.owner6b@example.com")
    group_without = await _create_circle(client, token_without, "Krąg bez organizacji")
    await _create_term(client, token_without, group_without, date.today())

    url = f"/api/groups/public/{group_without}"
    slug = (await client.get(url)).json()["organizer_slug"]
    assert slug is not None
    assert re.fullmatch(r"k-[0-9a-f]{12}", slug)
    # Stable across calls.
    assert (await client.get(url)).json()["organizer_slug"] == slug
