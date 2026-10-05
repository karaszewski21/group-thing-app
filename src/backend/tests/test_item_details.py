"""`GET /api/inventory-items/{id}/details`: the item page's read model —
product fields, shared description (with the `Product.description`
fallback), gallery, `is_owner` and the privacy-labelled current status."""

from __future__ import annotations

import uuid

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import User
from app.circulation.domain.item_privacy import (
    OTHER_FAMILY_LABEL,
    ItemStatusCode,
    derive_status,
    label,
)
from app.circulation.models import BalanceStatus, InventoryItem, ReservationType
from app.groups import service as groups_service
from app.groups.models import Term
from app.groups.schemas import TakeTermItemListingRequest
from app.moderation.status import ModerationStatus
from app.product.models import Product, ProductPhoto
from tests.test_circulation_ledger import (
    _confirm_and_fulfill,
    _register_item_via_api,
    _register_user,
    _reserve,
)
from tests.test_term_item_listings import (
    _auth,
    _create_circle_and_term,
    _principal,
    _register,
    _register_personal_item,
    _rsvp,
)


async def _display_name(client: AsyncClient, headers: dict[str, str]) -> str:
    me = await client.get("/api/people/me", headers=headers)
    assert me.status_code == 200
    return str(me.json()["display_name"])


async def _details(client: AsyncClient, item_id: uuid.UUID, headers: dict[str, str]) -> dict:
    response = await client.get(f"/api/inventory-items/{item_id}/details", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


async def _product_of(db: AsyncSession, item_id: uuid.UUID) -> Product:
    item = (await db.execute(select(InventoryItem).where(InventoryItem.id == item_id))).scalar_one()
    return (await db.execute(select(Product).where(Product.id == item.product_id))).scalar_one()


async def test_getItemDetails_ownerAndNonOwner_returnsFieldsPhotosAndIsOwnerFlag(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner_token, _ = await _register(client, "GUEST", "itd.owner1@example.com")
    other_token, _ = await _register(client, "GUEST", "itd.other1@example.com")
    item_id = await _register_personal_item(client, owner_token, "Rowerek biegowy")
    category = (await client.get("/api/categories", headers=_auth(owner_token))).json()[0]

    product = await _product_of(db_session, item_id)
    product.plugin_data = {
        "ai-description": {"description": "Wspólny opis\nw dwóch liniach", "model": "x"},
        "other-plugin": {"k": 1},
    }
    product.description = "Opis admina"
    product.photo_url = "https://example.com/catalog.jpg"
    owner_username = _principal(owner_token).username
    owner_user_id = (
        await db_session.execute(select(User.id).where(User.username == owner_username))
    ).scalar_one()

    def photo(key: str, sort_order: int, status: ModerationStatus) -> ProductPhoto:
        return ProductPhoto(
            product_id=product.id,
            storage_key=f"products/{product.id}/{key}",
            width=10,
            height=10,
            size_bytes=100,
            content_sha256=key * 64,
            status=status,
            uploaded_by_user_id=owner_user_id,
            sort_order=sort_order,
        )

    db_session.add_all(
        [
            photo("b", 1, ModerationStatus.APPROVED),
            photo("a", 0, ModerationStatus.APPROVED),
            photo("c", 2, ModerationStatus.PENDING),
        ]
    )
    await db_session.commit()

    owner_view = await _details(client, item_id, _auth(owner_token))

    assert owner_view["id"] == str(item_id)
    assert owner_view["product_id"] == str(product.id)
    assert owner_view["name"] == "Rowerek biegowy"
    assert owner_view["category_id"] == str(category["id"])
    assert owner_view["category_name"] == category["name"]
    assert owner_view["condition"] == "GOOD"
    assert owner_view["description"] == "Wspólny opis\nw dwóch liniach"
    cdn = f"https://cdn.test/products/{product.id}"
    assert [(p["url"], p["thumb_url"], p["status"]) for p in owner_view["photos"]] == [
        (f"{cdn}/a/w1600.webp", f"{cdn}/a/w400.webp", "APPROVED"),
        (f"{cdn}/b/w1600.webp", f"{cdn}/b/w400.webp", "APPROVED"),
        (
            f"https://origin.test/products/{product.id}/c/w1600.webp?signed",
            f"https://origin.test/products/{product.id}/c/w400.webp?signed",
            "PENDING",
        ),
    ]
    assert "text_status" not in owner_view
    assert owner_view["product_photo_url"] == "https://example.com/catalog.jpg"
    assert owner_view["is_owner"] is True
    assert owner_view["deleted_at"] is None
    assert owner_view["status"] == {
        "code": "AVAILABLE",
        "term_occurs_on": None,
        "due_date": None,
        "counterparty_label": None,
    }

    other_view = await _details(client, item_id, _auth(other_token))
    assert other_view["is_owner"] is False
    assert other_view["name"] == "Rowerek biegowy"
    # No product-text gate any more: every viewer gets the description.
    assert other_view["description"] == "Wspólny opis\nw dwóch liniach"
    assert "text_status" not in other_view
    assert [p["sort_order"] for p in other_view["photos"]] == [0, 1]


async def test_getItemDetails_pluginDescriptionMissingOrBlank_fallsBackOrStaysCleared(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner_token, _ = await _register(client, "GUEST", "itd.owner2@example.com")
    item_id = await _register_personal_item(client, owner_token, "Hulajnoga")
    product = await _product_of(db_session, item_id)

    product.plugin_data = None
    product.description = "Opis admina"
    await db_session.commit()
    assert (await _details(client, item_id, _auth(owner_token)))["description"] == "Opis admina"

    product.plugin_data = {"ai-description": {"model": "x"}}
    await db_session.commit()
    assert (await _details(client, item_id, _auth(owner_token)))["description"] == "Opis admina"

    product.plugin_data = {"ai-description": {"description": "   "}}
    await db_session.commit()
    assert (await _details(client, item_id, _auth(owner_token)))["description"] is None


async def test_getItemDetails_deletedOrMissingItem_returns200DeletedOr404(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner_token, _ = await _register(client, "GUEST", "itd.owner3@example.com")
    item_id = await _register_personal_item(client, owner_token, "Sanki")
    deleted = await client.delete(f"/api/inventory-items/{item_id}", headers=_auth(owner_token))
    assert deleted.status_code == 204

    view = await _details(client, item_id, _auth(owner_token))

    assert view["deleted_at"] is not None
    assert view["status"] == {
        "code": "DELETED",
        "term_occurs_on": None,
        "due_date": None,
        "counterparty_label": None,
    }
    missing = await client.get(
        f"/api/inventory-items/{uuid.uuid4()}/details", headers=_auth(owner_token)
    )
    assert missing.status_code == 404


async def test_getItemDetails_afterTake_reservedStatusWithTermDateAndPerViewerLabel(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "itd.org4@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "itd4")
    lister_token, _ = await _register(client, "GUEST", "itd.lister4@example.com")
    await _rsvp(client, lister_token, group_id, term_id)
    item_id = await _register_personal_item(client, lister_token, "Fotelik")
    await groups_service.set_item_listing_preference(
        db_session, _principal(lister_token), item_id, ReservationType.GIFT
    )
    taker_token, _ = await _register(client, "GUEST", "itd.taker4@example.com")
    await _rsvp(client, taker_token, group_id, term_id)
    third_token, _ = await _register(client, "GUEST", "itd.third4@example.com")

    await groups_service.take_item_listing(
        db_session,
        _principal(taker_token),
        item_id,
        TakeTermItemListingRequest(term_id=term_id, reservation_type="GIFT"),
    )
    term = (await db_session.execute(select(Term).where(Term.id == term_id))).scalar_one()
    taker_name = await _display_name(client, _auth(taker_token))

    labels = {}
    for viewer, token in (("taker", taker_token), ("owner", lister_token), ("third", third_token)):
        status = (await _details(client, item_id, _auth(token)))["status"]
        assert status["code"] == "RESERVED"
        assert status["term_occurs_on"] == term.occurs_on.isoformat()
        assert status["due_date"] is None
        labels[viewer] = status["counterparty_label"]

    assert labels == {"taker": "Ty", "owner": taker_name, "third": "inna rodzina"}


async def test_getItemDetails_offeredItemInPendingSwap_returnsProposedSwapThenInTransitAfterAccept(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "itd.org5@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "itd5")
    lister_token, _ = await _register(client, "GUEST", "itd.lister5@example.com")
    await _rsvp(client, lister_token, group_id, term_id)
    listed_item_id = await _register_personal_item(client, lister_token, "Klocki")
    await groups_service.set_item_listing_preference(
        db_session, _principal(lister_token), listed_item_id, ReservationType.SWAP
    )
    proposer_token, _ = await _register(client, "GUEST", "itd.proposer5@example.com")
    await _rsvp(client, proposer_token, group_id, term_id)
    offered_item_id = await _register_personal_item(client, proposer_token, "Lalka")
    await groups_service.set_item_listing_preference(
        db_session, _principal(proposer_token), offered_item_id, ReservationType.SWAP
    )

    proposal = await groups_service.propose_swap(
        db_session, _principal(proposer_token), listed_item_id, offered_item_id, term_id
    )

    lister_name = await _display_name(client, _auth(lister_token))
    proposer_view = (await _details(client, offered_item_id, _auth(proposer_token)))["status"]
    assert proposer_view == {
        "code": "PROPOSED_SWAP",
        "term_occurs_on": None,
        "due_date": None,
        "counterparty_label": lister_name,
    }
    lister_view = (await _details(client, offered_item_id, _auth(lister_token)))["status"]
    assert lister_view["code"] == "PROPOSED_SWAP"
    assert lister_view["counterparty_label"] == "Ty"

    await groups_service.accept_swap_proposal(db_session, _principal(lister_token), proposal.id)

    term = (await db_session.execute(select(Term).where(Term.id == term_id))).scalar_one()
    accepted = (await _details(client, offered_item_id, _auth(proposer_token)))["status"]
    assert accepted["code"] == "IN_TRANSIT"
    assert accepted["term_occurs_on"] == term.occurs_on.isoformat()
    assert accepted["counterparty_label"] == lister_name


async def test_getItemDetails_lentItem_returnsLentWithDueDateAndBorrowerLabel(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner_headers, owner_id = await _register_user(client, "itd.owner6@example.com")
    borrower_headers, borrower_id = await _register_user(client, "itd.borrower6@example.com")
    third_headers, _ = await _register_user(client, "itd.third6@example.com")
    _, item_id = await _register_item_via_api(client, db_session, owner_headers)
    lend_id = await _reserve(
        client,
        db_session,
        headers=owner_headers,
        item_id=item_id,
        reservation_type=ReservationType.LEND,
        reserved_by_user_id=borrower_id,
    )
    await _confirm_and_fulfill(db_session, lend_id, owner_id)
    borrower_name = await _display_name(client, borrower_headers)

    owner_view = await _details(client, item_id, owner_headers)
    assert owner_view["is_owner"] is True
    assert owner_view["status"]["code"] == "LENT"
    assert owner_view["status"]["due_date"] is not None
    assert owner_view["status"]["term_occurs_on"] is None
    assert owner_view["status"]["counterparty_label"] == borrower_name

    borrower_view = await _details(client, item_id, borrower_headers)
    assert borrower_view["is_owner"] is False
    assert borrower_view["status"]["counterparty_label"] == "Ty"

    third_view = await _details(client, item_id, third_headers)
    assert third_view["status"]["counterparty_label"] == "inna rodzina"


async def test_getItemDetails_returnConfirmedByBorrower_returnsReturningWithoutTermDate(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner_headers, owner_id = await _register_user(client, "itd.owner7@example.com")
    borrower_headers, borrower_id = await _register_user(client, "itd.borrower7@example.com")
    _, item_id = await _register_item_via_api(client, db_session, owner_headers)
    lend_id = await _reserve(
        client,
        db_session,
        headers=owner_headers,
        item_id=item_id,
        reservation_type=ReservationType.LEND,
        reserved_by_user_id=borrower_id,
    )
    await _confirm_and_fulfill(db_session, lend_id, owner_id)
    created = await client.post(
        "/api/reservations", json={"item_id": str(item_id)}, headers=borrower_headers
    )
    assert created.status_code == 201
    confirmed = await client.post(
        f"/api/reservations/{created.json()['id']}/confirm", headers=borrower_headers
    )
    assert confirmed.status_code == 200

    status = (await _details(client, item_id, borrower_headers))["status"]

    assert status["code"] == "RETURNING"
    assert status["term_occurs_on"] is None
    assert status["counterparty_label"] == await _display_name(client, owner_headers)


async def test_getItemDetails_malformedItemId_returns400(client: AsyncClient) -> None:
    token, _ = await _register(client, "GUEST", "itd.malformed8@example.com")

    response = await client.get("/api/inventory-items/not-a-uuid/details", headers=_auth(token))

    assert response.status_code == 400


def test_label_viewerWithoutUserOrMissingDisplayName_isOtherFamily() -> None:
    owner, borrower = uuid.uuid4(), uuid.uuid4()
    participants = {owner, borrower}

    assert label(borrower, None, participants, "Anna") == OTHER_FAMILY_LABEL
    assert label(owner, None, participants, "Jan") == OTHER_FAMILY_LABEL
    assert label(borrower, owner, participants, None) == OTHER_FAMILY_LABEL
    assert label(borrower, owner, participants, "") == OTHER_FAMILY_LABEL
    assert label(borrower, owner, participants, "Anna") == "Anna"

    lent = derive_status(
        deleted=False,
        balance_status=BalanceStatus.LENT,
        due_date=None,
        reservation=None,
        term_occurs_on=None,
        viewer=None,
        holder_user_id=borrower,
        home_owner_user_id=owner,
        display_names={borrower: "Anna", owner: "Jan"},
    )
    assert lent.code == ItemStatusCode.LENT
    assert lent.counterparty_label == OTHER_FAMILY_LABEL
