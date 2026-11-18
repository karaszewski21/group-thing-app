# Specification: Wants matcher service (MATCH / SUGGESTION tiers)

> Revision 2. Resolves every finding of `verification/spec-audit.md` (C1, H1–H5, M1–M6, L1–L9); see **Audit resolution** at the end.
>
> Revision 3 (verification fixes, rounds 1 and 2). FR-MT-05 (sweep and match in two transactions under a session advisory lock, `(start, end]` with `WINDOW_MAX_LISTINGS`, the overlap measured from the previous run's clock), FR-MR-03 (the suggestion cap counts only suggestions still matchable), FR-BE-01 (checks on an unlocked read, then the lock and the `updated_at` check) and FR-MT-10 (`WINDOW_MAX_LISTINGS`, `SHUTDOWN_GRACE`) describe the behaviour as built.

## TL;DR
„Szukam” matching moves out of the FastAPI process into a new Python app `src/matcher` (its own compose service, same DB, login `aj`). It talks raw SQL to a DB contract added by **amending migration 0099**: the text functions `words_pl`/`stem_word_pl`/`stem_pl`/`stem_query_pl` (stop-words skipped, every inner call `public.`-qualified), generated stem columns, `match_requested_at` with a NOTIFY trigger, `want_matches.tier`/`missing_words`, and the inlinable views `group_holdings`, `private_group_peers` and `matchable_listings`.
MATCH requires every (non-stop) want word to be in the item name, either by stemmed prefix or by per-word `word_similarity ≥ 0.65`. SUGGESTION covers wants of ≥3 such words with exactly one word missing, at most 10 per want, and never rings the bell.
The backend keeps the API and the bell rows (through a `wants.bells_due` outbox handler that re-checks visibility). Writes only flag a want for matching, edits lock the want row first. The frontend polls a pending state and adds a „Może Cię zainteresuje” section, per the five binding mockups.

## Key Decisions
- **Amend 0099, no 0100.** Every DB at the old 0099 runs `alembic downgrade 0098` + `upgrade head` from the **new** image, which deletes all wants, matches and WANT_* notifications. Acceptable only because 0099 is unreleased (release gate).
- **(C1) The downgrade is shape-tolerant.** Every object that only the new 0099 creates is dropped with `IF EXISTS` (views, functions) or implicitly with its table (trigger, new indexes, new check constraints, generated columns). No individual drop names a new-only object without `IF EXISTS`. A migration test rebuilds the old-0099 shape and runs the new downgrade on it.
- **(M1) Downgrade order:** delete WANT_* notifications → drop views `matchable_listings`, `private_group_peers`, `group_holdings` → drop tables as today (`want_matches`, `want_scan_markers`, `wants`, which takes the trigger, generated columns and new indexes with it) → drop functions `wants_notify_match_requested()`, `stem_query_pl`, `stem_pl`, `stem_word_pl`, `words_pl`.
- **(H1) Visibility is inlinable by construction.** No scalar visibility function. The PUBLIC branch is written at each call site (`l.visibility = 'PUBLIC'`). The PRIVATE branch is `EXISTS (SELECT 1 FROM private_group_peers p WHERE p.party_id = l.owner_party_id AND p.peer_party_id = w.seeker_party_id)`; views are rewritten into the query (inlined, no function call per pair); the PRIVATE branch may be a correlated `OR EXISTS` SubPlan reached only for PRIVATE listings (accepted after the Group 10 EXPLAIN). `private_group_peers` is the single named SQL definition the parity test targets. `can_see_listing` is dropped from the design.
- **(H2) The PRIVATE rule copies `membership.py` + `visibility.py` exactly** (live GroupRole, role types, live PRIVATE group; FR-DB-05). The bell handler re-checks every pair through the backend's own `reads.visible_matches` before writing a bell that names a product.
- **(H3) `update_want` locks the want row first** (`SELECT … FOR NO KEY UPDATE`), then deletes the pairs, then flags. A matcher run in progress is waited for, so its pairs are seen and deleted.
- **(H4) A failing want cannot starve the queue.** Each matcher process keeps an in-memory backoff map `{want_id: retry_after}`. The claim skips ids whose `retry_after` is in the future. Backoff is 60 s, doubling to 15 min, and is cleared on success. No schema change.
- **(H5) No unqualified call inside an IMMUTABLE function.** Every call to a non-`pg_catalog` function in the contract bodies is written `public.<fn>`, so `pg_dump`/restore (`search_path = ''`) recomputes the generated columns. A test inserts and updates a want under `SET LOCAL search_path = ''`.
- **(M3, user decision) Polish stop-words are skipped by `words_pl`.** The fixed list is the 24 words `a, albo, ani, bez, dla, do, i, ku, lub, na, nad, o, od, oraz, po, pod, przez, przy, u, w, we, z, za, ze`, compared after `fold_pl`. Stop-words count for neither MATCH nor SUGGESTION, never appear in `missing_words`, and never enter the candidate query. A want whose name has no word left is rejected with 400 on create and update.
- **One tokenizer, aligned by construction (L1).** `words_pl(name)` splits the **raw** name and drops stop-words. `stem_pl(name)` maps `stem_word_pl(word)` over that same array, so positions match exactly and `missing_words` takes the original word from the same array. `stem_word_pl` (which folds internally) is the one home of the suffix rule.
- **`short_words_query` is replaced, not kept.** Words of ≤4 folded characters become exact weight-A lexemes inside `stem_query` and never take the typo path. This blocks `lego → Legowisko`.
- **`ę`/`ą` exception to the 4-char exact rule (needed by the M3 acceptance example).** „zimę” folds to the 4-char „zime”, which the exact rule would never match to „zimowa”. A short raw word ending in `ę`/`ą` with ≥3 chars before it is stemmed (`zim:*`). These endings are always inflectional, so `lego`-type words stay exact; the typo path still never applies to ≤4-char words.
- **Typo path per want word.** `word_similarity(fold_pl(word), listing name_folded) ≥ 0.65`, only for words longer than 4 characters. One threshold whatever the category; `SIMILARITY_THRESHOLD_WITH/WITHOUT_CATEGORY` are deleted.
- **(M2) Trigram candidate operand order is `want.name_folded <% l.name_folded`**, as in `matcher.py:209`, i.e. `word_similarity(want, listing) ≥ pg_trgm.word_similarity_threshold`. It relies on the 0.6 GUC default, which the matcher never changes; a test pins it.
- **(M5) Constants have one home per value.** Matcher-only values (top 20, suggestion cap 10, 0.65, 4-char limit, retention 30 days, window cadence/overlap/first-run lookback, timeouts, backoff) live only in `src/matcher/matcher/rules.py` and are deleted from the backend. The one shared value, `REMINDER_LEAD` (backend message text + matcher sweep), is guarded by a drift test. The 4-char limit is additionally pinned behaviourally against `stem_query_pl`.
- **Forward runs are born seen with no bell; window runs are unseen and belled.** This holds for both tiers' insert semantics. Suggestions never produce an outbox entry.
- **The window also stores suggestions**, so a later-listed „Traktor bruder Deutz” still appears. Its cost is part of the re-measurement.
- **`matching` = `match_requested_at IS NOT NULL AND status = ACTIVE`.** The matcher claims any flagged want. For a non-ACTIVE want, the match predicates yield nothing and the flag is cleared.
- **Startup gate checks the contract as well as the revision id.** The matcher waits until `alembic_version.version_num` is numerically ≥ 99 **and** `to_regclass('public.matchable_listings')` is not null.
- **(M6) The backend fails fast on an old-0099 schema.** After `alembic upgrade head` its lifespan checks the same `to_regclass('public.matchable_listings')` and refuses to start with a log line naming the runbook, instead of serving 500s.
- **(M6) No image-only rollback.** An old-0099 image maps `short_words_query`, and a pre-0099 image's `alembic upgrade head` fails on the unknown revision 0099 at start. Rollback is always `downgrade 0098` from the new image, then the old image.
- **(L7) Claims take `FOR NO KEY UPDATE`**, not `FOR UPDATE`, so window inserts (FK `KEY SHARE`) never wait behind a claimed want. The window transaction runs under the same 30 s statement timeout.
- **(L8) Bell outbox rows are chunked**: at most 1000 pairs per `wants.bells_due` row (precedent: `storage.objects_delete` ≤1000 keys), `expiring` in the first row. `write_bell_rows` sums counts into the unread row, so chunks are additive.
- **The matcher uses asyncpg directly (no SQLAlchemy at runtime).** LISTEN needs a dedicated raw connection anyway. SQLAlchemy and alembic are dev-only, used to run the backend migrations in tests.
- **Suggestions in the API:** the existing `useWantMatches` query also fetches suggestions, with no separate hook. Suggestions show only for ACTIVE wants. `/suggestions` returns at most 10 rows (`LIMIT 10`), so a rare concurrent-run overshoot of the stored cap is never visible.
- **(L4) A resumed want with stored matches keeps showing them while `matching`.** The status row appears above the existing grid; the four skeleton tiles show only when no MATCH is stored yet.

## Open Questions / Risks
- **Release gate still blocks deploy.** The ≥200 labelled Polish pairs must score the final rules: suffix set, stop-list, 4-char exact limit, 0.65. Changing `stem_word_pl`/`words_pl` later means DROP/ADD of the generated columns.
- **Stem false positives:** `zim:*` matches `zimny` and similar words. Only the gate measures this.
- **Privacy:** `private_group_peers` is a second copy of the PRIVATE rule. The parity test (all cases in FR-DB-05) is its guard for lists and counts the read-time filter also covers; the bell handler re-check covers bells.
- **Cost:** per-word checks and suggestions are not index-served on the reverse path, so re-measurement (FR-OPS-03) is required, including an EXPLAIN proving the views inline and the forward text indexes are used.
- **Stale window pair:** a window statement whose snapshot predates a seeker's edit can still insert a pair for the old criteria (milliseconds wide; it exists today too). The bell handler re-checks the pair, but the list may show it until the next edit. Accepted.
- **Backoff is per process and in memory.** A restart forgets it (the want is retried once immediately), and several copies each back off independently. Accepted; a repeatedly failing want is logged at WARNING with its id and attempt count.
- **The `ę`/`ą` short-word exception is a spec-level addition** that the user's „kurtka na zimę” → „Kurtka zimowa” = MATCH example requires; it refines, but does not replace, the user-final 4-char rule. The orchestrator may want the user to confirm it; the release gate scores it.
- **Stop-list is fixed in the migration.** Extending it means a new revision with DROP/ADD of `stem_query`/`stem_words` (runbook step 6).

## Goal
Make „Szukam” find inflected and diminutive names („kurtka zimowa” → „Kurtka na zimę”). Add a „Może Cię zainteresuje” tier for near misses, and run all matching in a separate `matcher` process behind a documented DB contract.

## User Stories
- As a seeker, I want „kurtka zimowa” to find „Kurtka na zimę”, so that I don't miss items named with a different word form.
- As a seeker, I want small words like „na” or „dla” ignored, so that „kurtka na zimę” finds „Kurtka zimowa” as a real match.
- As a seeker, I want to see items that differ by one word („Traktor bruder Deutz” for „Traktor Bruder Claas”), with the missing word shown, so that I can decide whether they suit me.
- As a seeker, after saving a want I want to see „Szukamy pasujących rzeczy…”, and later „Wyniki pojawią się wkrótce” with „Odśwież teraz” if it takes long, so that I know results are coming.
- As a seeker, I want my wanted list to show „Szukamy…” on a want still being matched.
- As a seeker, I want a bell only for real matches of newly listed items I may see, never for suggestions.
- As an operator, I want matching to run in its own container that I can stop, restart and verify independently of the API.

## Core Requirements

### DB contract (amended `src/backend/alembic/versions/0099_wants.py`)
- **FR-DB-01** Text functions, all `LANGUAGE sql IMMUTABLE PARALLEL SAFE`, string bodies, no SET clause, every call to a non-`pg_catalog` function written `public.<fn>` (H5):
  - `words_pl(text) → text[]`: the raw name split on runs of non-`[:alnum:]` characters, empties dropped, order kept, and every word whose `public.fold_pl(word)` is in the stop-list removed. Stop-list (24, fixed in the migration): `a, albo, ani, bez, dla, do, i, ku, lub, na, nad, o, od, oraz, po, pod, przez, przy, u, w, we, z, za, ze`.
  - `stem_word_pl(text) → text`: the stem of one **raw** word; it folds the word itself with `public.fold_pl`. Words of ≤4 folded chars are returned unchanged (exact), with one exception: a raw word ending in `ę` or `ą` (always an inflectional ending) with ≥3 chars before it has that letter stripped and is treated as a stem (`zimę` → `zim`, prefix), so `lego` stays exact while `zimę` finds `zimowa`. Otherwise strip one suffix (longest match) from a minimal set, only if ≥3 chars remain. The starting set is adjective `-owa/-owy/-owe/-owej/-owych/-owym`, `-ego/-emu/-ych/-ymi/-ami/-ach`, diminutive `-ek`, and a single final vowel `-a/-e/-i/-y/-o`. It never includes `-ka`. The migration text is the source of truth.
  - `stem_pl(text) → text[]`: `public.stem_word_pl(w)` for each `w` of `public.words_pl(name)`, in order (so position *i* of `stem_pl(name)` belongs to position *i* of `words_pl(name)`).
  - `stem_query_pl(text) → tsquery`: AND, in the `simple` config (two-argument `to_tsquery`), of `'<stem>':*A` for stemmed words (>4 folded chars, or the `ę`/`ą` exception) and `'<word>':A` for exact short words; each lexeme is quoted with `'` doubled so no character can break the query. NULL when `words_pl` yields no word.
  - Pinned examples: zimowa→zim, zimę→zim (prefix, `ę` exception), kurtka→kurtk, rowerek→rower, biegowy→bieg, lego→lego (exact); `words_pl('kurtka na zimę') = {kurtka, zimę}`; `words_pl('Rower-biegowy 2w1 dla 3-latka') = {Rower, biegowy, 2w1, 3, latka}`; `words_pl('na i z') = {}`.
- **FR-DB-02** On `wants`:
  - GENERATED STORED `stem_query tsquery` = `public.stem_query_pl(name)` (nullable).
  - GENERATED STORED `stem_words text[]` = `public.stem_pl(name)`.
  - Drop `short_words_query` (it is simply not created by the amended revision).
  - Add `match_requested_at timestamp NULL`, with a partial index `ix_wants_match_requested_at` (`WHERE match_requested_at IS NOT NULL`).
- **FR-DB-03** Trigger function `wants_notify_match_requested() RETURNS trigger` (`plpgsql`, calls `pg_catalog.pg_notify('wants_changed', NEW.id::text)`, returns NEW) and trigger `trg_wants_match_requested`: AFTER INSERT OR UPDATE OF `match_requested_at` ON `wants`, FOR EACH ROW, WHEN `NEW.match_requested_at IS NOT NULL`.
- **FR-DB-04** On `want_matches`:
  - `tier varchar(10) NOT NULL DEFAULT 'MATCH'` with `ck_want_matches_tier` (MATCH|SUGGESTION).
  - `missing_words text[] NULL`, with `ck_want_matches_missing_words` (NULL for MATCH, non-empty for SUGGESTION).
  - Index `ix_want_matches_want_id_tier`.
- **FR-DB-05** PRIVATE visibility as two plain views (H1/H2), defined exactly as `membership.py` (`active_membership_clause`, `active_leadership_clause`, `live_group_clause`) and `visibility.py::parties_share_group(private_only=True)`:
  - `group_holdings(party_id, group_id)`: UNION ALL of
    - `memberships m JOIN group_roles r ON r.id = m.from_role_id` with `m.valid_to IS NULL`, `r.role_type = 'MEMBER'`, `r.valid_to IS NULL`, giving `(r.party_id, m.to_group_id)`;
    - `leaderships l JOIN group_roles r ON r.id = l.from_role_id` with `l.valid_to IS NULL`, `r.role_type = 'ORGANIZATOR'`, `r.valid_to IS NULL`, giving `(r.party_id, l.to_group_id)`;

    each joined to `groups g ON g.id = <group_id>` with `g.deleted_at IS NULL`. An RSVP or family relation never counts.
  - `private_group_peers(party_id, peer_party_id)`: `group_holdings a JOIN group_holdings b ON b.group_id = a.group_id JOIN groups g ON g.id = a.group_id AND g.visibility = 'PRIVATE'`. Either side may be member or leader.
  - Call-site rule (FR-MR-01): `l.visibility = 'PUBLIC' OR EXISTS (SELECT 1 FROM private_group_peers p WHERE p.party_id = l.owner_party_id AND p.peer_party_id = w.seeker_party_id)`.
- **FR-DB-06** View `matchable_listings` (L3): one row per item that has an `item_listing_preferences` row, is live (`inventory_items.deleted_at IS NULL`), has balance AVAILABLE, no PROPOSED swap proposal on it, and its own place (`inventory_items.location_id`) set and live (`locations.deleted_at IS NULL`). Columns:
  - `item_id`, `owner_party_id`, `visibility`, `mode`
  - `created_at` (listing preference)
  - `name_folded`: the same expression as the `ix_products_name_trgm` index
  - `search_vector`
  - `category_path` (uuid[] of the product category and its ancestors)
  - `locality_id`, `lat`, `lng` (of the item's place locality)
- **FR-DB-07** Downgrade (C1/M1), shape-tolerant, in this order:
  1. `SET LOCAL lock_timeout = '5s'`; `DELETE FROM notifications WHERE kind IN ('WANT_MATCH_FOUND','WANT_EXPIRING')`.
  2. `DROP VIEW IF EXISTS matchable_listings`, then `private_group_peers`, then `group_holdings`.
  3. The table drops as today (the index/FK drops that exist in both shapes stay as they are; nothing new-only is dropped individually). Dropping `wants` removes the trigger, generated columns, `ix_wants_match_requested_at`; dropping `want_matches` removes the tier columns, checks and `ix_want_matches_want_id_tier`.
  4. `DROP FUNCTION IF EXISTS` `wants_notify_match_requested()`, `stem_query_pl(text)`, `stem_pl(text)`, `stem_word_pl(text)`, `words_pl(text)`.

  The same code downgrades a DB at the new 0099 and a DB at the old 0099.

### Backend (`src/backend/app/wants`, `app/main.py`)
- **FR-BE-01** Create, resume, and an update that changes name, category, offer mode, locality or radius set `match_requested_at = now` instead of calling `match_want`. `update_want` (H3, revision 3):
  1. runs the checks and lookups (ownership, status, text classifier, category and locality) on an unlocked read and remembers the want's `updated_at`. No row lock is held while the classifier runs. It then reads the want again with `SELECT … FOR NO KEY UPDATE` (`populate_existing`). If `updated_at` differs from the first read, it rolls back and raises `StaleDataError` (the shared 409). The status check runs again on the locked row;
  2. if the matching fields change: under the lock, deletes all of the want's `want_matches` (both tiers) and the unread bell row, sets the new values and `match_requested_at`, then flushes;
  3. commits.

  A matcher transaction holding the want's lock is waited for; after it commits, the DELETE sees its pairs. A matcher claim during the edit skips the locked want and picks it up after the commit. A sweep that expires or reminds the want in between bumps `updated_at`, so the edit gets the 409 instead of overwriting it.
- **FR-BE-02** Remove the following:
  - forward matching from the request: `SET LOCAL statement_timeout`, `_set_forward_timeout`, the `57014`→503 mapping and `ForwardMatchTimedOut`
  - `short_words_query` writing and `text_queries.py`
  - `matcher.py` and `scan.py`
  - from `domain/limits.py`: `MATCH_TOP_N`, `RETENTION`, `SCAN_INTERVAL`, `SCAN_OVERLAP`, both similarity thresholds, `FORWARD_STATEMENT_TIMEOUT_SECONDS` (M5; `VALIDITY`, `AUTO_EXTENSION_WINDOW`, `REMINDER_LEAD` and the name/note/radius/cap limits stay)
  - the `WantScanMarker` mapping

  The 40P01/40001→409 mapping stays.
- **FR-BE-03** `app/main.py`:
  - Remove the wants imports, `_want_scan_lost_a_race`, `_run_want_scan` and its scheduler job.
  - Register the wants outbox handler next to the notifications and storage listeners.
  - Fix the lifespan docstring from „30s” to the real 60 s outbox poll.
- **FR-BE-04** New outbox handler for `wants.bells_due` with payload `{pairs: [[want_id, item_id], …], expiring: [want_id, …]}` (≤1000 pairs per row). Inside `db.begin_nested()` it:
  - keeps only pairs that still exist in `want_matches` with tier MATCH **and** pass `reads.visible_matches(seeker, listed, …)` for the want's seeker (H2): one statement per distinct seeker in the row
  - loads `expiring` wants that are still ACTIVE
  - calls the existing `write_bell_rows(pairs=…, expiring=…, now=datetime.utcnow())`

  A failure rolls back only the savepoint, so the dispatcher's retry starts clean.
- **FR-BE-05** `WantResponse.matching: bool` (`match_requested_at IS NOT NULL AND status = ACTIVE`) on every want response, including the list.
- **FR-BE-06** `match_count`, `new_match_count` and `GET /api/wants/{id}/matches` cover tier MATCH only. `GET /api/wants?matched_item_id=` matches both tiers, so the close prompt also appears after taking a suggested item.
- **FR-BE-07** New `GET /api/wants/{id}/suggestions` → `list[WantSuggestionResponse]`. Fields are `id, title, href, meta, missing_words, reserved_by_me, proposed_by_me`: the same card as a match, but without `is_new` and with `missing_words`. It applies the same read-time `visible_matches` filter and the same 404 rules as `/matches`. Order: score desc, then item id; `LIMIT 10`. `POST …/matches/{item_id}/opened` works for either tier.
- **FR-BE-08** Name must contain a word (M3/L1): create and a name-changing update run `SELECT cardinality(public.words_pl(:name))` (same transaction, before the insert/update); 0 → 400 with the new `messages.NAME_NEEDS_A_WORD_MESSAGE` („Wpisz, czego szukasz — nazwa nie może składać się z samych spójników i przyimków.”). The SQL function is the only stop-list; the backend does not copy it.
- **FR-BE-09** Contract fail-fast (M6): the lifespan, after `clock.check_timezone()`, runs `SELECT to_regclass('public.matchable_listings')`; NULL → log ERROR „schema is the old 0099; run the amended-0099 runbook (architecture.md)” and raise, so uvicorn exits instead of serving.
- **FR-BE-10** `MatchedPair = tuple[uuid.UUID, uuid.UUID]` is defined in `match_notifications.py` itself (M4), replacing `from .matcher import MatchedPair`; `bells_due.py` imports it from there.

### Matcher (`src/matcher`)
- **FR-MT-01** Own `pyproject.toml` (`aj-matcher`, Python ≥3.12, runtime dep `asyncpg==0.31.0`; dev: pytest, pytest-asyncio, testcontainers, `alembic==1.17.1`, `sqlalchemy==2.0.44`, ruff, mypy strict, line 100), `uv.lock`, and a `Dockerfile` (python:3.12-slim + uv, `uv sync --frozen --no-dev`, no `ml` group, no Bielik, no `hf_token` secret). No `app.*` import.
- **FR-MT-02** Config: `DATABASE_URL` only (the `+asyncpg` driver suffix is stripped). Never log the URL.
- **FR-MT-03** Startup gate: retry with one INFO line per attempt until the contract check passes (see Key Decisions). Then log „listening”.
- **FR-MT-04** Request loop. LISTEN `wants_changed` on a dedicated connection, plus a poll every 10 s. Each wake-up drains flagged wants, one transaction per want, until the claim returns no row:
  1. Claim: `SELECT id, match_requested_at FROM wants WHERE match_requested_at IS NOT NULL AND id <> ALL(:backing_off) ORDER BY match_requested_at, id LIMIT 1 FOR NO KEY UPDATE SKIP LOCKED`, where `:backing_off` = ids whose `retry_after` > now (H4/L7).
  2. Run the MATCH insert, then the SUGGESTION insert, each under `SET LOCAL statement_timeout = '30s'`.
  3. Compare-and-clear: `SET match_requested_at = NULL WHERE id = :id AND match_requested_at = :claimed`, never touching `updated_at`.
  4. On success remove the id from the backoff map. On any error (incl. timeout, lost race) roll back and set `retry_after = now + 60 s × 2^(failures−1)`, capped at 15 min; log per FR-MT-07 including the id and failure count.

  Forward pairs get `source = FORWARD` and `seen_at = now`. No outbox row is written.
- **FR-MT-05** Window loop, every 60 s (revision 3). A run holds the session advisory lock `pg_try_advisory_lock(<constant>)` and releases it in `finally`. An unlock that fails is logged at DEBUG, so the run's own error propagates, and the pool reset drops the lock anyway. If the lock is not acquired, the run is skipped at DEBUG. The run uses two transactions, each with `SET LOCAL statement_timeout = '30s'` (L7):
  1. **The sweep**, committed on its own, so a failing match cannot roll it back: expire, remind and purge as today. Expire and remind keep bumping `updated_at`, and remind still ignores `notifications_enabled`. The reminded wants get their own `wants.bells_due` outbox row (`pairs: []`).
  2. **The match** of the listings created in `(start, end]` over `matchable_listings.created_at`:
     - `start` = now − 20 min on the first run. After that, `start = max(marker − WINDOW_OVERLAP, min(marker, previous_run_at − WINDOW_OVERLAP))`, where `previous_run_at` is the marker's `updated_at`, the clock of the run that moved it. The overlap only covers listings whose `created_at` predates their commit by up to 2 min, so it applies only within 2 min before the previous run's clock. After a capped run whose `end` lies further back, the next run starts at the marker itself and re-reads nothing. A run therefore reads at most about `WINDOW_MAX_LISTINGS` listings plus those created in the 2 min before the previous run's clock. The window does not grow from run to run.
     - `end` = now. When more than `WINDOW_MAX_LISTINGS` listings wait after the marker, `end` is the `created_at` of the `WINDOW_MAX_LISTINGS`-th one instead (a capped run). Every listing tied with it is included (`created_at <= end`), so no pair is lost on equal timestamps. The loop starts the next run at once after a capped run, so a backlog drains in back-to-back runs.
     - Inserts MATCH pairs (`source = SCAN`, `seen_at = NULL`) and SUGGESTION pairs, the latter with `seen_at = now` and no bell. Pair timestamps are the run's real now.
     - Writes `wants.bells_due` outbox rows when there are MATCH pairs: one row per ≤1000 pairs (L8), each with `expiring: []`.
     - Moves the marker by compare-and-set on `scanned_through`: `scanned_through = end`, `updated_at` (and `created_at` on the first insert) = the run's now, so the marker stays a liveness signal during a drain. A miss is a lost race and rolls the match back.
- **FR-MT-06** Raw inserts set **every NOT NULL column without a default** (L2):
  - `outbox_entries`: `id` gen_random_uuid, `created_at`, `updated_at`, `event_type`, `payload` jsonb, `status = 'PENDING'`, `attempts = 0`, `last_error`/`processed_at` NULL.
  - `want_matches`: `id` gen_random_uuid(), `created_at`, `updated_at` (= the run's `now`), plus the pair columns.
  - `want_scan_markers`: `id`, `created_at`, `updated_at` on the first-run insert; `updated_at` on the compare-and-set.
- **FR-MT-07** Error and race policy, as in `main.py::_run_want_scan` today:
  - A lost race (40P01/40001, marker unique/compare-and-set miss) logs one WARNING and is retried next run (window) or after backoff (request).
  - Anything else gets `logger.exception` once.
  - The loops never crash. A lost DB connection reconnects with backoff, and LISTEN is re-issued.
- **FR-MT-08** Clock: one module `matcher/clock.py` returns naive UTC. A guard test forbids other `datetime.now/utcnow/date.today` calls in the package. Each run uses one `now`.
- **FR-MT-09** Safe with several copies: SKIP LOCKED per want, an advisory lock for the window, and `ON CONFLICT (want_id, item_id) DO NOTHING`.
- **FR-MT-10** `matcher/rules.py` is the only home of the matcher constants (M5): `MATCH_TOP_N = 20`, `SUGGESTION_CAP = 10`, `WORD_SIMILARITY_MIN = 0.65`, `SHORT_WORD_MAX_CHARS = 4`, `REMINDER_LEAD = 7 days`, `RETENTION = 30 days`, `WINDOW_INTERVAL = 60 s`, `WINDOW_OVERLAP = 2 min`, `FIRST_WINDOW_LOOKBACK = 20 min`, `WINDOW_MAX_LISTINGS = 300` (revision 3), `REQUEST_POLL = 10 s`, `STATEMENT_TIMEOUT = 30 s`, `SHUTDOWN_GRACE = 5 s` (revision 3), `BACKOFF_START = 60 s`, `BACKOFF_MAX = 15 min`. They are passed into SQL as bound parameters, never spliced.

### Matching rules (both directions, both tiers)
"Want words" are `words_pl(want.name)` — stop-words already removed.
- **FR-MR-01** Shared predicates (unchanged in meaning):
  - the want is ACTIVE and unexpired, and has ≥1 want word
  - the item is in `matchable_listings`
  - `owner_party_id ≠ seeker`
  - visibility per FR-DB-05's call-site rule
  - offer mode: none or equal
  - category: none, or in `category_path`
  - locality: none, or the same locality, or haversine ≤ `radius_km` (radius NULL or a missing point → same locality only)
  - the pair is not stored yet
- **FR-MR-02** MATCH: **every** want word hits the item name. A word hits when its stem prefix (short word: exact lexeme) matches weight A of `search_vector`, or, for words of >4 chars only, when `word_similarity(fold_pl(word), name_folded) ≥ 0.65`. Score = `word_similarity(want.name_folded, name_folded)`. The top 20 per want per run are kept, ranked by score desc, listing `created_at` desc, then item id. Candidates come from the indexes: `search_vector @@ want.stem_query` OR `want.name_folded <% l.name_folded` (M2), plus an OR-of-stems prefix query built from `stem_words` (no stop-words, M3). Each is then verified word by word.
- **FR-MR-03** SUGGESTION: only for wants with ≥3 want words, only for pairs that are not a MATCH. The pair needs ≥2 hit words and exactly 1 missing word, judged on name words only. `missing_words` holds the original want word (`words_pl(want.name)[pos]`, same array as the stems). At most 10 SUGGESTION rows per want **in total**, ranked like MATCH. The stored suggestions subtracted from the cap are only those whose item is still in `matchable_listings` (revision 3), so a suggestion whose item is gone frees its place.
- **FR-MR-04** Description words never count (weight A only).

### Frontend (`src/frontend/src`)
- **FR-FE-01** `api/wants.ts`: `matching: boolean` on `WantResponse`, a `WantSuggestionResponse` type, and `getWantSuggestions(id)`. The create/edit form shows the server's 400 message for a stop-words-only name through the existing `extractProblemMessage` path (no client copy of the stop-list).
- **FR-FE-02** `hooks/useWantMatches.ts`:
  - The query fetches want, matches and suggestions in one `Promise.all`.
  - `refetchInterval` is 2000 ms while `want.matching` is true and the polling window (60 s from when the hook first saw `matching`) has not run out. Otherwise it is `false`.
  - It exposes `suggestions` and `slow` (window ran out while still matching). The window end is driven by one `setTimeout` that sets an `expired` state, so `slow` re-renders even when no data changes (L4); the timer is cleared on unmount and on restart.
  - `refetch` (used by „Odśwież teraz”) refetches and restarts the window.
- **FR-FE-03** `hooks/useWants.ts`: the list query uses the same 2 s / 60 s polling while any listed want has `matching`. After the window the list has no slow state: the card keeps „Szukamy…” and the next window-focus/mount refetch (TanStack default) updates it (L4).
- **FR-FE-04** `wantMatchesViewState.ts`:
  - New kinds `matching` and `matchingSlow` (ACTIVE want with `matching`). They take precedence over `active`/`activeEmpty` and carry the stored `matches` and `suggestions` (L4).
  - `active`/`activeEmpty` carry `suggestions`.
  - Closed kinds show no suggestions.
- **FR-FE-05** `WantMatchesView.tsx` renders the screens in **Visual Design**. The suggestions section appears only when there are suggestions, under the MATCH list or under the empty card. In `matching` with stored matches the status row sits above the existing grid and no skeleton is shown. The existing first-load `newIds` snapshot and single `markSeen` stay: pairs that arrive later during the same mount (only window pairs can be unseen; forward pairs are born seen) render without „nowe” and are marked „nowe”/seen on the next visit (L4).
- **FR-FE-06** `WantedListView.tsx`: a card with `matching` shows the „Szukamy…” status instead of the counts.
- **FR-FE-07** The fixtures (`test/fixtures/wants.ts`) and the exact key-set tests are updated, with a typed suggestion factory and no casts.

### Ops and docs
- **FR-OPS-01** The `docker-compose.yml` service `matcher`:
  - `build: src/matcher`
  - environment `DATABASE_URL: postgresql+asyncpg://aj:aj@postgres:5432/aj` (the same value as backend)
  - `depends_on`: postgres `service_healthy`, backend `service_started`
  - no ports
- **FR-OPS-02** `architecture.md`:
  - Wants section rewritten: matcher service, contract, tiers, stop-list, counts, lifecycle table, bells via outbox (≤60 s, re-checked visibility), measured cost.
  - Boundary and clock notes extended to `src/matcher`.
  - Deployment section lists `matcher`.
  - Both runtime/runtime-dev statements are fixed (L5): l.125 and l.503. Compose builds `runtime` with the `hf_token` secret and `MODERATION_TEXT_ENABLED: "true"`, not `runtime-dev` / `"false"`.
  - The amended 0099 runbook (below).
  - `INDEX.md` wants summary updated.
  - The standards examples that cite `matcher.py`, `test_wants_matcher.py` and `_run_want_scan` (`backend/queries.md`, `global/error-handling.md`) are repointed at the matcher, or the dead reference is dropped.
- **FR-OPS-03** Re-measure forward, reverse (window) and suggestion cost with the previous task's harness, adapted to the matcher SQL. Include: EXPLAIN of the forward query showing `search_vector` / `name_folded` index conditions with the visibility views inlined and no function call per pair; the PRIVATE branch may be a correlated `OR EXISTS` SubPlan reached only for PRIVATE listings (H1); window cost at 10k wants; the largest `wants.bells_due` payload and handler time per row (L8). Write the results to this task's `implementation/measurement/results.md` and summarise them in the runbook.

## Visual Design
Mockups in `analysis/design-context/` are binding inputs — implementation-planner will attach `Visual References` to UI task groups. Fidelity: hi-fi HTML on the project tokens (`globals.css` `@theme static`, Bricolage Grotesque headings, Figtree body). Mobile-first, phone width.

| ID | Mockup | View state / component | Key elements |
|---|---|---|---|
| `screen:want-matching` | `analysis/design-context/mockups/want-detail-matching-pending.html` | `matching` in `WantMatchesView` | Unchanged header („‹ Szukam”, „Edytuj”, serif h1, summary) and notification toggle. `component:matching-status` row. 4 skeleton tiles in the match grid (`aria-hidden`) when no MATCH is stored; a resumed want's stored matches render instead. Validity line and ActiveActions („Znalezione — zamknij”, „Przedłuż”, „Wycofaj”) unchanged |
| `screen:want-matching-slow` | `…/mockups/want-detail-matching-slow.html` | `matchingSlow` | Dashed card (activeEmpty card style) with ⏳ (`aria-hidden`), heading „Wyniki pojawią się wkrótce”, text „Szukanie trwa dłużej niż zwykle. Zajrzyj tu za chwilę — damy też znać o nowych rzeczach.”, button „Odśwież teraz” (calls `refetch`). Card is `role="status" aria-live="polite"` |
| `screen:want-results` | `…/mockups/want-detail-suggestions.html` | `activeEmpty` with suggestions (also `active` with suggestions) | Existing empty card („Jeszcze nic nie pasuje”, „Damy znać, gdy ktoś doda pasującą rzecz.”). Below it a `<section aria-labelledby>` with heading „💡 Może Cię zainteresuje” (emoji `aria-hidden`), lead „Podobne rzeczy — brakuje im jednego słowa z Twojego „Szukam”.” and a grid of `component:suggestion-card` |
| `screen:want-results-matches-only` | `…/mockups/want-detail-matches-only.html` | `active` without suggestions | Count line („2 pasujące rzeczy”), MatchCards with „nowe” marker as today. **No** suggestions section rendered |
| `screen:wanted-list` | `…/mockups/wanted-list-pending-badge.html` | `WantedListView` card | A card with `matching` shows a small spinner (`aria-hidden`) and „Szukamy…” in a `role="status"` element in place of the count/new pills. Other cards unchanged („Jeszcze nic nie pasuje”, „3 pasujące”, „1 nowe”) |
| `component:matching-status` | `…/mockups/want-detail-matching-pending.html` | new `MatchingStatus` in `features/wanted/` | Inline row, `role="status" aria-live="polite"`. Spinner (`aria-hidden`, respects reduced motion), text „Szukamy pasujących rzeczy…” with sub-line „To zwykle kilka sekund.” |
| `component:suggestion-card` | `…/mockups/want-detail-suggestions.html` | new `SuggestionCard` in `features/wanted/` wrapping `ItemCard` | Same tile as MatchCard (thumb, name, „Stan: …”, mode pill, reserved caption). Dashed border, no „nowe” marker. Extra line „brakuje: „Claas”” (each missing word in „…” quotes). Click calls `markOpened` like MatchCard |

## Reusable Components

### Existing Code to Leverage
| What | Path | How |
|---|---|---|
| Match SQL shape: predicates, category-path CTE, haversine, ranking, ON CONFLICT, MATERIALIZED window CTE, CASE ordering, `<%` operand order | `src/backend/app/wants/application/matcher.py` (l.209) | Rewritten as raw SQL in `src/matcher` over `matchable_listings`/`private_group_peers`, then deleted from the backend |
| Sweep + marker window + log line | `src/backend/app/wants/application/scan.py` | Ported to the matcher window loop (marker compare-and-set instead of ORM versioning), then deleted |
| Lost-race / log policy | `src/backend/app/main.py::_want_scan_lost_a_race`, `_run_want_scan` | Same policy in the matcher loops; removed from main.py |
| Bell writer | `src/backend/app/wants/application/match_notifications.py::write_bell_rows` | Called by the new outbox handler; only the `MatchedPair` import changes (FR-BE-10) |
| Outbox handler pattern | `src/backend/app/notifications/outbox_listener.py` (`register()`), `app/outbox/registry.py::register_handler`, `app/outbox/dispatcher.py` (SKIP LOCKED, commit per entry) | Handler registration and dispatch; the matcher only inserts rows |
| Card select + read-time filter | `src/backend/app/wants/application/reads.py` (`visible_matches`, `_matches_select`, `list_matches`, `_match_counts`) | Tier filter added; `list_suggestions` reuses `_matches_select`; the bell handler reuses `visible_matches` |
| Want row load | `src/backend/app/wants/application/writes.py::_own_want` | Gains `for_update: bool = False` (`with_for_update(key_share=True)` → `FOR NO KEY UPDATE`) |
| Response schema | `src/backend/app/wants/schemas.py::WantMatchResponse`, `WantMatchMeta` | The suggestion response reuses `WantMatchMeta` |
| Membership / visibility rule (reference for the SQL copy) | `src/backend/app/groups/infrastructure/membership.py` (`active_membership_clause`, `active_leadership_clause`, `live_group_clause`, `group_ids_for`), `visibility.py::parties_share_group`, `owner_shares_group_with` | Source of `group_holdings`/`private_group_peers`, plus the parity test |
| `fold_pl`, trigram/FTS GIN indexes | migrations 0087, 0093, 0094 | Used by the text functions and the view; index expressions are kept |
| Listed-item conditions | `src/backend/app/inventory/infrastructure/repository.py::listed_items_with_product_select` | Live-item and balance conditions mirrored in `matchable_listings` |
| Test infra | `src/backend/tests/conftest.py` (postgres:18 testcontainer, alembic subprocess with `cwd=BACKEND_ROOT`) | Matcher conftest copies the pattern; also receives the relocated wants helpers |
| Clock / boundary guards | `src/backend/tests/test_domain_clock_guard.py`, `test_module_boundaries.py`, `test_worker_removed.py` | The matcher gets its own clock guard. The removed-scan test follows `test_worker_removed.py` |
| Measurement harness | `.maister/tasks/development/2026-11-15-szukam-wanted-mechanism/implementation/measurement/` (`seed_measurement.py`, `measurement_db.py`, `explain_match.py`, `polish_names.py`) | Seeding is reused. The EXPLAIN script is adapted to the matcher SQL strings |
| Polling pattern | `src/frontend/src/hooks/useItemDetail.ts:51` (function `refetchInterval`), test `src/frontend/src/test/useItemDetail.test.tsx:149` | Polling in `useWantMatches`/`useWants` |
| Tiles, empty card, list cards | `src/frontend/src/components/shared/ItemCard.tsx`, `features/wanted/MatchCard.tsx`, `WantMatchesView.tsx` (activeEmpty card), `WantedListView.tsx` | SuggestionCard wraps ItemCard. The slow card reuses the empty-card style |
| Dockerfile builder pattern | `src/backend/Dockerfile` (`builder` stage) | Matcher Dockerfile = builder + slim runtime, without the models/ml stages |

### New Components Required
| New | Why existing code can't be reused |
|---|---|
| Contract objects in 0099 (`words_pl`, `stem_word_pl`, `stem_pl`, `stem_query_pl`, generated columns, trigger + trigger function, views `group_holdings`/`private_group_peers`/`matchable_listings`, tier columns) | The matcher can't import `app.*` (Settings needs JWT_SECRET; the engine is built at import). The rules must live in the DB, which the backend owns |
| `src/matcher` package (`__main__`, `settings`, `clock`, `rules`, `db` startup gate/connection, `statements` SQL, `requests` loop with backoff, `window` loop, `outbox`) | It is a new process; nothing similar exists outside the backend |
| `app/wants/application/bells_due.py` (handler + `register()`), `app/wants/infrastructure/outbox_acl.py` (thin `register_handler` wrapper) | The bell writer was called inline by the scan, and the module boundary forbids importing `app.outbox` outside `infrastructure/` |
| `WantSuggestionResponse`, `list_suggestions`, `GET …/suggestions`, `NAME_NEEDS_A_WORD_MESSAGE`, lifespan contract check | No suggestion tier or stop-word rule exists today |
| `MatchingStatus`, `SuggestionCard`, `SuggestionsSection` (inside `WantMatchesView.tsx` unless it grows), slow card | New UI states from the mockups. `ItemCard` gets the smallest optional props for a dashed border and a footnote line; existing callers are unchanged |

## Technical Approach

**Data flow.** A seeker write sets `match_requested_at` and commits. The trigger NOTIFYs `wants_changed` at commit. The matcher request loop claims the want, inserts MATCH and SUGGESTION rows (seen, no bell) and clears the flag. The frontend polling sees `matching: false` and renders the results.
A new listing is picked up by the next window run (≤60 s), which inserts unseen MATCH rows and suggestions plus `wants.bells_due` outbox rows. The backend outbox poller (≤60 s) re-checks each pair's visibility and writes WANT_MATCH_FOUND, so the bell is ≤~2 min after listing. Expiry reminders take the same path.

**Inlining (H1).** Views are query rewrites, so `matchable_listings`, `group_holdings` and `private_group_peers` always expand into the calling query. No contract object used in a match predicate is a function. The PUBLIC branch is a plain column comparison at the call site and the PRIVATE branch an `EXISTS` over the peers view, which the planner keeps as a correlated `OR EXISTS` SubPlan reached only for PRIVATE listings (an `EXISTS` under an `OR` cannot become a semi-join); views inlined, no function call per pair. The forward query keeps plain `AND`s, so `search_vector @@ …` and `<%` stay index conditions. The reverse query keeps the MATERIALIZED window CTE (selected from the view) and the plain-columns-first `CASE`. The text functions are only evaluated when the generated columns are written and in the per-word check, where inlining doesn't matter.

**Per-word check.** `stem_words` is position-aligned with `words_pl(name)` by construction. For each position the matcher tests the prefix/exact lexeme against weight A, then the typo path for long words. A pair's hit count and missing positions come from one `unnest … WITH ORDINALITY` per candidate pair, and MATCH vs SUGGESTION is decided from those counts. Exact SQL is left to implementation; behaviour is pinned by the acceptance tests.

**Concurrency.**
- Request-loop claims and `update_want` both take `FOR NO KEY UPDATE`, so they serialise on the want row (H3). Window inserts only need the FK's `KEY SHARE`, which does not conflict, so they never wait behind a claim (L7). A rare deadlock (40P01) between window and request inserts on the same unique entry is a lost race (FR-MT-07) and self-heals.
- Compare-and-clear never erases a newer request.
- Clearing doesn't bump `updated_at`, so a seeker's loaded version stays valid.
- Expire and remind do bump `updated_at` (409 on a stale seeker write, as today).
- The suggestion cap is counted from the run's snapshot, so two concurrent runs can store slightly more than 10; `/suggestions` returns at most 10 (L7).

**Backend module boundary.**
- `outbox_acl.py` lives in `infrastructure/`.
- `bells_due.py` imports only `app.core`, `app.db` and `app.wants`.
- `main.py` remains the only importer of `app.wants`.

**Runbook: amended 0099** (replaces the „Deploy / rollback for wants (migration 0099)” section of `architecture.md`; M6). Commands run from the repo root; none prints configuration.
1. **Release gate** is unchanged and now scores the per-word rule (stems, stop-list, 4-char exact limit, 0.65).
2. **Build the new images first:** `docker compose build backend matcher web`.
3. **Detect an old-0099 DB:** `docker compose exec -T postgres psql -U aj -d aj -tAc "SELECT to_regclass('public.matchable_listings') IS NULL AND EXISTS (SELECT 1 FROM alembic_version WHERE version_num = '0099')"` → `t` means old 0099.
4. **Backup:** `docker compose exec -T postgres pg_dump -U aj -Fc aj > pre-wants-matcher.dump` (restorable thanks to H5).
5. **Old-0099 DBs only** (dev/test; deletes every want, match and WANT_* notification; nothing is rebuilt; acceptable only while 0099 is unreleased):
   1. `docker compose stop backend matcher` (the matcher may not exist yet; that is fine).
   2. `docker compose run --rm --no-deps backend alembic downgrade 0098` — `run` replaces the compose command, so uvicorn never starts; the new image's shape-tolerant downgrade runs.
   3. `docker compose run --rm --no-deps backend alembic upgrade head`.

   Do **not** run `docker compose up` before step 5.2: on an old-0099 DB the backend's `alembic upgrade head` is a no-op, its lifespan contract check (FR-BE-09) then refuses to start, and the matcher waits at its gate.
6. **Deploy:** `docker compose up -d --remove-orphans` with backend, web/frontend and matcher in one compose file. A pre-0099 DB migrates on backend start; the matcher waits at its startup gate until it passes.
7. **Verify.**
   - `alembic_version` = `0099`; the step-3 query returns `f`.
   - `\d wants` shows generated `stem_query`/`stem_words` and `match_requested_at`; `\dv` lists `matchable_listings`, `private_group_peers`, `group_holdings`.
   - Matcher log shows „listening”.
   - Create a want for a listed item's name. It shows „Szukamy…”, then the item within seconds.
   - `SELECT count(*) FROM wants WHERE match_requested_at IS NOT NULL` drains to 0.
   - `want_scan_markers.scanned_through` advances each minute.
   - `outbox_entries` rows of `wants.bells_due` reach PROCESSED.
8. **Rollback** (no image-only rollback, see Key Decisions):
   1. `docker compose stop backend matcher`.
   2. With the **new** image still built: `docker compose run --rm --no-deps backend alembic downgrade 0098`.
   3. Check out the old compose file and images and `docker compose up -d --remove-orphans`; without `matcher` in the old compose file, `--remove-orphans` removes it.
   4. Or restore the step-4 dump into a fresh DB with the matching image.
9. **Future changes.** Changing `fold_pl`, `words_pl` (incl. the stop-list) or `stem_word_pl` means a new revision with DROP/ADD of `name_folded`, `name_query`, `stem_query` and `stem_words`. Any revision that alters a column read by `matchable_listings`, `group_holdings` or `private_group_peers` (or DROP/ADDs `products.search_vector`) must drop and recreate the views in the same revision. Function bodies stay `public.`-qualified.
10. **Measured cost**: the summary table from FR-OPS-03 goes here.

## Implementation Guidance

### Testing Approach
- 2-8 focused tests per implementation step group. Test verification runs only the new and changed tests of that group, not the entire suite. A final full run happens at verification.
- **Acceptance cases (matcher, fixed, must pass):**
  - kurtka zimowa → „Kurtka na zimę” = MATCH
  - kurtka na zimę → „Kurtka zimowa” = MATCH (not SUGGESTION „brakuje: „na””) (M3)
  - rower dla dziecka → „Rower biegowy dla dziecka” = MATCH; `dla` never counted (M3)
  - Traktor Bruder Claas → „Traktor bruder Deutz” = SUGGESTION, `missing_words = {Claas}`
  - Traktor na Bruder → „Traktor bruder Deutz” = MATCH, and never a SUGGESTION (only 2 want words) (M3)
  - rowerek biegowy → „Rower biegowy dla dziecka” = MATCH
  - kurtka zimowa → „Kurtka przejściowa” = none
  - traktor bruder → „Koparka Bruder” = none
  - kurtka ↛ „Kurtyna prysznicowa”
  - lego ↛ „Legowisko dla psa”
  - kurtka zimowq → „Kurtka zimowa” = MATCH via the typo path (0.714); kurtka zimowq ↛ „Kurtka na zimę” (0.429) (L6 fixture pinned)

**Backend (`src/backend/tests`).**
| File | Change |
|---|---|
| `conftest.py` | Receives `_Owner`, `_want` and `_product` from the deleted `test_wants_matcher.py` (imported by ≥3 files; standard rule) (M4) |
| `test_wants_migration.py` | Extend: round trip new→new. **Old-shape downgrade (C1):** from head, transform to the old-0099 shape (drop the three views, the trigger and trigger function, `stem_query`, `stem_words`, `match_requested_at`, `tier`, `missing_words`, the four text functions; add `short_words_query tsquery`), keep `alembic_version = 0099`, run `alembic downgrade 0098` in the subprocess → succeeds and no wants table remains; `upgrade head` + `engine.dispose()` in `finally`. Contract objects exist. Pinned `words_pl`/`stem_word_pl`/`stem_pl`/`stem_query_pl` examples incl. diacritics, hyphen, digits, stop-words, a quote and `İ` (L1). Generated columns follow a name update. **H5:** under `SET LOCAL search_path = ''`, `INSERT INTO public.wants …` and `UPDATE public.wants SET name` succeed. **Trigger (L9):** committed data on an engine connection, asyncpg LISTEN on a second connection: NOTIFY on insert and on setting the flag, none on clearing it; rows deleted in `finally`. The downgrade deletes WANT_* rows |
| `test_wants_api.py` | Rewrite: create returns `matching: true`, counts 0, no `want_matches` written. Stop-words-only name („na i z”) → 400 with the message on create and update (FR-BE-08). The 503 timeout test is deleted. 409 deadlock mapping kept. A matching-field PATCH deletes pairs of both tiers and the unread bell, and re-flags. A note-only PATCH does not re-flag. Statement-count assertions updated. `_Owner` from conftest |
| `test_wants_edit_concurrency.py` (new, H3) | Committed seed on the session engine (not `db_session`), cleanup in `finally`. A second connection locks the want `FOR NO KEY UPDATE` and inserts a pair (simulated matcher run); the PATCH is started, then the simulator commits; afterwards no `want_matches` row remains and `match_requested_at` is set |
| `test_wants_lifecycle.py` | Resume flags and keeps old matches; the cap path stays. The three `scanWants` sweep tests (l.246, 272, 322) move to the matcher's `test_sweep.py`; the `_scan` import is removed (M4) |
| `test_wants_matches_api.py` | Seed `WantMatch` rows directly with tiers. `/matches` returns MATCH only. `/suggestions` exact key set with `missing_words`, filtered by the read-time visibility, ≤10, 404 for a foreign or withdrawn want. Counts MATCH only. `matched_item_id` both tiers. `opened` works on a suggestion |
| `test_wants_bells_due.py` (new; moves `test_scanWants_oneNewPair…` and `test_scanWants_unreadRow…` and `test_closeWithdrawnOrMatchingEdit_afterAScan…` from `test_wants_notifications.py`, plus the `_bell_rows`/`_pointer` helpers) | Handler via `dispatch_pending` over a raw-inserted outbox row. Writes a bell for MATCH pairs. Skips SUGGESTION and deleted pairs. **Skips a pair whose item the seeker can no longer see (owner left the shared PRIVATE group) — no product name written** (H2). Two chunk rows for one want sum into one unread row. Expiring wants. Failure leaves no partial notification rows (savepoint) and increments `attempts`. Close/withdraw/matching-edit after a handler run deletes the unread match row only |
| `test_wants_notifications.py` | Keeps the `createNotifications`/`deleteUnreadNotifications`/`checkText` cases; scan cases moved; imports `_Owner`/`_want` from conftest |
| `test_wants_visibility_parity.py` (new, H2) | `EXISTS(private_group_peers)` vs `parties_share_group(owner, seeker, private_only=True)` for every case: standing membership both sides; standing and ended membership; current and ended leadership; **ended GroupRole with standing Membership / current Leadership**; **wrong role type** (MEMBER role behind a Leadership, ORGANIZATOR role behind a Membership); **owner member × seeker leader and the reverse**; soft-deleted PRIVATE group; **shared PUBLIC group + unshared PRIVATE group**; PUBLIC group only; no shared group; plus the full call-site rule vs `items_visible_to(ALL)` restricted to non-counterparty, non-own items for a PUBLIC and a PRIVATE listing |
| `test_membership_definition_guard.py` | Module docstring names the SQL copy (`group_holdings`/`private_group_peers` in `0099_wants.py`) and the parity test |
| `test_wants_scan_removed.py` (new, `test_worker_removed.py` style) | `app.wants.application.matcher`/`scan` not importable; the lifespan schedules no want job; the `wants.bells_due` handler is registered; the lifespan refuses to start when `matchable_listings` is missing (FR-BE-09) |
| `test_authorization_matrix.py` | Row for `GET /api/wants/{id}/suggestions` (login READ; guest 401) |
| `test_wants_matcher.py`, `test_wants_scan.py` | Deleted from the backend; cases ported to the matcher; their shared helpers relocated as above |

**Matcher (`src/matcher/tests`).** The conftest copies the backend pattern: postgres:18 testcontainer, then `alembic -c ../backend/alembic.ini upgrade head` run with `cwd=../backend` (script_location is cwd-relative) and `DATABASE_URL` set. Raw-SQL seed helpers. Tables truncated between tests, because cross-connection LISTEN/claim tests need committed data.
| File | Covers |
|---|---|
| `test_text_rules.py` | The acceptance cases above; 4-char exact; stop-words never in `missing_words`; description words ignored; `SHOW pg_trgm.word_similarity_threshold` = 0.6 on a matcher connection (M2) |
| `test_forward.py` | Ported predicates: offer, category ancestor, locality and radius, PRIVATE shared/not shared, own item, takeable, top 20. Born seen with `source = FORWARD`. No outbox row. Compare-and-clear keeps a newer flag. `updated_at` untouched. Two concurrent claimers never process one want twice |
| `test_suggestions.py` | Wants of ≥3 want words only (stop-words not counted). ≥2 hits and exactly 1 missing. Cap 10 in total across runs. `missing_words` in original case. Never in the outbox |
| `test_window.py` | Window pairs unseen with `source = SCAN`. Outbox rows and `want_matches`/`want_scan_markers` rows with every NOT NULL column set (checked against `information_schema`) (L2). >1000 pairs → two outbox rows, `expiring` only in the first (L8). Marker advance and overlap. Advisory-lock skip. A window insert for a want held by a claim does not wait (L7). Forward ≡ reverse on the same fixture (ported) |
| `test_sweep.py` | Ported from `test_wants_lifecycle.py` (M4): at/past end → EXPIRED with `closed_at` at its end; last week → reminded once per period, also when muted, again after an extend (simulated by SQL); closed 30 days ago → purged with its matches, active kept, bell rows stay. All bump `updated_at`; reminded wants go into `expiring` |
| `test_loop.py` | NOTIFY wakes processing. The poll catches a want flagged without NOTIFY. **A want whose statement fails does not block a second flagged want in the same drain, and is retried only after its backoff** (H4). The startup gate waits for a missing contract. A lost race logs WARNING. Other errors logged once and the loop continues |
| `test_constants_drift.py` (M5) | Parses `src/backend/app/wants/domain/limits.py` with `ast` (no import) and asserts its `REMINDER_LEAD` equals `rules.REMINDER_LEAD`, and that none of the moved names remain there. `stem_query_pl` gives an exact lexeme for a `SHORT_WORD_MAX_CHARS`-char word and a prefix for one char more |
| `test_clock_guard.py` | Only `matcher/clock.py` reads the clock |

**Frontend (`src/frontend/src/test`).**
| File | Covers |
|---|---|
| `wantMatchesViewState.test.ts` | `it.each` rows for `matching` (with and without stored matches), `matchingSlow`, active/activeEmpty with suggestions, closed without suggestions, stale/refresh-error rows |
| `WantMatchesView.test.tsx` | Pending `role="status"` text; skeleton only without stored matches. Slow card and „Odśwież teraz” calling refetch. Suggestions heading, cards and „brakuje: „Claas””. Matches-only shows no section |
| `useWantMatches.test.tsx` | Fetches suggestions. `refetchInterval` 2000 while matching and `false` when not matching. The 60 s end flips `slow` without new data: this test fakes `Date`, `setTimeout` and `clearTimeout` and advances with `act(() => vi.advanceTimersByTime(60_000))`, using no `findBy*` (documented exception to the Date-only rule, L4). Refetch restarts the window |
| `useWants.test.tsx` | List polling while any want is matching; stops after the window |
| `WantedListView.test.tsx` | „Szukamy…” status instead of counts |
| `fixtures/wants.ts` + key-set tests | `matching`, typed `wantSuggestion()` factory |

### Standards Compliance
- `.maister/docs/standards/backend/migrations.md`:
  - reversible downgrade in reverse dependency order, shape-tolerant for the amended revision
  - `SET LOCAL lock_timeout = '5s'`
  - explicit `ix_`/`ck_` names
  - a downgrade-then-upgrade test (plus the old-shape downgrade test)
  - the runbook in `architecture.md`
- `.maister/docs/standards/backend/models.md`: new columns mapped on `Want`/`WantMatch`; generated columns not written.
- `.maister/docs/standards/backend/queries.md`: bound parameters only in raw SQL, set-based statements. The FROM-linter example is repointed.
- `.maister/docs/standards/backend/time.md`: naive UTC timestamps; the matcher clock guard mirrors `test_domain_clock_guard.py`.
- `.maister/docs/standards/global/error-handling.md`:
  - 40P01/40001 → 409 in writes
  - one WARNING and a retry next run in background loops (request loop: after backoff)
  - `logger.exception` otherwise, never re-raised
  - the example is repointed to the matcher
- `.maister/docs/standards/global/validation.md`: server-side 400 for a stop-words-only name with a specific Polish message.
- `.maister/docs/standards/global/minimal-implementation.md`:
  - dead code removed (matcher, scan, text_queries, timeout path, thresholds, moved constants)
  - no matcher feature flags or abstractions beyond the loops
- `.maister/docs/standards/testing/backend-testing.md`: real postgres:18, exact key sets, 2–8 tests per feature, `test_<operation>_<scenario>_<expected>` naming, helpers imported by ≥3 files in `tests/conftest.py`.
- `.maister/docs/standards/testing/frontend-testing.md`: typed fixtures without casts, Date-only fake timers (one documented exception), `createQueryWrapper`.
- `.maister/docs/standards/frontend/components.md`: one `resolveWantMatchesView` with new kinds, the page switches on `view.kind`.
- `.maister/docs/standards/frontend/accessibility.md`: `role="status"`/`aria-live="polite"` for pending and slow, decorative glyphs `aria-hidden`, headed suggestions section.
- `.maister/docs/standards/frontend/css.md` and `responsive.md`: Tailwind tokens only, mobile-first.

## Out of Scope
- A separate DB role or login for the matcher.
- Rescanning items that become takeable later (PRIVATE→PUBLIC, cancelled reservation, product rename). This remains a documented known limit.
- Description words for MATCH. They are also not used for SUGGESTION in this task.
- Switching backend search/visibility (`items_visible_to`) to the SQL views.
- Running the release-gate labelling itself (the gate still blocks deploy).
- A NOTIFY on the outbox side or a shorter outbox poll.
- Paging of the match or suggestion lists.
- A persistent (DB) backoff for failing wants; a configurable stop-list.

## Success Criteria
- **AC-01** All acceptance cases (Testing Approach) pass in the matcher suite.
- **AC-02** POST/PATCH(matching field)/resume write no `want_matches` row in the request and return `matching: true`. The matcher clears the flag and stores results within seconds in the compose stack. A stop-words-only name is rejected with 400.
- **AC-03** Forward results are born seen with no outbox row. A window MATCH produces `wants.bells_due` rows (≤1000 pairs each), and the backend writes WANT_MATCH_FOUND only for pairs the seeker may still see. Suggestions never produce a bell.
- **AC-04** `/matches` and the counts are MATCH-only. `/suggestions` returns cards with `missing_words`, ≤10 per want. `matched_item_id` covers both tiers.
- **AC-05** The visibility parity test passes on every case listed for `test_wants_visibility_parity.py`.
- **AC-06** The backend has no want scheduler job, `matcher.py`, `scan.py`, `text_queries.py`, 503 forward-timeout path, `short_words_query` or matcher-only constants.
- **AC-07** The matcher image builds without HF_TOKEN. The service waits for the contract, survives a DB restart, two copies produce no duplicate pairs or outbox rows, and a failing want does not delay others.
- **AC-08** The frontend renders the five mockup screens and two components. Polling stops at ~60 s with the slow card, and „Odśwież teraz” resumes it.
- **AC-09** Measurement is recorded. The forward path still uses both text indexes through the views with no opaque visibility filter, and reverse, suggestion and handler costs are stated against the previous numbers (forward ≤17 ms; reverse ~12 ms per listing at 10k wants).
- **AC-10** The runbook and docs are updated, including the explicit `docker compose run` downgrade/upgrade commands, the no-`up`-before-downgrade warning, deploy order, verify and rollback (no image-only rollback), both runtime/runtime-dev fixes and the 60 s docstring.
- **AC-11** The new downgrade succeeds on both the new and the old 0099 shape, and a want insert/update succeeds under an empty `search_path`.

### Requirement coverage (`analysis/requirements.md`)
- Same DB/login: FR-OPS-01. Amended 0099: FR-DB-01..07 and the runbook.
- Raw SQL and no `app.*`: FR-MT-01. Backend keeps the API and bells: FR-BE-04..07.
- Per-word 0.65: FR-MR-02. Stop-words (user decision): FR-DB-01, FR-BE-08, FR-MR-*. Pending/NOTIFY/compare-and-clear/`matching`: FR-DB-02/03, FR-MT-04, FR-BE-05.
- Born seen vs window bell: FR-MT-04/05. Parity test: Testing. DB stemming: FR-DB-01/02.
- Suggestions ≥3 words, ≤10, no bell, name only: FR-MR-03/04. API tiers: FR-BE-06/07.
- Polling 2 s / 60 s and list badge: FR-FE-02..06. Expire/remind/purge in the matcher: FR-MT-05.
- Startup wait: FR-MT-03. Duplicates: FR-MT-09. Tests run backend alembic: Testing. Close prompt includes suggestions: FR-BE-06.
- Compose/runbook/docs/doc drift: FR-OPS-01/02. Re-measure: FR-OPS-03.
- Mockups: Visual Design (5 screens + 2 components).

## Audit resolution
| Finding | Resolution | Where |
|---|---|---|
| C1 old-0099 downgrade fails | Shape-tolerant downgrade (`IF EXISTS` for views/functions, new-only objects dropped with their tables); old-shape downgrade test; explicit `docker compose run` commands | FR-DB-07, runbook 3–5, `test_wants_migration.py`, AC-11 |
| H1 `can_see_listing` does not inline | Function removed; PUBLIC branch at the call site, PRIVATE branch `EXISTS` over view `private_group_peers` (single named definition); EXPLAIN in measurement | FR-DB-05, FR-MR-01, Technical Approach „Inlining”, FR-OPS-03 |
| H2 PRIVATE rule incomplete, bell bypass | Full rule (live GroupRole, MEMBER/ORGANIZATOR, live PRIVATE group, either side member or leader); extended parity cases; bell handler re-checks via `visible_matches` | FR-DB-05, FR-BE-04, `test_wants_visibility_parity.py`, `test_wants_bells_due.py` |
| H3 edit keeps old-criteria pairs | `update_want` locks the want `FOR NO KEY UPDATE` before delete; concurrency test | FR-BE-01, `test_wants_edit_concurrency.py` |
| H4 failing want starves queue | In-memory backoff map, claim skips backing-off ids; loop test | FR-MT-04, FR-MT-10, `test_loop.py` |
| H5 unqualified calls break restore | `public.`-qualified bodies; empty-`search_path` test | FR-DB-01/02/03, `test_wants_migration.py`, AC-11 |
| M1 wrong drop order | Views → tables → trigger function and text functions; trigger function named | FR-DB-03, FR-DB-07 |
| M2 `<%` operands reversed | `want.name_folded <% l.name_folded`; GUC default pinned | FR-MR-02, `test_text_rules.py` |
| M3 function words count | User decision: 24-word stop-list in `words_pl`; stop-words-only name → 400; new acceptance examples; `ę`/`ą` short-word exception so „zimę” matches „zimowa” | FR-DB-01, FR-BE-08, Testing acceptance cases |
| M4 broken cross-file imports | `MatchedPair` in `match_notifications.py`; `_Owner`/`_want`/`_product` to conftest; named tests moved to `test_wants_bells_due.py` / `test_sweep.py` | FR-BE-10, backend and matcher test tables |
| M5 duplicated constants | `matcher/rules.py` single home; moved names deleted from backend; drift test for `REMINDER_LEAD` + behavioural 4-char pin | FR-BE-02, FR-MT-10, `test_constants_drift.py` |
| M6 runbook gaps | Explicit commands, no `up` before downgrade, backend contract fail-fast, no image-only rollback, deploy order | Runbook, FR-BE-09, Key Decisions |
| L1 tokenizer edge cases | `words_pl` on the raw name, stems mapped over the same array; quoted lexemes; ≥1-word guard (400 + predicate) | FR-DB-01, FR-BE-08, FR-MR-01 |
| L2 NOT NULL on raw inserts | Every NOT NULL column without default set for outbox, `want_matches`, `want_scan_markers`; test | FR-MT-06, `test_window.py` |
| L3 view soft-delete condition | Live item, listing preference row, live place stated | FR-DB-06 |
| L4 frontend details | `matching` carries stored matches; markSeen behaviour stated; list keeps „Szukamy…” after the window; timer-driven `slow` with its test | FR-FE-02..05, frontend tests |
| L5 `architecture.md:503` | Fixed together with l.125 | FR-OPS-02 |
| L6 typo fixture | Pinned to „Kurtka zimowa” (+ negative vs „Kurtka na zimę”) | Acceptance cases |
| L7 lock contention | Claims `FOR NO KEY UPDATE`; window statement timeout 30 s; deadlock = lost race; `/suggestions` LIMIT 10 | FR-MT-04/05, Technical Approach „Concurrency”, FR-BE-07 |
| L8 payload size | ≤1000 pairs per outbox row; measured | FR-MT-05, FR-OPS-03 |
| L9 NOTIFY test | Committed data on engine connections, cleanup in `finally` | `test_wants_migration.py` |
