"""Synchronous text moderation at the organization / group / term call
sites: an offending value is rejected with a field-specific 400 before any
row is written, an unchanged value is never scored, and adding a term never
scores the group name. A fake classifier is injected through the guard's
setter (the ONNX model is not loaded in tests)."""

from __future__ import annotations

from collections.abc import Generator
from datetime import date

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.groups.models import Group, Term
from app.moderation import text_guard
from app.organizations.models import Organization
from app.party.models import Party

OFFENSIVE = "ZAKAZANE"
ORG_MESSAGE = "Nazwa organizacji narusza zasady społeczności. Zmień ją i spróbuj ponownie."
GROUP_MESSAGE = "Nazwa grupy narusza zasady społeczności. Zmień ją i spróbuj ponownie."
TERM_MESSAGE = "Opis terminu narusza zasady społeczności. Zmień go i spróbuj ponownie."
UNAVAILABLE_MESSAGE = "Moderacja jest chwilowo niedostępna — spróbuj za chwilę."


class FakeTextClassifier:
    """Flags any text containing `OFFENSIVE`; records every scored text."""

    model_id = "fake/bielik-guard"

    def __init__(self, *, fail: bool = False) -> None:
        self._fail = fail
        self.calls: list[str] = []

    def scores(self, text: str) -> dict[str, float]:
        self.calls.append(text)
        if self._fail:
            raise RuntimeError("inference failed")
        sex = 0.99 if OFFENSIVE in text else 0.0
        return {"HATE": 0.0, "VULGAR": 0.0, "SEX": sex, "CRIME": 0.0, "SELF-HARM": 0.0}


@pytest.fixture
def classifier(monkeypatch: pytest.MonkeyPatch) -> Generator[FakeTextClassifier, None, None]:
    monkeypatch.setattr(settings, "moderation_text_enabled", True)
    fake = FakeTextClassifier()
    text_guard.set_classifier(fake)
    yield fake
    text_guard.set_classifier(None)


async def _register_organizer(client: AsyncClient, email: str) -> dict[str, str]:
    response = await client.post(
        "/api/auth/register",
        json={"role": "ORGANIZER", "email": email, "password": "secret123"},
    )
    assert response.status_code == 201
    return {"Authorization": f"Bearer {response.json()['token']}"}


async def _count(db: AsyncSession, model: type[Party] | type[Organization] | type[Group]) -> int:
    return (await db.execute(select(func.count()).select_from(model))).scalar_one()


async def _create_circle(client: AsyncClient, headers: dict[str, str], name: str) -> str:
    response = await client.post("/api/groups/mine", json={"name": name}, headers=headers)
    assert response.status_code == 201
    return str(response.json()["id"])


async def test_createOwnOrganization_offendingName_returns400AndPersistsNothing(
    client: AsyncClient, db_session: AsyncSession, classifier: FakeTextClassifier
) -> None:
    headers = await _register_organizer(client, "tm.org.create@example.com")
    parties_before = await _count(db_session, Party)
    orgs_before = await _count(db_session, Organization)

    response = await client.post(
        "/api/organizations/mine", json={"name": f"Klub {OFFENSIVE}"}, headers=headers
    )

    assert response.status_code == 400
    assert response.json()["message"] == ORG_MESSAGE
    assert await _count(db_session, Party) == parties_before
    assert await _count(db_session, Organization) == orgs_before


async def test_updateOrganization_sameNameNotScored_offendingNameReturns400(
    client: AsyncClient, db_session: AsyncSession, classifier: FakeTextClassifier
) -> None:
    headers = await _register_organizer(client, "tm.org.update@example.com")
    created = await client.post(
        "/api/organizations/mine", json={"name": "Muzyczne Skrzaty"}, headers=headers
    )
    assert created.status_code == 201
    organization_id = created.json()["id"]
    classifier.calls.clear()

    same = await client.patch(
        f"/api/organizations/{organization_id}",
        json={"name": "  Muzyczne   Skrzaty ", "primary_color": "#112233"},
        headers=headers,
    )
    assert same.status_code == 200
    assert classifier.calls == []

    offending = await client.patch(
        f"/api/organizations/{organization_id}",
        json={"name": OFFENSIVE, "primary_color": "#445566"},
        headers=headers,
    )
    assert offending.status_code == 400
    assert offending.json()["message"] == ORG_MESSAGE
    organization = await db_session.get(Organization, organization_id)
    assert organization is not None
    await db_session.refresh(organization)
    assert organization.primary_color == "#112233"


@pytest.mark.parametrize("path", ["/api/groups/mine", "/api/groups/mine/new"])
async def test_createMyCircle_offendingName_returns400AndPersistsNothing(
    client: AsyncClient, db_session: AsyncSession, classifier: FakeTextClassifier, path: str
) -> None:
    headers = await _register_organizer(client, f"tm.group.create{path.count('/')}@example.com")
    parties_before = await _count(db_session, Party)
    groups_before = await _count(db_session, Group)

    response = await client.post(path, json={"name": f"Krąg {OFFENSIVE}"}, headers=headers)

    assert response.status_code == 400
    assert response.json()["message"] == GROUP_MESSAGE
    assert await _count(db_session, Party) == parties_before
    assert await _count(db_session, Group) == groups_before


async def test_updateGroup_unchangedNameNotScored_offendingNameReturns400(
    client: AsyncClient, db_session: AsyncSession, classifier: FakeTextClassifier
) -> None:
    headers = await _register_organizer(client, "tm.group.update@example.com")
    circle_id = await _create_circle(client, headers, "Krąg Rodzinny")
    classifier.calls.clear()

    same = await client.patch(
        f"/api/groups/{circle_id}",
        json={"name": "Krąg Rodzinny", "layout_mode": "TABLE"},
        headers=headers,
    )
    assert same.status_code == 200, same.text
    assert classifier.calls == []

    offending = await client.patch(
        f"/api/groups/{circle_id}", json={"name": OFFENSIVE}, headers=headers
    )
    assert offending.status_code == 400
    assert offending.json()["message"] == GROUP_MESSAGE
    group = await db_session.get(Group, circle_id)
    assert group is not None
    await db_session.refresh(group)
    assert group.name == "Krąg Rodzinny"


async def test_createTerm_offendingDescription_returns400_groupNameNotScored(
    client: AsyncClient, db_session: AsyncSession, classifier: FakeTextClassifier
) -> None:
    headers = await _register_organizer(client, "tm.term.create@example.com")
    circle_id = await _create_circle(client, headers, "Krąg Terminowy")
    classifier.calls.clear()
    terms_before = (await db_session.execute(select(func.count()).select_from(Term))).scalar_one()

    response = await client.post(
        "/api/terms",
        json={
            "circle_group_id": circle_id,
            "occurs_on": date.today().isoformat(),
            "description": f"Spotkanie {OFFENSIVE}",
        },
        headers=headers,
    )

    assert response.status_code == 400
    assert response.json()["message"] == TERM_MESSAGE
    assert classifier.calls == [f"Spotkanie {OFFENSIVE}"]
    terms_after = (await db_session.execute(select(func.count()).select_from(Term))).scalar_one()
    assert terms_after == terms_before


async def test_updateTerm_offendingDescription_returns400(
    client: AsyncClient, db_session: AsyncSession, classifier: FakeTextClassifier
) -> None:
    headers = await _register_organizer(client, "tm.term.update@example.com")
    circle_id = await _create_circle(client, headers, "Krąg Edycji")
    created = await client.post(
        "/api/terms",
        json={
            "circle_group_id": circle_id,
            "occurs_on": date.today().isoformat(),
            "description": "Spotkanie w parku",
        },
        headers=headers,
    )
    assert created.status_code == 201
    term_id = created.json()["id"]
    classifier.calls.clear()

    same = await client.patch(
        f"/api/terms/{term_id}", json={"description": "Spotkanie w parku"}, headers=headers
    )
    assert same.status_code == 200
    assert classifier.calls == []

    offending = await client.patch(
        f"/api/terms/{term_id}", json={"description": OFFENSIVE}, headers=headers
    )
    assert offending.status_code == 400
    assert offending.json()["message"] == TERM_MESSAGE
    term = await db_session.get(Term, term_id)
    assert term is not None
    await db_session.refresh(term)
    assert term.description == "Spotkanie w parku"


async def test_createOwnOrganization_classifierRaises_returns503AndPersistsNothing(
    client: AsyncClient, db_session: AsyncSession, classifier: FakeTextClassifier
) -> None:
    text_guard.set_classifier(FakeTextClassifier(fail=True))
    headers = await _register_organizer(client, "tm.org.fail@example.com")
    orgs_before = await _count(db_session, Organization)

    response = await client.post(
        "/api/organizations/mine", json={"name": "Zwykła Nazwa"}, headers=headers
    )

    assert response.status_code == 503
    assert response.json()["message"] == UNAVAILABLE_MESSAGE
    assert await _count(db_session, Organization) == orgs_before
