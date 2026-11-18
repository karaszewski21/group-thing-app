"""Seeds the disposable measurement database through `COPY` (asyncpg):
`--items` listed items, `--wants` ACTIVE wants, `--groups` PRIVATE groups
of owners and seekers and `--stored` already stored MATCH pairs per want
(the anti-join against `want_matches` is planned on a filled table),
replacing any earlier seed. The generated want
columns (`name_folded`, `stem_query`, `stem_words`, …) and the products'
`search_vector` are computed by the database, as in production.

    cd src/matcher
    uv run --system-certs python M/measurement_db.py run seed_measurement.py --items 20000 --wants 10000

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

import asyncpg

sys.path.insert(0, str(Path(__file__).parent))

from measurement_db import MARKER_TABLE, claim_for_measurement, disposable_dsn  # noqa: E402
from polish_names import THINGS, product_name, want_name  # noqa: E402

SEEDED_TABLES = (
    "outbox_entries",
    "notifications",
    "want_scan_markers",
    "want_matches",
    "wants",
    "memberships",
    "leaderships",
    "group_roles",
    "groups",
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
MEMBERS_PER_GROUP = 20
NEWEST_WINDOW = 500


async def _copy(connection: asyncpg.Connection, table: str, rows: list[dict[str, Any]]) -> None:
    if rows:
        columns = list(rows[0])
        await connection.copy_records_to_table(
            table, records=[tuple(row[c] for c in columns) for row in rows], columns=columns
        )


async def _categories(
    connection: asyncpg.Connection, rng: random.Random
) -> dict[str, list[tuple[uuid.UUID, list[uuid.UUID]]]]:
    """Per kind of object, three leaf categories, each with its ancestors."""
    parent_of = {
        row["id"]: row["parent_id"]
        for row in await connection.fetch("SELECT id, parent_id FROM categories")
    }
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


async def _localities(
    connection: asyncpg.Connection, rng: random.Random
) -> tuple[list[str], list[str]]:
    """`(towns, villages)` that have a point: 150 towns and 600 villages."""
    rows = await connection.fetch(
        "SELECT id, kind FROM localities WHERE lat IS NOT NULL ORDER BY id"
    )
    towns = [row["id"] for row in rows if row["kind"] == "TOWN"]
    villages = [row["id"] for row in rows if row["kind"] == "VILLAGE"]
    return rng.sample(towns, 150), rng.sample(villages, 600)


def _locality(rng: random.Random, towns: list[str], villages: list[str]) -> str:
    """Three quarters in a town, most of those in one of thirty larger ones."""
    if rng.random() < 0.75:
        return rng.choice(towns[:30]) if rng.random() < 0.6 else rng.choice(towns)
    return rng.choice(villages)


async def seed(
    connection: asyncpg.Connection, items: int, wants: int, groups: int, stored: int
) -> None:
    rng = random.Random(20261117)
    now = datetime.now(UTC).replace(tzinfo=None)
    await connection.execute(f"TRUNCATE {', '.join(SEEDED_TABLES)} CASCADE")
    await connection.execute("DELETE FROM users WHERE username LIKE $1", f"{SEEDED_USERNAME}%")
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
    await _copy(connection, "parties", owners + seekers)
    await _copy(connection, "users", users)
    await _copy(connection, "inventories", inventories)
    await _copy(connection, "locations", locations)

    # PRIVATE groups mixing owners and seekers, so the PRIVATE branch of the
    # visibility check has real memberships to read.
    group_rows, roles, memberships, leaderships = [], [], [], []
    today = now.date()
    for number in range(groups):
        organizer = rng.choice(owners)
        group = stamped(party_id=organizer["id"], name=f"Krąg {number}", visibility="PRIVATE")
        group_rows.append(group)
        lead_role = stamped(party_id=organizer["id"], role_type="ORGANIZATOR", valid_from=today)
        roles.append(lead_role)
        leaderships.append(
            stamped(from_role_id=lead_role["id"], to_group_id=group["id"], valid_from=today)
        )
        members = rng.sample(owners, MEMBERS_PER_GROUP // 2) + rng.sample(
            seekers, MEMBERS_PER_GROUP // 2
        )
        for member in members:
            role = stamped(party_id=member["id"], role_type="MEMBER", valid_from=today)
            roles.append(role)
            memberships.append(
                stamped(from_role_id=role["id"], to_group_id=group["id"], valid_from=today)
            )
    await _copy(connection, "groups", group_rows)
    await _copy(connection, "group_roles", roles)
    await _copy(connection, "leaderships", leaderships)
    await _copy(connection, "memberships", memberships)

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
    await _copy(connection, "products", products)
    await _copy(connection, "inventory_items", item_rows)
    await _copy(connection, "inventory_balances", balances)
    await _copy(connection, "item_listing_preferences", preferences)

    want_rows = []
    for number in range(wants):
        thing = rng.choice(THINGS)
        leaf, ancestors = rng.choice(categories[thing.key])
        with_locality = number % 3 == 0
        mode_roll = rng.random()
        want_rows.append(
            stamped(
                seeker_party_id=seekers[number // WANTS_PER_SEEKER]["id"],
                name=want_name(rng, thing),
                # Half with a category: the leaf or one of its ancestors.
                category_id=rng.choice([leaf, *ancestors]) if number % 2 == 0 else None,
                offer_mode=None if mode_roll < 0.6 else ("GIFT" if mode_roll < 0.85 else "SWAP"),
                # A third with a locality, half of those with a radius.
                locality_id=_locality(rng, towns, villages) if with_locality else None,
                radius_km=rng.choice((5, 10, 20, 30, 50)) if with_locality and number % 2 else None,
                status="ACTIVE",
                expires_at=now + timedelta(days=rng.uniform(1, 90)),
            )
        )
    await _copy(connection, "wants", want_rows)
    # Older listings only, so the window of the newest listings stays unmatched.
    older = [item["id"] for item in item_rows[NEWEST_WINDOW:]]
    await _copy(
        connection,
        "want_matches",
        [
            stamped(
                want_id=want["id"],
                item_id=item_id,
                source="FORWARD",
                score=round(rng.uniform(0.3, 1.0), 3),
                seen_at=now,
                tier="MATCH",
            )
            for want in want_rows
            for item_id in rng.sample(older, stored)
        ],
    )
    await connection.execute(f"INSERT INTO {MARKER_TABLE} VALUES ($1)", now)


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--items", type=int, required=True)
    parser.add_argument("--wants", type=int, required=True)
    parser.add_argument("--groups", type=int, default=300)
    parser.add_argument("--stored", type=int, default=15)
    arguments = parser.parse_args()
    connection = await asyncpg.connect(disposable_dsn())
    try:
        async with connection.transaction():
            await claim_for_measurement(connection)
            await seed(
                connection, arguments.items, arguments.wants, arguments.groups, arguments.stored
            )
        # As autovacuum leaves a table that has settled: statistics, visibility
        # map and an empty GIN pending list.
        for name in (*SEEDED_TABLES, "users"):
            await connection.execute(f"VACUUM (ANALYZE) {name}")
        counts = await connection.fetchrow(
            "SELECT (SELECT count(*) FROM item_listing_preferences),"
            " (SELECT count(*) FROM matchable_listings),"
            " (SELECT count(*) FROM wants),"
            " (SELECT count(*) FROM wants WHERE category_id IS NOT NULL),"
            " (SELECT count(*) FROM wants WHERE locality_id IS NOT NULL),"
            " (SELECT count(*) FROM wants WHERE cardinality(stem_words) >= 3),"
            " (SELECT count(*) FROM memberships),"
            " (SELECT count(*) FROM want_matches),"
            " (SELECT count(DISTINCT name) FROM products)"
        )
    finally:
        await connection.close()
    print(
        "seeded: listed items {}, matchable {}, wants {} (with category {}, with locality {}, "
        "with 3+ words {}), memberships {}, stored pairs {}, distinct product names {}".format(*counts)
    )


if __name__ == "__main__":
    asyncio.run(main())
