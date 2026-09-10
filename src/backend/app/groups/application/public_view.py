"""Public, unauthenticated circle-view use cases: the assembled public
circle page, the caller's own attendances, and the public RSVP.

D3: `get_public_circle_view`'s inline slug/organizer block is kept inline
(not routed through `slug_resolver` or `_resolve_organizer`) and keeps its
500-on-missing-profile behavior; `_resolve_organizer` keeps its
`None`-on-missing-profile behavior. Not consolidated this pass.
"""

from __future__ import annotations

from datetime import date, datetime, time
from typing import cast

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import Principal
from app.core.errors import EntityNotFoundException
from app.party.models import PartyType
from app.party.service import create_party
from app.users.models import UserProfile
from app.users.service import get_profile_by_party, get_profile_by_principal

from ..domain.organizer_slug import _fallback_organizer_slug
from ..infrastructure import organizations_acl, repository
from ..infrastructure.slug_resolver import resolve_organizer_slug
from ..models import Term, TermAttendance
from ..schemas import (
    MyAttendanceResponse,
    MyPledgeResponse,
    PublicCircleResponse,
    PublicGuardianResponse,
    PublicNeededItemResponse,
    PublicTermResponse,
    RsvpResponse,
)
from .circles import _group_role_party_id, get_current_leadership, get_group
from .terms import get_term, list_needed_item_views, list_terms


async def list_attendances_for_term(db: AsyncSession, term_id: int) -> list[TermAttendance]:
    """Row-level `TermAttendance` list for a Term, ordered by creation —
    used to build the public guardian list's `display_name`s via a join in
    `get_public_circle_view` (no N+1: one query resolves every attendance's
    party's profile)."""
    return await repository.list_attendances_for_term(db, term_id)


async def _resolve_organizer(db: AsyncSession, group_id: int) -> tuple[str | None, str]:
    """`(display_name, slug)` for a Circle's active organizer, resolving the
    active `Leadership` -> `GroupRole` party id chain ONCE and deriving both
    from it — instead of `_resolve_organizer_display_name` and
    `resolve_organizer_slug` each re-running that chain per circle in
    `list_my_attendances`.

    `display_name` is `None` when the Circle has no active `Leadership` OR the
    organizer party has no `UserProfile` — a missing organizer profile must
    degrade gracefully, not 500 the whole attendances response (mirrors how
    `create_rsvp` catches `EntityNotFoundException` for
    `get_profile_by_principal`). `slug` is never `None` (`_fallback_organizer_slug`).

    `resolve_organizer_slug` is kept as-is for its other callers; the slug
    derivation here is deliberately identical."""
    leadership = await get_current_leadership(db, group_id)
    if leadership is None:
        return None, _fallback_organizer_slug(f"group:{group_id}")

    organizer_party_id = await _group_role_party_id(db, leadership.from_role_id)

    display_name: str | None = None
    try:
        organizer_profile = await get_profile_by_party(db, organizer_party_id)
        display_name = organizer_profile.display_name
    except EntityNotFoundException:
        display_name = None

    organization = await organizations_acl.get_own_organization(db, organizer_party_id)
    slug = (
        organization.slug
        if organization is not None
        else _fallback_organizer_slug(f"party:{organizer_party_id}")
    )
    return display_name, slug


async def list_my_attendances(db: AsyncSession, party_id: int) -> list[MyAttendanceResponse]:
    """The caller's own Term RSVPs, newest class last.

    One joined `select(TermAttendance, Term, Group)` (these entities carry no
    ORM `relationship()` — `lazy="raise"` + cross-BC FK-id only, per
    `standards/backend/models.md` — so an explicit multi-entity join is the
    correct eager form, not `joinedload`), with SQL-level ordering per
    `standards/backend/queries.md` (no in-Python sort). Chosen ordering (A4):
    chronological ascending by `Term.occurs_on`, then `TermAttendance.id` —
    deterministic and consistent with `list_terms`.

    Organizer `display_name` + `slug` are resolved once per DISTINCT circle in
    the result (a caller typically attends 1-3 circles) — the same bounded-loop
    precedent as `list_group_memberships_for_family`, not an N+1 over rows.
    """
    rows = await repository.list_my_attendances_joined(db, party_id)

    distinct_group_ids = {cast(int, group.id) for _attendance, _term, group in rows}
    organizer_info: dict[int, tuple[str | None, str]] = {
        group_id: await _resolve_organizer(db, group_id) for group_id in distinct_group_ids
    }

    responses: list[MyAttendanceResponse] = []
    for attendance, term, group in rows:
        display_name, slug = organizer_info[cast(int, group.id)]
        responses.append(
            MyAttendanceResponse(
                attendance_id=cast(int, attendance.id),
                term_id=cast(int, term.id),
                occurs_on=term.occurs_on,
                child_count=attendance.child_count,
                group_id=cast(int, group.id),
                group_name=group.name,
                organizer_display_name=display_name,
                organizer_slug=slug,
            )
        )
    return responses


async def list_my_pledges(db: AsyncSession, party_id: int) -> list[MyPledgeResponse]:
    """The caller's own "obiecałem przynieść" list — non-withdrawn pledges
    joined to product / term / circle, class date ascending. Organizer slug
    resolved once per DISTINCT circle (same bounded-loop precedent as
    `list_my_attendances`), for the public-term deep link."""
    rows = await repository.list_my_pledges_joined(db, party_id)

    distinct_group_ids = {cast(int, group.id) for _pledge, _name, _desc, _term, group in rows}
    slug_by_group: dict[int, str] = {
        group_id: (await _resolve_organizer(db, group_id))[1] for group_id in distinct_group_ids
    }

    return [
        MyPledgeResponse(
            pledge_id=cast(int, pledge.id),
            status=pledge.status,
            product_name=product_name,
            item_description=item_description,
            term_id=cast(int, term.id),
            group_id=cast(int, group.id),
            group_name=group.name,
            occurs_on=term.occurs_on,
            organizer_slug=slug_by_group[cast(int, group.id)],
            registered=pledge.resolved_reservation_id is not None,
        )
        for pledge, product_name, item_description, term, group in rows
    ]


async def get_public_circle_view(
    db: AsyncSession, group_id: int, term_id: int | None = None
) -> PublicCircleResponse:
    """Unauthenticated read assembled server-side in one call: organizer
    name (via the active `Leadership`, `None` if the Circle currently has
    no organizer), the organizer's Organization slug, one Term, its needed
    items, and the RSVP'd guardians' display names. Never reads or returns
    anything about children beyond each guardian's own aggregate
    `child_count` — there is no per-attendee child data anywhere in the
    schema to leak.

    `term_id` given: that exact Term drives the view — `EntityNotFoundException`
    (-> 404) when it does not exist or belongs to another Circle. `term_id`
    absent: the next upcoming Term is picked (falling back to the most
    recent past Term so the page is never empty; `None` when the Circle has
    zero Terms)."""
    group = await get_group(db, group_id)

    organizer_display_name: str | None = None
    leadership = await get_current_leadership(db, group_id)
    if leadership is not None:
        organizer_party_id = await _group_role_party_id(db, leadership.from_role_id)
        organizer_profile = await get_profile_by_party(db, organizer_party_id)
        organizer_display_name = organizer_profile.display_name

    organizer_slug = await resolve_organizer_slug(db, group_id)

    next_term: Term | None = None
    if term_id is not None:
        term = await get_term(db, term_id)
        if term.circle_group_id != group_id:
            raise EntityNotFoundException("Term", term_id)
        next_term = term
    else:
        terms = await list_terms(db, group_id)
        if terms:
            midnight_today = datetime.combine(date.today(), time.min)
            upcoming = [term for term in terms if term.occurs_on >= midnight_today]
            next_term = min(upcoming, key=lambda term: term.occurs_on) if upcoming else terms[0]

    next_term_response: PublicTermResponse | None = None
    guardians: list[PublicGuardianResponse] = []
    if next_term is not None:
        needed_item_views = await list_needed_item_views(db, cast(int, next_term.id))
        pledger_by_item = {
            needed_item_id: display_name
            for needed_item_id, display_name in await repository.list_active_pledges_for_term(
                db, cast(int, next_term.id)
            )
        }
        next_term_response = PublicTermResponse(
            id=cast(int, next_term.id),
            occurs_on=next_term.occurs_on,
            description=next_term.description,
            needed_items=[
                PublicNeededItemResponse(
                    id=view["id"],
                    product_id=view["product_id"],
                    product_name=view["product_name"],
                    product_category=view["product_category"],
                    description=view["description"],
                    claimed=view["id"] in pledger_by_item,
                    claimed_by_name=pledger_by_item.get(view["id"]),
                )
                for view in needed_item_views
            ],
        )

        attendances = await list_attendances_for_term(db, cast(int, next_term.id))
        if attendances:
            party_ids = [attendance.party_id for attendance in attendances]
            profile_rows = await repository.list_profile_names_by_party_ids(db, party_ids)
            names_by_party_id = {row.party_id: row.display_name for row in profile_rows}
            guardians = [
                PublicGuardianResponse(display_name=names_by_party_id[attendance.party_id])
                for attendance in attendances
                if attendance.party_id in names_by_party_id
            ]

    return PublicCircleResponse(
        id=cast(int, group.id),
        name=group.name,
        organizer_display_name=organizer_display_name,
        organizer_slug=organizer_slug,
        next_term=next_term_response,
        guardians=guardians,
    )


async def create_rsvp(
    db: AsyncSession,
    group_id: int,
    term_id: int,
    guardian_name: str,
    child_count: int,
    principal: Principal | None = None,
) -> RsvpResponse:
    """Public RSVP. Anonymous (no / invalid / expired token, `principal`
    unresolvable): mirrors `create_lightweight_family_member`'s four-step
    Party->UserProfile->attendance-row shape exactly, `attached_to_account`
    False. Logged-in (`principal` resolves to a real account-backed
    `UserProfile`): attaches a `TermAttendance` to that profile's existing
    party — no new Party/UserProfile — idempotent per `(party, term.id)`
    (an existing row's `child_count` is refreshed in place), the request
    `guardian_name` is ignored in favour of the profile `display_name`,
    `attached_to_account` True. The ownership check
    (`term.circle_group_id == group_id`) guards both paths. This route
    never 401s and never 500s on a bad token."""
    term = await get_term(db, term_id)
    if term.circle_group_id != group_id:
        raise EntityNotFoundException("Term", term_id)

    profile: UserProfile | None = None
    if principal is not None:
        try:
            profile = await get_profile_by_principal(db, principal)
        except EntityNotFoundException:
            profile = None

    # A principal that resolves only to an unmerged anonymous profile
    # (`account_user_id is None`) deliberately falls through to the anonymous
    # branch below rather than attaching here — the attach path requires a real
    # account-backed profile.
    if profile is not None and profile.account_user_id is not None:
        existing = (
            await db.execute(
                select(TermAttendance).where(
                    TermAttendance.term_id == term.id,
                    TermAttendance.party_id == profile.party_id,
                )
            )
        ).scalar_one_or_none()
        if existing is not None:
            existing.child_count = child_count
            attendance = existing
        else:
            attendance = TermAttendance(
                term_id=cast(int, term.id),
                party_id=cast(int, profile.party_id),
                child_count=child_count,
            )
            db.add(attendance)
        await db.commit()
        await db.refresh(attendance)
        return RsvpResponse(
            id=cast(int, attendance.id),
            term_id=cast(int, term.id),
            user_profile_id=cast(int, profile.id),
            guardian_name=profile.display_name,
            child_count=child_count,
            attached_to_account=True,
        )

    party = await create_party(db, PartyType.PERSON)
    profile = UserProfile(
        party_id=cast(int, party.id),
        account_user_id=None,
        display_name=guardian_name,
        email=None,
    )
    db.add(profile)
    await db.flush()

    attendance = TermAttendance(
        term_id=cast(int, term.id), party_id=cast(int, party.id), child_count=child_count
    )
    db.add(attendance)
    await db.commit()
    await db.refresh(attendance)

    return RsvpResponse(
        id=cast(int, attendance.id),
        term_id=cast(int, term.id),
        user_profile_id=cast(int, profile.id),
        guardian_name=guardian_name,
        child_count=child_count,
        attached_to_account=False,
    )
