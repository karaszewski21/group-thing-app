"""One-time cleanup at the moderation cutover: withdraws the term listings
of every item whose product already has a PENDING or NEEDS_REVIEW photo
(listed before the publish gate existed). Not an Alembic data migration — schema migrations
stay schema-only.

Run from the backend root (`/app` in the image):
    python -m scripts.withdraw_unmoderated_listings

Idempotent: each product is handled in its own short transaction that
re-checks the photos under FOR SHARE (skipping a product approved meanwhile),
and a second run finds nothing left to withdraw. A failing product is rolled
back and logged (id and full traceback) without stopping the run; the script
then exits with status 1 so the operator notices. Rerun it after fixing."""

from __future__ import annotations

import asyncio
import logging
from typing import NamedTuple

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.groups.application import term_item_listings
from app.groups.infrastructure import product_bridge

logger = logging.getLogger(__name__)


class WithdrawCounts(NamedTuple):
    withdrawn: int
    failed: int


async def run(session_factory: async_sessionmaker[AsyncSession]) -> WithdrawCounts:
    """Withdraws listings product by product. A product that fails is rolled
    back, logged and counted, and the run goes on with the next one."""
    async with session_factory() as db:
        product_ids = await product_bridge.list_product_ids_with_unmoderated_photos(db)
    logger.info("Found %d products with unmoderated photos", len(product_ids))

    withdrawn = failed = 0
    for product_id in product_ids:
        async with session_factory() as db:
            try:
                if not await product_bridge.has_unmoderated_photos(db, product_id):
                    logger.info("Skipped product %s: photos moderated meanwhile", product_id)
                    continue
                await term_item_listings.withdraw_product_listings(db, product_id)
                await db.commit()
            except Exception:
                await db.rollback()
                failed += 1
                logger.exception("Failed to withdraw listings of product %s", product_id)
                continue
        withdrawn += 1
        logger.info("Withdrew listings of product %s", product_id)

    logger.info("Done: withdrew listings of %d products, %d failed", withdrawn, failed)
    return WithdrawCounts(withdrawn=withdrawn, failed=failed)


def main() -> None:
    from app.db import async_session_factory

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    counts = asyncio.run(run(async_session_factory))
    if counts.failed > 0:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
