# Pragmatic Review: Handover quick wins (Phase 0), iteration 2

**Scope**: all uncommitted changes under `src/` (56 modified files, +1271 / -1533, plus 17 new files), with a focus on the fixes made since iteration 1. Checked against `implementation/spec.md`, `standards/global/minimal-implementation.md` and `standards/backend/queries.md`.
**Project scale**: small team, modular monolith (FastAPI + React), early production with a small community.
**Stance**: read-only. No code was modified.

## 1. Executive Summary

**Status: ✅ Appropriate.** The single Warning from iteration 1 (W1, per-row name lookups in the term-end scan) is resolved, and resolved proportionately. The fixes did not add over-engineering.

| Severity | Count |
|---|---|
| Critical | 0 |
| Warning | 0 |
| Info | 7 (5 carried over, 2 new; none blocking) |

What changed since iteration 1, and the verdict on each:

| Fix | Verdict |
|---|---|
| `list_product_names_for_items` (circulation repo → application → service → bridge) | Appropriate. One `IN` join replaces 2 queries per item. It follows the project's bridge convention, so there are 4 hops, but each hop is a 1-line pass-through, the same as its neighbours (`list_items_with_product_name`). It is called twice in the scan (hand-over and swaps), so it is not single-use. |
| `reservation_ids_for_term_select` (an unexecuted `Select` used as an IN-subquery) | Appropriate, and simpler than the iteration-1 version. It replaces the executed `list_reservation_term_ids` read plus the Python-side filtering with one SQL predicate. It skips the application layer (repo → service → bridge), the same way the existing `available_items_with_product_select` does. |
| `repository.list_group_names` (groups module) | Appropriate. A single same-module query with no bridge, replacing per-Term group reads. |
| Removal of `list_reservation_term_ids` | Clean. Grep finds no leftover references, and the copy-paste docstring flagged in iteration 1 went with it. |
| `components/krag/trapFocus.ts` | Good consolidation. It removes the private copy in `RequestAccessDialog.tsx` and serves 2 callers (`ModalSheet`, `RequestAccessDialog`). It is 27 LOC with no options and no configuration. |
| `snoozeStore.toSnoozeMap` | Appropriate. A 7-line guard so that corrupt or foreign `localStorage` content cannot crash the host. This is cheap hardening at a real trust boundary (browser storage). |

## 2. Complexity Assessment

| Area | Complexity | Verdict |
|---|---|---|
| `term_end_scan.py` | Medium | Appropriate. It now uses a fixed number of queries for item names, group names and Term scoping. The remaining per-row reads are pre-existing (see I9). |
| Circulation bridge additions | Low per hop, 4 hops | Acceptable. The ceremony is the project's DDD convention, not something this task invented. |
| `trapFocus.ts` | Low | Appropriate. |
| `snoozeStore.ts` (75 LOC) | Low | Appropriate. It has pure helpers, an in-memory fallback that spec R8 requires, and a test reset hook. |
| `krag/ModalSheet.tsx` | Low-Medium | Appropriate. Esc, focus-in/out, focus trap and the `registerAsPageSheet` opt-out all map directly to spec a11y and host requirements. |

## 3. Key Issues Found

### Critical / Warning

None.

### Info

**I1 (carried). `fit_notification_message` lives in `app/core/clock.py`.** This is what the spec asks for. Move it only if a second notification-text helper appears. Fixable: yes, trivially. Action: none now.

**I3 (carried). Two `ModalSheet` implementations.** `pages/panel/panelComponents.tsx:167` still has no Esc handling, focus restore or focus trap, while `components/krag/ModalSheet.tsx` now has all three, and `SwapAcceptSuccessSheet` uses the panel variant. `trapFocus.ts` makes unifying them cheaper than before. Fixable: yes. Suggestion: in a follow-up, have the panel `ModalSheet` delegate to the krag one (about 1-2 h).

**I4 (carried). Toast pill class string copy-pasted 3 times.**
- Locations:
  - `components/pending/PendingActionsHost.tsx:224`
  - `pages/krag/PublicTermView.tsx:196`
  - `pages/organizer/blocks/ShareButton.tsx:49` (shares the positioning part)
- Fixable: yes.
- Suggestion: export `TOAST_PILL` from `kragStyles` (about 15 min). Optional.

**I5 (carried). `window.location.origin + organizerTermPath(...)` is built inline at 3 sites.** These are `TakeSuccessSheet`, `SwapAcceptSuccessSheet` and `ItemTimeline`. Act only if a 4th caller appears.

**I7 (carried). `PendingActionsHost` uses 6 `useState` slots plus `forgetResolvedState`.** This was inherited from the panel extraction. A single `Record<actionKey, status>` would be simpler, but only refactor if the host grows. Fixable: yes (optional).

**I9 (new). The scan still reads profiles and slugs per row or per Term, and this is pre-existing.**
- Location: `app/groups/application/term_end_scan.py`. The diff does not touch these lines:
  - `get_profile_by_account_user_id` is called twice per reservation.
  - `resolve_organizer_slug` and `_list_eligible_lister_party_ids` are called once per Term.
- Impact: low. A Term-end emits a handful of events once, and the scan only reaches rows it has not yet notified.
- Fixable: yes.
- Suggestion: leave as is. Batching profiles would need a new users-module bulk read, which is not warranted at this scale. Mentioned only so W1 is not reopened over it.

**I10 (new). `_listing_product_name` in `term_item_listings.py:878` is a per-proposal name lookup (2 queries) that could now reuse `list_product_names_for_items`.**
- It is pre-existing and outside this task's diff. It runs on the withdrawal path, which handles few proposals.
- Fixable: yes. Suggestion: an opportunistic cleanup if someone touches that function. Not required.

**Minor note (trapFocus).** `querySelectorAll("*").filter(matches(FOCUSABLE))` works around a jsdom ordering quirk. It walks every descendant on each Tab press, which is negligible for sheet-sized DOMs. The comment explains why, so no action is needed.

Iteration-1 items I2 (spec-mandated nullable swap fields), I6 (standard-mandated hook shape) and I8 (validate → dump → construct) are unchanged and need no action, so they are not repeated here.

## 4. Developer Experience

- The fixes made the scan easier to read. Names are resolved up front into dicts, and the loop bodies just call `.get()`.
- The subquery form keeps Term scoping in one SQL statement, which is easier to reason about than a pre-read followed by a Python filter.
- `trapFocus` has a single implementation, and its comment documents the jsdom quirk.
- No new configuration, environment variables, services or build steps.

## 5. Requirements Alignment

The fixes stay within the spec. R3 requires bounded queries and own-Term swap scoping, and both now hold more strictly than before. No feature additions, no speculative parameters, no new exports without a caller.

## 6. Context Consistency

- **Dead code**: none. `list_reservation_term_ids` and `find_term_occurs_on` are fully removed, with zero references left. Every new export has a production caller.
- **Inconsistency from iteration 1 (W1)**: resolved. Item names and group names are now batched the same way the Term scoping is.
- **Duplication removed**: the private `trapFocus` copy in `RequestAccessDialog.tsx`.

## 7. Recommended Simplifications (optional, none blocking)

1. **I3: unify `ModalSheet`** (1-2 h, follow-up). This removes one component and gives every sheet Esc, focus return and a focus trap.
   ```tsx
   // panelComponents.tsx
   export { ModalSheet } from "../../components/krag/ModalSheet";
   ```
2. **I4: `TOAST_PILL` constant** (15 min). Turns 3 copies of the class string into 1.
3. **I10: reuse `list_product_names_for_items` in `_listing_product_name`** (15 min, opportunistic).

## 8. Summary Statistics

| Metric | Iteration 1 | Iteration 2 |
|---|---|---|
| `src/` net LOC | -360 | -262 (the extra lines are mostly tests and spec-mandated a11y) |
| Queries for item names per scan | 2 per item | 1 per scan section |
| Group-name queries per scan | 1 per Term | 1 |
| Warnings | 1 | 0 |
| `trapFocus` implementations | 1 private copy | 1 shared (2 callers) |
| New runtime dependencies / infrastructure | 1 (`tzdata`) / 0 | 1 / 0 |

## 9. Conclusion

The fixes are proportionate, and nothing blocks merge. W1 is closed, with a net simplification of the swap scoping. The remaining items are optional, low-severity follow-ups (I3, I4) or pre-existing code outside this diff (I9, I10).
