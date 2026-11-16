"""`/api/wants`: create with its forward match, the want response and its
counters, validation and moderation, the cap of active wants, the forward
match timeout, 404 for a foreign or withdrawn want, what a PATCH resets, and
the statement counts of create and list."""

from __future__ import annotations

import uuid
from collections.abc import Generator
from datetime import datetime
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select, update
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from app.config import settings
from app.locations.models import Locality
from app.moderation import text_guard
from app.moderation.rules import CONTACT_INFO_MESSAGE
from app.notifications.models import Notification, NotificationKind
from app.wants.application import matcher
from app.wants.application.text_queries import short_words_query
from app.wants.domain.limits import MAX_ACTIVE_WANTS, VALIDITY
from app.wants.domain.status import WantMatchSource, WantStatus
from app.wants.models import Want, WantMatch
from tests.conftest import count_queries, leaf_category_ids
from tests.test_search_location import KETY
from tests.test_term_item_listings import _auth, _register
from tests.test_text_guard import FakeTextClassifier
from tests.test_wants_matcher import _Owner

WANT_KEYS = {
    "id",
    "name",
    "note",
    "category_id",
    "category_name",
    "category_path",
    "offer_mode",
    "locality_id",
    "locality_name",
    "radius_km",
    "notifications_enabled",
    "status",
    "expires_at",
    "closed_at",
    "created_at",
    "match_count",
    "new_match_count",
}
NOT_FOUND_MESSAGE = "Nie znaleziono poszukiwania."
CAP_MESSAGE = "Masz już 30 aktywnych poszukiwań. Zamknij któreś, aby dodać nowe."
TIMEOUT_MESSAGE = "Szukanie dopasowań trwa zbyt długo. Spróbuj ponownie za chwilę."
TRY_AGAIN_MESSAGE = "Dane zostały w międzyczasie zmienione — odśwież i spróbuj ponownie"


@pytest.fixture
def _text_moderation_on(monkeypatch: pytest.MonkeyPatch) -> Generator[None, None, None]:
    monkeypatch.setattr(settings, "moderation_text_enabled", True)
    yield
    text_guard.set_classifier(None)


async def _create_want(client: AsyncClient, token: str, name: str, **fields: Any) -> dict[str, Any]:
    response = await client.post("/api/wants", json={"name": name, **fields}, headers=_auth(token))
    assert response.status_code == 201, response.text
    want: dict[str, Any] = response.json()
    return want


async def _seed_wants(
    db: AsyncSession, seeker: uuid.UUID, count: int, status: WantStatus = WantStatus.ACTIVE
) -> list[uuid.UUID]:
    """Wants written straight to the table, without the API's cap check."""
    now = datetime.utcnow()
    wants = [
        Want(
            seeker_party_id=seeker,
            name=f"Rzecz {number}",
            short_words_query=short_words_query(f"Rzecz {number}"),
            status=status,
            expires_at=now + VALIDITY,
            closed_at=None if status == WantStatus.ACTIVE else now,
        )
        for number in range(count)
    ]
    db.add_all(wants)
    await db.commit()
    return [want.id for want in wants]


async def _want_count(db: AsyncSession, seeker: uuid.UUID) -> int:
    return int(
        await db.scalar(
            select(func.count()).select_from(Want).where(Want.seeker_party_id == seeker)
        )
        or 0
    )


async def _matched_items(db: AsyncSession, want_id: str) -> set[uuid.UUID]:
    result = await db.execute(
        select(WantMatch.item_id).where(WantMatch.want_id == uuid.UUID(want_id))
    )
    return set(result.scalars().all())


class _PgError(Exception):
    def __init__(self, sqlstate: str) -> None:
        super().__init__("canceling statement")
        self.sqlstate = sqlstate


def _failing_match(sqlstate: str) -> Any:
    async def match_want(*args: Any, **kwargs: Any) -> Any:
        raise OperationalError("INSERT", {}, _PgError(sqlstate))

    return match_want


async def test_createWant_matchingItems_returns201WithSeenMatchesAndNoNotification(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner = await _Owner.create(client, "wa.create.o@example.com")
    token, seeker = await _register(client, "GUEST", "wa.create.s@example.com")
    categories = {
        str(row["id"]): row
        for row in (await client.get("/api/categories", headers=_auth(token))).json()
    }
    leaf = next(
        category_id
        for category_id in await leaf_category_ids(client, _auth(token), n=100)
        if categories[category_id]["parent_id"]
    )
    path = [categories[leaf]["name"]]
    parent_id = categories[leaf]["parent_id"]
    while parent_id:
        path.insert(0, categories[str(parent_id)]["name"])
        parent_id = categories[str(parent_id)]["parent_id"]
    first = await owner.lists("Hulajnoga miejska", category_id=leaf)
    second = await owner.lists("Hulajnoga dla dzieci", category_id=leaf)
    await owner.lists("Wrotki", category_id=leaf)

    response = await client.post(
        "/api/wants",
        json={
            "name": "  hulajnoga ",
            "note": " dla syna ",
            "category_id": leaf,
            "offer_mode": "GIFT",
            "locality_id": KETY,
            "radius_km": 10,
        },
        headers=_auth(token),
    )

    assert response.status_code == 201, response.text
    want = response.json()
    assert set(want) == WANT_KEYS
    assert want["name"] == "hulajnoga"
    assert want["note"] == "dla syna"
    assert want["category_id"] == leaf
    assert want["category_name"] == categories[leaf]["name"]
    assert want["category_path"] == " › ".join(path)
    assert len(path) >= 2
    assert want["offer_mode"] == "GIFT"
    assert want["locality_id"] == KETY
    assert want["locality_name"] == await db_session.scalar(
        select(Locality.name).where(Locality.id == KETY)
    )
    assert want["radius_km"] == 10
    assert want["notifications_enabled"] is True
    assert want["status"] == "ACTIVE"
    assert want["closed_at"] is None
    assert (want["match_count"], want["new_match_count"]) == (2, 0)

    matches = (
        await db_session.execute(
            select(WantMatch.item_id, WantMatch.source, WantMatch.seen_at).where(
                WantMatch.want_id == uuid.UUID(want["id"])
            )
        )
    ).all()
    assert {match.item_id for match in matches} == {first, second}
    assert all(
        match.source == WantMatchSource.FORWARD and match.seen_at is not None for match in matches
    )
    notifications = await db_session.scalar(
        select(func.count()).select_from(Notification).where(Notification.party_id == seeker)
    )
    assert notifications == 0

    fetched = await client.get(f"/api/wants/{want['id']}", headers=_auth(token))
    listed = await client.get("/api/wants", headers=_auth(token))
    assert fetched.status_code == 200, fetched.text
    assert fetched.json() == want
    assert listed.json() == [want]


async def test_createAndPatchWant_invalidInput_returns400_radiusZeroAndClearedLocalityStoreNull(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token, seeker = await _register(client, "GUEST", "wa.valid.s@example.com")
    rejected: list[tuple[dict[str, Any], str]] = [
        ({"name": " ab "}, "Nazwa musi mieć od 3 do 80 znaków."),
        ({"name": "x" * 81}, "Nazwa musi mieć od 3 do 80 znaków."),
        ({"name": "-- --"}, "Nazwa musi zawierać literę lub cyfrę."),
        ({"name": "rower", "note": "x" * 301}, "Notatka może mieć najwyżej 300 znaków."),
        ({"name": "rower", "radius_km": 10}, "Promień można ustawić tylko razem z miejscowością."),
        (
            {"name": "rower", "locality_id": KETY, "radius_km": 101},
            "Promień musi mieć od 1 do 100 km.",
        ),
        ({"name": "rower", "category_id": str(uuid.uuid4())}, "Wybrana kategoria nie istnieje."),
        ({"name": "rower", "locality_id": "0000000"}, "Wybrana miejscowość nie istnieje."),
        ({"name": "rower", "color": "red"}, "Validation failed"),
        ({"name": "rower", "offer_mode": "LEND"}, "Validation failed"),
        ({"note": "bez nazwy"}, "Validation failed"),
    ]

    for body, message in rejected:
        response = await client.post("/api/wants", json=body, headers=_auth(token))

        assert response.status_code == 400, (body, response.text)
        assert response.json()["message"] == message
    assert await _want_count(db_session, seeker) == 0

    want = await _create_want(client, token, "rower", locality_id=KETY, radius_km=0)
    assert want["radius_km"] is None
    assert (want["category_id"], want["category_name"], want["category_path"]) == (None, None, None)
    assert (want["note"], want["offer_mode"]) == (None, None)

    url = f"/api/wants/{want['id']}"
    widened = await client.patch(url, json={"radius_km": 25}, headers=_auth(token))
    cleared = await client.patch(url, json={"locality_id": None}, headers=_auth(token))
    radius_alone = await client.patch(url, json={"radius_km": 5}, headers=_auth(token))
    no_name = await client.patch(url, json={"name": None}, headers=_auth(token))
    unknown_field = await client.patch(url, json={"status": "FULFILLED"}, headers=_auth(token))

    assert widened.status_code == 200, widened.text
    assert widened.json()["radius_km"] == 25
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["locality_id"] is None
    assert cleared.json()["locality_name"] is None
    assert cleared.json()["radius_km"] is None
    assert radius_alone.status_code == 400, radius_alone.text
    assert radius_alone.json()["message"] == "Promień można ustawić tylko razem z miejscowością."
    assert no_name.status_code == 400, no_name.text
    assert no_name.json()["message"] == "Nazwa musi mieć od 3 do 80 znaków."
    assert unknown_field.status_code == 400, unknown_field.text
    assert unknown_field.json()["message"] == "Validation failed"


async def test_wantTexts_contactDetailsOrClassifier_return400Or503BeforeAnyStatement(
    client: AsyncClient,
    db_session: AsyncSession,
    engine: AsyncEngine,
    _text_moderation_on: None,
) -> None:
    token, seeker = await _register(client, "GUEST", "wa.text.s@example.com")
    text_guard.set_classifier(FakeTextClassifier())

    with count_queries(engine) as contact_statements:
        contact_in_name = await client.post(
            "/api/wants", json={"name": "rower jan@example.com"}, headers=_auth(token)
        )
        contact_in_note = await client.post(
            "/api/wants",
            json={"name": "rower", "note": "pisz na jan@example.com"},
            headers=_auth(token),
        )
    text_guard.set_classifier(FakeTextClassifier(sex=0.99))
    with count_queries(engine) as classifier_statements:
        refused = await client.post("/api/wants", json={"name": "rower"}, headers=_auth(token))
    text_guard.set_classifier(FakeTextClassifier(fail=True))
    with count_queries(engine) as outage_statements:
        outage = await client.post("/api/wants", json={"name": "rower"}, headers=_auth(token))

    for response in (contact_in_name, contact_in_note):
        assert response.status_code == 400, response.text
        assert response.json()["message"] == CONTACT_INFO_MESSAGE
    assert refused.status_code == 400, refused.text
    assert refused.json()["message"] == (
        "Nazwa poszukiwania narusza zasady społeczności. Zmień ją i spróbuj ponownie."
    )
    assert outage.status_code == 503, outage.text
    assert outage.json()["message"] == "Moderacja jest chwilowo niedostępna — spróbuj za chwilę."
    assert contact_statements == classifier_statements == outage_statements == []
    assert await _want_count(db_session, seeker) == 0

    text_guard.set_classifier(FakeTextClassifier())
    want = await _create_want(client, token, "rower", note="miejski")
    url = f"/api/wants/{want['id']}"
    text_guard.set_classifier(FakeTextClassifier(sex=0.99))
    refused_note = await client.patch(url, json={"note": "inna notatka"}, headers=_auth(token))
    contact_note = await client.patch(url, json={"note": "jan@example.com"}, headers=_auth(token))
    unchanged_texts = await client.patch(
        url, json={"name": "rower", "notifications_enabled": False}, headers=_auth(token)
    )

    assert refused_note.status_code == 400, refused_note.text
    assert refused_note.json()["message"] == (
        "Notatka narusza zasady społeczności. Zmień ją i spróbuj ponownie."
    )
    assert contact_note.status_code == 400, contact_note.text
    assert contact_note.json()["message"] == CONTACT_INFO_MESSAGE
    assert unchanged_texts.status_code == 200, unchanged_texts.text
    assert unchanged_texts.json()["note"] == "miejski"
    assert unchanged_texts.json()["notifications_enabled"] is False


async def test_createWant_thirtyActiveWants_returns409AndWritesNothing(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token, seeker = await _register(client, "GUEST", "wa.cap.s@example.com")
    seeded = await _seed_wants(db_session, seeker, MAX_ACTIVE_WANTS)

    over_the_cap = await client.post("/api/wants", json={"name": "rower"}, headers=_auth(token))

    assert over_the_cap.status_code == 409, over_the_cap.text
    assert over_the_cap.json()["message"] == CAP_MESSAGE
    assert await _want_count(db_session, seeker) == MAX_ACTIVE_WANTS

    closed = await client.post(
        f"/api/wants/{seeded[0]}/close", json={"outcome": "FULFILLED"}, headers=_auth(token)
    )
    assert closed.status_code == 200, closed.text
    await _create_want(client, token, "rower")


async def test_forwardMatch_statementTimeout_returns503AndSavesNothing(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    token, seeker = await _register(client, "GUEST", "wa.timeout.s@example.com")
    want = await _create_want(client, token, "rower")

    with monkeypatch.context() as patched:
        patched.setattr(matcher, "match_want", _failing_match("57014"))
        created = await client.post("/api/wants", json={"name": "sanki"}, headers=_auth(token))
        renamed = await client.patch(
            f"/api/wants/{want['id']}", json={"name": "narty"}, headers=_auth(token)
        )

    for response in (created, renamed):
        assert response.status_code == 503, response.text
        assert response.json()["message"] == TIMEOUT_MESSAGE
    assert await _want_count(db_session, seeker) == 1
    kept = await client.get(f"/api/wants/{want['id']}", headers=_auth(token))
    assert kept.json()["name"] == "rower"

    # too_many_connections: not mapped, so it propagates unchanged.
    monkeypatch.setattr(matcher, "match_want", _failing_match("53300"))
    with pytest.raises(OperationalError):
        await client.post("/api/wants", json={"name": "sanki"}, headers=_auth(token))


@pytest.mark.parametrize("sqlstate", ["40P01", "40001"])
async def test_forwardMatch_deadlockOrSerializationFailure_returns409TryAgainAndSavesNothing(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    sqlstate: str,
) -> None:
    token, seeker = await _register(client, "GUEST", f"wa.deadlock.{sqlstate}@example.com")
    want = await _create_want(client, token, "rower")

    with monkeypatch.context() as patched:
        patched.setattr(matcher, "match_want", _failing_match(sqlstate))
        created = await client.post("/api/wants", json={"name": "sanki"}, headers=_auth(token))
        renamed = await client.patch(
            f"/api/wants/{want['id']}", json={"name": "narty"}, headers=_auth(token)
        )

    for response in (created, renamed):
        assert response.status_code == 409, response.text
        assert response.json()["message"] == TRY_AGAIN_MESSAGE
    assert await _want_count(db_session, seeker) == 1
    kept = await client.get(f"/api/wants/{want['id']}", headers=_auth(token))
    assert kept.json()["name"] == "rower"


async def test_wantRoutes_foreignWithdrawnOrUnknownWant_return404_editOfClosedWant409(
    client: AsyncClient,
) -> None:
    token, _ = await _register(client, "GUEST", "wa.404.s@example.com")
    stranger, _ = await _register(client, "GUEST", "wa.404.x@example.com")
    foreign = await _create_want(client, token, "rower")
    withdrawn = await _create_want(client, token, "sanki")
    fulfilled = await _create_want(client, token, "narty")
    for want, outcome in ((withdrawn, "WITHDRAWN"), (fulfilled, "FULFILLED")):
        closed = await client.post(
            f"/api/wants/{want['id']}/close", json={"outcome": outcome}, headers=_auth(token)
        )
        assert closed.status_code == 200, closed.text
        assert closed.json()["status"] == outcome

    async def responses(want_id: str, caller: str) -> list[Any]:
        url = f"/api/wants/{want_id}"
        headers = _auth(caller)
        return [
            await client.get(url, headers=headers),
            await client.patch(url, json={"note": "x"}, headers=headers),
            await client.post(f"{url}/extend", headers=headers),
            await client.post(f"{url}/close", json={"outcome": "FULFILLED"}, headers=headers),
            await client.post(f"{url}/resume", headers=headers),
        ]

    hidden = [
        *await responses(foreign["id"], stranger),
        *await responses(withdrawn["id"], token),
        *await responses(str(uuid.uuid4()), token),
    ]
    for response in hidden:
        assert response.status_code == 404, (response.request.url, response.text)
        assert response.json()["message"] == NOT_FOUND_MESSAGE

    listed = await client.get("/api/wants", headers=_auth(token))
    assert [want["id"] for want in listed.json()] == [foreign["id"], fulfilled["id"]]
    assert (await client.get("/api/wants", headers=_auth(stranger))).json() == []

    edit_of_closed = await client.patch(
        f"/api/wants/{fulfilled['id']}", json={"note": "x"}, headers=_auth(token)
    )
    assert edit_of_closed.status_code == 409, edit_of_closed.text
    assert edit_of_closed.json()["message"] == (
        "To poszukiwanie nie jest aktywne. Wznów je, aby je edytować."
    )


async def test_patchWant_noteOrSwitchKeepsMatches_matchingFieldResetsThemAndTheUnreadBellRow(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner = await _Owner.create(client, "wa.patch.o@example.com")
    token, seeker = await _register(client, "GUEST", "wa.patch.s@example.com")
    sledge = await owner.lists("Sanki drewniane")
    skis = await owner.lists("Narty zjazdowe")
    want = await _create_want(client, token, "sanki")
    want_id = uuid.UUID(want["id"])
    url = f"/api/wants/{want['id']}"
    bell_row = Notification(
        party_id=seeker,
        kind=NotificationKind.WANT_MATCH_FOUND,
        message="Szukasz: «sanki». 3 nowe pasujące rzeczy.",
        link_path=f"/wanted/{want['id']}",
    )
    db_session.add(bell_row)
    stored = await db_session.get(Want, want_id)
    assert stored is not None
    stored.match_notification_id = bell_row.id
    stored.match_notification_count = 3
    await db_session.execute(
        update(WantMatch).where(WantMatch.want_id == want_id).values(seen_at=None)
    )
    await db_session.commit()

    async def bell_state() -> tuple[uuid.UUID | None, int, int]:
        pointer, count = (
            await db_session.execute(
                select(Want.match_notification_id, Want.match_notification_count).where(
                    Want.id == want_id
                )
            )
        ).one()
        rows = await db_session.scalar(
            select(func.count()).select_from(Notification).where(Notification.party_id == seeker)
        )
        return pointer, count, rows or 0

    for body in ({"note": "dla dzieci"}, {"notifications_enabled": False}, {"name": " sanki "}):
        kept = await client.patch(url, json=body, headers=_auth(token))

        assert kept.status_code == 200, kept.text
        assert (kept.json()["match_count"], kept.json()["new_match_count"]) == (1, 1)
        assert await _matched_items(db_session, want["id"]) == {sledge}
        assert await bell_state() == (bell_row.id, 3, 1)

    renamed = await client.patch(url, json={"name": "narty"}, headers=_auth(token))

    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["name"] == "narty"
    assert renamed.json()["note"] == "dla dzieci"
    assert (renamed.json()["match_count"], renamed.json()["new_match_count"]) == (1, 0)
    assert await _matched_items(db_session, want["id"]) == {skis}
    assert await bell_state() == (None, 0, 0)

    narrowed = await client.patch(url, json={"offer_mode": "SWAP"}, headers=_auth(token))

    assert narrowed.status_code == 200, narrowed.text
    assert narrowed.json()["match_count"] == 0
    assert await _matched_items(db_session, want["id"]) == set()


async def test_createAndListWants_moreMatchesAndWants_sameStatementCount(
    client: AsyncClient, engine: AsyncEngine
) -> None:
    owner = await _Owner.create(client, "wa.count.o@example.com")
    token, _ = await _register(client, "GUEST", "wa.count.s@example.com")
    (leaf,) = await leaf_category_ids(client, _auth(token))
    await owner.lists("Sanki drewniane")
    for name in ("Narty zjazdowe", "Narty biegowe", "Narty dla dzieci"):
        await owner.lists(name)
    await _create_want(client, token, "wrotki")

    with count_queries(engine) as create_one_match:
        one_match = await _create_want(client, token, "sanki", category_id=leaf, locality_id=KETY)
    with count_queries(engine) as list_one:
        await client.get("/api/wants", headers=_auth(token))
    with count_queries(engine) as create_three_matches:
        three_matches = await _create_want(
            client, token, "narty", category_id=leaf, locality_id=KETY
        )
    await _create_want(client, token, "narty")
    with count_queries(engine) as list_several:
        listed = await client.get("/api/wants", headers=_auth(token))

    assert (one_match["match_count"], three_matches["match_count"]) == (1, 3)
    assert [want["match_count"] for want in listed.json()] == [3, 3, 1, 0]
    assert len(create_three_matches) == len(create_one_match)
    assert len(list_several) == len(list_one)
