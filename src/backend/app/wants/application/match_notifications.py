"""The bell rows of one scan run: one `WANT_MATCH_FOUND` row per want that
got new pairs and has its notifications on, and one `WANT_EXPIRING` row per
want reminded in the run.

A want has at most one unread match row. A still unread one is deleted and
its count added to the new row's; a read one stays and the new row counts
the run's pairs only. The old rows are deleted before the new ones are
built, because the text of a row carries the summed count. The statement
count does not depend on the number of wants or pairs; nothing commits."""

from __future__ import annotations

import uuid
from collections import defaultdict
from collections.abc import Collection, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy import Integer, column, select, update, values
from sqlalchemy.dialects import postgresql
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import clock

from ..domain import messages
from ..domain.links import product_path, want_path
from ..domain.status import WantStatus
from ..infrastructure import (
    groups_acl,
    inventory_acl,
    notifications_acl,
    organizations_acl,
    product_acl,
)
from ..models import Want

# `(want_id, item_id)` of one stored pair.
MatchedPair = tuple[uuid.UUID, uuid.UUID]


@dataclass(frozen=True)
class ExpiringWant:
    """A want the run has just reminded of its end."""

    id: uuid.UUID
    seeker_party_id: uuid.UUID
    name: str


@dataclass(frozen=True)
class _NamedItem:
    product_name: str
    path: str


async def _wants_to_notify(db: AsyncSession, want_ids: Collection[uuid.UUID]) -> Sequence[Any]:
    """The still active wants with notifications on, locked in id order so a
    withdrawal or edit committed mid-run is seen here and one that comes
    later waits for the run."""
    if not want_ids:
        return []
    result = await db.execute(
        select(
            Want.id,
            Want.seeker_party_id,
            Want.name,
            Want.match_notification_id,
            Want.match_notification_count,
        )
        .where(
            Want.id.in_(want_ids),
            Want.status == WantStatus.ACTIVE,
            Want.notifications_enabled,
        )
        .order_by(Want.id)
        .with_for_update()
    )
    return result.all()


async def _named_items(
    db: AsyncSession, item_ids: Collection[uuid.UUID]
) -> dict[uuid.UUID, _NamedItem]:
    """Product name and item page of each listed item, in two statements."""
    if not item_ids:
        return {}
    preference = groups_acl.ItemListingPreference
    item = inventory_acl.InventoryItem
    product = product_acl.Product
    rows = (
        await db.execute(
            select(preference.item_id, preference.owner_party_id, product.name)
            .join(item, item.id == preference.item_id)
            .join(product, product.id == item.product_id)
            .where(preference.item_id.in_(item_ids))
        )
    ).all()
    organizations = await organizations_acl.get_own_organizations_by_party_ids(
        db, {row.owner_party_id for row in rows}
    )
    named: dict[uuid.UUID, _NamedItem] = {}
    for row in rows:
        organization = organizations.get(row.owner_party_id)
        slug = groups_acl.derive_party_slug(
            row.owner_party_id, organization.slug if organization is not None else None
        )
        named[row.item_id] = _NamedItem(row.name, product_path(slug, row.item_id))
    return named


def _entry(
    party_id: uuid.UUID,
    kind: notifications_acl.NotificationKind,
    message: str,
    link_path: str,
    *,
    topic_id: uuid.UUID | None = None,
) -> notifications_acl.NotificationEntry:
    return notifications_acl.NotificationEntry(
        party_id=party_id,
        kind=kind,
        message=clock.fit_notification_message(message),
        link_path=link_path,
        topic_id=topic_id,
    )


async def _point_wants_at_rows(
    db: AsyncSession, rows: Sequence[tuple[uuid.UUID, uuid.UUID, int]], now: datetime
) -> None:
    """Sets the match row and its count of every `(want, row, count)` in one
    statement. `updated_at` moves too, so a seeker's write that loaded the
    want before the run fails its version check."""
    new_rows = values(
        column("want_id", postgresql.UUID(as_uuid=True)),
        column("notification_id", postgresql.UUID(as_uuid=True)),
        column("count", Integer),
        name="new_rows",
    ).data(rows)
    await db.execute(
        update(Want)
        .where(Want.id == new_rows.c.want_id, Want.status == WantStatus.ACTIVE)
        .values(
            match_notification_id=new_rows.c.notification_id,
            match_notification_count=new_rows.c.count,
            updated_at=now,
        )
        .execution_options(synchronize_session=False)
    )


async def write_bell_rows(
    db: AsyncSession,
    *,
    pairs: Sequence[MatchedPair],
    expiring: Sequence[ExpiringWant],
    now: datetime,
) -> int:
    """Writes the rows for the pairs a run stored and the wants it reminded,
    and returns how many. A muted want gets no match row and keeps its
    pointer and count. A single new match whose item is no longer listed
    gets no row either."""
    items_by_want: defaultdict[uuid.UUID, list[uuid.UUID]] = defaultdict(list)
    for want_id, item_id in pairs:
        items_by_want[want_id].append(item_id)
    wants = await _wants_to_notify(db, items_by_want.keys())
    replaced = await notifications_acl.delete_unread_notifications(
        db,
        [want.match_notification_id for want in wants if want.match_notification_id is not None],
    )
    counts = {
        want.id: len(items_by_want[want.id])
        + (want.match_notification_count if want.match_notification_id in replaced else 0)
        for want in wants
    }
    named = await _named_items(
        db, [items_by_want[want.id][0] for want in wants if counts[want.id] == 1]
    )

    entries: list[notifications_acl.NotificationEntry] = []
    pointed: list[tuple[uuid.UUID, int]] = []
    for want in wants:
        count = counts[want.id]
        if count == 1:
            item = named.get(items_by_want[want.id][0])
            if item is None:
                continue
            message = messages.single_match_message(want.name, item.product_name)
            link_path = item.path
        else:
            message = messages.several_matches_message(want.name, count)
            link_path = want_path(want.id)
        entries.append(
            _entry(
                want.seeker_party_id,
                notifications_acl.NotificationKind.WANT_MATCH_FOUND,
                message,
                link_path,
                topic_id=want.id,
            )
        )
        pointed.append((want.id, count))
    entries.extend(
        _entry(
            want.seeker_party_id,
            notifications_acl.NotificationKind.WANT_EXPIRING,
            messages.expiring_message(want.name),
            want_path(want.id),
        )
        for want in expiring
    )

    written = await notifications_acl.create_notifications(db, entries)
    if pointed:
        await _point_wants_at_rows(
            db,
            [
                (want_id, row_id, count)
                for (want_id, count), row_id in zip(pointed, written[: len(pointed)], strict=True)
            ],
            now,
        )
    return len(written)
