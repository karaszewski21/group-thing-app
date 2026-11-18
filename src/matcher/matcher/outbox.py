"""`wants.bells_due` outbox rows for the backend's handler (L8):

    {"pairs": [["<want_id>", "<item_id>"], ...], "expiring": ["<want_id>", ...]}

At most `PAIRS_PER_ROW` pairs per row, the expiring wants in the first row
only. The insert sets every NOT NULL column (L2)."""

import json
import uuid
from collections.abc import Sequence

import asyncpg

EVENT_TYPE = "wants.bells_due"
# The handler's contract, as `storage.objects_delete` takes ≤1000 keys.
PAIRS_PER_ROW = 1000

INSERT = """
INSERT INTO outbox_entries (id, created_at, updated_at, event_type, payload, status, attempts)
VALUES (gen_random_uuid(), timezone('UTC', clock_timestamp()), timezone('UTC', clock_timestamp()),
        $1, CAST($2 AS jsonb), 'PENDING', 0)
"""


async def stage_bells_due(
    connection: asyncpg.Connection,
    *,
    pairs: Sequence[tuple[uuid.UUID, uuid.UUID]],
    expiring: Sequence[uuid.UUID],
) -> int:
    """Inserts the rows in the caller's transaction and returns how many;
    none without pairs or expiring wants."""
    if not pairs and not expiring:
        return 0
    chunks = [pairs[n : n + PAIRS_PER_ROW] for n in range(0, len(pairs), PAIRS_PER_ROW)] or [[]]
    payloads = [
        json.dumps(
            {
                "pairs": [[str(want_id), str(item_id)] for want_id, item_id in chunk],
                "expiring": [str(want_id) for want_id in expiring] if n == 0 else [],
            }
        )
        for n, chunk in enumerate(chunks)
    ]
    await connection.executemany(INSERT, [(EVENT_TYPE, payload) for payload in payloads])
    return len(payloads)
