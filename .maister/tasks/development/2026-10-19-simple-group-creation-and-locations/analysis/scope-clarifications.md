# Phase 2 Scope Clarifications

All nine "important" decisions from the gap analysis were confirmed with their recommended defaults.

## API semantics
1. **PATCH clearing**: `UpdateGroupRequest` and `UpdateTermRequest` use `model_fields_set` for the four new fields only (`default_location_id`, `default_capacity`, `location_id`, `capacity`) so they can be cleared to null. Group `name` stays required; existing `updateGroupLayoutMode` callers stay valid.
2. **CreateTermRequest inheritance**: `location_id` / `capacity` omitted = copy from group defaults; explicit `null` = no place / no limit. Copy is by value (reference id + number), not linked.
3. **Public attendee count**: add `attendee_count` (active signups, `withdrawn_at IS NULL`, via `count_active_attendances_by_term`) to `PublicTermResponse`. `guardians[]` keeps withdrawn rows, so client-side counting is not used. Update exact-key-set assertions in `test_public_term.py`.
4. **Manual address**: `formatted_address` required (non-blank) for both GOOGLE and MANUAL sources.

## Location uniqueness
5. Partial unique index `uq_locations_owner_party_id_google_place_id` on `(owner_party_id, google_place_id)` WHERE `google_place_id IS NOT NULL AND deleted_at IS NULL`. `POST /api/locations` with an already-saved active place_id returns the existing row with 200 (201 when created), implemented with a SAVEPOINT + IntegrityError re-fetch. A soft-deleted Google place can be re-added. The picker pre-checks its loaded list before posting.

## UI structure
6. Done-screen CTA "Stwórz wizytówkę / własny adres" links to the existing `/organization` page (no inline org form in the stepper).
7. Panel both contexts: Home shows a merged top-3 of led + attended terms (dedupe by term id, led wins); Spotkania shows two sections "Prowadzę" / "Zapisane".
8. Shared `GroupFormFields` component (name, visibility, LocationPicker, capacity) used by the add-group modal, edit-group modal and stepper step 1.
9. `FirstTermStepperOrganizer` keeps its one-step flow, extended with LocationPicker + capacity prefilled from the group defaults.
10. Hamburger "Załóż grupę" navigates to `/panel/spotkania?nowa=grupa`; the panel opens the stepper from that query parameter (AccountMenu is rendered outside PanelDataContext).

## Carried from Phase 1
Keep `k-<hash>` slugs; stepper uses `POST /groups/mine/new` with frontend-chosen visibility; notifications untouched; `app/locations` own module + `locations_acl.py`; no text moderation of location fields; hand-written lazy Maps loader; manual mode without key.
