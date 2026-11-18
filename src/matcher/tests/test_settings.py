"""`DATABASE_URL` handling (driver suffix stripped, never logged) and the
test harness itself (backend migrations applied, seed helpers visible
through the contract views)."""

import logging

import asyncpg
import pytest

from matcher import db as matcher_db
from matcher.settings import Settings, load, to_asyncpg_dsn
from tests import conftest

_SECRET_URL = "postgresql+asyncpg://aj:s3cr3t-pass@db.internal:5432/aj"


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        (_SECRET_URL, "postgresql://aj:s3cr3t-pass@db.internal:5432/aj"),
        ("postgresql://aj:x@h/aj", "postgresql://aj:x@h/aj"),
        ("postgres+asyncpg://aj:x@h/aj", "postgres://aj:x@h/aj"),
    ],
)
def test_toAsyncpgDsn_driverSuffix_stripped(url: str, expected: str) -> None:
    assert to_asyncpg_dsn(url) == expected


def test_load_secretUrl_neverInLogsOrRepr(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.DEBUG)

    settings = load({"DATABASE_URL": _SECRET_URL})

    assert settings.dsn.startswith("postgresql://")
    assert "s3cr3t-pass" not in repr(settings)
    assert all("s3cr3t-pass" not in record.getMessage() for record in caplog.records)


def test_load_missingUrl_raisesWithoutValue() -> None:
    with pytest.raises(RuntimeError, match="DATABASE_URL is not set"):
        load({})


async def test_harness_migratedHead_contractViewsExist(settings: Settings) -> None:
    connection = await matcher_db.connect(settings)
    try:
        regclasses = await connection.fetchrow(
            "SELECT to_regclass('public.matchable_listings') AS listings,"
            " to_regclass('public.private_group_peers') AS peers,"
            " (SELECT version_num FROM alembic_version) AS version"
        )
    finally:
        await connection.close()

    assert regclasses is not None
    assert regclasses["listings"] is not None
    assert regclasses["peers"] is not None
    assert int(regclasses["version"]) >= 99


async def test_seedHelpers_listedItemAndPrivatePeers_visibleThroughContract(
    db: asyncpg.Pool,
) -> None:
    owner = await conftest.person(db, "Właściciel")
    seeker = await conftest.person(db, "Szukający")
    town = await conftest.locality(db, "Testowo", lat=49.88, lng=19.22)
    leaf = await conftest.category(db, "Kurtki")
    item_id = await conftest.item(
        db,
        owner,
        await conftest.product(db, "Kurtka zimowa", leaf),
        await conftest.location(db, owner.party_id, town),
        visibility="PRIVATE",
    )
    circle = await conftest.group(db, owner.party_id)
    await conftest.join_group(db, owner.party_id, circle, organizer=True)
    await conftest.join_group(db, seeker.party_id, circle)
    want_id = await conftest.want(db, seeker.party_id, "kurtka zimowa")

    listing = await db.fetchrow(
        "SELECT owner_party_id, visibility, locality_id, category_path"
        " FROM matchable_listings WHERE item_id = $1",
        item_id,
    )
    peers = await db.fetchval(
        "SELECT count(*) FROM private_group_peers WHERE party_id = $1 AND peer_party_id = $2",
        owner.party_id,
        seeker.party_id,
    )
    stem_words = await db.fetchval("SELECT stem_words FROM wants WHERE id = $1", want_id)

    assert listing is not None
    assert (listing["owner_party_id"], listing["visibility"], listing["locality_id"]) == (
        owner.party_id,
        "PRIVATE",
        town,
    )
    assert leaf in listing["category_path"]
    assert peers == 1
    assert len(stem_words) == 2


async def test_db_fixture_truncatesBetweenTests(db: asyncpg.Pool) -> None:
    assert await db.fetchval("SELECT count(*) FROM wants") == 0
    assert await db.fetchval("SELECT count(*) FROM localities WHERE id LIKE 'T%'") == 0
