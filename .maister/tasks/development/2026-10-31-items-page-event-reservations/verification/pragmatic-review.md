# Pragmatic Review: items page + event reservations

## TL;DR
- **Status: Appropriate.** The complexity fits the problem. The change is large (92 modified and 33 new files, about +2,970/-810 LOC), but the spec is large too: an owner items page, a shared preview, a public item page and event reservations end to end.
- **No critical findings and no over-engineering in the main design.** `ReservationContext` (a `TermContext | EventContext` union of two frozen dataclasses) is the smallest abstraction that lets one take/propose/accept/confirm code path serve both contexts. It replaced inline term-only checks and left less code behind.
- **The real issues are small leftovers from a parallel, multi-group build:**
  - duplicated mode-label maps (one exact duplicate);
  - duplicated owner-summary logic;
  - a hard-coded query-key literal next to its exported constant;
  - dead `ListingRowVM` fields;
  - an unused `message` on the `error` view;
  - a local auth sheet next to the shared one;
  - one query per event in the end-of-event swap scan.
- **Effort:** all of them together are about 1–2 hours of cleanup. None blocks the merge.

## Key Decisions
- **Accepted as appropriate:** the `ReservationContext` duck-typed union, the `events_acl` / `circulation_bridge` pass-through wrappers, the guarded 0073 downgrade, and the separate reservation-driven `_scan_event_swaps`. Each follows project standards or a spec decision (models.md ACL rule, migrations.md guarded downgrade, spec "Key Decisions"). None is speculative.
- **Accepted:** the `itemActionsViewState.ts` discriminated union with 10 kinds. It is required by `frontend/components.md` and spec Requirement 16, and it is table-tested.

## Open Questions / Risks
- **`ItemAuthGateSheet` vs `AuthGateSheet`.** Keeping a local variant is a product choice (register-first button order and wording). If the mockup does not insist on it, reuse `AuthGateSheet`. Ask the user.
- **Two casings for context `kind`.** The server sends `"TERM"`/`"EVENT"`; the client `ItemContext` uses `"term"`/`"event"`. Two mapper functions now exist only to translate between them. This is low risk, but every future consumer pays the same translation cost.
- **Event swap scan runs one query per event.** This is harmless at today's scale (a 15-minute window holds few events), but it is the one non-batched read added to a batch job.

---

## 1. Complexity Assessment

| Dimension | Observation | Verdict |
|---|---|---|
| Project scale | Early production: real users, a microkernel with bounded contexts, ACL rules and strict migration standards | Balanced complexity expected |
| Backend new modules | `reservation_context.py` 184, `owner_items.py` 214, `event_reservations.py` 156, `item_actions.py` 134, `events_acl.py` 150, 2 small routers, migration 75 LOC | Proportional |
| Frontend new modules | `ItemContextActions.tsx` 285, `OwnerItemsPage.tsx` 267, `ParticipantItemsPreview.tsx` 120, view state 60, hooks/api about 260 | Proportional |
| Abstraction layers | router → application → infrastructure ACL/bridge → other context's service: the existing project pattern, with no new layers | OK |
| Infrastructure | No new dependencies, services or caches | OK |
| Net simplification | `EventAttendeeList.tsx` -84/+…, `AttendeeList.tsx` and `listingThumb.test.tsx` shrink, two near-duplicate toggles became one shared preview, `CreateReservationRequest` was removed | Positive |

**Overall complexity: Medium, appropriate.**

## 2. Key Issues Found

### Critical
None.

### Warning (Medium)

**W1. Five mode-label maps for two modes, one an exact duplicate**
- **Evidence:**
  - `src/frontend/src/pages/product/ItemContextActions.tsx:32`: `MODE_ACTION_LABELS = { GIFT: "Weź", SWAP: "Zamienię" }`
  - `src/frontend/src/pages/term/components/termLabels.ts:20`: `PICKUP_MODE_LABELS = { GIFT: "Weź", SWAP: "Zamienię" }`, which has identical values
  - `src/frontend/src/components/shared/ParticipantItemsPreview.tsx:12`: a local `MODE_LABELS` ("Weź na stałe" / "Zamiana")
  - plus `TAKE_ACTION_LABELS` and `EXCHANGE_MODE_LABELS` in `termLabels.ts`
- **Impact:** Copy changes must be made in several places, and the work-log already notes an intended consolidation (Group 11/12) that stopped halfway.
- **Fix:**
  - Delete `MODE_ACTION_LABELS` and import `PICKUP_MODE_LABELS`.
  - Move the preview's `MODE_LABELS` into `termLabels.ts` next to the others. A `.ts` module also satisfies the `react-refresh/only-export-components` lint.
- **Effort:** 10 min.

**W2. Owner summary (Organization name/slug, else profile name) is built twice**
- **Evidence:**
  - `src/backend/app/groups/application/owner_items.py:207-212` (`get_party_owner_items`)
  - `src/backend/app/groups/application/item_actions.py:84-97` (`_owner`)
- **Impact:** The "how an owner is named" rule is a product choice that the work-log flags for user review. If it changes, it must change in two places. `ItemActionsOwnerResponse` already subclasses `OwnerSummaryResponse`, so sharing is trivial.
- **Fix:**
  ```python
  # owner_items.py
  async def owner_summary(db, party_id, display_name_fallback: str) -> OwnerSummaryResponse:
      organization = await organizations_acl.get_own_organization(db, party_id)
      return OwnerSummaryResponse(
          party_id=party_id,
          display_name=organization.name if organization else display_name_fallback,
          slug=organization.slug if organization else None,
      )
  # item_actions._owner
  summary = await owner_summary(db, profile.party_id, profile.display_name)
  return ItemActionsOwnerResponse(**summary.model_dump(), items_total=await count_owner_items(db, summary.party_id))
  ```
- **Effort:** 15 min.

**W3. Client and server use different casing for context `kind`, which forces mapper boilerplate**
- **Evidence:**
  - `src/frontend/src/pages/product/useItemRoutes.ts:15-23`: `ItemContext.kind: "term" | "event"` and `nearestItemContext`, which maps `"EVENT"` to `"event"`
  - `src/frontend/src/pages/term/hooks/useItemTake.ts:15-30`: `TakeContext` and `takeContextFrom`, the same mapping again
  - The server types `ItemContextResponse` and `OwnerNearestDate` are uppercase.
- **Impact:** There are three nearly identical context shapes and two translation functions. Every new consumer has to pick the right one.
- **Fix:** Use the server's uppercase `kind` on the client and lowercase it only when building the query string in `itemContextQuery` (`?${kind.toLowerCase()}=`). After that, `TakeContext` can simply be `ItemContextResponse` minus `has_started`, and both mappers go away.
- **Effort:** 30–45 min including tests.

### Info (Low)

**I1. Query-key literal duplicated next to its exported constant**
- **Evidence:** `src/frontend/src/pages/term/hooks/useItemTake.ts:34` hard-codes `["item-actions"]`, while `src/frontend/src/hooks/useItemActions.ts:8` exports `ITEM_ACTIONS_KEY = "item-actions"`.
- **Why it matters:** The work-log (Group 13) had to coordinate the string across groups by hand, and a rename would silently break the invalidation.
- **Fix:** `[[ITEM_ACTIONS_KEY], ["itemDetails"], NOTIFICATIONS_KEY]`.
- **Effort:** 2 min.

**I2. Local `ItemAuthGateSheet` re-implements `AuthGateSheet`**
- **Evidence:** `src/frontend/src/pages/product/ItemContextActions.tsx:267-285` duplicates `src/frontend/src/pages/term/modals/AuthGateSheet.tsx:58`, which already takes `title`/`message`.
- **What differs:** only the button order and wording: "Załóż konto" is primary here, while the shared sheet makes "Zaloguj się" primary and puts "Zarejestruj się" in a footer.
- **Fix:** Use `<AuthGateSheet title="Załóż konto, żeby zarezerwować" message="Rezerwacje i czat wymagają konta. …" onClose=… />` unless the mockup's register-first order is a firm requirement.
- **Effort:** 10 min. This is a product decision (see Open Questions).

**I3. Dead fields on `ListingRowVM`**
- **Evidence:** `src/frontend/src/pages/term/components/termSectionTypes.ts:24-32`. Its `title`, `subtitle` and `thumbUrl` are still required or filled (`PublicTermView.tsx:87,98`), but nothing reads them since rows render through `ParticipantItemsPreview`.
- **History:** the work-log flagged this twice (Groups 10 and 13) and did not resolve it.
- **Fix:** Drop the three fields and their assignments.
- **Effort:** 10 min.

**I4. `error` view carries an unused `message`**
- **Evidence:** `src/frontend/src/pages/product/itemActionsViewState.ts:297` defines `{ kind: "error"; message: string }`, but `ItemContextActions.tsx:100-111` always renders the fixed text "Nie udało się wczytać akcji".
- **Fix:** Either render `view.message` (preferred: the data-fetching standard passes problem messages through verbatim) or drop the field.
- **Effort:** 5 min.

**I5. One query per event in the end-of-event swap scan, plus a direct circulation model select**
- **Evidence:** `src/backend/app/groups/application/term_end_scan.py`:
  - `_scan_event_swaps` loops `for event in events: await db.execute(select(SwapProposal)…)`;
  - it then selects `circulation_bridge.Reservation` directly instead of using a bridge function. The work-log for Group 8 noted this.
- **Fix:**
  - Read all proposals in one statement with `circulation_service.reservation_ids_for_events_select(event_ids)`, or with a join that returns `event_id` alongside each proposal.
  - Replace the raw select with a `circulation_bridge.get_reservations_by_ids`.
- **Effort:** 30 min.

**I6. Two swap-scan strategies (preference-driven for terms, reservation-driven for events)**
- **Evidence:** `term_end_scan.py`: `_scan_swaps` vs `_scan_event_swaps`.
- **Assessment:** This is deliberate and documented in the spec (withdrawn attendees are still prompted), and the event version is arguably the simpler and more correct model. It is not worth changing now. If terms ever adopt the same rule, the two can be merged. Recorded here for context consistency only.

**I7. Small duplicated style constant**
- **Evidence:** `FOCUS_RING` is defined identically in `src/frontend/src/pages/organizer/blocks/RecentItemsBlock.tsx:9` and `NearestDateCard.tsx:5`.
- **Fix:** Move it into `components/shared/uiStyles` if it is used a third time. It is acceptable as is.

## 3. Developer Experience
- **Good:**
  - Module docstrings explain *why*, for example the statement-count invariant in `owner_items.py` and the atomicity contract in `event_reservations.py`.
  - The pure view-state module is table-tested.
  - The context abstraction removed duplicated term checks from `term_item_listings.py`.
  - The migration's downgrade error names the recovery path.
- **Friction:**
  - The casing translation (W3) and the scattered label maps (W1) are the only spots where a newcomer has to hunt.
  - The `TakeContext`/`ItemContext`/`ItemContextResponse`/`OwnerNearestDate` quartet is the main cognitive overhead the change adds.
- **No intrusive automation was introduced.**

## 4. Requirements Alignment
- **Everything implemented maps to spec Parts 1–5**, including the party-id → slug redirect and the `RESERVATION_CANCELLED` kind.
- **No features beyond the spec and no speculative extension points.** `ReservationContext` has exactly two members, both used.
- **`MAIN_ENDPOINT_BUDGET` was raised 10 → 11** (`tests/test_organizer_page_queries.py`) for the new `recent_items` select. This is justified, and the constant-count assertion is unchanged.

## 5. Context Consistency
- **Unused code:**
  - `ListingRowVM.title/subtitle/thumbUrl` (I3) and `ItemActionsView.error.message` (I4).
  - Every `events_acl` function has at least one caller: `get_event` 4, `lock_event_for_share` 2, `author_slugs` 3, the others 1 each.
  - `CreateReservationRequest` was correctly removed.
- **Duplicate implementations:** the owner summary (W2), the mode labels (W1) and the auth sheet (I2).
- **Half-finished consolidation:** the move of `PICKUP_MODE_LABELS` into `termLabels.ts` (Group 12) did not carry over to `ItemContextActions` (Group 14). The parallel groups did not see each other's results.

## 6. Recommended Simplifications (Top 3)

1. **Consolidate mode labels (W1) and use `ITEM_ACTIONS_KEY` (I1).** Expected impact: -1 duplicate map, -1 literal, one source of truth for copy. Effort: about 15 min.
   ```ts
   // before (ItemContextActions.tsx)
   const MODE_ACTION_LABELS: Record<ExchangeMode, string> = { GIFT: "Weź", SWAP: "Zamienię" };
   // after
   import { PICKUP_MODE_LABELS } from "../term/components/termLabels";
   ```
2. **Extract `owner_summary` (W2).** Expected impact: about -8 LOC and one place for the owner-naming product rule. Effort: about 15 min.
3. **Unify the casing of context `kind` on the client (W3).** Expected impact: -2 mapper functions, -1 interface, about -25 LOC. Effort: about 45 min.

Then, optionally: delete the dead `ListingRowVM` fields (I3), resolve `error.message` (I4) and batch the event swap scan (I5).

## 7. Summary Statistics

| Metric | Current | After simplifications |
|---|---|---|
| Mode-label maps | 5 | 4 (no exact duplicates, all in `termLabels.ts`) |
| Owner-summary builders | 2 | 1 |
| Client context shapes and mappers | 4 types and 2 mappers | 3 types and 0 mappers |
| Auth gate sheet components | 2 | 1 (if the product agrees) |
| Event swap scan queries | N events + 2 | 3 |
| Estimated LOC removed | — | about 60–80 |
| New dependencies | 0 | 0 |

## 8. Conclusion
The implementation is **appropriately engineered** for the scope. Its core abstraction (`ReservationContext`) earns its place, and the bounded-context plumbing follows the project's standards rather than inventing new layers. The findings are leftovers from building in parallel groups that could not see each other's results: duplication and a few dead fields. Fix W1/I1 and W2 before merging if convenient (about 30 min). W3 and the Info items can go in a follow-up cleanup task (about 1–1.5 h).

**Findings: 0 critical, 3 warning, 7 info.**
