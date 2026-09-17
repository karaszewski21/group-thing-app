# Gap Analysis: Item Giveaway & Exchange Rework

## Summary
- **Risk Level**: Medium-High
- **Estimated Effort**: Medium-High
- **Detected Characteristics**: modifies_existing_code, creates_new_entities (pending decision D1/D2), involves_data_operations, ui_heavy

## Task Characteristics
- Has reproducible defect: no
- Modifies existing code: yes (`take_item_listing`, `reservation_rules.py`, `circulation_bridge.py`, `KragGrupyPage.tsx`, `RzeczyView.tsx`)
- Creates new entities: likely yes, pending Decision D1 — a swap-proposal concept is needed; whether it's a new ORM entity or a repurposed field on `Reservation` is not yet settled
- Involves data operations: yes (lock/create, accept/reject, confirm/fulfill, notify — full lifecycle)
- UI heavy: yes (new dialogs, status badges, accept/reject actions, two large duplicated page components)

## Gaps Identified

### Missing Features

1. **Reject/decline path for swap proposals — orphaned today.** `reservation_transitions.py:76-93` (`cancel_reservation`) and `router.py:198-204` (`POST /api/reservations/{id}/cancel`) already exist, authorized for either party. But `circulation_bridge.py:27-46` does not export a cancel/reject pass-through, and nothing in `term_item_listings.py` or the frontend calls it. No reject flow fires the required "return notification." Gap: groups-layer `reject_*` function + bridge pass-through + notification + frontend button, not a new low-level primitive.

2. **Two-stage swap proposal (propose → accept/reject → durable lock) has no backend representation.** `circulation_bridge.create_swap` locks BOTH items to `RESERVED` in one atomic call, no accept/reject step in between. Spec requires only the proposer's own offered item(s) to lock at propose time; the listed item locks only once the counterparty accepts. Genuine sequencing gap — may require a new entity (Decision D1).

3. **Multi-item swap offers.** Spec says "podaje listę swoich rzeczy" (plural). `create_swap`/`CreateSwapRequest` is hard-coded to exactly one item per side; `paired_reservation_id` is a strict 1:1 self-FK. Frontend's single `<select>` matches this 1:1 limitation. Biggest scope question — Decision D2.

4. **Post-term first-to-confirm race for BOTH flows.** No endpoint/function/authorization exists for "either party can be first to confirm, gated to only after `term.occurs_on`." Today's `confirm_reservation` is holder-only and has no term-awareness (circulation is deliberately Term-independent). Needs a new function in `term_item_listings.py` that: loads the Term, rejects if `term.occurs_on > utcnow()` (new, inverted check — separate from the existing browse/take guard which stays as-is), confirms+fulfills in one step, and for SWAP resolves both paired legs from one click.

5. **Term-end notification trigger.** Nothing in the codebase reacts to time passing — no scheduler/cron precedent (`app.outbox` is event-triggered, not time-triggered). New infrastructure question — Decision D3.

6. **Frontend: swap multi-item dialog, accept/reject UI, lock/pending status badges, post-term confirm UI.** None exist. `RzeczyView.tsx` has zero lock/pending indicator. `KragGrupyPage.tsx`'s "Potwierdź odbiór" buttons are the wrong semantics (physical-receipt fulfill, not a race, not term-end-gated) and need replacing/extending, duplicated across private and public page variants.

### Incomplete Features

- `take_item_listing` correctly locks the item immediately (already satisfies clarification Q2 structurally — `BalanceStatus.RESERVED` set at PENDING creation). Incomplete only in that it then wrongly auto-confirms instead of leaving PENDING for the later race, and creates a rigid 1:1 SWAP instead of a proposal.

### Behavioral Changes Needed

- `confirm_reservation`'s authorization: from holder-only to either-party-first-wins — but scoped to this feature only, not circulation-wide (see Important Decision #2 below re: Pledge flow risk).
- `take_item_listing`'s term gate direction: browse/take stays blocked before term end (unchanged, correct); a NEW, separate gate blocks confirm/finalization before term end.

## Data Lifecycle Analysis

### Entity: Giveaway item transaction (GIFT Reservation)

| Operation | Backend | UI | Status |
|-----------|---------|----|--------|
| CREATE (take/lock) | `create_reservation` locks at PENDING | "Chcę wziąć" button wired | ✅ (minus removing auto-confirm) |
| NOTIFY on lock | `notifications_bridge.create_notification` exists | Bell UI reusable | ✅ (only lister notified today) |
| POST-TERM NOTIFY (both sides) | MISSING — no time trigger | MISSING | ❌ |
| CONFIRM (either party, first wins) | MISSING authorization + endpoint | MISSING | ❌ |
| TRANSACTION (inventory move) | `fulfill_reservation` exists, not wired to new confirm race | n/a | ⚠️ |
| LOSER FEEDBACK | MISSING — unspecified | MISSING | ❌ |

**Completeness**: ~40% (locking works; everything from term-end onward is unbuilt)

### Entity: Swap proposal (SWAP Reservation pair)

| Operation | Backend | UI | Status |
|-----------|---------|----|--------|
| PROPOSE (lock own offered items) | Only 1:1 `create_swap`, locks both sides at once — wrong sequencing | Single `<select>` only | ❌ |
| NOTIFY counterparty on propose | Exists generically, not wired for this stage | n/a | ❌ |
| ACCEPT/REJECT | MISSING entirely | MISSING | ❌ |
| RETURN NOTIFY on accept/reject | MISSING | MISSING | ❌ |
| DURABLE LOCK on accept | Second leg would need creating only now | MISSING | ❌ |
| POST-TERM "Czy doszło do zamiany?" | MISSING | MISSING | ❌ |
| TRANSACTION (mutual swap) | `fulfill_reservation` SWAP branch exists, unwired | n/a | ⚠️ |

**Completeness**: ~15% — only low-level circulation primitives exist; propose→accept/reject→confirm-race orchestration and UI is entirely new.

## User Journey Impact Assessment

| Dimension | Current | Target | Assessment |
|-----------|---------|--------|-------------|
| Reachability | Term page has take buttons + single-select swap picker | Same entry point, richer dialog | ✅ no navigation change needed |
| Discoverability | 6/10 (bare `<select>`, no dialog framing) | 8/10 with proper dialog, item list, multi-select | ✅ standard improvement |
| Flow Integration | Single unlabeled "Potwierdź odbiór", receipt-framed | Needs distinct giver/receiver confirm copy, term-end gating, "already resolved by other party" feedback | ⚠️ moderate risk — must not confuse users about *when* actionable and *why* |
| Multi-Persona | Shared generic listing UI | Symmetric but differently-labeled actions ("wziął" vs "odebrałeś") | ⚠️ needs persona-aware copy, both private and public page variants |

## Issues Requiring Decisions

### Critical

- **D1 — Swap proposal representation**: new `SwapProposal` entity vs. reusing `Reservation` with a new nullable link column. Recommendation: new entity if multi-item (D2) is in scope; bare column only if D2 descopes to 1-for-1.
- **D2 — Multi-item swap offer scope**: build genuine N-for-1/N-for-M this iteration vs. descope to exactly one offered item for v1 (matches prior precedent and current schema). Biggest scope driver of the whole task.
- **D3 — Term-end notification trigger mechanism**: (A) new scheduled job/worker (no precedent, higher risk) vs. (B) lazy check — compute/notify next time either party's notifications or the relevant endpoint is hit (fits existing `occurs_on < utcnow()` lazy-check style, zero new infra). Recommendation: (B).
- **D4 — Losing-side feedback**: silent inline toast only vs. also create a `Notification` row for the party who didn't win the race. Recommendation: (B) for consistency with "always notify both sides."

### Important

- **Reject naming/reuse**: reuse generic `cancel_reservation` via a bare bridge pass-through, vs. a semantically distinct groups-level `reject_swap_proposal` that also releases the proposer's offered-item lock and fires the notification transactionally. Default: the latter.
- **Scope of `_require_holder_to_confirm` change**: loosen the shared circulation-wide rule (simpler, but risks Pledge-flow regression) vs. a new feature-scoped confirm entry point in `app.groups` leaving circulation's rule untouched for Pledge. Default: the latter (safer).

## Recommendations

- Reuse `create_reservation`/`create_swap`'s existing immediate-lock behavior as-is for giveaway; only change is removing the two auto-confirm calls in `term_item_listings.py`.
- Resolve D1/D2 before specification — determines whether this needs a new persisted entity or just new columns/functions.
- Resolve D3 with a lean toward lazy-check unless the user specifically wants a true push notification at term-end.
- Add missing `cancel_reservation`/`reject_*` pass-through in `circulation_bridge.py` and a term-domain `reject_swap_proposal` in `term_item_listings.py`.
- Add new `NotificationKind` members (e.g. `SWAP_PROPOSED`, `SWAP_ACCEPTED`, `SWAP_REJECTED`, `TERM_CONFIRMATION_NEEDED`, optionally `TERM_TRANSACTION_ALREADY_RESOLVED`) plus an Alembic migration.
- Frontend: one true multi-item-capable dialog component reused by both private and public page variants; a lock/pending badge on `RzeczyView.tsx` driven by a new derived field.

## Risk Assessment

- **Complexity Risk**: Medium-High — compound orchestration across 3 bounded contexts (circulation, groups, notifications) via ACL bridges, not any single primitive.
- **Integration Risk**: Medium — `_require_holder_to_confirm` is shared with the unrelated, tested Pledge flow (mitigated by scoping the change per Important Decision #2).
- **Regression Risk**: Medium — `test_circulation.py`, `test_term_item_listings.py`, `test_term_item_listings_router.py`, `test_pledge_fulfillment.py` all currently assert against today's auto-confirm/holder-only-confirm behavior; need deliberate rewriting.
- **Scope Risk**: High until D1/D2 resolved.

## Key Files
- `src/backend/app/circulation/models.py`
- `src/backend/app/circulation/application/reservations.py`
- `src/backend/app/circulation/application/reservation_transitions.py`
- `src/backend/app/circulation/domain/reservation_rules.py`
- `src/backend/app/circulation/router.py`
- `src/backend/app/groups/application/term_item_listings.py`
- `src/backend/app/groups/infrastructure/circulation_bridge.py`
- `src/backend/app/groups/models.py`
- `src/backend/app/notifications/models.py`
- `src/frontend/src/pages/krag/KragGrupyPage.tsx`
- `src/frontend/src/pages/panel/views/RzeczyView.tsx`
- `src/frontend/src/hooks/useKragGrupy.ts`
