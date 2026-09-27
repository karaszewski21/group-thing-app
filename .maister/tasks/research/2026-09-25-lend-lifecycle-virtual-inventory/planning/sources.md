# Research Sources — LEND lifecycle

Repo root: `C:\Users\karas\Desktop\group-thing-app` (paths below are relative to it). All listed
local files were verified to exist on 2026-09-25.

## 1. codebase-backend (prefix `codebase-backend`)

### Circulation (`src/backend/app/circulation/`)
- `models.py` — `InventoryType.VIRTUAL` (~l.52), `BalanceStatus` incl. `LENT`/`RETURNED` (~l.68),
  `ReservationType.LEND/RETURN` (~l.72-73), `InventoryItem.home_inventory_id` (~l.160-166),
  `InventoryBalance.due_date` (~l.188), `Reservation.term_id` notes (~l.224-229), `giver_user_id` (uncommitted)
- `domain/constants.py` — `_DEFAULT_LEND_DAYS = 14`, `_POSTED_AMOUNT`
- `domain/reservation_rules.py` — allowed transitions/validation
- `application/reservations.py` — `_resolve_return_term_id` (l.26+), RETURN from LENT (l.63-80), due_date from expires_at (l.99), LEND creation (l.114)
- `application/reservation_transitions.py` — confirm/cancel/fulfill; LEND branch (l.100-108), RETURN branch (l.109-117)
- `application/inventory.py` — `get_or_create_virtual_inventory` (l.77)
- `application/inventory_items.py` — permanent-owner helper (l.104-124)
- `application/accounts.py`, `application/identity.py`
- `infrastructure/ledger.py` — points postings
- `infrastructure/repository.py` — VIRTUAL inventory queries (l.54)
- `router.py`, `schemas.py`, `service.py` — endpoints, DTOs (`due_date`, `home_inventory_id`), facade

### Groups (`src/backend/app/groups/`)
- `application/term_item_listings.py` — take/propose/accept, `confirm_transaction`, resolve locked exchange (~l.728), inventory view w/ home_inventory_id (~l.141-158)
- `application/pledge_fulfillment.py` — Pledge → LEND to organizer (auto-confirm, l.34+)
- `application/term_end_scan.py` — APScheduler scan pattern (candidate for reminders/overdue)
- `application/exchange_summary.py`, `application/terms.py`
- `domain/confirm_race_rules.py`, `domain/swap_events.py`, `domain/pledge_events.py`
- `infrastructure/circulation_bridge.py` — only allowed groups→circulation path (l.81-87 RETURN note, l.209 VIRTUAL location)
- `infrastructure/notifications_bridge.py`, `infrastructure/outbox_bridge.py`
- `models.py` — TermItemListing, `item_listing_preferences` (l.336 offer types)
- `schemas.py` (l.23 listing offer subset never RETURN), `service.py`, `router/term_item_listings.py`

### Notifications / outbox / scheduler
- `src/backend/app/notifications/models.py` — `NotificationKind` (l.35-60; no LEND/RETURN kinds yet)
- `src/backend/app/notifications/service.py`, `outbox_listener.py`, `router.py`
- `src/backend/app/outbox/` — `dispatcher.py`, `registry.py`, `scheduler.py`, `service.py`, `models.py`
- `src/backend/app/main.py` — AsyncIOScheduler / `add_job` wiring (l.18, 44-80)
- `src/backend/app/core/authorization_matrix.py`, `core/auth_deps.py` — who may call circulation endpoints

### Migrations
- `src/backend/alembic/versions/0030_inventory_items_home_inventory_id.py`
- `.../0033_inventory_personal_virtual_uniqueness.py`, `.../0034_reservation_term_id.py`
- `.../0039_reservation_giver_user_id.py` (untracked, in progress)

### Tests (executable spec)
- `src/backend/tests/test_circulation.py`, `test_term_item_listings.py`, `test_term_item_listings_router.py`,
  `test_term_item_listings_model.py`, `test_pledge_fulfillment.py`, `test_term_end_scan.py`, `test_notifications.py`

### Working-tree changes (run `git diff` on these)
- circulation: `application/reservation_transitions.py`, `application/reservations.py`, `models.py`
- groups: `application/term_item_listings.py`, `infrastructure/circulation_bridge.py`, `infrastructure/repository.py`,
  `models.py`, `router/term_item_listings.py`, `schemas.py`, `service.py`
- tests: `test_term_item_listings.py`, `test_term_item_listings_router.py`

## 2. codebase-frontend-ux (prefix `codebase-frontend`)
- `src/frontend/src/pages/panel/PanelDataContext.tsx` — `returnBorrowedItem`, `borrowedItems` (modified)
- `src/frontend/src/pages/panel/views/WypozyczoneView.tsx` — "Wypożyczone" view
- `src/frontend/src/pages/panel/views/RzeczyView.tsx` — "Moje rzeczy" (owner's lent-out items?)
- `src/frontend/src/pages/panel/views/HomeView.tsx`, `panelHelpers.ts`, `PanelNav.tsx`
- `src/frontend/src/pages/krag/TermPage.tsx`, `termViewModel.ts`, `hooks/useItemTake.ts` (modified),
  `components/termLabels.ts`, `components/SwapProposeDialog.tsx`, `components/NeededItemsSection.tsx`, `hooks/useNeededItemPledge.ts`
- API clients: `src/frontend/src/api/reservations.ts`, `inventories.ts` (modified), `itemListingPreferences.ts` (modified),
  `termItemListings.ts`, `notifications.ts`, `pledges.ts`
- Hooks dir `src/frontend/src/hooks/` (TanStack Query wrappers per data-fetching standard)
- Tests: `src/frontend/src/test/PanelPage.test.tsx` (modified), `TermPage.test.tsx`, `RzeczyViewCategory.test.tsx`
- Prototype reference if present: `pages/*.tsx` prototype (memory: port faithfully)

## 3. docs-decisions (prefix `docs`)

### Reference design
- `docs/system-wypozyczalni-inventory-accounting.md` — §1 data model, §2 KROK 4 (wypożyczenie), KROK 5 (zwrot), §3 when a transaction is posted, §5 InventoryBalance status flow

### Project docs & standards
- `.maister/docs/INDEX.md`
- `.maister/docs/project/architecture.md`, `.maister/docs/project/tech-stack.md`
- `.maister/docs/standards/backend/models.md`, `migrations.md`, `api.md`, `security.md`, `queries.md`
- `.maister/docs/standards/global/minimal-implementation.md`, `error-handling.md`, `validation.md`
- `.maister/docs/standards/frontend/data-fetching.md`, `components.md`
- `.maister/docs/standards/testing/backend-testing.md`

### Prior task decisions
- `.maister/tasks/development/2026-09-14-lending-exchange-mechanism/` — `analysis/requirements.md`, `clarifications.md`, `scope-clarifications.md`, `gap-analysis.md`, `implementation/spec.md`, `work-log.md`, `verification/spec-audit.md`
- `.maister/tasks/development/2026-09-16-item-giveaway-exchange-rework/` — requirements, technical-clarifications, spec, work-log
- `.maister/tasks/development/2026-09-17-fix-giveaway-exchange/` — requirements, spec, `analysis/design-context/ascii/ui-mockups.md`
- `.maister/tasks/development/2026-09-20-fix-item-reservation-confirm-flow/` — requirements, clarifications, spec, ui-mockups
- `.maister/tasks/development/2026-09-10-notifications-single-claim/standards-compliance.md`
- `.maister/tasks/research/2026-09-23-termpage-state-machine/outputs/research-report.md`, `analysis/synthesis.md`
- `.maister/tasks/research/2026-09-22-business-model-fit-recurring-groups/` (product context)
- `.maister/tasks/research/2026-09-02-party-archetype-organizer-group/` (organizer role for pledge LEND)
- User memory: `C:\Users\karas\.claude\projects\C--Users-karas-Desktop-group-thing-app\memory\project_backend_ddd_refactor.md`

## 4. external (prefix `external`)
Search targets (verify and cite actual URLs found):
- Library of Things: libraryofthings.co.uk (borrow/return, late fees, damage policy); Leihladen / Leila Berlin; Toronto Tool Library; Berkeley Tool Lending Library
- Lending software: Lend Engine docs (lend-engine.com — loans, check-in, renewals, reminders, overdue), myTurn (myturn.com — item check-in condition, late notices), Koha manual (circulation: checkout, renew, overdue, lost, "claims returned")
- P2P rental/lending: Peerby, Fat Llama (return confirmation, damage claims), Hygglo, Rent the Runway return flow; Buy Nothing "borrow"; BookCrossing
- Patterns: loan lifecycle state machine; derived overdue; two-sided hand-over confirmation; reputation/trust in small communities; ShareTribe marketplace transaction process (sharetribe.com docs — booking/return/dispute transitions)
