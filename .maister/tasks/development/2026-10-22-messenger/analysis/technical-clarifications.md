# Technical Clarifications (Phase 5A)

## TL;DR
- **Storage:** three tables. `conversations` records the kind (ITEM, GROUP or TERM) and its context. `messages` holds the messages. `conversation_reads` holds each party's read marker.
- **Access:** worked out from current data. ITEM conversations have two fixed parties. GROUP and TERM conversations admit the active organizer plus the members or attendees at the time of the request.
- **History:** loaded with a keyset cursor, 50 messages per page. Polling fetches only messages newer than the last one seen.

## Key Decisions
- **Access is computed; read state lives in `conversation_reads`.** The alternative, a participant table kept in sync, was rejected. Decision (e) requires dynamic participants, and syncing would need hooks scattered through the groups BC.
- **Pagination is a keyset cursor** (`before=(created_at,id)`, `after=` for polling), 50 messages per page. Offset pages shift whenever new messages arrive.
