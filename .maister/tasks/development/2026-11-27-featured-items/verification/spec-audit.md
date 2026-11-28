# Spec Audit: Featured items („Wyróżnione rzeczy”)

## TL;DR
Verdict: **⚠️ Mostly Compliant (pass-with-concerns)**. Counts: Critical 0, High 1, Medium 3, Low 8.
The spec is complete against the requirements and all 10 design-context IDs. Its claims about the code hold, with one exception: the toggle's owner lock is a plain `FOR UPDATE` on `parties`. That lock conflicts with the `FOR KEY SHARE` that every FK insert into `parties` takes, so it can deadlock with take/propose/confirm. The fix is one word: `FOR NO KEY UPDATE`.
Also fix before planning: the hidden-item 404-before-403 gate, the local `is_featured` sync after a mode change, and the toggle's accessible name.

## Key Decisions
- **High, not Critical, for the deadlock.** Postgres detects the deadlock and `mapped_transaction_conflicts` turns it into a 409, so nothing is corrupted. But the spec states "creates no cycle" as an invariant, and that statement is false. The cycle can involve another user's take, and the fix is trivial.
- **Accepted items not flagged.** The renumbering of 0110/0111 and of row 74, the ≤60 s guest cache and the missing owner-visible limit were all accepted by the caller.
- **The `/api/admin/settings` namespace is not flagged.** Existing admin APIs live under their own module (`/api/points/config`, `/api/moderation`), but the user picked this path in Phase 5.
- **The split into 0110 + 0111 is correct.** It differs from requirements.md ("Migration 0110 … app_settings and featured_at"), but the migrations standard requires a nullable column in a separate revision from a new table. The deviation is recorded in Key Decisions.

## Open Questions / Risks
- Should the `/featured` PUT 404 a hidden item (a PRIVATE listing of someone else) before the 403? The standard says yes (`models.md:179`). The existing preference PUT does not do it, and the spec copies that.
- Should the toggle avoid bumping `item_listing_preferences.updated_at`? Today the bump moves `matchable_listings.changed_at` and makes the wants matcher re-read the listing on every toggle. This is harmless (idempotent upserts), but it is undocumented.
- "False for a hidden view" (`ItemActionsResponse`) has no backend meaning. "Hidden" is a frontend `view.kind`.

---

## 1. Scope checked

| Area | Evidence |
|---|---|
| Requirements, both clarification rounds, design INDEX (10 IDs) | `analysis/requirements.md`, `clarifications.md`, `scope-clarifications.md`, `design-context/INDEX.md`, mockup annotations |
| Write path, locks | `groups/application/term_item_listings.py:216-305` (`set_item_listing_preference`), `:780-866` (`_take`), `:1319-1368` (`confirm_transaction`); `groups/infrastructure/repository.py:790-801`; `media/service.py:225-228` |
| Read model and ordering | `repository.py:857-877, 908-929, 1001-1036, 1234-1300`; `events/page.py:58-128`; `pages/application/owner_pages.py:80-125`; `groups/application/item_actions.py:55-115`; `groups/schemas.py:438-457, 791-830, 991-1011` |
| Matrix, boundaries | `core/authorization_matrix.py:244-275`; `tests/test_module_boundaries.py` |
| Settings template | `points/application/config.py`, `points/router.py`, alembic `0103`, `0105`, `0109` |
| Wants coupling | alembic `0101_want_similar.py:95-136` (`matchable_listings.changed_at`), `src/matcher/matcher/statements.py:298` |
| Frontend | `termViewModel.ts`, `eventViewModel.ts`, `ParticipantItemsPreview.tsx`, `ItemTileBadges.tsx`, `ItemCard.tsx`, `ItemHeader.tsx`, `MyItemsView.tsx`, `VisibilityToggle.tsx`, `AppDataContext.tsx:502-553`, `PointsConfigPage.tsx`, `pointsConfigForm.ts`, `usePointsConfig.ts`, `Sidebar.tsx:90`, `MobileDrawer.tsx:99`, `app/globals.css:41-43` |

### Spec claims confirmed against the code
- Row 60 `^/api/item-listing-preferences(/.*)?$` PUT (EDIT, `mcp:edit`) already covers `/featured` (`authorization_matrix.py:246`). The last row is 73, and nothing before the catch-all would match `/api/admin/settings`.
- `set_item_listing_preference` updates the row in place on a mode or visibility change, and deletes it on `mode=None` (`term_item_listings.py:257-262, 284-290`). `confirm_transaction` deletes it on every hand-over (`:1356-1361`). So the mark clears exactly as the spec says. Item delete is blocked while a listing exists (`inventory_items.py:218-245`), so no ghost marks are possible.
- `item_listing_preferences_select` has exactly three consumers: the term page, owner items, and the event page window (`events/page.py:70`). Profile and organization recent items share `list_owner_recent_items` → `list_owner_listed_items_page` (`owner_pages.py:118`, `organization_page.py:93`).
- The client re-sort is needed and correct. The term SQL orders oldest first (`repository.py:1035`), and `buildAttendees` sorts with `byNewest`, then slices (`termViewModel.ts:7-11, 40`). A comparator that groups featured first, returns 0 within the featured group and uses `byNewest` otherwise is a valid ordering, so a stable sort keeps the server's `featured_at DESC`. `eventViewModel` does not sort.
- Groups already imports `app.party` (`groups/application/circles.py:33-34`). `ItemCard` `marker` is passed only by `wanted/MatchCard.tsx:29`, so "no caller passes both" holds. The tokens `bg-ink` and `text-on-ink` exist (`globals.css:41-43`) and are already used (`ToastPill.tsx:6`).
- The settings template exists as described: `load_config` is a fresh read, `update_config` is `FOR UPDATE` + `_naive_utc` compare + 409, `_validate` raises `ValueError` → 400 (`points/application/config.py:72-140`), and the router uses `require_any("ADMIN")`.
- `parseWhole` in `pointsConfigForm.ts:77` is not exported. The spec already allows for a small helper.
- All test files the spec names exist.

---

## 2. High

### H1. The owner Party lock `FOR UPDATE` conflicts with FK `FOR KEY SHARE`, so the "no cycle" claim is false
**Spec reference.** Core Requirement 6 and Key Decision "Lock order for the toggle is owner Party row → item → preference … creates no cycle".

**Evidence.**
- The spec copies `media/service.py:228`: `select(Party.id).where(...).with_for_update()`, which is a plain `FOR UPDATE`.
- In Postgres, every insert or FK-column update of a row referencing `parties.id` runs an RI check with `SELECT … FOR KEY SHARE` on the parent row. Plain `FOR UPDATE` is the only row lock that conflicts with `FOR KEY SHARE`.
- `_take` locks the item's preference `FOR UPDATE` (`term_item_listings.py:819` → `repository.py:795-800`) and then inserts a notification with `party_id=preference.owner_party_id` (`:848-854`; `notifications/models.py:73` has an FK to `parties`). A POINTS HOLD also inserts `point_transactions.counterparty_party_id` (`points/models.py:168`).
- The cycle:
  - The toggle holds the owner's Party lock (`FOR UPDATE`), gets the item lock (take locks no item row, `:793-796`), then waits for the preference.
  - The take holds the preference and waits for `FOR KEY SHARE` on that same Party row.
  - The result is a deadlock (40P01) after `deadlock_timeout`, and one of the two users gets a 409.
- The same pattern exists in:
  - `propose_item_swap` (it notifies the owner after the preference lock).
  - `confirm_transaction`, when its first FK write to the owner's party comes after the item lock (inside `fulfill_exchange`).
  - The first listing in `set_item_listing_preference`, which inserts a preference row with an `owner_party_id` FK while holding the item lock.

**Category.** Incorrect assumption about existing code.

**Severity.** High. A rare race, and recoverable as a 409, but it is cross-user, and the spec explicitly guarantees the opposite.

**Recommendation.**
- Lock the Party row with `FOR NO KEY UPDATE`, which is SQLAlchemy `with_for_update(key_share=True)`. Toggles still serialise against each other, but the lock no longer blocks FK checks.
- Reword the Key Decision.
- Optionally add a two-session test: one session takes the owner's item while another toggles a featured item.

---

## 3. Medium

### M1. Missing hidden-item 404 before the 403
**Spec reference.** Core Requirement 2 (404 missing → 403 not own → 409 draft); Standards Compliance cites `models.md` "owner's 404 before 403".

**Evidence.** `standards/backend/models.md:179`: "Every item read/write path calls `item_visibility.py` (`can_view_item` / `require_item_visible`) first, so a hidden item returns 404 before any 403/409." Take and propose do this (`term_item_listings.py:878, 893`), and so does item actions (`item_actions.py:64`). The spec's order returns 403 for another owner's PRIVATE listing, which reveals that the item exists. The current preference PUT has the same gap (`:238-249`), and the spec copies it.

**Category.** Standards deviation (Incomplete).

**Severity.** Medium. Small information leak, and new code would add to the deviation.

**Recommendation.** Call `require_item_visible(db, item_id, profile.party_id)` before the locks, and add a test that a hidden item returns 404. Alternatively, record the exception explicitly.

### M2. `setItemMode` will not sync `is_featured`, which leaves stale chip and toggle state after unlist and relist
**Spec reference.** Requirements 7, 17 and 18.

**Evidence.** `AppDataContext.setItemMode` updates only `listing_visibility` and `points_price` from the saved preference (`AppDataContext.tsx:519-525`), and `MyItemsView` prefers the panel copy over the page (`MyItemsView.tsx:141-145`).
- On unlist, the server deletes the row and the mark with it, but the local item keeps `is_featured: true`.
- On relist, the server creates a new row with `featured_at` NULL, while the card still shows „⭐ Wyróżnione” and `aria-pressed=true`.
- A click then sends `featured:false`, which is a no-op, so the user has to click twice.

The spec only specifies `setItemFeatured`.

**Category.** Missing requirement.

**Severity.** Medium. Visible, wrong owner state on a common path.

**Recommendation.** In `setItemMode`, also set `is_featured: saved?.is_featured ?? false`. Add a frontend test: unlist, then relist, and the chip disappears.

### M3. `FeaturedToggle` has no item-specific accessible name, and its label changes with `aria-pressed`
**Spec reference.** Requirement 17; design ID `component:featured-toggle`.

**Evidence.** `VisibilityToggle` names each control with the item (`aria-label={`${option.label}: ${itemName}`}`, `VisibilityToggle.tsx:24-36`) "so a list of tiles stays unambiguous". The spec gives the new button only „⭐ Wyróżnij” / „⭐ Wyróżnione”. A list of N cards would then expose N identical "Wyróżnij" buttons. Changing the visible label together with `aria-pressed` also double-encodes the state ("Wyróżnione, pressed"), which WAI-ARIA advises against for toggle buttons.

**Category.** Ambiguous / accessibility.

**Severity.** Medium.

**Recommendation.**
- Add an `itemName` prop with `aria-label="Wyróżnij: {itemName}"` that stays the same in both states, and let `aria-pressed` carry the state. The visible text may still change, as the mockup shows.
- Or, if the visible label must change, drop `aria-pressed` and use `aria-label` alone.

---

## 4. Low

| # | Finding | Evidence | Recommendation |
|---|---|---|---|
| L1 | "A missing or non-bool value is a 400" does not hold with a plain `bool` field. Pydantic v2 lax mode accepts `1`, `"true"`, `"yes"` and `"on"`. | Req 1 | Use `StrictBool` (and `StrictInt` for `max_featured_items`), or drop the "non-bool" wording. |
| L2 | The key-set test list is incomplete. | `test_public_term.py:698` `PUBLIC_ITEM_LISTING_KEYS` (term listing); `test_term_item_listings_router.py:265-` exact `frozenset` of `/inventory-items/mine` rows. Neither is in the spec's list. | Add both to the Testing Approach. |
| L3 | "One column is added to the shared select" understates the work. Each consumer projects its columns explicitly, so `featured_at` must also be added to the outer selects, and the docstrings that say "3 newest" or "oldest first" must be updated. | `repository.py:1023-1036`, `1238-1253`; `events/page.py:74-95` (window `order_by`), `:64-69` docstring | Name the outer selects in the plan. |
| L4 | The toggle bumps `item_listing_preferences.updated_at`, which is the `version_id_col` (`core/base_model.py:66`). That moves `matchable_listings.changed_at` (`0101_want_similar.py:109-113`), so the matcher re-reads the listing. This is idempotent (`ON CONFLICT … DO NOTHING/upgrade`, `matcher/statements.py:298`), but it counts toward `WINDOW_MAX_LISTINGS`. | | Document it in the Key Decision about the `updated_at` bump, or accept it explicitly. |
| L5 | The Polish plural is wrong for N=1: „Możesz wyróżnić maksymalnie 1 rzeczy.” should read „1 rzecz”. | Req 3 | Use a plural helper or the wording „Limit wyróżnionych rzeczy: {N}.” |
| L6 | The schema+seed exception cites 0109. The closer precedent, `points_config`, kept its seed separate (0103 schema, 0105 seed). The 0111 partial index is built inside the transaction, not concurrently. That is acceptable for a small table with an empty predicate, but the spec does not say so (`migrations.md:15-16`). | | Keep the exception, but give the real rationale (`load_settings` uses `scalar_one()`, so a head without the row would 500), and state why the index is not built concurrently. |
| L7 | `ItemActionsResponse` "false … for a hidden view" has no backend meaning: hidden items 404 at `item_actions.py:64`. The frontend `ItemHeader` gates `mode` on `view.kind === "hidden"` (`ItemHeader.tsx:18`), and its wrapper renders only when `mode`, `reservation`, `isPrivate` or `statusAsPill` is set (`:33`). | | Say the backend returns `preference is not None and featured_at is not None`, and that `ItemHeader` gates `featured` like `mode` and adds it to the wrapper condition. |
| L8 | Mockup and spec differ on details. The error mockup shows a red, sticky, top toast with ✕ (`moje-rzeczy-limit-osi-gni-ty.html:227-244`), while the app toast is the bottom `bg-ink` `ToastPill`. The mockup's note says "istniejącym toastem". The chip-row position of the featured pill is not specified (the mockup has it first). The mockup admin nav order is "Points, Settings, Plugins", but Plugins sits elsewhere in `Sidebar.tsx`. | | State that the existing `ToastPill` wins, that the featured pill goes first in the „Moje rzeczy” chip row, and that „Settings” goes right after „Points”. |

---

## 5. Coverage matrix: design-context IDs

| ID | Spec section | Verdict |
|---|---|---|
| screen:my-items-featured-toggle | Req 16–18, Visual table | Covered (see M2, M3) |
| screen:my-items-featured-errors | Req 3, 18 | Covered (see L5, L8) |
| screen:term-page-featured-first | Req 11–12 | Covered; client stable sort verified |
| screen:event-page-featured-first | Req 11 | Covered (see L3) |
| screen:owner-items-featured-first | Req 11, 15–16 | Covered; all three consumers verified |
| screen:product-page-featured-badge | Req 9, 16 | Covered (see L7) |
| screen:admin-settings | Req 19–21 | Covered; texts match the mockup |
| component:featured-pill | Req 14 | Covered; the `" "` separator pattern must sit outside the `aria-hidden` ⭐ |
| component:item-card-featured-marker | Req 15 | Covered |
| component:featured-toggle | Req 17 | Covered (see M3) |

## 6. Coverage matrix: requirements

All 9 functional requirements in `requirements.md` map to Core Requirements 1–24. There are no contradictions between the spec and the Phase-2 decisions. The Phase-1 "N/limit hint" was explicitly overridden in Phase 2, and the spec follows the override. Out of scope matches.

## 7. Recommendations (in order)
1. H1: use `FOR NO KEY UPDATE` on the Party row and fix the Key Decision text.
2. M1: add `require_item_visible` first, plus a hidden-item test.
3. M2: sync `is_featured` in `setItemMode`, plus a test.
4. M3: give `FeaturedToggle` an item-named, stable accessible name.
5. Low items: fold them into the plan (StrictBool, the two missing key-set tests, outer selects, plural, rationales, mockup tie-breaks).
