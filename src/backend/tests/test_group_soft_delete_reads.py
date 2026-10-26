"""Read isolation for a soft-deleted Circle (spec Table A): every listing
omits it and every by-id read of it, its Terms, needs and organizer data is a
404. One test per A-row cluster; deletion goes through `DELETE` where the
Circle has no upcoming RSVP, otherwise `deleted_at` is set on the row."""

from __future__ import annotations

import uuid
from datetime import datetime

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.groups import service
from app.groups.models import Group
from tests.test_group_soft_delete import _register_admin
from tests.test_organizer_page import _circle, _in_days, _needed_item, _organization_slug, _term
from tests.test_term_item_listings import _auth, _register, _resolve_product, _rsvp


async def _delete(client: AsyncClient, token: str, group_id: uuid.UUID) -> None:
    response = await client.delete(f"/api/groups/{group_id}", headers=_auth(token))
    assert response.status_code == 204, response.text


async def _soft_delete_row(db_session: AsyncSession, group_id: uuid.UUID) -> None:
    group = await db_session.get(Group, group_id)
    assert group is not None
    group.deleted_at = datetime.utcnow()
    await db_session.commit()


async def test_peopleLeaderships_and_familyMemberships_excludeDeletedGroup(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "sdr.lead.org@example.com")
    kept = await _circle(client, org_token, "Zostaje")
    deleted = await _circle(client, org_token, "Znika")
    guest_token, guest_party_id = await _register(client, "GUEST", "sdr.lead.guest@example.com")
    family = await client.post(
        "/api/families/mine", json={"name": "Rodzina SDR"}, headers=_auth(guest_token)
    )
    assert family.status_code == 201
    await service.add_active_membership(db_session, kept, guest_party_id)
    await service.add_active_membership(db_session, deleted, guest_party_id)
    await db_session.commit()
    me = await client.get("/api/people/me", headers=_auth(org_token))

    await _delete(client, org_token, deleted)

    leaderships = await client.get(
        f"/api/people/{me.json()['id']}/leaderships", headers=_auth(org_token)
    )
    memberships = await client.get(
        f"/api/families/{family.json()['id']}/memberships", headers=_auth(guest_token)
    )
    assert leaderships.status_code == 200
    assert [row["to_group_id"] for row in leaderships.json()] == [str(kept)]
    assert memberships.status_code == 200
    assert [row["to_group_id"] for row in memberships.json()] == [str(kept)]


async def test_postGroupsMine_afterDelete_doesNotReturnDeletedGroup(client: AsyncClient) -> None:
    token, _ = await _register(client, "ORGANIZER", "sdr.mine@example.com")
    deleted = await _circle(client, token, "Jedyny krąg")
    await _delete(client, token, deleted)

    response = await client.post(
        "/api/groups/mine", json={"name": "Nowy krąg"}, headers=_auth(token)
    )

    assert response.status_code == 201, response.text
    assert response.json()["id"] != str(deleted)
    assert response.json()["name"] == "Nowy krąg"


async def test_listGroups_and_publicOrganizerDirectory_excludeDeletedGroup(
    client: AsyncClient,
) -> None:
    token, _ = await _register(client, "ORGANIZER", "sdr.dir@example.com")
    slug = await _organization_slug(client, token, "Usuwane Nutki")
    kept = await _circle(client, token, "Widoczny")
    deleted = await _circle(client, token, "Ukryty")
    kept_term = await _term(client, token, kept, _in_days(3))
    await _term(client, token, deleted, _in_days(4))

    await _delete(client, token, deleted)

    groups = await client.get("/api/groups", headers=_auth(token))
    page = await client.get(f"/api/groups/public/organizers/{slug}")
    terms = await client.get(f"/api/groups/public/organizers/{slug}/terms")
    assert str(deleted) not in {row["id"] for row in groups.json()}
    assert str(kept) in {row["id"] for row in groups.json()}
    assert page.status_code == 200
    assert [circle["id"] for circle in page.json()["circles"]] == [str(kept)]
    assert [term["term_id"] for term in page.json()["upcoming_terms"]] == [str(kept_term)]
    assert terms.status_code == 200
    assert [term["term_id"] for term in terms.json()["items"]] == [str(kept_term)]
    assert terms.json()["total"] == 1


async def test_myAttendances_and_myPledges_excludeDeletedGroup(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "sdr.mine.org@example.com")
    kept = await _circle(client, org_token, "Krąg A")
    deleted = await _circle(client, org_token, "Krąg B")
    kept_term = await _term(client, org_token, kept, _in_days(3))
    deleted_term = await _term(client, org_token, deleted, _in_days(5))
    kept_need = await _needed_item(client, org_token, kept_term, "Sdr bęben")
    deleted_need = await _needed_item(client, org_token, deleted_term, "Sdr flet")
    guest_token, _ = await _register(client, "GUEST", "sdr.mine.guest@example.com")
    await _rsvp(client, guest_token, kept, kept_term)
    await _rsvp(client, guest_token, deleted, deleted_term)
    for need in (kept_need, deleted_need):
        pledge = await client.post(
            "/api/pledges", json={"needed_item_id": str(need)}, headers=_auth(guest_token)
        )
        assert pledge.status_code == 201

    await _soft_delete_row(db_session, deleted)

    attendances = await client.get("/api/groups/mine/attendances", headers=_auth(guest_token))
    pledges = await client.get("/api/pledges/mine", headers=_auth(guest_token))
    assert attendances.status_code == 200
    assert [row["term_id"] for row in attendances.json()] == [str(kept_term)]
    assert pledges.status_code == 200
    assert [row["term_id"] for row in pledges.json()] == [str(kept_term)]


async def test_termsModeration_itemsAndTotal_excludeDeletedGroup(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "sdr.modterms.org@example.com")
    kept = await _circle(client, org_token, "Moderowany")
    deleted = await _circle(client, org_token, "Usunięty")
    kept_term = await _term(client, org_token, kept, _in_days(3))
    deleted_terms = {
        str(await _term(client, org_token, deleted, _in_days(days))) for days in (4, 6)
    }
    admin_token = await _register_admin(client, db_session, "sdr.modterms.admin@example.com")
    before = await client.get("/api/terms/moderation?size=100", headers=_auth(admin_token))

    await _delete(client, org_token, deleted)

    after = await client.get("/api/terms/moderation?size=100", headers=_auth(admin_token))
    assert after.status_code == 200
    ids = {row["id"] for row in after.json()["items"]}
    assert str(kept_term) in ids
    assert ids.isdisjoint(deleted_terms)
    assert after.json()["total"] == before.json()["total"] - len(deleted_terms)
    assert after.json()["total"] == len(after.json()["items"])


async def test_termsByCircle_termById_neededItemsByTerm_createPledge_return404(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "sdr.404.org@example.com")
    group_id = await _circle(client, org_token, "Krąg z potrzebami")
    term_id = await _term(client, org_token, group_id, _in_days(3))
    need_id = await _needed_item(client, org_token, term_id, "Sdr ksylofon")
    guest_token, _ = await _register(client, "GUEST", "sdr.404.guest@example.com")

    await _delete(client, org_token, group_id)

    headers = _auth(guest_token)
    assert (
        await client.get(f"/api/terms?circle_group_id={group_id}", headers=headers)
    ).status_code == 404
    assert (await client.get(f"/api/terms/{term_id}", headers=headers)).status_code == 404
    assert (
        await client.get(f"/api/needed-items?term_id={term_id}", headers=headers)
    ).status_code == 404
    assert (await client.get(f"/api/needed-items/{need_id}", headers=headers)).status_code == 404
    pledge = await client.post(
        "/api/pledges", json={"needed_item_id": str(need_id)}, headers=headers
    )
    assert pledge.status_code == 404


async def test_groupLeadershipLeadershipsMemberships_return404(client: AsyncClient) -> None:
    token, _ = await _register(client, "ORGANIZER", "sdr.lead404@example.com")
    group_id = await _circle(client, token, "Krąg bez lidera")

    await _delete(client, token, group_id)

    for suffix in ("leadership", "leaderships", "memberships"):
        response = await client.get(f"/api/groups/{group_id}/{suffix}", headers=_auth(token))
        assert response.status_code == 404, suffix


async def test_redeemJoinCode_onDeletedPrivateGroup_returns404(client: AsyncClient) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "sdr.redeem.org@example.com")
    group_id = await _circle(client, org_token, "Prywatny usunięty", visibility="PRIVATE")
    guest_token, _ = await _register(client, "GUEST", "sdr.redeem.guest@example.com")

    await _delete(client, org_token, group_id)

    response = await client.post(
        f"/api/groups/public/{group_id}/join-code",
        json={"code": "123456"},
        headers=_auth(guest_token),
    )
    assert response.status_code == 404, response.text


async def test_mutationsOnDeletedGroup_return404(client: AsyncClient) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "sdr.mut.org@example.com")
    group_id = await _circle(client, org_token, "Krąg bez zmian")
    term_id = await _term(client, org_token, group_id, _in_days(3))
    product_id = await _resolve_product(client, org_token, "Sdr bębenek")
    guest_token, _ = await _register(client, "GUEST", "sdr.mut.guest@example.com")

    await _delete(client, org_token, group_id)

    org = _auth(org_token)
    responses = {
        "patch group": await client.patch(
            f"/api/groups/{group_id}", json={"name": "Nowa nazwa"}, headers=org
        ),
        "create term": await client.post(
            "/api/terms",
            json={"circle_group_id": str(group_id), "occurs_on": _in_days(5).isoformat()},
            headers=org,
        ),
        "patch term": await client.patch(
            f"/api/terms/{term_id}", json={"description": "Zmiana"}, headers=org
        ),
        "create need": await client.post(
            "/api/needed-items",
            json={"term_id": str(term_id), "product_id": product_id},
            headers=org,
        ),
        "rsvp": await client.post(
            f"/api/groups/public/{group_id}/rsvp",
            json={"term_id": str(term_id), "guardian_name": "Ola", "child_count": 1},
        ),
        "redeem join code": await client.post(
            f"/api/groups/public/{group_id}/join-code",
            json={"code": "123456"},
            headers=_auth(guest_token),
        ),
    }
    assert {name: r.status_code for name, r in responses.items()} == dict.fromkeys(responses, 404)
