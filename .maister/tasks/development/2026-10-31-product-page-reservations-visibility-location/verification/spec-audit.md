# Spec Audit: Product-page reservations, physical location, reserved items on lists, item visibility

Mode: pre-implementation. Baseline: the current working tree on `feat/events-plugin` (0073 untracked). Audited `implementation/spec.md` against `analysis/requirements.md`, `clarifications.md`, `scope-clarifications.md`, `technical-clarifications.md`, `design-context/INDEX.md` + the 10 mockups, the project standards, and the code.

## TL;DR
- **Verdict: FAIL (Non-Compliant).** The spec is detailed and most of its claims about the code check out. One flow is broken end to end, though: the recipient of a personal-pickup GIFT has no way to confirm it.
- **Counts:** 1 critical, 3 high, 7 medium, 10 low.
- **Critical:** personal-pickup reservations are never scanned, so nothing ever prompts anyone to confirm them. The frontend's only confirm entry points are `PendingActionsHost`, which needs scan notifications, and Moje rzeczy, which lists only the owner's own items and gates confirm/cancel on the term date. So a personal GIFT can never be fulfilled.
- **High:**
  - Personalised public responses would be served from a shared cache (`s-maxage=60`).
  - The term page reads `/access`, not `/api/groups/public/{id}`, so the reserver-name and reserved-state change lands on the wrong route. The public term-listing path is also left unspecified.
  - `GET /api/inventory-items/{id}`, `?inventory_id=` and `/balance` leak PRIVATE items, against the "every read path" requirement.

## Key Decisions
- **C1 is critical, not high.** A core S1 success criterion ("Personal reservations can be confirmed … immediately") cannot be met for GIFTs from any UI. The item stays reserved until the giver cancels.
- **The cache finding is high.** `Cache-Control: public, max-age=0, s-maxage=60` is set today on exactly the routes R8.2 personalises. That contradicts the binding rule "anonymous viewers see only 'zarezerwowana'".
- **Non-gated item reads are high, not critical.** C3 only names `/details` and `/actions`. `requirements.md` R13, however, says "in every read path".
- **Accepted as designed, not findings:**
  - uppercase `ReservationContextRef.kind`, which differs from the lowercase wording in the technical clarifications and is documented;
  - discriminating personal vs. deleted-event reservations by status. Verified: `event_reservations.py` cancels open reservations before any event delete, and `app/events/service.py:302` is the only delete path.
- **Verified correct:**
  - authorization-matrix rows 38/39/42/58/61, and row 61 being shadowed by row 58;
  - the term-end scanner never seeing personal reservations (`term_end_scan.py:322-330` reads candidates by term/event ids);
  - `pendingActions.resolvePendingReservationId` skipping unpaired SWAP legs (`pendingActions.ts:124`);
  - `ItemContextResponse.kind` being uppercase;
  - no item OG preview existing.

## Open Questions / Risks
- **Where does a personal-pickup GIFT recipient confirm, or cancel, their reservation?** The product page, a "Rezerwacje" section, or a notification prompt?
- **Is a shared HTTP cache (CDN/nginx) actually in front of `/api/groups/public/*`?** If so, personalised responses need `Vary`/`private`.
- **Should `GET /api/inventory-items/{id}`, `GET /api/inventory-items?inventory_id=` and `/balance` honour PRIVATE?** The "every read path" wording says yes. Memory says item reads by any logged-in user are intentional for PUBLIC/DRAFT items.
- **On a tile, what does the offered item of a pending swap show as "przez …"?** The mechanism (`reserved_by_user_id`) yields the listing owner. R8.1's wording says "the proposer for SWAP legs".
- **Blast radius of removing the routes and use cases:** 17 backend test files call the removed routes or use cases. The spec lists about 5.

---

## Critical

### C1. A personal-pickup GIFT can never be confirmed by its recipient. Moje rzeczy confirm/cancel stays hidden for personal reservations.
**Spec reference:**
- R4.5: "Confirm and cancel of a personal reservation work immediately … A GIFT is still confirmed by its recipient only. No reminders are sent."
- R5.7 copy: "Gdy przekazanie się odbędzie, potwierdźcie je w „Moje rzeczy”."
- Success criterion: "Personal reservations can be confirmed or cancelled immediately".

**Evidence:**
- Confirm is recipient-only for GIFT: `src/backend/app/groups/application/term_item_listings.py:983-986` (`_require_recipient_to_confirm_gift`).
- The frontend's only `confirmTransaction` callers are `src/frontend/src/components/pending/PendingActionsHost.tsx:106` and `src/frontend/src/pages/items/MyItemsView.tsx:218`.
  - `PendingActionsHost` acts only on `TERM_CONFIRMATION_NEEDED` notifications (`pendingActions.ts:62`). Those come from the term-end scan, which by design (R4.5) never sees personal reservations.
  - `MyItemsView` lists only items in the caller's own PERSONAL inventory (`list_my_inventory_items`, `term_item_listings.py:208-257`). The GIFT recipient does not own the item, so it never appears in their Moje rzeczy.
- `MyItemsView` gates **both** confirm and cancel on `termHasEnded` (`MyItemsView.tsx:369-374`). `hasEnded = term_occurs_on != null && …` (`:129`). For a personal reservation `term_occurs_on` is null (`circulation/application/reservations.py:96-104`), so even the owner never sees "Anuluj".
  - R4.8 adds `ReservationDetailResponse.personal_pickup`.
  - "MyItemsView tests: … immediate confirm/cancel for `personal_pickup`" appears only in the test list. No R-item tells the implementer to change the gating.
- The product page `reserved` view (R8.5) disables actions and offers only the chat. It has no confirm/cancel for parties.

**Category:** missing requirement / unimplementable as written (the success criterion cannot be met).

**Severity:** Critical. Every personal GIFT stays RESERVED forever unless the giver cancels, and even the giver's cancel button is hidden by the current gating. This is a core S1 flow.

**Recommendation:**
- Add an explicit requirement, with a mockup or at least copy, for a party-side confirm/cancel UI on personal reservations. The most natural place is the product page `reserved` view for parties (`by_me`, or the owner), calling `confirmTransaction`/`cancelTransaction`.
- Add an explicit R-item: MyItemsView treats `personal_pickup` as "ended", so confirm/cancel show immediately.
- Fix the R5.7 copy so it does not send the taker to Moje rzeczy.

---

## High

### H1. Personalised public responses carry `Cache-Control: public, s-maxage=60`
**Spec reference:** R8.2 adds `OptionalPrincipal` to `/api/groups/public/organizers/{slug}`, `/organizers/{slug}/items` and `/parties/{id}/items`. R8.1/I8 give `by_name` only to logged-in viewers, and `by_me` per viewer.

**Evidence:** `src/backend/app/groups/router/organizer_page.py:36` `CACHE_CONTROL = "public, max-age=0, s-maxage=60"`, applied at `:48, :68, :85, :102`.

**Gap:** a shared cache would serve a logged-in viewer's response, with reserver names and `by_me`, to anonymous visitors and to other users for up to 60 s. That breaks "anonymous never see names". The spec says nothing about caching.

**Severity:** High. It is a privacy leak on the most public pages.

**Recommendation:** when a principal is present, send `Cache-Control: private, no-store`, or keep `public` only for anonymous requests and add `Vary: Authorization`. Add a test asserting the header for both kinds of request.

### H2. The term page reads `/access`, and the spec changes the wrong route. The public term-listing path is unspecified.
**Spec reference:**
- R8.2: "`/api/groups/public/{group_id}` gain[s] `principal: OptionalPrincipal`".
- R7.3: "public_view term listings" switch to the new select.
- R13.1: PRIVATE-circle term listings pass `include_private=True`.

**Evidence:**
- The frontend term page uses `getGroupAccess` → `GET /api/groups/public/{id}/access`: `src/frontend/src/hooks/useTermAccess.ts:49` and `src/frontend/src/api/groups.ts:280`. `getPublicCircle` has no component consumer.
- `/access` already takes `OptionalPrincipal` (`src/backend/app/groups/router/circles.py:156-171`). It calls `get_public_circle_view` (`public_view.py:379`), which has no viewer parameter.
- Term listings are built by `list_public_term_item_listings` (`term_item_listings.py:463-485`). That function:
  - filters AVAILABLE with a per-item `_is_item_available`;
  - runs `_build_listing_views` → `_resolve_listing_status` per row, plus a profile lookup per row (`:362`, `:303`).
- Thumbnails use `circulation_bridge.list_available_items_with_product` (`public_view.py:192`), which would drop the thumbnails of reserved items.

**Gap:**
- Following R8.2 literally leaves the term page without reserver names.
- The spec does not say whether `list_public_term_item_listings` is rewritten onto `listed_items_with_product_select`, or how visibility and the viewer reach it.
- The "at most one name lookup per list response" claim is false for this path as it stands.

**Severity:** High. The primary tile surface (term page) would not meet R8/I8, and could keep hiding reserved items.

**Recommendation:**
- Name `/access` (and `get_group_access`) as the route to change.
- Specify that `get_public_circle_view` takes `viewer_party_id` and `include_private`.
- Specify that public term listings are rebuilt as one batched select (listed items + reserved state + reserver + names), and that thumbnails come from the same rows.
- Add a statement-count test for the term page.

### H3. PRIVATE items still leak through the ungated item reads
**Spec reference:**
- `requirements.md` R13: "Enforce visibility … in every read path".
- C3: "Everyone else gets 404".
- Spec R13.4 lists only `/details`, `/history`, `/actions`, take/propose and ITEM chat creation.

**Evidence:** `src/backend/app/circulation/router.py` serves all of the following to any READ principal:
- `GET /api/inventory-items/{item_id}` (`:158-161`), which returns product name, inventory id and condition;
- `GET /api/inventory-items?inventory_id=` (`:150-155`), which has **no ownership check**, so any logged-in user can list anyone's items, PRIVATE ones included;
- `GET /api/inventory-items/{id}/balance` (`:201-218`), which exposes reserved state and `reservation_id`;
- `GET /api/inventories?owner_user_id=` (`:112-117`), which makes the inventory ids enumerable.

**Severity:** High. The "PRIVATE → 404" promise is bypassable with one documented route.

**Recommendation:**
- Either extend `can_view_item` to `GET /api/inventory-items/{id}`, `/balance` and the list route (filtering PRIVATE items for non-viewers), or have the user explicitly narrow R13 to the named paths and record that as an accepted risk.
- Add these paths to `tests/test_item_visibility.py`.

---

## Medium

### M1. Gate order returns 403 before 404 for PRIVATE items
**Spec reference:**
- R3.5: 404 for "an item the caller cannot view".
- Technical Approach: gate order 2 (taker eligible → 403) runs before 6 (visible → 404).
- `standards/backend/models.md`: 404-before-403.

**Evidence:**
- `_take`/`_propose` call `context.require_eligibility` first (`term_item_listings.py:498-508`, `:648-656`).
- For PERSONAL + PRIVATE, `PersonalContext.require_eligibility` fails for a non-member (R4.1). The caller gets 403, which reveals that the item exists.

**Recommendation:** run `require_item_visible` immediately after loading the preference, before any eligibility check. Pin the order with a test (PRIVATE item, non-member, PERSONAL → 404).

### M2. How `PersonalContext` is built from a reservation is unspecified
**Spec reference:**
- R4.1: `PersonalContext` holds `owner_party_id`, `owner_display_name` and `item_visibility`.
- R4.2: `load_for_reservation` returns a `PersonalContext` for open no-context rows.

**Evidence:**
- `load_for_reservation(db, reservation, *, for_write)` (`reservation_context.py:183-197`) has only the reservation.
- At accept, it is called on the **proposer's** leg (`term_item_listings.py:772-775`). That leg's item and giver are the proposer's, not the listing owner's.
- Confirm/cancel call it on any leg (`:954`).

**Gap:** the spec does not say:
- which party is "owner" for a reservation-derived context;
- whether the fields are looked up (more queries per call) or left unset;
- that `display_name`/`starts_at` are no longer used by the accept notification (`:812`, replaced by `pickup_phrase()`).

**Recommendation:**
- Either make the reservation-derived `PersonalContext` field-free (eligibility only matters at create time) or specify the lookup.
- State which methods each lifecycle step calls on it.
- Also list the context methods `_take` and accept currently use (`starts_at`, `display_name`, `link_path`), so `PersonalContext`'s protocol is complete.

### M3. The 0074 downgrade recovery path does not work for pending personal swaps
**Spec reference:** R4.4: recovery = "cancel those personal reservations (`cancel-transaction`) or restore a pre-0074 dump".

**Evidence:**
- A personal `_propose` creates a CONFIRMED, unpaired, no-context SWAP leg (`term_item_listings.py:686-702`). The downgrade counts it.
- `cancel_transaction` rejects unpaired SWAP legs with "Zamiana nie została zaakceptowana" (`:947-951`). Only `reject_swap_proposal` releases them.

**Recommendation:**
- The runbook should say: reject pending personal proposals (`POST /api/swap-proposals/{id}/reject`), and cancel the accepted or GIFT ones.
- Note that after downgrading, terminal personal rows read as "deleted-event" reservations under 0073.
- Add the PENDING-proposal row to the refusal test.

### M4. Contexts list: `LIMIT 5` before viewer filtering, and the statement-count claim is incomplete
**Spec reference:**
- Phase 5: "max 5 contexts the viewer may see".
- R2.3/R2.5: one terms query "that also covers PRIVATE circles, capped at 5". "Statement count is bounded and independent of how many contexts".

**Evidence:**
- `nearest_public_term_for_party` is PUBLIC-only, with `LIMIT 1` (`groups/infrastructure/repository.py:1102-1144`). If the variant applies `LIMIT 5` before checking whether the viewer is eligible in each PRIVATE circle, the viewer gets fewer than 5 visible contexts, possibly none.
- Each context's `path` needs `resolve_organizer_slug` (about 3 queries per term: `slug_resolver.py:18-33`) or `events_acl.author_slugs` (one per author: `events_acl.py:147-158`). R2.5's list omits these, so the count grows with the number of contexts, up to 5.
- The "batched viewer-eligibility lookup per kind" functions do not exist. `is_event_eligible` and `_require_term_eligibility` are per-context. They are also missing from "New Components Required".

**Recommendation:**
- Put the viewer-visibility predicate inside the SQL before `LIMIT`.
- Batch the slugs (circle → organizer slug in one query).
- List the new batched eligibility helpers.
- Make the statement-count test compare 1 context against 5.

### M5. Owner items page: counts and list disagree, and `count_owner_items` is coupled to `_counts`
**Spec reference:** R10.4: `OwnerItemCountsResponse` stays GIFT/SWAP available-only, while `items_total`/`count_owner_items` count every listed live item. R7.3: the owner list includes reserved items.

**Evidence:**
- `count_owner_items` returns `counts.GIFT + counts.SWAP` from `_counts` (`owner_items.py:64-73`).
- The tabs show the per-mode counts. The mode-filtered list (`list_owner_listed_items_page`) would include reserved items, so "Chcę oddać (3)" can show 4 tiles.

**Recommendation:**
- Spell out that `count_owner_items` becomes its own count.
- Decide whether the tab counts include reserved items (consistent with the list) or the list's mode filter excludes them. Record the decision.

### M6. A visibility-only PUT would delete the listing
**Spec reference:** R12.3: `visibility` is optional, "ignored when `mode` is null, because the row is deleted".

**Evidence:** `SetItemListingPreferenceRequest.mode` defaults to `None` (`groups/schemas.py:608-611`). `set_item_listing_preference` deletes the preference and drafts the item when `mode is None` (`term_item_listings.py:179-186`). A toggle that sends `{visibility: "PRIVATE"}` alone would wipe the listing.

**Recommendation:** require the toggle to send the current `mode` together with `visibility`, through `AppDataContext.setItemListingPreference`. Add a frontend test asserting the payload, and a backend test that `{mode, visibility}` keeps the row.

### M7. The test-migration list understates the blast radius
**Spec reference:** "Tests to migrate or flip (backend)" names `test_term_item_listings_router.py`, `test_event_item_reservations.py`, `test_term_item_listings.py` and a few others.

**Evidence:**
- Removed routes or use cases (`take_item_listing`/`propose_swap`/`take_event_item`/`propose_event_swap`/`TakeTermItemListingRequest`, or the old URLs) are referenced in 17 test files: `test_authorization_matrix`, `test_domain_clock_guard`, `test_event_item_reservations`, `test_event_reservation_delete`, `test_event_reservation_readers`, `test_exchange_summary`, `test_group_soft_delete_keep_live`, `test_handover_copy_api`, `test_item_details`, `test_item_history`, `test_item_listing_status`, `test_public_term`, `test_reservation_write_guards`, `test_term_clock_regressions`, `test_term_end_scan` (22 hits), `test_term_item_listings` (79 hits) and `test_term_item_listings_router`.
- Tests that pin "exactly one context" must flip their `noContext` case:
  - `tests/test_circulation_bulk_cancel.py:150-169` (`match="exactly one"`);
  - `tests/test_event_reservations_migration.py:190-203` (`test_insertOpenReservation_invalidContext_violatesContextCheck[noContext]`).
- `tests/test_event_reservations_migration.py` downgrades to 0072, which now runs through 0076 → 0074.

**Recommendation:** list these files in the spec, so the planner sizes the work and does not "fix" failures by loosening assertions.

---

## Low

### L1. Who appears as the reserver of a SWAP's offered item
- R8.1 says `by_name` is "the proposer for SWAP legs". R7.1 takes `reserved_by_user_id` from the newest active reservation.
- On the offered item's leg that field is the **listing owner** (`term_item_listings.py:685-693`).
- `derive_status`'s PROPOSED_SWAP branch (`item_privacy.py:155-159`) would then show the listing owner's name, on the offered item, to every logged-in viewer.
- **Recommendation:** state the intended label explicitly.

### L2. Copy inconsistencies against the mockups
- R5.8 has "Zarezerwowana — odbiór osobisty". R8.5 and the mockup `strona-produktu-zarezerwowana.html` have the title "Zarezerwowana" plus "Odbiór osobisty — szczegóły ustalają Kasia i Anna na czacie."
- The owner mockup's line "To Twoja rzecz. Inni mogą ją zarezerwować osobiście albo na Twoich terminach." is missing from R5.
- **Recommendation:** pick one wording per state.

### L3. Missing disabled-reason and hint copy
- R5.5 wants a "no location" hint, but `personal_pickup_available` is a bare boolean. The client cannot tell "no location" from "PRIVATE, no shared circle" or "own item".
- No hint copy is given for "Odbiorę osobiście" or for a disabled "Wybieram termin".
- **Recommendation:** add a reason enum, or `owner_has_location: bool`, plus the copy.

### L4. The `include_private` caller list differs between sections
- The Key Decisions caller list for `include_private=True` omits `exchange_summary`; R13.1 includes it.
- `exchange_summary._is_item_available` (R7.3) ignores the new PROPOSED block, so it still reports blocked items as takeable.

### L5. Circulation would import `app.users.service` directly
- R1.3 resolves the caller's party via `app.users.service.get_profile_by_principal`.
- Today circulation never imports `app.users.service`. It resolves users via `identity.py` and Core `user_profiles` refs (`circulation/infrastructure/repository.py:65`).
- **Recommendation:** add the lookup to the new circulation ACL, or reuse a Core lookup, rather than a direct cross-context import (`models.md` ACL rule).

### L6. Frontend handling of nullable accept-response fields
- R4.7 makes `AcceptedSwapProposalResponse.term_occurs_on`/`group_name` nullable.
- `MyItemsView.tsx:182-185` and the accepted-swap success UI consume them. They are not in the frontend change list.

### L7. Losing the database safety net
- With 0074, an event deleted outside `cancel_open_event_reservations` silently turns open event reservations into "personal" ones (`ON DELETE SET NULL`). Under 0073 the CHECK rejected that.
- **Recommendation:** consider an explicit discriminator, such as a `personal` boolean, in the CHECK.

### L8. Wrong path and an orphaned type
- `AuthGateSheet` lives at `src/frontend/src/pages/term/modals/AuthGateSheet.tsx`, not `components/shared/AuthGateSheet`.
- The `ItemContextResponse` TS type lives in `src/frontend/src/api/eventItems.ts`, which loses its functions. The spec should say where the type moves.

### L9. Stale anonymous data after login
- Organizer/owner-items responses become principal-dependent, but their TanStack keys (`useOrganizerPage`, `useOwnerItems`) do not change on login. Cached anonymous data, without names, persists until a refetch.
- **Recommendation:** invalidate on auth change.

### L10. Wording and data-loss nits
- R2.5 says "a no-limit variant … capped at 5", which contradicts itself.
- The 0075 downgrade silently drops every owner's location setting. That is acceptable, but it should be documented in the runbook.
- PRIVATE-circle visibility uses membership/organizer (R13.3), while term eligibility uses attendance/organizer. A party with an ended membership but a live RSVP could see an item listed on a private term page and then get 404 on it.

---

## Extra / Out-of-spec observations
- The existing pre-commit race where one proposer offers the same item in two concurrent proposals is not fixed. `_require_own_available_personal_item` reads the offered item's balance without a lock (`term_item_listings.py:94-111`). The new lock covers only the *listing* preference. It is pre-existing and out of scope, so it is worth a follow-up.
- The ITEM chat open after a personal reservation can hit the new-conversation rate limit (`messaging/application/conversations.py:75`) after the reservation is already committed. The UI should show the reservation as successful and the chat error separately.

## Recommendations (priority order)
1. Add the confirm/cancel UI for personal reservations: the taker side on the product page, and the MyItemsView gating as an explicit requirement (C1).
2. Decide how caching works for personalised public responses (H1).
3. Retarget R8.2 to `/access`/`get_group_access`, and specify the rewrite of the public term listing (H2).
4. Decide the PRIVATE gating for `GET /api/inventory-items*` and `/balance` (H3).
5. Fix the gate order, the `PersonalContext` construction, the 0074 runbook, the contexts SQL, the owner-items counts and the visibility PUT payload (M1–M6).
6. Expand the test-migration inventory (M7).
