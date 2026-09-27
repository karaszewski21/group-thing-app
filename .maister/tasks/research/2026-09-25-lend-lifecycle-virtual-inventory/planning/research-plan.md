# Research Plan — LEND lifecycle after hand-over (virtual inventory, return, extension, overdue, dispute)

## 1. Research Overview

**Question (restated):** How should the LEND (wypożyczenie) feature be designed end-to-end in the
Krąg/Term parent-group sharing app — from the LEND offer and hand-over (item moves into the
borrower's VIRTUAL inventory) through everything that happens afterwards: borrower-initiated
return intent, owner-initiated return request, extension, due date + reminders, overdue, the
physical return hand-over and the owner's receipt confirmation, disputes (not returned / damaged /
lost), and cancellation — within the existing `app.circulation` / `app.groups` DDD split?

**Research type:** Mixed
- Technical — inventory what exists for LEND/RETURN in BE + FE, with file:line evidence; find gaps.
- Requirements/product — which states, events, actors and confirmations the lifecycle needs.
- Literature — how peer-to-peer lending / Library of Things / tool libraries / rental marketplaces
  handle returns, extensions, overdue, condition check, disputes.

**Scope (in):** full LEND state model (offer → closed); post-lend events listed above; where/when
the return hand-over happens (next Term? outside a Term?); role of VIRTUAL inventory,
`home_inventory_id`, `InventoryBalance` (LENT, due_date), points ledger; notifications and UI
(panel "Wypożyczone"/"Moje rzeczy", TermPage); relation to Pledge→LEND to organizer; effect on
`item_listing_preferences` (LEND keeps the preference).

**Scope (out):** implementation; money, deposits, insurance; changes to GIFT/SWAP beyond shared
mechanism.

**Constraints:** `app.groups` ↔ `app.circulation` only via
`app/groups/infrastructure/circulation_bridge.py` (circulation knows nothing about Terms or
preferences); standards in `.maister/docs/standards/` (minimal-implementation, models.md —
string enums, BaseEntity, lazy="raise"; migrations.md); pre-production — schema/URL changes allowed,
no compat shims.

### Sub-questions

**A. Current state (technical)**
- A1. Which LEND/RETURN code paths exist today? (`ReservationType.LEND/RETURN`,
  `BalanceStatus.LENT/RETURNED`, `get_or_create_virtual_inventory`, `fulfill_reservation`
  LEND/RETURN branches, `_DEFAULT_LEND_DAYS=14`, `_resolve_return_term_id`, `balance.due_date`,
  `permanent inventory` helper in `inventory_items.py`.)
- A2. How is a LEND created and fulfilled from a Term (`take_item_listing`, `confirm_transaction`,
  `resolve locked exchange` in `term_item_listings.py`), and from a Pledge (`pledge_fulfillment.py`
  auto-confirm LEND to organizer)?
- A3. What does the current RETURN do (FE `PanelDataContext.returnBorrowedItem`: borrower-only
  RETURN + confirm + fulfill in one step)? Who is authorized to call the endpoints
  (`circulation/router.py`, `AUTHORIZATION_MATRIX`)?
- A4. What does the points ledger post on LEND and RETURN (`infrastructure/ledger.py`,
  `_POSTED_AMOUNT`), and is it consistent with `docs/system-wypozyczalni-inventory-accounting.md`
  KROK 4/5?
- A5. Which notification kinds, outbox events, and scheduled jobs (`term_end_scan`, APScheduler in
  `main.py`, `outbox/scheduler.py`) exist and could host reminders/overdue scans?
- A6. How do the in-progress (uncommitted) changes — `reservations.giver_user_id` (migration 0039),
  edits in `reservation_transitions.py`, `reservations.py`, `term_item_listings.py`,
  `circulation_bridge.py`, `PanelDataContext.tsx`, `useItemTake.ts` — affect LEND?
- A7. How does the FE show borrowed/lent items (WypozyczoneView, RzeczyView, HomeView,
  panelHelpers, TermPage labels) and what data does it read (`api/inventories.ts`,
  `api/reservations.ts`)? Does the owner see "lent out, due X, borrower Y"?
- A8. What does `item_listing_preferences` do for a LEND-ed item (listing persists? item can be
  re-listed/taken while LENT?).

**B. Requirements / lifecycle model**
- B1. Minimal state set for a loan (e.g. REQUESTED/PENDING → CONFIRMED → ACTIVE(LENT) →
  RETURN_REQUESTED / RETURN_PROPOSED → RETURNED(confirmed) | OVERDUE | DISPUTED | LOST | CANCELLED)
  — which states must be stored vs derived (overdue = now > due_date).
- B2. Who initiates / who confirms each transition; which require two-sided confirmation
  (return receipt by owner) vs one-sided.
- B3. Where the return hand-over happens: bound to a future Term (like the original exchange, with
  `confirm_transaction` after term end) vs ad-hoc outside Terms; what the RETURN reservation's
  `term_id` should be.
- B4. Extension: who requests, who approves, bounds; due-date model (fixed default 14 days vs
  term-cadence-based "until next Term").
- B5. Reminders & overdue: timings, channels (in-app notifications only?), escalation.
- B6. Disputes: not returned / damaged / lost — states, who can raise, resolution outcomes
  (write-off → item leaves owner's inventory? balance status?), ledger reversal.
- B7. Cancellation: before hand-over (PENDING/CONFIRMED) vs after (not possible — becomes return).
- B8. Pledge→LEND to organizer: same return mechanism or distinct (organizer returns after Term?).
- B9. Aggregate/consistency boundary: is a "Loan" a new aggregate in circulation, or is it the
  LEND Reservation + balance + RETURN Reservation pair? Where does per-Term context live (groups)?

**C. External patterns**
- C1. Library of Things / tool libraries (e.g. Leihladen, Library of Things London, myTurn,
  Lend Engine, Toronto Tool Library): loan periods, renewals, reminders, overdue policy,
  check-in with condition check, damaged/lost handling.
- C2. P2P lending/rental marketplaces (Peerby, Fat Llama, Hygglo, Turo-like flows, BookCrossing,
  Kinder-/Tauschbörse, Buy Nothing "borrow"): return request by owner, return confirmation,
  dispute flow, trust/reputation.
- C3. Public library ILS semantics (Koha/Evergreen): checkout, renewal limits, holds blocking
  renewal, overdue/lost states, claims-returned status.
- C4. Modelling patterns: loan as state machine; accounting-style reversal entries for returns;
  derived overdue status.

## 2. Methodology

**Primary approach:** multi-strategy
1. Codebase analysis (Glob/Grep/Read) of circulation + groups + notifications/outbox + FE panel/krag,
   including the uncommitted working-tree changes (`git diff`).
2. Document/decision review of the reference accounting design doc, project docs, standards, and
   prior `.maister` tasks (lending-exchange-mechanism, giveaway rework, confirm-flow fix,
   termpage-state-machine research) to extract already-made decisions on LEND.
3. External literature/web research on lending-lifecycle patterns.

**Fallback strategies:**
- If code intent is unclear, read tests (`tests/test_circulation.py`, `test_term_item_listings*.py`,
  `test_pledge_fulfillment.py`, `test_term_end_scan.py`, FE `PanelPage.test.tsx`, `TermPage.test.tsx`)
  as executable specification.
- If external sources are thin, fall back to public-library ILS documentation (Koha manual) and
  Library-of-Things software docs (Lend Engine, myTurn) which describe the lifecycle explicitly.

**Analysis framework:**
- Technical: component inventory → transition table (current) → data flow (inventory_id /
  home_inventory_id / balance.status / due_date / ledger entries per transition) → gap list.
- Requirements: actor × event matrix (borrower, owner, organizer, system/scheduler) with
  confirmation requirements; stored vs derived state; per-transition side effects
  (inventory, balance, ledger, notification, listing preference).
- Literature: pattern comparison table (renewal, reminders, overdue, owner recall, check-in
  condition, lost/damaged, dispute) → applicability to a small-trust parent group without money.
- Synthesis output: proposed state + event model, gaps, and open product decisions.

## 3. Research Phases

**Phase 1 — Broad discovery**
- Grep for `LEND|RETURN|LENT|RETURNED|due_date|VIRTUAL|home_inventory_id|returnBorrowedItem|borrowed`
  across `src/backend/app` and `src/frontend/src`.
- `git diff` of the modified files listed in sources.md (uncommitted state is relevant).
- List prior `.maister` task docs mentioning LEND/wypożycz/zwrot.
- Web search queries for C1–C4.

**Phase 2 — Targeted reading**
- Read `circulation/models.py`, `domain/constants.py`, `domain/reservation_rules.py`,
  `application/reservations.py`, `application/reservation_transitions.py`,
  `application/inventory.py`, `application/inventory_items.py`, `infrastructure/ledger.py`,
  `router.py`, `schemas.py`, `service.py`.
- Read `groups/application/term_item_listings.py` (take/confirm/resolve), `pledge_fulfillment.py`,
  `term_end_scan.py`, `infrastructure/circulation_bridge.py`, `notifications_bridge.py`,
  `outbox_bridge.py`, `groups/models.py` (TermItemListing, preferences).
- Read FE `PanelDataContext.tsx`, `WypozyczoneView.tsx`, `RzeczyView.tsx`, `HomeView.tsx`,
  `panelHelpers.ts`, `api/reservations.ts`, `api/inventories.ts`, `TermPage.tsx`, `useItemTake.ts`,
  `termLabels.ts`.
- Read `docs/system-wypozyczalni-inventory-accounting.md` sections 2 (KROK 4–5), 3, 5.

**Phase 3 — Deep dive**
- Trace one LEND end-to-end: take → PENDING → confirm after Term → fulfill (inventory move,
  balance LENT, due_date, ledger) → current RETURN; note authorization at each endpoint.
- Trace Pledge→LEND auto-confirm path and whether it ever returns.
- Check what the scheduler/outbox can do for time-based reminders (job registration pattern,
  idempotency, notification single-claim pattern).
- Check behavior of listing preferences / TermItemListing for an item currently LENT (can it be
  listed/taken on another Term while in VIRTUAL inventory?).

**Phase 4 — Verification**
- Cross-check code vs reference accounting doc vs prior task specs; flag contradictions.
- Confirm findings against tests.
- Cross-check external patterns across ≥2 sources each.

## 4. Gathering Strategy

### Instances: 4

| # | Category ID | Focus Area | Tools | Output Prefix |
|---|------------|------------|-------|---------------|
| 1 | codebase-backend | `app.circulation` + `app.groups` LEND/RETURN paths, inventory/balance/ledger effects, due_date, pledge LEND, notifications/outbox/APScheduler, authorization, tests, uncommitted diff (A1–A6, A8, B9 evidence) | Glob, Grep, Read, Bash (git diff) | codebase-backend |
| 2 | codebase-frontend-ux | Panel "Wypożyczone"/"Moje rzeczy", `returnBorrowedItem`, TermPage/useItemTake LEND UX, notification display, API clients; what owner vs borrower sees (A7) | Glob, Grep, Read | codebase-frontend |
| 3 | docs-decisions | Reference doc `system-wypozyczalni-inventory-accounting.md`, project docs, standards (models, minimal-implementation, migrations, security), prior `.maister` task specs/clarifications/decisions on LEND, return, exchange confirm flow, term state machine (B1–B9 constraints and already-decided points) | Read, Grep | docs |
| 4 | external | Library of Things / tool libraries / P2P rental marketplaces / library ILS lifecycle patterns: renewals, reminders, overdue, owner recall, check-in condition check, lost/damaged, disputes, trust (C1–C4) | WebSearch, WebFetch | external |

### Rationale
The question spans three source types with distinct tooling. Backend and frontend are split because
the backend holds the state/accounting model (the core of the gap analysis) while the frontend holds
the currently-flawed one-step return UX and the owner/borrower visibility question — both are large
enough to warrant dedicated gatherers. Configuration is not a separate category: the only relevant
config (APScheduler job wiring in `main.py`, Alembic migrations) is covered by codebase-backend.
Prior `.maister` tasks are grouped with docs since they carry decisions, not code.

## 5. Success Criteria
1. Inventory of existing LEND/RETURN behavior (BE + FE) with file:line citations, including the
   uncommitted working-tree changes.
2. Explicit gap list vs full lifecycle (return intent, owner recall, extension, reminders, overdue,
   owner receipt confirmation, dispute/lost/damaged, cancellation, pledge-LEND return).
3. Proposed state + event model: per transition — initiator, confirmer, stored vs derived state,
   effects on inventory (`inventory_id`/`home_inventory_id`), `InventoryBalance`, ledger,
   notifications, listing preferences; placement respecting the circulation_bridge boundary.
4. External patterns table with ≥ 6 cited sources across ≥ 3 platform types.
5. List of open product decisions for the user (e.g. return bound to Term or ad hoc; default loan
   length; extension approval; owner-confirm required; lost/damaged outcome; organizer pledge LEND).

## 6. Expected Outputs
- `analysis/findings/codebase-backend-*.md`, `codebase-frontend-*.md`, `docs-*.md`, `external-*.md`
- `analysis/synthesis.md` — cross-referenced findings
- `outputs/research-report.md` — current-state inventory, gaps, proposed lifecycle state machine
  (table + diagram), external patterns, open decisions; input for `/maister:development`.
