"""Search database layer, migrations 0086–0096: `pg_trgm`, `fold_pl()`, the
generated `search_vector` columns, `categories.path_text` and the GIN,
trigram and counterparty indexes. The round-trip test downgrades the shared session
database to 0085 and always upgrades it back to head."""

from __future__ import annotations

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from app.category.models import Category
from app.events.models import Event
from app.groups.models import Term
from app.locations.localities import fold_polish
from app.product.models import Product
from tests.test_organization_page_layout_migration import _alembic

SEARCH_INDEXES = (
    "ix_products_search_vector",
    "ix_events_search_vector",
    "ix_terms_search_vector",
    "ix_products_name_trgm",
    "ix_events_name_trgm",
    "ix_groups_name_trgm",
    "ix_organizations_name_trgm",
    "ix_categories_path_text_trgm",
    "ix_reservations_reserved_by_user_id_status",
    "ix_reservations_giver_user_id_status",
    "ix_swap_proposals_proposer_party_id_status",
    "ix_groups_description_trgm",
    "ix_organizations_slug_trgm",
)

FOLD_SAMPLE = (
    "Łódź",
    "  ZAŻÓŁĆ   GĘŚLĄ\tJAŹŃ ",
    "ąćęłńóśźż ĄĆĘŁŃÓŚŹŻ",
    "Ubranka\ndla  dzieci",
    "Kurtka zimowa 104 cm",
    "",
)


async def _schema_state(engine: AsyncEngine) -> dict[str, object]:
    async with engine.connect() as conn:
        fold_pl = (
            await conn.execute(text("SELECT count(*) FROM pg_proc WHERE proname = 'fold_pl'"))
        ).scalar_one()
        trgm = (
            await conn.execute(text("SELECT count(*) FROM pg_extension WHERE extname = 'pg_trgm'"))
        ).scalar_one()
        columns = (
            (
                await conn.execute(
                    text(
                        "SELECT table_name || '.' || column_name FROM information_schema.columns "
                        "WHERE column_name IN ('search_vector', 'path_text') ORDER BY 1"
                    )
                )
            )
            .scalars()
            .all()
        )
        indexes = (
            await conn.execute(
                text("SELECT count(*) FROM pg_class WHERE relname = ANY(:names)"),
                {"names": list(SEARCH_INDEXES)},
            )
        ).scalar_one()
    return {"fold_pl": fold_pl, "pg_trgm": trgm, "columns": list(columns), "indexes": indexes}


async def test_migrations0086to0096_downgradeUpgrade_roundTrip(
    engine: AsyncEngine, database_url: str
) -> None:
    try:
        _alembic(database_url, "downgrade", "0085")
        await engine.dispose()
        assert await _schema_state(engine) == {
            "fold_pl": 0,
            "pg_trgm": 0,
            "columns": [],
            "indexes": 0,
        }
    finally:
        _alembic(database_url, "upgrade", "head")
        await engine.dispose()

    assert await _schema_state(engine) == {
        "fold_pl": 1,
        "pg_trgm": 1,
        "columns": [
            "categories.path_text",
            "events.search_vector",
            "products.search_vector",
            "terms.search_vector",
        ],
        "indexes": len(SEARCH_INDEXES),
    }


@pytest.mark.parametrize("sample", FOLD_SAMPLE)
async def test_foldPl_polishSample_matchesFoldPolish(db_session: AsyncSession, sample: str) -> None:
    folded = (await db_session.execute(text("SELECT fold_pl(:s)"), {"s": sample})).scalar_one()

    assert folded == fold_polish(sample)


async def test_productsSearchVector_nameAndDescription_weightedAAndC(
    db_session: AsyncSession,
) -> None:
    category = Category(name="Kategoria Wektora", description=None, sort_order=1001)
    db_session.add(category)
    await db_session.flush()

    vector = (
        await db_session.execute(
            text(
                "INSERT INTO products (id, name, description, sku, category_id, "
                "created_at, updated_at) VALUES (gen_random_uuid(), 'Łódzka KURTKA', "
                "'Ciepła  zimowa', 'SKU-SEARCH-VEC', :category_id, now(), now()) "
                "RETURNING search_vector::text"
            ),
            {"category_id": category.id},
        )
    ).scalar_one()

    assert vector == "'ciepla':3C 'kurtka':2A 'lodzka':1A 'zimowa':4C"


@pytest.mark.parametrize("entity", [Product, Event, Term])
def test_searchVector_plainEntitySelect_isDeferred(entity: type) -> None:
    compiled = str(select(entity))

    assert "search_vector" not in compiled
    assert "search_vector" in entity.__table__.c


async def test_searchIndexes_afterUpgrade_existAndValid(db_session: AsyncSession) -> None:
    rows = (
        await db_session.execute(
            text(
                "SELECT c.relname, i.indisvalid FROM pg_index i "
                "JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname = ANY(:names)"
            ),
            {"names": list(SEARCH_INDEXES)},
        )
    ).all()

    assert dict(rows) == {name: True for name in SEARCH_INDEXES}
