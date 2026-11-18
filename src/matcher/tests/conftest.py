"""Shared fixtures for the matcher suite.

Session-scoped: a `pgvector/pgvector:0.8.7-pg18-trixie` testcontainer
migrated with the backend's own `alembic upgrade head` (run from
`src/backend`, whose `script_location` is cwd-relative), and an asyncpg pool
on it. Function-scoped `db`: the same pool with the seeded tables truncated
first, because the loop tests need committed data seen across connections
(no rollback-per-test as in the backend).

The seed helpers write raw SQL and set every NOT NULL column without a default.
"""

from __future__ import annotations

import itertools
import json
import os
import subprocess
import sys
import uuid
from collections.abc import AsyncIterator, Iterator
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

import asyncpg
import pytest
from testcontainers.community.postgres import PostgresContainer

from matcher import clock, statements
from matcher import db as matcher_db
from matcher.settings import Settings, load

BACKEND_ROOT = Path(__file__).resolve().parents[2] / "backend"

Db = asyncpg.Pool | asyncpg.Connection

_TRUNCATED = (
    "want_embeddings",
    "product_embeddings",
    "want_matches",
    "want_scan_markers",
    "wants",
    "outbox_entries",
    "notifications",
    "swap_proposals",
    "reservations",
    "item_listing_preferences",
    "inventory_balances",
    "inventory_items",
    "inventories",
    "products",
    "locations",
    "memberships",
    "leaderships",
    "group_roles",
    "groups",
    "user_profiles",
    "users",
    "parties",
)
_TEST_CATEGORY_MARK = "matcher-test"
_TEST_LOCALITY_PREFIX = "T"
_locality_ids = itertools.count(1)


@pytest.fixture(scope="session")
def postgres_container() -> Iterator[PostgresContainer]:
    with PostgresContainer("pgvector/pgvector:0.8.7-pg18-trixie") as container:
        yield container


@pytest.fixture(scope="session")
def database_url(postgres_container: PostgresContainer) -> str:
    """The URL in the backend's form (`postgresql+asyncpg://`), as compose
    passes it; the backend migrations run against it once."""
    url = postgres_container.get_connection_url().replace(
        "postgresql+psycopg2://", "postgresql+asyncpg://"
    )
    env = os.environ.copy()
    env["DATABASE_URL"] = url
    subprocess.run(
        [sys.executable, "-m", "alembic", "-c", "alembic.ini", "upgrade", "head"],
        cwd=str(BACKEND_ROOT),
        env=env,
        check=True,
        capture_output=True,
    )
    return url


@pytest.fixture(scope="session")
def settings(database_url: str) -> Settings:
    return load({"DATABASE_URL": database_url})


@pytest.fixture(scope="session")
async def _session_pool(settings: Settings) -> AsyncIterator[asyncpg.Pool]:
    pool = await asyncpg.create_pool(settings.dsn, min_size=1, max_size=10)
    try:
        yield pool
    finally:
        await pool.close()


@pytest.fixture
async def db(_session_pool: asyncpg.Pool) -> asyncpg.Pool:
    """The session pool over emptied tables (seeded dev users included)."""
    async with _session_pool.acquire() as connection, connection.transaction():
        await connection.execute(f"TRUNCATE {', '.join(_TRUNCATED)} CASCADE")
        await connection.execute(
            "DELETE FROM localities WHERE id LIKE $1", f"{_TEST_LOCALITY_PREFIX}%"
        )
        while await connection.fetchval(
            """
            WITH leaves AS (
                DELETE FROM categories c
                WHERE c.description = $1
                  AND NOT EXISTS (SELECT 1 FROM categories k WHERE k.parent_id = c.id)
                RETURNING 1
            )
            SELECT count(*) FROM leaves
            """,
            _TEST_CATEGORY_MARK,
        ):
            pass
    return _session_pool


# --- seed helpers -------------------------------------------------------------


@dataclass(frozen=True)
class Person:
    party_id: uuid.UUID
    user_id: uuid.UUID
    inventory_id: uuid.UUID


async def locality(db: Db, name: str, *, lat: float | None = None, lng: float | None = None) -> str:
    """A new locality (id `T000001`…), removed again by the `db` fixture."""
    locality_id = f"{_TEST_LOCALITY_PREFIX}{next(_locality_ids):06d}"
    await db.execute(
        """
        INSERT INTO localities (id, name, name_search, kind, gmina, powiat, voivodeship, lat, lng)
        VALUES ($1, $2::text, fold_pl($2::text), 'TOWN', 'test', 'test', 'test', $3, $4)
        """,
        locality_id,
        name,
        lat,
        lng,
    )
    return locality_id


async def person(db: Db, name: str = "Osoba") -> Person:
    """A PERSON party with a login, a profile and a PERSONAL inventory."""
    now = clock.utcnow()
    party_id = await db.fetchval(
        "INSERT INTO parties (party_type, active, created_at, updated_at)"
        " VALUES ('PERSON', true, $1, $1) RETURNING id",
        now,
    )
    user_id = await db.fetchval(
        "INSERT INTO users (username, password_hash, created_at, updated_at)"
        " VALUES ($1, 'x', $2, $2) RETURNING id",
        f"{uuid.uuid4().hex}@example.com",
        now,
    )
    await db.execute(
        "INSERT INTO user_profiles (party_id, account_user_id, display_name,"
        " created_at, updated_at)"
        " VALUES ($1, $2, $3, $4, $4)",
        party_id,
        user_id,
        name,
        now,
    )
    inventory_id = await db.fetchval(
        "INSERT INTO inventories (owner_user_id, inventory_type, created_at, updated_at)"
        " VALUES ($1, 'PERSONAL', $2, $2) RETURNING id",
        user_id,
        now,
    )
    return Person(party_id=party_id, user_id=user_id, inventory_id=inventory_id)


async def location(db: Db, owner_party_id: uuid.UUID, locality_id: str) -> uuid.UUID:
    """A saved place without an address."""
    now = clock.utcnow()
    location_id: uuid.UUID = await db.fetchval(
        "INSERT INTO locations (owner_party_id, locality_id, created_at, updated_at)"
        " VALUES ($1, $2, $3, $3) RETURNING id",
        owner_party_id,
        locality_id,
        now,
    )
    return location_id


async def group(
    db: Db, owner_party_id: uuid.UUID, *, visibility: str = "PRIVATE", name: str = "Krąg"
) -> uuid.UUID:
    now = clock.utcnow()
    group_id: uuid.UUID = await db.fetchval(
        "INSERT INTO groups (party_id, name, visibility, created_at, updated_at)"
        " VALUES ($1, $2, $3, $4, $4) RETURNING id",
        owner_party_id,
        name,
        visibility,
        now,
    )
    return group_id


async def join_group(
    db: Db,
    party_id: uuid.UUID,
    group_id: uuid.UUID,
    *,
    organizer: bool = False,
    ended: bool = False,
) -> None:
    """A MEMBER role + membership, or with `organizer` an ORGANIZATOR role +
    leadership; `ended` closes the link (`valid_to` set)."""
    now = clock.utcnow()
    today = now.date()
    role_id = await db.fetchval(
        "INSERT INTO group_roles (party_id, role_type, valid_from, created_at, updated_at)"
        " VALUES ($1, $2, $3, $4, $4) RETURNING id",
        party_id,
        "ORGANIZATOR" if organizer else "MEMBER",
        today,
        now,
    )
    table = "leaderships" if organizer else "memberships"
    valid_to: date | None = today if ended else None
    await db.execute(
        f"INSERT INTO {table} (from_role_id, to_group_id, valid_from, valid_to,"
        " created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $5)",
        role_id,
        group_id,
        today,
        valid_to,
        now,
    )


async def category(db: Db, name: str, parent_id: uuid.UUID | None = None) -> uuid.UUID:
    """A new category (unique name per call), removed again by the `db` fixture."""
    now = clock.utcnow()
    category_id: uuid.UUID = await db.fetchval(
        "INSERT INTO categories (name, description, sort_order, parent_id, created_at, updated_at)"
        " VALUES ($1, $2, 0, $3, $4, $4) RETURNING id",
        f"{name} {uuid.uuid4().hex[:8]}",
        _TEST_CATEGORY_MARK,
        parent_id,
        now,
    )
    return category_id


async def product(
    db: Db, name: str, category_id: uuid.UUID, *, description: str | None = None
) -> uuid.UUID:
    now = clock.utcnow()
    product_id: uuid.UUID = await db.fetchval(
        "INSERT INTO products (name, description, sku, category_id, created_at, updated_at)"
        " VALUES ($1, $2, $3, $4, $5, $5) RETURNING id",
        name,
        description,
        uuid.uuid4().hex,
        category_id,
        now,
    )
    return product_id


async def item(
    db: Db,
    owner: Person,
    product_id: uuid.UUID,
    location_id: uuid.UUID,
    *,
    mode: str = "GIFT",
    visibility: str = "PUBLIC",
    balance: str = "AVAILABLE",
    listed_at: datetime | None = None,
) -> uuid.UUID:
    """A listed item: ACTIVE inventory item + balance + listing preference,
    all written at `listed_at` (default now), so the view's `changed_at`,
    the time the window loop reads, is the listing time."""
    now = listed_at or clock.utcnow()
    item_id: uuid.UUID = await db.fetchval(
        """
        INSERT INTO inventory_items (inventory_id, product_id, condition, added_at,
            listing_status, location_id, created_at, updated_at)
        VALUES ($1, $2, 'GOOD', $3, 'ACTIVE', $4, $3, $3) RETURNING id
        """,
        owner.inventory_id,
        product_id,
        now,
        location_id,
    )
    await db.execute(
        "INSERT INTO inventory_balances (item_id, status, created_at, updated_at)"
        " VALUES ($1, $2, $3, $3)",
        item_id,
        balance,
        now,
    )
    await db.execute(
        "INSERT INTO item_listing_preferences (item_id, owner_party_id, mode, visibility,"
        " created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $5)",
        item_id,
        owner.party_id,
        mode,
        visibility,
        now,
    )
    return item_id


async def want(
    db: Db,
    seeker_party_id: uuid.UUID,
    name: str,
    *,
    status: str = "ACTIVE",
    expires_at: datetime | None = None,
    category_id: uuid.UUID | None = None,
    offer_mode: str | None = None,
    locality_id: str | None = None,
    radius_km: int | None = None,
    notifications_enabled: bool = True,
    match_requested_at: datetime | None = None,
) -> uuid.UUID:
    """A want written as the backend does (generated columns computed by the
    DB). A non-null `match_requested_at` fires the `wants_changed` NOTIFY."""
    now = clock.utcnow()
    want_id: uuid.UUID = await db.fetchval(
        """
        INSERT INTO wants (seeker_party_id, name, category_id, offer_mode, locality_id,
            radius_km, notifications_enabled, status, expires_at, closed_at,
            match_requested_at, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12) RETURNING id
        """,
        seeker_party_id,
        name,
        category_id,
        offer_mode,
        locality_id,
        radius_km,
        notifications_enabled,
        status,
        expires_at or now + timedelta(days=90),
        None if status == "ACTIVE" else now,
        match_requested_at,
        now,
    )
    return want_id


# --- matching fixtures ----------------------------------------------------------


@dataclass(frozen=True)
class Owner:
    """A party that lists items: a person with one place and one category."""

    person: Person
    location_id: uuid.UUID
    category_id: uuid.UUID

    @property
    def party_id(self) -> uuid.UUID:
        return self.person.party_id


async def owner(db: Db, *, locality_id: str | None = None) -> Owner:
    """A lister with a place in `locality_id` (a new pointless locality if
    omitted) and a fresh category."""
    lister = await person(db, "Właściciel")
    place_locality = locality_id or await locality(db, "Miejscowość")
    return Owner(
        person=lister,
        location_id=await location(db, lister.party_id, place_locality),
        category_id=await category(db, "Kategoria"),
    )


async def lists(
    db: Db,
    lister: Owner,
    name: str,
    *,
    description: str | None = None,
    category_id: uuid.UUID | None = None,
    location_id: uuid.UUID | None = None,
    mode: str = "GIFT",
    visibility: str = "PUBLIC",
    balance: str = "AVAILABLE",
    listed_at: datetime | None = None,
) -> uuid.UUID:
    """A new product named `name` listed by `lister`; returns the item id."""
    product_id = await product(db, name, category_id or lister.category_id, description=description)
    return await item(
        db,
        lister.person,
        product_id,
        location_id or lister.location_id,
        mode=mode,
        visibility=visibility,
        balance=balance,
        listed_at=listed_at,
    )


async def stored(db: Db, want_id: uuid.UUID) -> dict[uuid.UUID, asyncpg.Record]:
    """The want's `want_matches` rows by item id."""
    rows = await db.fetch("SELECT * FROM want_matches WHERE want_id = $1", want_id)
    return {row["item_id"]: row for row in rows}


async def update_want(db: Db, want_id: uuid.UUID, **columns: object) -> None:
    """Sets `columns` of one want as given (test names only, never input)."""
    assignments = ", ".join(f"{name} = ${n}" for n, name in enumerate(columns, start=2))
    await db.execute(f"UPDATE wants SET {assignments} WHERE id = $1", want_id, *columns.values())


async def bells_due(db: Db) -> list[dict[str, list[Any]]]:
    """The `wants.bells_due` outbox payloads in insertion order."""
    rows = await db.fetch(
        "SELECT payload FROM outbox_entries WHERE event_type = 'wants.bells_due'"
        " ORDER BY created_at, id"
    )
    return [json.loads(row["payload"]) for row in rows]


async def match_forward(
    pool: asyncpg.Pool, want_id: uuid.UUID, *, now: datetime
) -> list[statements.StoredPair]:
    """`statements.match_forward` on a pooled connection, committed."""
    async with matcher_db.acquire(pool) as connection:
        return await statements.match_forward(connection, want_id, now=now)


async def match_window(
    pool: asyncpg.Pool, *, listed_after: datetime, now: datetime
) -> list[statements.StoredPair]:
    """`statements.match_window` on a pooled connection, committed."""
    async with matcher_db.acquire(pool) as connection:
        return await statements.match_window(connection, listed_after=listed_after, now=now)
