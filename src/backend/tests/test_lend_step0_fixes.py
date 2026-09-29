"""Krok 0 wypożyczeń — regression tests for B6 (+B2-lite), B7, B10, B12
(`.maister/tasks/development/2026-09-25-lend-step0-security-fixes`).

Every lent item here is produced through the groups flow (LEND listing ->
take -> Term ends -> `confirm-transaction`), never through the raw
`/api/reservations` write routes, since B6 restricts those to RETURN."""

from __future__ import annotations

from datetime import date, datetime, timedelta

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.groups.application.term_end_scan import scan_for_term_ended
from app.groups.domain import swap_events
from app.groups.models import Term
from app.notifications.models import Notification, NotificationKind
from app.notifications.outbox_listener import register as register_outbox_handlers
from app.outbox.dispatcher import dispatch_pending
from app.outbox.models import OutboxEntry


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _register(client: AsyncClient, role: str, email: str) -> tuple[str, int]:
    r = await client.post(
        "/api/auth/register", json={"role": role, "email": email, "password": "secret123"}
    )
    assert r.status_code == 201
    return r.json()["token"], r.json()["party_id"]


async def _user_id(client: AsyncClient, token: str) -> int:
    me = await client.get("/api/people/me", headers=_auth(token))
    assert me.status_code == 200
    return me.json()["account_user_id"]


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


async def _rsvp(client: AsyncClient, token: str, group_id: int, term_id: int) -> None:
    r = await client.post(
        f"/api/groups/public/{group_id}/rsvp",
        json={"term_id": term_id, "guardian_name": "ignored", "child_count": 0},
        headers=_auth(token),
    )
    assert r.status_code == 201


async def _category_id(client: AsyncClient, token: str) -> str:
    categories = await client.get("/api/categories", headers=_auth(token))
    assert categories.status_code == 200
    return str(categories.json()[0]["id"])


async def _register_personal_item(client: AsyncClient, token: str, product_name: str) -> int:
    product = await client.post(
        "/api/products/resolve",
        json={"name": product_name, "category_id": await _category_id(client, token)},
        headers=_auth(token),
    )
    assert product.status_code == 200
    inv = await client.post(
        "/api/inventories",
        json={"inventory_type": "PERSONAL", "location": None},
        headers=_auth(token),
    )
    assert inv.status_code == 201
    item = await client.post(
        "/api/inventory-items",
        json={
            "inventory_id": inv.json()["id"],
            "product_id": product.json()["id"],
            "condition": "GOOD",
        },
        headers=_auth(token),
    )
    assert item.status_code == 201
    return item.json()["id"]


async def _end_term(client: AsyncClient, org_token: str, term_id: int) -> None:
    patch = await client.patch(
        f"/api/terms/{term_id}",
        json={"occurs_on": (date.today() - timedelta(days=1)).isoformat()},
        headers=_auth(org_token),
    )
    assert patch.status_code == 200


async def _take_lend(client: AsyncClient, prefix: str) -> tuple[str, str, str, int, int, int, int]:
    """Owner lists a LEND item, borrower takes it (still PENDING, Term
    upcoming). Returns `(org_token, owner_token, borrower_token, group_id,
    term_id, item_id, reservation_id)`."""
    org_token, _ = await _register(client, "ORGANIZER", f"{prefix}.org@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, prefix)

    owner_token, _ = await _register(client, "GUEST", f"{prefix}.owner@example.com")
    await _rsvp(client, owner_token, group_id, term_id)
    item_id = await _register_personal_item(client, owner_token, f"Wózek {prefix}")
    pref = await client.put(
        f"/api/item-listing-preferences/{item_id}",
        json={"mode": "LEND"},
        headers=_auth(owner_token),
    )
    assert pref.status_code == 200

    borrower_token, _ = await _register(client, "GUEST", f"{prefix}.borrower@example.com")
    await _rsvp(client, borrower_token, group_id, term_id)
    take = await client.post(
        f"/api/term-item-listings/{item_id}/take",
        json={"term_id": term_id, "reservation_type": "LEND"},
        headers=_auth(borrower_token),
    )
    assert take.status_code == 200
    reservation_id = take.json()["resolved_reservation_id"]
    return org_token, owner_token, borrower_token, group_id, term_id, item_id, reservation_id


async def _lent_item(client: AsyncClient, prefix: str) -> tuple[str, str, str, int]:
    """A fulfilled LEND via the groups flow. Returns `(org_token,
    owner_token, borrower_token, item_id)` — the item now sits in the
    borrower's VIRTUAL inventory, balance LENT."""
    org_token, owner_token, borrower_token, _g, term_id, item_id, reservation_id = await _take_lend(
        client, prefix
    )
    await _end_term(client, org_token, term_id)
    confirm = await client.post(
        f"/api/reservations/{reservation_id}/confirm-transaction",
        json={"term_id": term_id},
        headers=_auth(borrower_token),
    )
    assert confirm.status_code == 200
    return org_token, owner_token, borrower_token, item_id


async def _balance(client: AsyncClient, token: str, item_id: int) -> dict:
    r = await client.get(f"/api/inventory-items/{item_id}/balance", headers=_auth(token))
    assert r.status_code == 200
    return r.json()


async def _raw_return(client: AsyncClient, token: str, item_id: int, reserved_by: int) -> int:
    r = await client.post(
        "/api/reservations",
        json={"item_id": item_id, "reservation_type": "RETURN", "reserved_by_user_id": reserved_by},
        headers=_auth(token),
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


# --- B6: raw write routes ---------------------------------------------------


async def test_rawCreateReservation_strangerLocksOthersAvailableItem_returns403(
    client: AsyncClient,
) -> None:
    owner_token, _ = await _register(client, "ORGANIZER", "s0b6a.owner@example.com")
    _group_id, term_id = await _create_circle_and_term(client, owner_token, "s0b6a")
    item_id = await _register_personal_item(client, owner_token, "Rowerek s0b6a")

    stranger_token, _ = await _register(client, "GUEST", "s0b6a.stranger@example.com")
    stranger_id = await _user_id(client, stranger_token)
    response = await client.post(
        "/api/reservations",
        json={
            "item_id": item_id,
            "reservation_type": "LEND",
            "reserved_by_user_id": stranger_id,
            "term_id": term_id,
        },
        headers=_auth(stranger_token),
    )

    assert response.status_code == 403
    assert (await _balance(client, owner_token, item_id))["status"] == "AVAILABLE"


async def test_rawCreateReturn_forSomeoneElsesLoan_returns403(client: AsyncClient) -> None:
    _org, owner_token, _borrower, item_id = await _lent_item(client, "s0b6b")
    stranger_token, _ = await _register(client, "GUEST", "s0b6b.stranger@example.com")
    owner_id = await _user_id(client, owner_token)

    response = await client.post(
        "/api/reservations",
        json={"item_id": item_id, "reservation_type": "RETURN", "reserved_by_user_id": owner_id},
        headers=_auth(stranger_token),
    )

    assert response.status_code == 403
    assert (await _balance(client, owner_token, item_id))["status"] == "LENT"


async def test_rawCreateReturn_reservedByAlwaysHomeOwner_bodyValueIgnored(
    client: AsyncClient,
) -> None:
    _org, owner_token, borrower_token, item_id = await _lent_item(client, "s0b6c")
    borrower_id = await _user_id(client, borrower_token)
    owner_id = await _user_id(client, owner_token)

    return_id = await _raw_return(client, borrower_token, item_id, reserved_by=borrower_id)

    reservation = await client.get(f"/api/reservations/{return_id}", headers=_auth(owner_token))
    assert reservation.json()["reserved_by_user_id"] == owner_id


async def test_rawConfirm_lendBeforeTermEnd_returns403(client: AsyncClient) -> None:
    _org, owner_token, _b, _g, _t, item_id, reservation_id = await _take_lend(client, "s0b6d")

    response = await client.post(
        f"/api/reservations/{reservation_id}/confirm", headers=_auth(owner_token)
    )

    assert response.status_code == 403
    assert (await _balance(client, owner_token, item_id))["status"] == "RESERVED"


async def test_rawCancelReturn_restoresLentAndKeepsDueDate(client: AsyncClient) -> None:
    """B2-lite: cancelling a RETURN must not leave the item AVAILABLE while it
    still sits in the borrower's VIRTUAL inventory."""
    _org, owner_token, borrower_token, item_id = await _lent_item(client, "s0b2a")
    owner_id = await _user_id(client, owner_token)
    due_before = (await _balance(client, owner_token, item_id))["due_date"]
    assert due_before is not None

    return_id = await _raw_return(client, borrower_token, item_id, reserved_by=owner_id)
    cancel = await client.post(
        f"/api/reservations/{return_id}/cancel", headers=_auth(borrower_token)
    )
    assert cancel.status_code == 200

    balance = await _balance(client, owner_token, item_id)
    assert balance["status"] == "LENT"
    assert balance["due_date"] == due_before


async def test_rawGiftToSelf_afterCancelledReturn_isRejected(client: AsyncClient) -> None:
    """The theft chain: cancel RETURN, then raw-GIFT the borrowed item to
    oneself. Must never move the item out of the owner's ownership."""
    org_token, owner_token, borrower_token, item_id = await _lent_item(client, "s0b2b")
    owner_id = await _user_id(client, owner_token)
    borrower_id = await _user_id(client, borrower_token)
    _g, other_term_id = await _create_circle_and_term(client, org_token, "s0b2b-2")

    return_id = await _raw_return(client, borrower_token, item_id, reserved_by=owner_id)
    await client.post(f"/api/reservations/{return_id}/cancel", headers=_auth(borrower_token))
    gift = await client.post(
        "/api/reservations",
        json={
            "item_id": item_id,
            "reservation_type": "GIFT",
            "reserved_by_user_id": borrower_id,
            "term_id": other_term_id,
        },
        headers=_auth(borrower_token),
    )

    assert gift.status_code == 403
    item = await client.get(f"/api/inventory-items/{item_id}", headers=_auth(owner_token))
    assert item.json()["home_inventory_id"] is not None


# --- B7: Term taken from the reservation -------------------------------------


async def test_confirmTransaction_otherPastTermId_whileOwnTermUpcoming_returns409(
    client: AsyncClient,
) -> None:
    org_token, _owner, borrower_token, group_id, _term_id, _item, reservation_id = await _take_lend(
        client, "s0b7a"
    )
    other_term = await client.post(
        "/api/terms",
        json={
            "circle_group_id": group_id,
            "occurs_on": (date.today() + timedelta(days=3)).isoformat(),
        },
        headers=_auth(org_token),
    )
    assert other_term.status_code == 201
    other_term_id = other_term.json()["id"]
    await _end_term(client, org_token, other_term_id)

    confirm = await client.post(
        f"/api/reservations/{reservation_id}/confirm-transaction",
        json={"term_id": other_term_id},
        headers=_auth(borrower_token),
    )

    assert confirm.status_code == 409
    status = await client.get(f"/api/reservations/{reservation_id}", headers=_auth(borrower_token))
    assert status.json()["status"] == "PENDING"


async def test_confirmTransaction_onReturnReservation_returns409(client: AsyncClient) -> None:
    """RETURN is not a Term transaction — the owner must not be able to
    complete a borrower's pending RETURN through confirm-transaction (the
    two-sided return arrives with the Loan MVP)."""
    _org, owner_token, borrower_token, item_id = await _lent_item(client, "s0b7b")
    owner_id = await _user_id(client, owner_token)
    return_id = await _raw_return(client, borrower_token, item_id, reserved_by=owner_id)
    return_term_id = (
        await client.get(f"/api/reservations/{return_id}", headers=_auth(owner_token))
    ).json()["term_id"]

    confirm = await client.post(
        f"/api/reservations/{return_id}/confirm-transaction",
        json={"term_id": return_term_id},
        headers=_auth(owner_token),
    )

    assert confirm.status_code == 409
    assert (await _balance(client, owner_token, item_id))["status"] == "RESERVED"


# --- B10: owner still sees a lent item ----------------------------------------


async def test_listMyLentOutItems_lentItem_listedForOwnerWithBorrowerAndDueDate(
    client: AsyncClient,
) -> None:
    _org, owner_token, borrower_token, item_id = await _lent_item(client, "s0b10a")

    owner_lent = await client.get("/api/inventory-items/mine/lent-out", headers=_auth(owner_token))
    assert owner_lent.status_code == 200
    rows = {row["id"]: row for row in owner_lent.json()}
    assert item_id in rows
    assert rows[item_id]["lent_to_display_name"]
    assert rows[item_id]["lent_due_date"] is not None

    owner_items = await client.get("/api/inventory-items/mine", headers=_auth(owner_token))
    assert item_id not in {row["id"] for row in owner_items.json()}

    borrower_lent = await client.get(
        "/api/inventory-items/mine/lent-out", headers=_auth(borrower_token)
    )
    assert borrower_lent.json() == []


async def test_listMyLentOutItems_nothingLent_isEmpty(client: AsyncClient) -> None:
    owner_token, _ = await _register(client, "GUEST", "s0b10b.owner@example.com")
    item_id = await _register_personal_item(client, owner_token, "Sanki s0b10b")

    lent = await client.get("/api/inventory-items/mine/lent-out", headers=_auth(owner_token))
    mine = await client.get("/api/inventory-items/mine", headers=_auth(owner_token))

    assert lent.json() == []
    assert [row["id"] for row in mine.json()] == [item_id]


# --- B12: term-end prompt for LEND --------------------------------------------


async def _push_term_into_past(db_session: AsyncSession, term_id: int) -> None:
    term = (await db_session.execute(select(Term).where(Term.id == term_id))).scalar_one()
    term.occurs_on = datetime.now() - timedelta(hours=1)
    await db_session.commit()


async def _outbox_payloads(db_session: AsyncSession, event_type: str) -> list[dict]:
    result = await db_session.execute(
        select(OutboxEntry).where(OutboxEntry.event_type == event_type)
    )
    return [entry.payload for entry in result.scalars().all()]


async def test_scan_pendingLendPastTermEnd_promptsBothPartiesWithReservationId(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    _org, _owner, borrower_token, _g, term_id, _item, reservation_id = await _take_lend(
        client, "s0b12a"
    )
    await _push_term_into_past(db_session, term_id)

    await scan_for_term_ended(db_session)
    await scan_for_term_ended(db_session)

    payloads = await _outbox_payloads(db_session, swap_events.TERM_ENDED_GIVEAWAY)
    assert [p["reservation_id"] for p in payloads] == [reservation_id]

    register_outbox_handlers()
    await dispatch_pending(db_session)
    notifications = (
        (
            await db_session.execute(
                select(Notification).where(
                    Notification.kind == NotificationKind.TERM_CONFIRMATION_NEEDED
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(notifications) == 2
    assert {str(getattr(n, "reservation_id", None)) for n in notifications} == {reservation_id}


async def test_scan_confirmedPledgeLend_promptsWithReservationId(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "s0b12b.org@example.com")
    circle = await client.post(
        "/api/groups/mine", json={"name": "Krąg s0b12b"}, headers=_auth(org_token)
    )
    term = await client.post(
        "/api/terms",
        json={
            "circle_group_id": circle.json()["id"],
            "occurs_on": (date.today() + timedelta(days=1)).isoformat(),
        },
        headers=_auth(org_token),
    )
    term_id = term.json()["id"]
    product = await client.post(
        "/api/products/resolve",
        json={"name": "Skrzypce s0b12b", "category_id": await _category_id(client, org_token)},
        headers=_auth(org_token),
    )
    needed = await client.post(
        "/api/needed-items",
        json={"term_id": term_id, "product_id": product.json()["id"], "description": None},
        headers=_auth(org_token),
    )
    guest_token, _ = await _register(client, "GUEST", "s0b12b.guest@example.com")
    pledge = await client.post(
        "/api/pledges", json={"needed_item_id": needed.json()["id"]}, headers=_auth(guest_token)
    )
    fulfilled = await client.post(
        f"/api/pledges/{pledge.json()['id']}/fulfill",
        json={"condition": "GOOD"},
        headers=_auth(guest_token),
    )
    assert fulfilled.status_code == 200
    reservation_id = fulfilled.json()["resolved_reservation_id"]
    await _push_term_into_past(db_session, term_id)

    await scan_for_term_ended(db_session)

    payloads = await _outbox_payloads(db_session, swap_events.TERM_ENDED_GIVEAWAY)
    assert [p["reservation_id"] for p in payloads] == [reservation_id]


async def test_scan_returnReservation_isNotPrompted(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """A RETURN inherits its LEND's (past) term_id — it must not be treated
    as a Term hand-over by the scan."""
    _org, owner_token, borrower_token, item_id = await _lent_item(client, "s0b12c")
    owner_id = await _user_id(client, owner_token)
    return_id = await _raw_return(client, borrower_token, item_id, reserved_by=owner_id)
    return_term_id = (
        await client.get(f"/api/reservations/{return_id}", headers=_auth(owner_token))
    ).json()["term_id"]
    await _push_term_into_past(db_session, return_term_id)

    await scan_for_term_ended(db_session)

    payloads = await _outbox_payloads(db_session, swap_events.TERM_ENDED_GIVEAWAY)
    assert return_id not in {p["reservation_id"] for p in payloads}
