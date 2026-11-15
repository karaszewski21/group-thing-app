# Gap Analysis: "Szukam" (wanted) mechanism

## TL;DR
- Today there is no wants backend at all; the frontend has a demo (`/wanted`, `/add/hunting`, `MOCK_WANTS`) that stores nothing. The whole capability is missing; the design plus the 16 corrections of the codebase analysis describe a buildable target.
- The design leaves one operation without a placed control: the per-want notification switch has a backend field and a PATCH but no screen. One critical decision.
- 13 smaller decisions remain (important, each with a default): the five carried over from Phase 1, the test baseline, the old user guide, and six found here in the user journey and data lifecycle (counter meaning, stale bell rows, entry links, several wants for one item, prefilled name, release gate).
- No account deletion, user blocking or notification purge exists in the code, so those lifecycle cases need no work now; a deleted category sets the want's category to null by the designed foreign key.
- Risk medium, effort high. No scope expansion is recommended.

## Key Decisions
- Characteristics: creates new entities, modifies existing code, involves data operations, UI heavy; no reproducible defect — the task replaces a labelled demo, it does not repair broken behaviour.
- Change type additive, compatibility moderate — no existing write path changes; the only removed surface is the demo route `/add/hunting` (P12, no redirect).
- All takes go through one place (`features/product/useItemTake.ts`, used only by `features/product/blocks/ItemPickupActions.tsx`), so a closing prompt owned by the item page covers every take in the application.
- A person's Organization is not a separate owner party for items (`get_own_organizations_by_party_ids` maps a person party to its Organization), so `owner_party_id <> seeker_party_id` is enough to exclude own items.
- Search treats a missing radius and radius 0 as the same thing (`search.py:179`, `radius_km=filters.radius_km or 0`), and the frontend sends no `radius` parameter for "Tylko tu". This is the basis of the null recommendation below.

## Open Questions / Risks
- Thresholds 0.70 / 0.60 stay unmeasured at the end of this task; a merge that is deployed makes the feature live with guessed values (decision I13).
- Stored counters and the match list can disagree, because pairs are stored once and filtered only at read time (decision I6).
- `wants.seeker_party_id` has no `ON DELETE` rule. Nothing deletes a party today; when account deletion is built, wants must be handled there (the design lists this as out of scope).
- `wants.locality_id` is `RESTRICT`: a future refresh of the locality dictionary that removes a row is blocked by wants in the same way as by saved places.
- A category can be deleted by an admin only when it has no children and no products (`app/category/service.py:242-251`); the want then loses its category by `SET NULL` and silently moves to the strict threshold.
- Three of the frontend test files this task edits already fail on HEAD (project memory, HEAD b8c45e0); without a recorded baseline a regression cannot be told from an old failure (decision I11).

## Summary
- **Risk Level**: Medium
- **Estimated Effort**: High
- **Detected Characteristics**: modifies_existing_code, creates_new_entities, involves_data_operations, ui_heavy

## Task Characteristics
- Has reproducible defect: no
- Modifies existing code: yes
- Creates new entities: yes
- Involves data operations: yes
- UI heavy: yes

Paths below: backend relative to `src/backend/`, frontend relative to `src/frontend/src/`.

## Gaps Identified

### Missing Features
- **Backend module `app/wants`**: does not exist. No table, route, model or test for wants. Needed: models, schemas, router, application (writes, reads, matcher, scan), domain (limits, thresholds, state machine, links), nine ACL files.
- **Migration 0099**: head is 0098. Three tables, hand-written (`alembic/env.py:19` has `target_metadata = None`), two generated columns on `wants`.
- **Match statement**: no column form exists of the radius rule, the category ancestry or the group-sharing predicate; search binds these as Python values.
- **Scan job**: `app/main.py` has no wants job; no scheduler job catches `StaleDataError` today (X3).
- **Notification kinds and writer**: `NotificationKind` has no `WANT_MATCH_FOUND` / `WANT_EXPIRING`; `app/notifications/service.py` has no delete-unread-then-insert writer and no delete function of any kind.
- **Moderation fields**: `TextField` has no `WANT_NAME` / `WANT_NOTE`.
- **Authorization rows**: no `/api/wants` rows in `app/core/authorization_matrix.py`.
- **Frontend feature `features/wanted`**: no list, form, match list or closing prompt; no `api/wants.ts`, `hooks/useWants.ts`, `hooks/useWantMatches.ts`; no routes `/wanted/[id]`, `/wanted/[id]/edit`, `/add/wanted`.
- **Shared controls**: the location section and offer-mode chips are private to `features/search/SearchFilters.tsx` (X12).

### Incomplete Features
- **Demo list `/wanted`** (`features/search/WantedView.tsx`): renders `MOCK_WANTS` with an inline add form and local state. Needs the real list with counters and actions.
- **Demo form `/add/hunting`** (`features/add/HuntingCreateView.tsx`): reads `?name=`, stores nothing, limits 120 / 1000, native `disabled` submit. Needs the real form at `/add/wanted` with limits 3-80 / 300 and `aria-disabled`.
- **"Konto" row** (`features/account/AccountView.tsx:42-46`): shows `MOCK_WANTS.length`. Needs real counts.
- **Empty-search link** (`features/search/SearchView.tsx:260-281`): passes only `?name=`. Needs category, offer mode, locality and radius too.
- **`ItemCard`** (`components/shared/ItemCard.tsx`): has `reservedCaption` but no slot for a "new" marker (X11).
- **Per-want notification switch**: designed as a column and a PATCH field; no screen is named for it (decision C1).
- **Entry to edit and to create from the list**: the route `/wanted/[id]/edit` is designed, but the design's action list for the match page (extend, found, withdraw, resume) has no "edit", and the list page has no stated link to the form (decision I8).

### Behavioral Changes Needed
- `parties_share_group` / `owner_shares_group_with` (`app/groups/infrastructure/visibility.py:41-59`): from value-only annotations to accepting a column. No runtime change.
- Bell: from "every row is inserted once and only ever marked read" to "an unread match row of a want is deleted and a new one inserted" (clarification 2). First delete path in `app.notifications`.
- `/add/hunting`: from a working demo page to no route (P12).
- Item page after a take: from toast or success sheet only, to an extra closing prompt when the item is a stored match of an active want (personal and term / event takes only, clarification 3).
- `BottomNav` highlight: today an exact path match; `/wanted/:id` and its edit page highlight no tab (decision I5).

## User Journey Impact Assessment

| Dimension | Current | After | Assessment |
|-----------|---------|-------|------------|
| Reachability | `/add` tile to `/add/hunting`; "Konto" row to `/wanted`; empty-search link. All lead to a demo. | Same three entries to real screens, plus the bell row to the item or to `/wanted/:id`. | OK |
| Discoverability | 7/10 (visible tile and row, but the promise "Damy znać" is not kept) | 8/10 (counters on tile and row, bell rows) | +1 |
| Flow Integration | Dead end: nothing is saved. | Search to form to match list to item page to take; closing prompt after a take. | OK, with decisions C1, I6-I10 |
| Multi-persona | Guest reaches the link, lands on login. | Guest: login or registration keeps the query (C4). Logged-in user: full flow. Admin: no special role. Item owner: no change in v1 (ADR-001). | OK |

Journey findings:
- A seeker with results that are not what they want has no link to the form from the search page; only the empty state has one. This follows the user's choice of 9A over 9B (ADR-013) and is not raised as a decision.
- A single-match bell row links straight to the item page, so the counter on the list stays until the match list is opened. The design states that the bell and the counter are independent; not raised.
- The search query allows 0-100 characters (`app/search/router/search.py:50`), a want name 3-80. A name prefilled from search can be invalid on arrival (decision I12).

## Data Lifecycle Analysis

### Entity: Want

| Operation | Backend | UI | Access | Status |
|-----------|---------|-----|--------|--------|
| CREATE | Missing today. Designed: `POST /api/wants`. | Missing today (demo form). Designed: form at `/add/wanted`. | `/add` tile (`features/add/AddView.tsx:75`), empty-search link; link from the list not stated (I8). | Designed complete |
| READ | Missing today. Designed: `GET /api/wants`, `GET /api/wants/{id}`. | Demo list. Designed: list `/wanted`, page `/wanted/:id`. | "Konto" row, bell row, redirect after save. | Designed complete |
| UPDATE | Missing today. Designed: `PATCH`, `/extend`, `/resume`. | Designed: form at `/wanted/:id/edit`; extend and resume buttons. Switch: no control named. | Edit link not stated (I8); switch not placed (C1). | Partial |
| DELETE | Missing today. Designed: `POST /close` (withdraw is the delete), purge after 30 days. No DELETE route by design. | Withdraw with `ConfirmDeleteDialog`. | Match list page. | Designed complete |

### Entity: Want match (system-written)

| Operation | Backend | UI | Access | Status |
|-----------|---------|-----|--------|--------|
| CREATE | Forward match at create / edit / resume; scan every 15 minutes. | none needed | none needed | Designed complete |
| READ | `GET /api/wants/{id}/matches`, `GET /api/wants?matched_item_id=`. | Match list cards; closing prompt. | `/wanted/:id`; item page after a take. | Designed complete |
| UPDATE | `POST .../matches/seen`, `POST .../matches/{item_id}/opened`. | Automatic on opening the page / a card. | same | Designed complete |
| DELETE | Cascade on purge; delete on edit of a matching field (P10). | none | none | Designed complete |

### Entity: Notification rows of the two new kinds

| Operation | Backend | UI | Access | Status |
|-----------|---------|-----|--------|--------|
| CREATE | New writer in `app.notifications`, called by the scan. | Bell (kind union grows by two). | Top bar. | Designed complete |
| READ | Existing list, newest 50 (`app/notifications/repository.py:13`). | `components/shared/NotificationBell.tsx`: click marks read and follows `link_path`. | Top bar. | Exists |
| DELETE | Only as part of the replace (clarification 2). No rule for rows of a closed, withdrawn, edited or purged want. | — | — | Partial (I7) |

**Completeness**: 0% today (demo only). 75% as designed (UPDATE is incomplete: the switch has no control). 100% once C1 and I8 are decided.

**Orphaned Operations**:
- Today: CREATE and READ exist in the UI with no backend (the demo).
- As designed: `notifications_enabled` — backend field and PATCH, no UI control named (C1).

**Missing Touchpoints**:
- Link from the list `/wanted` to the form, and from `/wanted/:id` to the edit form (I8).
- Bell rows pointing at a want that was withdrawn, purged or reset by an edit (I7).

**Lifecycle cases checked in code**:
- Account deletion: no code path deletes a user, profile or party (search for delete / anonymise in `app/`: only media delete routes). Nothing to do now.
- User blocking: no such concept in `app/`. Nothing to exclude in the matcher.
- Category deletion: admin-only, refused with children or products; otherwise the want's `category_id` becomes null by the designed `ON DELETE SET NULL`.
- Notification purge: none exists; rows of the new kinds live until read state only, and the bell shows the newest 50.
- Seeker leaves a private group: the stored pair stays, the read-time filter hides the item (I6 covers the counter).

## Issues Requiring Decisions

### Critical (Must Decide Before Proceeding)

1. **C1 — Where the per-want notification switch is shown.** The user decided "a switch per want" (ADR-009); the design stores it and accepts it in PATCH, but no screen shows it. Without a control the field cannot be changed by anyone.
   - Options: [A] Toggle on the match list page `/wanted/:id`, saved at once with PATCH. [B] Field in the form (create and edit), saved with the form. [C] Both. [D] Drop the switch from v1 (column stays, always on).
   - Recommendation: A, because a user mutes a want when its alerts annoy them, which is on that page; the form stays short, and a PATCH of the switch alone does not re-run matching.

### Important (Should Decide)

1. **I1 — "Tylko tu" stored as null or as radius 0.**
   - Options: [A] null; `ck_wants_radius_requires_locality` allows 1-100 only; the API turns 0 into null. [B] 0 as a value, null meaning the same. [C] 0 only, radius required with a locality.
   - Default: A. Rationale: search already treats both the same and the frontend sends no radius for "Tylko tu"; one representation avoids two states with one meaning.

2. **I2 — "Reserved by me" and "proposed by me" on match cards.** `with_pending_proposer` gives only the oldest proposer; `reserved_by_user_id` gives the real reserver.
   - Options: [A] `reserved_by_me` from the reservation only; an item with any pending proposal is shown as plain "reserved". [B] A, plus `proposed_by_me` from one own `EXISTS` on pending proposals in the same statement. [C] No "by me" flag in v1.
   - Default: B. Rationale: with A a seeker's own proposal reads as someone else's reservation; the `EXISTS` adds no statement. A is the fallback if the groups ACL change is unwanted.

3. **I3 — Not-found target of `/wanted/:id`.** The shared `PanelSectionNotFound` links to `/account`.
   - Options: [A] Own not-found state of the match page with the text "To poszukiwanie już nie istnieje" and a link to `/wanted`. [B] Add a link prop to the shared component. [C] Keep `/account`.
   - Default: A. Rationale: bell rows outlive purged wants, so this page will be seen; the design says it links back to the list.

4. **I4 — Clear control for the category.** `CategoryTreePicker` in `mode="any"` labels the clear action "Kategoria główna (brak)" (admin wording).
   - Options: [A] A label prop on the picker, default unchanged, "Dowolna kategoria" in the want form. [B] A separate "Wyczyść" button beside the trigger in the form. [C] Both.
   - Default: A. Rationale: smallest change, keyboard path stays inside the picker, admin screens unchanged.

5. **I5 — "Konto" tab highlight on `/wanted/:id` and its edit page.** `activeTab` matches exact paths; `/places/new` already highlights nothing.
   - Options: [A] Prefix match for `/wanted/` only. [B] Prefix match for all account sub-views (also changes `/places/...`). [C] Leave as is.
   - Default: A. Rationale: keeps the change inside the task; B is the consistent fix but alters pages outside it.

6. **I6 — What `match_count` and `new_match_count` count.** Pairs are stored once; the match list drops items that are no longer listed or visible. A count over stored pairs can say "3 nowe" above an empty list.
   - Options: [A] Count only pairs whose item passes the same read-time filter as the match list (one join in the list statement). [B] Count stored pairs (cheaper, can overstate). [C] B for `match_count`, A for `new_match_count`.
   - Default: A. Rationale: the badge on the tile and the "Konto" row is the promise the user acts on; it must agree with the list.

7. **I7 — Bell rows of a want that is withdrawn, purged or reset by an edit.** No rule exists; the rows keep their text and link.
   - Options: [A] Delete the want's unread match row (the pointer is on the want) when the want is withdrawn or its matches are reset by an edit; leave all other rows; `GET /api/wants/{id}` answers 404 for a withdrawn want. [B] Leave every row; links open the want page or its not-found state. [C] Delete all unread rows of both kinds on every close and purge (needs a second pointer or a lookup by link).
   - Default: A. Rationale: uses the pointer and the delete the writer already needs; removes the two cases where the row is plainly wrong ("3 nowe" after the matches were deleted).

8. **I8 — Links to the form from the list and from the match page.** The demo list has an inline name-only add field.
   - Options: [A] A "Dodaj" link on `/wanted` (also in its empty state) to `/add/wanted`, and an "Edytuj" link on `/wanted/:id`; no inline add. [B] Keep an inline name-only quick add on the list as well. 
   - Default: A. Rationale: ADR-013 chose one form; a second create path would skip "Doprecyzuj".

9. **I9 — Several active wants hold the taken item.** `GET /api/wants?matched_item_id=` can return more than one.
   - Options: [A] One prompt naming all of them; "Zamknij" closes all, "Szukam dalej" closes none. [B] One prompt with a choice per want. [C] Prompt for the best-scoring want only.
   - Default: A. Rationale: one item usually satisfies overlapping wants; the others can be reopened for 30 days.

10. **I10 — Closing prompt on the match list page.** The design also mentions a prompt on `/wanted/:id` "when an item is reserved by the seeker"; a sheet there would reopen on every visit unless the dismissal is stored.
    - Options: [A] Sheet only on the item page after a take; the match page shows the "reserved by me" caption and its normal "Znalezione" action. [B] Also a non-modal banner on the match page. [C] Also a sheet on the match page, dismissal kept in localStorage.
    - Default: A. Rationale: the action is already one tap away on that page; no dismissal state to keep.

11. **I11 — Pre-existing failing tests.** Project memory records 24 Vitest, 5 typecheck and 2 backend failures on HEAD b8c45e0, among them `AppPage`, `ItemDetailPage` and `routeManifest`, which this task edits.
    - Options: [A] Run and record a baseline first; the task must add no new failure; old failures are fixed only where a test this task rewrites is the failing one. [B] Fix every failure in the files this task edits. [C] Fix the whole baseline first, as a separate step.
    - Default: A. Rationale: keeps the scope; B and C add work unrelated to wants.

12. **I12 — Name prefilled from search that is out of range.** Search accepts up to 100 characters and searches from 2; a want name is 3-80 (ADR-011, binding).
    - Options: [A] Prefill as typed and show the inline error at once; submit stays blocked. [B] Cut silently to 80. [C] Hide the link for queries outside 3-80.
    - Default: A. Rationale: no silent change of the user's text; matches the validation standard.

13. **I13 — Release gate while the thresholds are unmeasured.** The labelled sample is a follow-up "before release"; the code has no switch for the feature.
    - Options: [A] No switch in code; the branch is not deployed until the sample is scored; the gate is written in `architecture.md`. [B] Deploy with the starting thresholds and tune later. [C] A setting that stores matches but writes no bell rows until it is turned on.
    - Default: A. Rationale: follows the user's answer and the minimal-implementation standard; C is new machinery for one release.

14. **I14 — The old search user guide.** `.maister/tasks/development/2026-11-12-global-search-group-description/documentation/user-guide.md` (lines 8, 12, 143-152) calls the list a demo and shows the old form.
    - Options: [A] Edit its text (remove the demo warning, correct the steps) and point to the new guide; replace screenshot 12 only if this workflow produces user documentation. [B] Leave it as a record of that task. [C] Rewrite the section with new screenshots.
    - Default: A. Rationale: the guide is what users read; a warning that saving "may not persist" becomes false.

Not raised, with the reason:
- A name with no letters or digits gives an empty text query and can never match. Treated as a validation rule for the specification (reject with 400), not a product choice.
- Editing a want that is not `ACTIVE`: specification detail (409 until resumed).
- Where the seed and `EXPLAIN` scripts live: task folder, not `src/`, per the minimal-implementation standard; results recorded in the task folder.
- `ON DELETE SET NULL` for the category and `RESTRICT` for the locality: kept as designed; consequences listed under risks.

## Recommendations
- Start with the two run-only checks (generated `tsquery` column through the migration round trip; `EXPLAIN (ANALYZE, BUFFERS)` in both directions) before the matcher is built on them, and decide the `item_listing_preferences.created_at` index from the result (separate revision, concurrent build).
- Apply the "Corrected" table of the codebase analysis wherever it differs from the design text (X1-X16), in particular the `<%` pre-filter, the delete-and-insert bell writer, the job's own `StaleDataError` handling, and moderation before any database work.
- Record the test baseline (backend and frontend) in the task folder before the first change.
- Extract the location and offer-mode controls from `SearchFilters.tsx` as a first, separate step with `test/SearchView.test.tsx` green before and after.
- Keep every wants query out of server render: `PublicAddView`, the item page and the search page must not call `useWants` during render.
- Add a runbook entry for 0099: delete rows of the two new kinds before a downgrade or an image-only rollback; add the two generated `wants` columns to the `fold_pl` change list.
- Note in `architecture.md` that account deletion, when built, must handle `wants.seeker_party_id`.

## Risk Assessment
- **Complexity Risk**: High volume (about 30 new and 45 touched files), medium uncertainty. The match statement is the one new piece without a template: three column-form predicates and a plan that has not been run.
- **Integration Risk**: Medium. Four shared backend modules get small edits (groups annotations, moderation fields, notification kinds and a writer with the module's first delete, matrix rows). The scan shares the event loop with requests.
- **Regression Risk**: Low for backend write paths (none changes). Medium for the frontend: the take flow on a server-rendered page, a refactor of the tested `SearchFilters.tsx`, about ten test files bound to the demo, and an unstable baseline.
- **Data Risk**: Low. Wants have no ledger link; the downgrade is lossy but unguarded by design. The one leak path (a PRIVATE item matched for an outsider) is covered twice: the shared predicate at match time and `items_visible_to` / `can_view_item` at read time.
