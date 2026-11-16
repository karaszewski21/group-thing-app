"""Seeds the disposable measurement database (FR-T-30) through Core bulk
inserts: `--items` listed items and `--wants` ACTIVE wants, replacing any
earlier seed.

    uv run python measurement_db.py run seed_measurement.py --items 20000 --wants 10000

Run from `src/backend` while `measurement_db.py serve` holds the database.
Prints row counts only."""

from __future__ import annotations

import argparse
import asyncio
import random
import sys
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).parent))

from measurement_db import MARKER_TABLE, claim_for_measurement, disposable_engine  # noqa: E402
from polish_names import THINGS, product_name, want_name  # noqa: E402
from sqlalchemy import column, insert, table, text  # noqa: E402
from sqlalchemy.ext.asyncio import AsyncConnection  # noqa: E402

from app.wants.application.text_queries import short_words_query  # noqa: E402
from app.wants.domain.status import WantStatus  # noqa: E402
from app.wants.models import Want  # noqa: E402

SEEDED_TABLES = (
    "want_matches",
    "wants",
    "item_listing_preferences",
    "inventory_balances",
    "inventory_items",
    "products",
    "locations",
    "inventories",
    "parties",
)
# `users` also holds the accounts the migrations seed, so it is not truncated.
SEEDED_USERNAME = "measure-owner-"
ITEMS_PER_OWNER = 10
WANTS_PER_SEEKER = 2
NEWEST_WINDOW = 500
CHUNK = 5000


def _table(name: str, *columns: str) -> Any:
    return table(name, *(column(c) for c in columns))


PARTIES = _table("parties", "id", "party_type", "active", "created_at", "updated_at")
USERS = _table("users", "id", "username", "password_hash", "created_at", "updated_at")
INVENTORIES = _table(
    "inventories", "id", "owner_user_id", "inventory_type", "created_at", "updated_at"
)
LOCATIONS = _table("locations", "id", "owner_party_id", "locality_id", "created_at", "updated_at")
PRODUCTS = _table("products", "id", "name", "sku", "category_id", "created_at", "updated_at")
ITEMS = _table(
    "inventory_items",
    "id",
    "inventory_id",
    "product_id",
    "condition",
    "added_at",
    "created_at",
    "updated_at",
    "listing_status",
    "location_id",
)
BALANCES = _table("inventory_balances", "id", "item_id", "status", "created_at", "updated_at")
PREFERENCES = _table(
    "item_listing_preferences",
    "id",
    "item_id",
    "owner_party_id",
    "mode",
    "visibility",
    "created_at",
    "updated_at",
)


async def _bulk(connection: AsyncConnection, target: Any, rows: list[dict[str, Any]]) -> None:
    for start in range(0, len(rows), CHUNK):
        await connection.execute(insert(target), rows[start : start + CHUNK])


async def _categories(
    connection: AsyncConnection, rng: random.Random
) -> dict[str, list[tuple[uuid.UUID, list[uuid.UUID]]]]:
    """Per kind of object, three leaf categories, each with its ancestors."""
    parent_of = dict((await connection.execute(text("SELECT id, parent_id FROM categories"))).all())
    parents = set(parent_of.values())
    leaves = sorted((c for c in parent_of if c not in parents), key=str)

    def ancestors(category_id: uuid.UUID) -> list[uuid.UUID]:
        chain = []
        while (category_id := parent_of[category_id]) is not None:
            chain.append(category_id)
        return chain

    return {
        thing.key: [(leaf, ancestors(leaf)) for leaf in rng.sample(leaves, 3)] for thing in THINGS
    }


async def _localities(connection: AsyncConnection, rng: random.Random) -> tuple[list[str], list[str]]:
    """`(towns, villages)` that have a point: 150 towns and 600 villages."""
    rows = (
        await connection.execute(
            text("SELECT id, kind FROM localities WHERE lat IS NOT NULL ORDER BY id")
        )
    ).all()
    towns = [row.id for row in rows if row.kind == "TOWN"]
    villages = [row.id for row in rows if row.kind == "VILLAGE"]
    return rng.sample(towns, 150), rng.sample(villages, 600)


def _locality(rng: random.Random, towns: list[str], villages: list[str]) -> str:
    """Three quarters in a town, most of those in one of thirty larger ones."""
    if rng.random() < 0.75:
        return rng.choice(towns[:30]) if rng.random() < 0.6 else rng.choice(towns)
    return rng.choice(villages)


async def seed(connection: AsyncConnection, items: int, wants: int) -> None:
    rng = random.Random(20261115)
    now = datetime.now(UTC).replace(tzinfo=None)
    await connection.execute(text(f"TRUNCATE {', '.join(SEEDED_TABLES)} CASCADE"))
    await connection.execute(
        text("DELETE FROM users WHERE username LIKE :prefix"), {"prefix": f"{SEEDED_USERNAME}%"}
    )
    categories = await _categories(connection, rng)
    towns, villages = await _localities(connection, rng)

    def stamped(**values: Any) -> dict[str, Any]:
        return {"id": uuid.uuid4(), "created_at": now, "updated_at": now, **values}

    owners = [stamped(party_type="PERSON", active=True) for _ in range(items // ITEMS_PER_OWNER)]
    seekers = [stamped(party_type="PERSON", active=True) for _ in range(wants // WANTS_PER_SEEKER)]
    users = [
        # Not a credential: no login can match this value.
        stamped(username=f"{SEEDED_USERNAME}{number}", password_hash="-")
        for number in range(len(owners))
    ]
    inventories = [stamped(owner_user_id=user["id"], inventory_type="PERSONAL") for user in users]
    locations = [
        stamped(owner_party_id=owner["id"], locality_id=_locality(rng, towns, villages))
        for owner in owners
    ]
    await _bulk(connection, PARTIES, owners + seekers)
    await _bulk(connection, USERS, users)
    await _bulk(connection, INVENTORIES, inventories)
    await _bulk(connection, LOCATIONS, locations)

    products, item_rows, balances, preferences = [], [], [], []
    for number in range(items):
        thing = rng.choice(THINGS)
        owner = rng.randrange(len(owners))
        # The newest `NEWEST_WINDOW` listings are one second apart, the rest
        # spread over 120 days before them.
        listed_at = now - timedelta(seconds=60 + number)
        if number >= NEWEST_WINDOW:
            listed_at = now - timedelta(seconds=rng.uniform(3600, 120 * 86400))
        product = stamped(
            name=product_name(rng, thing),
            sku=f"MEASURE-{number}",
            category_id=rng.choice(categories[thing.key])[0],
        )
        item = stamped(
            inventory_id=inventories[owner]["id"],
            product_id=product["id"],
            condition=rng.choice(("NEW", "LIKE_NEW", "GOOD", "GOOD", "FAIR")),
            added_at=listed_at,
            listing_status="ACTIVE",
            location_id=locations[owner]["id"],
        )
        products.append(product)
        item_rows.append(item)
        balances.append(
            stamped(item_id=item["id"], status="AVAILABLE" if rng.random() < 0.95 else "RESERVED")
        )
        preferences.append(
            {
                "id": uuid.uuid4(),
                "item_id": item["id"],
                "owner_party_id": owners[owner]["id"],
                "mode": "GIFT" if rng.random() < 0.7 else "SWAP",
                "visibility": "PUBLIC" if rng.random() < 0.97 else "PRIVATE",
                "created_at": listed_at,
                "updated_at": listed_at,
            }
        )
    await _bulk(connection, PRODUCTS, products)
    await _bulk(connection, ITEMS, item_rows)
    await _bulk(connection, BALANCES, balances)
    await _bulk(connection, PREFERENCES, preferences)

    for number in range(wants):
        thing = rng.choice(THINGS)
        name = want_name(rng, thing)
        leaf, ancestors = rng.choice(categories[thing.key])
        with_locality = number % 3 == 0
        mode_roll = rng.random()
        await connection.execute(
            insert(Want).values(
                id=uuid.uuid4(),
                created_at=now,
                updated_at=now,
                seeker_party_id=seekers[number // WANTS_PER_SEEKER]["id"],
                name=name,
                short_words_query=short_words_query(name),
                # Half with a category: the leaf or one of its ancestors.
                category_id=rng.choice([leaf, *ancestors]) if number % 2 == 0 else None,
                offer_mode=None if mode_roll < 0.6 else ("GIFT" if mode_roll < 0.85 else "SWAP"),
                # A third with a locality, half of those with a radius.
                locality_id=_locality(rng, towns, villages) if with_locality else None,
                radius_km=rng.choice((5, 10, 20, 30, 50)) if with_locality and number % 2 else None,
                status=WantStatus.ACTIVE,
                expires_at=now + timedelta(days=rng.uniform(1, 30)),
            )
        )
    await connection.execute(text(f"INSERT INTO {MARKER_TABLE} VALUES (:now)"), {"now": now})


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--items", type=int, required=True)
    parser.add_argument("--wants", type=int, required=True)
    arguments = parser.parse_args()
    engine = disposable_engine()
    async with engine.begin() as connection:
        await claim_for_measurement(connection)
        await seed(connection, arguments.items, arguments.wants)
    # As autovacuum leaves a table that has settled: statistics, visibility
    # map and an empty GIN pending list.
    async with engine.connect() as connection:
        autocommit = await connection.execution_options(isolation_level="AUTOCOMMIT")
        for name in (*SEEDED_TABLES, "users"):
            await autocommit.execute(text(f"VACUUM (ANALYZE) {name}"))
        counts = (
            await autocommit.execute(
                text(
                    "SELECT (SELECT count(*) FROM item_listing_preferences), "
                    "(SELECT count(*) FROM wants), "
                    "(SELECT count(*) FROM wants WHERE category_id IS NOT NULL), "
                    "(SELECT count(*) FROM wants WHERE locality_id IS NOT NULL), "
                    "(SELECT count(*) FROM wants WHERE short_words_query IS NOT NULL), "
                    "(SELECT count(DISTINCT name) FROM products)"
                )
            )
        ).one()
    await engine.dispose()
    print(
        "seeded: listed items {}, wants {} (with category {}, with locality {}, "
        "with short words {}), distinct product names {}".format(*counts)
    )


if __name__ == "__main__":
    asyncio.run(main())
