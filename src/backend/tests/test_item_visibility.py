"""`ItemListingPreference.visibility` (PUBLIC/PRIVATE): set through
`PUT /api/item-listing-preferences/{item_id}` only together with a mode, kept
when omitted, PUBLIC for new rows, and exposed on `GET /api/inventory-items/mine`.

Enforcement: a PRIVATE item is 404 on every read path except for its owner,
a party sharing a PRIVATE circle with the owner and a current counterparty;
it is hidden on events, PUBLIC-circle terms, the organizer and owner items
pages, and never reservable in an event or a PUBLIC-circle term."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import time
from typing import Any

import pytest
from httpx import AsyncClient, Response
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.groups import service as groups_service
from app.groups.infrastructure import repository
from app.groups.models import ItemListingPreference, ItemVisibility
from tests.test_event_item_reservations import _listed_items, _sign_up
from tests.test_item_actions import _circle, _day, _event, _make_private, _term
from tests.test_organizer_page import _organization_slug
from tests.test_personal_pickup import _owner as _personal_owner
from tests.test_personal_pickup import _propose
from tests.test_term_item_listings import _register as _register_party
from tests.test_term_item_listings import _rsvp
from tests.test_term_item_listings_router import _auth, _register, _register_personal_item

PREFERENCE_KEYS = {
    "id",
    "item_id",
    "owner_party_id",
    "mode",
    "visibility",
    "created_at",
    "updated_at",
}


async def _put(client: AsyncClient, token: str, item_id: str, body: dict) -> Response:
    return await client.put(
        f"/api/item-listing-preferences/{item_id}", json=body, headers=_auth(token)
    )


async def _mine_visibility(client: AsyncClient, token: str) -> dict[str, str | None]:
    response = await client.get("/api/inventory-items/mine", headers=_auth(token))
    assert response.status_code == 200, response.text
    return {row["id"]: row["listing_visibility"] for row in response.json()}


async def test_putPreference_visibilityWithoutMode_returns400(client: AsyncClient) -> None:
    token, _ = await _register(client, "GUEST", "ivis.nomode@example.com")
    item_id = await _register_personal_item(client, token, "Rower ivis-nomode")
    assert (await _put(client, token, item_id, {"mode": "GIFT"})).status_code == 200

    response = await _put(client, token, item_id, {"visibility": "PRIVATE"})

    # The app's validation handler answers 400 with field errors.
    assert response.status_code == 400, response.text
    messages = response.json()["fieldErrors"].values()
    assert any("Ustaw tryb, żeby wybrać widoczność." in message for message in messages)
    assert await _mine_visibility(client, token) == {item_id: "PUBLIC"}


async def test_putPreference_modeAndPrivate_keepsRowReturnsVisibility(
    client: AsyncClient,
) -> None:
    token, _ = await _register(client, "GUEST", "ivis.private@example.com")
    item_id = await _register_personal_item(client, token, "Rower ivis-private")
    assert (await _put(client, token, item_id, {"mode": "SWAP"})).status_code == 200

    response = await _put(client, token, item_id, {"mode": "SWAP", "visibility": "PRIVATE"})

    assert response.status_code == 200, response.text
    assert set(response.json()) == PREFERENCE_KEYS
    assert response.json()["mode"] == "SWAP"
    assert response.json()["visibility"] == "PRIVATE"


async def test_putPreference_modeOnly_keepsExistingVisibility(client: AsyncClient) -> None:
    token, _ = await _register(client, "GUEST", "ivis.keep@example.com")
    item_id = await _register_personal_item(client, token, "Rower ivis-keep")
    assert (
        await _put(client, token, item_id, {"mode": "GIFT", "visibility": "PRIVATE"})
    ).status_code == 200

    response = await _put(client, token, item_id, {"mode": "SWAP"})

    assert response.status_code == 200, response.text
    assert response.json()["mode"] == "SWAP"
    assert response.json()["visibility"] == "PRIVATE"


async def test_putPreference_newRow_defaultsPublic(client: AsyncClient) -> None:
    token, _ = await _register(client, "GUEST", "ivis.new@example.com")
    item_id = await _register_personal_item(client, token, "Rower ivis-new")

    response = await _put(client, token, item_id, {"mode": "GIFT"})

    assert response.status_code == 200, response.text
    assert response.json()["visibility"] == "PUBLIC"


async def test_listMyInventoryItems_exposesListingVisibility(client: AsyncClient) -> None:
    token, _ = await _register(client, "GUEST", "ivis.mine@example.com")
    item_id = await _register_personal_item(client, token, "Rower ivis-mine")
    assert (
        await _put(client, token, item_id, {"mode": "GIFT", "visibility": "PRIVATE"})
    ).status_code == 200
    assert await _mine_visibility(client, token) == {item_id: "PRIVATE"}

    assert (await _put(client, token, item_id, {"mode": None})).status_code == 200

    assert await _mine_visibility(client, token) == {item_id: None}


# --- Enforcement (S3) -------------------------------------------------------

UNPLACEABLE_MESSAGE = "Tej rzeczy nie można zarezerwować w tym miejscu"


@dataclass(frozen=True)
class _World:
    """An ORGANIZER owner leading a PRIVATE circle (one term; a standing
    member and an RSVP-only non-member both attend it) and a PUBLIC circle
    (one term the member attends), authoring an event the member and a
    counterparty attend. `reserved` (taken by the counterparty in the event
    while still PUBLIC) and `free` are PRIVATE; `public` stays PUBLIC."""

    owner: str
    owner_party: uuid.UUID
    member: str
    rsvp_only: str
    stranger: str
    counterparty: str
    private_circle: uuid.UUID
    private_term: uuid.UUID
    public_circle: uuid.UUID
    public_term: uuid.UUID
    event: uuid.UUID
    reserved: uuid.UUID
    free: uuid.UUID
    public: uuid.UUID


async def _world(client: AsyncClient, db_session: AsyncSession, prefix: str) -> _World:
    owner, owner_party = await _register_party(client, "ORGANIZER", f"{prefix}.owner@example.com")
    member, member_party = await _register_party(client, "GUEST", f"{prefix}.member@example.com")
    rsvp_only, _ = await _register_party(client, "GUEST", f"{prefix}.rsvp@example.com")
    stranger, _ = await _register_party(client, "GUEST", f"{prefix}.stranger@example.com")
    counterparty, _ = await _register_party(client, "GUEST", f"{prefix}.cp@example.com")

    private_circle = await _circle(client, owner, f"Prywatny {prefix}")
    private_term = await _term(client, owner, private_circle, _day(6).date())
    for token in (member, rsvp_only):
        await _rsvp(client, token, private_circle, private_term)
    await groups_service.add_active_membership(db_session, private_circle, member_party)
    await db_session.commit()
    await _make_private(client, owner, private_circle, f"Prywatny {prefix}")

    created = await client.post(
        "/api/groups/mine/new", json={"name": f"Publiczny {prefix}"}, headers=_auth(owner)
    )
    assert created.status_code == 201, created.text
    public_circle = uuid.UUID(created.json()["id"])
    public_term = await _term(client, owner, public_circle, _day(4).date())
    await _rsvp(client, member, public_circle, public_term)

    event = await _event(client, owner, f"Wymiana {prefix}", _day(5, time(10, 0)))
    for token in (member, counterparty):
        await _sign_up(client, event, token)

    reserved, free, public = await _listed_items(
        client,
        owner,
        (f"Rowerek {prefix}", "GIFT"),
        (f"Sanki {prefix}", "GIFT"),
        (f"Narty {prefix}", "GIFT"),
    )
    taken = await client.post(
        f"/api/items/{reserved}/take",
        json={"context": {"kind": "EVENT", "id": str(event)}, "reservation_type": "GIFT"},
        headers=_auth(counterparty),
    )
    assert taken.status_code == 200, taken.text
    for item_id in (reserved, free):
        response = await _put(
            client, owner, str(item_id), {"mode": "GIFT", "visibility": "PRIVATE"}
        )
        assert response.status_code == 200, response.text
    return _World(
        owner=owner,
        owner_party=owner_party,
        member=member,
        rsvp_only=rsvp_only,
        stranger=stranger,
        counterparty=counterparty,
        private_circle=private_circle,
        private_term=private_term,
        public_circle=public_circle,
        public_term=public_term,
        event=event,
        reserved=reserved,
        free=free,
        public=public,
    )


async def _status(client: AsyncClient, path: str, token: str | None) -> int:
    headers = _auth(token) if token is not None else {}
    return (await client.get(path, headers=headers)).status_code


async def _take(
    client: AsyncClient, item_id: uuid.UUID, token: str, context: dict[str, str]
) -> Response:
    return await client.post(
        f"/api/items/{item_id}/take",
        json={"context": context, "reservation_type": "GIFT"},
        headers=_auth(token),
    )


@pytest.mark.parametrize(
    ("template", "prefix"),
    [
        ("/api/public/items/{id}/details", "ivr-details"),
        ("/api/inventory-items/{id}/history", "ivr-history"),
        ("/api/inventory-items/{id}/balance", "ivr-balance"),
        ("/api/inventory-items/{id}", "ivr-item"),
        ("/api/public/items/{id}/actions", "ivr-actions-read"),
    ],
)
async def test_privateItem_readPaths_strangerGets404_ownerMemberCounterpartyGet200(
    client: AsyncClient, db_session: AsyncSession, template: str, prefix: str
) -> None:
    world = await _world(client, db_session, prefix)
    path = template.format(id=world.reserved)

    statuses = {
        name: await _status(client, path, token)
        for name, token in (
            ("stranger", world.stranger),
            ("owner", world.owner),
            ("member", world.member),
            ("counterparty", world.counterparty),
        )
    }

    assert statuses == {"stranger": 404, "owner": 200, "member": 200, "counterparty": 200}
    if template.endswith(("/details", "/actions")):
        assert await _status(client, path, None) == 404


async def test_privateItem_rsvpOnlyNonMember_gets404(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    world = await _world(client, db_session, "ivr-rsvp")

    for path in (
        f"/api/public/items/{world.free}/details",
        f"/api/public/items/{world.free}/actions",
    ):
        assert await _status(client, path, world.rsvp_only) == 404, path
    response = await _take(
        client, world.free, world.rsvp_only, {"kind": "TERM", "id": str(world.private_term)}
    )
    assert response.status_code == 404, response.text


async def test_privateItem_lists_hiddenOnEventsPublicTermsOrganizerOwnerPage_shownOnPrivateTermForMember(  # noqa: E501
    client: AsyncClient, db_session: AsyncSession
) -> None:
    world = await _world(client, db_session, "ivr-lists")
    hidden = (str(world.reserved), str(world.free))

    event_page = await client.get(f"/api/public/events/{world.event}", headers=_auth(world.member))
    public_term = await client.get(
        f"/api/public/groups/{world.public_circle}/access", headers=_auth(world.member)
    )
    slug = await _organization_slug(client, world.owner, "Nutki ivr-lists")
    organizer_page = await client.get(
        f"/api/public/organizers/{slug}", headers=_auth(world.member)
    )
    owner_items = await client.get(
        f"/api/public/parties/{world.owner_party}/items", headers=_auth(world.member)
    )
    private_term = await client.get(
        f"/api/public/groups/{world.private_circle}/access", headers=_auth(world.member)
    )
    browse = await client.get(
        "/api/term-item-listings/browse",
        params={"term_id": str(world.private_term)},
        headers=_auth(world.member),
    )
    mine = await client.get(
        "/api/term-item-listings/mine",
        params={"term_id": str(world.private_term)},
        headers=_auth(world.owner),
    )

    for response in (event_page, public_term, organizer_page, owner_items):
        assert response.status_code == 200, response.text
        assert str(world.public) in response.text, response.request.url
        assert not any(item_id in response.text for item_id in hidden), response.request.url
    assert owner_items.json()["counts"] == {"GIFT": 1, "SWAP": 0}
    private_listings = {
        row["item_id"] for row in private_term.json()["group"]["term"]["item_listings"]
    }
    assert private_listings == {str(world.reserved), str(world.free), str(world.public)}
    assert browse.status_code == 200, browse.text
    assert {row["item_id"] for row in browse.json()} == {str(world.free), str(world.public)}
    assert mine.status_code == 200, mine.text
    assert {row["item_id"] for row in mine.json()} == {
        str(world.reserved),
        str(world.free),
        str(world.public),
    }


async def test_privateItem_take_eventOrPublicTerm409_privateTermOk_personalNeedsSharedCircle403(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    world = await _world(client, db_session, "ivr-take")

    in_event = await _take(
        client, world.free, world.member, {"kind": "EVENT", "id": str(world.event)}
    )
    in_public_term = await _take(
        client, world.free, world.member, {"kind": "TERM", "id": str(world.public_term)}
    )
    personal_counterparty = await _take(
        client, world.reserved, world.counterparty, {"kind": "PERSONAL"}
    )
    in_private_term = await _take(
        client, world.free, world.member, {"kind": "TERM", "id": str(world.private_term)}
    )

    for response in (in_event, in_public_term):
        assert response.status_code == 409, response.text
        assert response.json()["message"] == UNPLACEABLE_MESSAGE
    assert personal_counterparty.status_code == 403, personal_counterparty.text
    assert in_private_term.status_code == 200, in_private_term.text


async def test_privateItem_newItemConversation_404_existingConversationStillAccessible(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    world = await _world(client, db_session, "ivr-chat")
    other_stranger, _ = await _register_party(client, "GUEST", "ivr-chat.other@example.com")

    async def open_chat(token: str) -> int:
        response = await client.post(
            "/api/conversations/item", json={"item_id": str(world.public)}, headers=_auth(token)
        )
        return response.status_code

    assert await open_chat(world.stranger) == 201
    made_private = await _put(
        client, world.owner, str(world.public), {"mode": "GIFT", "visibility": "PRIVATE"}
    )
    assert made_private.status_code == 200, made_private.text

    assert await open_chat(world.stranger) == 200
    assert await open_chat(other_stranger) == 404
    assert await open_chat(world.member) == 201


async def test_getItemActions_privateItem_contextsOnlyPrivateCircleTerms(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    world = await _world(client, db_session, "ivr-actions")

    own = await client.get(f"/api/public/items/{world.free}/actions", headers=_auth(world.owner))
    member = await client.get(
        f"/api/public/items/{world.free}/actions", headers=_auth(world.member)
    )
    public = await client.get(
        f"/api/public/items/{world.public}/actions", headers=_auth(world.owner)
    )

    assert own.status_code == 200 and member.status_code == 200, (own.text, member.text)
    assert own.json()["visibility"] == "PRIVATE"
    assert member.json()["visibility"] is None
    assert public.json()["visibility"] == "PUBLIC"
    for body in (own.json(), member.json()):
        assert [(c["kind"], c["id"]) for c in body["contexts"]] == [
            ("TERM", str(world.private_term))
        ]
    assert member.json()["contexts"][0]["eligible"] is True
    assert member.json()["personal_pickup_available"] is True
    assert {(c["kind"], c["id"]) for c in public.json()["contexts"]} == {
        ("TERM", str(world.public_term)),
        ("TERM", str(world.private_term)),
        ("EVENT", str(world.event)),
    }


async def test_privateItem_pendingPersonalProposal_proposerKeepsAccessUntilRejected_strangerGets404(
    client: AsyncClient,
) -> None:
    owner, listed = await _personal_owner(client, "ivr-prop", "SWAP")
    proposer, _ = await _register_party(client, "GUEST", "ivr-prop.proposer@example.com")
    stranger, _ = await _register_party(client, "GUEST", "ivr-prop.stranger@example.com")
    (offered,) = await _listed_items(client, proposer, ("Puzzle ivr-prop", "SWAP"))
    status, proposal = await _propose(client, listed, offered, proposer)
    assert status == 200, proposal
    made_private = await _put(client, owner, str(listed), {"mode": "SWAP", "visibility": "PRIVATE"})
    assert made_private.status_code == 200, made_private.text

    as_proposer = await client.get(f"/api/public/items/{listed}/actions", headers=_auth(proposer))
    stranger_take = await _take(client, listed, stranger, {"kind": "PERSONAL"})
    proposer_chat = await client.post(
        "/api/conversations/item", json={"item_id": str(listed)}, headers=_auth(proposer)
    )

    assert as_proposer.status_code == 200, as_proposer.text
    assert as_proposer.json()["party_reservation"]["proposal_id"] == proposal["id"]
    assert as_proposer.json()["reservation"]["by_me"] is True
    assert await _status(client, f"/api/public/items/{listed}/actions", stranger) == 404
    assert stranger_take.status_code == 404, stranger_take.text
    assert proposer_chat.status_code == 201, proposer_chat.text

    rejected = await client.post(
        f"/api/swap-proposals/{proposal['id']}/reject", headers=_auth(owner)
    )
    assert rejected.status_code == 200, rejected.text
    assert await _status(client, f"/api/public/items/{listed}/actions", proposer) == 404


async def test_privateItem_rsvpOnlyOwner_notListedOrOfferedOnPrivateTerm_memberOwnerStillListed(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """An owner who only RSVPs to a private circle's term is not in that
    circle: their PRIVATE item stays off its listings and `/actions`
    contexts and cannot be taken there, even by a member who may see it
    through another shared private circle."""
    organizer, _ = await _register_party(client, "ORGANIZER", "ivr-rsvp-owner.org@example.com")
    owner, _ = await _register_party(client, "ORGANIZER", "ivr-rsvp-owner.owner@example.com")
    member, member_party = await _register_party(
        client, "GUEST", "ivr-rsvp-owner.member@example.com"
    )
    circle = await _circle(client, organizer, "Prywatny ivr-rsvp-owner")
    term = await _term(client, organizer, circle, _day(6).date())
    owner_circle = await _circle(client, owner, "Drugi ivr-rsvp-owner")
    for token in (member, owner):
        await _rsvp(client, token, circle, term)
    for group_id in (circle, owner_circle):
        await groups_service.add_active_membership(db_session, group_id, member_party)
    await db_session.commit()
    await _make_private(client, organizer, circle, "Prywatny ivr-rsvp-owner")
    await _make_private(client, owner, owner_circle, "Drugi ivr-rsvp-owner")
    private_item, public_item = await _listed_items(
        client, owner, ("Sanki ivr-rsvp-owner", "GIFT"), ("Narty ivr-rsvp-owner", "GIFT")
    )
    (organizer_item,) = await _listed_items(client, organizer, ("Łyżwy ivr-rsvp-owner", "GIFT"))
    for token, item_id in ((owner, private_item), (organizer, organizer_item)):
        response = await _put(
            client, token, str(item_id), {"mode": "GIFT", "visibility": "PRIVATE"}
        )
        assert response.status_code == 200, response.text

    access = await client.get(f"/api/public/groups/{circle}/access", headers=_auth(member))
    browse = await client.get(
        "/api/term-item-listings/browse", params={"term_id": str(term)}, headers=_auth(member)
    )
    actions = await client.get(f"/api/public/items/{private_item}/actions", headers=_auth(member))
    take = await _take(client, private_item, member, {"kind": "TERM", "id": str(term)})

    expected = {str(public_item), str(organizer_item)}
    assert access.status_code == 200, access.text
    assert {row["item_id"] for row in access.json()["group"]["term"]["item_listings"]} == expected
    assert browse.status_code == 200, browse.text
    assert {row["item_id"] for row in browse.json()} == expected
    assert actions.status_code == 200, actions.text
    assert actions.json()["contexts"] == []
    assert take.status_code == 409, take.text
    assert take.json()["message"] == UNPLACEABLE_MESSAGE


async def test_take_preferenceTurnsPrivateBeforeLock_returns409(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Deterministic stand-in for the owner switching an item to PRIVATE
    while a take in a PUBLIC circle's term waits on the preference lock:
    the take re-checks visibility on the locked row and loses."""
    world = await _world(client, db_session, "ivr-race")
    original_lock = repository.lock_item_listing_preference

    async def lock_after_owner_goes_private(db: AsyncSession, item_id: uuid.UUID) -> Any:
        await db.execute(
            update(ItemListingPreference)
            .where(ItemListingPreference.item_id == item_id)
            .values(visibility=ItemVisibility.PRIVATE)
        )
        await db.commit()
        return await original_lock(db, item_id)

    monkeypatch.setattr(repository, "lock_item_listing_preference", lock_after_owner_goes_private)

    response = await _take(
        client, world.public, world.member, {"kind": "TERM", "id": str(world.public_term)}
    )

    assert response.status_code == 409, response.text
    assert response.json()["message"] == UNPLACEABLE_MESSAGE
    monkeypatch.undo()
    balance = await client.get(
        f"/api/inventory-items/{world.public}/balance", headers=_auth(world.owner)
    )
    assert balance.json()["status"] == "AVAILABLE"
