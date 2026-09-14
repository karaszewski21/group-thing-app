# Gap Analysis: RSVP-Gated Lend/Return/Exchange Mechanism

## Summary
- **Risk Level**: Medium-High
- **Estimated Effort**: High
- **Detected Characteristics**: modifies_existing_code, creates_new_entities, involves_data_operations, ui_heavy

## Task Characteristics
- Has reproducible defect: no
- Modifies existing code: yes (`circulation_bridge.py`, `RzeczyView.tsx`, `PanelDataContext.tsx`, `AUTHORIZATION_MATRIX`)
- Creates new entities: yes (Term↔item linkage entity/field, new browse endpoint(s), likely a TermAttendance-withdrawal action)
- Involves data operations: yes (new migration for the Term-linkage; new read path)
- UI heavy: yes (net-new browse/take screen; two decorative UI surfaces need to become real)

---

## Gaps Identified

### Missing Features
- **Term-scoped "list my item" declaration**: no field/entity anywhere records "this `InventoryItem` is offered to attendees of Term X as LEND/GIFT/SWAP." `InventoryItem` (`src/backend/app/circulation/models.py:135`) has no Term linkage; intent (`ReservationType`) currently only exists on `Reservation`, created after someone else already acts — too late for a browsable "what's on offer" list.
- **Cross-owner browse endpoint**: `GET /api/inventory-items` (`src/backend/app/circulation/router.py:94-98`) requires a specific `inventory_id` — structurally cannot list "other users' offered items." No endpoint anywhere returns items across owners, Term-scoped or otherwise.
- **TermAttendance-scoped authorization primitive**: no reusable "caller has RSVP'd to Term X" check exists. The only two `TermAttendance`-touching entry points are `create_rsvp` (`router/circles.py:105`, idempotent create) and `list_my_attendances` (`router/circles.py:138`, read caller's own rows) — neither is a gate on anyone else's action.
- **TermAttendance withdrawal**: grepped `app/groups` for `withdraw`/cancel/delete on attendance — zero matches. Only `Pledge` has a withdraw action (`application/pledges.py:105`, `router/pledges.py:63`). Phase 1 clarification #4 ("listing disappears... once the lister's `TermAttendance` is withdrawn") presumes a capability that does not exist in the codebase today — this is a **new gap**, not previously called out in codebase-analysis.md or clarifications.md.
- **Peer browse/take UI**: confirmed — no page/component anywhere lets a user see items listed by *other* Term-attendees. `KragGrupyPage.tsx`/`useKragGrupy.ts` only build `myAvailableItems` (the caller's own items, for pledge-fulfillment) and drive `confirmPledgeReceipt` (organizer-side pledge confirm/fulfill) — not general peer-to-peer browsing.

### Incomplete Features
- **`RzeczyView.tsx` "Wypożyczę/Oddam/Zamienię" toggle** (lines 172-188): fully rendered, wired to `setItemMode`/`itemModes`, but `itemModes` is a plain `useState<Record<number, ItemMode | null>>` in `PanelDataContext.tsx:242-243` — never sent to any API, lost on reload, and structurally can't express "for Term X" (it's a bare per-item enum, no Term selector at all).
- **`PodarkiView.tsx` gift tiles**: renders local `gifts` state (`PanelDataContext.tsx:243`) with no producer besides `removeGift` — permanently empty, no backend counterpart.

### Behavioral Changes Needed
- `app/groups/infrastructure/circulation_bridge.py` (currently 6 thin pass-throughs, `get_or_create_personal_inventory`/`register_item`/`create_lend_reservation`/`get_reservation`/`get_item`/`get_item_balance`/`get_inventory`) needs new pass-throughs: a batched multi-item read (for the N+1-safe browse query) and, if `create_reservation`/`create_swap`/`confirm_reservation`/`fulfill_reservation` are to be reused for take/borrow/exchange (per clarification #3), pass-throughs for those too — today the bridge only exposes `create_lend_reservation`.
- `AUTHORIZATION_MATRIX` (`app/core/authorization_matrix.py`) needs new rows for the new Term-scoped listing/browse/take routes, following the existing pattern (rows 32-37: coarse READ/EDIT at the matrix, fine-grained ownership/attendance check in `service.py`/`application/*.py` — see row 124's `PATCH /api/terms/{id}` comment and `security.md`).

---

## Data Model Gap (detailed)

Current state: `InventoryItem` and `Reservation` (`app/circulation/models.py`) have zero columns referencing `Term`. `app.circulation`'s own module docstring (lines 1-16) states it implements `docs/system-wypozyczalni-inventory-accounting.md` **verbatim**, and that doc never mentions Term/Circle/attendance (confirmed via grep — zero matches). Per `standards/backend/models.md`'s Cross-Module References section, a reference from one bounded context into another must be a plain FK-id column, never an ORM `relationship()` — and per the existing `Pledge.resolved_reservation_id` precedent (`app/groups/models.py:191-194`), a *reverse-direction* pointer (groups looking into circulation) is deliberately kept **FK-less** ("no FK, mirrors `PluginObject.entity_id`'s precedent") specifically to avoid circulation ever needing to know about groups' existence.

**Three options considered:**

- **Option A — `term_id` column directly on `InventoryItem`** (in `app.circulation`). Rejected: violates the "given, unchanged" contract circulation's own docstring claims, and forces the Term-agnostic bounded context to import/reference `app.groups.Term` — exactly the coupling `circulation_bridge.py` exists to prevent.
- **Option B — new join/listing entity in `app.groups`** (e.g. `TermItemListing`: `term_id` FK→`terms.id`, `item_id` loose FK-less pointer→`inventory_items.id` mirroring `Pledge.resolved_reservation_id`'s precedent, `lister_party_id` FK→`parties.id`, `intended_type` — reusing `ReservationType`'s LEND/RETURN/SWAP/GIFT values as a plain string, not importing the enum cross-module — `created_at`/`withdrawn_at`). **Recommended.** Keeps `app.circulation` completely untouched (preserves the "given, unchanged" spec), lives in the module that already owns `TermAttendance` and the attendance-gating logic, and mirrors the exact `Pledge`-as-bridge-record pattern already established and shipped.
- **Option C — `term_id` on `Reservation` itself.** Rejected: a listing must be browsable *before* any `Reservation` exists (nobody has reserved it yet) — `Reservation` is created only once a taker acts, per `create_reservation`'s existing semantics (`domain/reservation_rules.py`). A listing and a reservation are different lifecycle stages; conflating them would mean "offered but not yet taken" has no representation at all.

## Browse Endpoint Gap (detailed)

No endpoint lists items across owners today (confirmed: `list_items(inventory_id: int, ...)` at `router.py:95-98` requires a specific `inventory_id`; there is no `GET /api/inventory-items` variant without it). A new endpoint (e.g. `GET /api/terms/{term_id}/available-items`, living in `app/groups/router/terms.py` alongside the existing Term routes) is needed. Implementation must: (1) verify caller has `TermAttendance` for `term_id` (new gate — see below), (2) query `TermItemListing` rows for that `term_id`, excluding withdrawn/expired ones and the caller's own listings, (3) batch-resolve the referenced `InventoryItem`/`Product`/`InventoryBalance` rows via a **new batched** `circulation_bridge` call (e.g. `get_items_by_ids(db, item_ids: list[int])`) rather than one bridge call per listing — the existing bridge only exposes single-id `get_item`/`get_item_balance`, which would N+1 per `standards/backend/queries.md`'s explicit-eager-loading discipline (translated here to "batch the cross-module calls, don't loop them").

## Authorization Gap (detailed)

No reusable "caller has RSVP'd to Term X" predicate exists. Precedent to follow: `_require_active_organizer` (`app/groups/application/circles.py:193-196`) and `_require_pledging_party` (`application/pledges.py`) — both small, private, service-layer functions raising `AccessDeniedException`, invoked from the use-case function, **not** expressed in `AUTHORIZATION_MATRIX` (which only gates coarse READ/EDIT — see `security.md`'s documented split). A new `_require_term_attendance(db, term_id, party_id)` belongs in `app.groups` (it already owns `TermAttendance`), called from the new listing/browse/take use-cases before any `circulation_bridge` call — exactly mirroring how `pledge_fulfillment.fulfill_pledge` resolves the organizer identity in `app.groups` before ever touching `app.circulation`. `app.circulation`-side code never needs to consult attendance directly — the gate lives entirely upstream of the bridge call, preserving the one-directional dependency (`app.groups` → `app.circulation`, never the reverse) `circulation_bridge.py`'s own docstring declares.

## Expiry Gap (detailed)

`Term.occurs_on` (`app/groups/models.py:143`) is a single naive `datetime` — no explicit duration/end-time field exists anywhere in the model, and no other feature in the codebase computes a Term "end" from `occurs_on` (grep confirms). Two things must be decided, both currently unresolved by Phase 1 clarifications:
1. **Cutoff semantics**: is a listing excluded the instant `occurs_on < now()` (the class start), or does it need a grace window (e.g., "still visible through end of that day")? Nothing in the codebase establishes a convention either way.
2. **Withdrawal mechanism**: clarification #4 requires listings to disappear "once the lister's `TermAttendance` is withdrawn" — but no such withdrawal action exists (see Missing Features above). Building this requires **also** adding: a new mutating endpoint (e.g. `DELETE /api/groups/mine/attendances/{term_id}`), and a way to mark `TermAttendance` as withdrawn — `TermAttendance` currently has no `deleted_at`/status column at all (unlike `NeededItem.deleted_at`/`InventoryItem.deleted_at`, the codebase's existing soft-delete precedent). This is scope the task description implies but the codebase cannot support without a net-new mutation, not just a net-new filter.

Recommended filter location: read-time, inside the new browse use-case in `app.groups` (not a stored/materialized "is_expired" flag) — `WHERE term.occurs_on >= :now AND listing.withdrawn_at IS NULL AND EXISTS (attendance not withdrawn)`, joined in one query per `queries.md`'s N+1 guidance rather than a per-listing existence check in a loop.

## Frontend Placement Gap (detailed)

Two real candidates, neither cleanly settled by Phase 1 clarifications (which resolved *who* can list/browse, not *where* in the UI):

| Option | Fit | Concern |
|---|---|---|
| **Panel** (`RzeczyView.tsx`, term-agnostic "Moje rzeczy") | Reuses existing item CRUD UI, `ItemQuickAddForm` | The existing toggle has no Term selector at all — a user attending multiple Terms has no way to say *which* Term an item is offered to; would need new UI (a Term picker per item) grafted onto a currently simple view |
| **Krąg/Term context** (`KragGrupyPage.tsx`, already Term-scoped) | Term-scoping is free (already inside one Term's context); reuses the `useKragGrupy.ts` confirm/fulfill wiring pattern already proven for the Reservation lifecycle | Net-new UI section (a "Rzeczy dostępne na ten termin" tab); `myAvailableItems` today only serves pledge-fulfill-from-owned-item, not general listing-for-browse |

Recommendation: **Krąg/Term context**, because correctness requires unambiguous Term-scoping and `KragGrupyPage` is the only page that already has it, but this is flagged as a decision for the user rather than assumed.

## Reuse Assessment

| Piece | Verdict | Notes |
|---|---|---|
| `Reservation`/`InventoryBalance`/`CirculationTransaction` state machine + points ledger | **Reuse as-is** | Per clarification #3; `fulfill_reservation`'s "credit current holder" rule and `_require_party_to_reservation` need no changes |
| `circulation_bridge.py` pattern | **Extend** | Add batched item-read + (if take/swap/gift reuse the generic engine) pass-throughs for `create_reservation`/`create_swap`/`confirm_reservation`/`fulfill_reservation`, following `pledge_fulfillment.py`'s precedent of thin, single-purpose bridge calls |
| `ItemQuickAddForm` / inventory CRUD | **Reuse** | Item registration UI is unrelated to the new Term-linkage; only the "offer this for Term X" declaration step is net-new |
| `AUTHORIZATION_MATRIX` | **Extend** | New rows for new routes; ownership/attendance check stays in `service.py`/`application/*.py` per the established split |
| `KragGrupyPage.tsx`/`useKragGrupy.ts` confirm/fulfill wiring | **Reuse as reference pattern** | Not directly reusable code, but the closest existing precedent for a Term-scoped Reservation-lifecycle UI |

---

## Issues Requiring Decisions

### Critical (Must Decide Before Proceeding)
1. **Data-model shape for Term-linkage**: Option A (field on `InventoryItem`) vs **B (new `TermItemListing` entity in `app.groups`, recommended)** vs C (field on `Reservation`).
   - Options: ["New `TermItemListing` entity in app.groups (recommended)", "New `term_id` field on `InventoryItem` in app.circulation", "New `term_id` field on `Reservation`"]
   - Recommendation: Option B — preserves circulation's "given, unchanged" contract and the existing bounded-context/ACL discipline; matches the `Pledge`-as-bridge-record precedent already shipped.
2. **TermAttendance withdrawal doesn't exist yet — must it be built as part of this task?** Clarification #4 assumes a withdrawal action the codebase has no trace of (only idempotent create + read-own exist).
   - Options: ["Build a new withdraw-RSVP endpoint + mark TermAttendance withdrawn (full clarification #4 scope)", "Descope withdrawal-triggered expiry; listings only expire when the Term's date passes"]
   - Recommendation: Build it — otherwise clarification #4 is only half-satisfiable and the feature description ("wystawienia rzeczy... wypożyczyć, wziąć, oraz zamieniać się") implies a full, coherent RSVP lifecycle.
   - Rationale: Without it, a user who un-RSVPs still has their listings visible to remaining attendees — a real privacy/trust gap for a peer-to-peer lending feature tied to physical class attendance.

### Important (Should Decide)
1. **Frontend placement**: Panel ("Moje rzeczy", term-agnostic today) vs Krąg/Term context (`KragGrupyPage`, already Term-scoped).
   - Options: ["Krąg/Term context — new tab on KragGrupyPage (recommended)", "Panel — extend RzeczyView with a Term picker per item"]
   - Default: Krąg/Term context
   - Rationale: Term-scoping is unambiguous there for free; Panel's existing toggle has no Term concept to extend from.
2. **Expiry cutoff semantics**: exact moment a listing stops being browsable relative to `Term.occurs_on` (no end-time field exists in the model).
   - Options: ["Cutoff at occurs_on exactly (class start time)", "Cutoff at end of the occurs_on calendar day"]
   - Default: cutoff at `occurs_on` exactly (simplest, no new assumptions about session duration)
   - Rationale: `Term` has no duration field and no existing feature infers one; inventing a grace window adds unreviewed assumption.
3. **Scope of reused circulation actions**: should ALL of take/borrow/exchange route through the full generic `create_reservation`/`create_swap`/confirm/fulfill lifecycle (clarification #3 says yes for "points/ledger reuse"), or does "take" for a simple give-away (`GIFT`) skip the pending/confirm steps?
   - Options: ["Full state machine for every type (LEND/RETURN/SWAP/GIFT), no shortcuts", "GIFT-type take skips confirm and fulfills immediately"]
   - Default: Full state machine, no shortcuts (matches clarification #3's explicit instruction to reuse the pipeline as-is)

---

## Recommendations
- Model the Term-linkage as a new `TermItemListing` entity in `app.groups`, not a column on `app.circulation` models — preserves the documented "given, unchanged" contract and the existing ACL boundary.
- Build the missing `TermAttendance`-withdrawal action explicitly as part of this task's scope (flagged as a genuinely new requirement Phase 1 didn't surface), including a `deleted_at`/`withdrawn_at`-style column, mirroring `InventoryItem.deleted_at`/`NeededItem.deleted_at`'s existing soft-delete precedent.
- Add a single new batched cross-module read (`circulation_bridge.get_items_by_ids`) rather than looping single-item bridge calls, to keep the browse endpoint N+1-safe.
- Place the new browse/list/take UI under the Term/Krąg context (`KragGrupyPage.tsx`), not the term-agnostic Panel, and retire (not just leave decorative) `RzeczyView`'s `itemModes` toggle and `PodarkiView`'s local `gifts` state once real data is available — per user's known preference (memory: `feedback_prototype_port_fidelity`) to port UX faithfully rather than simplify, this applies to *replacing* decorative UI with the real thing, not deleting it outright without an equivalent.
- Add backend tests mirroring `test_pledge_fulfillment.py`'s structure: attendee RSVPs → lists item for that Term → second attendee (also RSVP'd) browses/takes → confirm/fulfill → ledger posted; plus explicit negative tests (non-RSVP'd user blocked from listing/browsing; listing disappears after Term passes; listing disappears after RSVP withdrawal).

## Risk Assessment
- **Complexity Risk**: High — net-new bounded-context-respecting data model, net-new authorization primitive, net-new N+1-safe cross-module read path, and a net-new UI surface, all in one feature.
- **Integration Risk**: Medium — the `circulation_bridge.py` ACL pattern and `Pledge`-as-bridge-record precedent are well-established and directly reusable, lowering the risk of the DDD boundary being violated.
- **Regression Risk**: Low-Medium — existing `Reservation`/`CirculationTransaction`/Pledge flows are untouched by design (additive only); main regression surface is the `AUTHORIZATION_MATRIX` (first-match-wins ordering) if new rows are inserted incorrectly relative to existing ones.
