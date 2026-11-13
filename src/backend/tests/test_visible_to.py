"""The visibility predicates `items_visible_to`, `terms_visible_to` and
`groups_visible_to` (rules R1–R11, executed directly per viewer and scope)
and `can_view_item` on top of them: one statement, own items visible, R12
("listed only") not applied, and the user-mandated U1–U3 cases."""

from __future__ import annotations

import uuid
from collections.abc import Collection
from dataclasses import dataclass
from datetime import datetime

import pytest
from httpx import AsyncClient
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from app.groups import service
from app.groups.models import Group, ItemListingPreference, Membership, Term
from app.inventory.models import BalanceStatus, InventoryBalance, Reservation
from app.users.models import UserProfile
from tests.conftest import count_queries
from tests.test_event_item_reservations import _listed_items
from tests.test_item_actions import _make_private
from tests.test_membership_characterisation import (
    _add_member,
    _family_with_second_guardian,
    _my_term_ids,
    _open_chat,
    _send,
    _set_group,
)
from tests.test_organizer_page import _circle, _in_days, _term
from tests.test_personal_pickup import _propose, _reservations, _take
from tests.test_term_item_listings import _auth, _register, _rsvp

ALL = service.VisibilityScope.ALL
MINE = service.VisibilityScope.MINE
SCOPES = pytest.mark.parametrize("scope", [ALL, MINE])


async def _preference(
    client: AsyncClient, token: str, item_id: uuid.UUID, visibility: str, mode: str = "GIFT"
) -> None:
    response = await client.put(
        f"/api/item-listing-preferences/{item_id}",
        json={"mode": mode, "visibility": visibility},
        headers=_auth(token),
    )
    assert response.status_code == 200, response.text


async def _items(
    db: AsyncSession,
    viewer: uuid.UUID | None,
    scope: service.VisibilityScope,
    among: Collection[uuid.UUID],
) -> set[uuid.UUID]:
    rows = await db.scalars(
        select(ItemListingPreference.item_id).where(
            ItemListingPreference.item_id.in_(set(among)), service.items_visible_to(viewer, scope)
        )
    )
    return set(rows.all())


async def _terms(
    db: AsyncSession,
    viewer: uuid.UUID | None,
    scope: service.VisibilityScope,
    among: Collection[uuid.UUID],
) -> set[uuid.UUID]:
    rows = await db.scalars(
        select(Term.id).where(Term.id.in_(set(among)), service.terms_visible_to(viewer, scope))
    )
    return set(rows.all())


async def _groups(
    db: AsyncSession,
    viewer: uuid.UUID | None,
    scope: service.VisibilityScope,
    among: Collection[uuid.UUID],
) -> set[uuid.UUID]:
    rows = await db.scalars(
        select(Group.id).where(Group.id.in_(set(among)), service.groups_visible_to(viewer, scope))
    )
    return set(rows.all())


async def _account_user_id(db: AsyncSession, party_id: uuid.UUID) -> uuid.UUID:
    user_id = await db.scalar(
        select(UserProfile.account_user_id).where(UserProfile.party_id == party_id)
    )
    assert user_id is not None
    return user_id


@dataclass(frozen=True)
class _World:
    """Owner O leads a PRIVATE circle (member M, RSVP-only R on its term,
    who RSVPed while it was still PUBLIC)
    and a PUBLIC circle (member PM). O lists `public`, `private`, `reserved`
    (PRIVATE, taken by C while still PUBLIC, the giver leg reassigned to
    giver G) and `swap` (PRIVATE, proposed on by P while still PUBLIC).
    Stranger S lists `stranger_public`. M's family has a co-guardian F and
    a child K with no login."""

    owner: uuid.UUID
    member: uuid.UUID
    public_member: uuid.UUID
    rsvp_only: uuid.UUID
    stranger: uuid.UUID
    reserver: uuid.UUID
    giver: uuid.UUID
    proposer: uuid.UUID
    co_guardian: uuid.UUID
    child: uuid.UUID
    private_circle: uuid.UUID
    public_circle: uuid.UUID
    private_term: uuid.UUID
    public_term: uuid.UUID
    public: uuid.UUID
    private: uuid.UUID
    reserved: uuid.UUID
    swap: uuid.UUID
    stranger_public: uuid.UUID

    @property
    def items(self) -> set[uuid.UUID]:
        return {self.public, self.private, self.reserved, self.swap, self.stranger_public}


async def _world(client: AsyncClient, db: AsyncSession, prefix: str) -> _World:
    owner, owner_party = await _register(client, "ORGANIZER", f"{prefix}.o@example.com")
    member, member_party = await _register(client, "GUEST", f"{prefix}.m@example.com")
    _, public_member_party = await _register(client, "GUEST", f"{prefix}.pm@example.com")
    rsvp_only, rsvp_party = await _register(client, "GUEST", f"{prefix}.r@example.com")
    stranger, stranger_party = await _register(client, "GUEST", f"{prefix}.s@example.com")
    reserver, reserver_party = await _register(client, "GUEST", f"{prefix}.c@example.com")
    _, giver_party = await _register(client, "GUEST", f"{prefix}.g@example.com")
    proposer, proposer_party = await _register(client, "GUEST", f"{prefix}.p@example.com")

    private_circle = await _circle(client, owner, f"Prywatny {prefix}")
    private_term = await _term(client, owner, private_circle, _in_days(6))
    await _add_member(db, private_circle, member_party)
    await _rsvp(client, rsvp_only, private_circle, private_term)
    await _make_private(client, owner, private_circle, f"Prywatny {prefix}")
    public_circle = await _circle(client, owner, f"Publiczny {prefix}")
    public_term = await _term(client, owner, public_circle, _in_days(4))
    await _add_member(db, public_circle, public_member_party)

    co_guardian = await _family_with_second_guardian(client, member, f"{prefix}-f")
    children = await client.post(
        "/api/families/mine/members",
        json={"members": [{"name": "Kasia", "role_type": "CHILD"}]},
        headers=_auth(member),
    )
    assert children.status_code == 201, children.text
    (child,) = [
        uuid.UUID(row["party_id"])
        for row in children.json()["guardians"]
        if row["role_type"] == "CHILD"
    ]

    public, private, reserved, swap = await _listed_items(
        client,
        owner,
        (f"Narty {prefix}", "GIFT"),
        (f"Sanki {prefix}", "GIFT"),
        (f"Rowerek {prefix}", "GIFT"),
        (f"Łyżwy {prefix}", "SWAP"),
    )
    (stranger_public,) = await _listed_items(client, stranger, (f"Kask {prefix}", "GIFT"))
    (offered,) = await _listed_items(client, proposer, (f"Piłka {prefix}", "SWAP"))
    status, body = await _take(client, reserved, reserver)
    assert status == 200, body
    status, body = await _propose(client, swap, offered, proposer)
    assert status == 200, body
    await _preference(client, owner, private, "PRIVATE")
    await _preference(client, owner, reserved, "PRIVATE")
    await _preference(client, owner, swap, "PRIVATE", mode="SWAP")
    await db.execute(
        update(Reservation)
        .where(Reservation.item_id == reserved)
        .values(giver_user_id=await _account_user_id(db, giver_party))
    )
    await db.commit()
    return _World(
        owner=owner_party,
        member=member_party,
        public_member=public_member_party,
        rsvp_only=rsvp_party,
        stranger=stranger_party,
        reserver=reserver_party,
        giver=giver_party,
        proposer=proposer_party,
        co_guardian=co_guardian,
        child=child,
        private_circle=private_circle,
        public_circle=public_circle,
        private_term=private_term,
        public_term=public_term,
        public=public,
        private=private,
        reserved=reserved,
        swap=swap,
        stranger_public=stranger_public,
    )


# --- Items: R1–R7, R11 ----------------------------------------------------------


@SCOPES
async def test_itemsVisibleTo_R1_publicItemOfCoMember_visibleToMembersOfAnyGroup(
    client: AsyncClient, db_session: AsyncSession, scope: service.VisibilityScope
) -> None:
    w = await _world(client, db_session, f"vt-r1-{scope}")

    for viewer in (w.member, w.public_member):
        assert w.public in await _items(db_session, viewer, scope, w.items)


@SCOPES
async def test_itemsVisibleTo_R2_publicItemWithoutSharedGroup_allOnlyGuestAlways(
    client: AsyncClient, db_session: AsyncSession, scope: service.VisibilityScope
) -> None:
    w = await _world(client, db_session, f"vt-r2-{scope}")

    in_member_view = w.stranger_public in await _items(db_session, w.member, scope, w.items)
    guest_view = await _items(db_session, None, scope, w.items)

    assert in_member_view is (scope == ALL)
    assert guest_view == {w.public, w.stranger_public}


@SCOPES
async def test_itemsVisibleTo_R3_privateItem_onlySharedPrivateGroupMember(
    client: AsyncClient, db_session: AsyncSession, scope: service.VisibilityScope
) -> None:
    w = await _world(client, db_session, f"vt-r3-{scope}")

    for viewer, sees in (
        (w.member, True),
        (w.public_member, False),
        (w.stranger, False),
        (None, False),
    ):
        assert (w.private in await _items(db_session, viewer, scope, w.items)) is sees, viewer


@SCOPES
async def test_itemsVisibleTo_R6_counterparty_reserverGiverProposerSeeTheirItemOnly(
    client: AsyncClient, db_session: AsyncSession, scope: service.VisibilityScope
) -> None:
    w = await _world(client, db_session, f"vt-r6-{scope}")
    public_items = {w.public, w.stranger_public} if scope == ALL else set()

    assert await _items(db_session, w.reserver, scope, w.items) == public_items | {w.reserved}
    assert await _items(db_session, w.giver, scope, w.items) == public_items | {w.reserved}
    assert await _items(db_session, w.proposer, scope, w.items) == public_items | {w.swap}
    assert await _items(db_session, None, scope, w.items) == {w.public, w.stranger_public}


@SCOPES
async def test_itemsVisibleTo_R7_ownItems_visibleInBothScopes(
    client: AsyncClient, db_session: AsyncSession, scope: service.VisibilityScope
) -> None:
    w = await _world(client, db_session, f"vt-r7-{scope}")
    own = {w.public, w.private, w.reserved, w.swap}

    assert await _items(db_session, w.owner, scope, w.items) == own | (
        {w.stranger_public} if scope == ALL else set()
    )
    assert w.stranger_public in await _items(db_session, w.stranger, scope, w.items)


@SCOPES
async def test_itemsVisibleTo_R11_rsvpOnlyFamilyAndChild_neverCount(
    client: AsyncClient, db_session: AsyncSession, scope: service.VisibilityScope
) -> None:
    w = await _world(client, db_session, f"vt-r11-{scope}")
    public_items = {w.public, w.stranger_public} if scope == ALL else set()

    for viewer in (w.rsvp_only, w.co_guardian, w.child):
        assert await _items(db_session, viewer, scope, w.items) == public_items, viewer
        assert not await service.can_view_item(db_session, w.private, viewer)
    assert await _items(db_session, w.member, scope, w.items) == (
        {w.public, w.private, w.reserved, w.swap} | public_items
    )


# --- Terms (R8) and groups (R9) -------------------------------------------------


@SCOPES
async def test_termsVisibleTo_R8_publicCircleOrMember_deletedCircleNever(
    client: AsyncClient, db_session: AsyncSession, scope: service.VisibilityScope
) -> None:
    w = await _world(client, db_session, f"vt-r8-{scope}")
    terms = {w.private_term, w.public_term}

    assert await _terms(db_session, None, scope, terms) == {w.public_term}
    assert await _terms(db_session, w.member, scope, terms) == (
        terms if scope == ALL else {w.private_term}
    )
    assert await _terms(db_session, w.rsvp_only, scope, terms) == (
        {w.public_term} if scope == ALL else set()
    )
    assert await _terms(db_session, w.owner, scope, terms) == terms

    await _set_group(db_session, w.public_circle, deleted_at=datetime.utcnow())

    assert await _terms(db_session, w.owner, scope, terms) == {w.private_term}
    assert await _terms(db_session, None, scope, terms) == set()


@SCOPES
async def test_groupsVisibleTo_R9_publicOrJoined_deletedNever(
    client: AsyncClient, db_session: AsyncSession, scope: service.VisibilityScope
) -> None:
    w = await _world(client, db_session, f"vt-r9-{scope}")
    groups = {w.private_circle, w.public_circle}

    assert await _groups(db_session, None, scope, groups) == {w.public_circle}
    assert await _groups(db_session, w.member, scope, groups) == (
        groups if scope == ALL else {w.private_circle}
    )
    assert await _groups(db_session, w.stranger, scope, groups) == (
        {w.public_circle} if scope == ALL else set()
    )
    assert await _groups(db_session, w.owner, scope, groups) == groups

    await _set_group(db_session, w.private_circle, deleted_at=datetime.utcnow())

    assert await _groups(db_session, w.owner, scope, groups) == {w.public_circle}


# --- can_view_item -----------------------------------------------------------


async def test_canViewItem_world_matchesItemsVisibleToAll(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    w = await _world(client, db_session, "vt-gate")
    viewers = (
        None,
        w.owner,
        w.member,
        w.public_member,
        w.rsvp_only,
        w.stranger,
        w.reserver,
        w.giver,
        w.proposer,
        w.co_guardian,
        w.child,
    )

    for viewer in viewers:
        expected = await _items(db_session, viewer, ALL, w.items)
        gate = {item for item in w.items if await service.can_view_item(db_session, item, viewer)}
        assert gate == expected, viewer
    assert await service.can_view_item(db_session, w.private, w.owner)


async def test_canViewItem_oneStatement(
    client: AsyncClient, db_session: AsyncSession, engine: AsyncEngine
) -> None:
    token, party = await _register(client, "GUEST", "vt-count@example.com")
    (item,) = await _listed_items(client, token, ("Rowerek vt-count", "GIFT"))
    await _preference(client, token, item, "PRIVATE")

    with count_queries(engine) as statements:
        visible = await service.can_view_item(db_session, item, party)

    assert visible
    assert len(statements) == 1


async def test_canViewItem_R12_publicItemGivenAwayOrLent_stillVisible(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner, _ = await _register(client, "GUEST", "vt-r12.o@example.com")
    taker, _ = await _register(client, "GUEST", "vt-r12.t@example.com")
    _, stranger = await _register(client, "GUEST", "vt-r12.s@example.com")
    given, lent = await _listed_items(
        client, owner, ("Rowerek vt-r12", "GIFT"), ("Sanki vt-r12", "GIFT")
    )
    status, body = await _take(client, given, taker)
    assert status == 200, body
    (reservation,) = await _reservations(db_session, given)
    confirmed = await client.post(
        f"/api/reservations/{reservation.id}/confirm-transaction", headers=_auth(taker)
    )
    assert confirmed.status_code == 200, confirmed.text
    await db_session.execute(
        update(InventoryBalance)
        .where(InventoryBalance.item_id == lent)
        .values(status=BalanceStatus.LENT)
    )
    await db_session.commit()

    for item in (given, lent):
        for viewer in (None, stranger):
            assert await service.can_view_item(db_session, item, viewer), (item, viewer)


# --- U1–U3 -------------------------------------------------------------------


async def test_R5U1_onlySharedGroupSoftDeleted_privateHiddenPublicOnlyInAll_chatReadOnly(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner, _ = await _register(client, "ORGANIZER", "vt-u1.o@example.com")
    viewer, viewer_party = await _register(client, "GUEST", "vt-u1.v@example.com")
    circle = await _circle(client, owner, "Krąg vt-u1", "PRIVATE")
    term = await _term(client, owner, circle, _in_days(3))
    await _add_member(db_session, circle, viewer_party)
    private, public = await _listed_items(
        client, owner, ("Sanki vt-u1", "GIFT"), ("Narty vt-u1", "GIFT")
    )
    await _preference(client, owner, private, "PRIVATE")
    opened = await _open_chat(client, viewer, "group", circle)
    assert opened.status_code == 201, opened.text
    items = {private, public}
    assert await _items(db_session, viewer_party, MINE, items) == items
    assert str(term) in await _my_term_ids(client, viewer, "member")

    await _set_group(db_session, circle, deleted_at=datetime.utcnow())

    assert await _items(db_session, viewer_party, MINE, items) == set()
    assert await _items(db_session, viewer_party, ALL, items) == {public}
    assert not await service.can_view_item(db_session, private, viewer_party)
    for scope in (ALL, MINE):
        assert await _terms(db_session, viewer_party, scope, {term}) == set()
    assert str(term) not in await _my_term_ids(client, viewer, "member")
    conversation_id = opened.json()["id"]
    fetched = await client.get(f"/api/conversations/{conversation_id}", headers=_auth(viewer))
    sent = await _send(client, viewer, conversation_id, "Po usunięciu")
    assert fetched.status_code == 200, fetched.text
    assert fetched.json()["read_only_reason"] == "GROUP_DELETED"
    assert sent.status_code == 409, sent.text


async def test_R4U2_sharedGroupTurnedPublic_privateItemHiddenUnlessAnotherPrivateGroup(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner, _ = await _register(client, "ORGANIZER", "vt-u2.o@example.com")
    _, viewer = await _register(client, "GUEST", "vt-u2.v@example.com")
    first = await _circle(client, owner, "Pierwszy vt-u2", "PRIVATE")
    second = await _circle(client, owner, "Drugi vt-u2", "PRIVATE")
    await _add_member(db_session, first, viewer)
    (item,) = await _listed_items(client, owner, ("Sanki vt-u2", "GIFT"))
    await _preference(client, owner, item, "PRIVATE")
    for scope in (ALL, MINE):
        assert await _items(db_session, viewer, scope, {item}) == {item}

    patched = await client.patch(
        f"/api/groups/{first}",
        json={"name": "Pierwszy vt-u2", "visibility": "PUBLIC"},
        headers=_auth(owner),
    )
    assert patched.status_code == 200, patched.text

    for scope in (ALL, MINE):
        assert await _items(db_session, viewer, scope, {item}) == set()
    assert not await service.can_view_item(db_session, item, viewer)

    await _add_member(db_session, second, viewer)

    for scope in (ALL, MINE):
        assert await _items(db_session, viewer, scope, {item}) == {item}
    assert await service.can_view_item(db_session, item, viewer)


async def test_R6U3_openReservationAfterLeavingGroup_visibleUntilCancelled(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner, _ = await _register(client, "ORGANIZER", "vt-u3.o@example.com")
    viewer, viewer_party = await _register(client, "GUEST", "vt-u3.v@example.com")
    circle = await _circle(client, owner, "Krąg vt-u3", "PRIVATE")
    await _add_member(db_session, circle, viewer_party)
    (item,) = await _listed_items(client, owner, ("Sanki vt-u3", "GIFT"))
    await _preference(client, owner, item, "PRIVATE")
    status, body = await _take(client, item, viewer)
    assert status == 200, body
    await db_session.execute(
        update(Membership)
        .where(Membership.to_group_id == circle, Membership.valid_to.is_(None))
        .values(valid_to=_in_days(0).date())
    )
    await db_session.commit()
    assert not await service.is_in_circle(db_session, circle, viewer_party)

    for scope in (ALL, MINE):
        assert await _items(db_session, viewer_party, scope, {item}) == {item}
    assert await service.can_view_item(db_session, item, viewer_party)

    (reservation,) = await _reservations(db_session, item)
    cancelled = await client.post(
        f"/api/reservations/{reservation.id}/cancel-transaction", headers=_auth(owner)
    )
    assert cancelled.status_code == 200, cancelled.text

    for scope in (ALL, MINE):
        assert await _items(db_session, viewer_party, scope, {item}) == set()
    assert not await service.can_view_item(db_session, item, viewer_party)
