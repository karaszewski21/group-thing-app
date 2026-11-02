# Spec Audit: Owner items page, participants preview, context item page, event reservations

## TL;DR
- **Verdict: fail (Non-Compliant).** Every finding can be fixed by editing the spec; none needs a redesign.
- **Counts:** 1 critical, 3 high, 7 medium, 8 low.
- **What is sound:** the matrix rows and their order, the notification-kind change without a migration, the `pendingActions` behaviour, and most of the `term_id` reader inventory. All were checked against the code.
- **What blocks implementation as written:**
  - two frontend consumers of the reservation context are missed;
  - the new groups↔events and circulation↔events ACLs create real import cycles and break `models.md`;
  - the "cancel inside `delete_event`'s transaction" design has no non-committing circulation API to call;
  - terminal reservations left without a context after an event is deleted are not handled in the confirm/cancel gate.

## Key Decisions
- Per the caller's rubric, a missed `term_id`/context reader counts as **critical**. The missed frontend reader (`SwapAcceptSuccessSheet`) does not crash; it silently drops the date and calendar for event swaps. Its real functional impact is medium.
- The import cycle is rated **high**, not medium. It is a hard `ImportError` at app start, given the import order in `app/main.py:27-36`, and it breaks an explicit rule in a standard.
- Two items are treated as approved deviations, not findings: the CHECK "at most one, open rows exactly one" with `ON DELETE SET NULL`, and the new `RESERVATION_CANCELLED` kind. Both are recorded as decisions in `orchestrator-state.yml:132-134`. Only the stale analysis docs are flagged (L3).
- The downgrade refusal is rated medium (documented deviation), not high. Precedent: the 0071 downgrade deletes EVENT chats.

## Open Questions / Risks
- **Delete after the event started.** `delete_event` has no `starts_at` gate (`events/service.py:272-288`). Deleting an event after it happened would cancel hand-overs that physically took place, while confirmation is still pending. Should cancel-on-delete, or delete itself, be refused once `starts_at` has passed?
- **When the delete dialog actually appears.** Delete stays blocked while `attendee_count > 0` (`EventAuthorCard.tsx:24`). Open reservations on a deletable event therefore exist only after every attendee withdrew. Is the mockup's "3 otwarte rezerwacje" scenario expected to be this rare?
- **Anonymous view precedence.** An anonymous viewer without a context, or with a stale one: should they see Weź/Zamienię, or only Napisz (see M3)?
- **Organizer `nearest`.** Where does the block's `nearest` come from? It is not a field of `OrganizerPageResponse` (M4).

---

## Critical

### C1. Frontend consumers of the reservation context are missing from the reader inventory
**Spec reference:** Requirement 17 ("Weź … shows `TakeSuccessSheet`"), Requirement 24 and the Technical Approach `term_id` reader table (frontend row: `ItemStatusCard`, `MyItemsView`, `pendingActions`, API types).

**Evidence:**
- `src/frontend/src/pages/items/MyItemsView.tsx:182-185` passes the accept response's `term_occurs_on`/`group_name`/`group_id`/`term_id` to `SwapAcceptSuccessSheet`.
- In `src/frontend/src/pages/items/SwapAcceptSuccessSheet.tsx:22`, `hasTerm` requires a non-null `termId` and `groupId`. Line 49 builds the calendar URL with `organizerTermPath("krag", groupId, termId)`.
  - For an event swap, Requirement 24 makes `term_id`/`group_id` null in the accept response.
  - The sheet therefore silently drops the hand-over date, place and calendar export.
- `src/frontend/src/pages/term/modals/TakeSuccessSheet.tsx:17-58` requires `groupId: string`, `termId: string` and `organizerSlug`, and links with `organizerTermPath`. The spec reuses it for event takes but does not say how it is generalised. It needs an event variant: an `eventPath(authorSlug, eventId)` link and a calendar uid from the event id.

**Category:** Missing requirement (missed reader).

**Severity:** Critical under the audit rubric. Functionally it is a degraded UI, not a crash.

**Recommendation:** Add both components to the frontend row of the reader table.
- `SwapAcceptSuccessSheet`: an event branch driven by `event_id` from the accept response, plus an event link or slug.
- `TakeSuccessSheet`: generalise to a `context` prop (`{kind, id, name, starts_at, path}`). The `ItemContextActions` take result should carry that context from `useItemActions`.
- Add tests for both.

---

## High

### H1. The new ACLs create real import cycles and break `models.md`'s "imports nothing back"
**Spec reference:**
- Key Decisions (`groups/infrastructure/events_acl.py`);
- New Components (`circulation/infrastructure/events_acl.py`);
- Requirement 27 (events → `groups_acl` → `cancel_open_event_reservations`);
- Open Questions ("Cross-context import cycle … keep the imports inside the ACL functions or …").

**Evidence:**
- `.maister/docs/standards/backend/models.md:143`: "a single `app/<bc>/infrastructure/<other>_acl.py` is the only module of the consuming BC that imports the other BC, **and the other BC imports nothing back**."
- events → groups already exists:
  - `app/events/service.py:30` imports `groups_acl`;
  - `app/events/infrastructure/groups_acl.py` imports `app.groups.service`;
  - `app/groups/service.py:18-…` is a facade that imports every `groups.application` module.

  If `reservation_context.py` imports a groups `events_acl` that does `from app.events.service import …`, loading `app.events.service` first raises `ImportError` on a partially initialised module.
- events → circulation already exists: `app/events/infrastructure/circulation_acl.py` does `from app.circulation.service import available_items_with_product_select`. A circulation `events_acl` importing `app.events.service` closes the cycle.
- `app/main.py:27` imports `app.circulation.router` first, so the circulation cycle triggers at startup.
- `app/events/models.py:15-20` imports only SQLAlchemy, `app.core` and `app.moderation`, so importing it from groups or circulation is safe.

**Category:** Unimplementable as written / standards conflict.

**Severity:** High. The app fails at startup, and the binding standard is broken.

**Recommendation:** Make this a decision in the spec, not an open risk:
- groups `events_acl` and circulation read events only through `app.events.models` or Core `table()` references. This is the circulation precedent, `_terms`/`_groups` in `circulation/infrastructure/repository.py:56-67`. They never import `app.events.service`.
- Drop `circulation/infrastructure/events_acl.py` in favour of the `_events` Core table the spec already mentions.
- Author slugs come from the organizations table plus `derive_party_slug`, which lives in groups domain and is already allowed.
- If a function-local import is chosen instead, the spec must say so and record the deviation from `models.md`.

### H2. Cancel-on-delete "in the same transaction" has no circulation API to call
**Spec reference:** Requirement 27 and Technical Approach "Consistency" ("Every write path … stays a single transaction, committed once … `cancel_open_event_reservations` running inside `delete_event`'s transaction").

**Evidence:** In `app/circulation/application/reservation_transitions.py`:
- `cancel_reservation` (lines 120-128) and `cancel_exchange` (lines 183-196) both `await db.commit()`.
- Only the private `_cancel` (lines 62-73) flushes without committing, and it calls `_require_party_to_reservation`. The event author is not a party.

The groups `circulation_bridge` exposes only the committing variants (`circulation_bridge.py:106-108`, `:136-140`). Reusing them would:
- commit in the middle of `delete_event`;
- release the `FOR UPDATE` lock that `_get_own_event_for_update` holds (`events/service.py:220-230`);
- leave cancelled reservations behind a later failure.

The "committed once" claim is also untrue today. `create_reservation` commits (`circulation/application/reservations.py:62`) and `confirm_reservation` commits (`reservation_transitions.py:110-117`), both inside take and propose.

**Category:** Incorrect assumption about existing code.

**Severity:** High.

**Recommendation:** Specify a new circulation use case that cancels a set of reservations on behalf of each item's holder with flush only, no commit. An example: `cancel_reservations_without_commit(db, ids)`, exported via `circulation.service` and `circulation_bridge`. Correct the Consistency paragraph to describe the real commit points.

### H3. Context-less terminal reservations (after `SET NULL`) break the confirm/cancel gate
**Spec reference:** Key Decision on `ON DELETE SET NULL`, Requirement 20 ("a loader from an existing reservation"), and the reader table row for `_resolve_transaction_reservations_for_action`.

**Evidence:**
- `app/groups/application/term_item_listings.py:872-874` resolves the Term (`get_term_any(db, reservation.term_id)`) before the already-resolved status check at lines 875-884.
- After an event is deleted, its CANCELLED reservations have `term_id IS NULL AND event_id IS NULL`.
- Picture a party who clicks a still-unread `TERM_CONFIRMATION_NEEDED` prompt (`PendingActionsHost.tsx:89-110` confirms directly via `reservation_id`).
  - The context loader finds no context, giving a 404 (or a 500 from `get_term_any(None)`).
  - The expected result is `TermAlreadyResolvedException` (409 with `already_resolved`).

**Category:** Missing requirement (edge case of a listed reader).

**Severity:** High.

**Recommendation:**
- Define the loader's result for a reservation without a context.
- Move the status or terminal check ahead of the context gate for that case, so it returns the already-resolved 409.
- Add a test: delete an event after the prompt, then confirm, and expect the 409 `already_resolved`.
- Also state that history rows of event reservations lose their date after delete (the coalesce returns NULL). That loss is acceptable, but it should be written down.

---

## Medium

### M1. The event swap scan does not say where `owner_party_id` comes from, and must ignore eligibility
**Spec reference:** Requirement 25.

**Evidence:**
- The term scan derives swap candidates from the listing preferences of parties eligible now (`term_end_scan.py:221-233`).
- It takes `owner_party_id` from `preferences_by_item` (line 186).
- For events, "withdrawing never cancels" (Requirement 22). Mirroring the term pattern would therefore skip swaps of withdrawn attendees, or of owners who cleared their preference. Their reservations would stay locked with no prompt.

**Recommendation:** State that the event pass is reservation-driven:
- proposals joined on `proposer_reservation_id IN (reservation ids WHERE event_id = …)`;
- `owner_party_id` resolved from the owner leg's `giver_user_id` → profile;
- no use of eligibility or preferences.

### M2. Race between event take and delete
**Evidence:**
- `delete_event` locks the event `FOR UPDATE` (`events/service.py:224`).
- A concurrent event take inserts a reservation whose FK needs `KEY SHARE` on the event. The insert blocks, then fails the FK after the delete, giving an IntegrityError and a 500.
- `sign_up` already handles this with `FOR SHARE` (`events/service.py:409-411`).

**Recommendation:** take, propose and accept on events load the event `FOR SHARE`, and map a missing event to 404.

### M3. Precedence between view-state kinds is undefined
**Spec reference:** Requirements 16 and 17. The kinds are `own`, `unavailable`, `noContext`, `stale`, `anonymous`, `notSignedUp`, `eligible`.

**Evidence:**
- Requirement 17 says anonymous viewers see Weź/Zamienię/Napisz.
- It does not cover an anonymous viewer with `context=null` (mockup `item-page-no-context-napisz-only`: Napisz only), with a stale context, or on an unavailable item.
- `components.md:31-36` asks for one discriminated resolver tested per state.

**Recommendation:** Add an ordered precedence table:
1. `loading`
2. `hidden`
3. `own`
4. `unavailable`
5. `noContext`
6. `stale`
7. `anonymous`
8. `notSignedUp`
9. `eligible`

Say whether `anonymous` applies only with a live context. Mirror the table in the `it.each` rows. Also say what happens when the actions query fails but the details query succeeds: hidden, or an inline error.

### M4. Source of the organizer block's `nearest` is unspecified
**Evidence:**
- Requirement 29 adds only `recent_items` to `OrganizerPageResponse`, yet the cards use the owner context "via `nearest`, which is computed only when `recent_items` is non-empty".
- `test_organizer_page.py` asserts exact key sets.
- `_empty_page()` (`organizer_page.py:67-74`) is synchronous and has no `db`, so computing `recent_items` there needs a refactor.

**Recommendation:**
- Declare the field (for example `recent_items_nearest` or `owner_nearest`) and its shape.
- Update the key-set list.
- Note the `_empty_page` refactor.

### M5. Write-side signatures are not listed
**Evidence:**
- `circulation/models.py:277-282`: `term_id: Mapped[uuid.UUID]`, `nullable=False`.
- `circulation/schemas.py:134-140`: `CreateReservationRequest.term_id: uuid.UUID`, required.
- `groups/infrastructure/circulation_bridge.py:73-91`: `create_reservation(..., term_id: uuid.UUID)`.
- `ReservationResponse.term_id: uuid.UUID` (`schemas.py:118`) is covered by the spec; the three above are not.

**Recommendation:** List them in Requirement 19/20:
- model `term_id: uuid.UUID | None` plus `event_id`;
- `CreateReservationRequest` with optional `term_id`/`event_id`;
- bridge kwargs.

Optionally declare the CHECK in `__table_args__`, so that autogenerate does not report drift.

### M6. Migration 0073's refusing downgrade deviates from `migrations.md`'s "Reversible"
**Evidence:** `.maister/docs/standards/backend/migrations.md` ("Every migration must implement a working `downgrade()`"; "Verify `alembic downgrade base` actually leaves a clean database").

**Assessment:** The justification is sound. `circulation_entries.reservation_id` references these rows, and `term_id` cannot be restored to NOT NULL.

The rest of 0073 conforms to the standard:
- names (`fk_reservations_event_id_events`, `ix_reservations_event_id`, `ck_reservations_context`);
- reverse-order downgrade;
- a dedicated migration test;
- no data change.

Mechanics were also checked:
- `SET NULL` combined with the open-rows CHECK makes an un-cancelled delete fail safely.
- Status values are stored as `'PENDING'`/`'CONFIRMED'` (`circulation/models.py:118-122`).

**Recommendation:**
- Document the refusal as a runbook item in `architecture.md`, as was done for 0071/0072.
- Make the downgrade error message say how to recover: cancel and purge event reservations manually, or restore a backup.
- Optionally add a line to `migrations.md` permitting a guarded downgrade when ledger rows make it lossy.

### M7. Event delete dialog and `open_reservations` are tied to a zero-attendee state
**Evidence:**
- `EventAuthorCard.tsx:24`: `deleteBlocked = event.attendee_count > 0`.
- `delete_event` returns 409 while attendees exist (`events/service.py:275-276`).

**Recommendation:**
- State explicitly that cancel-on-delete only matters after attendees withdrew.
- Make `EventDetailResponse.open_reservations` count only what will be cancelled: PENDING/CONFIRMED event reservations plus PROPOSED proposals.
- Pair this with the Open Question on deleting after `starts_at`.

---

## Low

- **L1. `added_at` is naive UTC.** It comes from `ItemListingPreference.created_at`, which `BaseEntity` sets with `datetime.utcnow()`. The relative "dodano …" must parse it as UTC (`dayjs.utc(...)`) or it skews by 1-2 h. `utils/dayjs.ts` has `utc` but no `relativeTime` yet; the spec already says to add it.
- **L2. Wrong path.** The spec cites `hooks/useAccountGate.ts`; the real file is `src/frontend/src/pages/term/hooks/useAccountGate.ts`.
- **L3. Stale analysis docs.**
  - `analysis/requirements.md:106` says the CHECK is "exactly one", and lines 25 and 123 say existing kinds are reused with no new notification kinds.
  - `analysis/scope-clarifications.md` says the same.
  - The spec and `orchestrator-state.yml:132-134` record the newer decisions. Update the analysis docs so the planner does not pick up the old ones.
- **L4. Undocumented term-scoped reader.** `list_my_active_taken_term_item_listings` reads `reservation.term_id` (`term_item_listings.py:413`). It is safe because event rows are skipped, but it is missing from the inventory. Add it as "unchanged by design".
- **L5. Event timing wording.**
  - The stale copy "… już się odbyła" also shows for an event that has started but not ended.
  - The end-of-event prompt fires at `starts_at + 2h`, even for events with a much later `ends_at`.
  - Moving `starts_at` later after a prompt was sent makes that prompt's confirm return 409.

  Consider "już się rozpoczęło" for events, and say how editing `starts_at` interacts with prompts already sent.
- **L6. ACCEPTED → REJECTED on delete.** Event delete sets ACCEPTED proposals to REJECTED. Term `cancel_transaction` (`term_item_listings.py:937-951`) leaves ACCEPTED as it is. Acceptable, but say this is intentional.
- **L7. Unclear slug in the nearest-term path.** `path` for a term is written as `/{slug}/group/{group_id}/term/{id}`. Specify `resolve_organizer_slug(group_id)` (`groups/infrastructure/slug_resolver.py:18`), because the owner may only attend the circle, so its slug may not be the owner's.
- **L8. Small contract additions.**
  - `/api/items/{id}/actions` adds a new `/api/items` prefix next to `/api/inventory-items` (a user decision). This is fine, but `api.md` consistency should be noted.
  - Adding `event_id` to the term accept and reservation responses slightly contradicts "term contracts byte-identical" (`requirements.md`, Technical considerations). It is additive, and existing term tests do not assert those key sets (`test_handover_copy_api.py:184-191` checks values only).

---

## Verified as correct (no finding)

- **Authorization matrix** (`app/core/authorization_matrix.py`):
  - Extending row 88 to `(/terms|/items)?` is correct.
  - The party-items PUBLIC row must precede row 129 (`/api/groups(/.*)?` READ). Row 93 (`^/api/groups/public/[^/]+$`) does not match the longer path.
  - The `/details` PUBLIC row must precede row 174 (GET `/api/inventory-items(/.*)?`). Row 173 is PATCH/DELETE only.
  - `/api/items/…/actions` has no competing row before the catch-all.
  - The new events EDIT row does not collide with row 207 (`/attendances`).
- **Notification kind.** `notifications.kind` is `sa.String(30)` with no CHECK (`alembic/versions/0022_notifications_schema.py:55`). The enum is `native_enum=False` (`notifications/models.py:27-34`). `RESERVATION_CANCELLED` (21 characters) needs no migration. `create_notification` only stages, with no commit (`notifications/service.py:41`).
- **`pendingActions`.** `TERM_LINK_PATH_RE` (`pendingActions.ts:43`) already returns `termId = null` for `/…/event/{id}` links. With `reservation_id` set, `PendingActionsHost.tsx:89-99` confirms directly.
- **Backend reader inventory.** It covers:
  - `item_details.py:76`;
  - `item_privacy.py:153`;
  - the history join at `repository.py:405`;
  - `find_reservation_term` at `repository.py:429`;
  - `router.py:234`;
  - `list_active_hand_over_reservations_for_terms` and `reservation_ids_for_term_select` (`repository.py:301-323`);
  - accept (`term_item_listings.py:711-719`);
  - the confirm/cancel gate (`:872`);
  - `term_end_scan.py:133-135`.

  No other module (messaging, users, system, families) reads `Reservation.term_id`. The remaining frontend reader gaps are covered in C1.
- **Referenced symbols all exist:**
  - `_resolve_owner`, `_empty_page`, `list_organizer_terms`, `CACHE_CONTROL`, `_qualifying_owner_circles`, `item_listing_preferences_select`, `list_owner_public_terms_page`, `count_active_attendances_by_term`;
  - `_listing_thumb_urls`, `first_approved_photo_by_product`, `open_item_conversation`, `_generate_unique_slug`, `_require_term_eligibility`, `GiveawayTermEndMarker`, `TERM_END_GRACE`;
  - `RESERVED_SLUGS` containing `items`, `derive_party_slug`, `OptionalPrincipal`;
  - frontend: `eventPath`, `organizerTermPath`, `DateTile`, `ExchangeItemCard`, `termLabels` constants, `SafeImage`, `PhotoPlaceholder`, the `exchange-board`/`needed-items` registry entries, and `AuthGateSheet`'s `returnTo` keeping `location.search`.
- **Listed tests all exist:**
  - backend: `test_event_page.py` (`DETAIL_KEYS`/`PARTICIPANT_KEYS`/`ITEM_KEYS`, `test_getEvent_oneVsFiveParticipantsWithItems_queryCountConstant`), `test_item_details.py`, `test_term_end_scan.py`, `test_notifications.py`, `test_organizer_page.py`, `test_domain_clock_guard.py`;
  - frontend: `OrganizerItemRoute.test.tsx`, `ItemDetailPage.test.tsx`, `EventPage.test.tsx`, `TermPage.test.tsx`, `NotificationBell.test.tsx`.
- **Listed items are ACTIVE by construction.** `listing_status` is written in lockstep with `item_listing_preferences`, so a listed item is always ACTIVE. Event-page and items-page links never point anonymous viewers at a non-ACTIVE item.
- **Frontend view-state pattern.** The spec complies with `components.md` (`resolveItemActionsView` in `itemActionsViewState.ts`, `it.each` including stale and refresh-error rows, `switch` on `view.kind`). The only gap is the precedence ambiguity in M3. The dayjs and clock rules are referenced correctly.

## Recommendations (ordered)
1. **C1:** add `SwapAcceptSuccessSheet` and `TakeSuccessSheet` event branches to the reader table, with tests.
2. **H1:** decide the ACL import direction. groups and circulation read events via `app.events.models` or Core tables only; drop `circulation/infrastructure/events_acl.py`.
3. **H2:** specify a non-committing circulation bulk-cancel use case and the bridge export; correct the Consistency paragraph.
4. **H3:** define the context-less reservation behaviour in the `ReservationContext` loader (already-resolved 409), with a test.
5. **M1–M7:** reservation-driven event swap scan; `FOR SHARE` lock on event takes; a view precedence table; the organizer `nearest` field; write-side signatures; a downgrade runbook note; delete-dialog semantics.
6. **L1–L8:** small clarifications and doc sync.
