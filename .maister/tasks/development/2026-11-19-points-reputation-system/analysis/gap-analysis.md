# Gap Analysis: System punktów i reputacji

## TL;DR
- Nothing for points exists today. There is no ledger, no `size_class`, no POINTS mode, no attendance confirmation and no DB config. All of it is new, but every piece has a proven pattern to copy: the inventory ledger, `_lock_owner`, category CTEs, admin category CRUD and the organizer attendee list.
- Points are earned at one place, `groups.confirm_transaction`, flush-only before the `fulfill_exchange` commit (term, event and personal). START_BONUS is earned in the insert branches of `create_rsvp` and `events.sign_up`. Attendance +10 is earned at a new organizer write on the existing `/terms/:termId/attendees` page.
- The POINTS mode is the largest piece. It widens about 15 BE/FE enums, adds the hold/settle/release flow in take, confirm, cancel and reject, and needs a price that can be lowered. Shipping earning without spending leaves the balance as a read-only feature with nothing to spend it on.
- Risk is **high**: the change sits in the shared exchange commit path and adds a balance that must never go negative under concurrency. Effort is **high**. **Recommendation:** split the work into two tasks, with earning and display first and POINTS spending second.

## Key Decisions
- Characteristics: modifies_existing_code, creates_new_entities, involves_data_operations, ui_heavy. There is no defect. This is greenfield work inside existing flows.
- Change type is **additive** to the exchange flows. No current behaviour changes, except that the POINTS mode extends the closed GIFT/SWAP enums. Compatibility: **moderate**. Existing GIFT/SWAP routes and responses must stay the same; new fields are additive.
- The organizer attendance tick fits the existing organizer-only page `features/meetings/TermAttendeesPage.tsx`, which reads `GET /api/groups/{g}/terms/{t}/attendees` (`groups/application/memberships.py:119`). Layer 3 (access) already exists. Only the write path and a checkbox are missing.
- Child accounts need no special point handling. CHILD members are lightweight parties with no login (`families/models.py:38-42`), and `create_rsvp` rejects parties without `account_user_id` (`public_view.py:425`). Every reservation party is therefore a login account. The "not for children" rule becomes "point account only for a PERSON party with `account_user_id`".

## Open Questions / Risks
- If spending (POINTS) goes to a follow-up task, users will collect points with nothing to spend them on. The profile must say "wkrótce" or explain this, or the balance looks broken.
- The spec says "Punkty są niezbywalne: brak przelewów". If the points spent on a POINTS item went to the giver, that would be a transfer. Spent points must go to a system sink, and the giver earns separately from the emission account.
- There is no precedent for a concurrent balance with holds, and no append-only enforcement. Both need new tests.
- The existing wants/search recursive CTEs use a comma FROM. The new `size_class` CTE must use `join_from`, with a linting compile test.

## Summary
- **Risk Level**: High (medium-high in the earlier phase. Attendance and the hold flow are now confirmed in scope, which raises it.)
- **Estimated Effort**: High (about 25 BE and 20 FE files, 2-3 migrations, a new BC)
- **Detected Characteristics**: modifies_existing_code, creates_new_entities, involves_data_operations, ui_heavy

## Task Characteristics
- Has reproducible defect: no
- Modifies existing code: yes (confirm/take/cancel/reject in groups, RSVP/sign-up, item create/update, categories, search/wants/organization-stats enums, item actions)
- Creates new entities: yes (`app/points`, `point_accounts`/`point_transactions`/`point_entries`, `points_config`, `categories.size_class`, item `points_value`, attendance confirmation)
- Involves data operations: yes
- UI heavy: yes (profile block, reservation window, item forms with POINTS and price lowering, admin config page and nav, category size class, attendance ticks)

## Gaps Identified

### Missing Features
- **Points ledger**: no tables and no BC. Template: `inventory/models.py:124-163,329-399`, `inventory/infrastructure/ledger.py` (`MOVEMENT_RULES`, flush-only `post_movement`), `tests/ledger_assertions.py`.
- **Valuation**: `categories.size_class` does not exist (`category/models.py`). There is no `points_value` on `InventoryItem` (`inventory/models.py:184-236`).
- **points_config**: this would be the first config table. All thresholds today are module constants.
- **POINTS offer mode**: `ItemListingPreference.mode` is GIFT|SWAP (`groups/models.py:366-369`). `_OFFERABLE_RESERVATION_TYPES` (`groups/schemas.py:30`), `ExchangeMode` (:431), `ReservationType`/`MovementType` (inventory) and the FE `ListingMode`/`ExchangeMode`/`LISTABLE_RESERVATION_TYPES`/`EXCHANGE_MODE_LABELS`/`OrganizationItemStats` are all closed to two values.
- **Hold/settle/release**: no hold concept exists anywhere.
- **Attendance confirmation**: `TermAttendance` (`groups/models.py:310-336`) has only `withdrawn_at` and no `attended`/`confirmed_at`. There is no write endpoint and no UI control. The list page exists but is read-only.
- **Owner points view**: no endpoint, no hook and no profile block.
- **Admin config page**: no route, nav entry or manifest entry.

### Incomplete Features
- **Confirm path**: it moves items and the ledger but posts no reward. Hook: `term_item_listings.py:1141-1175`, before `inventory_bridge.fulfill_exchange` (commit in `reservation_transitions.py:227`).
- **RSVP and sign-up**: these create rows but have no first-time side effect. Hooks: `public_view.py:446-452` and `events/service.py:398-408`.
- **Item create/update**: these do not compute a value (`inventory_items.py:43-97, 260-283`).
- **Item actions (`/actions`)**: they carry no viewer balance or price (`groups/schemas.py:790`, `item_actions.py:54`).

### Behavioral Changes Needed
- Take on a POINTS item: from "create a PENDING reservation" to "lock the point account, check available ≥ price, post a HOLD, then create the reservation" in one commit.
- Cancel or reject of a POINTS reservation: also post a RELEASE.
- Confirm: also post the awards and, for POINTS, the SETTLE.
- Listing a POINTS item: check the cap (5) under the account lock.
- Changing the mode away from POINTS, or deleting the listing, while a POINTS reservation is open: block it (409) or release the hold.

## User Journey Impact Assessment

| Dimension | Current | After | Assessment |
|-----------|---------|-------|------------|
| Reachability (balance) | none | own profile `/<party-id>` (block gated on `is_me`) | ✅ if the block is placed high on the profile |
| Reachability (spend) | none | item page → „Biorę” on a POINTS item → reservation window with price and balance | ✅ (follow-up phase if split) |
| Reachability (attendance) | organizer opens `/terms/:id/attendees` from TermCards/OwnerMeetingsList | same page plus a checkbox per attendee | ✅ |
| Reachability (admin config) | none | `/admin/points` (new Sidebar/MobileDrawer entry) | ✅ |
| Discoverability (earning) | 0/10 | 5/10: a user sees points only on the profile. The spec forbids showing them in lists | ⚠️ Without a toast or notification after a reward, users do not learn they earned points |
| Discoverability (POINTS mode) | n/a | 7/10 if it is a third mode button next to „Oddam”/„Wymienię” in `ItemCreateView` | ✅ |
| Flow integration | — | No extra steps in GIFT/SWAP. POINTS reuses take/confirm | ✅ |
| Multi-persona | — | Regular user: profile and window. Organizer: ticks. Admin: config and size_class. Organization party: no points (decision) | ⚠️ |

## Data Lifecycle Analysis

### Entity: Point balance / ledger entries (per party)

| Operation | Backend | UI | Access | Status |
|-----------|---------|-----|--------|--------|
| CREATE (earn) | missing: hooks at confirm/RSVP/attendance | n/a (system) | trigger flows exist | ❌ new |
| CREATE (spend: hold/settle/release) | missing | missing: POINTS window | item page exists | ❌ new |
| READ (balance, reputation, history) | missing `GET /api/points/me` | missing profile block | profile route exists (`PartyProfilePage.tsx`, `is_me` in `ProfileHero.tsx:29`) | ❌ new |
| UPDATE/DELETE | forbidden (append-only) | — | — | ✅ by design |

Completeness of the planned scope: 100% if spending ships with earning. About 50% (earn and read only, nothing to spend on) if POINTS is deferred.

### Entity: points_config (singleton)
| Op | Backend | UI | Access | Status |
|---|---|---|---|---|
| CREATE | data-migration seed | — | — | ❌ new |
| READ | missing ADMIN GET (plus an internal read in points services) | missing admin page | missing admin nav | ❌ new |
| UPDATE | missing ADMIN PUT (validated: base > 0, multipliers > 0, snap order) | missing form | missing | ❌ new |
| DELETE | n/a | — | — | ✅ |

### Entity: categories.size_class
| Op | Backend | UI | Access | Status |
|---|---|---|---|---|
| READ/UPDATE | category CRUD exists (`category/service.py`, ADMIN router :34). Field missing | `CategoryFormPage.tsx` exists. Select missing | admin categories nav exists | ⚠️ partial: add a field to an existing flow |

### Entity: item points_value / POINTS price
| Op | Backend | UI | Access | Status |
|---|---|---|---|---|
| CREATE | computed in `register_item` (missing) | shown in item form (missing) | `/add/item` exists | ❌ |
| READ | owner `/details`, `/actions` (missing fields) | item page/window (missing) | exists | ❌ |
| UPDATE (lower price) | missing | missing in `ItemEditForm`/`ExchangeModeTabs` | edit route exists | ❌ |

### Entity: attendance confirmation
| Op | Backend | UI | Access | Status |
|---|---|---|---|---|
| CREATE (tick) | missing endpoint (organizer gate `_require_active_organizer` reusable) | missing checkbox | `TermAttendeesPage` exists | ❌ |
| READ | attendee list exists. Flag missing | row exists | ✅ | ⚠️ |
| DELETE (untick) | decision | decision | — | ⚠️ |

**Orphaned operations (if POINTS is deferred):** a balance READ with no spend CREATE. Users can earn but cannot use their points.
**Missing touchpoints to consider:** a notification or toast after a reward (none in the spec). The event participant list, if attendance is wanted for events. The "Moje rzeczy" mode filter (`MyItemsModeFilter`) and the search `offer_type` filter for POINTS.

## Issues Requiring Decisions

### Critical
1. **Phasing** (scope-phasing): one task or split. Recommend splitting: earning and display first, POINTS spending second.
2. **What happens to spent points and does the POINTS giver earn** (points-spend-flow): recommend burning the spent points to a system sink and giving the giver +points_value and reputation, as for GIFT, with the anti-farming rules.
3. **Hold model** (points-hold-model): a held sub-account in the ledger, or a balance derived from open reservations. Recommend the held sub-account.

### Important
4. Attendance: terms only or events too. Recommend terms only. Window: tick from `occurs_on` to +7 days. An untick reverses the award.
5. `size_class` semantics: nullable means "inherit", roots get MEDIUM in the migration, and the panel offers „dziedzicz”.
6. Where `points_value` lives and when it is fixed: on the item, recomputed on condition or product change, frozen for POINTS at listing. Lowering is an owner override ≤ the computed value.
7. Pair limit: unordered pair, a swap counts as one rewarded transaction, and the wants bonus counts as its own rewarded transaction.
8. Wants bonus: MATCH only, paid to the giver of the leg the seeker received.
9. Family: any shared active family membership means 0.
10. Reputation storage: a REPUTATION account kind in the same ledger, never debited.
11. START_BONUS: first account sign-up after launch (term or event), PERSON accounts only. Withdrawing and signing up again changes nothing. No backfill.
12. Reservation window: POINTS shows price, available balance and the balance afterwards. GIFT/SWAP show nothing.
13. FAIR label: keep „Znośny” (FAIR = 0.75).
14. Visibility of the POINTS mode on lists and in search: show a „za punkty” badge without the price, and add POINTS to the search `offer_type` filter.
15. Reward feedback: a notification/toast after a reward, or the profile only.
16. Organization parties: no point account.

(Options in Polish are in the structured output returned to the orchestrator.)

## Recommendations
- Book every award inside the confirm transaction through `groups/infrastructure/points_acl.py` (flush-only). Points reaches users, families, wants, category and inventory only through its own ACLs. Add a boundary test that `app/points` never imports `app.groups`/`app.events`. Add `app/points` to the clock guard.
- `point_transactions` carries `type`, `source_type`, `source_id` (unique together for idempotency) and `counterparty_party_id`, so the pair limit is a counted, indexed query run under the account lock. Zero-value awards (pair limit or family) post no transaction, because there are no zero entries.
- Account kinds: per party AVAILABLE, HELD and REPUTATION, plus a singleton SYSTEM EMISSION and SINK. `TRANSACTION_RULES` covers START_BONUS, GIVE_FREE, EXCHANGE, WISHLIST_MATCH, ATTENDANCE, POINTS_HOLD, POINTS_RELEASE, POINTS_SETTLE and, if unticking is allowed, ATTENDANCE_REVERSAL. Add a completeness test like `test_movementRules_everyMovementType_hasRule`.
- Lock order: point accounts in party-id order, then items. This matches the id-ordered batch locking in `reservation_transitions.py:98-104` and avoids deadlocks. 40P01 is already mapped to 409.
- Migrations: 0103 schema (point tables, nullable `size_class` with `lock_timeout`, `inventory_items.points_value` or a listing-price column, attendance column), then 0104 data (SYSTEM accounts, config defaults, root categories MEDIUM). Guard the downgrade once entries exist, and add the runbook to `architecture.md`. If split, the POINTS mode migration comes in the second task.
- Points never reach `app/pages`, lists or search. The owner read uses `private, no-store`.

## Risk Assessment
- **Complexity Risk**: High. A new money-like BC plus a hold flow plus an enum widening across the stack.
- **Integration Risk**: High. `confirm_transaction` is the single hot path for all contexts, and take/cancel/reject change for POINTS.
- **Regression Risk**: Medium. GIFT/SWAP behaviour stays the same, but the shared code paths change. Extend the existing exchange tests with "no-points-side-effect breaks nothing" cases. Baseline failures are known (33 vitest, 2 backend).
