# Spec audit: Wants matcher service (pre-implementation)

## TL;DR
**Verdict: Non-Compliant (fail), but every issue can be fixed by amending the spec. No redesign is needed.** Counts: Critical 1, High 5, Medium 6, Low 9.
- All 7 acceptance examples come out as the spec expects. I checked each one with read-only SQL on the local PG 18.4.
- The amended-0099 procedure breaks on the very databases it targets.
- `can_see_listing` cannot inline as specified.
- The PRIVATE rule text and its parity test leave out conditions.
- The forward path can keep pairs from the old criteria after a seeker edit.
- A want that keeps failing can block the request queue.

## Key Decisions
- **C1 is rated Critical.** The prescribed upgrade path (new-image `downgrade 0098` on an old-0099 DB) is the only route the runbook gives for existing DBs, and as written it fails.
- **pg_dump restore (H5) is rated High, not Critical.** It only bites when a dump is restored, but it makes the runbook's `pg_dump -Fc` safety net unreliable.
- **The user-final decisions were not re-litigated:** amend 0099, login `aj`, per-word 0.65, the 4-char exact rule, and the 60 s / 2 min window. The findings only cover how those decisions are specified and implemented.
- **Inlining was checked empirically.** I created `pg_temp` functions inside a transaction that was then `ROLLBACK`ed. Nothing persisted, and no data or schema changed.

## Open Questions / Risks
- Short function words (`na`, `dla`, `z`, `w`) currently count as want words (M3). Is „kurtka na zimę” → „Kurtka zimowa” meant to be a SUGGESTION with „brakuje: „na””?
- Is an image-only rollback meant to go to a pre-0099 image or to the old-0099 image (M6)? Only the first is viable.
- In the `matching` / `matchingSlow` states of a resumed want, should its existing matches be hidden behind the skeleton (L4)?

---

## Sanity check of the text rules (read-only SQL, local postgres 18.4, `en_US.utf8`)

`word_similarity(fold_pl(a), fold_pl(b))`:

| want word(s) | item name | ws | Relevance |
|---|---|---|---|
| kurtka zimowa | Kurtka na zimę | 0.588 | Whole-name score; the original bug (<0.70) |
| zimowa | Kurtka na zimę | 0.429 | Typo path alone would miss it; the stem path is needed |
| claas | Traktor bruder Deutz | 0.000 | Missing word → SUGGESTION ✔ |
| Traktor Bruder Claas | Traktor bruder Deutz | 0.714 | Whole name would wrongly pass 0.70; per-word is correct ✔ |
| traktor | Koparka Bruder | 0.000 | none ✔ |
| kurtka | Kurtyna prysznicowa | 0.571 | < 0.65 ✔ |
| lego | Legowisko dla psa | **0.800** | Would pass 0.65; the „no typo path for ≤4 chars” rule is required ✔ |
| zimowq | Kurtka zimowa | 0.714 | Typo test hits only against this name (see L6) |
| zimowq | Kurtka na zimę | 0.429 | |

Weight-A tsquery over `setweight(to_tsvector('simple', fold_pl(name)),'A')`:
- `kurtk:*A & zim:*A`: „Kurtka na zimę” t, „Kurtka przejściowa” f.
- `rower:*A & bieg:*A`: „Rower biegowy dla dziecka” t.
- `kurtk:*A`: „Kurtyna prysznicowa” f.
- `lego:A`: „Legowisko dla psa” f, „Klocki Lego Duplo” t.
- `traktor:*A & bruder:*A`: „Koparka Bruder” f.
- `zim:*A`: „Zimny kompres” **t**. This is the false positive the spec already accepts.
- `simple` parser on „Rower-biegowy 2w1 dla 3-latka”: `rower-biegowy, rower, biegowy, 2w1, dla, 3, latka`.
- `regexp_split_to_array(..., '[^[:alnum:]]+')` on the same name: `{rower,biegowy,2w1,dla,3,latka}`. The two are compatible.

**Result:** all 7 acceptance cases (AC-01) behave as expected under FR-DB-01, FR-MR-02 and FR-MR-03.

---

## Critical Issues

### C1. The amended-0099 downgrade cannot run on a DB at the old 0099
- **Spec reference:** Runbook step 2.2 („Run `alembic downgrade 0098` from the new image”) and FR-DB-07.
- **Evidence:**
  - The amended 0099 has the same revision id, so the new image's `downgrade()` runs against the old schema.
  - The old schema is in `src/backend/alembic/versions/0099_wants.py:56-148`: `short_words_query` exists, and there is no view, function, trigger, `ix_want_matches_want_id_tier` or tier check.
  - FR-DB-07 says the downgrade drops the view, functions and trigger. A plain `DROP VIEW matchable_listings` / `DROP FUNCTION stem_pl(text)` / `op.drop_index("ix_want_matches_want_id_tier")` raises „does not exist”. That aborts the migration transaction, and the DB stays at the old 0099.
  - `test_wants_migration.py`'s round trip only ever runs new→new, so it cannot catch this.
- **Category:** Unimplementable as written.
- **Severity:** Critical. This is the only upgrade path the runbook gives for every existing DB, and it is the precondition of the user-final „amend 0099” decision.
- **Recommendation (either option):**
  - (a) Write every drop of a new object as `IF EXISTS` (`DROP VIEW IF EXISTS`, `DROP FUNCTION IF EXISTS`, `op.drop_index(..., if_exists=True)`), and add a test that rebuilds the old shape and then runs `downgrade 0098`. One way to rebuild it: drop the new objects and add `short_words_query`.
  - (b) Change the runbook to run the downgrade from the **old** image, before switching images.

---

## Important Gaps (High / Medium)

### H1. `can_see_listing` with a single-expression body does **not** inline
- **Spec reference:** FR-DB-05 („a single-expression body so it inlines”), Technical Approach „Inlining”, Risk „must inline so the GIN indexes stay usable”.
- **Evidence:**
  - PostgreSQL's scalar-function inliner rejects any body that has sublinks (`hasSubLinks`). The PRIVATE branch needs `EXISTS` over memberships and leaderships.
  - I verified this locally, in a transaction that was then rolled back:
    - `pg_temp.csl(seeker, item)` with `SELECT EXISTS (SELECT 1 FROM item_listing_preferences …)` produces a plan with `Filter: pg_temp.csl(p.owner_party_id, p.item_id)`. It is not inlined.
    - `pg_temp.csl2(seeker, vis)` with `SELECT vis = 'PUBLIC' OR EXISTS (…)` is also not inlined.
    - `pg_temp.plain(vis)` with `SELECT vis = 'PUBLIC'` is inlined to `Filter: ((p.visibility)::text = 'PUBLIC'::text)`.
  - As specified, `can_see_listing(seeker, item)` also handles PUBLIC and looks the listing up again by item id. That means one opaque SQL-function call, with its own subqueries, for every candidate pair. On the reverse window that is up to 10k wants × the window's listings. It doesn't stop index use on the other predicates, but it is a large per-pair cost that the measurement plan assumes away.
- **Category:** Incorrect assumption.
- **Severity:** High. The design premise is wrong, and the performance of the reverse path and suggestions (AC-09) is at risk.
- **Recommendation:**
  - Keep `visibility = 'PUBLIC' OR …` inline at the call sites (or in the view).
  - Express the PRIVATE branch so it can inline. Options: an inlinable `LANGUAGE sql STABLE RETURNS TABLE/SETOF` function used in `FROM`/`EXISTS` (set-returning SQL functions with one `SELECT … FROM` *can* inline), or a view of „party ↔ party via a live PRIVATE group”.
  - Add the EXPLAIN check to FR-OPS-03.

### H2. The PRIVATE rule is under-specified, the parity cases are incomplete, and the bell text bypasses the read-time filter
- **Spec reference:** FR-DB-05 („active membership or leadership, group not soft-deleted”) and the `test_wants_visibility_parity.py` row.
- **Evidence:**
  - `src/backend/app/groups/infrastructure/membership.py:20-37`: „active” also requires `GroupRole.id == from_role_id`, `GroupRole.role_type` MEMBER or ORGANIZATOR, and `GroupRole.valid_to IS NULL`.
  - `visibility.py:41-60`: both parties must be in the *same* live group, filtered to PRIVATE.
  - The spec text and the parity cases cover neither the ended `GroupRole` with a standing Membership/Leadership nor the role-type mismatch. They also don't cover mixed sides (owner a member, seeker the leader) or „shares only a PUBLIC group plus a non-shared PRIVATE one”. A SQL copy written from the spec text would leak.
  - The read-time `visible_matches` filter (`reads.py:37-56`, using `items_visible_to`) protects lists and counts, but not bells. `write_bell_rows` (`match_notifications.py:144-215`) puts the **product name** in the single-match message and does no visibility check. So a stored leaked pair reaches the seeker through the bell.
- **Category:** Missing requirement / Ambiguous.
- **Severity:** High (privacy).
- **Recommendation:**
  - State the full rule in FR-DB-05.
  - Add these parity rows: ended GroupRole, wrong role type, member×leader cross, PRIVATE deleted group, shared PUBLIC + unshared PRIVATE.
  - Either re-check visibility in the `wants.bells_due` handler, or state that the bell relies only on the SQL copy.

### H3. A seeker edit during a forward run keeps pairs for the old criteria
- **Spec reference:** Technical Approach, Concurrency („A seeker PATCH … waits briefly on the row lock. It then deletes the fresh pairs and re-flags the want.”).
- **Evidence:**
  - `writes.py:225-240`: `update_want` mutates the ORM object, then runs `delete(WantMatch)` **before** `db.flush()`. `_own_want` (`writes.py:118-128`) is a plain `SELECT`, not `FOR UPDATE`.
  - Under READ COMMITTED the DELETE does not see the matcher's uncommitted inserts, and does not wait for them. Only the following `UPDATE wants` blocks on the matcher's `FOR UPDATE`.
  - After the matcher commits, the backend's UPDATE passes its `updated_at` version check, because clearing doesn't bump it. The backend then commits with the matcher's old-criteria pairs still stored.
  - The re-run only adds pairs („not stored yet”), so the stale pairs stay. `/matches` shows them, because the read-time filter checks visibility, not text.
- **Category:** Incorrect assumption about existing code.
- **Severity:** High. The behaviour the spec asserts is untrue, and the test plan doesn't cover it.
- **Recommendation:**
  - In FR-BE-01, require the edit to take the want's row lock first: `_own_want(..., for_update=True)` for matching-field edits, or flush the want update before the DELETE.
  - Add a concurrency test to `test_forward.py` or `test_wants_api.py`.

### H4. Oldest-first claim plus immediate retry can block the request queue
- **Spec reference:** FR-MT-04 („drains flagged wants … oldest `match_requested_at` first”, 30 s statement timeout) and Risk „Pathological want … retried every poll”.
- **Evidence:**
  - A want whose statement times out or errors rolls back, keeps its flag and its oldest timestamp, and loses its lock.
  - The next claim in the same drain picks it again (SKIP LOCKED no longer skips it). The drain either spins on it, each pass costing up to 30 s, or never gets past it.
  - Other wants starve, and their UI goes to `matchingSlow`.
- **Category:** Missing requirement.
- **Severity:** High. One bad want degrades matching for everyone.
- **Recommendation:**
  - Exclude ids that failed in the current drain (`AND id <> ALL(:failed)`), or add a backoff (e.g. an in-memory „retry after” per id).
  - Add a `test_loop.py` case: a failing want does not block a second want.

### H5. The stem functions resolve `fold_pl` / `words_pl` through `search_path`, which breaks `pg_dump` restore
- **Spec reference:** FR-DB-01 / FR-DB-02 (generated columns over `stem_pl` / `stem_query_pl`), Runbook step 3.1 `pg_dump -Fc`, and „no SET clauses” in Technical Approach.
- **Evidence:**
  - The restore script runs with `search_path = ''`. Stored generated columns are recomputed on COPY, by calling `public.stem_pl(name)`. Its string body calls `words_pl(fold_pl(...))` unqualified, which fails with „function … does not exist”, and the COPY of `wants` fails.
  - Existing generated columns are not affected. `fold_pl` (`0087_fold_pl.py:36-41`) only calls `pg_catalog` functions.
- **Category:** Missing requirement.
- **Severity:** High. The runbook's backup could not be restored once wants exist.
- **Recommendation:**
  - Schema-qualify the inner calls (`public.fold_pl`, `public.words_pl`), or use SQL-standard `BEGIN ATOMIC` bodies, which are parsed at creation and also record dependencies. These functions don't need to inline.
  - Add a migration test: `SET LOCAL search_path = pg_catalog` followed by `INSERT INTO public.wants …`.

### M1. The downgrade order in FR-DB-07 is wrong
- **Evidence:**
  - The generated columns record dependencies on `stem_pl` / `stem_query_pl`, so dropping those functions before `wants` errors. The trigger's `RETURNS trigger` (plpgsql) function also isn't listed among the contract objects (FR-DB-03 says only „calls `pg_notify`”).
  - The correct order is: view → (trigger, dropped with its table) → tables → trigger function, `can_see_listing`, `stem_query_pl`, `stem_pl`, `words_pl`.
- **Severity:** Medium. The round-trip test would catch it.
- **Recommendation:** Fix the order, and name the trigger function.

### M2. The `<%` operands are reversed in FR-MR-02
- **Evidence:**
  - The spec writes `name_folded <% want.name_folded` (listing on the left). The current code has `Want.name_folded.bool_op("<%")(listing.name_folded)` (`matcher.py:209`), which means `word_similarity(want, listing) ≥ pg_trgm.word_similarity_threshold`.
  - The reversed form is a different predicate, `word_similarity(listing, want)`. It is still indexable through `<%`, so nothing would fail, but the candidate set changes silently.
- **Severity:** Medium.
- **Recommendation:** Write `want.name_folded <% name_folded`, and note that it depends on the 0.6 GUC default.

### M3. Short function words count as want words (MATCH, SUGGESTION, candidates)
- **Evidence:**
  - FR-MR-02 requires *every* word, and FR-MR-03 counts words from `words_pl`. „kurtka na zimę” (3 words) vs „Kurtka zimowa” therefore gives a SUGGESTION „brakuje: „na””, and „rower dla dziecka” behaves the same way.
  - The „OR-of-stems prefix query” candidate set also includes `'na':A`, `'dla':A`, `'z':A`. These match a large share of all items, so the forward candidate set and the per-word verification cost grow sharply. The forward baseline is ≤17 ms.
- **Severity:** Medium. Not covered by the acceptance cases, but visible to users and costly.
- **Recommendation:** Clarify the intent (a stop-list, or a ≥3-char minimum for counting), or keep the words but leave them out of the OR candidate query. Add a pinned test.

### M4. The test plan misses broken cross-file imports, and `write_bell_rows` is not actually „unchanged”
- **Evidence:**
  - `match_notifications.py:37` has `from .matcher import MatchedPair`, and `matcher.py` is deleted.
  - Helpers from the deleted test files are imported elsewhere:
    - `_Owner`: `test_wants_api.py:33`, `test_wants_lifecycle.py:22`, `test_wants_matches_api.py:28`, `test_wants_notifications.py:32`
    - `_want`: `test_wants_notifications.py:32`
    - `_scan`, `_bell_rows`, `_pointer`: `test_wants_lifecycle.py:23`, `test_wants_notifications.py:33`
  - `test_wants_lifecycle.py:246/272/322` are three `scanWants` sweep tests that must move to `test_sweep.py`. The spec's lifecycle row only says „resume flags…”.
  - `test_wants_notifications.py:236` „…afterAScan” uses `_scan` to create the bell.
- **Severity:** Medium.
- **Recommendation:**
  - Move `MatchedPair` (e.g. into `match_notifications.py` or `domain`).
  - Move `_Owner` and `_want` into `tests/conftest.py` or a `tests/wants_helpers.py`. The standard requires conftest once three or more files import a helper.
  - List the moved lifecycle tests.

### M5. Constants are duplicated across the two processes with no single source
- **Evidence:**
  - The backend keeps `REMINDER_LEAD` (`limits.py:18`, used in the message text at `messages.py:51` „wygaśnie za 7 dni”).
  - The matcher needs its own `REMINDER_LEAD`, `RETENTION` (`limits.py:20`, which becomes dead in the backend), `MATCH_TOP_N` 20, the suggestion cap 10, 0.65 and the 4-char limit. Some of these are partly in SQL.
  - The spec names none of these locations and has no drift guard.
- **Severity:** Medium.
- **Recommendation:** List the matcher constants module. Delete `RETENTION` / `VALIDITY`-only leftovers from the backend if nothing uses them. Add a small parity test, for example one that reads both files as text.

### M6. The runbook doesn't cover the backend starting on an old-0099 DB, or which image a rollback goes to
- **Evidence:**
  - Compose runs `alembic upgrade head && uvicorn` (`docker-compose.yml:27`). On an old-0099 DB this is a no-op, so the new backend serves against the old schema (missing `match_requested_at` → 500s).
  - Only the matcher has a contract gate.
  - The runbook doesn't say *how* to run the downgrade without the backend starting, e.g. `docker compose run --rm backend alembic downgrade 0098`.
  - Step 5 offers an „image-only” rollback. That only works to a **pre-0099** image, where the old code ignores the tables. An old-0099 image maps `short_words_query`, so every `Want` select fails.
- **Severity:** Medium.
- **Recommendation:** Add the explicit commands. Say that `up` before the downgrade leaves a broken backend, and restrict image-only rollback to pre-0099 images. Optionally make the backend fail fast on a missing contract.

---

## Minor Discrepancies (Low)

- **L1. Tokenizer edge cases.**
  - `missing_words` uses `words_pl(want.name)[pos]`, aligned with `words_pl(fold_pl(name))`. `lower()` can change a character's class (e.g. `İ` → `i̇`, whose combining mark is not alnum), and that misaligns positions.
  - `[:alnum:]` depends on the locale (fine on `en_US.utf8`, which I verified).
  - A name with no PG-alnum words, which Python `isalnum` can still accept (`validation.py:20`), makes „every word hits” vacuously true. Guard with „≥1 word”.
- **L2. NOT NULL columns in raw inserts.** `want_matches` and `want_scan_markers` raw inserts must also set `id`, `created_at` and `updated_at`, which are NOT NULL with no default (`0099_wants.py:43-52`). FR-MT-06 states „every column” only for the outbox. The outbox column list itself matches `app/outbox/models.py` and the 0083 precedent.
- **L3. View definition.** FR-DB-06 should state explicitly that the item is live (`inventory_items.deleted_at IS NULL`) and has a listing preference row, as `listed_items_with_product_select` (`inventory/infrastructure/repository.py:276-311`) does.
- **L4. Frontend.**
  - `matching` takes precedence over `active`, which hides a resumed want's old matches.
  - `WantMatchesView.tsx:40-51` snapshots `newIds` and sends `markSeen` once at first load. Window pairs that arrive during polling are never marked „nowe” or seen.
  - The list polling has no slow state, so a card says „Szukamy…” until a refresh.
  - `slow` must re-render when the 60 s window ends, even if no data changes; fake timers that fake only `Date` won't drive a `setTimeout`.
- **L5. Second doc mismatch.** `architecture.md:503` repeats the same runtime-dev/`MODERATION_TEXT_ENABLED "false"` mismatch as l.125. FR-OPS-02 fixes only l.125.
- **L6. Typo-test fixture.** The typo test („zimowq”) must use a name like „Kurtka zimowa” (0.714). Against „Kurtka na zimę” it scores 0.429. Pin the fixture.
- **L7. Lock contention and deadlock.**
  - A window INSERT for a claimed want waits on the FK `KEY SHARE` behind the claim's `FOR UPDATE` (up to 2×30 s).
  - With a conflicting unique-index entry, this can deadlock (40P01). That is self-healing through FR-MT-07.
  - No statement timeout is specified for the window run.
  - The suggestion cap can be exceeded slightly across concurrent runs (count snapshot).
- **L8. Large outbox payloads.** One `wants.bells_due` row can carry up to 20 × active-wants pairs. That is acceptable, but it should be noted in the measurement.
- **L9. Trigger NOTIFY test.** The NOTIFY test in `test_wants_migration.py` needs committed data on an engine connection. The rollback-only `db_session` fixture never delivers a NOTIFY.

## Clarification Needed
1. Should function words count (M3)? If not, which list, or what length limit?
2. What is the image-only rollback target: pre-0099 or old-0099 (M6)?
3. What does a resumed want with existing matches show while `matching` (L4)?
4. Should the bell handler re-check visibility (H2), or is the SQL copy plus the parity test the accepted only guard?

## Extra Features
None. Every element of the spec traces to `analysis/requirements.md` or `analysis/scope-clarifications.md`.

## Verified as correct (no finding)
- All cited paths exist: `app/outbox/{dispatcher,registry,scheduler,models}.py`, `notifications/outbox_listener.py`, `groups/infrastructure/{visibility,membership}.py`, `tests/test_membership_definition_guard.py`, `test_worker_removed.py`, `test_domain_clock_guard.py`, `alembic/env.py`, compose, Dockerfile `builder` stage, `useItemDetail.ts:51` / `useItemDetail.test.tsx:149`, and the measurement harness under `…/2026-11-15-szukam-wanted-mechanism/implementation/measurement/`.
- **Dispatcher:** an unhandled type becomes PROCESSED, and a handler error increments `attempts` and commits *without* rollback (`dispatcher.py:61-76`). FR-BE-04's `begin_nested()` is therefore necessary and correct.
- **Single poller:** there is one outbox poller (`main.py:149`) and no `event_types` split, so `wants.bells_due` is claimed by the process that registers it.
- **Alembic from the matcher venv:** `alembic/env.py` uses an async engine (`+asyncpg` URL) and no `app.*` import; migrations import only sqlalchemy/alembic/stdlib (0083 loads sibling revisions by file path). Running the backend alembic from the matcher venv with `cwd=src/backend` works.
- **Mockups vs spec:** the five binding mockups match the Visual Design table (texts, `role="status"`/`aria-live`, `aria-hidden` glyphs, `aria-labelledby` section, „brakuje: „Claas””, „Szukamy…” list badge).
- **Optimistic locking:** clearing without bumping `updated_at` is compatible with `version_id_col` (`base_model.py:61-67`). Expire/remind/`_point_wants_at_rows` keep bumping it (`scan.py:41-66`, `match_notifications.py:121-141`).

## Recommendations (in order)
1. C1: make the downgrade work on the old schema, or prescribe the old image for it, and add a test.
2. H3 + H4: lock-before-delete in `update_want`, and a per-drain failure exclusion or backoff.
3. H1 + H2: restructure `can_see_listing` so it can inline, with the PUBLIC check at the call site. Write out the full membership rule and extend the parity cases.
4. H5 + M1: qualified or `BEGIN ATOMIC` function bodies, and the correct drop order.
5. M2 to M6: fix the operand order, clarify function words, update the test-relocation list and `MatchedPair`, set up the constants home and parity, and harden the runbook commands.
