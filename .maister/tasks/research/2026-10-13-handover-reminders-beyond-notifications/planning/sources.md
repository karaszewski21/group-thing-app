# Research Sources

Repo root: `C:\Users\karas\Desktop\swaptime\group-thing-app`. Backend = `src/backend/app/` (FastAPI), frontend = `src/frontend/src/` (React/Vite). All paths below verified to exist on 2026-10-13.

## Codebase Sources

### Handover lifecycle (backend)
- `src/backend/app/circulation/models.py` — `ReservationType` (LEND/RETURN/SWAP/GIFT), `ReservationStatus` (PENDING/CONFIRMED/CANCELLED/FULFILLED), `Reservation`, ledger models
- `src/backend/app/circulation/application/{reservations,reservation_transitions,movements,inventory,inventory_items,item_details}.py`
- `src/backend/app/circulation/domain/{reservation_rules,constants,item_privacy}.py`
- `src/backend/app/circulation/infrastructure/{ledger,repository}.py`, `router.py`, `schemas.py`, `service.py`
- `src/backend/app/groups/models.py` — `Term` (`occurs_on` datetime incl. start time; no location column seen), `NeededItem`, `Pledge`, `SwapProposal`, statuses
- `src/backend/app/groups/application/{term_item_listings,pledges,pledge_fulfillment,term_end_scan,exchange_summary,attendance,terms}.py`
- `src/backend/app/groups/domain/{swap_events,pledge_events,confirm_race_rules}.py`
- `src/backend/app/groups/infrastructure/{circulation_bridge,notifications_bridge,outbox_bridge}.py`
- `src/backend/app/groups/router/{term_item_listings,pledges,terms}.py`

### Notifications and scheduling (backend)
- `src/backend/app/notifications/{models,service,repository,router,schemas,outbox_listener}.py` — `NotificationKind` (14 kinds), `read_at`, `link_path`, `proposal_id`
- `src/backend/app/outbox/{dispatcher,models,registry,scheduler,service}.py` — transactional outbox
- `src/backend/app/main.py` — APScheduler `AsyncIOScheduler` (term-end scan, media sweep), outbox loop
- `src/backend/app/users/models.py` — `User.email` (nullable)
- `src/backend/app/families/`, `src/backend/app/auth/router.py` — how contact data is collected

### Frontend
- `src/frontend/src/components/shared/NotificationBell.tsx`, `src/frontend/src/hooks/useNotifications.ts`, `src/frontend/src/api/notifications.ts`
- `src/frontend/src/pages/panel/{PanelPage,PanelDataContext,PanelModals,panelDataStore,panelHelpers}.tsx|ts`
- `src/frontend/src/pages/panel/views/{HomeView,RzeczyView,WypozyczoneView,SpotkaniaView}.tsx`
- `src/frontend/src/pages/krag/{TermPage,PublicTermView,termViewModel}.tsx|ts`, `pages/krag/components/{TermCard,TermFooter,SwapProposeDialog,NeededItemsSection}.tsx`, `pages/krag/hooks/{useItemTake,useNeededItemPledge}.ts`
- `src/frontend/src/api/{reservations,termItemListings,terms,pledges,inventories,items}.ts`
- `src/frontend/src/pages/organizer/blocks/ExchangeBoardBlock.tsx`

### Tests (executable specification)
- `src/backend/tests/{test_circulation,test_circulation_ledger,test_term_end_scan,test_notifications,test_outbox,test_swap_proposal_model,test_pledge_fulfillment,test_term_item_listings,test_term_item_listings_router,test_exchange_summary,test_lend_step0_fixes,test_my_attendances}.py`

## Documentation Sources

### Project documentation
- `.maister/docs/INDEX.md`, `.maister/docs/project/architecture.md`, `.maister/docs/project/tech-stack.md`
- `.maister/docs/standards/frontend/data-fetching.md` (polling/query conventions), `.maister/docs/standards/backend/models.md`
- `docs/system-wypozyczalni-inventory-accounting.md`
- `ux-grup/{boisko,default,table}.png`, `pages/ProfilMobilny.tsx`

### Prior research
- `.maister/tasks/research/2026-09-23-termpage-state-machine/outputs/research-report.md`
- `.maister/tasks/research/2026-09-25-lend-lifecycle-virtual-inventory/outputs/{research-report,decision-log,high-level-design,solution-exploration}.md`
- `.maister/tasks/research/2026-09-22-business-model-fit-recurring-groups/outputs/research-report.md`
- `.maister/tasks/research/2026-09-02-party-archetype-organizer-group/outputs/research-report.md`

### Prior development tasks (spec.md, work-log.md, implementation-plan.md under implementation/)
- `.maister/tasks/development/2026-09-14-lending-exchange-mechanism/`
- `.maister/tasks/development/2026-09-16-item-giveaway-exchange-rework/`
- `.maister/tasks/development/2026-09-17-fix-giveaway-exchange/`
- `.maister/tasks/development/2026-09-20-fix-item-reservation-confirm-flow/`
- `.maister/tasks/development/2026-09-25-lend-step0-security-fixes/`
- `.maister/tasks/development/2026-09-28-circulation-ledger-item-movements/`
- `.maister/tasks/development/2026-09-10-notifications-single-claim/standards-compliance.md`

## Configuration Sources
- `src/backend/pyproject.toml` — deps include `apscheduler>=3.10,<4`, `httpx`; no email or web-push library
- `.env.example` — key names only (no SMTP/mail/VAPID keys present). NEVER read or print `.env`.
- `docker-compose.yml` — services/process model (single backend process hosting scheduler?)
- `src/frontend/package.json`, `src/frontend/vite.config.ts`, `src/frontend/index.html`, `src/frontend/public/`, `src/frontend/nginx.conf` — PWA/service worker/manifest presence
- `src/backend/alembic/versions/` — 0031 swap_proposal, 0032/0040 notification ids, 0034 reservation_term_id, 0039 reservation_giver_user_id, 0042 movement ledger

## External Sources (web)
- P2P sharing/marketplace: Olio, Too Good To Go, Vinted, OLX, Buy Nothing, Freecycle, Peerby, tool libraries (myTurn, Library of Things) help centers
- Meetup/Eventbrite/Calendly: reminder cadence, add-to-calendar
- RFC 5545 (iCalendar) / Google Calendar "render?action=TEMPLATE" link format
- Web Push: MDN Push API, web.dev push notifications, WebKit blog on iOS 16.4 web push for home-screen web apps
- Evidence: appointment-reminder no-show meta-analyses (e.g. Cochrane/PubMed SMS reminder reviews), implementation-intention research (Gollwitzer), web push opt-in benchmarks
