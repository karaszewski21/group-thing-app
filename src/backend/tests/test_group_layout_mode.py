"""`app.groups.models.GroupLayoutMode` (string-backed enum) and `Group.layout_mode`
(defaults to `CIRCLE` via `server_default`), plus the corresponding
`app.groups.schemas` field additions (`GroupResponse.layout_mode`,
`UpdateGroupRequest.layout_mode` optional, `name` still required)."""

from __future__ import annotations

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.groups.models import Group, GroupLayoutMode
from app.groups.schemas import GroupResponse, UpdateGroupRequest
from app.party.models import Party, PartyType


def test_groupLayoutMode_hasExactlyCirclePitchTable_asStringBackedEnum() -> None:
    assert {member.value for member in GroupLayoutMode} == {"CIRCLE", "PITCH", "TABLE"}
    for member in GroupLayoutMode:
        assert isinstance(member.value, str)
        assert GroupLayoutMode(member.value) is member


async def test_group_layoutMode_defaultsToCircle_whenNotProvidedOnInsert(
    db_session: AsyncSession,
) -> None:
    party = Party(party_type=PartyType.PERSON, active=True)
    db_session.add(party)
    await db_session.flush()

    group = Group(party_id=party.id, name="Krąg bez trybu")
    db_session.add(group)
    await db_session.commit()
    await db_session.refresh(group)

    row = (await db_session.execute(select(Group).where(Group.id == group.id))).scalar_one()
    assert row.layout_mode == GroupLayoutMode.CIRCLE


def test_updateGroupRequest_acceptsLayoutModeNone_nameStillRequired() -> None:
    request = UpdateGroupRequest(name="Krąg")
    assert request.layout_mode is None

    with pytest.raises(ValueError):
        UpdateGroupRequest(layout_mode=GroupLayoutMode.PITCH)  # type: ignore[call-arg]


def test_groupResponse_serializesLayoutMode() -> None:
    response = GroupResponse(
        id=1,
        party_id=2,
        name="Krąg",
        organizer_slug=None,
        layout_mode=GroupLayoutMode.TABLE,
        visibility="PUBLIC",
        created_at="2026-09-20T00:00:00",
        updated_at="2026-09-20T00:00:00",
    )
    assert response.layout_mode == GroupLayoutMode.TABLE
