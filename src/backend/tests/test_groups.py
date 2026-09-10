"""`app.groups` tests: `create_own_circle` idempotency (mirrors
`app.organizations.service.create_own_organization`'s resolve-or-create
shape), `create_term` happy path, and basic `NeededItem` creation."""

from __future__ import annotations

from datetime import date, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.groups.models import (
    Group,
    Leadership,
    NeededItem,
    Pledge,
    PledgeStatus,
    Term,
    TermAttendance,
)
from app.party.models import Party, PartyType


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


async def _create_circle_with_term(
    client: AsyncClient, token: str, circle_name: str, description: str | None = None
) -> tuple[int, int]:
    circle = await client.post(
        "/api/groups/mine", json={"name": circle_name}, headers=_auth_headers(token)
    )
    assert circle.status_code == 201
    circle_id = circle.json()["id"]
    term = await client.post(
        "/api/terms",
        json={
            "circle_group_id": circle_id,
            "occurs_on": date.today().isoformat(),
            "description": description,
        },
        headers=_auth_headers(token),
    )
    assert term.status_code == 201
    return circle_id, term.json()["id"]


async def _resolve_product(client: AsyncClient, token: str, name: str = "Bębenek") -> int:
    resolved = await client.post(
        "/api/products/resolve",
        json={"name": name, "category": "OTHER"},
        headers=_auth_headers(token),
    )
    assert resolved.status_code == 200
    return int(resolved.json()["id"])


async def _create_needed_item(
    client: AsyncClient, token: str, term_id: int, product_name: str = "Instrument"
) -> int:
    product_id = await _resolve_product(client, token, product_name)
    item = await client.post(
        "/api/needed-items",
        json={"term_id": term_id, "product_id": product_id, "description": "Bębenek"},
        headers=_auth_headers(token),
    )
    assert item.status_code == 201
    return item.json()["id"]


# --- Term / NeededItem / Group PATCH + DELETE (crud-terms-groups-items) --------


async def test_patchTerm_activeOrganizer_updatesInPlace(client: AsyncClient) -> None:
    token = await _register_organizer(client, "patch.term1@example.com")
    _circle_id, term_id = await _create_circle_with_term(
        client, token, "Krąg edycji", description="Oryginalny opis"
    )
    new_date = (date.today() + timedelta(days=7)).isoformat()

    response = await client.patch(
        f"/api/terms/{term_id}",
        json={"occurs_on": new_date},
        headers=_auth_headers(token),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["occurs_on"] == new_date
    assert body["description"] == "Oryginalny opis"


async def test_patchTerm_nonOrganizer_returns403(client: AsyncClient) -> None:
    token = await _register_organizer(client, "patch.term2@example.com")
    _circle_id, term_id = await _create_circle_with_term(client, token, "Krąg cudzy")
    guest_token, _party_id = await _register_guest(client, "patch.term2.guest@example.com")

    response = await client.patch(
        f"/api/terms/{term_id}",
        json={"description": "Nie wolno"},
        headers=_auth_headers(guest_token),
    )

    assert response.status_code == 403


async def test_patchTerm_unknownId_returns404(client: AsyncClient) -> None:
    token = await _register_organizer(client, "patch.term3@example.com")

    response = await client.patch(
        "/api/terms/999999999",
        json={"description": "cokolwiek"},
        headers=_auth_headers(token),
    )

    assert response.status_code == 404


async def test_patchTerm_invalidBody_returns400(client: AsyncClient) -> None:
    token = await _register_organizer(client, "patch.term4@example.com")
    _circle_id, term_id = await _create_circle_with_term(client, token, "Krąg walidacji")

    response = await client.patch(
        f"/api/terms/{term_id}",
        json={"description": "x" * 2001},
        headers=_auth_headers(token),
    )

    assert response.status_code == 400


async def test_patchNeededItem_activeOrganizer_updatesProductAndDescription(
    client: AsyncClient,
) -> None:
    token = await _register_organizer(client, "patch.ni1@example.com")
    _circle_id, term_id = await _create_circle_with_term(client, token, "Krąg rzeczy")
    needed_item_id = await _create_needed_item(client, token, term_id, product_name="Instrument")

    other_product_id = await _resolve_product(client, token, "Materiały plastyczne")
    response = await client.patch(
        f"/api/needed-items/{needed_item_id}",
        json={"product_id": other_product_id, "description": "duży format"},
        headers=_auth_headers(token),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["product_id"] == other_product_id
    assert body["product_name"] == "Materiały plastyczne"
    assert body["description"] == "duży format"

    # Description-only PATCH leaves the product untouched.
    desc_only = await client.patch(
        f"/api/needed-items/{needed_item_id}",
        json={"description": "mały format"},
        headers=_auth_headers(token),
    )
    assert desc_only.status_code == 200
    assert desc_only.json()["product_id"] == other_product_id
    assert desc_only.json()["description"] == "mały format"

    # Non-organizer PATCH on the same item → 403 (lightweight fold-in).
    guest_token, _party_id = await _register_guest(client, "patch.ni1.guest@example.com")
    forbidden = await client.patch(
        f"/api/needed-items/{needed_item_id}",
        json={"description": "x"},
        headers=_auth_headers(guest_token),
    )
    assert forbidden.status_code == 403


async def test_createNeededItem_unknownProductId_returns404(client: AsyncClient) -> None:
    token = await _register_organizer(client, "ni.unknownprod@example.com")
    _circle_id, term_id = await _create_circle_with_term(client, token, "Krąg rzeczy")

    response = await client.post(
        "/api/needed-items",
        json={"term_id": term_id, "product_id": 999999, "description": None},
        headers=_auth_headers(token),
    )
    assert response.status_code == 404


async def test_deleteNeededItem_openAndClaimedPledges_transitionsToWithdrawn(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token = await _register_organizer(client, "del.ni1@example.com")
    _circle_id, term_id = await _create_circle_with_term(client, token, "Krąg usuwania")
    needed_item_id = await _create_needed_item(client, token, term_id)

    guest_token, guest_party_id = await _register_guest(client, "del.ni1.guest@example.com")
    claimed = await client.post(
        "/api/pledges",
        json={"needed_item_id": needed_item_id},
        headers=_auth_headers(guest_token),
    )
    assert claimed.status_code == 201
    claimed_pledge_id = claimed.json()["id"]

    open_pledge = Pledge(
        needed_item_id=needed_item_id,
        pledged_by_party_id=guest_party_id,
        status=PledgeStatus.OPEN,
    )
    db_session.add(open_pledge)
    await db_session.commit()
    open_pledge_id = open_pledge.id

    response = await client.delete(
        f"/api/needed-items/{needed_item_id}", headers=_auth_headers(token)
    )
    assert response.status_code == 204

    db_session.expire_all()
    claimed_row = await db_session.get(Pledge, claimed_pledge_id)
    open_row = await db_session.get(Pledge, open_pledge_id)
    item_row = await db_session.get(NeededItem, needed_item_id)
    assert claimed_row is not None and claimed_row.status == PledgeStatus.WITHDRAWN
    assert open_row is not None and open_row.status == PledgeStatus.WITHDRAWN
    assert item_row is not None and item_row.deleted_at is not None

    listed = await client.get(
        f"/api/needed-items?term_id={term_id}", headers=_auth_headers(token)
    )
    assert listed.status_code == 200
    assert all(item["id"] != needed_item_id for item in listed.json())


async def test_deleteNeededItem_fulfilledPledgeExists_returns409(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token = await _register_organizer(client, "del.ni2@example.com")
    _circle_id, term_id = await _create_circle_with_term(client, token, "Krąg dostarczone")
    needed_item_id = await _create_needed_item(client, token, term_id)

    _guest_token, guest_party_id = await _register_guest(client, "del.ni2.guest@example.com")
    fulfilled = Pledge(
        needed_item_id=needed_item_id,
        pledged_by_party_id=guest_party_id,
        status=PledgeStatus.FULFILLED,
        resolved_reservation_id=123456,
    )
    db_session.add(fulfilled)
    await db_session.commit()
    fulfilled_id = fulfilled.id

    response = await client.delete(
        f"/api/needed-items/{needed_item_id}", headers=_auth_headers(token)
    )
    assert response.status_code == 409

    db_session.expire_all()
    item_row = await db_session.get(NeededItem, needed_item_id)
    pledge_row = await db_session.get(Pledge, fulfilled_id)
    assert item_row is not None and item_row.deleted_at is None
    assert pledge_row is not None
    assert pledge_row.status == PledgeStatus.FULFILLED
    assert pledge_row.resolved_reservation_id == 123456

    still_there = await client.get(
        f"/api/needed-items/{needed_item_id}", headers=_auth_headers(token)
    )
    assert still_there.status_code == 200


async def test_patchGroup_activeOrganizer_renamesInPlace(client: AsyncClient) -> None:
    token = await _register_organizer(client, "patch.group1@example.com")
    circle = await client.post(
        "/api/groups/mine", json={"name": "Stara Nazwa"}, headers=_auth_headers(token)
    )
    circle_id = circle.json()["id"]

    response = await client.patch(
        f"/api/groups/{circle_id}",
        json={"name": "Nowa Nazwa"},
        headers=_auth_headers(token),
    )

    assert response.status_code == 200
    assert response.json()["name"] == "Nowa Nazwa"

    blank = await client.patch(
        f"/api/groups/{circle_id}",
        json={"name": "   "},
        headers=_auth_headers(token),
    )
    assert blank.status_code == 400

    guest_token, _party_id = await _register_guest(client, "patch.group1.guest@example.com")
    forbidden = await client.patch(
        f"/api/groups/{circle_id}",
        json={"name": "Przejęcie"},
        headers=_auth_headers(guest_token),
    )
    assert forbidden.status_code == 403


async def test_createMyCircle_secondCall_returnsSameCircle_notADuplicate(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token = await _register_organizer(client, "circle.owner1@example.com")

    first = await client.post(
        "/api/groups/mine", json={"name": "Pierwsza Nazwa"}, headers=_auth_headers(token)
    )
    second = await client.post(
        "/api/groups/mine", json={"name": "Druga Nazwa (ignorowana)"}, headers=_auth_headers(token)
    )

    assert first.status_code == 201
    assert second.status_code == 201
    assert first.json()["id"] == second.json()["id"]
    # The second call's name is ignored — idempotent create returns the
    # EXISTING circle, it does not rename it.
    assert second.json()["name"] == "Pierwsza Nazwa"

    # Row-count assertion, not just a 200-shape check: exactly one Group
    # and one active Leadership were ever created for this party.
    group_count = (
        await db_session.execute(select(func.count()).select_from(Group))
    ).scalar_one()
    leadership_count = (
        await db_session.execute(select(func.count()).select_from(Leadership))
    ).scalar_one()
    assert group_count == 1
    assert leadership_count == 1


async def test_createTerm_happyPath_returns201WithTermFields(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token = await _register_organizer(client, "circle.owner2@example.com")
    circle = await client.post(
        "/api/groups/mine", json={"name": "Muzyczne Skrzaty"}, headers=_auth_headers(token)
    )
    circle_group_id = circle.json()["id"]

    response = await client.post(
        "/api/terms",
        json={
            "circle_group_id": circle_group_id,
            "occurs_on": date.today().isoformat(),
            "description": "Pierwsze spotkanie",
        },
        headers=_auth_headers(token),
    )

    assert response.status_code == 201
    body = response.json()
    assert body["circle_group_id"] == circle_group_id
    assert body["description"] == "Pierwsze spotkanie"


async def test_createNeededItem_happyPath_returns201WithProduct(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token = await _register_organizer(client, "circle.owner3@example.com")
    circle = await client.post(
        "/api/groups/mine", json={"name": "Krąg Rodzinny"}, headers=_auth_headers(token)
    )
    circle_group_id = circle.json()["id"]
    term = await client.post(
        "/api/terms",
        json={"circle_group_id": circle_group_id, "occurs_on": date.today().isoformat()},
        headers=_auth_headers(token),
    )
    term_id = term.json()["id"]

    product_id = await _resolve_product(client, token, "Instrument")
    response = await client.post(
        "/api/needed-items",
        json={"term_id": term_id, "product_id": product_id, "description": "Bębenek"},
        headers=_auth_headers(token),
    )

    assert response.status_code == 201
    body = response.json()
    assert body["term_id"] == term_id
    assert body["product_id"] == product_id
    assert body["product_name"] == "Instrument"
    assert body["product_category"] == "OTHER"
    assert body["description"] == "Bębenek"


async def test_getNeededItem_softDeleted_returns404(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token = await _register_organizer(client, "circle.softdel@example.com")
    circle = await client.post(
        "/api/groups/mine", json={"name": "Krąg soft-delete"}, headers=_auth_headers(token)
    )
    circle_group_id = circle.json()["id"]
    term = await client.post(
        "/api/terms",
        json={"circle_group_id": circle_group_id, "occurs_on": date.today().isoformat()},
        headers=_auth_headers(token),
    )
    term_id = term.json()["id"]
    product_id = await _resolve_product(client, token, "Instrument")
    item = await client.post(
        "/api/needed-items",
        json={"term_id": term_id, "product_id": product_id, "description": "Bębenek"},
        headers=_auth_headers(token),
    )
    needed_item_id = item.json()["id"]

    assert (
        await client.get(
            f"/api/needed-items/{needed_item_id}", headers=_auth_headers(token)
        )
    ).status_code == 200

    row = await db_session.get(NeededItem, needed_item_id)
    assert row is not None
    row.deleted_at = datetime.utcnow()
    await db_session.commit()

    response = await client.get(
        f"/api/needed-items/{needed_item_id}", headers=_auth_headers(token)
    )
    assert response.status_code == 404


async def _create_group_and_term(db_session: AsyncSession) -> tuple[Party, Term]:
    """Model-layer helper: a bare `Party`+`Group`+`Term` chain, just enough
    to give a `TermAttendance` row valid FK targets — no HTTP round-trip,
    since `TermAttendance` has no router/service yet (data-layer group)."""
    organizer_party = Party(party_type=PartyType.PERSON, active=True)
    db_session.add(organizer_party)
    await db_session.flush()

    group = Group(party_id=organizer_party.id, name="Krąg Testowy")
    db_session.add(group)
    await db_session.flush()

    term = Term(circle_group_id=group.id, occurs_on=date.today(), description=None)
    db_session.add(term)
    await db_session.flush()

    return organizer_party, term


async def test_termAttendance_create_persistsTermPartyIdAndChildCount(
    db_session: AsyncSession,
) -> None:
    _organizer_party, term = await _create_group_and_term(db_session)
    guest_party = Party(party_type=PartyType.PERSON, active=True)
    db_session.add(guest_party)
    await db_session.flush()

    attendance = TermAttendance(term_id=term.id, party_id=guest_party.id, child_count=2)
    db_session.add(attendance)
    await db_session.flush()

    assert attendance.id is not None
    assert attendance.term_id == term.id
    assert attendance.party_id == guest_party.id
    assert attendance.child_count == 2


async def test_termAttendance_childCount_defaultsToZero(db_session: AsyncSession) -> None:
    _organizer_party, term = await _create_group_and_term(db_session)
    guest_party = Party(party_type=PartyType.PERSON, active=True)
    db_session.add(guest_party)
    await db_session.flush()

    attendance = TermAttendance(term_id=term.id, party_id=guest_party.id)
    db_session.add(attendance)
    await db_session.flush()

    assert attendance.child_count == 0


async def test_termAttendance_unknownTermOrPartyId_violatesForeignKeyConstraint(
    db_session: AsyncSession,
) -> None:
    _organizer_party, term = await _create_group_and_term(db_session)
    guest_party = Party(party_type=PartyType.PERSON, active=True)
    db_session.add(guest_party)
    await db_session.flush()

    db_session.add(TermAttendance(term_id=999_999_999, party_id=guest_party.id, child_count=0))
    with pytest.raises(IntegrityError):
        await db_session.flush()
    await db_session.rollback()

    db_session.add(TermAttendance(term_id=term.id, party_id=999_999_999, child_count=0))
    with pytest.raises(IntegrityError):
        await db_session.flush()


async def test_getPublicCircle_noAuthHeader_returnsExpectedShape(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token = await _register_organizer(client, "circle.owner4@example.com")
    circle = await client.post(
        "/api/groups/mine", json={"name": "Krąg Publiczny"}, headers=_auth_headers(token)
    )
    circle_group_id = circle.json()["id"]
    term = await client.post(
        "/api/terms",
        json={
            "circle_group_id": circle_group_id,
            "occurs_on": date.today().isoformat(),
            "description": "Termin publiczny",
        },
        headers=_auth_headers(token),
    )
    term_id = term.json()["id"]
    product_id = await _resolve_product(client, token, "Instrument")
    await client.post(
        "/api/needed-items",
        json={"term_id": term_id, "product_id": product_id, "description": "Bębenek"},
        headers=_auth_headers(token),
    )

    # No Authorization header at all — this must succeed unauthenticated.
    response = await client.get(f"/api/groups/public/{circle_group_id}")

    assert response.status_code == 200
    body = response.json()
    assert body["id"] == circle_group_id
    assert body["name"] == "Krąg Publiczny"
    assert body["organizer_display_name"] is not None
    assert body["next_term"]["id"] == term_id
    assert body["next_term"]["needed_items"][0]["product_name"] == "Instrument"
    assert body["next_term"]["needed_items"][0]["description"] == "Bębenek"
    assert body["guardians"] == []


async def test_getPublicCircle_unknownId_returns404(client: AsyncClient) -> None:
    response = await client.get("/api/groups/public/999999999")
    assert response.status_code == 404


async def test_getPublicCircle_responseSchema_hasNoChildIdentifyingField(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Schema-level guarantee: `PublicCircleResponse` never carries a
    per-child field — there is nothing to hide since no per-child data is
    ever fetched (see `get_public_circle_view`'s docstring)."""
    from app.groups.schemas import PublicCircleResponse

    field_names = set(PublicCircleResponse.model_fields.keys())
    assert not any("child" in name.lower() for name in field_names)


# --- Group 6 gap-fill: DELETE ownership / idempotency + pledge read guard ------


async def test_deleteNeededItem_nonOrganizer_returns403(client: AsyncClient) -> None:
    token = await _register_organizer(client, "del.ni.forbidden@example.com")
    _circle_id, term_id = await _create_circle_with_term(client, token, "Krąg cudzego usuwania")
    needed_item_id = await _create_needed_item(client, token, term_id)
    guest_token, _party_id = await _register_guest(client, "del.ni.forbidden.guest@example.com")

    response = await client.delete(
        f"/api/needed-items/{needed_item_id}", headers=_auth_headers(guest_token)
    )
    assert response.status_code == 403

    still_there = await client.get(
        f"/api/needed-items/{needed_item_id}", headers=_auth_headers(token)
    )
    assert still_there.status_code == 200


async def test_deleteNeededItem_secondDelete_returns404(client: AsyncClient) -> None:
    token = await _register_organizer(client, "del.ni.idem@example.com")
    _circle_id, term_id = await _create_circle_with_term(client, token, "Krąg idempotencji")
    needed_item_id = await _create_needed_item(client, token, term_id)

    first = await client.delete(
        f"/api/needed-items/{needed_item_id}", headers=_auth_headers(token)
    )
    assert first.status_code == 204

    second = await client.delete(
        f"/api/needed-items/{needed_item_id}", headers=_auth_headers(token)
    )
    assert second.status_code == 404


async def test_getNeededItemPledges_parentSoftDeleted_returns404(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token = await _register_organizer(client, "pledges.softdel@example.com")
    _circle_id, term_id = await _create_circle_with_term(client, token, "Krąg zobowiązań")
    needed_item_id = await _create_needed_item(client, token, term_id)

    assert (
        await client.get(
            f"/api/pledges?needed_item_id={needed_item_id}", headers=_auth_headers(token)
        )
    ).status_code == 200

    row = await db_session.get(NeededItem, needed_item_id)
    assert row is not None
    row.deleted_at = datetime.utcnow()
    await db_session.commit()

    response = await client.get(
        f"/api/pledges?needed_item_id={needed_item_id}", headers=_auth_headers(token)
    )
    assert response.status_code == 404


async def test_patchTerm_emptyBody_returns200Noop(client: AsyncClient) -> None:
    token = await _register_organizer(client, "patch.term.noop@example.com")
    _circle_id, term_id = await _create_circle_with_term(
        client, token, "Krąg no-op", description="Bez zmian"
    )

    response = await client.patch(
        f"/api/terms/{term_id}", json={}, headers=_auth_headers(token)
    )

    assert response.status_code == 200
    assert response.json()["description"] == "Bez zmian"


async def test_patchGroup_unknownId_returns404(client: AsyncClient) -> None:
    token = await _register_organizer(client, "patch.group.unknown@example.com")

    response = await client.patch(
        "/api/groups/999999999",
        json={"name": "Nieistniejący"},
        headers=_auth_headers(token),
    )
    assert response.status_code == 404
