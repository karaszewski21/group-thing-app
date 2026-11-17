# Requirements

## TL;DR
Move „Szukam” matching into a new `src/matcher` service (same DB, login `aj`) behind a DB contract added by an amended 0099. Add two tiers, MATCH (stemmed, per-word typo tolerance 0.65) and SUGGESTION (≥3-word wants, ≤1 missing, ≥2 shared, ≤10, no bell). The frontend gets the pending, slow, suggestions and list-badge states from the five approved mockups. Performance must be re-measured.

## Key Decisions
- Same DB and login `aj`; no separate role.
- The contract goes into the amended 0099 (dev DBs need downgrade 0098 + upgrade head; this loses wants data).
- Matcher is raw SQL over `matchable_listings` / `can_see_listing` / `stem_pl`-generated columns; no `app.*` imports.
- Backend keeps the API (`reads.py`, `writes.py`) and bell rows (`write_bell_rows` via the `wants.bells_due` outbox handler).
- Re-run the forward/reverse performance measurement with the new rules and suggestions.

## Open Questions / Risks
- The 0099 release gate (≥200 labelled Polish pairs) must score the final MATCH/SUGGESTION rules before deploy.
- Stem prefix false positives (Kurtyna, Legowisko) must be guarded by a minimal suffix set and exact short words.
- The PRIVATE visibility copy needs a complete parity test.

## Initial description
„szukam - kurtka zimowa na 2 koncie dodałem "Kurtka na zimę" i nie znalazł”. Diagnosis: FTS `'simple'` has no inflection (zimowa ≠ zime), and `word_similarity` was 0.588, below the 0.70 threshold. The user then wanted (a) looser matching, (b) „a może to cię zainteresuje” suggestions (example: Traktor Bruder Claas → Traktor bruder Deutz), and (c) matching moved to a separate process, in a new Python app `src/matcher` running in its own container.

## Q&A (all rounds)
### Phase 1
- DB role: the user first asked whether this means a separate database. Clarified: same DB, same tables. Answer: **same login `aj`**.
- Bell via outbox, ≤60 s latency: **OK**.
- Do description words count? **MATCH uses the name only.**
- Late-takeable items (PRIVATE→PUBLIC, cancelled reservation, rename): **not now**.
### Phase 2 (decisions)
- Typo tolerance is checked per word: each want word matches by stem prefix (weight A) or by `word_similarity` ≥ 0.65 to some name word. There is one threshold, regardless of category.
- Pending/queue: `wants.match_requested_at` plus an AFTER trigger `pg_notify('wants_changed', id)`. The matcher claims rows with FOR UPDATE SKIP LOCKED and clears the column only if it is unchanged. The API exposes `matching: bool`.
- Forward matching moves to the matcher. Matches found because of a want write are born seen, with no bell; only matches from the new-listing window ring the bell.
- `can_see_listing` is a SQL function with a backend parity test against `owner_shares_group_with(private_only=True)`. The copy is named in `test_membership_definition_guard.py`.
- Stemming lives in the DB: IMMUTABLE `stem_pl` plus generated `wants.stem_query` / `wants.stem_words`. Products are unchanged. The user asked for an explanation (zimowa→zim, kurtka→kurtk, rowerek→rower, lego kept exact) before choosing.
- Suggestions are computed and stored by the matcher: only for wants of ≥3 words, with `missing_words text[]`, a cap of 10 per want in total, no bell, and name words only.
- API: `/matches` returns MATCH only. A new `GET /wants/{id}/suggestions` is added. Counts cover MATCH only; `?matched_item_id=` covers both tiers.
- Frontend polls every 2 s while matching and stops after ~60 s with „Wyniki pojawią się wkrótce”. List cards show „Szukamy…”.
- Expire, remind and purge move to the matcher, and WANT_EXPIRING goes through the same `wants.bells_due` event.
- On startup the matcher waits until `alembic_version` reaches the required revision.
- Duplicates are prevented by SKIP LOCKED plus `pg_try_advisory_xact_lock` and the marker, with ON CONFLICT DO NOTHING.
- Matcher tests run the backend alembic migrations (`alembic -c ../backend/alembic.ini upgrade head`).
- Migration: **amend 0099**.
### Phase 4
- The five mockups are approved as binding (see `analysis/design-context/INDEX.md`).
### Phase 5
- User journey confirmed: entry points are unchanged (/add, empty search, bell, /wanted). After saving, the user lands on the detail page with „Szukamy…”. The close prompt on the item page includes suggestions.
- Code reuse confirmed: the matcher SQL and scan move into `src/matcher` as raw SQL along with their tests. The backend keeps `write_bell_rows` (called by the outbox handler), `reads.py` and `writes.py`.
- Performance re-measurement: **yes**, using the previous task's measurement approach, with results recorded in the runbook.

## Similar features / reuse
- `app/wants/application/matcher.py` (SQL shape, ranking, haversine, category path CTE) → rewritten as raw SQL in `src/matcher`.
- `app/wants/application/scan.py` (expire/remind/purge, marker window) → `src/matcher`.
- `app/wants/application/match_notifications.py::write_bell_rows` → stays; wrapped by a new handler in `app/notifications/outbox_listener.py` style (`register_handler`).
- `app/outbox` (`append`, dispatcher with SKIP LOCKED): the matcher inserts outbox rows raw, setting every column including `attempts`.
- Polling pattern: `src/frontend/src/hooks/useItemDetail.ts:51` (conditional `refetchInterval`) plus the test style in `useItemDetail.test.tsx:149`.
- `ItemCard` / `MatchCard` for suggestion cards; `WantMatchesView` activeEmpty card for the slow state.
- Previous measurement: `.maister/tasks/development/2026-11-15-szukam-wanted-mechanism/measurement/`.

## Visual assets
`analysis/design-context/mockups/` (binding):
- `want-detail-matching-pending.html`
- `want-detail-matching-slow.html`
- `want-detail-suggestions.html`
- `want-detail-matches-only.html`
- `wanted-list-pending-badge.html`

The design language is in `design-resources.md`.

## Functional requirements summary
1. Amended 0099 adds:
   - `stem_pl()`
   - generated `wants.stem_query` / `wants.stem_words`
   - `wants.match_requested_at` with a trigger that sends NOTIFY
   - `want_matches.tier` and `want_matches.missing_words`
   - `can_see_listing()`
   - the `matchable_listings` view
2. Backend:
   - Writes set `match_requested_at` instead of calling `match_want`.
   - Edits that change matching fields still delete matches and the unread bell row synchronously.
   - The APScheduler wants job is removed.
   - New `wants.bells_due` outbox handler (savepoint; re-checks that pairs still exist and are MATCH).
   - New `GET /wants/{id}/suggestions`.
   - `matching` added to `WantResponse`.
   - Counts cover MATCH only.
3. `src/matcher`:
   - own pyproject/uv/Dockerfile (no Bielik)
   - LISTEN loop plus periodic poll for requested wants
   - ~1 min new-listing window
   - expire/remind/purge
   - writes outbox events
   - waits for the required alembic revision
   - safe with several copies
4. MATCH/SUGGESTION rules as above. Expected examples:
   - kurtka zimowa → Kurtka na zimę = MATCH
   - Traktor Bruder Claas → Traktor bruder Deutz = SUGGESTION
   - rowerek biegowy → Rower biegowy dla dziecka = MATCH
   - kurtka zimowa → Kurtka przejściowa = none
   - traktor bruder → Koparka Bruder = none
   - also: no Kurtyna for kurtka, no Legowisko for lego
5. Frontend: implement the mockup states, polling, suggestions section and list badge.
6. Compose `matcher` service; runbook (amended 0099 procedure, deploy order, rollback, verify); architecture.md and INDEX.md updates; fix the runtime vs runtime-dev doc mismatch.
7. Re-measure forward/reverse/suggestion cost.

## Scope boundaries
- In scope: everything above.
- Out of scope:
  - separate DB role
  - late-takeable rescans
  - description words for MATCH
  - switching backend search/visibility to the SQL function
  - running the release-gate labelling itself (the gate still blocks deploy)

## Technical considerations
- Keep the view and functions `LANGUAGE sql` so they inline and the GIN indexes stay usable; the reverse path keeps the MATERIALIZED window.
- `dispatch_pending` commits even when a handler fails, so the handler needs `begin_nested()`.
- Expire/remind keep bumping `updated_at` (seeker writes still get a 409). Clearing `match_requested_at` must not bump it.
- Clock guard and module-boundary style rules are replicated in the matcher.
- Several backend tests must be rewritten or moved (test_wants_api, lifecycle, matches_api setup, matcher, scan, notifications).
