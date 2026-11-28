"""Solo-family auto-creation — implementation/spec.md Core Requirements 3, 4:
every new `Party` (via `/api/auth/register`) must have
exactly one resolvable solo `Family` immediately after creation, and the
creation path must be idempotent (never a second Family for the same party).

Isolation via the `conftest.py` TestContainers + savepoint-rollback fixtures;
naming follows `action_condition_expectedResult`
(`standards/testing/backend-testing.md`)."""

from __future__ import annotations

import pytest
from httpx import AsyncClient
from pydantic import BaseModel, ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.families.bootstrap import create_solo_family_for_party
from app.families.repository import list_families_for_guardian_party
from app.families.schemas import AddGuardianRequest, CreateFamilyRequest


async def _register_guest(client: AsyncClient, email: str) -> tuple[str, int]:
    response = await client.post(
        "/api/auth/register",
        json={"role": "GUEST", "email": email, "password": "secret123"},
    )
    assert response.status_code == 201
    body = response.json()
    return body["token"], body["party_id"]


async def test_register_newAccount_createsSoloFamily(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    _token, party_id = await _register_guest(client, "bootstrap.register@example.com")

    families = await list_families_for_guardian_party(db_session, party_id)

    assert len(families) == 1


async def test_createSoloFamilyForParty_calledTwice_returnsSameFamilyBothTimes(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    _token, party_id = await _register_guest(client, "bootstrap.idempotent@example.com")

    first = await create_solo_family_for_party(db_session, party_id, "Test Idempotent")
    second = await create_solo_family_for_party(db_session, party_id, "Test Idempotent")

    assert first.id == second.id

    families = await list_families_for_guardian_party(db_session, party_id)
    assert len(families) == 1


@pytest.mark.parametrize("schema", [CreateFamilyRequest, AddGuardianRequest])
def test_familyLoginSchemas_passwordOver72Bytes_rejectedInPolish(schema: type[BaseModel]) -> None:
    fields = {"family_name": "Rodzina", "username": "opiekun", "display_name": "Opiekun"}

    schema.model_validate({**fields, "password": "ż" * 36})
    with pytest.raises(ValidationError) as excinfo:
        schema.model_validate({**fields, "password": "ż" * 36 + "a"})

    assert excinfo.value.errors()[0]["msg"] == "Hasło może mieć najwyżej 72 bajty."
