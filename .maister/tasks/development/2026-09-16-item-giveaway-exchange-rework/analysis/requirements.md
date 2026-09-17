# Requirements: Item Giveaway & Exchange Rework

## Initial Description

See `orchestrator-state.yml` `task.description` for the full original
(Polish) requirement text covering both flows (oddanie / zamiana). Summary:

1. **Oddanie (giveaway)**: giver lists an item; an attendee of the term opens
   a dialog, clicks "Chcę wziąć" → item locks in giver's inventory
   immediately. After the term ends, both sides get notified and can each
   independently confirm ("wziąłem" / "odebrałem"); whoever confirms first
   finalizes the transaction (inventory transfer).
2. **Zamiana (exchange)**: either side lists an item for exchange; the other
   party opens a dialog, picks "chcę", and offers their own item(s) → this
   locks the offered item and notifies the listing owner, who can
   accept/reject (itself notifying the proposer). Once accepted, after the
   term ends both sides see "Czy doszło do zamiany?" — first to confirm
   finalizes the mutual inventory swap.

## Q&A (all rounds)

### Round 1 — Codebase-analysis clarifications (see `clarifications.md`)
- Remove the existing WIP's auto-confirm-on-take; build a genuine
  independent-party confirm race.
- Lock + notification fire immediately on take/propose (not deferred to
  term-end); only the confirm action itself is gated on `term.occurs_on`
  having passed.
- Swap is two distinct stages: propose+accept/reject (pre/during term), then
  post-term first-confirm-wins finalization.
- Unrelated in-flight WIP (home_inventory_id migration, WypozyczoneView.tsx,
  people-router endpoint) stays untouched — separate feature.

### Round 2 — Gap-analysis decisions (see `scope-clarifications.md`)
- **D1**: new dedicated `SwapProposal` entity (proposer, target listing,
  offered item, status PROPOSED/ACCEPTED/REJECTED).
- **D2**: V1 scope is one-item-for-one-item only; multi-item swap descoped.
- **D3**: term-end detection via a **new APScheduler-based periodic worker**
  (see `technical-clarifications.md`) that scans `Term.occurs_on` and emits
  a domain event into the existing outbox exactly once per affected
  proposal/reservation; delivery (outbox→listener→notification) unchanged
  from today's pattern.
- **D4**: the losing side of the confirm race also receives a `Notification`.
- Dedicated `reject_swap_proposal` function (cancel + release lock + notify,
  one transaction).
- New feature-scoped confirm-authorization rule; `_require_holder_to_confirm`
  (used by the unrelated Pledge flow) stays untouched.

### Round 3 — Technical clarification
- Periodic worker implemented via a **new APScheduler dependency**, wired
  into the FastAPI app lifecycle (start/stop with the app), living in
  `app.groups` (using `circulation_bridge` for any cross-context reads) —
  chosen over a zero-dependency in-process `asyncio` loop.

### Round 4 — UI placement & unification (critical business requirement)
- **One unified term page**, shown identically to logged-in and
  not-logged-in users — not two separately maintained
  Private/Public components. Currently `KragGrupyPage.tsx` implements this
  as two large, mirrored, independently-coded views
  (`PrivateKragGrupyView` / `PublicKragGrupyView`, ~1400 lines total, with
  duplicated logic per the codebase analysis) — **this rework should
  converge them into one component/view**, with auth state as a rendering
  concern, not a separate code path.
  - Only a logged-in user can: register for the term, take/lend/exchange
    items, later confirm receipt, and express intent to bring
    organizer-requested items.
  - A not-logged-in user **sees all the same buttons**, but clicking any
    action prompts login/registration first (this pattern already partly
    exists via `showTakeGate`/`handlePublicTake` in the current
    `PublicKragGrupyView` — extend it, don't reinvent it).
  - User's own words: *"Mamy mieć jedną stronę terminu. Ta sama dla
    niezalogowanego i zalogowanego usera... Niezalogowany user widzi te
    wszystkie buttony ale jak klika w jakąś z akcji dostaje że musi się
    zalogować lub zarejestrować. To jest całe klu biznesu."* (This is the
    whole business key.)
- **Action placement**:
  - "Chcę wziąć" (giveaway) and picking/offering an item for swap: stay on
    the term page, same as today.
  - Accept/reject of an incoming swap proposal, AND the post-term-end
    confirm action ("wziąłem"/"odebrałem"/"Czy doszło do zamiany?"): must be
    a **global modal/dialog** that appears to the user as soon as they enter
    the app on ANY page (not only when they happen to visit the specific
    term page) — analogous to, but more forceful than, the existing
    notification bell (which is just a list item, not a forced modal).
  - "Moje rzeczy" (`RzeczyView.tsx`) gets only a passive status badge
    (e.g. "zablokowane / czeka na potwierdzenie") on affected items — no
    action buttons there.

## Similar Existing Features / Reusable Patterns

- `app/groups/application/pledge_fulfillment.py` — precedent for a
  groups-layer flow that: creates a circulation `Reservation`, fires a
  notification via `notifications_bridge`, and later confirms/fulfills.
  Directly analogous shape for the new giveaway confirm-race function.
- `app/groups/application/term_item_listings.py` — the Term-aware
  browse/eligibility/derived-status bridge layer; reuse
  `_require_term_eligibility` and the `_resolve_listing_status` pattern
  as-is; its `take_item_listing` function is what gets reworked (remove
  auto-confirm, split propose/accept for swap).
- `app/groups/infrastructure/notifications_bridge.py` +
  `app/notifications/*` — full notification stack, reuse as-is, only add
  new `NotificationKind` members.
- `app/outbox/*` + `app/notifications/outbox_listener.py` — outbox/listener
  pattern, reuse unchanged as the delivery mechanism for term-end events.
- `app/groups/infrastructure/circulation_bridge.py` — ACL pattern; extend
  with a `cancel_reservation`/reject pass-through, follow existing function
  shapes.

## Visual Assets

None provided. New UI (swap-offer dialog, accept/reject global modal,
post-term confirm global modal, status badges in `RzeczyView.tsx`) is to be
designed matching the existing Tailwind-based style already used in
`KragGrupyPage.tsx` / `RzeczyView.tsx` / `PanelHeader.tsx`.

## Functional Requirements Summary

1. Giveaway: lock-on-take (already structurally correct, just remove
   auto-confirm) → term-end detection (APScheduler) → dual notification →
   global-modal first-to-confirm race → inventory transfer → loser
   notified.
2. Exchange: propose (lock proposer's offered item, notify listing owner) →
   accept/reject via global modal (accept locks the listed item too and
   notifies proposer; reject releases the proposer's lock and notifies them)
   → term-end detection → dual notification → global-modal first-to-confirm
   race ("Czy doszło do zamiany?") → mutual inventory swap → loser notified.
3. Unify `KragGrupyPage.tsx`'s Private/Public views into one component;
   not-logged-in users see all action buttons but are redirected to
   login/register on click.
4. `RzeczyView.tsx` gains a passive lock/pending status badge, no new
   action buttons.

## Scope Boundaries (Out of Scope)

- Multi-item swap (N-for-1/N-for-M) — explicitly descoped to V1 (D2).
- The unrelated in-flight "borrowed items" feature (home_inventory_id
  migration, `WypozyczoneView.tsx`, people-router `by-account-user-id`
  endpoint) — must not be touched.
- Push/email/SMS notification channels — in-app notification inbox only,
  unchanged delivery mechanism.

## Technical Considerations

- New dependency: APScheduler (pyproject.toml + uv.lock update).
- New entity: `SwapProposal` (new Alembic migration).
- New `NotificationKind` members (new Alembic migration or enum-column
  alteration, depending on how the enum is currently persisted — verify in
  spec).
- Existing tests that assert today's auto-confirm/holder-only-confirm
  behavior (`test_circulation.py`, `test_term_item_listings.py`,
  `test_term_item_listings_router.py`, `test_pledge_fulfillment.py`) need
  deliberate rewriting, not just additive new tests.
- Global modal requires new app-wide state (likely extending
  `PanelDataContext.tsx`, which already centralizes notification state) so
  it can render regardless of current route.
