# Clarifications (Phase 1)

## TL;DR
Matcher uses the same database and the same `aj` login (no separate DB, no separate role for now). Bell rows for MATCH go through the outbox, handled by the backend; up to 60 s latency is accepted. MATCH counts name words only. Items that become takeable later (PRIVATE→PUBLIC, cancelled reservation, rename) stay a known limit.

## Key Decisions
- Same database, same login `aj` / same `DATABASE_URL` as backend — user wants to focus on tables only; a least-privilege login may come later.
- MATCH bell rows: matcher stages an outbox event, backend handler writes WANT_MATCH_FOUND; ≤60 s latency OK.
- Description words: MATCH = name only (weight A); description may only help SUGGESTION.
- Late-takeable items (PRIVATE→PUBLIC, cancelled reservation, product rename): not in scope; remains a documented known limit.

## Q&A
1. DB role for matcher? — User first asked whether it is a separate database (it is not). Clarified: same DB, same tables. Answer: **same login `aj`**.
2. Bell via outbox with ≤60 s delay? — **Outbox, up to 60 s OK.**
3. Do description words count? — **Name only for MATCH.**
4. Catch late-takeable items? — **Not now.**

## Open Questions / Risks
- Suggestion tier cost (per-lexeme counting not GIN-served) must be measured.
- 0099 release gate (≥200 labelled pairs) must be re-run against the new rules.
