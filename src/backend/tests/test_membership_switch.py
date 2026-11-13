"""The call sites switched onto `group_ids_for` (D1–D11) beyond what
`test_membership_characterisation.py` pins: the documented safer delta (a
soft-deleted circle no longer counts for `is_in_circle`), the organizer-only
`is_in_circle`, a deleted shared PRIVATE circle for `shares_private_circle`
and the keep-live term reads of the organizer of a deleted circle."""

from __future__ import annotations

import uuid
from datetime import datetime

from httpx import AsyncClient
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.groups import service
from app.groups.infrastructure import repository
from app.groups.models import Group
from tests.test_organizer_page import _circle, _in_days, _term
from tests.test_term_item_listings import _auth, _register


async def _add_member(db: AsyncSession, group_id: uuid.UUID, party_id: uuid.UUID) -> None:
    await service.add_active_membership(db, group_id, party_id)
    await db.commit()


async def _soft_delete(db: AsyncSession, group_id: uuid.UUID) -> None:
    await db.execute(update(Group).where(Group.id == group_id).values(deleted_at=datetime.utcnow()))
    await db.commit()


async def _private_circle_with_member(
    client: AsyncClient, db: AsyncSession, prefix: str
) -> tuple[str, uuid.UUID, uuid.UUID, uuid.UUID]:
    """`(organizer_token, organizer_party, member_party, circle)` of a
    PRIVATE circle with one standing member."""
    organizer, organizer_party = await _register(client, "ORGANIZER", f"{prefix}.org@example.com")
    _, member_party = await _register(client, "GUEST", f"{prefix}.member@example.com")
    circle = await _circle(client, organizer, f"Prywatny {prefix}", "PRIVATE")
    await _add_member(db, circle, member_party)
    return organizer, organizer_party, member_party, circle


async def test_isInCircle_softDeletedCircle_returnsFalse(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    _, organizer_party, member_party, circle = await _private_circle_with_member(
        client, db_session, "switch.deleted"
    )
    assert await repository.is_in_circle(db_session, circle, member_party)

    await _soft_delete(db_session, circle)

    assert not await repository.is_in_circle(db_session, circle, member_party)
    assert not await repository.is_in_circle(db_session, circle, organizer_party)


async def test_isInCircle_organizerOnly_leaderTrueMemberFalse(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    _, organizer_party, member_party, circle = await _private_circle_with_member(
        client, db_session, "switch.leads"
    )

    assert await repository.is_in_circle(db_session, circle, organizer_party, organizer_only=True)
    assert not await repository.is_in_circle(db_session, circle, member_party, organizer_only=True)


async def test_sharesPrivateCircle_sharedCircleSoftDeleted_returnsFalse(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    _, organizer_party, member_party, circle = await _private_circle_with_member(
        client, db_session, "switch.shared"
    )
    assert await repository.shares_private_circle(db_session, organizer_party, member_party)

    await _soft_delete(db_session, circle)

    assert not await repository.shares_private_circle(db_session, organizer_party, member_party)


async def test_myTermItemListings_organizerOfSoftDeletedCircleWithoutRsvp_returns200(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    organizer, _ = await _register(client, "ORGANIZER", "switch.d10.org@example.com")
    stranger, _ = await _register(client, "GUEST", "switch.d10.x@example.com")
    circle = await _circle(client, organizer, "Krąg switch.d10")
    term_id = await _term(client, organizer, circle, _in_days(5))
    await _soft_delete(db_session, circle)

    statuses = {
        (path, name): (
            await client.get(
                f"/api/term-item-listings/{path}?term_id={term_id}", headers=_auth(token)
            )
        ).status_code
        for path in ("mine", "mine-as-taker")
        for name, token in (("organizer", organizer), ("stranger", stranger))
    }

    assert statuses == {
        ("mine", "organizer"): 200,
        ("mine", "stranger"): 403,
        ("mine-as-taker", "organizer"): 200,
        ("mine-as-taker", "stranger"): 403,
    }
