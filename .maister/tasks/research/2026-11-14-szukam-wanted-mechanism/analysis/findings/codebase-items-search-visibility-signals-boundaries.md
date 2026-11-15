# Codebase findings: visibility of matches, "item listed" write points, module boundaries

## TL;DR
- Whether a seeker may learn of an item is one SQL predicate, `items_visible_to(viewer, scope)` over `ItemListingPreference`: PUBLIC items for everyone, PRIVATE items only through a shared live PRIVATE group; a match that skips it would leak PRIVATE items.
- No event, outbox entry or hook is raised when an item becomes listed, changes or becomes available again. The supply-side modules (`inventory`, `product`, `category`, `locations`, `search`) contain no outbox call at all.
- An item enters the listed set at two write points (`register_item` with a listing mode; `set_item_listing_preference` creating a row) and returns to "available" at the reservation release (`_release`); each is a plain commit in `app.groups` or `app.inventory`.
- `app.search` and `app.pages` are read-only and importable only by `app/main.py` (AST test). A wants feature that writes rows and sends notifications cannot live in `app.search` without changing that test, and cannot import it either.
- Cross-context access goes through one `infrastructure/<other>_acl.py` per foreign module; `inventory` never imports `groups` (the router injects a callback), which is the existing pattern for "inventory write triggers groups-side work".

## Key Decisions
- "Where a signal could be raised" lists the existing write points and what each one knows at commit time; it does not choose between them.
- Visibility facts are stated for the two matching directions separately (one seeker vs many items; one item vs many seekers), because the predicate's signature supports them differently.

## Open Questions / Risks
- Item attribute changes that alter matching (product rename or description edit, item `condition`/`location_id`/`product_id` PATCH, visibility PRIVATE→PUBLIC, mode GIFT↔SWAP) are silent writes. Whether they should re-trigger matching is a product decision; the code offers no change signal for any of them.
- Group membership changes also change what a seeker may see (joining a PRIVATE group reveals its members' PRIVATE items). No signal exists for that either; out of this gatherer's scope beyond noting it.
- `items_visible_to` takes the viewer as a Python `uuid.UUID`, not a column. The item→many-seekers direction cannot call it with a correlated seeker column as written; the underlying `parties_share_group` accepts a column on one side. Confidence in the signature reading: high; that a correlated rewrite performs acceptably: not assessed.
- The search ACLs re-export ORM models and predicates through `app.groups.service` / `app.inventory.service`. A new wants module would need its own ACL files exposing the same names; whether those facades already export everything needed was checked only for the names search uses.
- A seeker's identity shown to item owners ("X is looking for this") has no existing privacy rule to reuse; `item_privacy.py` only covers reserver and history labels.

## 1. Visibility rules a match must respect

### Finding 1.1: the item predicate
**Source**: `src/backend/app/groups/infrastructure/visibility.py:91-108`
**Evidence**:
```python
public = ItemListingPreference.visibility == ItemVisibility.PUBLIC
if viewer is None:
    return public
private = ItemListingPreference.visibility == ItemVisibility.PRIVATE
reached_public = (
    public if scope == VisibilityScope.ALL else public & owner_shares_group_with(viewer)
)
return or_(
    reached_public,
    private & owner_shares_group_with(viewer, private_only=True),
    _is_counterparty(viewer),
    ItemListingPreference.owner_party_id == viewer,
)
```
**Context**: for a logged-in seeker in scope `ALL`, a matchable item is PUBLIC, or PRIVATE with a shared live PRIVATE group. The counterparty and owner branches exist for the item page gate; search removes own items separately (`search/application/search.py:301-302`). Scope `MINE` ("Moje grupy") narrows PUBLIC items to owners sharing any live group — the existing building block for a "only from my groups" want.
**Confidence**: high

### Finding 1.2: what "sharing a group" means
**Source**: `src/backend/app/groups/infrastructure/visibility.py:41-59`; `src/backend/app/groups/infrastructure/membership.py:18`, `:48-57`; `.maister/docs/project/architecture.md:270-272`
**Evidence**: `parties_share_group(party: Parties, other_party: uuid.UUID, *, private_only=False)` — both in one live group via `group_ids_for`; `Parties = uuid.UUID | Collection[uuid.UUID] | SQLColumnExpression[uuid.UUID]`. Standing membership or current leadership only: "Soft-deleted groups never count, an RSVP or a family relation never counts" (`visibility.py:5`). A PRIVATE group switched to PUBLIC stops counting for PRIVATE items (rule R3/R4 in `architecture.md:272`).
**Context**: `party` may be a correlated column, `other_party` must be a value. For a new item (owner known as a value) checked against many stored wants, `parties_share_group(<want seeker column>, owner_id, private_only=True)` is expressible with the existing function; `items_visible_to` itself is not, since its `viewer` is a value.
**Confidence**: high

### Finding 1.3: the single-item gate
**Source**: `src/backend/app/groups/application/item_visibility.py:28-44`
**Evidence**: `can_view_item(db, item_id, viewer_party_id)` — one statement: visible when the item has no preference row, or `items_visible_to(viewer, ALL)` admits it. `require_item_visible` raises `EntityNotFoundException` (404). Module docstring: "Every item read path, take/propose and the creation of a new ITEM conversation call this first, so a hidden item is a 404 before any 403 or 409 could reveal it."
**Context**: this is the check to re-run at notification time or when a seeker opens a match: visibility can change between matching and reading (group left, item turned PRIVATE). `take_item` and `propose_item_swap` already call it first (`term_item_listings.py:717`, `:729`), so a stale match leads to a 404, not a leak.
**Confidence**: high

### Finding 1.4: safe-by-default listing reads
**Source**: `src/backend/app/groups/infrastructure/repository.py:771-786`
**Evidence**: `_visible_preferences(include_private, private_circle_id)` returns PUBLIC-only unless the caller opts in; `private_circle_id` admits PRIVATE rows only of owners who are in that circle.
**Context**: the project convention (`standards/backend/models.md`, "listing visibility safe by default") is that any new select over listing preferences defaults to PUBLIC and makes PRIVATE inclusion explicit. A want matcher is a new such select.
**Confidence**: high

### Finding 1.5: PRIVATE items cannot be placed in public contexts
**Source**: `src/backend/app/groups/application/reservation_context.py:48-58`
**Evidence**: `require_placeable` — "409 for a PRIVATE item in an event, in a PUBLIC circle's term or in a private circle's term its owner only RSVPs to."
**Context**: a seeker who is correctly shown a PRIVATE match can still be refused at take/propose depending on the context they choose; the response flow from a match inherits this.
**Confidence**: high

### Finding 1.6: what is shown about people and places
**Source**: `src/backend/app/inventory/domain/item_privacy.py:1-12`, `:90-100`; `src/backend/app/inventory/application/item_details.py:103`; `src/backend/app/search/application/search.py:358-359`, `:390`
**Evidence**: a reserver's name is shown to every logged-in viewer and never to an anonymous one; `location_id` in item details is owner-only; a search guest gets `reserved: true` but `reserved_until: null`. Search places an item by locality only.
**Context**: existing precedent for a match notification: an item's exact address is never revealed to a non-owner, only the locality.
**Confidence**: high

### Finding 1.7: personalised responses are kept out of shared caches
**Source**: `src/backend/app/search/router/search.py:88`; `src/backend/app/core/cache_headers.py` (not opened; behaviour per `.maister/docs/INDEX.md` security entry)
**Evidence**: `set_personalised_cache_headers(response, principal)` after a successful search.
**Context**: any public read listing wants or matches that varies by viewer follows the same rule.
**Confidence**: medium (helper's body not read)

## 2. Write points where "an item is now listed / available" is known

No function below publishes an event. A grep for `outbox|enqueue|publish_event|stage_event` under `app/{inventory,product,category,locations,search}` returns no match (2026-11-14). Notifications in the listing code are created inline through `notifications_bridge.create_notification` inside the same transaction (for example `term_item_listings.py:691-705`).

### Finding 2.1: item created already listed
**Source**: `src/backend/app/inventory/application/inventory_items.py:43-96`; `src/backend/app/inventory/router.py:135-155`; `src/backend/app/groups/application/term_item_listings.py:123-139`
**Evidence**:
```python
if listing_mode is not None and on_registered is not None:
    await db.flush()
    await on_registered(db, item, inventory, listing_mode)
await db.commit()
```
The router passes `on_registered=term_item_listings.list_registered_item`, which inserts the `ItemListingPreference` (visibility defaults to PUBLIC) and flushes; inventory commits once.
**Context**: at this point the transaction knows item id, product id, condition, location id, owner and mode. The hook is the existing way for an inventory write to run groups-side code without inventory importing groups ("inventory never imports groups", docstring `:57-58`). The hook runs before the commit, so anything it writes is atomic with the item.
**Confidence**: high

### Finding 2.2: first listing of an existing item, and listing changes
**Source**: `src/backend/app/groups/application/term_item_listings.py:142-198`; route `src/backend/app/groups/router/term_item_listings.py:46-56` (`PUT /api/item-listing-preferences/{item_id}`)
**Evidence**: `set_item_listing_preference` locks the item row FOR UPDATE, then: `mode is None` → delete the row and set DRAFT (`:168-175`); existing row → update `mode`, `owner_party_id`, optionally `visibility` (`:179-184`); no row → insert with PUBLIC default and set ACTIVE (`:185-195`); commit at `:196`. A first listing requires a live item location (`:176-177`).
**Context**: the same function is the point for "newly listed" (insert branch), "offer type changed" and "visibility changed" (update branch) and "unlisted" (delete branch). The branches are distinguishable in code by `existing is None`.
**Confidence**: high

### Finding 2.3: item available again after a released reservation
**Source**: `src/backend/app/inventory/application/reservation_transitions.py:80-84`, `:87-111`, `:163-177`, `:233-246`; callers `src/backend/app/groups/application/term_item_listings.py:1000-1005`, `:1043-1048`, `:1178-1192`
**Evidence**: `_release` sets the balance back to `AVAILABLE`. It is reached from `cancel_reservation`, `cancel_exchange` (both legs of a swap) and `cancel_reservations_without_commit` (event deletion). On the groups side: `cancel_transaction`, `reject_swap_proposal` and the auto-reject of losing proposals in `accept_swap_proposal`.
**Context**: a released item is still listed (its preference row was never removed), so it was matchable all along but flagged reserved. Whether a release counts as a new "available" signal is a design choice; the write happens inside `app.inventory`, which has no knowledge of listings, while the groups-side callers do.
**Confidence**: high

### Finding 2.4: items leave the listed set
**Source**: `src/backend/app/groups/application/term_item_listings.py:1158-1175`; `src/backend/app/inventory/application/inventory_items.py:287-311`
**Evidence**: `confirm_transaction` deletes the preference of every fulfilled leg and sets DRAFT before `fulfill_exchange` commits; the item "arrives at its new owner as a draft". `soft_delete_item` is refused with 409 while a preference row exists (`ItemHasStandingListingException`) or the balance is not AVAILABLE.
**Context**: a stored match (want ↔ item) goes stale at these points: fulfilled, unlisted, or reserved by someone else. There is no FK from the preference to the item (loose pointer, `groups/models.py:356-360`), so a wants table pointing at items would follow the same loose-pointer convention and need its own staleness handling.
**Confidence**: high

### Finding 2.5: silent attribute edits
**Source**: `src/backend/app/inventory/application/inventory_items.py:262-284`; `src/backend/app/product/service.py:164-181`, `:510-521`
**Evidence**: `update_item` PATCHes `condition`, `location_id` and `product_id` "regardless of the item's `InventoryBalance` status"; `update_product` rewrites name, description and category; `set_shared_description` edits the description. All re-run text moderation where text changes; none notifies anyone.
**Context**: the generated `search_vector` follows product edits automatically, so a query-time matcher always sees current text; a matcher that ran once at listing time would not.
**Confidence**: high

### Finding 2.6: existing background machinery referenced from the supply side
**Source**: `src/backend/app/main.py:113-127`
**Evidence**: the lifespan registers the notifications and storage outbox listeners, starts the 30 s outbox poller and an `AsyncIOScheduler` with the term-end scan and a media sweep.
**Context**: these are the two existing ways to run work outside a request (outbox handler, periodic job). Their internals belong to the needs-signals gatherer; noted here only because none of the listing write points uses them today.
**Confidence**: high for the registration; details not read

## 3. Module boundary rules

### Finding 3.1: `app.search` and `app.pages` are closed, read-only modules
**Source**: `src/backend/tests/test_module_boundaries.py:17`, `:54-64`, `:67-85`, `:88-97`; `.maister/docs/project/architecture.md:280-282`
**Evidence**:
```python
MODULES = ("pages", "search")
...
assert importers == ["main.py"]
...
allowed = (
    (f"app.{name}.domain",)
    if path.is_relative_to(root / "domain")
    else ("app.core", "app.db", "app.storage", f"app.{name}")
)
```
Three AST tests: only `app/main.py` imports the module; code outside `infrastructure/` imports only `app.core`, `app.db`, `app.storage` and the module itself (`domain/` only itself); no ACL imports the module's own `schemas`. Architecture: "it owns no table and writes nothing."
**Context**: consequences for a wants feature — (a) it cannot import `app.search` to reuse `_matching` or `_near`; (b) placing want tables or notification writes inside `app.search` contradicts its documented read-only role, though the test itself checks imports, not writes; (c) if `app.search` should list wants as a result kind, it would reach the wants module through a new `infrastructure/wants_acl.py`, like its eight existing ACLs.
**Confidence**: high

### Finding 3.2: the ACL convention
**Source**: `src/backend/app/search/infrastructure/inventory_acl.py:1-22`, `groups_acl.py:1-57`, `product_acl.py:1-12`, `locations_acl.py:1-13`; `src/backend/app/groups/infrastructure/inventory_bridge.py:1-13`
**Evidence**: each ACL docstring states it is "the ONLY `app.search` module that imports the … vertical" and "must not import `..schemas`". They re-export models and unexecuted select builders from the other module's `service` facade (`app.inventory.service`, `app.groups.service`) and add small builders (`in_groups_of`, `current_organizer`, `next_term`). `inventory_bridge.py` is the same idea for `app.groups` → `app.inventory`, with thin pass-through functions.
**Context**: the names a matcher needs are already exported by those facades: `listed_items_with_product_select`, `newest_open_reservation_starts_at` (inventory); `items_visible_to`, `owner_shares_group_with`, `with_pending_proposer`, `group_ids_for`, `VisibilityScope`, `ItemListingPreference` (groups); `Product`, `first_approved_photo_by_product` (product); `Locality`, `Location`, `fold_polish`, `MIN_QUERY_LENGTH` (locations).
**Confidence**: high

### Finding 3.3: dependency direction between inventory and groups
**Source**: `src/backend/app/inventory/application/inventory_items.py:38-40`, `:56-58`, `:217-222`; `src/backend/app/groups/infrastructure/inventory_bridge.py:288-293`
**Evidence**: `app.groups` imports `app.inventory` (through the bridge only). `app.inventory` never imports `app.groups`: it takes an `OnItemRegistered` callback from the router and reaches `item_listing_preferences` through an ad-hoc Core `table(...)` reference. `listing_status` is written by groups only via `inventory_bridge.set_item_listing_status`.
**Context**: listing knowledge lives in `app.groups`; a "new item listed" signal raised from the groups listing use cases needs no new dependency, while raising it from inside `app.inventory` would need another injected callback or an outbox event.
**Confidence**: high

### Finding 3.4: duplicated link builders are pinned by a test
**Source**: `src/backend/tests/test_module_boundaries.py:100-111`
**Evidence**: `test_searchLinks_termAndEventPaths_matchPagesLinks` asserts `app.search.domain.links` and `app.pages.domain.links` produce the same paths, with the comment "The boundary keeps search from importing `app.pages`, so it holds copies."
**Context**: the accepted cost of the boundary is small copies guarded by a parity test — the precedent if a wants module needs the item or search path builders.
**Confidence**: high

### Finding 3.5: where the module is wired
**Source**: `src/backend/app/main.py:48-51`, `:155-173`
**Evidence**: routers are included one by one; `search_router` and `pages_router` are imported only here. `groups_router` is registered ahead of `inventory_router` so `/api/inventory-items/mine` wins over `/{item_id}` (`groups/router/term_item_listings.py:59-61`).
**Context**: a new module's router is added here; route-order collisions with existing literal segments are a known concern.
**Confidence**: high

## Reuse assessment (this file's components)

| Component | Where | Verdict | Why |
|---|---|---|---|
| `items_visible_to(viewer, scope)` | `groups/infrastructure/visibility.py:91-108` | reuse as is (want→items); extend (item→wants) | viewer is a value, not a column |
| `parties_share_group` | `visibility.py:41-49` | reuse as is | accepts a correlated column for one party |
| `can_view_item` / `require_item_visible` | `groups/application/item_visibility.py:28-44` | reuse as is | re-check at read or notify time; already guards take/propose |
| `_visible_preferences` convention | `groups/infrastructure/repository.py:771-786` | follow | PUBLIC-only default for any new listing select |
| `register_item` `on_registered` hook | `inventory/application/inventory_items.py:38-40`, `:91-93` | extend | one existing callback slot, used by listing-preference insert |
| `set_item_listing_preference` | `groups/application/term_item_listings.py:142-198` | extend | the insert branch is the "newly listed" point |
| Reservation release (`_release`) | `inventory/application/reservation_transitions.py:80-84` | extend, if release should signal | inside inventory, no listing knowledge there |
| `app.search` module | `app/search/` | not a home for writes; reach it or be reached via ACL | boundary test and documented read-only role |
| ACL pattern | `search/infrastructure/*_acl.py` | reuse the pattern, new files | one ACL per foreign module, no `..schemas` import |
