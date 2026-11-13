"""The global search: one page of listed items (`search_items`) or of
upcoming meetings, groups and organizations (`search_meetings`) matching a
query, in the viewer's groups (`MINE`) or everywhere (`ALL`), plus the
other mode's count.

Matching folds the query with `fold_pl` in SQL and uses the generated
`search_vector` columns (`@@ plainto_tsquery('simple', …)`) and the
word-similarity operator `<%` on folded names; `:q` is always a bound
parameter. Visibility comes from the groups predicates; listed-only (R12)
is the items base select. Every read is a fixed number of statements,
independent of the number of rows: viewer, category check (items with a
category filter), page rows, total, other-mode count, then one batch each
for the owners' Organizations and the thumbnails (items) or for the display
names and the places (meetings). The statements run under a
`SET LOCAL statement_timeout` (`STATEMENT_TIMEOUT`), so an expensive public
query fails fast instead of holding a pool connection."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from typing import Any, Literal, cast

from sqlalchemy import (
    Boolean,
    ColumnElement,
    DateTime,
    Float,
    Integer,
    Row,
    Select,
    String,
    Text,
    and_,
    bindparam,
    case,
    exists,
    false,
    func,
    literal,
    literal_column,
    null,
    or_,
    select,
    text,
    true,
    union_all,
)
from sqlalchemy import cast as sql_cast
from sqlalchemy.dialects import postgresql
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.core import clock
from app.core.auth_deps import Principal
from app.core.errors import ServiceUnavailableException
from app.core.pagination import PageParams
from app.storage.service import ObjectStorage

from ..domain import links
from ..domain.ranking import (
    MATCH_CLASS_DESCRIPTION,
    MATCH_CLASS_NAME,
    WEIGHT_A,
    WEIGHT_B,
    WEIGHT_C,
)
from ..infrastructure import (
    category_acl,
    events_acl,
    groups_acl,
    inventory_acl,
    locations_acl,
    organizations_acl,
    product_acl,
    users_acl,
)
from ..infrastructure.groups_acl import ExchangeMode, VisibilityScope
from ..infrastructure.inventory_acl import ItemCondition
from ..schemas import (
    EventMeta,
    EventResult,
    GroupMeta,
    GroupResult,
    OrganizationMeta,
    OrganizationResult,
    ProductMeta,
    ProductResult,
    SearchPage,
    SearchResult,
    TermMeta,
    TermResult,
)

SearchMode = Literal["items", "events"]
# Per search transaction only (`SET LOCAL`), never the engine default.
STATEMENT_TIMEOUT = "3s"
QUERY_CANCELED = "57014"
TIMED_OUT_MESSAGE = "Wyszukiwanie trwa zbyt długo. Spróbuj zawęzić zapytanie."
_UUID = postgresql.UUID(as_uuid=True)


@dataclass(frozen=True)
class SearchFilters:
    """Items: `category_id` (with its descendants), `condition`,
    `offer_type`. Meetings: the inclusive Warsaw days `date_from`..`date_to`."""

    category_id: uuid.UUID | None = None
    condition: ItemCondition | None = None
    offer_type: ExchangeMode | None = None
    date_from: date | None = None
    date_to: date | None = None


def is_browse(q: str) -> bool:
    """A blank query browses: the newest listed items (within the filters)
    or the upcoming terms and events, unmatched and unranked."""
    return not q.strip()


def validate_search(q: str, mode: SearchMode, filters: SearchFilters) -> None:
    """A `ValueError` (400) for a query under the minimum folded length
    (a blank one browses), a filter of the other mode or
    `date_to` before `date_from`."""
    if (
        not is_browse(q)
        and len(locations_acl.fold_polish(q.strip())) < locations_acl.MIN_QUERY_LENGTH
    ):
        raise ValueError(f"Zapytanie musi mieć co najmniej {locations_acl.MIN_QUERY_LENGTH} znaki")
    item_filters = (filters.category_id, filters.condition, filters.offer_type)
    date_filters = (filters.date_from, filters.date_to)
    if mode == "events" and any(value is not None for value in item_filters):
        raise ValueError("Filtry kategorii, stanu i oferty dotyczą tylko przedmiotów")
    if mode == "items" and any(value is not None for value in date_filters):
        raise ValueError("Filtry dat dotyczą tylko spotkań")
    if filters.date_from and filters.date_to and filters.date_to < filters.date_from:
        raise ValueError("Data końcowa nie może być wcześniejsza niż początkowa")


class _Query:
    """The folded query as SQL: one bound `:q`, reused by every clause."""

    def __init__(self, q: str) -> None:
        self.folded = func.fold_pl(bindparam("q", q.strip(), type_=String))
        self.tsquery = func.plainto_tsquery(literal_column("'simple'::regconfig"), self.folded)

    def similar(self, folded_field: Any) -> ColumnElement[bool]:
        """`fold_pl(:q) <% field` at pg_trgm's default word-similarity threshold."""
        return self.folded.bool_op("<%")(folded_field)

    def similarity(self, folded_field: Any, weight: float) -> ColumnElement[float]:
        return func.word_similarity(self.folded, folded_field) * weight

    def in_vector(self, vector: Any) -> ColumnElement[bool]:
        return cast(ColumnElement[bool], vector.bool_op("@@")(self.tsquery))

    def vector_rank(self, vector: Any) -> ColumnElement[float]:
        return func.ts_rank(vector, self.tsquery)


def _fold(field: Any) -> ColumnElement[str]:
    return func.fold_pl(field)


# --- items ---------------------------------------------------------------


def _category_subtree(category_id: uuid.UUID) -> Select[tuple[uuid.UUID]]:
    category = category_acl.Category
    tree = (
        select(category.id).where(category.id == category_id).cte("category_tree", recursive=True)
    )
    child = aliased(category)
    tree = tree.union_all(select(child.id).where(child.parent_id == tree.c.id))
    return select(tree.c.id)


def _matching(
    select_query: Select[Any], query: _Query, product: Any, category: Any
) -> tuple[Select[Any], ColumnElement[float]]:
    """`select_query` kept to products matching `query` by name, text or
    category, and their rank."""
    matched_categories = (
        select(
            category.id.label("id"),
            func.greatest(
                query.similarity(_fold(category.name), WEIGHT_B),
                query.similarity(category.path_text, WEIGHT_C),
            ).label("rank"),
        )
        # `path_text` ends with the folded name, so its index serves the match;
        # the name still ranks the leaf (weight B) above its ancestors (C).
        .where(query.similar(category.path_text))
        .cte("matched_categories")
    )
    product_name = _fold(product.name)
    matching = select_query.outerjoin(
        matched_categories, matched_categories.c.id == product.category_id
    ).where(
        or_(
            query.in_vector(product.search_vector),
            query.similar(product_name),
            matched_categories.c.id.is_not(None),
        )
    )
    rank = query.vector_rank(product.search_vector) + func.greatest(
        query.similarity(product_name, WEIGHT_A),
        func.coalesce(matched_categories.c.rank, 0.0),
    )
    return matching, rank


def _items_select(
    query: _Query | None,
    viewer: uuid.UUID | None,
    scope: VisibilityScope,
    filters: SearchFilters,
    *,
    page_columns: bool,
) -> Select[Any]:
    """The matching listed items the viewer may see, never their own (all
    of them without a `query`); with `page_columns` also the card
    columns and the ordering."""
    preference = groups_acl.ItemListingPreference
    product = product_acl.Product
    category = category_acl.Category
    listed = groups_acl.with_pending_proposer(
        inventory_acl.listed_items_with_product_select()
    ).subquery("listed")
    select_query = (
        select(preference.item_id)
        .select_from(preference)
        .join(listed, listed.c.item_id == preference.item_id)
        .join(product, product.id == listed.c.product_id)
        .where(groups_acl.items_visible_to(viewer, scope))
    )
    rank: ColumnElement[float] = literal(0.0, Float)
    if query is not None:
        select_query, rank = _matching(select_query, query, product, category)
    if viewer is not None:
        select_query = select_query.where(preference.owner_party_id != viewer)
    if filters.category_id is not None:
        select_query = select_query.where(
            product.category_id.in_(_category_subtree(filters.category_id))
        )
    if filters.condition is not None:
        select_query = select_query.where(listed.c.condition == filters.condition)
    if filters.offer_type is not None:
        select_query = select_query.where(preference.mode == filters.offer_type)
    if not page_columns:
        return select_query

    in_my_groups = (
        groups_acl.owner_shares_group_with(viewer) if viewer is not None else false()
    ).label("in_my_groups")
    # Reserved while the balance is not AVAILABLE or a swap proposal is pending.
    reserved = or_(
        listed.c.balance_status != inventory_acl.BalanceStatus.AVAILABLE,
        listed.c.proposer_party_id.is_not(None),
    ).label("reserved")
    rank = rank.label("rank")
    return select_query.add_columns(
        preference.owner_party_id,
        preference.mode,
        listed.c.product_id,
        listed.c.product_name,
        listed.c.condition,
        reserved,
        inventory_acl.newest_open_reservation_starts_at(listed.c.item_id).label("reserved_until"),
        in_my_groups,
        rank,
    ).order_by(
        in_my_groups.desc(),
        reserved,
        rank.desc(),
        preference.created_at.desc(),
        preference.item_id,
    )


async def _count(db: AsyncSession, select_query: Select[Any]) -> int:
    return int(await db.scalar(select(func.count()).select_from(select_query.subquery())) or 0)


async def _product_results(
    db: AsyncSession, rows: list[Row[Any]], storage: ObjectStorage | None, *, guest: bool
) -> list[SearchResult]:
    """The item cards; a guest learns only that an item is reserved, never
    the date it is reserved for."""
    organizations = await organizations_acl.get_own_organizations_by_party_ids(
        db, {row.owner_party_id for row in rows}
    )
    photos = (
        await product_acl.first_approved_photo_by_product(db, {row.product_id for row in rows})
        if storage is not None
        else {}
    )
    results: list[SearchResult] = []
    for row in rows:
        organization = organizations.get(row.owner_party_id)
        slug = groups_acl.derive_party_slug(
            row.owner_party_id, organization.slug if organization is not None else None
        )
        photo = photos.get(row.product_id)
        results.append(
            ProductResult(
                id=row.item_id,
                title=row.product_name,
                subtitle=None,
                href=links.product_path(slug, row.item_id),
                meta=ProductMeta(
                    mode=row.mode,
                    condition=row.condition,
                    thumb_url=(
                        storage.public_url(photo.thumb_key)
                        if photo is not None and storage is not None
                        else None
                    ),
                    reserved=row.reserved,
                    reserved_until=row.reserved_until if row.reserved and not guest else None,
                ),
            )
        )
    return results


async def search_items(
    db: AsyncSession,
    q: str,
    viewer: uuid.UUID | None,
    scope: VisibilityScope,
    filters: SearchFilters,
    pagination: PageParams,
    storage: ObjectStorage | None,
) -> SearchPage:
    """One page of matching listed items (every one for a browse): items
    of the viewer's groups first, available before reserved, then by rank
    and newest listing."""
    if filters.category_id is not None:
        category = category_acl.Category
        if not await db.scalar(select(exists().where(category.id == filters.category_id))):
            raise ValueError("Nieznana kategoria")
    query = None if is_browse(q) else _Query(q)
    rows = list(
        (
            await db.execute(
                _items_select(query, viewer, scope, filters, page_columns=True)
                .offset(pagination.offset)
                .limit(pagination.size)
            )
        ).all()
    )
    total = await _count(db, _items_select(query, viewer, scope, filters, page_columns=False))
    other_mode_count = await _count_other_mode(db, query, viewer, scope, "items")
    return SearchPage(
        items=await _product_results(db, rows, storage, guest=viewer is None),
        total=total,
        page=pagination.page,
        size=pagination.size,
        other_mode_count=other_mode_count,
    )


# --- meetings ------------------------------------------------------------


def _null(type_: Any) -> ColumnElement[Any]:
    return sql_cast(null(), type_)


def _row(
    kind: str,
    id_: Any,
    title: Any,
    sort_at: Any,
    in_my_groups: Any,
    rank: Any,
    match_class: Any,
    *,
    group_id: Any = None,
    party_id: Any = None,
    location_id: Any = None,
    description: Any = None,
    next_term_id: Any = None,
    terms_page: Any = None,
    organization_name: Any = None,
    organization_slug: Any = None,
) -> list[ColumnElement[Any]]:
    """The union's columns, in one order and type for every kind."""

    def column(value: Any, type_: Any, name: str) -> ColumnElement[Any]:
        return (_null(type_) if value is None else sql_cast(value, type_)).label(name)

    return [
        literal(kind, String).label("kind"),
        column(id_, _UUID, "id"),
        column(title, String, "title"),
        column(sort_at, DateTime, "sort_at"),
        column(in_my_groups, Boolean, "in_my_groups"),
        column(rank, Float, "rank"),
        column(match_class, Integer, "match_class"),
        column(group_id, _UUID, "group_id"),
        column(party_id, _UUID, "party_id"),
        column(location_id, _UUID, "location_id"),
        column(description, Text, "description"),
        column(next_term_id, _UUID, "next_term_id"),
        column(terms_page if terms_page is not None else false(), Boolean, "terms_page"),
        column(organization_name, String, "organization_name"),
        column(organization_slug, String, "organization_slug"),
    ]


def _in_my_groups(viewer: uuid.UUID | None, group_id: Any) -> ColumnElement[bool]:
    return groups_acl.in_groups_of(viewer, group_id) if viewer is not None else false()


def _date_window(now: datetime, filters: SearchFilters) -> tuple[datetime, datetime | None]:
    """`date_from` clamped to now (the past is never shown); `date_to`
    inclusive."""
    start = now
    if filters.date_from is not None:
        start = max(now, datetime.combine(filters.date_from, time.min))
    end = (
        datetime.combine(filters.date_to + timedelta(days=1), time.min)
        if filters.date_to is not None
        else None
    )
    return start, end


def _in_window(column: Any, start: datetime, end: datetime | None) -> ColumnElement[bool]:
    return and_(column >= start, column < end) if end is not None else column >= start


def _matched(
    query: _Query | None, fields: list[Any], vector: Any, weights: list[float]
) -> tuple[ColumnElement[bool], ColumnElement[float]]:
    """A meeting row's match on `vector` or any folded field, and its rank;
    without a `query` everything matches at rank 0."""
    if query is None:
        return true(), literal(0.0, Float)
    match = or_(query.in_vector(vector), *(query.similar(field) for field in fields))
    rank = query.vector_rank(vector) + func.greatest(
        *(query.similarity(field, weight) for field, weight in zip(fields, weights, strict=True))
    )
    return match, rank


_MEETING_WEIGHTS = [WEIGHT_A, WEIGHT_B, WEIGHT_C, WEIGHT_C]


def _terms_branch(
    query: _Query | None,
    viewer: uuid.UUID | None,
    scope: VisibilityScope,
    start: datetime,
    end: datetime | None,
) -> Select[Any]:
    group, term = groups_acl.Group, groups_acl.Term
    location, locality = locations_acl.Location, locations_acl.Locality
    organizer = groups_acl.current_organizer(group.id)
    organization = organizations_acl.owned_organization(organizer.c.party_id)
    address = _fold(location.formatted_address)
    match, rank = _matched(
        query,
        [_fold(group.name), _fold(organization.c.name), locality.name_search, address],
        term.search_vector,
        _MEETING_WEIGHTS,
    )
    return (
        select(
            *_row(
                "term",
                term.id,
                group.name,
                term.occurs_on,
                _in_my_groups(viewer, group.id),
                rank,
                MATCH_CLASS_NAME,
                group_id=group.id,
                party_id=organizer.c.party_id,
                location_id=term.location_id,
                organization_name=organization.c.name,
                organization_slug=organization.c.slug,
            )
        )
        .select_from(term)
        .join(group, group.id == term.circle_group_id)
        .outerjoin(organizer, true())
        .outerjoin(organization, true())
        .outerjoin(location, location.id == term.location_id)
        .outerjoin(locality, locality.id == location.locality_id)
        .where(
            groups_acl.terms_visible_to(viewer, scope),
            _in_window(term.occurs_on, start, end),
            match,
        )
    )


def _events_branch(query: _Query | None, start: datetime, end: datetime | None) -> Select[Any]:
    event = events_acl.Event
    location, locality = locations_acl.Location, locations_acl.Locality
    organization = organizations_acl.owned_organization(event.author_party_id)
    address = _fold(location.formatted_address)
    match, rank = _matched(
        query,
        [_fold(event.name), _fold(organization.c.name), locality.name_search, address],
        event.search_vector,
        _MEETING_WEIGHTS,
    )
    return (
        select(
            *_row(
                "event",
                event.id,
                event.name,
                event.starts_at,
                false(),
                rank,
                MATCH_CLASS_NAME,
                party_id=event.author_party_id,
                location_id=event.location_id,
                organization_name=organization.c.name,
                organization_slug=organization.c.slug,
            )
        )
        .select_from(event)
        .outerjoin(organization, true())
        .outerjoin(location, location.id == event.location_id)
        .outerjoin(locality, locality.id == location.locality_id)
        .where(
            # A running event is hidden: only upcoming starts.
            _in_window(event.starts_at, start, end),
            match,
        )
    )


def _groups_branch(
    query: _Query,
    viewer: uuid.UUID | None,
    scope: VisibilityScope,
    start: datetime,
    end: datetime | None,
    *,
    windowed: bool,
) -> Select[Any]:
    """With a date window (`windowed`) a group needs its next term inside
    it, whatever page it links to."""
    group = groups_acl.Group
    organizer = groups_acl.current_organizer(group.id)
    organization = organizations_acl.owned_organization(organizer.c.party_id)
    upcoming = groups_acl.next_term(group.id, start)
    name_match = or_(query.similar(_fold(group.name)), query.similar(_fold(organization.c.name)))
    description_match = query.similar(_fold(group.description))
    # An org-run PUBLIC group links to its terms page; any other group needs
    # an upcoming term to link to.
    terms_page = and_(
        organization.c.slug.is_not(None),
        group.visibility == groups_acl.GroupVisibility.PUBLIC,
    )
    rank = func.greatest(
        query.similarity(_fold(group.name), WEIGHT_A),
        query.similarity(_fold(organization.c.name), WEIGHT_B),
        query.similarity(_fold(group.description), WEIGHT_C),
    )
    return (
        select(
            *_row(
                "group",
                group.id,
                group.name,
                upcoming.c.occurs_on,
                _in_my_groups(viewer, group.id),
                rank,
                case((name_match, MATCH_CLASS_NAME), else_=MATCH_CLASS_DESCRIPTION),
                group_id=group.id,
                party_id=organizer.c.party_id,
                description=group.description,
                next_term_id=upcoming.c.term_id,
                terms_page=terms_page,
                organization_name=organization.c.name,
                organization_slug=organization.c.slug,
            )
        )
        .select_from(group)
        .outerjoin(organizer, true())
        .outerjoin(organization, true())
        .outerjoin(upcoming, true())
        .where(
            groups_acl.groups_visible_to(viewer, scope),
            or_(name_match, description_match),
            _in_window(upcoming.c.occurs_on, start, end)
            if windowed
            else or_(terms_page, upcoming.c.term_id.is_not(None)),
        )
    )


def _organizations_branch(query: _Query) -> Select[Any]:
    organization = organizations_acl.Organization
    rank = func.greatest(
        query.similarity(_fold(organization.name), WEIGHT_A),
        query.similarity(_fold(organization.slug), WEIGHT_A),
    )
    return select(
        *_row(
            "organization",
            organization.id,
            organization.name,
            None,
            false(),
            rank,
            MATCH_CLASS_NAME,
            organization_name=organization.name,
            organization_slug=organization.slug,
        )
    ).where(
        # Without an owner the `/<slug>` page is a 404.
        organizations_acl.has_owner(organization.id),
        or_(query.similar(_fold(organization.name)), query.similar(_fold(organization.slug))),
    )


def _meetings_union(
    query: _Query | None, viewer: uuid.UUID | None, scope: VisibilityScope, filters: SearchFilters
) -> Select[Any]:
    """Every matching meeting row, one `UNION ALL`; events and organizations
    only in `ALL`; a browse (no `query`) only the terms and events. Selected
    from as `results`."""
    # Warsaw wall clock, the clock of `Term.occurs_on` and `Event.starts_at`.
    now = clock.local_now()
    start, end = _date_window(now, filters)
    branches = [_terms_branch(query, viewer, scope, start, end)]
    if query is not None:
        windowed = filters.date_from is not None or filters.date_to is not None
        branches.append(_groups_branch(query, viewer, scope, start, end, windowed=windowed))
    if scope == VisibilityScope.ALL:
        branches.append(_events_branch(query, start, end))
        if query is not None:
            branches.append(_organizations_branch(query))
    results = union_all(*branches).subquery("results")
    return select(results)


def _place(locations: dict[uuid.UUID, Any], location_id: uuid.UUID | None) -> str | None:
    location = locations.get(location_id) if location_id is not None else None
    return location.label if location is not None else None


def _group_href(row: Row[Any]) -> str:
    """An org-run PUBLIC group links to its terms page, any other group to
    its nearest upcoming term (the SQL keeps only groups with one of them)."""
    if row.terms_page:
        return links.group_terms_path(row.organization_slug, row.id)
    slug = groups_acl.derive_organizer_slug(row.id, row.party_id, row.organization_slug)
    return links.term_path(slug, row.id, row.next_term_id)


async def _meeting_results(db: AsyncSession, rows: list[Row[Any]]) -> list[SearchResult]:
    person_ids = {
        row.party_id
        for row in rows
        if row.kind in ("term", "event")
        and row.party_id is not None
        and row.organization_name is None
    }
    names = await users_acl.load_display_names(db, person_ids)
    locations = await locations_acl.load_locations_by_ids(
        db, {row.location_id for row in rows if row.location_id is not None}
    )
    results: list[SearchResult] = []
    for row in rows:
        organizer_name = row.organization_name or names.get(row.party_id)
        if row.kind == "term":
            slug = groups_acl.derive_organizer_slug(
                row.group_id, row.party_id, row.organization_slug
            )
            results.append(
                TermResult(
                    id=row.id,
                    title=row.title,
                    subtitle=organizer_name,
                    href=links.term_path(slug, row.group_id, row.id),
                    meta=TermMeta(
                        starts_at=row.sort_at,
                        place=_place(locations, row.location_id),
                        in_my_groups=row.in_my_groups,
                    ),
                )
            )
        elif row.kind == "event":
            slug = groups_acl.derive_party_slug(row.party_id, row.organization_slug)
            results.append(
                EventResult(
                    id=row.id,
                    title=row.title,
                    subtitle=organizer_name,
                    href=links.event_path(slug, row.id),
                    meta=EventMeta(starts_at=row.sort_at, place=_place(locations, row.location_id)),
                )
            )
        elif row.kind == "group":
            results.append(
                GroupResult(
                    id=row.id,
                    title=row.title,
                    subtitle=row.organization_name,
                    href=_group_href(row),
                    meta=GroupMeta(
                        description=row.description,
                        next_starts_at=None if row.terms_page else row.sort_at,
                        in_my_groups=row.in_my_groups,
                    ),
                )
            )
        else:
            results.append(
                OrganizationResult(
                    id=row.id,
                    title=row.title,
                    subtitle=None,
                    href=links.organization_path(row.organization_slug),
                    meta=OrganizationMeta(slug=row.organization_slug),
                )
            )
    return results


async def search_meetings(
    db: AsyncSession,
    q: str,
    viewer: uuid.UUID | None,
    scope: VisibilityScope,
    filters: SearchFilters,
    pagination: PageParams,
) -> SearchPage:
    """One page of matching meetings: name matches before description-only
    groups, then the soonest first (dateless last), the viewer's groups
    first, then by rank, kind and id. A browse lists the upcoming terms
    and events, soonest first."""
    query = None if is_browse(q) else _Query(q)
    union = _meetings_union(query, viewer, scope, filters)
    results = union.subquery("page")
    rows = list(
        (
            await db.execute(
                select(results)
                .order_by(
                    results.c.match_class,
                    results.c.sort_at.asc().nulls_last(),
                    results.c.in_my_groups.desc(),
                    results.c.rank.desc(),
                    results.c.kind,
                    results.c.id,
                )
                .offset(pagination.offset)
                .limit(pagination.size)
            )
        ).all()
    )
    total = await _count(db, union)
    other_mode_count = await _count_other_mode(db, query, viewer, scope, "events")
    return SearchPage(
        items=await _meeting_results(db, rows),
        total=total,
        page=pagination.page,
        size=pagination.size,
        other_mode_count=other_mode_count,
    )


async def _count_other_mode(
    db: AsyncSession,
    query: _Query | None,
    viewer: uuid.UUID | None,
    scope: VisibilityScope,
    mode: SearchMode,
) -> int:
    """The total of the mode other than `mode` for the same query and scope,
    without filters: the filters belong to one mode and are cleared when it
    switches, so this is the total the viewer sees after switching."""
    if mode == "items":
        return await _count(db, _meetings_union(query, viewer, scope, SearchFilters()))
    return await _count(
        db, _items_select(query, viewer, scope, SearchFilters(), page_columns=False)
    )


async def search(
    db: AsyncSession,
    principal: Principal | None,
    q: str,
    mode: SearchMode,
    scope: VisibilityScope,
    filters: SearchFilters,
    pagination: PageParams,
    storage: ObjectStorage | None,
) -> SearchPage:
    """The endpoint's read: validation first, then the viewer (a principal
    without a profile counts as a guest, and a guest always searches `ALL`).
    A statement cancelled by `STATEMENT_TIMEOUT` is a 503; any other
    database error propagates unchanged."""
    validate_search(q, mode, filters)
    await db.execute(text(f"SET LOCAL statement_timeout = '{STATEMENT_TIMEOUT}'"))
    try:
        viewer = (
            await users_acl.find_party_id_by_principal(db, principal)
            if principal is not None
            else None
        )
        if viewer is None:
            scope = VisibilityScope.ALL
        if mode == "items":
            return await search_items(db, q, viewer, scope, filters, pagination, storage)
        return await search_meetings(db, q, viewer, scope, filters, pagination)
    except DBAPIError as exc:
        if getattr(exc.orig, "sqlstate", None) == QUERY_CANCELED:
            raise ServiceUnavailableException(TIMED_OUT_MESSAGE) from exc
        raise
