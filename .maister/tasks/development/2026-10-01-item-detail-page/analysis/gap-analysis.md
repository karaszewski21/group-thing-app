# Gap Analysis: Item detail page `/product/:id` (opis, stan, kategoria, galeria, historia) + item notifications

## Summary
- **Risk Level**: Medium
- **Estimated Effort**: Medium-High (new table + migration 0045, photo CRUD, history projection with server-side privacy, cross-BC composition, new route/page/hook, notification repointing)
- **Detected Characteristics**: modifies_existing_code, creates_new_entities, involves_data_operations, ui_heavy (no reproducible defect)
- **Change type**: additive (page, endpoint, table, notification kind) + modificative (link_path of 5 existing kinds, `PublicTermView` row title, `RESERVED_SLUGS`)
- **Compatibility**: flexible (pre-production, no back-compat shims; existing notification rows keep old term links, which still resolve)

## Task Characteristics
- Has reproducible defect: no
- Modifies existing code: yes (`take_item_listing`, swap/pledge notification emitters, `PublicTermView.toListingRow`, `router.tsx`, `slugs.py`, `api/notifications.ts`, `PanelDataContext` doc comment)
- Creates new entities: yes (`inventory_item_photos` table, `ITEM_RESERVED_FOR_PICKUP` kind, history/detail endpoints, item page)
- Involves data operations: yes (photo CRUD, history READ projection, detail READ)
- UI heavy: yes (new page with gallery, history timeline, owner-only photo editing, links in 2-4 places)

---

## Gaps Identified (current vs desired)

| Area | Current state (verified) | Desired state | Gap |
|---|---|---|---|
| Route | No `/product/:id`. `RESERVED_SLUGS` (`organizations/slugs.py`) contains `products` but **not** `product` | AuthGuard'ed `/product/:id` under PublicLayout | Missing route + reserved slug |
| Item read | `GET /api/inventory-items/{id}` returns item + `product_name` only; `application.get_item` raises 404 for soft-deleted items | Name, description, condition, category name, gallery, current status, history | Missing detail payload (description, category name, photos, status) |
| History | Not implemented. Ledger spec Group 5 defines `GET /api/inventory-items/{id}/history` returning raw `owner_user_id` + `owner_display_name` per side | Projection over ledger, viewer-relative labels ("Ty" / counterparty name only on viewer's events / "inna rodzina") | Missing endpoint; **the specified response shape violates clarification #3** (raw ids + names for everyone) and must be replaced by server-side-labelled sides |
| Gallery | Only `Product.photo_url` (single, catalog-level, validated `^https?://`, max 500). No item photos | New table of item photo URLs + sort order; gallery on page | Missing table, migration 0045, model, CRUD endpoints, UI |
| Description | `Product.description` exists but products are a **shared catalog** resolved by name+category (`resolveProduct` in `PanelDataContext.saveItemMeta`); no user UI edits description (admin `ProductFormPage` only) | "Opis" shown on page | READ without user CREATE/UPDATE: for user-created items the field will almost always be empty (see critical decision) |
| Category | `Product.category_id`; editable from RzeczyView via product re-resolution | Category name on page | Need server-side category-name join (precedent `PublicNeededItemResponse.product_category_name`) |
| Condition | `InventoryItem.condition`, editable by owner in RzeczyView | Shown via `CONDITION_LABELS` | Read-only display only |
| Taker notification | `take_item_listing` (term_item_listings.py L431-498) notifies only the owner (`TERM_ITEM_LISTING_TAKEN`) | Taker gets "Zarezerwowano X — odbierz na terminie" → `/product/{item_id}` | New `NotificationKind` (fits VARCHAR(30), no migration) + second `create_notification` before the existing `db.commit()`; mirror kind in `api/notifications.ts` |
| Notification links | `TERM_ITEM_LISTING_TAKEN` (L492), `SWAP_PROPOSED` (L616), `PLEDGE_ITEM_REGISTERED` (pledge_fulfillment L107) link to the term; `SWAP_ACCEPTED` (L682), both `SWAP_REJECTED` (L704, L745) have **no link** | All item-related kinds → `/product/:id`; `TERM_CONFIRMATION_NEEDED` keeps term link | 3 repoints + 3 new links; swap kinds need an item choice (2 items per swap) |
| Term page | `toListingRow` renders `<strong>{product_name}</strong>` (PublicTermView L66) | Title links to `/product/{item_id}` | Wrap in `<Link>`; needed-item rows have only `product_id` -> stay unlinked |
| Moje rzeczy / Wypożyczone | RzeczyView title at L305 (with inline edit pencil), WypozyczoneView list | Reachable from own items (journey requested in brief) | No links today |

### Behavioral changes
- `TERM_ITEM_LISTING_TAKEN`, `SWAP_PROPOSED`, `PLEDGE_ITEM_REGISTERED`: click in NotificationBell goes to the item page instead of the term page.
- Pending-actions modal: verified safe. `SWAP_PROPOSED` modal ignores `linkPath` (button navigates to `/panel` + "rzeczy"); only `TERM_CONFIRMATION_NEEDED` parses `/term/<id>` (PanelDataContext L165-171, L697) and it is unchanged. The doc comment at PanelDataContext L117-119 ("every producing notification's link_path ends in /term/<id>") becomes false and must be updated.

---

## User Journey Impact Assessment

| Dimension | Current | After | Assessment |
|---|---|---|---|
| Reachability | No item page at all | Term listing title, notification bell (5 kinds + new one), optionally Moje rzeczy / Wypożyczone | OK only if Moje rzeczy link is added — otherwise owners can reach their own item page only via a term or a notification |
| Discoverability | n/a | Term row title as link: 6/10 (plain bold text today, needs link affordance: underline/chevron). Notification: 9/10. Moje rzeczy title link: 7/10 | Add visible affordance on term rows |
| Flow integration | Notification -> term page (where the action context is) | Notification -> item page | Risk: item page must show the **current reservation/status**, otherwise a "X chce wziąć Twoją rzecz" or "Zarezerwowano X" click lands on a page whose history (ledger = completed movements only) shows nothing about that event. PENDING reservations and swap proposals are not ledger movements |
| Multi-persona | — | Owner (can edit photos), current holder/borrower, taker, any logged-in user (read-only), anonymous (redirect) | See persona table below |

### Persona matrix
| Persona | Sees | Can do |
|---|---|---|
| Owner (home inventory owner, via `resolve_owning_inventory`) | Everything; own events as "Ty", counterparties named on own events | Add/remove/reorder photos |
| Borrower (item in their VIRTUAL inventory) | Their own LEND/RETURN events with owner named | Read only |
| Taker with PENDING reservation | Status "zarezerwowana" (if status shown) | Read only (cancel lives elsewhere) |
| Any logged-in user | Item fields, gallery, history with "inna rodzina" for all parties | Read only |
| Anonymous (term page link) | AuthGuard redirects to `/login?returnTo=/product/:id`; works today (`AuthGuard` forwards returnTo) | Register path: `/register` forwards returnTo to `/onboarding?returnTo=` |
| OAuth/MCP `mcp:read` principal without user profile | No participation -> everyone "inna rodzina" | Must not 500 when profile lookup fails |

---

## Data Lifecycle Analysis

### Entity: InventoryItemPhoto (new)

| Operation | Backend | UI | Access | Status |
|---|---|---|---|---|
| CREATE | MISSING (`POST /api/inventory-items/{id}/photos`, owner-only via `_require_item_owner`) | MISSING (URL input, `isValidImageUrl`) | MISSING (owner edit mode on item page and/or RzeczyView) | Must build |
| READ | MISSING (in detail payload) | MISSING (gallery component) | New page | Must build |
| UPDATE (reorder) | MISSING (`PUT .../photos/order` or PATCH sort_order) | MISSING | MISSING | Decision: needed for v1? |
| DELETE | MISSING (`DELETE .../photos/{photo_id}`) | MISSING | MISSING | Must build |

Completeness today: 0%. Clarification #1 requires a gallery, so CREATE+READ+DELETE are mandatory; without CREATE UI the gallery is orphaned (READ without CREATE).

Lifecycle notes:
- Ownership follows the item: after GIFT/SWAP fulfilment the new owner manages photos; photos added by the previous owner stay (they describe the physical thing). During LEND the home owner still manages (`home_inventory_id`).
- Soft-deleted item: photos are kept (history page still renders); mutations blocked by `_require_item_owner` -> `get_item` 404.
- Edit permission matrix: POST/DELETE `^/api/inventory-items(/.*)?$` must be covered by the EDIT rows of `authorization_matrix.py` — verify the existing PATCH/DELETE rows' regex covers sub-paths; add a row + `test_authorization_matrix` case if not.
- Validation: `^https?://` (reuse `_validate_photo_url` semantics from `product/schemas.py`), max length 500, max photos per item (decision), sort_order unique per item or dense re-numbering.

### Entity: Item description (Product.description)
| Operation | Backend | UI | Access | Status |
|---|---|---|---|---|
| CREATE/UPDATE | `PATCH /api/products/{id}` (admin) | Admin ProductFormPage only | Not reachable for regular users; product is shared catalog | Orphaned for user items |
| READ | Product GET | to be built on item page | new page | Will show empty for most items |

### Entity: Item history (projection, read-only)
| Operation | Backend | UI | Access | Status |
|---|---|---|---|---|
| READ | MISSING (spec'd, not built; shape must change for privacy) | MISSING (timeline) | new page | Must build |
| CREATE | `post_movement` (only ledger writer) — existing | n/a (system) | n/a | Complete |

### Notification `ITEM_RESERVED_FOR_PICKUP` (new)
CREATE in `take_item_listing`; READ via existing bell (`navigate(n.link_path)`); no other changes. Complete once kind is mirrored in the TS union.

**Completeness (feature-level)**: ~25% (only ledger writes and notification plumbing exist).
**Orphaned operations**: photo READ without CREATE (until UI built); description READ without user UPDATE.
**Missing touchpoints**: Moje rzeczy / Wypożyczone links; SWAP_PROPOSED target item; TERM_ALREADY_RESOLVED (item-related but not in clarification #4 list); offered-item names in RzeczyView swap offers (L425) could link to the offered item.

---

## Privacy Analysis

- Clarification #3 must be enforced **server-side**: the history response must carry viewer-relative labels (`is_viewer`, `display_label`) and must **not** carry `owner_user_id` or third-party display names. The ledger spec's `ItemMovementSideResponse` (raw `owner_user_id`, `owner_display_name`) must be replaced.
- "Took part in" definition needed for the projection: viewer is a side of the leg (from-inventory owner or to-inventory owner). For a SWAP, only this item's leg is returned (entries filtered by `item_id`); the viewer on the other leg is always a side of this leg too, so no special case.
- VIRTUAL inventories are owned by the borrower, PICKUP_POINT by the organizer — labels by `inventories.owner_user_id` work for both.
- Same-family members (separate users, separate inventories) would see each other as "inna rodzina" under a strict per-user rule.
- Existing leaks outside this task: `GET /api/reservations?item_id=` and `GET /api/reservations/{id}` return `reserved_by_user_id`/`giver_user_id` to any READ principal; `GET /api/circulation-transactions/{id}` exposes inventory owners. Raw user ids are not names, but they undermine "inna rodzina" for a determined client.
- Term references in history: `Reservation.term_id` lives in circulation; slug/group live in groups (circulation must not import groups). Showing a term link to a non-member of a PRIVATE group leaks group existence (precedent: `groups/public_view.py` L198-212 hides names in PRIVATE groups).
- Photo URLs are arbitrary external https hosts: viewer IP leaks to third parties; same precedent as `Product.photo_url`, acceptable. Render with `referrerPolicy="no-referrer"` and `loading="lazy"`.
- Item UUIDs are publicly visible on term pages; with "any logged-in user can view", every registered user can read any listed item's page. Accepted by clarification #3.

---

## Edge Cases

| Case | Current behavior | Required handling |
|---|---|---|
| Soft-deleted item | `application.get_item` -> 404; ledger spec says history returns 200 ending with REMOVE | Detail must load via `repository.get_item` (404 only if row missing); page shows "Rzecz usunięta" banner + history; photo mutations 404/409. Notifications pointing to a deleted item must not dead-end on 404 |
| Non-existent / malformed id | 404 / FastAPI 422 | Page "Nie znaleziono rzeczy"; malformed UUID -> treat 422 like notFound in hook |
| SWAP (2 legs, one transaction) | Ledger writes 4 entries | Filter entries by `item_id` -> exactly one from/to pair for this item; description "SWAP: X ⇄ Y" may name the other item — decide whether to show the counterpart item (link to `/product/{other_item_id}`) |
| Item lent out | `inventory_id` = borrower VIRTUAL, `home_inventory_id` = owner | Owner label from `resolve_owning_inventory`; "Obecnie u: Ty / name / inna rodzina" per privacy rule; balance `LENT` + `due_date` |
| PENDING / CANCELLED reservations | Not ledger movements | Not in history unless merged; at minimum show current balance status (RESERVED/IN_TRANSIT) |
| Anonymous visitor following term link | — | AuthGuard -> `/login?returnTo=` -> back to page; verified AuthGuard supports this |
| Organization with slug `product` | Allowed today | Add `"product"` to `RESERVED_SLUGS`; pre-prod, no data migration (verify no local org uses it) |
| Viewer without user profile (OAuth client) | — | All parties "inna rodzina", no 500 |
| Item with zero photos | — | Fallback to `Product.photo_url`, else `PhotoPlaceholder` |
| Broken photo URL | — | `onError` -> placeholder, keep layout |
| Taker notification for a past term | `take_item_listing` rejects past terms | No case |
| Existing notification rows | Keep old term links | Fine (pre-prod, links still resolve) |
| Frontend id typing | `api/groups.ts` L172/L490 `item_id: number`, `notifications.ts` `id: number`, `reservation_id: number` | Fix types touched by this task to `string` |

---

## Architecture / Cross-BC composition

The page needs: item + condition + balance (circulation), product name/description/photo_url + category name (product, category), photos (circulation, new), history labels (users), term labels/links (groups). `circulation` may not import `groups`. Options:
- **A**: all reads in circulation (repository joins to `products`, `categories`, `user_profiles` under the documented M1 infrastructure-read exception), history returns `term_id` + `term_occurs_on` only (no link) — no groups dependency.
- **B**: compose an item-details read model in `groups/application` via `circulation_bridge`/`product_bridge`, which can also resolve term slug/link and PRIVATE-group visibility.
- **C**: circulation endpoints + frontend joins with extra term calls (waterfall, N calls).

Photos table belongs to circulation (`inventory_item_photos`, FK `inventory_items.id`, BaseEntity with explicit sequence? -> follow `standards/backend/models.md`; item uses UUID ids since 0041, so follow the item's PK convention).

---

## Issues Requiring Decisions

### Critical (Must Decide Before Proceeding)

1. **scope-orphan-photo-create — Where do owners add/remove photos?** Without a CREATE UI the gallery is orphaned.
   - Options: (A) Owner-only "Edytuj zdjęcia" section on the item page itself (add URL, remove, move up/down); (B) In RzeczyView inline editor; (C) Both.
   - Recommendation: **A**, plus a title link from RzeczyView to the page so owners can find it.
   - Rationale: one place, page already loads photos; RzeczyView is already dense (inline name/category/condition edits, swap offers).

2. **scope-orphan-description — "Opis" has no user input path.** `Product.description` is shared catalog data, admin-only editable; editing it per user would change every item of that product.
   - Options: (A) Add item-level `description` (TEXT, nullable) on `inventory_items`, owner-editable on the item page, shown with fallback to `Product.description`; (B) Show `Product.description` only (mostly empty, "Brak opisu"); (C) Let owners edit `Product.description` (affects all items sharing the product).
   - Recommendation: **A** (same migration 0045 as photos).
   - Rationale: matches the gallery decision (item-level data); B leaves a requested field effectively empty; C corrupts shared catalog.

3. **history-response-shape — Replace ledger-spec Group 5 side shape for privacy.**
   - Options: (A) Server-side labels: each side `{inventory_type, is_viewer, label}` where label is "Ty" / counterparty display name (only if viewer is a side of that leg) / "inna rodzina"; no user ids; (B) Return raw ids+names and mask in the frontend.
   - Recommendation: **A**.
   - Rationale: B leaks names to any API client, contradicting clarification #3.

4. **deleted-item-page — Behavior for soft-deleted items (incl. notifications pointing at them).**
   - Options: (A) 200 with `deleted_at` set; page shows banner "Ta rzecz została usunięta" + details + history; no edits; (B) 404 page.
   - Recommendation: **A**.
   - Rationale: ledger spec already requires history 200 for deleted items; notifications must not dead-end.

5. **current-status-on-page — Show the item's current state/active reservation?** Ledger history only records completed movements, so after "Pożycz"/"Weź na stałe" (PENDING) or a swap proposal, the linked page shows nothing about the event that triggered the notification.
   - Options: (A) Show current status block from `InventoryBalance` (Dostępna / Zarezerwowana / W drodze / Wypożyczona do <due_date>) with privacy-labelled counterparty and the term date; (B) Additionally merge reservations (PENDING/CANCELLED) into the timeline; (C) History only.
   - Recommendation: **A**.
   - Rationale: makes notification clicks meaningful at low cost; B adds a second projection and privacy surface.

### Important (Should Decide)

1. **swap-notification-item — Which item do swap notifications link to?** A swap involves the listing item and the offered item.
   - Options: (A) `SWAP_PROPOSED` (to listing owner) -> **offered** item (what they would receive); `SWAP_ACCEPTED`/`SWAP_REJECTED` (to proposer) -> listing item; (B) Always the listing item.
   - Default: **A**. Rationale: recipient wants to inspect the thing they would get / asked for.
   - Note: `SWAP_PROPOSED` accept/reject happens in RzeczyView; the bell click will no longer land where the action is. The pending-actions modal still routes to Moje rzeczy, so acceptable.

2. **term-already-resolved-link — `TERM_ALREADY_RESOLVED` is item-related but not in clarification #4's list (currently no link).**
   - Options: (A) Link to `/product/{reservation.item_id}`; (B) Leave without link.
   - Default: **A**. Rationale: "every item-related notification" per clarification #4.

3. **moje-rzeczy-links — Link item titles in RzeczyView (L305) and WypozyczoneView to the page?**
   - Options: (A) Yes, both; (B) RzeczyView only; (C) None.
   - Default: **A**. Rationale: brief names "Moje rzeczy" as a journey; required for photo-editing discoverability. Keep the edit pencil separate from the link.

4. **composition-location — Where to compose the detail payload?**
   - Options: (A) Circulation: `GET /api/inventory-items/{id}/details` (item + product + category name + photos + balance) and `GET .../history` with `term_id`/term date only, using the documented M1 infrastructure-join exception; (B) Groups read model via bridges incl. term links; (C) Frontend waterfall.
   - Default: **A** (term shown as date, no link). Rationale: keeps BC rules, 2 queries per endpoint, avoids leaking PRIVATE group terms.

5. **history-term-link — Link history events to their term?**
   - Options: (A) No link, show term date; (B) Link only if viewer is a member/participant of the term's group (needs groups composition, option B above).
   - Default: **A**.

6. **photo-reorder-and-limits — Reorder UI and max photos.**
   - Options: (A) Append order + "move up/down" buttons, max 10 photos; (B) Append-only order, no reorder, max 10; (C) Drag-and-drop.
   - Default: **A**. Rationale: clarification says "URL + order"; buttons are accessible (keyboard) without a DnD dependency.

7. **product-photo-fallback — Use `Product.photo_url` in the gallery?**
   - Options: (A) Item photos first; if none, show `Product.photo_url`; (B) Always prepend product photo; (C) Ignore product photo.
   - Default: **A**.

8. **family-members-label — Same-family members in history.**
   - Options: (A) Strict per-user rule (spouse/co-guardian = "inna rodzina" unless they took part with viewer); (B) Treat members of the viewer's family as named.
   - Default: **A** for v1. Rationale: matches clarification literally; B needs a families lookup in the projection.

9. **existing-raw-endpoint-leaks — `GET /api/reservations*` and `/api/circulation-transactions/{id}` expose user ids to any READ principal.**
   - Options: (A) Out of scope, record as follow-up; (B) Scope them by participant now.
   - Default: **A**.

10. **taker-notification-copy-and-ids — New kind name/copy.**
    - Options: (A) `ITEM_RESERVED_FOR_PICKUP`, message `Zarezerwowano „{product}" — odbierz na terminie {date}`, link `/product/{item_id}`; (B) Same, plus extend `notifications_bridge` to pass `reservation_id`.
    - Default: **A** (no bridge change needed; nothing consumes reservation_id for this kind).

11. **swap-counterpart-in-history — Show/link the other item of a SWAP transaction.**
    - Options: (A) Show "Zamiana na: <name>" linking to `/product/{other_item_id}`; (B) Show movement type only.
    - Default: **B** for v1 (counterpart item name derivable but adds a join; the other item's page is reachable anyway).

---

## Recommendations
- Implement history from ledger spec Group 5 query (single select, two entry aliases, LEFT JOIN account -> inventory -> user_profiles), but map sides to privacy-labelled DTOs in the application layer using the viewer's `account_user_id`; never return user ids.
- Migration 0045: `inventory_item_photos` (+ optional `inventory_items.description` per critical #2). Reversible, explicit naming per `standards/backend/migrations.md`. Apply locally with `.env` loaded.
- Photo endpoints under `/api/inventory-items/{id}/photos` gated by `_require_item_owner`; verify the authorization matrix covers POST/DELETE/PUT sub-paths with EDIT.
- Detail endpoint resolves deleted items via `repository.get_item`, returns `deleted_at`, `is_owner` (drives edit UI), balance status, category name, photos (with product-photo fallback decided).
- New kind in `NotificationKind` + TS union; second `create_notification` in `take_item_listing` before `db.commit()`.
- Repoint `TERM_ITEM_LISTING_TAKEN`, `SWAP_PROPOSED`, `PLEDGE_ITEM_REGISTERED` and add links to `SWAP_ACCEPTED`, both `SWAP_REJECTED`, (`TERM_ALREADY_RESOLVED`) — keep `TERM_CONFIRMATION_NEEDED` (term_end_scan/outbox) untouched. Update PanelDataContext L117-119 comment.
- Frontend: `api/items.ts` (or `itemHistory.ts`), `hooks/useItemDetail.ts` (TanStack Query, prefix keys, `denied`/`notFound`), page modelled on TermAttendeesPage branch order, `dayjs` from `utils/dayjs`, Tailwind tokens, Polish copy; link in `toListingRow` with visible affordance.
- Add `"product"` to `RESERVED_SLUGS` (and its test, if slug tests enumerate the set).

## Risk Assessment
- **Complexity Risk**: Medium — cross-BC read composition and privacy labelling are the non-trivial parts; photo CRUD is routine.
- **Integration Risk**: Medium — new route must coexist with `/:organizationSlug` catch-all (static segment ranks higher in react-router; reserved slug closes the backend side); notification repoint changes navigation for 3 kinds.
- **Regression Risk**: Low-Medium — verified only `TERM_CONFIRMATION_NEEDED` link_path is parsed (unchanged); ~9 backend test assertions on link_path across test_notifications / test_term_end_scan / join-request tests, plus NotificationBell and PanelPage frontend tests — few touch the repointed kinds. `take_item_listing` tests asserting notification count for the owner may need updating when a second notification is staged.
