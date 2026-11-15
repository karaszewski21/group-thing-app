# Codebase findings: needed items and pledges (the demand side today)

## TL;DR
- A `NeededItem` is an organizer's "we need X for this Term" line: a plain name plus optional description, tied to one Term by a NOT NULL FK. It has no author, category, product, location, offer type, expiry or visibility of its own.
- A `Pledge` is a single-claim "I'll bring it" declaration by a Term participant. It moves no item and creates no reservation; the link from pledge to inventory was removed in migration 0063.
- The model was deliberately reduced twice (category enum → product FK → plain name). The product link existed and was dropped, with all rows wiped (0067–0068).
- The only matching in this area is human: a participant reads the list and pledges. Nothing compares needed items with listed items.
- Needed items and a personal wanted post share text checks and the outbox-to-notification pattern, but not ownership, scope, lifecycle or response flow.

## Key Decisions
- Treat needed items as a separate concept from wanted posts in the synthesis — owner (Term organizer vs any user), scope (one Term vs standing), response (pledge with no item vs take/propose on a listed item) and lifecycle (ends with the Term vs needs expiry) all differ in the code.
- Reuse the pledge event flow as the pattern for want signals, not the tables — `pledge_events.py` + `outbox_bridge` + `notifications/outbox_listener.py` is the only place where groups reports "what happened" and notifications owns the text.

## Open Questions / Risks
- Whether needed items should later be matched against listed items too is a product decision; nothing in the code prepares for it (no category, no search vector on `needed_items`).
- `needed_items.name` is checked with the product-name moderation field, so rejection messages say "Nazwa rzeczy…". A wanted post reusing this would inherit that copy unless it gets its own `TextField`.
- Migrations 0067/0068 show the team wiped needed-item data rather than migrate it. If wanted posts ever absorbed needed items, the same question (migrate or wipe) returns.

## Findings

### F1. `NeededItem` is a Term-scoped plain name
**Source**: `src/backend/app/groups/models.py:271-285`
**Evidence**:
```python
class NeededItem(BaseEntity):
    """A "we need X for this Term" request: a plain `name` (no product or
    category link) plus an optional free-text refinement (`description` —
    e.g. "rozmiar 1/2", "czerwona")."""
    __tablename__ = "needed_items"
    term_id: ... ForeignKey("terms.id", ...), nullable=False
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(String(500), nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(), nullable=True)
```
**Context**: Columns are `term_id`, `name` (≤255), `description` (≤500), `deleted_at`, plus the `BaseEntity` id and timestamps. There is no author/party column, no category, no location, no offer type, no status, no expiry. The author is implied: the Term's Circle organizer.
**Confidence**: High

### F2. Only the Circle's active organizer creates, edits or deletes a needed item
**Source**: `src/backend/app/groups/application/terms.py:264-276`, `343-370`, `373-412`
**Evidence**: `create_needed_item` calls `_require_active_organizer(db, term.circle_group_id, profile.party_id)` before the insert (`terms.py:269`); update and delete go through `_require_needed_item_organizer` (`terms.py:343-349`).
**Context**: A regular member or attendee cannot state a need. This is the main structural difference from a wanted post that any user creates.
**Confidence**: High

### F3. Needed-item text passes the same checks as product names
**Source**: `src/backend/app/groups/application/terms.py:279-292`
**Evidence**:
```python
async def _check_needed_item_name(name: str, current: str | None = None) -> None:
    """Needed-item names render on the anonymous public term page, so they
    pass the same checks as product names."""
    rules.ensure_no_contact_info(name)
    await check_text(TextField.PRODUCT_NAME, name, current)
```
The description uses `TextField.PRODUCT_DESCRIPTION` the same way (`terms.py:286-292`).
**Context**: A precedent for moderating demand-side text synchronously in the write request, with the contact-info rule first and the classifier second. The stated reason is anonymous public rendering.
**Confidence**: High

### F4. API surface and authorization
**Source**: `src/backend/app/groups/router/terms.py:120-166`; `src/backend/app/groups/router/pledges.py:31-68`; `src/backend/app/core/authorization_matrix.py:140-144`
**Evidence**:
- `POST /api/needed-items`, `GET /api/needed-items?term_id=…` (repeatable, batched), `GET /api/needed-items/{id}`, `PATCH` and `DELETE /api/needed-items/{id}`.
- `POST /api/pledges`, `GET /api/pledges?needed_item_id=`, `GET /api/pledges/mine`, `GET /api/pledges/{id}`, `POST /api/pledges/{id}/withdraw`.
- Matrix: `PATCH`/`DELETE /api/needed-items/{id}` → EDIT; `GET` → READ (row 34); `POST` → EDIT (row 35); pledges `GET` → READ (row 36), `POST` → EDIT (row 37).
**Context**: The matrix only gates to READ/EDIT; organizer and pledger ownership live in the application layer. A new resource would need its own matrix rows (first match wins) and the same split.
**Confidence**: High

### F5. Needed items are shown on the public term page, with the pledger's name
**Source**: `src/backend/app/groups/schemas.py:312-320`, `358`; `src/backend/app/groups/application/public_view.py:277-305`
**Evidence**: `PublicNeededItemResponse` carries `id`, `name`, `description`, `claimed`, `claimed_by_name`, `claimed_by_party_id`; the public term view fills them from `list_needed_item_views` and `list_active_pledges_for_term`.
**Context**: Visibility of a need follows the Term page's own access rules; a needed item has no visibility setting. The pledger's display name and party id are exposed to whoever can read that page.
**Confidence**: High (shape); Medium (who exactly can read the term page — that is the items/search gatherer's visibility area)

### F6. A pledge is a pure declaration, limited to one active pledge per need
**Source**: `src/backend/app/groups/models.py:288-307`; `src/backend/app/groups/application/pledges.py:78-102`; `src/backend/alembic/versions/0023_pledges_single_active_claim.py:51-57`
**Evidence**:
```python
class Pledge(BaseEntity):
    """ "I'll bring it" declaration bridging a Party to a NeededItem — a
    pure declaration: no item is registered, reserved or moved. ...
    `FULFILLED` is no longer set but stays loadable for existing rows."""
```
`create_pledge` refuses with 409 when any non-withdrawn pledge exists (`pledges.py:84-86`), backed by the partial unique index `uq_pledges_active_needed_item … WHERE status <> 'WITHDRAWN'`.
`PledgeStatus` has `OPEN`, `CLAIMED`, `WITHDRAWN`, `FULFILLED` (`models.py:63-67`); only `CLAIMED` and `WITHDRAWN` are written today.
**Context**: The response to a need is "one person says they will bring it". There is no item id on a pledge, so a pledge cannot lead to take/propose.
**Confidence**: High

### F7. Who may pledge
**Source**: `src/backend/app/groups/application/pledges.py:69-82`
**Evidence**: `_takes_part` accepts an active RSVP to the Term, or standing membership in or leadership of its Circle; otherwise 409 with "Zapisz się na te zajęcia, żeby zgłosić, że coś przyniesiesz".
**Context**: Responding to a need requires taking part in the Term. A wanted post answered by any owner of a matching item has no such gate.
**Confidence**: High

### F8. Pledge state changes notify the organizer through the outbox
**Source**: `src/backend/app/groups/application/pledges.py:38-66`; `src/backend/app/groups/domain/pledge_events.py:7-8`; `src/backend/app/notifications/outbox_listener.py:53-74`
**Evidence**: `_emit_pledge_event` appends `groups.pledge_claimed` / `groups.pledge_withdrawn` with payload `{organizer_party_id, actor_name, product_name, link_path}`; the listener builds the Polish text and writes `PLEDGE_CREATED` / `PLEDGE_WITHDRAWN`. A missing need, term or organizer yields no event and never a 500 (`pledges.py:41-53`).
**Context**: This is the cleanest producer/consumer split in the codebase: the producer names the event and the facts; `app.notifications` owns kind and wording and never imports `app.groups`. Payload key `product_name` is kept for already-queued events although the value is now the need's name (`pledges.py:62-63`).
**Confidence**: High

### F9. Deleting a need withdraws its pledges and notifies the pledger directly
**Source**: `src/backend/app/groups/application/terms.py:373-412`
**Evidence**: Open/claimed pledges are set to `WITHDRAWN`, `deleted_at` is stamped, and each affected party gets `NEEDED_ITEM_REMOVED` via `notifications_bridge.create_notification` with `link_path="/"`, all in one commit.
**Context**: The second notification style: written synchronously in the producer's transaction through the bridge, with the text built in groups. Both styles exist side by side (see the signals file, F3).
**Confidence**: High

### F10. Migration history: the product link was added and then removed
**Source**: `src/backend/alembic/versions/0017_…py:34-36`, `0018_needed_item_add_product_id.py:1-13`, `0019_needed_item_backfill_product_id.py:1-15`, `0020_needed_item_drop_category.py:1-10`, `0023_pledges_single_active_claim.py:1-18`, `0063_drop_pledge_fulfillment.py:1-12`, `0067_wipe_needed_items.py:1-8`, `0068_needed_item_name.py:1-12`
**Evidence**:
| Revision | Change |
|---|---|
| 0017 | `needed_items.deleted_at` (first soft delete in the codebase) |
| 0018–0020 | `category` enum (`INSTRUMENT`, `MAT_BLANKET`, `ART_SUPPLIES`, `OTHER`) replaced by a NOT NULL `product_id` FK into `products` |
| 0023 | partial unique index: one non-withdrawn pledge per need |
| 0063 | "A pledge is now a pure declaration": drops `pledges.resolved_reservation_id` and deletes `PLEDGE_ITEM_REGISTERED` notifications |
| 0067 | deletes every pledge and needed item ("existing rows cannot be mapped from their product to a name the organizer chose") |
| 0068 | adds `needed_items.name NOT NULL`, drops `product_id` with its FK and index |
**Context**: The team already tried "a need points at a catalog product" and "a pledge resolves into a reservation", and removed both. Any proposal to give needed items structure (category, product, reservation link) reverses decisions taken on 2026-10-26/27. `architecture.md:109` records the current state: "Needed items are plain names … since `0068` they no longer point at a product."
**Confidence**: High (what changed); Medium (why — the migration docstrings give the mechanics, not the product reasoning)

### F11. Read paths and tests
**Source**: `src/backend/app/groups/infrastructure/repository.py:512-580`; `src/backend/app/groups/application/public_view.py:153-177`; `src/backend/tests/test_needed_items_batch.py:27-85`; `src/backend/tests/test_needed_item_name_migration.py`
**Evidence**: Repository functions `get_needed_item`, `list_needed_items_for_term`, `list_live_needed_items_for_terms` (batched across terms with the claimed flag), `list_pledges_for_needed_item`, `list_active_pledges_for_term`, `list_my_pledges_joined`. `MyPledgeResponse` (`schemas.py:532-545`) feeds the caller's "obiecałem przynieść" list. The batch test asserts the query count does not grow with the number of terms (`test_needed_items_batch.py:85`).
**Context**: All reads are keyed by Term or by pledger. There is no "all open needs" read, no search over needs, and no index beyond the FK and the partial unique pledge index.
**Confidence**: High

## What a needed item is and is not (basis for extend / replace / separate)

| Aspect | Needed item (code today) | Wanted post (per the brief) |
|---|---|---|
| Author | Circle organizer only (`terms.py:269`) | any user |
| Scope | exactly one Term (`models.py:278-282`) | standing, not tied to a Term |
| Content | name + description | text, possibly category, condition, offer type, location, expiry |
| Response | a pledge, one active per need, no item involved (`models.py:288-293`) | an owner points to a listed item; take/propose follows |
| Matching | none; humans read the list | system matches against listed items |
| Lifecycle | soft delete by organizer; otherwise ends with the Term | create, edit, fulfil, expire, renew, delete |
| Notifications | organizer on pledge/withdraw; pledger on removal | seeker and item owners on a match |
| Visibility | that of the Term page | its own rules |

The overlap is limited to: demand-side free text moderated like a product name, soft delete, and the outbox event pattern. Confidence: High for the left column (code), Medium for the right (brief, not a specification).
