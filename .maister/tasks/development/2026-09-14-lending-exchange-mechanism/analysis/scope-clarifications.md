# Phase 2 Scope Decisions

## Critical decisions

### 1. Data model for Term-linkage
**Decision**: New `TermItemListing` entity in `app.groups` (not a `term_id` column on `app.circulation`'s `InventoryItem`/`Reservation`).
**Why**: Preserves `app.circulation`'s documented "given, unchanged" contract (`docs/system-wypozyczalni-inventory-accounting.md` never mentions Terms) and the existing bounded-context/anti-corruption-layer discipline. Mirrors the existing `Pledge.resolved_reservation_id` loose-FK precedent for groups→circulation pointers.

### 2. TermAttendance withdrawal
**Decision**: Build it from scratch — a new withdraw-RSVP capability (e.g. `withdrawn_at` on `TermAttendance`, new endpoint).
**Why**: Without it, clarification #4 from Phase 1 (listings disappear on un-RSVP) is only half-satisfiable. Full scope: listings expire on BOTH the Term's date passing AND the lister withdrawing attendance.

## Important decisions (all defaults accepted, no changes requested)

### 3. Frontend placement
**Decision**: New browse/list/take UI lives in the Krąg/Term context (`KragGrupyPage.tsx`/`useKragGrupy.ts`), which is already Term-scoped — not bolted onto the term-agnostic Panel/`RzeczyView`.

### 4. Expiry cutoff semantics
**Decision**: A listing expires exactly at `Term.occurs_on` (the class's start datetime), not "end of that calendar day."

### 5. Reservation pipeline shortcuts
**Decision**: No shortcuts — all reservation types (LEND/RETURN/SWAP/GIFT), including GIFT-type permanent give-aways, go through the full existing `pending → confirmed → fulfilled` state machine. No immediate-fulfillment fast path for GIFT.

## Net scope
This is confirmed as a genuinely new, additive capability spanning:
- Backend: new `TermItemListing` entity + migration (app.groups), new TermAttendance-withdrawal endpoint + migration, new browse endpoint (batched, N+1-safe), a new `_require_term_attendance` authorization primitive, extended `circulation_bridge.py`.
- Frontend: new browse/take screen inside the Krąg/Term context, wiring the currently-decorative "Wypożyczę/Oddam/Zamienię"/"Pożyczone/Otrzymane/Zamienione" concept to real data (though those specific Panel tiles may or may not be the literal UI touched — TBD at spec/planning time given the Krąg-context placement decision).
