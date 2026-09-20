# Specification Audit: Fix broken giveaway (oddanie) / exchange (zamiana) mechanism

**Auditor**: spec-auditor (independent, evidence-based)
**Spec audited**: `implementation/spec.md`
**Method**: Read the spec cover-to-cover, then independently read the actual current source
(`term_item_listings.py`, `circulation_bridge.py`, `attendance.py`, `repository.py`,
`PanelDataContext.tsx`, `useKragGrupy.ts`, `KragGrupyPage.tsx`, `reservations.ts`,
`itemListingPreferences.ts`, `term_end_scan.py`, `term_item_listings.py` router, backend/frontend
test files) rather than trusting the spec's own citations or the analysis docs' claims.

## Verdict: ⚠️ Mostly Compliant — one High-severity gap that will make the TDD green-gate claim false as written, one Medium access-control ambiguity, two Low precision issues.

The spec's overall technical approach is sound and well-grounded in the real code — nearly every
file/line citation I checked was accurate, and its central design decision (new taker-side query,
availability-independent) correctly diagnoses why `list_browsable_term_item_listings` cannot be
reused. But it has one concrete, verifiable defect that will cause implementation to fail its own
stated acceptance criterion, plus a real (if narrow) access-control gap in the new endpoint's
eligibility posture.

---

## Critical / High Issues

### H1. The "no separate work needed" TDD-green claim is false — the red test's `vi.mock` factory does not include the new API function, so implementing Root Cause B as specified will throw, not pass

**Spec reference**: "Technical Approach" §5 ("TDD green requirement"): *"Implementing item 2 above
(specifically the taker-side `getMyTakenTermItemListings` resolution in
`resolvePendingReservationId`) is what turns the existing red test in `PanelPage.test.tsx` green —
no separate work needed beyond that."*

**Evidence**:
- `src/frontend/src/test/PanelPage.test.tsx:130-137` mocks the entire `../api/termItemListings`
  module with a **literal factory object** that enumerates exports explicitly — it does not spread
  `...actual` or use `importOriginal`:
  ```ts
  vi.mock("../api/termItemListings", () => ({
    getMyTermItemListings: vi.fn(),
    getBrowseTermItemListings: vi.fn(),
    takeTermItemListing: vi.fn(),
    proposeSwap: vi.fn(),
    acceptSwapProposal: vi.fn(),
    rejectSwapProposal: vi.fn(),
  }));
  ```
- The spec's plan (New Components #1, and Technical Approach §2) requires
  `PanelDataContext.tsx`'s `resolvePendingReservationId` to call a brand-new function —
  `getMyTakenTermItemListings(termId)` — from `src/frontend/src/api/termItemListings.ts`.
- That new export is **not** in the `vi.mock` factory above. When `resolvePendingReservationId`
  calls `termItemListingsApi.getMyTakenTermItemListings(...)`, the mocked module simply has no
  such property — `termItemListingsApi.getMyTakenTermItemListings` is `undefined`, and the call
  throws `TypeError: ... is not a function` inside the effect, which will make the click handler's
  promise reject before `confirmTransaction` is ever invoked — the exact same "never called"
  failure signature the red test currently reports, just for a different reason.
- The red test at `PanelPage.test.tsx:2089-2127` also never mocks a return value for the new
  function (no `vi.mocked(termItemListingsApi.getMyTakenTermItemListings).mockResolvedValue(...)`
  anywhere in that test body).

**Category**: Incomplete (the spec's implementation plan for Requirement 2 is one file short of
what its own acceptance test requires).

**Severity**: High. This isn't a stylistic nit — it directly contradicts a stated, checkable
success criterion ("The `PanelPage.test.tsx` red test passes unweakened... Implementing item 2
above... is what turns the existing red test... green — no separate work needed"). An implementer
following the spec literally will get a still-red (now erroring rather than timing-out) test and
have to reverse-engineer that the test's mock setup needs updating — undocumented, unplanned work.

**Recommendation**: Add an explicit spec item (or fold into New Components #1/#2) instructing the
implementer to add `getMyTakenTermItemListings: vi.fn()` to the `vi.mock("../api/termItemListings",
...)` factory at `PanelPage.test.tsx:130-137`, and to add a
`vi.mocked(termItemListingsApi.getMyTakenTermItemListings).mockResolvedValue([...])` call (with a
row exposing `resolved_reservation_id: 77`, matching the rest of that test's fixture) to the red
test itself, before the assertions. Same applies to any other test file that mocks
`../api/termItemListings` with a literal factory and exercises `resolvePendingReservationId` or
`confirmActionFor` (e.g. `KragGrupyPage.test.tsx`, if it also uses a literal mock — worth a quick
grep before implementation starts).

---

## Important Gaps

### M1. New taker-side query's eligibility check is specified asymmetrically vs. its stated siblings — the caller's own term eligibility is never checked, only the lister's

**Spec reference**: New Components #1: *"keeps only reservations whose item has an
`ItemListingPreference`... owned by a party eligible for `term_id`
(`_list_eligible_lister_party_ids`/`_require_term_eligibility` — **same access-control posture**
as the browse/mine queries)"* and Technical Considerations (requirements.md): *"New taker-side
query must respect existing eligibility rules (`_require_term_eligibility`) — same access-control
posture as `list_browsable_term_item_listings`/`list_my_term_item_listings`."*

**Evidence** (`src/backend/app/groups/application/term_item_listings.py`):
- `list_my_term_item_listings` (:273-279) calls `_require_term_eligibility(db, term_id,
  term.circle_group_id, party_id)` for the **caller's own** `party_id` before returning anything.
- `list_browsable_term_item_listings` (:282-293) calls `_require_term_eligibility(db, term_id,
  term.circle_group_id, viewer_party_id)` for the **viewer** first, *and separately* restricts
  results to listers in `_list_eligible_lister_party_ids` — i.e. it checks eligibility on **both**
  sides.
- The spec's described new function only mentions filtering by "a party eligible for `term_id`" on
  the **lister** side (via `_list_eligible_lister_party_ids`). It never states that the new
  function calls `_require_term_eligibility` for the caller/taker's own `party_id` against
  `term_id` — unlike both of the functions it claims to match the posture of.
- Because `ItemListingPreference` and `Reservation` are both Term-independent (no `term_id`
  column — confirmed in `models.py` / `circulation_bridge.py`), the only thing anchoring a
  taker's reservation to a *specific* `term_id` in this design is "is the lister currently
  eligible for that term" — which is satisfiable by an owner who is an active attendee/organizer
  of *several* terms of the same circle. A caller could invoke
  `GET /mine-as-taker?term_id=<term they are not eligible for>` and, as long as one of their own
  active reservations happens to be on an item whose owner is independently eligible for that
  unrelated `term_id`, get a non-empty, non-error response back — the caller-side gate present in
  both sibling functions is the only thing that would close this.

**Category**: Ambiguous / likely Incomplete (the spec's own text claims parity with functions that
do a caller-side check the new function's description omits).

**Severity**: Medium. Low real-world exploitability (a taker already had to be eligible for the
term they actually took the item under, and a leaked `resolved_reservation_id` for the wrong term
context is confusable rather than a data-integrity breach — no ownership transfer risk since
`confirm_transaction` re-validates `term.occurs_on` and race-participant identity independently).
But it is a genuine deviation from the access-control posture the spec claims to replicate, and
worth closing for defense-in-depth, especially since `resolvePendingReservationId` would pass
whatever `term_id` the notification's `link_path` regex extracts — an attacker-controllable value
is not in play here (server-issued notifications), but a stale/cross-circle notification is not
inconceivable given the async term-end-scan pipeline.

**Recommendation**: Explicitly add `await _require_term_eligibility(db, term_id,
term.circle_group_id, party_id)` for the caller's own `party_id` as the first check in
`list_my_active_taken_term_item_listings`, mirroring `list_my_term_item_listings`'s opening line,
before spec sign-off — this is a one-line addition but should be stated, not left implicit.

---

## Minor Discrepancies

### L1. `useKragGrupy.ts`'s `loadMyAvailableItems` is cited as a standalone function; it doesn't exist under that name

**Spec reference**: New Components #5 and Technical Approach §3: *"Frontend: SWAP-mode filter in
`useKragGrupy.ts`'s `loadMyAvailableItems` (~:144-171)"*.

**Evidence**: `src/frontend/src/hooks/useKragGrupy.ts:144-171` is real (the `myAvailableItems`
population logic, confirmed to have no `ItemListingPreference.mode` join today, matching the
gap-analysis claim) — but it is inline code inside the `refetch` `useCallback`, not a function
named `loadMyAvailableItems`. No such identifier exists anywhere in the file (confirmed by reading
the full file). This is a naming/citation inaccuracy, not a technical error — the line range and
the described fix (join against `getMyItemListingPreferences()`, filter `mode === "SWAP"`) are
both correct and actionable as written.

**Category**: Ambiguous (citation only).
**Severity**: Low — won't mislead an implementer who reads the actual file, but should be corrected
for precision (either "the `myAvailableItems`-population block" or drop the invented name).

### L2. Minor: circulation_bridge's cited "sibling" function name checks out, but the spec never states whether the new `list_active_reservations_for_taker` needs eager-loading annotations per `standards/backend/queries.md`

**Evidence**: `circulation_bridge.list_reservations` (:149-153) and
`repository.list_reservations_for_item` (`circulation/infrastructure/repository.py:151`) are both
real and correctly cited as the pattern to mirror. However, neither the spec nor my reading of
`repository.py` shows an existing party/user-scoped (rather than item-scoped) reservation query to
copy verbatim for N+1/eager-loading conventions — `list_active_reservations_for_taker(db,
account_user_id)` is a genuinely new query shape (filter on `reserved_by_user_id` instead of
`item_id`). The spec asserts standards compliance ("follows existing N+1-avoidance and
parameterized-query conventions already used throughout `term_item_listings.py`/`repository.py`")
without a concrete existing analog for this specific access pattern to point the implementer at.

**Category**: Ambiguous.
**Severity**: Low — not a defect, just a spot where "follows existing conventions" is asserted
rather than demonstrated with a matching precedent; low risk given the codebase's consistently
tight patterns elsewhere, but worth a reviewer's attention during implementation.

---

## Confirmed Correct (points explicitly checked per the audit brief)

1. **Eligibility posture for the new query** — partially correct, see **M1** above (lister-side
   check correctly specified; caller-side check missing from the spec's own description).

2. **No regression to the SWAP happy path from the term-page gate** — **Confirmed no regression
   risk.** Read `propose_swap` (:390-421) and `accept_swap_proposal` (:477-537): each leg's
   self-confirm (`circulation_bridge.confirm_reservation(...)`) happens **inside these backend
   application functions themselves**, entirely independent of the term-page "Potwierdź odbiór"
   button or any frontend click handler. The term-page button today (bug) is the thing that lets a
   party *prematurely* call raw `fulfillReservation` before term-end, silently orphaning the
   paired leg — that is the bug being fixed, not a legitimately-working pre-term-end path. Gating
   the button on `term.occurs_on <= now()` cannot block the propose/accept auto-confirm step
   because that step is never reachable through the button at all. The spec's own Root Cause A
   analysis in `gap-analysis.md` correctly identifies this distinction, and the spec's Technical
   Approach §1 correctly leaves `confirmPledgeReceipt`/pledge flow untouched.

3. **No conflict with the two already-fixed backend bugs** — **Confirmed.** Read the current
   (uncommitted) `term_item_listings.py:419-441` (SWAP `reserved_by_user_id` now correctly set to
   the *gaining* party via `owner_profile_for_reservation`/`proposer_profile_for_reservation`) and
   `term_end_scan.py:59-61` (term-end comparison now uses `datetime.now()`, matching
   `confirm_transaction`'s own `datetime.now()` gate at `term_item_listings.py:647`). The spec's
   planned changes (adding a SWAP-mode check inside `propose_swap` after
   `_require_own_available_personal_item`; adding a new sibling query; adding a term-end
   client-side gate) touch none of these already-fixed lines or their surrounding logic. No
   revert risk.

4. **SWAP-mode-enforcement fix precision** — **Confirmed unambiguous and correctly scoped.**
   `_require_own_available_personal_item` (:67-86) today checks ownership + `InventoryType.PERSONAL`
   + `BalanceStatus.AVAILABLE` only — no mode check, exactly as the spec states. The spec's
   instruction ("after `_require_own_available_personal_item` resolves the offered item, add a
   check that its `ItemListingPreference.mode == SWAP`... raising `BusinessConflictException`")
   is directly implementable: `repository.get_item_listing_preference(db, offered_item_id)` exists
   and returns the exact object needed (confirmed at `repository.py:398`). GIFT/LEND flows never
   call `_require_own_available_personal_item` or `propose_swap` at all (they go through
   `take_item_listing`'s separate mode-match check at :347-348), so the fix is correctly isolated
   to SWAP only, per spec.

5. **SpotkaniaView.tsx/PanelPage.test.tsx guest-RSVP changes left untouched** — **Confirmed
   feasible and correctly described as out of scope.** The guest-RSVP-merge tests live in a
   separate `describe("PanelPage — Spotkania list links to the public circle page", ...)` block
   (`PanelPage.test.tsx:1331` onward, e.g. the test at :1350 "GUEST who only RSVP'd... still sees
   that session in Spotkania"), structurally distinct from the `"PanelPage — Group 7 global
   pending-actions modal"` block containing the red test and Requirement-3 SWAP tests. The two
   areas do not share helper functions or fixtures that the spec's planned edits would need to
   touch. No entanglement risk found.

6. **Acceptance criteria testability / ledger audit test plan** — **Confirmed the target models
   exist exactly as named.** `CirculationTransaction` (`circulation/models.py:227`) and
   `CirculationEntry` (`circulation/models.py:253`) are real ORM classes; `EntrySide.DEBIT`/`CREDIT`
   (`circulation/models.py:86-87`) are real enum members, matching the spec's "paired DEBIT/CREDIT
   `CirculationEntry`" description. Grepping `test_term_item_listings.py` for `CirculationTransaction`
   /`CirculationEntry` returns zero matches — confirming the stated gap is real and the spec's
   planned test additions are net-new, not duplicative. The plan to query these directly via
   SQLAlchemy select is consistent with this test file's existing helper conventions (not
   independently verified line-by-line here, but the described approach — direct ORM query
   post-`fulfill_reservation` — is standard for this codebase's test style seen elsewhere in the
   file).

---

## Recommendations Summary

1. **Must fix before implementation**: Add the `vi.mock` factory update + mock-return-value setup
   for the new `getMyTakenTermItemListings` API function to the spec (or explicitly call out that
   `implementation-planner`/the task-group-implementer must update
   `PanelPage.test.tsx:130-137` and the red test at :2089-2127 as part of Requirement 2's frontend
   work) — otherwise the stated TDD-green acceptance criterion will not be met as specified. (H1)
2. **Should fix**: Add an explicit caller-side `_require_term_eligibility` call to the new
   `list_my_active_taken_term_item_listings` function's description, to genuinely match the access
   -control posture of `list_my_term_item_listings`/`list_browsable_term_item_listings` it claims
   to mirror. (M1)
3. **Nice to have**: Correct the `loadMyAvailableItems` citation to reflect that it's inline code
   in `refetch`, not a named function (L1); note in the spec that the new taker-scoped repository
   query has no exact existing precedent to copy for eager-loading conventions, so the implementer
   should design it fresh against `standards/backend/queries.md` rather than searching for a
   literal analog (L2).

No clarification questions are needed from the user — both issues found (H1, M1) are concrete,
resolvable by the implementation-planner/task-group-implementer without further stakeholder input,
and don't represent a genuine ambiguity in *intent* (the spec's intent is clear; its stated means
of verifying that intent is what's incomplete).
