"""The `is_primary_contact` lifecycle — "preserve row with validTo set,
don't delete", never an in-place flip of the flag."""

from __future__ import annotations

from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import EntityNotFoundException

from .models import FamilyMembership


async def make_primary_contact(db: AsyncSession, family_id: int, family_membership_id: int) -> None:
    """Ends the current primary contact's membership row and opens a new
    one for `family_membership_id`'s guardian, both dated today — "preserve
    row with validTo set, don't delete", never an in-place flip of
    `is_primary_contact` on an existing row."""
    new_primary = await db.get(FamilyMembership, family_membership_id)
    if new_primary is None or new_primary.to_family_id != family_id:
        raise EntityNotFoundException("FamilyMembership", family_membership_id)
    if new_primary.is_primary_contact and new_primary.valid_to is None:
        return

    today = date.today()
    current_primary = (
        await db.execute(
            select(FamilyMembership).where(
                FamilyMembership.to_family_id == family_id,
                FamilyMembership.is_primary_contact.is_(True),
                FamilyMembership.valid_to.is_(None),
            )
        )
    ).scalar_one_or_none()
    if current_primary is not None:
        current_primary.valid_to = today
        demoted = FamilyMembership(
            from_role_id=current_primary.from_role_id,
            to_family_id=family_id,
            is_primary_contact=False,
            valid_from=today,
            valid_to=None,
        )
        db.add(demoted)

    new_primary.valid_to = today
    replacement = FamilyMembership(
        from_role_id=new_primary.from_role_id,
        to_family_id=family_id,
        is_primary_contact=True,
        valid_from=today,
        valid_to=None,
    )
    db.add(replacement)
    await db.commit()
