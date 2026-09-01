"""Async audit-persistence background task.

Replaces the Java `@Async` + `@TransactionalEventListener(AFTER_COMMIT)` +
`@Retryable` stack: Group 12's route handler schedules `persist_audit(...)`
via FastAPI `BackgroundTasks.add_task(...)` at the end of the request (the
footprint calculation path performs no DB writes itself, so "after
response" is equivalent to "after commit" here). `dry_run` requests are
never scheduled at all — that precondition is enforced at Group 12's call
site, not in here; this module has no HTTP awareness and no opinion on
`dry_run` beyond faithfully persisting whatever `FootprintRequest` it is
given (in practice, always non-dry-run).

Each attempt opens its **own new** `AsyncSession` (~= `REQUIRES_NEW`),
independent of any request-scoped session. Retry policy (`tenacity`)
mirrors the Java `@Retryable`/`@Backoff` SpEL defaults
(`app.footprint.audit.retry.{max-attempts:3, delay-ms:200, multiplier:2.0}`),
configurable via `Settings.footprint_audit_retry_*`:

    attempt 1 fails -> wait `delay_ms`        (0.2s by default)
    attempt 2 fails -> wait `delay_ms * multiplier`  (0.4s by default)
    attempt 3 fails -> give up

Note on `tenacity.wait_exponential`'s parameter names: its `multiplier`
argument is the *base* wait (what the Java config calls `delay-ms`) and its
`exp_base` argument (default `2`) is the *growth factor* (what the Java
config calls `multiplier`) — `wait_exponential(multiplier=delay_s,
exp_base=growth_multiplier)` is what actually reproduces the documented
~0.2s/~0.4s backoff; passing the Java field names positionally into
tenacity's identically-spelled-but-differently-meaning parameters would
instead produce ~2s/~4s waits. See the verification script (task 11.1) for
a timed confirmation of the intended sequence.
"""

from __future__ import annotations

import logging

from sqlalchemy.exc import IntegrityError
from tenacity import retry, retry_if_not_exception_type, stop_after_attempt, wait_exponential

from app.config import settings
from app.db import async_session_factory
from app.footprint.audit.mapper import to_entity
from app.footprint.domain.breakdown import FootprintBreakdown
from app.footprint.facade import FootprintRequest

logger = logging.getLogger(__name__)

# In-process counter analogous to Micrometer's `footprint.audit.failed`.
# Incremented once per `persist_audit` call that exhausts all retry
# attempts without succeeding (idempotent duplicates do NOT count as a
# failure). Module-level and process-local by design (spec.md does not
# call for cross-process/metrics-backend aggregation).
footprint_audit_failed = 0


class _IdempotentDuplicate(Exception):
    """Internal sentinel: `_write_once` raises this when it hits the
    unique-`correlation_id` constraint, so the retry wrapper can recognize
    "already persisted" and stop immediately (no retry) without it being
    mistaken for a genuine failure by the outer error handling."""


@retry(
    stop=stop_after_attempt(settings.footprint_audit_retry_max_attempts),
    wait=wait_exponential(
        multiplier=settings.footprint_audit_retry_delay_ms / 1000,
        exp_base=settings.footprint_audit_retry_multiplier,
        min=settings.footprint_audit_retry_delay_ms / 1000,
    ),
    retry=retry_if_not_exception_type(_IdempotentDuplicate),
    reraise=True,
)
async def _write_once(breakdown: FootprintBreakdown, request: FootprintRequest) -> None:
    """One persistence attempt in a brand-new session. Builds a fresh
    entity each attempt (rather than reusing one across retries) so a
    failed attempt's session teardown can never leave the mapped object in
    an inconsistent attached/expired state for the next attempt."""
    entity = to_entity(breakdown, request)
    async with async_session_factory() as session:
        session.add(entity)
        try:
            await session.commit()
        except IntegrityError:
            await session.rollback()
            logger.debug(
                "Duplicate footprint audit correlation_id=%s — treating as idempotent success",
                entity.correlation_id,
            )
            raise _IdempotentDuplicate from None
        except Exception:
            await session.rollback()
            raise


async def persist_audit(breakdown: FootprintBreakdown, request: FootprintRequest) -> None:
    """Persists one audit row for a computed (non-dry-run) breakdown.
    Idempotent on `correlation_id`: calling this twice with the same
    correlation id never raises. On non-idempotent failure exhausting all
    retry attempts, logs at error and increments `footprint_audit_failed`
    — the failure is swallowed here, not re-raised, since this runs as a
    fire-and-forget `BackgroundTasks` job with no caller left to catch it.
    """
    global footprint_audit_failed
    try:
        await _write_once(breakdown, request)
    except _IdempotentDuplicate:
        return
    except Exception:
        logger.error(
            "Footprint audit persistence failed after %d attempts (correlation_id=%s)",
            settings.footprint_audit_retry_max_attempts,
            breakdown.correlation_id,
            exc_info=True,
        )
        footprint_audit_failed += 1
