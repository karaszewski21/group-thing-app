"""`app.groups.application.exchange_summary` — the "udostępnia rzecz"/
"przynosi na zajęcia" aggregation for a Circle's current Term. Setup (users,
circle, term, families, memberships) goes through the real HTTP API,
mirroring `test_term_item_listings.py`'s style; the aggregation functions
under test are called directly against `db_session`.

Flat `tests/` placement (no `tests/groups/` subpackage exists in this
codebase — see `test_group_layout_mode.py`)."""

from __future__ import annotations

from datetime import date, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.circulation.models import ReservationType
from app.config import settings
from app.core.auth_deps import Principal
from app.core.errors import AccessDeniedException, EntityNotFoundException
from app.core.security import decode_token
from app.families.models import Family, FamilyMembership, FamilyRole, FamilyRoleType
from app.groups import service
from app.groups.schemas import TakeTermItemListingRequest
from app.party.models import Party, PartyType


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _principal(token: str) -> Principal:
    claims = decode_token(token, settings.jwt_secret)
    return Principal(username=claims["sub"], authorities=frozenset())


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


async def _join_group_as_family_guardian(
    client: AsyncClient, guardian_token: str, group_id: int, family_name: str
) -> int:
    """Bootstraps `guardian_token`'s own Family and joins `group_id` as a
    plain `Membership` — the shape `resolveFamiliesForMemberships` (and this
    module's own `_resolve_family_guardians`) expect: a group member who is
    also an active GUARDIAN of a Family. Returns the Family id."""
    family = await client.post(
        "/api/families/mine", json={"name": family_name}, headers=_auth(guardian_token)
    )
    assert family.status_code == 201
    membership = await client.post(
        "/api/memberships",
        json={"group_id": group_id, "valid_from": date.today().isoformat()},
        headers=_auth(guardian_token),
    )
    assert membership.status_code == 201
    return int(family.json()["id"])


async def _resolve_product(client: AsyncClient, token: str, name: str) -> int:
    r = await client.post(
        "/api/products/resolve", json={"name": name, "category_id": 5}, headers=_auth(token)
    )
    assert r.status_code == 200
    return int(r.json()["id"])


async def _create_needed_item(
    client: AsyncClient, org_token: str, term_id: int, product_name: str
) -> int:
    product_id = await _resolve_product(client, org_token, product_name)
    r = await client.post(
        "/api/needed-items",
        json={"term_id": term_id, "product_id": product_id},
        headers=_auth(org_token),
    )
    assert r.status_code == 201
    return int(r.json()["id"])


async def _register_personal_item(client: AsyncClient, token: str, product_name: str) -> int:
    product_id = await _resolve_product(client, token, product_name)
    inv = await client.post(
        "/api/inventories",
        json={"inventory_type": "PERSONAL", "location": None},
        headers=_auth(token),
    )
    assert inv.status_code == 201
    item = await client.post(
        "/api/inventory-items",
        json={"inventory_id": inv.json()["id"], "product_id": product_id, "condition": "GOOD"},
        headers=_auth(token),
    )
    assert item.status_code == 201
    return int(item.json()["id"])


async def test_familyWithActivePledge_bringsItemTrue_sharesItemFalse(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "exs.org1@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "exs1")
    needed_item_id = await _create_needed_item(client, org_token, term_id, "Kredki")

    guardian_token, guardian_party_id = await _register(client, "GUEST", "exs.guardian1@example.com")
    family_id = await _join_group_as_family_guardian(client, guardian_token, group_id, "Rodzina 1")

    pledge = await client.post(
        "/api/pledges", json={"needed_item_id": needed_item_id}, headers=_auth(guardian_token)
    )
    assert pledge.status_code == 201

    summary = await service.get_group_exchange_summary(db_session, group_id, guardian_party_id)

    assert len(summary.families) == 1
    assert summary.families[0].family_id == family_id
    assert summary.families[0].brings_item is True
    assert summary.families[0].shares_item is False


async def test_familyWithActiveListingPreference_sharesItemTrue(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "exs.org2@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "exs2")

    guardian_token, guardian_party_id = await _register(client, "GUEST", "exs.guardian2@example.com")
    family_id = await _join_group_as_family_guardian(client, guardian_token, group_id, "Rodzina 2")

    # Eligibility for exchange-mechanism listings is Term-attendance-based
    # (or organizer), not Circle-Membership-based — RSVP separately, same
    # dual-eligibility shape `term_item_listings.py` already relies on.
    await client.post(
        f"/api/groups/public/{group_id}/rsvp",
        json={"term_id": term_id, "guardian_name": "ignored", "child_count": 0},
        headers=_auth(guardian_token),
    )
    item_id = await _register_personal_item(client, guardian_token, "Rowerek")
    await service.set_item_listing_preference(
        db_session, _principal(guardian_token), item_id, ReservationType.LEND
    )

    summary = await service.get_group_exchange_summary(db_session, group_id, guardian_party_id)

    assert len(summary.families) == 1
    assert summary.families[0].family_id == family_id
    assert summary.families[0].shares_item is True
    assert summary.families[0].brings_item is False


async def test_familyWithNeitherPledgeNorListing_bothFalse(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "exs.org3@example.com")
    group_id, _term_id = await _create_circle_and_term(client, org_token, "exs3")

    guardian_token, guardian_party_id = await _register(client, "GUEST", "exs.guardian3@example.com")
    family_id = await _join_group_as_family_guardian(client, guardian_token, group_id, "Rodzina 3")

    summary = await service.get_group_exchange_summary(db_session, group_id, guardian_party_id)

    assert len(summary.families) == 1
    assert summary.families[0].family_id == family_id
    assert summary.families[0].shares_item is False
    assert summary.families[0].brings_item is False


async def test_fulfilledOrCancelledOffer_doesNotCountAsActive_sharesItemFalse(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """A listing whose item is no longer `AVAILABLE` (taken and fulfilled)
    must not count as "shares_item" — the same "active" definition
    `list_browsable_term_item_listings` already enforces via
    `_is_item_available`."""
    org_token, _ = await _register(client, "ORGANIZER", "exs.org4@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "exs4")

    lister_token, lister_party_id = await _register(client, "GUEST", "exs.lister4@example.com")
    await _join_group_as_family_guardian(client, lister_token, group_id, "Rodzina Listera")
    await client.post(
        f"/api/groups/public/{group_id}/rsvp",
        json={"term_id": term_id, "guardian_name": "ignored", "child_count": 0},
        headers=_auth(lister_token),
    )
    item_id = await _register_personal_item(client, lister_token, "Namiot")
    await service.set_item_listing_preference(
        db_session, _principal(lister_token), item_id, ReservationType.GIFT
    )

    taker_token, _ = await _register(client, "GUEST", "exs.taker4@example.com")
    await client.post(
        f"/api/groups/public/{group_id}/rsvp",
        json={"term_id": term_id, "guardian_name": "ignored", "child_count": 0},
        headers=_auth(taker_token),
    )

    await service.take_item_listing(
        db_session,
        _principal(taker_token),
        item_id,
        TakeTermItemListingRequest(term_id=term_id, reservation_type="GIFT"),
    )

    summary = await service.get_group_exchange_summary(db_session, group_id, lister_party_id)

    assert len(summary.families) == 1
    assert summary.families[0].shares_item is False


async def test_viewerOutsideGroup_raisesAccessDenied(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "exs.org5@example.com")
    group_id, _term_id = await _create_circle_and_term(client, org_token, "exs5")

    guardian_token, _ = await _register(client, "GUEST", "exs.guardian5@example.com")
    await _join_group_as_family_guardian(client, guardian_token, group_id, "Rodzina 5")

    outsider_token, outsider_party_id = await _register(client, "GUEST", "exs.outsider5@example.com")

    with pytest.raises(AccessDeniedException):
        await service.get_group_exchange_summary(db_session, group_id, outsider_party_id)


async def test_familyWithoutActiveGuardian_emptyPartyIds_bothFalseNoCrash(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """spec.md edge case: a Circle member whose only active family role is
    CHILD (no active GUARDIAN `FamilyMembership` at all) still identifies a
    Family for the summary, but with an empty guardian `party_ids` set —
    `shares_item`/`brings_item` must resolve to `False`/`False` without
    raising, per spec.md Section 8.1's "rodzina bez opiekunów z rolą
    GUARDIAN"."""
    org_token, _ = await _register(client, "ORGANIZER", "exs.org6@example.com")
    group_id, _term_id = await _create_circle_and_term(client, org_token, "exs6")

    child_token, child_party_id = await _register(client, "GUEST", "exs.child6@example.com")

    # `register()` now auto-creates a solo Family (party as sole GUARDIAN) for
    # every new party (spec.md Core Requirements 3-4), so `child_party_id`
    # already has one active GUARDIAN `FamilyMembership` at this point —
    # soft-close it so this fixture still reaches the otherwise-unreachable
    # "member whose only active family role is CHILD, no GUARDIAN anywhere"
    # edge case this test targets.
    solo_guardian_membership = (
        await db_session.execute(
            select(FamilyMembership)
            .join(FamilyRole, FamilyMembership.from_role_id == FamilyRole.id)
            .where(
                FamilyRole.party_id == child_party_id,
                FamilyRole.role_type == FamilyRoleType.GUARDIAN,
                FamilyMembership.valid_to.is_(None),
            )
        )
    ).scalar_one()
    solo_guardian_membership.valid_to = date.today()
    await db_session.commit()

    # A bare Family with no GUARDIAN at all — deliberately built via direct
    # ORM inserts (not `POST /api/families`, which always bootstraps a fresh
    # guardian account together with the Family) to reach the otherwise-
    # unreachable-through-the-app "family with zero active guardians" state.
    family_party = Party(party_type=PartyType.ORGANIZATION, active=True)
    db_session.add(family_party)
    await db_session.flush()
    family = Family(party_id=family_party.id, name="Rodzina bez opiekuna")
    db_session.add(family)
    await db_session.flush()
    family_id = family.id

    child_role = FamilyRole(
        party_id=child_party_id, role_type=FamilyRoleType.CHILD, valid_from=date.today()
    )
    db_session.add(child_role)
    await db_session.flush()
    db_session.add(
        FamilyMembership(
            from_role_id=child_role.id,
            to_family_id=family_id,
            is_primary_contact=False,
            valid_from=date.today(),
        )
    )
    await db_session.commit()

    membership = await client.post(
        "/api/memberships",
        json={"group_id": group_id, "valid_from": date.today().isoformat()},
        headers=_auth(child_token),
    )
    assert membership.status_code == 201

    summary = await service.get_group_exchange_summary(db_session, group_id, child_party_id)

    assert len(summary.families) == 1
    assert summary.families[0].family_id == family_id
    assert summary.families[0].shares_item is False
    assert summary.families[0].brings_item is False


async def test_getFamilyExchangeOffers_returnsAllGuardianOffers(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "exs.org7@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "exs7")

    guardian_token, guardian_party_id = await _register(client, "GUEST", "exs.guardian7@example.com")
    family_id = await _join_group_as_family_guardian(client, guardian_token, group_id, "Rodzina 7")
    await client.post(
        f"/api/groups/public/{group_id}/rsvp",
        json={"term_id": term_id, "guardian_name": "ignored", "child_count": 0},
        headers=_auth(guardian_token),
    )
    item_id = await _register_personal_item(client, guardian_token, "Klocki")
    await service.set_item_listing_preference(
        db_session, _principal(guardian_token), item_id, ReservationType.SWAP
    )

    viewer_token, viewer_party_id = await _register(client, "GUEST", "exs.viewer7@example.com")
    await _join_group_as_family_guardian(client, viewer_token, group_id, "Rodzina Widza")

    offers = await service.get_family_exchange_offers(
        db_session, group_id, family_id, viewer_party_id
    )

    assert offers.family_id == family_id
    assert len(offers.offers) == 1
    assert offers.offers[0].item_id == item_id
    assert offers.offers[0].offered_types == ["SWAP"]


async def test_getFamilyExchangeOffers_familyFromOtherGroup_raisesNotFound(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    org1_token, _ = await _register(client, "ORGANIZER", "exs.org8a@example.com")
    group1_id, _term1_id = await _create_circle_and_term(client, org1_token, "exs8a")
    viewer_token, viewer_party_id = await _register(client, "GUEST", "exs.viewer8@example.com")
    await _join_group_as_family_guardian(client, viewer_token, group1_id, "Rodzina Widza 8")

    org2_token, _ = await _register(client, "ORGANIZER", "exs.org8b@example.com")
    group2_id, _term2_id = await _create_circle_and_term(client, org2_token, "exs8b")
    other_guardian_token, _ = await _register(client, "GUEST", "exs.other8@example.com")
    other_family_id = await _join_group_as_family_guardian(
        client, other_guardian_token, group2_id, "Rodzina Innej Grupy"
    )

    with pytest.raises(EntityNotFoundException):
        await service.get_family_exchange_offers(
            db_session, group1_id, other_family_id, viewer_party_id
        )
