# Requirements: Fix broken giveaway (oddanie) / exchange (zamiana) mechanism

## Initial description (user, PL)

See full text in `orchestrator-state.yml` `task.description`. Summary: the
giveaway/exchange mechanism on group term pages is reported as "still not
working" despite a prior task (2026-09-16) claiming completion. User
tested WITH the working tree's uncommitted fixes applied and confirmed:
"the action goes through without error, but the item does not change
owner."

## Q&A across all clarification rounds

**Phase 1 (codebase analysis exit)**:
- Q: Tested with uncommitted fixes applied, or pre-fix state? → **Tested
  WITH fixes, still doesn't work.**
- Q: Include SWAP-mode-enforcement fix in scope? → **Yes.**
- Q: Add circulation-ledger audit test coverage? → **Yes.**
- Q: What to do with unrelated SpotkaniaView.tsx/PanelPage.test.tsx
  changes? → **Leave untouched, exclude from this task.**

**Phase 2 (gap analysis exit)**:
- Q: Symptom detail? → **Action succeeds without error, item doesn't
  change owner.**
- Q: Specific repro scenario available? → **No — investigate
  independently.**
- Q: Approve the two newly-found root causes (A: term-page confirm button
  calls raw `/fulfill` instead of `/confirm-transaction`; B: GIFT/LEND has
  no working post-term confirm path for either party)? → **Yes, approved.**

**Phase 5 (this phase)**:
- Q: For Root Cause B's taker-side fix, add a data-access path returning
  "my reservations needing confirmation" independent of the
  availability-filtered browse query? → **Yes, approved** (after a plain-
  language explanation of why the existing `getBrowseTermItemListings`
  query structurally cannot serve this purpose — it deliberately excludes
  reserved/taken items, which is exactly the state a pending confirmation
  is in).
- Q: Specific reuse pattern to mirror? → User deferred to
  specification-creator's own reuse search (no manual pointer given).

## Similar features identified

- `app/groups/application/pledge_fulfillment.py` — sibling
  "needed-items pledge" mechanism sharing the same
  `_require_own_available_personal_item`-style ownership-check pattern;
  worth checking for an existing "my active X for this term" query shape
  to reuse for the new taker-side confirmation lookup.
- `list_my_term_item_listings` (`term_item_listings.py:273-279`) — already
  an unfiltered ("mine") query, but scoped to the caller's OWN listings
  (lister/owner side), not to items the caller has taken as a third
  party. Cannot be reused as-is for the taker side; can serve as the
  structural template (no availability pre-filter, same
  `_build_listing_views` response shape).

## Visual assets

ASCII mockups generated: `analysis/design-context/ascii/ui-mockups.md`
(also indexed in `analysis/design-context/INDEX.md`). All three affected
UI surfaces (term-page confirm button, `SwapProposeDialog` picker,
`GlobalPendingActionsModal`) are wiring/data fixes only — zero new visual
components, layouts, or labels. User reviewed and approved.

## Functional requirements summary

1. **Root Cause A — term-page confirm button uses wrong endpoint.**
   `KragGrupyPage.tsx`'s listing-row confirm button
   (`handleConfirmListing` → `useKragGrupy.ts`'s
   `confirmReservationReceipt` → `fulfillReservation`) must instead call
   `confirmTransaction`, and must be gated so it's actionable only once
   the term has occurred (`term.occurs_on <= now()`), matching the
   backend's own term-end gate on `confirm_transaction`. This closes the
   "premature single-leg SWAP fulfillment" and "raw fulfill bypasses
   race/pairing logic" holes.

2. **Root Cause B — GIFT/LEND has no working post-term confirm path.**
   Add a data-access path (new repository query / service function,
   surfaced via API as needed) that returns the caller's own active
   reservations awaiting confirmation for a given term — as **taker**
   (item reserved by them) — independent of the item's current
   availability-balance status (the existing browse/availability-filtered
   queries structurally cannot serve this, since a reserved item is by
   definition not AVAILABLE and is therefore excluded from them). Wire
   this into `PanelDataContext.tsx`'s `resolvePendingReservationId` (both
   the taker-side lookup AND a new GIFT/LEND branch on the owner/lister
   side, which currently only handles `reservation_type === "SWAP"`).

3. **Scope-confirmed: enforce SWAP counter-offer restricted to
   "zamienię"-tagged items.** Both `_require_own_available_personal_item`
   (backend, `term_item_listings.py:67-86`) and the frontend's
   `myAvailableItems`/`SwapProposeDialog` picker
   (`useKragGrupy.ts:144-171`, `KragGrupyPage.tsx:318-373`) must filter to
   only the proposer's own items whose `ItemListingPreference.mode ===
   SWAP` ("zamienię"). Add an empty-state message when none exist.

4. **Scope-confirmed: circulation-ledger audit test coverage.** Add at
   least one backend test asserting a `CirculationTransaction` +
   `CirculationEntry` pair is actually created (correct accounts, correct
   item) after a GIFT `fulfill_reservation` and after each leg of a SWAP
   `fulfill_reservation` — closing the gap where only reservation/balance
   status was previously asserted, never the audit ledger itself (user's
   explicit requirement #6 for both ODDANIE and ZAMIANA).

5. **TDD green requirement.** The failing frontend test added in Phase 3
   (`PanelPage.test.tsx`, `"[EXPECTED TO FAIL until fixed] resolves a GIFT
   reservation id for the taker even when the term has already ended..."`)
   must pass once Root Cause B is fixed, without weakening its
   assertions. Its `[EXPECTED TO FAIL until fixed]` prefix should be
   removed once green.

6. **Do not touch** `SpotkaniaView.tsx` / the guest-RSVP-merge portions of
   `PanelPage.test.tsx` — confirmed out of scope, unrelated fix already
   present in the working tree.

7. **Keep the two already-fixed backend bugs** (SWAP `reserved_by_user_id`
   inversion; `datetime.utcnow()` vs `datetime.now()` term-end gating) —
   these are correct and should be preserved/committed as part of this
   task's final changes, not reverted.

## Reusability opportunities

- `confirmTransaction` (`src/frontend/src/api/reservations.ts`) — already
  exists and is correctly wired from `PanelDataContext.tsx`; Root Cause A's
  fix converges the term-page button onto this same function rather than
  introducing a second code path.
- `_build_listing_views` / `BrowseTermItemListingResponse` shape
  (`term_item_listings.py:218-253`) — reusable response shape for the new
  taker-side confirmation query, avoiding a new DTO.
- `itemListingPreferences.ts` API — reused read-only for the SWAP-mode
  filter (no new API surface needed on that front).

## Scope boundaries

**In scope**: Root Causes A and B (backend + frontend), SWAP-mode
enforcement (backend + frontend), circulation-ledger audit test coverage,
committing the two already-fixed backend bugs.

**Out of scope**: `SpotkaniaView.tsx` guest-RSVP fix (separate,
pre-existing, unrelated change — leave as-is, do not commit together).
Concurrent-confirm-race row-locking hardening (flagged as residual risk in
codebase-analysis.md, not confirmed broken, not part of this task).
`SwapProposal`/item uniqueness constraint hardening (same — residual risk,
not in scope).

## Technical considerations

- New taker-side query must respect existing eligibility rules
  (`_require_term_eligibility`) — same access-control posture as
  `list_browsable_term_item_listings`/`list_my_term_item_listings`.
- Must not regress `test_browseListing_termOccursOnInPast_becomesUnbrowsable`
  or any other passing test — the new query is additive, not a change to
  the existing intentional post-term browse-emptying behavior.
- Both the new taker-side lookup and the term-page confirm button's
  term-end gate must independently reach the same correctness bar as
  `confirm_transaction`'s own server-side term-end check — client-side
  gating is a UX nicety, not a substitute for the server-side check,
  which remains authoritative.
