# Spec Audit: Item detail page `/product/:id`

**Spec**: `implementation/spec.md` (392 lines)
**Audited**: 2026-10-01, against the working tree on `main` (`d245d6e`)
**Verdict**: **PASS WITH CONCERNS** (⚠️ Mostly Compliant / implementable)

The spec is detailed, and its codebase claims hold up. Every helper, file, line-level behaviour and test helper it cites exists and behaves as described. The privacy model, the single-query history and the deleted-item rules are all implementable as written. There are no Critical findings and no High findings. Eight Medium findings need a decision or a spec clarification before planning: one is an internal contradiction, two are semantic gaps in the status and privacy model, one is a concurrency hole, one is a leftover dead-code gap and three are design-risk confirmations. The remaining findings are Low.

---

## 1. Verified claims (evidence)

| Claim | Result | Evidence |
|---|---|---|
| `_require_item_owner` exists, 404 on missing or deleted, 403 for non-owner, exactly 2 callers | ✅ | `circulation/application/inventory_items.py:179-190`; callers at `:199` (`update_item`) and `:218` (`soft_delete_item`); it goes through `get_item` (`:73-79`), which 404s on `deleted_at` |
| `resolve_owning_inventory` respects `home_inventory_id` | ✅ | `inventory_items.py:137-145` |
| `get_user_id_by_principal` raises a 404 when there is no user | ✅ | `circulation/application/identity.py:17-26` (`EntityNotFoundException("User", …)`) |
| `repository.get_item` is deleted-tolerant; `find_item_balance`, `list_active_reservations_for_item` and `get_item_with_product_name` exist | ✅ | `circulation/infrastructure/repository.py:65-66, 117-131, 190-200` |
| Core `table(...)` precedent | ✅ | `inventory_items.py:153` (`_item_listing_preferences`), `category/service.py:38` (`_products`). Circulation already imports `app.product.models.Product` (`repository.py:31`) and `app.auth.models.User` (`identity.py:12`), so Core refs for `terms`/`categories`/`user_profiles` are consistent and never touch `app.groups` |
| `user_profiles.account_user_id` is unique (the LEFT JOIN in history cannot fan out) | ✅ | `alembic/versions/0009_party_bc_split.py:137` `uq_user_profiles_account_user_id` |
| `Reservation.term_id` is NOT NULL; RETURN inherits the LEND's term | ✅ | `models.py:263`; `reservations.py:36-57, 94-95` |
| RETURN reservation puts the balance in RESERVED, so the RETURNING derivation is reachable | ✅ | `reservations.py:115` sets `RESERVED` for every type, including RETURN; cancel restores LENT (`reservation_transitions.py:76-79`) |
| `BalanceStatus.RETURNED` | ✅ (moot) | It is never assigned anywhere (`grep BalanceStatus.RETURNED` returns 0 hits); RETURN fulfilment sets AVAILABLE (`reservation_transitions.py:116`). The "RETURNED→Dostępna" mapping is harmless. |
| A swap posts one transaction with 2 legs × (−1/+1); filtering by `item_id` yields only this item's leg | ✅ | `infrastructure/ledger.py` `post_movement` builds `entry_lines` per leg; `_validate_legs` requires exactly 2 legs for SWAP |
| Both entries of a leg carry the leg's `reservation_id` | ✅ | `ledger.py` `entry_lines` uses `leg.reservation_id` for both sides |
| EXTERNAL account has `inventory_id NULL` | ✅ | `ledger._resolve_accounts`; 0042 seeds EXTERNAL with NULL inventory |
| Authorization matrix rows / first-match order | ✅ | `core/authorization_matrix.py:157-159`. No earlier row matches PUT/DELETE/PATCH on `/api/inventory-items/*/…` (row 10 is GET-only and non-`/api/`; row 17 is `/api/products`). Without new rows, PATCH `/description`, PUT `/photos/order` and DELETE `/photos/{id}` resolve to the AUTHENTICATED catch-all (`:218`). POST `/photos` → row 41; GETs → row 40. The proposed insert position is correct. |
| `NotificationKind` is VARCHAR(30) with no DB CHECK, so no migration is needed | ✅ | `notifications/models.py:74-76`; `_enum_column` uses `native_enum=False` (`circulation/models.py:45-55`); `ITEM_RESERVED_FOR_PICKUP` is 24 characters |
| `link_path` sites | ✅ | `groups/application/term_item_listings.py:486-492` (TAKEN), `:610-617` (SWAP_PROPOSED), `:679+` (ACCEPTED), `:701+` (auto-reject loop), `:742+` (REJECTED), `:818-824` (TERM_ALREADY_RESOLVED, no link); `pledge_fulfillment.py:99-108` (`item` variable in scope at `:58-82`) |
| `resolve_organizer_slug` import becomes unused in `term_item_listings.py` and `pledge_fulfillment.py` | ✅ | Only uses are `:486`/`:610` and `:99`. It stays used in `term_end_scan.py:183`, `pledges.py`, `join_requests.py` and `public_view.py`. |
| `take_item_listing` has `term`, `taker_profile.party_id` and `product` before the commit | ✅ | `term_item_listings.py:431-494` |
| `PanelDataContext` link parsing: only `TERM_CONFIRMATION_NEEDED` parses a termId; `PendingSwapAction.linkPath` is not consumed | ✅ | `PanelDataContext.tsx:165-171, 680-698`; no `.linkPath` reader anywhere in `src/` (grep). The `SWAP_PROPOSED` modal routes to "Moje rzeczy", not to `linkPath` (doc comment `:122-126`), so repointing it breaks nothing. |
| `RESERVED_SLUGS` group + backend SPA fallback | ✅ | `organizations/slugs.py:18-31`; `system/router.py:113-120` routes reserved slugs to `spa_fallback`, so `/product/{uuid}[/edit]` is served `index.html` |
| Frontend files and exports | ✅ | `TermAttendeesPage.tsx`, `useTermAttendees.ts`, `PhoneFrame.tsx`, `Icons.tsx:53 PhotoPlaceholder`, `panelIcons.tsx` (`BackIcon:78`, `TrashIcon:88`, `PencilIcon:104`, no Eye icon), `utils/url.ts:1 isValidImageUrl`, `api/problem.ts` (`extractProblemMessage:36`, `ACCESS_DENIED_MESSAGE:55`, `serverMessageOr:62`), `AuthGuard.tsx:35-36` (returnTo) |
| `updateInventoryItem`'s only caller is `PanelDataContext` | ✅ | `PanelDataContext.tsx:46, 1275, 1314` are the only non-test references |
| Backend test helpers | ✅ | `tests/ledger_assertions.py:27 movements_for_item`; `tests/test_circulation_ledger.py:136/143/155` `_create_user/_create_product/_create_item`; existing kind assertions at `test_term_item_listings.py:302` and `test_pledge_fulfillment.py:149`; `test_authorization_matrix.py:39-43` |
| Frontend tests to delete or replace | ✅ | `PanelPage.test.tsx:2107-2136` (condition and name+category edits); `RzeczyViewCategory.test.tsx:178` ("Typ rzeczy" select) |
| Migration head | ✅ | `alembic/versions/0044_user_profiles_birth_year.py` (`revision="0044"`), so 0045 is next |
| BaseEntity UUID PK + `version_id_col=updated_at` | ✅ | `core/base_model.py:41-68` |

---

## 2. Findings by severity

### Critical
None.

### High
None.

### Medium

**M1. Internal contradiction: what a SWAP history entry shows** *(Ambiguous)*
- Spec §Core Requirements 8 (line 36) says: "A swap shows the movement type only."
- Spec §History (line 169) says the SWAP description is `{from} → {to}`. Line 171 lists `term_occurs_on` as null only for REGISTER, REMOVE and RETURN, which implies SWAP has a term date.
- Test plan group 3 asserts only "a swap returns only this item's leg".
- **Impact**: the implementer has to guess whether SWAP rows get a description and term line or only "Zamieniona".
- **Recommendation**: line 36 probably means "only the movement, not the counterpart item" (Out of Scope: "showing the counterpart item of a swap"). Reword it that way, and state explicitly that SWAP gets `{from} → {to}` and a term date.

**M2. Status for an item locked by a still-PROPOSED swap reads "W drodze — odbiór na terminie"** *(Incomplete)*
- Evidence:
  - `propose_swap` creates a SWAP reservation on the *offered* item and immediately confirms it (`term_item_listings.py:579-593`).
  - `_confirm` sets the balance to `IN_TRANSIT` (`reservation_transitions.py:63`).
  - The status derivation (spec §Current status, step 3) maps this to `IN_TRANSIT` → "W drodze — odbiór na terminie DD.MM · Dla: {owner}".
- The new `SWAP_PROPOSED` link points exactly at this offered item (§Notifications table). The listing owner who opens it sees "W drodze … Dla: Ty" for an offer they have not accepted yet. A reject (`reject_swap_proposal`) later reverts it to AVAILABLE.
- **Recommendation**: add a rule for a SWAP reservation with `paired_reservation_id IS NULL` (an unaccepted proposal). Either add a separate code such as `PROPOSED` ("Zaproponowana do zamiany"), or show RESERVED-style copy. Otherwise, explicitly accept the current wording.

**M3. The privacy guarantee is bypassable through existing sibling endpoints on the same item id** *(Ambiguous / scope)*
- The binding decision is that history privacy is enforced server-side, with no user ids. The new `/details` and `/history` endpoints comply. However, any READ user who has the item UUID (now linked from public term listings) can call:
  - `GET /api/inventory-items/{id}`, which returns `inventory_id` and `home_inventory_id` (`circulation/schemas.py:61-67`, `router.py:154-157`);
  - `GET /api/inventories/{inventory_id}`, which returns `owner_user_id` (`schemas.py:26-30`, `router.py:122-127`);
  - `GET /api/inventory-items/{id}/balance`, which returns `reservation_id`, and then `/api/reservations/{id}` returns user ids.
- Out of Scope (line 377) lists only `/api/reservations*` and `/api/circulation-transactions/{id}`.
- **Recommendation**: add `GET /api/inventory-items/{id}`, `/balance` and `GET /api/inventories/{id}` to the explicit follow-up list. Alternatively, confirm with the user that the threat model is only "the page does not display it", not "the API does not expose it".

**M4. The shared description is writable by any owner of any item of the same catalog product** *(design risk; needs confirmation)*
- Products are a shared, find-or-create catalog (`product/service.py:90 get_or_create_product_by_name`; `POST /api/products/resolve` is EDIT-gated).
- Any user can register an item of product X and then `PATCH …/description`, which rewrites the description shown on every other user's item of X.
- The spec acknowledges last-write-wins, but not this cross-user vandalism vector.
- Related point: the admin-editable `Product.description` column (`product/models.py:24`) is silently ignored by the page. There are now two "description" sources and the spec states no fallback.
- **Recommendation**: confirm explicitly with the user (the decision is binding, but this consequence may not have been considered). Also state whether `Product.description` is used as a read fallback.

**M5. The photo reorder accepts a stale but complete permutation, so a fast second move loses the first** *(Incorrect under concurrency)*
- The 409 fires only when `photo_ids` is not a permutation of the current set (spec line 214).
- `movePhoto` computes the swapped list from the cached query data (line 278). Two quick clicks, or two tabs, send two valid permutations built from the same stale order. The second request silently overwrites the first.
- `FOR UPDATE` serializes the requests but does not detect staleness.
- **Recommendation**: disable the move/remove buttons while a gallery mutation is pending. That is enough for this scale; alternatively, compare the submitted order's base. State the chosen fix in the spec.

**M6. Dead panel state is under-specified: the `products` catalog cache and its full-catalog fetch stay behind** *(Incomplete; `minimal-implementation.md`)*
- `products` / `setProducts` / `getProducts()` are used only by `startEditItemMeta` and `saveItemMeta`:
  - `PanelDataContext.tsx:455, 480-484` (fetches the whole catalog on every panel load);
  - `:953-958` (a merge in `handleAddItem` whose comment says it exists for `startEditItemMeta`);
  - `:1287, 1305`;
  - the context export at `:1453`.
- No other consumer exists in `src/pages/panel` or `src/components`.
- The setters `setEditingItemCondition` and `setEditingItemMeta`, exported at `:1469-1470` and consumed by `RzeczyView.tsx:50-51`, are not named in the deletion list either.
- **Recommendation**: add `products` state, the `getProducts()` call in `load`, the merge in `handleAddItem`, the `products` export and both setters to the deletion list. Removing them also saves a catalog request on every panel load.

**M7. The authorization matrix is documentation and tests only, not runtime enforcement** *(Ambiguous framing)*
- `resolve_requirement` / `AUTHORIZATION_MATRIX` are referenced only by docstrings and by `tests/test_category_module.py:28` / `test_authorization_matrix.py`.
- Real enforcement is the per-route `Depends(require_any(...))` (`circulation/router.py:55-56` `ReadPrincipal` / `EditPrincipal`).
- The spec's sentence "Without the new rows, the PATCH/PUT/DELETE paths would fall through to the AUTHENTICATED catch-all" (line 232) suggests the rows are load-bearing. Forgetting `EditPrincipal` on a route would actually leave it open to any authenticated user while the matrix test still passes.
- **Recommendation**: state that each new mutating route must use `EditPrincipal` and that the GET routes must use `ReadPrincipal`. The matrix rows are kept in sync for documentation and tests.

**M8. The re-check after lock is unspecified** *(Low-to-Medium race)*
- `require_item_owner` loads the item through `db.get` (`deleted_at` checked), and only *then* does `lock_item` take `FOR UPDATE` (spec line 144).
- A concurrent `soft_delete_item` that commits in between leaves the photo use case working on an item that is now deleted. The identity-map instance is stale unless `populate_existing()` is used.
- The outcome is benign (photos of deleted items are kept), but it contradicts the rule that every mutation on a deleted item returns 404.
- **Recommendation**: `lock_item` should use `with_for_update().execution_options(populate_existing=True)` and re-check `deleted_at`. Alternatively, accept the race in Known Limitations.

### Low

**L1. Copy mismatch on photo URL validation.** The frontend message is "…zaczynający się od https://" (spec line 62), but `isValidImageUrl` accepts `http://` (`utils/url.ts:1-4`). The backend message says "http:// lub https://" (line 212). Align the copy.

**L2. "The `NotificationKind` union test includes the new kind" (line 355) refers to a test that does not exist.** No file in `src/frontend/src/test` mentions `NotificationKind`. Reword it as "add a type-level/fixture assertion" or drop it.

**L3. `hasStatus` is a private function** in `hooks/useTermAttendees.ts:30`. It is not exported, so "reuse" means copy or export. Say which.

**L4. `RzeczyViewCategory.test.tsx` fixture cleanup is not mentioned.** `makeContextValue` sets `editingItemMeta`, `editingItemCondition`, `itemMetaError` and `startEditItemMeta` (`:157-169`), and many other tests pass `editingItemMeta: null` (`:207-284`). Typecheck may fail after the context fields are removed. Add this to group 6.

**L5. The path for `PublicTermView.tsx` is unqualified.** The file is `src/frontend/src/pages/krag/PublicTermView.tsx` (`toListingRow` at `:59-78`). There is no separate listing renderer in `TermPage.tsx` (grep), so "PublicTermView/TermPage" in test group 6 is just PublicTermView.

**L6. The history tie-break uses `transaction.id DESC`, a random UUID** (`BaseEntity` `uuid4`), so it does not reflect insertion order. Use `created_at` or `transaction_number` as the secondary key if same-timestamp ordering matters. The test helper's `(occurred_at, id)` has the same property.

**L7. Known Limitation "silently overwrites" (line 392) is only partially accurate.** `Product` uses `version_id_col`, so truly concurrent writes raise `StaleDataError` → 409 (see the `ledger.py` module docstring). Sequential overwrites are silent. This is a wording fix only.

**L8. Untyped Core `column()`s.** The precedents use `column("item_id")` without types. For `terms.occurs_on` and `user_profiles.display_name`, give types (`column("occurs_on", DateTime)`) so mypy and result typing behave. This is optional.

**L9. Auto-reject loop wording.** The spec says `/product/{proposal.listing_item_id}` for the loop (line 253), but the loop variable is `other` (`term_item_listings.py:701+`). The value is the same; this is a cosmetic fix.

**L10. `ai-description` plugin key shape.** The real `ai-description` plugin writes to `plugin_objects` (`plugins/ai-description/src/pages/api/generate.ts:63`), not to `plugin_data`. If it later uses `setData`, `replace_plugin_data`'s whole-key REPLACE (`plugin/service.py:134-149`) would wipe the manual `description`. This is noted for the follow-up; the binding decision stands.

---

## 3. Focus-area conclusions

- **Privacy leaks in the new payloads**: none, as specified. Labels use `label()` with per-leg participants. REGISTER and REMOVE have one participant, so third parties always see "inna rodzina". No ids are in `ItemHistoryEntryResponse`, and `ItemDetailsResponse` contains only `product_id`/`category_id`/photo ids. The bypass through existing endpoints is covered in M3.
- **N+1**: History is one query plus the viewer and item lookups. Details is a constant number of queries, roughly 8–9: row, photos, balance, owning inventory, viewer, active reservations, display names, term, plus the current inventory for LENT. There is no per-row querying.
- **Photo ordering races**: count and density are protected by `FOR UPDATE`. A stale reorder is not protected (M5), and the deleted re-check is missing (M8).
- **Deleted items**: `/details` and `/history` return 200 through `repository.get_item`, and mutations 404 through `get_item`. `resolve_owning_inventory` still works because REMOVE leaves `inventory_id` intact (`ledger._apply_projection`).
- **SWAP with two legs**: correctly handled by the `item_id` filter. A pending swap proposal's status is a gap (M2).
- **Lent items and edit ownership**: the home owner edits, via `resolve_owning_inventory`; the borrower is not the owner. `is_owner` uses the same rule. This is consistent.
- **Over-engineering**: none of significance. A dedicated read model, a pure domain module and a 3-endpoint gallery are proportionate. A `GET photos` route is correctly omitted.

## 4. Clarification questions

1. (M1) Do SWAP history rows show `{from} → {to}` and a term date, or only "Zamieniona"?
2. (M2) What should the status block say for an item offered in a not-yet-accepted swap?
3. (M3) Is "no user ids" an API guarantee for the item, in which case the sibling endpoints need hardening or explicit deferral, or only a page guarantee?
4. (M4) Is it acceptable that any user can rewrite the shared catalog description by owning one item of that product? Should `Product.description` be a read fallback?
5. (M5) Is it acceptable to disable the gallery controls while a mutation is pending as the stale-reorder fix?
