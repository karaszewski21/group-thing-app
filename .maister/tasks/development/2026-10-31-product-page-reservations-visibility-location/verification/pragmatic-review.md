# Pragmatic Review: Product-page reservations, location, reserved badges, item visibility

## TL;DR
- **Status: ✅ Appropriate, with minor issues.** The feature has three slices and three migrations. It adds about +2,680/-1,420 lines of production code, roughly +1,260 net, which fits the scope. Most of the complexity was decided in the spec (context union, the visibility gate everywhere, SQL-bounded `/actions`), and the code does not go beyond it.
- **No Critical or High findings.** There are 3 Medium and 8 Low, mostly small duplications and one awkward piece of frontend state choreography.
- **Largest simplification:** `useItemTake` is still the term page's multi-item hook, but the product page is now its only consumer. To open the chat after a personal take, `ItemContextActions` uses a ref state machine and two `useEffect`s. A success callback would remove both.

## Key Decisions
- The `ReservationContext = TermContext | EventContext | PersonalContext` polymorphism is **justified**. It removes `None`-branching from take, propose, accept, confirm and cancel. `PersonalContext` is small: no-op windows and a `require_eligibility` check.
- The single `POST /api/items/{id}/take|propose` (`groups/router/item_reservations.py`, 41 lines) **replaced** four routes. That is a real net simplification: `event_item_listings.py` and `api/eventItems.ts` were deleted.
- `include_private=False` as a safe default on repository selects is **justified**. It is the cheapest way to keep every read path closed by default.
- The cache-header change is minimal: one `_set_cache_headers` helper used by three routes.
- No dead code was found in the new backend helpers. Every new repository, ACL and bridge function has at least one caller.

## Open Questions
- Should `useItemTake`, `TakeSuccessSheet` and `SwapProposeDialog` move from `pages/term/` to `pages/product/`, now that only the product page uses them (M1)?
- Should MyItemsView read the server-computed `can_confirm`/`can_cancel` instead of re-deriving the settle rule on the client (M2)?

## Risks
- **Settle rule in two places.** The confirm/cancel rule is now implemented on the server (`transaction_action_flags`) and again in MyItemsView's `canSettle`. The next rule change can drift.
- **Fragile chat opening.** The personal-swap chat opening depends on effect ordering (`personalSwap` ref plus a `swapOpen` effect). A refactor of `useItemTake` can silently stop the chat from opening after a personal swap proposal.

---

## 1. Complexity Assessment

| Dimension | Observation | Verdict |
|---|---|---|
| Project scale | Early-stage product with real users and public pages (`.maister/docs/project/architecture.md`) | Balanced |
| Production LOC | +2,682 / -1,424 across about 70 files. There are 7 new backend modules and 8 new frontend modules, each 34–177 lines | Proportional to the 3 slices |
| Test LOC | +1,942 / -1,267. New test files hold 1–13 tests each. Two exceed the 2–8 guideline: `test_item_visibility.py` (12) and `MyItemsView.test.tsx` (13), both justified by the number of gated paths | Acceptable |
| New abstractions | `PersonalContext`, `ReservedByNames`, `item_visibility` gate, `_set_cache_headers`, `ItemTileBadges`, `PartyReservationActions` | Each has two or more consumers or replaces branching |
| Infrastructure | No new infrastructure. Three small migrations: a constraint change, a column with its FK, and a column | Appropriate |

**Overall complexity: Medium.** That is appropriate for a change that touches reservations, visibility and listings across groups, circulation, events and messaging.

## 2. Key Issues Found

### Critical
None.

### High
None.

### Medium

**M1. `useItemTake` keeps term-page generality, and the product page works around it with a ref plus effects.**
- **Evidence:**
  - `src/frontend/src/pages/term/hooks/useItemTake.ts:67-157` keeps per-item state (`busyItemId`, `swapPick.itemId`, `takeSuccess.itemId`), but its only consumer is `src/frontend/src/pages/product/ItemContextActions.tsx:54`.
  - `ItemContextActions.tsx:58-78` keeps `personalSwap = useRef<"picking"|"submitted"|null>` and two `useEffect`s.
    - The first effect watches `takeSuccess`. For a personal take it closes the success sheet that was just set, shows a toast and opens the chat.
    - The second effect watches `swapOpen` to detect that a personal swap proposal succeeded.
  - The ref is mutated in four callbacks (lines 209, 221, 239, 243).
- **Problem:** the success of a personal take or swap is signalled as state, then read back by effects. It works, but it depends on effect ordering, and three files sit in `pages/term/` even though the term page no longer uses them.
- **Recommendation:** add an optional `onReserved(target)` callback to the hook, and call it from `performTake` and `confirmSwap` after `refresh()`.

  Before:
  ```tsx
  useEffect(() => { if (takeSuccess?.target.kind !== "PERSONAL") return; closeTakeSuccess(); showToast(...); void openItemChat(...) }, [...]);
  useEffect(() => { if (personalSwap.current !== "submitted" || swapOpen) return; ... openItemChat(...) }, [...]);
  ```
  After:
  ```tsx
  const take = useItemTake({ isLoggedIn, refetch, showToast, onReserved: (target) => {
    if (target.kind === "PERSONAL") void chat.open({ kind: "ITEM", id: itemId });
  }});
  ```
  The hook then sets `takeSuccess` only for TERM/EVENT targets. Move `useItemTake.ts`, `TakeSuccessSheet.tsx` and `SwapProposeDialog.tsx` to `pages/product/`. `useAccountGate` and `AuthGateSheet` stay shared.
- **Impact:** removes a ref, two effects and about 25 lines, and makes the chat opening deterministic. **Effort:** about 1h, including test updates.

**M2. The settle rule is duplicated on the client, and personal-swap detection is inconsistent.**
- **Evidence:**
  - `src/frontend/src/pages/items/MyItemsView.tsx:135-146, 222-229` derive `hasEnded`, `isGift` and `isUnpairedSwap` per reservation from `getReservation`. This mirrors the server's `transaction_action_flags` (`src/backend/app/groups/application/term_item_listings.py:852`), which `/actions` already exposes as `can_confirm`/`can_cancel`.
  - Personal-swap detection uses `term_occurs_on === null && group_name === null` in `MyItemsView.tsx:196`, but `||` in `src/frontend/src/pages/product/PartyReservationActions.tsx:51`.
  - The copy "Zamiana przyjęta — odbiór osobisty, ustalcie szczegóły na czacie." is defined twice: `MyItemsView.tsx:27` and `PartyReservationActions.tsx:52`.
- **Problem:** the rule now lives in two places. This task already had to add `personal_pickup` and `isUnpairedSwap` to the client copy.
- **Recommendation:**
  - Short term: share one `isPersonalSwapAccepted(accepted)` helper and one copy constant, for example in `api/termItemListings.ts` or `itemPageShared.ts`.
  - Longer term: have `ReservationDetailResponse` carry `can_confirm`/`can_cancel` from `transaction_action_flags`, so MyItemsView stops re-deriving them.
- **Effort:** 15 min for the short term; about 1–2h for the longer term (out of scope here).

**M3. `PartyReservationActions` runs mutations in the component with its own invalidation list.**
- **Evidence:**
  - `src/frontend/src/pages/product/PartyReservationActions.tsx:24-32` (`SETTLE_INVALIDATED_KEYS`) is nearly identical to `src/frontend/src/pages/term/hooks/useItemTake.ts:35-43` (`TAKE_INVALIDATED_KEYS`).
  - Both use the literal `["groupAccess"]` instead of a key constant from `useTermAccess`.
  - `isAlreadyResolved` (`PartyReservationActions.tsx:34-42`) duplicates `src/frontend/src/components/pending/PendingActionsHost.tsx:114-120`.
- **Problem:** the data-fetching standard puts data access in `src/hooks/`, with key constants defined in the hook. Two hand-maintained lists of "everything that shows reservation state" will drift.
- **Recommendation:**
  - Export one `RESERVATION_STATE_KEYS` constant, for example from `hooks/useItemActions.ts`, and use it in both places.
  - Export `GROUP_ACCESS_KEY` from `useTermAccess`.
  - Move `isAlreadyResolved` into `api/reservations.ts` next to the `already_resolved` type.
  - Optionally, move the four settle calls into a `useSettleReservation()` hook.
- **Impact:** about 20 duplicated lines removed, and one place to update the next time a reservation-showing list is added. **Effort:** about 30–45 min.

### Low

**L1. The viewer's party is resolved in three ways.**
- `src/backend/app/groups/application/reserved_by.py:35-43` has `resolve_viewer_party_id`, which returns `None` on a missing profile. It lives in the reserved-badge module but is used for general viewer resolution by `organizer_page.py:90` and `owner_items.py:202`.
- `src/backend/app/groups/application/item_visibility.py:86-93` re-implements the same try/except inline.
- `item_actions.py:59-62` uses the raising `get_profile_by_principal`.
- **Suggestion:** keep one helper, in `item_visibility.py` or a small `viewer.py`, and call it from `require_item_visible_to` after the PRIVATE check.

**L2. `_OPEN_STATUSES` is defined three times, plus a fourth equivalent.** The copies are in `item_actions.py:48`, `item_visibility.py:25` and `reservation_context.py:39`; `term_item_listings.py:81` has `_ACTIVE_RESERVATION_STATUSES`. **Suggestion:** expose one `OPEN_RESERVATION_STATUSES` from `circulation_bridge`.

**L3. `pickup_phrase()` polymorphism is undercut by `isinstance` branches.** `term_item_listings.py:582-604` (`_take_messages`, `_swap_accepted_message`) branch on `isinstance(context, PersonalContext)` anyway. Term and Event also carry identical `pickup_phrase` bodies (`reservation_context.py:91-92, 149-150`). **Suggestion:** either let each context build its full message, or drop `PersonalContext.pickup_phrase` and inline "odbiór osobisty" in the personal branch. Either way, one mechanism, not two.

**L4. The "personal reservation" predicate is repeated.** `term_id is None and event_id is None` appears in `circulation/domain/item_privacy.py:208` and `groups/application/item_actions.py:278, 295`. `reservation_context.load_for_reservation` adds a status-aware variant. **Suggestion:** add an `is_personal(reservation)` helper next to the model. This matters because of the accepted risk L7 (no DB discriminator), which makes this predicate the only definition of "personal".

**L5. `circulation/service.py` is no longer a pure re-export facade.** It now holds `_is_party`, `list_reservations_for_caller`, `get_reservation_for_caller` and `list_own_items_with_product_name` (`service.py:133+`). The docstring was patched to admit this. **Suggestion:** move them to `application/reservations.py` and `application/inventory_items.py`, and re-export them, which restores the module's single rule.

**L6. `PersonalContext.for_reservation()` is just `cls()`.** See `reservation_context.py:185-187`. It is harmless as a named constructor, but it adds nothing over `PersonalContext()`. Keep it only if the name helps readers; otherwise drop it.

**L7. `_ReservedState` exists only to fake a row.** `item_actions.py:122-126` defines a dataclass whose only job is to pass one item through `load_reserved_by_names`, which takes `Iterable[Any]` duck-typed rows. **Suggestion:** give `reserved_by.py` a small `Protocol` for the row shape (`balance_status`, `reserved_by_user_id`, `proposer_party_id`) instead of `Any`. Then both the SQL rows and this single case type-check, and the adapter is self-explanatory.

**L8. "Owner has a live pickup place" is computed two ways.**
- SQL join: `circulation/infrastructure/repository.find_personal_inventory_live_location_id`, used by `load_personal_context`.
- Python check of `deleted_at`: `item_actions.py:93-100`, which uses `find_personal_inventory` and the batched locations lookup.

This is defensible: `/actions` reuses its batched lookup to keep the statement count bounded. Note it as a consistency point and leave it.

## 3. Developer Experience

| Area | Assessment |
|---|---|
| Discoverability | Good. Module docstrings explain the "why" (404 before 403, personal vs. deleted context, cache rules). `architecture.md` has the 0074–0076 runbook. |
| File placement | One friction point: product-only take, swap and success modules sit under `pages/term/` (M1). |
| Consistency | The frontend follows the pure `resolve…View()` + `switch` standard (`itemActionsViewState.ts`, 106 lines, table-tested). The backend follows the ACL and batched-lookup rules. |
| Feedback loop | No new tooling or setup. Three migrations, each with a downgrade-then-upgrade test. |
| Error clarity | The Polish 409 messages are specific: "Właściciel nie ustawił miejsca odbioru" and "Tej rzeczy nie można zarezerwować w tym miejscu". |
| Test churn | Heavy: 17 backend test files migrated. Unavoidable given the route removal; the tests were migrated, not loosened. |

## 4. Requirements Alignment

- **R1–R13:** the implementation follows the spec closely. There are no features beyond the spec.
- **Recorded, sensible deviations** (from the work-log):
  - Browsing a PRIVATE circle is stricter: members and the organizer only, not RSVP holders. This is consistent with `can_view_item`.
  - A personal swap accept shows an inline status, not `SwapAcceptSuccessSheet`.
  - The visibility toggle sits on its own row.
- **Counts:** the organizer page counts available items only, while the owner page counts reserved items too. The spec chose this deliberately (audit M5), and each page's tab and count match. It is a little surprising for developers, but justified.
- **No requirement inflation** was detected. `MAX_CONTEXTS = 5` is a constant, not configuration.

## 5. Context Consistency

| Indicator | Finding |
|---|---|
| Same functionality implemented several ways | Viewer-party resolution (L1); open statuses (L2); personal predicate (L4); live-location check (L8); settle rule on client and server (M2); invalidation lists (M3) |
| Dead code | None found among new backend helpers (call sites counted). The old AVAILABLE-only selects were deleted in G11 as planned. `api/eventItems.ts` and `router/event_item_listings.py` were deleted. |
| Half-implemented patterns | `pickup_phrase` used next to `isinstance` (L3) |
| Unused parameters | None found |
| Inconsistent conditions | Personal-swap detection uses `&&` in one place and `\|\|` in the other (M2) |

## 6. Recommended Simplifications (Top 3)

1. **Callback instead of ref and effects in the product take flow (M1).**
   - Change: add `onReserved` to `useItemTake`, then delete the `personalSwap` ref and both effects.
   - Move: take the product-only modules out of `pages/term/`.
   - Impact: about -25 LOC and deterministic chat opening. Effort: about 1h.
2. **One reservation-state invalidation list and one `isAlreadyResolved` (M3).**
   - Impact: about -20 LOC and one place to maintain. Effort: about 30–45 min.
3. **Shared personal-swap helper, copy constant and `is_personal` predicate (M2 short term, L4).**
   - Impact: removes the `&&`/`||` inconsistency and three backend copies of the predicate. Effort: about 30 min.

Nice-to-have: L1 + L2 (one viewer resolver, one open-status tuple), about 20 min. L5 (move logic out of the service facade), about 20 min.

## 7. Summary Statistics

| Metric | Current | After top-3 + L1/L2 |
|---|---|---|
| `_OPEN_STATUSES`-style tuples in groups application | 4 | 1 |
| Viewer-party resolution implementations | 3 | 1 |
| Reservation-state invalidation lists (frontend) | 2 | 1 |
| `isAlreadyResolved` copies | 2 | 1 |
| Personal-swap-accepted checks / copy strings | 2 / 2 | 1 / 1 |
| Effects plus ref in `ItemContextActions` for the take flow | 2 + 1 | 0 |
| Estimated LOC removed | — | about 70–90 |
| New dependencies or infrastructure | 0 | 0 |

## 8. Conclusion

The implementation fits the project's scale and stays within a large but well-specified scope. The context-union refactor and the single reservation endpoint reduce net complexity compared with the four routes they replace. None of the findings blocks merging.

Recommended actions, about 2–3h in total:
- Before merge (optional but cheap): M2 short term (shared helper and constant, fixing the `&&`/`||` inconsistency) and M3 (shared invalidation keys).
- Follow-up: M1 (take-flow callback and file move), L1–L5 cleanups, and server-provided `can_*` on `ReservationDetailResponse` for MyItemsView.
