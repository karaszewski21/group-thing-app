# Scope Clarifications (Phase 2)

## TL;DR
All 4 critical and 11 important decisions resolved; all recommendations accepted except one: the contract changes go into an **amended 0099** (not a new 0100). Typo tolerance is per word (0.65, one threshold), pending state is `wants.match_requested_at` + trigger NOTIFY, stemming lives in SQL (`stem_pl` + generated `stem_query`/`stem_words`), visibility via SQL `can_see_listing` with a backend parity test.

## Key Decisions
- Typo path per word — each want word matches if its stem is a weight-A prefix in the name or some name word has word_similarity ≥ 0.65 (whole-name 0.714 would wrongly make "Traktor Bruder Claas → Deutz" a MATCH).
- Pending/queue = `wants.match_requested_at` set on create/resume/matching-field edits; AFTER trigger `pg_notify('wants_changed', id)`; matcher claims with FOR UPDATE SKIP LOCKED and clears only if unchanged; API exposes `matching: bool`.
- Forward matching moves to the matcher; want-triggered matches are born seen with no bell; only new-listing window matches ring.
- Visibility: `can_see_listing` inlinable `LANGUAGE sql STABLE`, used by matcher and `matchable_listings`; backend parity test vs `owner_shares_group_with(private_only=True)` (standing/ended membership, leadership, deleted group, PUBLIC group); copy named in `test_membership_definition_guard.py`.
- Stemming in DB: IMMUTABLE `stem_pl` (minimal suffix set, no `-ka`, minimum stem length, short words ≤3–4 chars exact) + generated stored `stem_query` and `stem_words` on `wants`; products unchanged. User asked for an explanation first; explained with examples (zimowa→zim, kurtka→kurtk, rowerek→rower, lego exact), then chose the DB variant.
- Suggestions computed and stored by the matcher: only for wants with ≥3 words; candidates via OR of stemmed prefixes on weight A; shared/missing counted in SQL; `missing_words text[]` stored; cap 10 per want in total; no bell; name words only.
- API: `/matches` MATCH only; new `GET /wants/{id}/suggestions` with `missing_words`; `match_count`/`new_match_count` MATCH only; `?matched_item_id=` covers both tiers.
- Frontend: poll every 2 s while `matching`, stop after ~60 s with „Wyniki pojawią się wkrótce”; list cards also show „Szukamy…”.
- Expire/remind/purge move to the matcher; WANT_EXPIRING via the same outbox event.
- Outbox: one `wants.bells_due` event per matcher transaction `{pairs, expiring}`; backend handler wraps `write_bell_rows`, re-checks pairs still exist with tier MATCH, runs in `begin_nested()`.
- Startup: matcher waits until `alembic_version` reaches the required revision; compose `depends_on: postgres healthy, backend started`.
- One per-word threshold 0.65 regardless of category.
- Duplicates: FOR UPDATE SKIP LOCKED per want; window scan + sweep under `pg_try_advisory_xact_lock` + existing marker; ON CONFLICT DO NOTHING; expire/remind keep bumping `updated_at`, clearing the request marker does not.
- Matcher tests: alembic in dev deps, `alembic -c ../backend/alembic.ini upgrade head` against the testcontainer.
- **Migration: amend 0099** (user choice, against recommendation of a new 0100).
- Carried from Phase 1: same DB and login `aj`; bell ≤60 s via outbox; MATCH name-only; late-takeable items out of scope.

## Open Questions / Risks
- Amending 0099 means every existing DB at 0099 (dev DBs) must run `alembic downgrade 0098` + `upgrade head`; the 0099 downgrade deletes all wants, matches and WANT_* notification rows. Runbook must say so; acceptable only because 0099 has not been released (release gate).
- Stem prefixes still risk false positives; the 0099 release gate (≥200 labelled pairs) must score the final rules.
- SUGGESTION cost and reverse-window cost must be re-measured.
- Visibility SQL copy can leak PRIVATE listings if the parity test is incomplete.
