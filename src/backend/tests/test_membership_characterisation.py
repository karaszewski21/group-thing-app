"""Characterisation of every "my groups" definition D1–D12 (spec "Per-call-site
replacement") before they are switched onto one membership primitive: each
test pins today's observable behaviour of one row through its public endpoint
(or a public `groups.service` function), so a switch that changes it fails.

Membership = an active `Membership` or the current `Leadership` of a live
group; an RSVP and family relations never count (except "Moje terminy"'s
family part, C1/W-3). The organizer-pledge case (I2) is deliberately not
frozen."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime

from httpx import AsyncClient, Response
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import clock
from app.groups import service
from app.groups.models import Group, Leadership, Membership
from tests.test_event_item_reservations import _listed_items
from tests.test_item_actions import _make_private
from tests.test_organizer_page import (
    _circle,
    _in_days,
    _needed_item,
    _organization_slug,
    _term,
)
from tests.test_term_item_listings import _auth, _register, _rsvp

UNPLACEABLE_MESSAGE = "Tej rzeczy nie można zarezerwować w tym miejscu"


async def _add_member(db: AsyncSession, group_id: uuid.UUID, party_id: uuid.UUID) -> None:
    await service.add_active_membership(db, group_id, party_id)
    await db.commit()


async def _set_group(db: AsyncSession, group_id: uuid.UUID, **values: object) -> None:
    await db.execute(update(Group).where(Group.id == group_id).values(**values))
    await db.commit()


async def _make_item_private(client: AsyncClient, token: str, item_id: uuid.UUID) -> None:
    response = await client.put(
        f"/api/item-listing-preferences/{item_id}",
        json={"mode": "GIFT", "visibility": "PRIVATE"},
        headers=_auth(token),
    )
    assert response.status_code == 200, response.text


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


async def _browse(client: AsyncClient, token: str, term_id: uuid.UUID) -> set[str]:
    response = await client.get(
        "/api/term-item-listings/browse", params={"term_id": str(term_id)}, headers=_auth(token)
    )
    assert response.status_code == 200, response.text
    return {row["item_id"] for row in response.json()}


@dataclass(frozen=True)
class _Circle:
    """An organizer leading a PRIVATE circle (one term: a standing member and
    an RSVP-only non-member attend it) and a PUBLIC circle (one term the
    member attends; `public_member` holds a Membership there only), plus a
    stranger. Each of organizer, member and RSVP-only lists one PRIVATE item;
    the organizer also lists a PUBLIC one."""

    organizer: str
    organizer_party: uuid.UUID
    member: str
    member_party: uuid.UUID
    rsvp_only: str
    public_member: str
    stranger: str
    private_circle: uuid.UUID
    private_term: uuid.UUID
    public_circle: uuid.UUID
    public_term: uuid.UUID
    organizer_private: uuid.UUID
    organizer_public: uuid.UUID
    member_private: uuid.UUID
    rsvp_private: uuid.UUID


async def _world(client: AsyncClient, db: AsyncSession, prefix: str) -> _Circle:
    organizer, organizer_party = await _register(client, "ORGANIZER", f"{prefix}.org@example.com")
    member, member_party = await _register(client, "GUEST", f"{prefix}.member@example.com")
    rsvp_only, _ = await _register(client, "GUEST", f"{prefix}.rsvp@example.com")
    public_member, public_member_party = await _register(
        client, "GUEST", f"{prefix}.pubmember@example.com"
    )
    stranger, _ = await _register(client, "GUEST", f"{prefix}.stranger@example.com")

    private_circle = await _circle(client, organizer, f"Prywatny {prefix}")
    private_term = await _term(client, organizer, private_circle, _in_days(6))
    for token in (member, rsvp_only):
        await _rsvp(client, token, private_circle, private_term)
    await _add_member(db, private_circle, member_party)
    await _make_private(client, organizer, private_circle, f"Prywatny {prefix}")

    public_circle = await _circle(client, organizer, f"Publiczny {prefix}")
    public_term = await _term(client, organizer, public_circle, _in_days(4))
    await _rsvp(client, member, public_circle, public_term)
    await _add_member(db, public_circle, public_member_party)

    organizer_private, organizer_public = await _listed_items(
        client, organizer, (f"Sanki {prefix}", "GIFT"), (f"Narty {prefix}", "GIFT")
    )
    (member_private,) = await _listed_items(client, member, (f"Rowerek {prefix}", "GIFT"))
    (rsvp_private,) = await _listed_items(client, rsvp_only, (f"Łyżwy {prefix}", "GIFT"))
    for token, item_id in (
        (organizer, organizer_private),
        (member, member_private),
        (rsvp_only, rsvp_private),
    ):
        await _make_item_private(client, token, item_id)
    return _Circle(
        organizer=organizer,
        organizer_party=organizer_party,
        member=member,
        member_party=member_party,
        rsvp_only=rsvp_only,
        public_member=public_member,
        stranger=stranger,
        private_circle=private_circle,
        private_term=private_term,
        public_circle=public_circle,
        public_term=public_term,
        organizer_private=organizer_private,
        organizer_public=organizer_public,
        member_private=member_private,
        rsvp_private=rsvp_private,
    )


# --- D1: is_in_circle / shares_private_circle / owner terms (private_only) ----


async def test_browseTermListings_privateCircle_memberSeesCirclePrivateItems_rsvpOnlyDoesNot(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    world = await _world(client, db_session, "mc-d1-browse")

    as_member = await _browse(client, world.member, world.private_term)
    as_rsvp_only = await _browse(client, world.rsvp_only, world.private_term)
    as_organizer = await _browse(client, world.organizer, world.private_term)

    assert as_member == {str(world.organizer_private), str(world.organizer_public)}
    assert as_rsvp_only == {str(world.organizer_public)}
    assert as_organizer == {str(world.member_private)}


async def test_takeInTerm_privateItem_privateCircleOfOwnerOk_publicCircle409(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    world = await _world(client, db_session, "mc-d1-term")

    member_owner_item = await _take(
        client,
        world.member_private,
        world.organizer,
        {"kind": "TERM", "id": str(world.private_term)},
    )
    in_public_term = await _take(
        client,
        world.organizer_private,
        world.member,
        {"kind": "TERM", "id": str(world.public_term)},
    )
    organizer_owner_item = await _take(
        client,
        world.organizer_private,
        world.member,
        {"kind": "TERM", "id": str(world.private_term)},
    )

    assert member_owner_item.status_code == 200, member_owner_item.text
    assert in_public_term.status_code == 409, in_public_term.text
    assert in_public_term.json()["message"] == UNPLACEABLE_MESSAGE
    assert organizer_owner_item.status_code == 200, organizer_owner_item.text


async def test_itemReadPaths_privateItem_onlySharedPrivateCircleParties_get200(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    world = await _world(client, db_session, "mc-d1-gate")
    path = f"/api/public/items/{world.member_private}/details"

    statuses = {
        name: await _status(client, path, token)
        for name, token in (
            ("organizer", world.organizer),
            ("member", world.member),
            ("rsvp_only", world.rsvp_only),
            ("public_member", world.public_member),
            ("stranger", world.stranger),
            ("anonymous", None),
        )
    }

    assert statuses == {
        "organizer": 200,
        "member": 200,
        "rsvp_only": 404,
        "public_member": 404,
        "stranger": 404,
        "anonymous": 404,
    }


async def test_itemReadPaths_sharedPrivateCircleSoftDeleted_returns404(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    world = await _world(client, db_session, "mc-d1-deleted")
    path = f"/api/public/items/{world.organizer_private}/details"
    assert await _status(client, path, world.member) == 200

    await _set_group(db_session, world.private_circle, deleted_at=datetime.utcnow())

    assert await _status(client, path, world.member) == 404


async def test_getItemActions_privateItem_personalPickupAndPrivateCircleContextsOnly(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    world = await _world(client, db_session, "mc-d1-actions")

    private = await client.get(
        f"/api/public/items/{world.organizer_private}/actions", headers=_auth(world.member)
    )
    public = await client.get(
        f"/api/public/items/{world.organizer_public}/actions", headers=_auth(world.member)
    )

    assert private.status_code == 200, private.text
    assert private.json()["personal_pickup_available"] is True
    assert [(c["kind"], c["id"], c["eligible"]) for c in private.json()["contexts"]] == [
        ("TERM", str(world.private_term), True)
    ]
    assert public.status_code == 200, public.text
    assert {(c["kind"], c["id"], c["eligible"]) for c in public.json()["contexts"]} == {
        ("TERM", str(world.public_term), True),
        ("TERM", str(world.private_term), True),
    }


async def test_takePersonal_privateItem_sharedPrivateCircle200_counterpartyOutsideCircle403(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    world = await _world(client, db_session, "mc-d1-personal")
    counterparty = await _take(
        client, world.organizer_public, world.public_member, {"kind": "PERSONAL"}
    )
    assert counterparty.status_code == 200, counterparty.text
    await _make_item_private(client, world.organizer, world.organizer_public)

    by_member = await _take(client, world.organizer_private, world.member, {"kind": "PERSONAL"})
    by_public_member = await _take(
        client, world.member_private, world.public_member, {"kind": "PERSONAL"}
    )
    by_counterparty = await _take(
        client, world.organizer_public, world.public_member, {"kind": "PERSONAL"}
    )

    assert by_member.status_code == 200, by_member.text
    assert by_public_member.status_code == 404, by_public_member.text
    assert by_counterparty.status_code == 403, by_counterparty.text


# --- D2: _owner_in_circle (private_circle_id listings) ----------------------


async def test_publicTermListings_privateCircle_onlyMemberAndOrganizerPrivateItems(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    world = await _world(client, db_session, "mc-d2-access")

    access = await client.get(
        f"/api/public/groups/{world.private_circle}/access", headers=_auth(world.member)
    )

    assert access.status_code == 200, access.text
    listed = {row["item_id"] for row in access.json()["group"]["term"]["item_listings"]}
    assert listed == {
        str(world.organizer_private),
        str(world.organizer_public),
        str(world.member_private),
    }


# --- D7: _owner_public_groups -----------------------------------------------


async def test_organizationLayout_countsOnlyPublicLiveGroupsTheOwnerLeads(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner, owner_party = await _register(client, "ORGANIZER", "mc-d7.owner@example.com")
    slug = await _organization_slug(client, owner, "Nutki mc-d7")
    public_id = await _circle(client, owner, "Publiczny mc-d7")
    private_id = await _circle(client, owner, "Prywatny mc-d7", "PRIVATE")
    deleted_id = await _circle(client, owner, "Usunięty mc-d7")
    assert (
        await client.delete(f"/api/groups/{deleted_id}", headers=_auth(owner))
    ).status_code == 204
    other, _ = await _register(client, "ORGANIZER", "mc-d7.other@example.com")
    joined_id = await _circle(client, other, "Cudzy mc-d7")
    await _add_member(db_session, joined_id, owner_party)
    for group_id in (public_id, private_id):
        await _term(client, owner, group_id, _in_days(3))
    await _term(client, other, joined_id, _in_days(3))

    layout = await client.get(f"/api/public/organizations/{slug}/layout/SCHEDULE")
    statuses = {
        group_id: (
            await client.get(f"/api/public/organizations/{slug}/groups/{group_id}/terms")
        ).status_code
        for group_id in (public_id, private_id, deleted_id, joined_id)
    }

    assert layout.status_code == 200, layout.text
    assert layout.json()["stats"]["group_count"] == 1
    assert [group["id"] for group in layout.json()["groups"]] == [str(public_id)]
    assert statuses == {public_id: 200, private_id: 404, deleted_id: 404, joined_id: 404}


# --- D10: _leads_term_circle / attendance._is_term_organizer -----------------


async def test_ownerTerms_termCircleOrganizer_isEligibleWithoutRsvp_strangerNot(
    client: AsyncClient,
) -> None:
    organizer, _ = await _register(client, "ORGANIZER", "mc-d10.org@example.com")
    owner, _ = await _register(client, "GUEST", "mc-d10.owner@example.com")
    stranger, _ = await _register(client, "GUEST", "mc-d10.stranger@example.com")
    group_id = await _circle(client, organizer, "Krąg mc-d10")
    term_id = await _term(client, organizer, group_id, _in_days(5))
    await _rsvp(client, owner, group_id, term_id)
    item_id, other_id = await _listed_items(
        client, owner, ("Hulajnoga mc-d10", "GIFT"), ("Kask mc-d10", "GIFT")
    )

    async def eligibility(token: str) -> list[tuple[str, bool]]:
        response = await client.get(f"/api/public/items/{item_id}/actions", headers=_auth(token))
        assert response.status_code == 200, response.text
        return [(c["id"], c["eligible"]) for c in response.json()["contexts"]]

    assert await eligibility(organizer) == [(str(term_id), True)]
    assert await eligibility(stranger) == [(str(term_id), False)]
    by_stranger = await _take(client, other_id, stranger, {"kind": "TERM", "id": str(term_id)})
    by_organizer = await _take(client, item_id, organizer, {"kind": "TERM", "id": str(term_id)})
    assert by_stranger.status_code == 403, by_stranger.text
    assert by_organizer.status_code == 200, by_organizer.text


# --- D11: exchange_summary._require_group_member_or_leader -------------------


async def test_getExchangeSummary_memberAndLeader200_rsvpOnlyAndOutsider403(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    world = await _world(client, db_session, "mc-d11")
    path = f"/api/groups/{world.private_circle}/exchange-summary"

    statuses = {
        name: await _status(client, path, token)
        for name, token in (
            ("organizer", world.organizer),
            ("member", world.member),
            ("rsvp_only", world.rsvp_only),
            ("stranger", world.stranger),
        )
    }

    assert statuses == {"organizer": 200, "member": 200, "rsvp_only": 403, "stranger": 403}


# --- D3 / D4 / D9-in-messaging ----------------------------------------------


async def _open_chat(client: AsyncClient, token: str, kind: str, target: uuid.UUID) -> Response:
    return await client.post(
        f"/api/conversations/{kind}", json={f"{kind}_id": str(target)}, headers=_auth(token)
    )


async def _send(client: AsyncClient, token: str, conversation_id: str, body: str) -> Response:
    return await client.post(
        f"/api/conversations/{conversation_id}/messages", json={"body": body}, headers=_auth(token)
    )


async def _inbox(client: AsyncClient, token: str) -> set[str]:
    """Inbox rows exist only for conversations with a message."""
    response = await client.get("/api/conversations", headers=_auth(token))
    assert response.status_code == 200, response.text
    return {row["id"] for row in response.json()}


async def test_groupAndTermChats_accessAndInboxAudience_byMembershipAndLeadership(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    world = await _world(client, db_session, "mc-d3")
    idle, idle_party = await _register(client, "GUEST", "mc-d3.idle@example.com")
    await _add_member(db_session, world.private_circle, idle_party)

    group_chat = await _open_chat(client, world.member, "group", world.private_circle)
    term_chat = await _open_chat(client, world.member, "term", world.private_term)
    assert group_chat.status_code == 201, group_chat.text
    assert term_chat.status_code == 201, term_chat.text
    group_id, term_id = group_chat.json()["id"], term_chat.json()["id"]
    for conversation_id in (group_id, term_id):
        sent = await _send(client, world.member, conversation_id, "Cześć")
        assert sent.status_code == 201, sent.text

    reads = {
        name: await _status(client, f"/api/conversations/{group_id}", token)
        for name, token in (
            ("organizer", world.organizer),
            ("member", world.member),
            ("idle_member", idle),
            ("rsvp_only", world.rsvp_only),
            ("stranger", world.stranger),
        )
    }
    inboxes = {
        name: await _inbox(client, token) & {group_id, term_id}
        for name, token in (
            ("organizer", world.organizer),
            ("member", world.member),
            ("idle_member", idle),
            ("rsvp_only", world.rsvp_only),
            ("stranger", world.stranger),
        )
    }

    assert reads == {
        "organizer": 200,
        "member": 200,
        "idle_member": 200,
        "rsvp_only": 403,
        "stranger": 403,
    }
    assert inboxes == {
        "organizer": {group_id, term_id},
        "member": {group_id, term_id},
        "idle_member": {group_id},
        "rsvp_only": {term_id},
        "stranger": set(),
    }


async def test_groupChat_softDeletedGroup_stillListedAndReadable_sendIs409(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    world = await _world(client, db_session, "mc-d3-deleted")
    opened = await _open_chat(client, world.member, "group", world.private_circle)
    assert opened.status_code == 201, opened.text
    conversation_id = opened.json()["id"]
    before = await _send(client, world.member, conversation_id, "Zanim usuną grupę")
    assert before.status_code == 201, before.text
    await _set_group(db_session, world.private_circle, deleted_at=datetime.utcnow())

    for token in (world.member, world.organizer):
        fetched = await client.get(f"/api/conversations/{conversation_id}", headers=_auth(token))
        sent = await _send(client, token, conversation_id, "Po usunięciu")

        assert fetched.status_code == 200, fetched.text
        assert fetched.json()["read_only_reason"] == "GROUP_DELETED"
        assert sent.status_code == 409, sent.text
        assert sent.json()["message"] == "Grupa usunięta — czat jest tylko do odczytu"
        assert conversation_id in await _inbox(client, token)
    assert await _status(client, f"/api/conversations/{conversation_id}", world.stranger) == 403


# --- D5 / D6: "Moje terminy" -------------------------------------------------


async def _my_term_ids(client: AsyncClient, token: str, role: str) -> set[str]:
    response = await client.get(
        "/api/groups/mine/terms", params={"role": role, "size": 100}, headers=_auth(token)
    )
    assert response.status_code == 200, response.text
    return {term["id"] for term in response.json()["items"]}


async def test_listMyTerms_ledAndMember_ledLiveCircles_memberPrivateNotLed(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    me, my_party = await _register(client, "ORGANIZER", "mc-d5.me@example.com")
    led_public = await _circle(client, me, "Mój publiczny mc-d5")
    led_private = await _circle(client, me, "Mój prywatny mc-d5", "PRIVATE")
    led_deleted = await _circle(client, me, "Mój usunięty mc-d5")
    other, _ = await _register(client, "ORGANIZER", "mc-d5.other@example.com")
    joined_private = await _circle(client, other, "Cudzy prywatny mc-d5", "PRIVATE")
    joined_public = await _circle(client, other, "Cudzy publiczny mc-d5")
    stranger_private = await _circle(client, other, "Obcy mc-d5", "PRIVATE")
    terms = {
        group_id: await _term(client, token, group_id, _in_days(3))
        for token, group_id in (
            (me, led_public),
            (me, led_private),
            (me, led_deleted),
            (other, joined_private),
            (other, joined_public),
            (other, stranger_private),
        )
    }
    for group_id in (joined_private, joined_public, led_private):
        await _add_member(db_session, group_id, my_party)
    assert (await client.delete(f"/api/groups/{led_deleted}", headers=_auth(me))).status_code == 204

    assert await _my_term_ids(client, me, "led") == {
        str(terms[led_public]),
        str(terms[led_private]),
    }
    assert await _my_term_ids(client, me, "member") == {str(terms[joined_private])}


async def _family_with_second_guardian(client: AsyncClient, token: str, username: str) -> uuid.UUID:
    family = await client.post(
        "/api/families/mine", json={"name": f"Rodzina {username}"}, headers=_auth(token)
    )
    assert family.status_code == 201, family.text
    guardian = await client.post(
        f"/api/families/{family.json()['id']}/guardians",
        json={"username": username, "password": "secret123", "display_name": "Ola"},
        headers=_auth(token),
    )
    assert guardian.status_code == 201, guardian.text
    return uuid.UUID(guardian.json()["party_id"])


async def test_listMyTerms_memberRole_coGuardianMembershipCounts_C1(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    organizer, _ = await _register(client, "ORGANIZER", "mc-c1.org@example.com")
    private_id = await _circle(client, organizer, "Prywatny mc-c1", "PRIVATE")
    public_id = await _circle(client, organizer, "Publiczny mc-c1")
    private_term = await _term(client, organizer, private_id, _in_days(2))
    await _term(client, organizer, public_id, _in_days(2))
    me, _ = await _register(client, "GUEST", "mc-c1.me@example.com")
    co_guardian = await _family_with_second_guardian(client, me, "mc-c1-second")
    for group_id in (private_id, public_id):
        await _add_member(db_session, group_id, co_guardian)

    assert await _my_term_ids(client, me, "member") == {str(private_term)}


async def test_listMyTerms_memberRole_coGuardianLeadsPrivateCircle_excluded_W3(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    organizer, _ = await _register(client, "ORGANIZER", "mc-w3.org@example.com")
    private_id = await _circle(client, organizer, "Prywatny mc-w3", "PRIVATE")
    await _term(client, organizer, private_id, _in_days(2))
    me, _ = await _register(client, "GUEST", "mc-w3.me@example.com")
    co_guardian = await _family_with_second_guardian(client, me, "mc-w3-second")
    await service.assign_leadership(db_session, private_id, co_guardian, clock.local_now().date())

    leadership = await client.get(f"/api/groups/{private_id}/leadership", headers=_auth(me))
    assert leadership.status_code == 200, leadership.text
    assert leadership.json()["organizer_party_id"] == str(co_guardian)
    assert await _my_term_ids(client, me, "member") == set()
    assert await _my_term_ids(client, me, "led") == set()


# --- D8 / D9 / D12 -----------------------------------------------------------


async def test_joinCodeAccessAndRsvp_memberAndOrganizerCount_outsiderDoesNot(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    world = await _world(client, db_session, "mc-d8")
    code = (
        await client.get(
            f"/api/groups/{world.private_circle}/join-code", headers=_auth(world.organizer)
        )
    ).json()["code"]

    async def access(token: str | None) -> tuple[bool, bool, bool]:
        headers = _auth(token) if token is not None else {}
        response = await client.get(
            f"/api/public/groups/{world.private_circle}/access", headers=headers
        )
        assert response.status_code == 200, response.text
        details = response.json()["access"]
        return details["is_member"], details["is_organizer"], details["can_view_content"]

    async def rsvp(token: str) -> int:
        response = await client.post(
            f"/api/groups/{world.private_circle}/rsvp",
            json={"term_id": str(world.private_term), "child_count": 0},
            headers=_auth(token),
        )
        return response.status_code

    assert await access(world.organizer) == (True, True, True)
    assert await access(world.member) == (True, False, True)
    assert await access(world.rsvp_only) == (False, False, False)
    assert await access(world.stranger) == (False, False, False)
    assert await access(None) == (False, False, False)
    assert {
        name: await rsvp(token)
        for name, token in (
            ("organizer", world.organizer),
            ("member", world.member),
            ("stranger", world.stranger),
        )
    } == {"organizer": 201, "member": 201, "stranger": 403}
    redeemed = {}
    for name, token in (
        ("organizer", world.organizer),
        ("member", world.member),
        ("stranger", world.stranger),
    ):
        response = await client.post(
            f"/api/groups/{world.private_circle}/join-code/redeem",
            json={"code": code},
            headers=_auth(token),
        )
        assert response.status_code == 200, response.text
        redeemed[name] = response.json()["created"]
    assert redeemed == {"organizer": False, "member": False, "stranger": True}


async def test_createPledge_outsider409_standingMemberAndOrganizerWithoutRsvp201(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """The organizer case is the I2 delta (CHANGELOG): the current organizer
    may pledge without an RSVP."""
    world = await _world(client, db_session, "mc-d8-pledge")
    first = await _needed_item(client, world.organizer, world.private_term, "Koc mc-d8")
    second = await _needed_item(client, world.organizer, world.private_term, "Termos mc-d8")
    idle, idle_party = await _register(client, "GUEST", "mc-d8-pledge.idle@example.com")
    await _add_member(db_session, world.private_circle, idle_party)

    async def pledge(token: str, needed_item_id: uuid.UUID = first) -> Response:
        return await client.post(
            "/api/pledges", json={"needed_item_id": str(needed_item_id)}, headers=_auth(token)
        )

    by_stranger = await pledge(world.stranger)
    by_public_member = await pledge(world.public_member)
    by_idle_member = await pledge(idle)
    by_organizer = await pledge(world.organizer, second)

    assert by_stranger.status_code == 409, by_stranger.text
    assert by_public_member.status_code == 409, by_public_member.text
    assert by_idle_member.status_code == 201, by_idle_member.text
    assert by_organizer.status_code == 201, by_organizer.text


async def test_organizerWrites_nonOrganizer403_deletedCircleEndLeadershipOrganizerOnly(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    world = await _world(client, db_session, "mc-d9")
    base = f"/api/groups/{world.private_circle}"
    member_headers = _auth(world.member)

    patched = await client.patch(
        base, json={"name": "Przejęty", "visibility": "PUBLIC"}, headers=member_headers
    )
    join_code = await client.get(f"{base}/join-code", headers=member_headers)
    deleted = await client.delete(base, headers=_auth(world.stranger))
    leadership = await client.get(f"{base}/leadership", headers=_auth(world.organizer))
    leadership_id = leadership.json()["id"]

    assert (patched.status_code, join_code.status_code, deleted.status_code) == (403, 403, 403)

    await _set_group(db_session, world.private_circle, deleted_at=datetime.utcnow())
    by_member = await client.post(f"/api/leaderships/{leadership_id}/end", headers=member_headers)
    by_organizer = await client.post(
        f"/api/leaderships/{leadership_id}/end", headers=_auth(world.organizer)
    )

    assert by_member.status_code == 403, by_member.text
    assert by_organizer.status_code == 200, by_organizer.text
    assert by_organizer.json()["valid_to"] is not None


async def test_partyMembershipReads_excludeEndedAndDeleted_ownCircleFollowsLeadership(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    organizer, _ = await _register(client, "ORGANIZER", "mc-d12.org@example.com")
    own = await client.post(
        "/api/groups/mine", json={"name": "Własny mc-d12"}, headers=_auth(organizer)
    )
    assert own.status_code == 201, own.text
    own_id = uuid.UUID(own.json()["id"])
    kept = await _circle(client, organizer, "Zostaje mc-d12")
    deleted = await _circle(client, organizer, "Znika mc-d12")
    ended = await _circle(client, organizer, "Skończony mc-d12")
    guardian, guardian_party = await _register(client, "GUEST", "mc-d12.guardian@example.com")
    family = await client.post(
        "/api/families/mine", json={"name": "Rodzina mc-d12"}, headers=_auth(guardian)
    )
    assert family.status_code == 201, family.text
    for group_id in (kept, deleted, ended):
        await _add_member(db_session, group_id, guardian_party)
    await db_session.execute(
        update(Membership)
        .where(Membership.to_group_id == ended)
        .values(valid_to=clock.local_now().date())
    )
    await db_session.execute(
        update(Leadership)
        .where(Leadership.to_group_id == ended)
        .values(valid_to=clock.local_now().date())
    )
    await db_session.commit()
    await _set_group(db_session, deleted, deleted_at=datetime.utcnow())
    me = await client.get("/api/people/me", headers=_auth(organizer))

    leaderships = await client.get(
        f"/api/people/{me.json()['id']}/leaderships", headers=_auth(organizer)
    )
    memberships = await client.get(
        f"/api/families/{family.json()['id']}/memberships", headers=_auth(guardian)
    )
    service_memberships = await service.list_memberships_for_party(db_session, guardian_party)
    same_own = await client.post(
        "/api/groups/mine", json={"name": "Drugi własny"}, headers=_auth(organizer)
    )

    assert leaderships.status_code == 200, leaderships.text
    assert {row["to_group_id"] for row in leaderships.json()} == {str(own_id), str(kept)}
    assert memberships.status_code == 200, memberships.text
    assert [row["to_group_id"] for row in memberships.json()] == [str(kept)]
    assert [m.to_group_id for m in service_memberships] == [kept]
    assert same_own.status_code == 201, same_own.text
    assert same_own.json()["id"] in {str(own_id), str(kept)}


async def test_createOwnCircle_afterOnlyLedCircleDeleted_returnsNewCircle(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    organizer, _ = await _register(client, "ORGANIZER", "mc-d12-own.org@example.com")
    first = await client.post(
        "/api/groups/mine", json={"name": "Pierwszy mc-d12"}, headers=_auth(organizer)
    )
    assert first.status_code == 201, first.text
    again = await client.post(
        "/api/groups/mine", json={"name": "Powtórka mc-d12"}, headers=_auth(organizer)
    )
    assert again.json()["id"] == first.json()["id"]

    await _set_group(db_session, uuid.UUID(first.json()["id"]), deleted_at=datetime.utcnow())
    after_delete = await client.post(
        "/api/groups/mine", json={"name": "Nowy mc-d12"}, headers=_auth(organizer)
    )

    assert after_delete.status_code == 201, after_delete.text
    assert after_delete.json()["id"] != first.json()["id"]
    assert after_delete.json()["name"] == "Nowy mc-d12"
