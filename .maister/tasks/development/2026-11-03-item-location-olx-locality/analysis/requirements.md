# Requirements

## TL;DR
Places become "Lokalizacja (required TERYT locality) + Adres (optional Google address)"; every item carries its own required location (create + edit, backend-enforced, cleared on transfer); all LocationPickers use page mode ('+' → /places/new) with drafts preserved; locality dictionary (TERYT SIMC + GUGiK postal codes) is shipped as a committed gzipped fixture seeded by migration with a search endpoint.

## Key Decisions
- All pickers switch to page mode (inline mode removed) — user chose "Wszystko na przekierowanie"; TermEditForm and FirstTermStepperOrganizer need draft persistence like events.
- Terms/events may use places without address (address recommended, not required).
- Data build script + committed fixture + README (source, licence, date); implementation downloads official GUS/GUGiK files.

## Initial description (user, Polish)
"chcę przy dodawaniu rzeczy dodać obowiązkową lokalizację, użyć tego samego elementu tu na terminach i event, gdzie '+' przekierowuje na stronę /places/new, jak to jest w term i event. Chcę poprawić dodawanie lokalizacji i dodać tylko 2 pola. Lokalizacja — obowiązkowa — wyciągnąć wszystkie lokalizacje takie jak są na OLX, czyli województwo i miasto, ale również po podaniu kodu lub nazwy wsi też się dodała; jak na OLX przy dodawaniu przedmiotu tylko nazwa, nie ma dokładnego adresu. Adres — opcjonalnie, potrzebny głównie dla terminów i eventów — żeby podać dokładną lokalizację."

## Q&A (all rounds)
Phase 1: per-item location; TERYT locality + Google address (OLX uses own GUS-based dictionary); drop Nazwa/Notatka; no legacy compat (MVP, DB wiped).
Phase 2 (see scope-clarifications.md): GUGiK PRG postal pairs; fixture + seeding migration; clear on transfer; backend+frontend enforcement; editable on item edit; locality public / address owner-only; pickup uses item location; remove inventory location card/API/column; item draft in AppDataContext; no coords for locality-only (Maps link by label); independent localities only, labels with gmina/powiat/woj; Google address biased to locality, no server check; allow soft delete of used places; ALWAYS create new places (no dedup); drop name/notes, computed label; item cards out of scope; migrations 0078 tables / 0079 seed / 0080 rework, delete old location rows.
Phase 5:
- One 2-field form everywhere (create /places/new and edit /places/:id/edit); terms/events accept places without address → Yes.
- Inline pickers (TermEditForm, FirstTermStepperOrganizer) → convert to page redirect too ("Wszystko na przekierowanie").
- Data: build script (e.g. scripts/build_localities.py) + committed gzipped fixture + README with source/licence/version → Yes.

## Similar features / reuse
- LocationPicker page mode + PlaceCreateView returnTo/picker + PickedLocationState (terms AddTermView, EventForm, GroupFormFields).
- AppDataContext drafts: eventDraft/eventBanner/eventEdit, termLocationId — pattern for itemDraft/itemPhotos and term edit/stepper drafts.
- 0069_vinted_categories.py + alembic/data/vinted_categories_pl.json — seeding pattern.
- LocationAddForm Google combobox (accessibility.md inline combobox rules) — reuse for both Locality (backend source) and Address (Google source).
- circulation locations_acl.get_owned_location — ownership check for item location_id.
- item_privacy / set_personalised_cache_headers patterns for owner-vs-viewer shapes.

## Visual assets
Binding mockups in analysis/design-context/ (INDEX.md): screen:place-create, screen:item-create, screen:item-edit, screen:item-page-location, screen:places-list.

## Functional requirements summary
1. Locality dictionary: tables for localities (TERYT SIMC id, name, kind town/village, gmina, powiat, województwo) and postal codes (code ↔ SIMC); seeded from committed fixture; public/authenticated search endpoint by name prefix or postal code, towns ranked first, limited results, labels with gmina/powiat/woj.
2. Locations: locality_id required; formatted_address optional (+ google_place_id/lat/lng only with address); name/notes dropped; computed label; no dedup; soft delete kept; create/edit form with exactly 2 fields.
3. Items: inventory_items.location_id required on create (owned live place), editable via PATCH and item edit page, nulled on ownership transfer; relisting/offering requires a live location.
4. Item page: everyone sees locality label + Maps link by label; owner also sees address; non-owners never receive address or address-derived text.
5. Personal pickup gated by item's live location; inventory location (card, API, column, hook) removed.
6. Pickers: required mode (no "none") for items; all pickers page mode; drafts preserved across /places/new for item create, item edit, event create/edit, term add, term edit, first-term stepper, group forms.
7. Display sites updated for nullable address and computed label (TermPlaceLine, buildMapsUrl, EventWhenCard, TermCard, GroupDetailsPage, GroupsView, ItemContextActions, AdminTermsPage, PlacesView, LocationPicker, publicMetadata, owner_items location_name).

## Scope boundaries
In: above. Out: locality on item cards/lists, city districts, coordinates for locality-only places, server-side address validation, legacy data migration.

## Technical considerations
- Migrations 0078/0079/0080 with plain downgrades and downgrade→upgrade tests; old location rows deleted.
- ~20 backend test files need a shared helper to create a place and pass location_id.
- GUGiK PRG licence must be checked during data prep; fallback: drop postal search.
- Fixture size estimate 1–3 MB gzipped.
