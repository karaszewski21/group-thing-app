"""Shared pytest fixtures for the backend test suite.

Session-scoped: a real Postgres container (`testcontainers`) with `alembic
upgrade head` run against it once. Function-scoped: `db_session` wraps each
test in an outer transaction + `SAVEPOINT` (rolled back after the test, per
`standards/testing/backend-testing.md`'s "each test creates its own data,
no shared fixtures between tests" principle, adapted from Java's
`@Transactional` rollback to async SQLAlchemy via `join_transaction_mode=
"create_savepoint"`), and `client` wraps the ASGI app with `get_db`
overridden to yield that same session so requests made in a test see
exactly the data that test created.
"""

from __future__ import annotations

import os
import subprocess
import sys
import uuid
from collections.abc import AsyncGenerator, Callable, Collection, Generator, Iterator
from contextlib import contextmanager
from datetime import datetime, timedelta
from pathlib import Path
from typing import TYPE_CHECKING, Any

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import event
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from testcontainers.postgres import PostgresContainer

from tests.fake_storage import FakeStorage

if TYPE_CHECKING:
    from app.wants.domain.status import WantStatus

BACKEND_ROOT = Path(__file__).resolve().parent.parent

# Env vars beat `.env`, so a developer's local `MODERATION_TEXT_ENABLED=true`
# cannot leak into the suite. Set before any test module imports `app.config`;
# moderation tests opt in by monkeypatching `settings.moderation_text_enabled`.
os.environ["MODERATION_TEXT_ENABLED"] = "false"


def _to_asyncpg_url(sync_url: str) -> str:
    """`testcontainers` hands back a `psycopg2`-driver URL; both the app and
    Alembic's async `env.py` need the `asyncpg` driver instead."""
    return sync_url.replace("postgresql+psycopg2://", "postgresql+asyncpg://")


@pytest.fixture(scope="session")
def postgres_container() -> Generator[PostgresContainer, None, None]:
    with PostgresContainer("postgres:18") as container:
        yield container


@pytest.fixture(scope="session")
def database_url(postgres_container: PostgresContainer) -> str:
    url = _to_asyncpg_url(postgres_container.get_connection_url())
    env = os.environ.copy()
    env["DATABASE_URL"] = url
    subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=str(BACKEND_ROOT),
        env=env,
        check=True,
    )
    return url


@pytest.fixture(scope="session")
def engine(database_url: str) -> Generator[AsyncEngine, None, None]:
    yield create_async_engine(database_url, pool_pre_ping=True)


_SAVEPOINT_PREFIXES = ("SAVEPOINT", "RELEASE", "ROLLBACK TO")


@contextmanager
def count_queries(engine: AsyncEngine) -> Iterator[list[str]]:
    """Collects the SQL statements run on `engine` inside the block, skipping
    the `db_session` fixture's own savepoint bookkeeping, so query-budget
    tests count only what the code under test issues."""
    statements: list[str] = []

    def _collect(_conn: Any, _cursor: Any, statement: str, *_args: Any) -> None:
        if not statement.lstrip().upper().startswith(_SAVEPOINT_PREFIXES):
            statements.append(statement)

    event.listen(engine.sync_engine, "before_cursor_execute", _collect)
    try:
        yield statements
    finally:
        event.remove(engine.sync_engine, "before_cursor_execute", _collect)


@pytest.fixture
async def db_session(engine: AsyncEngine) -> AsyncGenerator[AsyncSession, None]:
    connection = await engine.connect()
    outer_transaction = await connection.begin()
    session_factory = async_sessionmaker(
        bind=connection,
        expire_on_commit=False,
        join_transaction_mode="create_savepoint",
    )
    session = session_factory()

    try:
        yield session
    finally:
        await session.close()
        await outer_transaction.rollback()
        await connection.close()


@pytest.fixture
def freeze_local_now(monkeypatch: pytest.MonkeyPatch) -> Callable[[datetime], None]:
    """Opt-in: `freeze(dt)` makes `clock.local_now()` return the naive
    Warsaw datetime `dt` for every call site that uses `clock.local_now()`."""
    from app.core import clock

    def _freeze(dt: datetime) -> None:
        monkeypatch.setattr(clock, "local_now", lambda: dt)

    return _freeze


@pytest.fixture(autouse=True)
def reset_join_code_limiter() -> Iterator[None]:
    """The join-code limiter is a module-level singleton; isolate each test."""
    from app.groups.application.join_code_limiter import limiter

    limiter.reset()
    yield
    limiter.reset()


@pytest.fixture(autouse=True)
def reset_message_limiter() -> Iterator[None]:
    """The messaging limiter is a module-level singleton; isolate each test."""
    from app.messaging.application.send_limiter import limiter

    limiter.reset()
    yield
    limiter.reset()


async def leaf_category_ids(client: AsyncClient, headers: dict[str, str], n: int = 1) -> list[str]:
    """The ids of the first `n` categories without children, in `GET
    /api/categories` order. Products may only point at leaves. Asks the API
    on every call: migration round trips across `0069` re-seed the tree with
    new UUIDs, so the ids must never be cached."""
    response = await client.get("/api/categories", headers=headers)
    assert response.status_code == 200, response.text
    categories = response.json()
    parent_ids = {category["parent_id"] for category in categories}
    leaves = [str(category["id"]) for category in categories if category["id"] not in parent_ids]
    assert len(leaves) >= n, f"need {n} leaf categories, found {len(leaves)}"
    return leaves[:n]


async def locality_ids(client: AsyncClient, headers: dict[str, str], n: int = 1) -> list[str]:
    """The ids of the first `n` (at most 20) localities `GET /api/localities`
    returns for "nowa". Asks the API on every call, as `leaf_category_ids`:
    never cache the ids at module or session scope."""
    response = await client.get(
        "/api/localities", params={"q": "nowa", "limit": 20}, headers=headers
    )
    assert response.status_code == 200, response.text
    ids = [str(row["id"]) for row in response.json()["results"]]
    assert len(ids) >= n, f"need {n} localities, found {len(ids)}"
    return ids[:n]


async def create_location(
    client: AsyncClient, headers: dict[str, str], *, address: str | None = None
) -> str:
    """A new saved place of the caller: a locality from `locality_ids`, plus
    a MANUAL address when `address` is given. Returns the place id."""
    body: dict[str, Any] = {"locality_id": (await locality_ids(client, headers))[0]}
    if address is not None:
        body |= {"formatted_address": address, "source": "MANUAL"}
    response = await client.post("/api/locations", json=body, headers=headers)
    assert response.status_code == 201, response.text
    return str(response.json()["id"])


async def seed_legacy_guest(
    db_session: AsyncSession,
    name: str,
    *,
    term_id: str | uuid.UUID | None = None,
    event_id: str | uuid.UUID | None = None,
    child_count: int = 0,
) -> uuid.UUID:
    """An account-less party + profile signed up for a term or an event, as the
    removed guest sign-up left them: no endpoint creates these any more, but
    the rows remain and every reader must still handle them. Commits and
    returns the party id."""
    from app.events.models import EventAttendance
    from app.groups.models import TermAttendance
    from app.party.models import PartyType
    from app.party.service import create_party
    from app.users.models import UserProfile

    party = await create_party(db_session, PartyType.PERSON)
    party_id = uuid.UUID(str(party.id))
    db_session.add(
        UserProfile(party_id=party_id, account_user_id=None, display_name=name, email=None)
    )
    if term_id is not None:
        db_session.add(
            TermAttendance(
                term_id=uuid.UUID(str(term_id)), party_id=party_id, child_count=child_count
            )
        )
    if event_id is not None:
        db_session.add(EventAttendance(event_id=uuid.UUID(str(event_id)), party_id=party_id))
    await db_session.commit()
    return party_id


@pytest.fixture
def fake_storage() -> FakeStorage:
    return FakeStorage()


@pytest.fixture
async def client(
    db_session: AsyncSession, fake_storage: FakeStorage
) -> AsyncGenerator[AsyncClient, None]:
    from app.db import get_db
    from app.main import app
    from app.storage.service import get_storage

    async def _override_get_db() -> AsyncGenerator[AsyncSession, None]:
        yield db_session

    app.dependency_overrides[get_db] = _override_get_db
    app.dependency_overrides[get_storage] = lambda: fake_storage
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as async_client:
            yield async_client
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(get_storage, None)


async def _product(
    client: AsyncClient, token: str, name: str, category_id: str | None = None
) -> str:
    """The id of the catalogue product `name`, in a leaf category unless
    `category_id` is given."""
    from tests.test_term_item_listings import _auth

    response = await client.post(
        "/api/products/resolve",
        json={
            "name": name,
            "category_id": category_id or (await leaf_category_ids(client, _auth(token)))[0],
        },
        headers=_auth(token),
    )
    assert response.status_code == 200, response.text
    return str(response.json()["id"])


class _Owner:
    """A registered party with one inventory and one place in Kęty, listing
    items for the wants tests."""

    def __init__(self, client: AsyncClient, token: str, inventory_id: str, place_id: str) -> None:
        self._client = client
        self.token = token
        self._inventory_id = inventory_id
        self.place_id = place_id

    @classmethod
    async def create(cls, client: AsyncClient, email: str) -> _Owner:
        from tests.test_search_location import KETY, _inventory, _place
        from tests.test_term_item_listings import _register

        token, _ = await _register(client, "GUEST", email)
        return cls(
            client, token, await _inventory(client, token), await _place(client, token, KETY)
        )

    async def lists(
        self,
        name: str,
        *,
        mode: str = "GIFT",
        category_id: str | None = None,
        locality_id: str | None = None,
    ) -> uuid.UUID:
        from tests.test_search_location import _place

        place_id = (
            await _place(self._client, self.token, locality_id) if locality_id else self.place_id
        )
        product_id = await _product(self._client, self.token, name, category_id)
        return await self.lists_product(product_id, place_id=place_id, mode=mode)

    async def lists_product(
        self, product_id: str, *, place_id: str | None = None, mode: str = "GIFT"
    ) -> uuid.UUID:
        """A new item of `product_id`, listed with `mode`."""
        from tests.test_term_item_listings import _auth

        headers = _auth(self.token)
        item = await self._client.post(
            "/api/inventory-items",
            json={
                "inventory_id": self._inventory_id,
                "product_id": product_id,
                "condition": "GOOD",
                "location_id": place_id or self.place_id,
            },
            headers=headers,
        )
        assert item.status_code == 201, item.text
        item_id = item.json()["id"]
        preference = await self._client.put(
            f"/api/item-listing-preferences/{item_id}", json={"mode": mode}, headers=headers
        )
        assert preference.status_code == 200, preference.text
        return uuid.UUID(item_id)


async def _want(
    db: AsyncSession,
    seeker: uuid.UUID,
    name: str,
    *,
    status: WantStatus | None = None,
    expires_in: timedelta | None = None,
    **fields: Any,
) -> uuid.UUID:
    """A want inserted through the ORM and committed, ACTIVE for the whole
    validity period unless told otherwise."""
    from app.wants.domain.limits import VALIDITY
    from app.wants.domain.status import WantStatus
    from app.wants.models import Want

    status = status or WantStatus.ACTIVE
    now = datetime.utcnow()
    want = Want(
        seeker_party_id=seeker,
        name=name,
        status=status,
        expires_at=now + (expires_in if expires_in is not None else VALIDITY),
        closed_at=None if status == WantStatus.ACTIVE else now,
        **fields,
    )
    db.add(want)
    await db.commit()
    return uuid.UUID(str(want.id))


async def seed_want_matches(
    db: AsyncSession,
    want_id: str | uuid.UUID,
    item_ids: Collection[uuid.UUID],
    *,
    missing_words: list[str] | None = None,
    seen: bool = True,
    score: float = 0.5,
) -> None:
    """Stored pairs as the matcher service writes them, committed: MATCH
    pairs, or SUGGESTION pairs when `missing_words` is given. FORWARD pairs
    are born seen; `seen=False` stores them as new."""
    from app.wants.domain.status import WantMatchSource
    from app.wants.models import WantMatch, WantMatchTier

    now = datetime.utcnow()
    db.add_all(
        WantMatch(
            want_id=uuid.UUID(str(want_id)),
            item_id=item_id,
            source=WantMatchSource.FORWARD if seen else WantMatchSource.SCAN,
            score=score,
            seen_at=now if seen else None,
            tier=WantMatchTier.MATCH if missing_words is None else WantMatchTier.SUGGESTION,
            missing_words=missing_words,
        )
        for item_id in item_ids
    )
    await db.commit()
