# Specification audit

Spec audited: `implementation/spec.md` (pre-implementation mode). Report returned by the `spec-auditor` subagent and saved by the orchestrator. Nothing was run (no tests, no migration, no `EXPLAIN`); every finding comes from reading code and the binding sources.

## TL;DR
- Verdict: **pass-with-concerns**. Nothing is unimplementable and no binding decision is contradicted; 0 Critical, 3 High, 12 Medium, 17 Low.
- The three High items sit in the two riskiest areas: the short-word query has no mechanism that can meet its own rule, the scan's set-based updates do not produce the 409 the spec promises, and a set-based insert into a `BaseEntity` table has a primary-key trap.
- The Medium items are mostly ambiguities where two implementers would build different things (top-20 ranking, delete-only bell path, "nowe" markers, shared form controls, category names).
- The visibility predicate with a seeker column, the `<%` direction, the matrix rows, the protected prefixes and the boundary rule all check out against the code.

## Key Decisions
- Compute `short_words_query` in SQL from `to_tsvector('simple', fold_pl(name))`, not in Python (H1).
- State that every set-based scan/sweep `UPDATE` on `wants` also sets `updated_at`, or drop the 409 claim and re-read the pointer in SQL inside PATCH (H2).
- State `include_defaults=False` plus explicit `gen_random_uuid()`, `created_at`, `updated_at` for the `INSERT ... SELECT` into `want_matches` (H3).
- Say whether already-stored pairs are excluded before or after the top-20 ranking (M1).
- Give the notifications module an explicit delete-only path for FR-N-06 (M2).
- Add `owner_party_id <> seeker` to the read-time filter (M3).
- Complete the ACL lists of FR-X-02: `SwapProposal`, `SwapProposalStatus`, `ItemCondition`, `newest_open_reservation_starts_at` (M4).
- Fix the "nowe"-marker mechanism against whole-prefix invalidation (M5).
- Define what the want form reuses from the search location section and offer chips, and add the `LocalityCombobox` placeholder prop (M6, M7).
- Name the database and the name distribution for the `EXPLAIN ANALYZE` step (M10).
- Replace the word "default" on OQ2, OQ3 and OQ4 with "decided" (L1).

## Open Questions / Risks
- **Short words and Polish prepositions (not re-litigating the rule).** The `'simple'` configuration has no stop words, so "dla", "na", "do", "od", "po", "ze" become mandatory exact tokens in the trigram branch and mandatory words in the full-text branch. The form's own placeholder "Np. kask rowerowy dla dziecka" would not match a listing "Kask rowerowy dziecięcy". The labelled sample should include such names.
- **Reverse-scan cost.** There is no index on the want side, so the largest measured point is 500 listings × 10,000 wants = 5 million pairs. Each pair evaluates `fold_pl(p.name)` (a `regexp_replace`, `0087_fold_pl.py`) up to twice. The auditor's estimate is that the 2 s budget fails there; FR-T-30 will show.
- **OQ1 (scan statement timeout)** stays open; the default "none" is workable because the app runs a single uvicorn process (`src/backend/Dockerfile:50`).
- **OQ5 / OQ6** stay open; the findings below add concrete items to them (M8, M9, L5, L6, L9, L10).
- **Unverified here:** whether a `Computed` `TSQUERY` column survives an ORM insert through asyncpg. The migration round trip of FR-T-10 does not exercise that path (L13).
- **Stale pairs after a concurrent edit.** A scan statement that started before a PATCH commits can store pairs for the old name after the PATCH reset; the window is one statement long. Accept or note it.

## Findings

### Critical
None.

### High

| id | Spec ref | Finding | Evidence | Recommended change |
|---|---|---|---|---|
| H1 | FR-D-01 `short_words_query`; FR-M-03 | The column is "written with the name" by the application, yet "must be the token set the `'simple'` parser produces for `fold_pl(name)`". No mechanism is given. A Python split cannot reproduce the PostgreSQL parser: for "kurtka 3-5 lat" the parser yields `'3'` and `'-5'`, so a Python-built `3 & 5 & lat` never matches an identical product name. | Spec FR-D-01; `products.search_vector` is built with `to_tsvector('simple', fold_pl(...))` in `alembic/versions/0088_*.py:33-36` | Build the value in SQL in the write statement: lexemes of `to_tsvector('simple'::regconfig, fold_pl(:name))` with length ≤ 3, joined with `&`. Add a test with a hyphenated or numeric name. |
| H2 | Risks ("the user then gets the existing 409"); FR-S-02 steps 1, 2, 6; FR-S-06 | The scan uses set statements. A Core `UPDATE` does not run `version_id_generator`, so `wants.updated_at` does not change and a concurrent ORM PATCH sees no conflict. Result: a matching-field PATCH that loaded the want before the scan committed deletes by the old pointer, resets the pointer, and leaves the scan's new unread bell row orphaned with a stale count. Likewise `extend` racing the expire sweep ends as `EXPIRED` with a future `expires_at`. | `app/core/base_model.py:63-68` (version only through the mapper); `app/core/errors.py:124-131` (409 only on `StaleDataError`) | State that every set-based update of `wants` in the scan sets `updated_at = :now`. Alternatively make PATCH delete the bell row through a sub-select of the current pointer and drop the 409 claim. Add one race test. |
| H3 | FR-M-01; Data model ("set-based inserts supply the `BaseEntity` columns that have no server default") | `Insert.from_select()` defaults to `include_defaults=True`, which evaluates a Python callable default once for the whole statement. `id` has `default=uuid.uuid4`, so every inserted pair gets the same id and the second row violates `pk_want_matches`. The spec's sentence steers the implementer to leave `id` to its server default, which this behaviour overrides. | `app/core/base_model.py:49-56` | Specify `include_defaults=False` and explicit `gen_random_uuid()`, `created_at`, `updated_at` in the select. Same note for the batched notification insert. |

### Medium

| id | Spec ref | Finding | Evidence | Recommended change |
|---|---|---|---|---|
| M1 | FR-M-04, FR-M-05, FR-L-06, FR-S-03 | It is not said whether pairs already stored take part in the top-20 ranking. If they do, resume / reopen usually inserts nothing new. If they are excluded first, a pair "outside the top 20 of its run" is re-matched in the 5-minute overlap, against FR-M-05. | Spec FR-M-04 "per want, per run, the 20 best pairs" | Choose one. Suggested: an anti-join on stored pairs before `row_number()` and a reworded FR-M-05. |
| M2 | FR-N-02, FR-N-06 | FR-N-06 deletes the unread row "through the same writer path", but the writer of FR-N-02 always inserts a new row per entry. There is no delete-only form. | Spec FR-N-02 vs FR-N-06; `app/notifications/service.py:22-28` has no delete today | Allow an entry without a new row, or add a second exported function `delete_unread(ids)`. Adjust "the writer's two statements" in FR-T-13. |
| M3 | FR-M-07, FR-A-11 | `items_visible_to` has an own-item branch. After a GIFT hand-over the seeker owns the item; if they list it again, it shows in their own match list and counters, because the stored pair still exists. | `app/groups/infrastructure/visibility.py:107`; `app/groups/models.py:349-352` | Add `owner_party_id <> seeker_party_id` to the read-time filter. |
| M4 | FR-X-02 | The ACL contents read as exhaustive but miss names the spec itself needs: `SwapProposal` and `SwapProposalStatus` for the own `EXISTS` of FR-A-12; `ItemCondition` and `newest_open_reservation_starts_at` for `meta.condition` and `meta.reserved_until` of FR-A-08. | `app/search/infrastructure/inventory_acl.py:10-22`; `app/groups/infrastructure/repository.py:945-949` | Add the four names. Note that `schemas.py` may import types only through the module's own ACL, as `app/search/schemas.py:15-16` does. |
| M5 | FR-F-33 vs FR-F-04 | "Seen" must refresh the counters, yet the "nowe" markers must stay for the visit. `useWantMatches` lives under the same key prefix and mutations invalidate the whole prefix, so the refetch returns `is_new = false` and the markers vanish. "Called once" also needs a guard against effect re-runs. | Spec FR-F-04 "await invalidation of the whole prefix" | State the mechanism: keep the ids that were new on first load in page state, and guard the call with a ref. Pin both in FR-T-24. |
| M6 | FR-F-63, FR-F-21 | The search location section has more than the mockup's want form shows: a heading "Lokalizacja", an "Ostatnio: …" chip from localStorage, `MajorTownPicker`, and a default of +10 km on pick. The offer chips also differ: search has two toggles labelled "Oddam" / "Zamienię" that switch off; the form has three exclusive chips "Obojętnie" / "Oddam" / "Zamiana". | `features/search/SearchFilters.tsx:141-214, 403-422`; `utils/appHelpers.ts:72`; mockup `wanted-form.html` | Say which parts the want form shows, its default radius on pick, and whether it writes the remembered locality. Consider sharing only the radius chips and style constants; a shared offer-chip component has little in common. |
| M7 | FR-F-21, FR-F-60..64 | The mockup placeholder "Cała Polska — wpisz, aby zawęzić" cannot be rendered: `LocalityCombobox` hard-codes "Nazwa lub kod pocztowy". The change is not in the shared-component list. | `components/shared/LocalityCombobox.tsx:168` | Add an optional `placeholder` prop (default unchanged) to FR-F-6x and FR-T-29. |
| M8 | FR-F-12, FR-F-15, FR-F-31, API want fields | The response carries `category_id` and `locality_name` but no category name or path. The list and match page must then load the whole category tree (about 580 KB, `app/main.py:147`) to print one name. Also, the list mockup shows the root "Zabawki" for the want whose match page shows "Zabawki › Pojazdy dla dzieci"; FR-F-15 picks the node's own name. | Mockups `wanted-list.html`, `wanted-matches.html` | Decide: add `category_name` / `category_path` to the response, or name `useCategories` as the source. Confirm with the user which name the card shows. |
| M9 | FR-F-54 | "Zamknij" closes several wants with one request each. After a partial failure the sheet stays open; a retry then gets 409 "już zamknięte" for the ones already closed, so the error never clears. | Spec FR-F-54; FR-A-20 close-of-non-ACTIVE row | Specify: treat 409 / 404 as done, or re-run the lookup before retrying. |
| M10 | FR-T-30 | The measurement names sizes but not the database or the name distribution. Seeding 20,000 items into a developer database pollutes it. Random names make the trigram selectivity meaningless. | Spec FR-T-30 | Require a disposable PostgreSQL 18 with `alembic upgrade head`, names drawn from realistic Polish product names, and no connection string printed (secrets rule). |
| M11 | FR-M-01, FR-T-30 budgets | See the reverse-scan cost under Risks. The only stated remedy is "tighten plain-column pre-filters", which does not remove the per-pair `fold_pl(p.name)` call. | `alembic/versions/0087_*.py` (function body); high-level design L257 (no want-side index) | Allow the reverse direction to fold product names once per listing (for example a materialised CTE of the window's listings) while the predicates stay shared. Record this as the first lever. |
| M12 | FR-N-08 | "A want with the switch off still stores pairs and counts them" does not say which count. If it means `match_notification_count`, the next bell row after re-enabling sums the muted period. | Spec FR-N-08 vs FR-N-03 | State that only `new_match_count` grows while muted; the pointer and bell count are untouched. |

### Low

| id | Spec ref | Finding | Evidence | Recommended change |
|---|---|---|---|---|
| L1 | Open Questions table; FR-A-20; FR-F-34; FR-F-42 | OQ2, OQ3 and OQ4 are settled by the user but the spec still calls them "default". | Spec L27-29 | Mark as decided. |
| L2 | FR-F-42 (OQ4) | Today's prompt sentence has a suffix for scope "mine" (" Możesz też szukać wszędzie."). The spec does not say whether it stays. | `features/search/SearchView.tsx:270-273` | State it. |
| L3 | FR-S-02 step 4, FR-S-04 | On the very first run two racing processes hit `uq_want_scan_markers_scan_name` (an `IntegrityError`, not `StaleDataError`). The first window is also unclear: 15 minutes, or 15 + 5. `StaleDataError` arises only if the marker is written through the ORM. | Spec FR-S-04 | Say the marker is an ORM entity; state the first window; accept or catch the `IntegrityError`. |
| L4 | FR-W-03, FR-W-04, AC-11 | The caller's profile load (two statements) is missing from the create order; AC-11 requires zero statements before the text checks. | `app/users/service.py:84-95` | Place the profile load after the checks in FR-W-04. |
| L5 | FR-X-03, FR-D-01 | Files under `domain/` may import only `app.wants.domain`. A state machine there cannot import a status enum defined in `models.py`. | `tests/test_module_boundaries.py:74-78` | Say the enum lives in `domain/` and `models.py` imports it. |
| L6 | FR-A-08 | The match list has no limit or paging; pairs accumulate at up to 20 per run for 90 days. | Spec FR-A-08 | Confirm "unbounded" or add a cap. |
| L7 | FR-W-02 | "Rules apply to the merged state": a PATCH that clears the locality while a radius is stored is a 400 unless the radius is also sent. Also silent on whether unchanged reference ids are re-validated. | `standards/backend/models.md` (unchanged ids not re-validated) | State both. |
| L8 | FR-A-10 | The 404 message for an unknown pair is not given. | Spec FR-A-10 | Add it to FR-A-20. |
| L9 | FR-F-13, FR-F-32, FR-F-35 | Where a failed extend / close / resume / toggle shows its message (toast, inline) and whether the toggle reverts is not stated. The switch has no stated accessible name. | Spec FR-F-32 | Specify; name the switch by the visible row label. |
| L10 | FR-F-53 | The mockup sheet has `aria-label="Zamknąć poszukiwanie?"` beside the title "Znalezione?"; the spec gives only the title. | Mockup `close-want-sheet.html` | State the `ariaLabel`. |
| L11 | FR-F-52 | "Zobacz rzecz" in `TakeSuccessSheet` links to the current item page and does not call `onClose`; the prompt would then never open. | `features/product/TakeSuccessSheet.tsx:68-73` | Decide whether that link also closes the sheet. |
| L12 | FR-T-18, FR-X-15 | "`product_path` parity with the groups link shape": the groups builder runs database statements; the search copy is pure. | `app/search/domain/links.py:14-16` | Name the comparison target. |
| L13 | FR-T-10 ("proves O1") | The migration test proves the column exists and is filled, not that an ORM insert and the match statement work with it through asyncpg. | `app/product/models.py:63-72` (the `tsvector` precedent) | Say O1 is proven by FR-T-10 plus one create-and-match test. |
| L14 | AC-07, FR-T-30 | At 5,000 products the planner may rightly choose a sequential scan, failing "the forward plan uses the trigram index" for a benign reason. | Spec AC-07 | Bind the check to the 20,000-item size. |
| L15 | Testing Approach | FR-T-11 and FR-T-15 each list about 16-18 pins; the backend standard asks for 2-8 scenario tests per feature. | `standards/testing/backend-testing.md:70` | Tell the planner to group pins into scenario tests. |
| L16 | FR-S-02 steps 1 and 3 | After more than 30 days of downtime a want is expired and purged in the same run; the user never sees the expired state. The reminder text says "za 7 dni" whatever the real remainder. | Spec FR-S-02 | Accept and note. |
| L17 | FR-D-13 | "A pointer to the new guide" assumes this workflow writes a user guide; the same sentence makes that conditional. | Spec FR-D-13 | Make the pointer conditional too. |

## Verified claims
- **Seeker column in the group predicate works at runtime.** `_held_by` accepts any `SQLColumnExpression`, and the nested selects use `correlate_except`, so a `wants` column correlates through all levels. Only the annotations need widening (`membership.py:18,48-51`; `visibility.py:41-59`).
- **`item_listing_preferences` must be joined unaliased.** `owner_shares_group_with` and `items_visible_to` are fixed over the unaliased entity.
- **`<%` direction is right.** `ix_products_name_trgm` is GIN on `fold_pl(name)`, the right operand (`0094_*.py:32`, `app/product/models.py:87-92`). With one want as the outer row the planner can use it as a parameterised scan; nothing sets `pg_trgm.word_similarity_threshold`.
- **Generated columns are valid in principle.** `fold_pl` is `IMMUTABLE` (`0087`), and the two-argument `plainto_tsquery` is the form already used in `search.py:204`.
- **Takeable and "reserved by me".** `listed_items_with_product_select` returns `reserved_by_user_id` (account user id); `with_pending_proposer` exposes only the oldest proposer, so the own `EXISTS` is needed.
- **Notifications model.** Kind is non-native `VARCHAR(30)`, recipient is a party, message 500, link 255; both new kind names fit. `create_notification` neither flushes nor returns.
- **A deleted bell row is harmless on click.** The hook swallows mark-read errors (`hooks/useNotifications.ts:59`); pending actions react to two kinds only (`pendingActions.ts:59-65`).
- **Routing.** `/wanted` and `/add/` are in `PROTECTED_PREFIXES` (`routing/paths.ts:129-146`); conversations rows 53-54 exist as the template and the spec correctly adds PATCH.
- **Boundary rule.** The router's needs (`Principal`, `get_db`, `get_storage`) come from `app.core`, `app.db`, `app.storage`, all allowed. Nothing specified needs `app.config`.
- **Other confirmed facts.** `alembic/env.py` has `target_metadata = None`, head is 0098; `CategoryTreePicker` already has a `placeholder` prop; `useItemTake` has the three success paths the spec describes; the stale `PLEDGE_ITEM_REGISTERED` exists only in the union and its test; Polish copy in the spec matches the eight mockups except M7, M8 and L10.

## Coverage check
- **Requirements, scope decisions, corrections.** Every row of `requirements.md`, C1, I1-I14 and X1-X16 has a matching FR. P1-P13 are covered.
- **Design ids.** All 11 ids of the mockup INDEX are mapped.
- **Missed or thin.** The delete-only bell path (M2); the own-item case at read time (M3); the `LocalityCombobox` placeholder (M7); the category name source (M8).
- **Scope creep.** None found. `ix_want_matches_item_id`, `opened_at`, `score` and `source` come from the high-level design. The offer-chip extraction is the one place where the shared component may be forced (M6).
- **Internal contradictions.** FR-F-33 vs FR-F-04 (M5); FR-N-06 vs FR-N-02 (M2); the 409 risk statement vs set-based scan writes (H2); FR-D-01 application-written `short_words_query` vs its own parser rule (H1).

## Counts by severity
- Critical: 0
- High: 3
- Medium: 12
- Low: 17
