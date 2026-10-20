# UI Mockups: Załóż grupę (2-step) + LocationPicker + capacity surfaces

**Generated**: 2026-10-19
**Task Path**: `.maister/tasks/development/2026-10-19-simple-group-creation-and-locations`
**Feature Type**: Enhancement (restructured stepper, 6 forms gain a shared picker, 5 display surfaces gain location/capacity)

All frontend paths are relative to `src/frontend/src`. Every diagram is drawn at phone width (the panel `ModalSheet` is a 430 px bottom sheet; krag pages are a phone stage). Legend used in every diagram:

```
[NEW]   element that does not exist today
[MOD]   existing element whose copy, props or placement changes
(no tag) existing element reused unchanged
```

---

## Overview

### UI requirements (from task-description.md + scope-clarifications.md)

- "Załóż grupę" entry for every logged-in user: Home hint, Spotkania section header (in the panel), and the public-page hamburger (`AccountMenu`, deep link `/panel/spotkania?nowa=grupa`).
- 2-step stepper: step 1 = `GroupFormFields` (name, visibility, LocationPicker, capacity); step 2 = first term (date, description, LocationPicker prefilled, capacity prefilled); done screen with public link, "Gotowe" and an optional "Stwórz publiczną wizytówkę / własny adres" CTA to `/organization`.
- Shared `LocationPicker` rendered inline inside the existing sheets (never a nested panel sheet); states: empty, list, add-new (Google autocomplete), manual, inline edit.
- "Dodaj nową grupę" / "Edytuj grupę" modals use `GroupFormFields`; "Dodaj termin zajęć", `FirstTermStepperOrganizer`, `EditTermDialog` gain "Miejsce" + "Ile miejsc".
- HomeView: reworded hints, merged top-3 led + attended terms; term cards show place + Maps link + "X/Y miejsc".
- SpotkaniaView: sections "Prowadzę" / "Zapisane"; tiles show default place; "wolne N miejsc" chip removed.
- Public term page: location block under the date card, "Zapisanych X z Y", "Brak wolnych miejsc" (RSVP still active).
- AdminTermsPage: columns "Miejsce", "Miejsca" (rendered "3 / 10", never a bare number).
- Null location/capacity rows hidden, never "null".

### Integration strategy

**Decision**: every new input lives inside the sheets that already exist (`pages/panel/panelComponents.tsx` `ModalSheet` + `Field`), the picker is an inline block (a `role="radiogroup"` list plus a disclosure), and every display surface extends the card/section it already has (`organizerTermCard`, guest `Link` card, `pages/krag/components/TermCard.tsx`, Spotkania tile, `AdminTable` row).

**Rationale**: the panel `ModalSheet` has no focus trap or Esc handling, so stacking a second sheet on it would be inaccessible; inline disclosure matches the "+ Dodaj potrzebną rzecz" pattern already used in the term modal and `EditTermDialog`. Users already look for group/term details on these cards; adding a second line keeps the mental model "card = one meeting".

---

## Existing layout analysis

### Application structure

- Panel (`pages/panel/PanelPage.tsx`, `PanelNav.tsx`): phone-first single column, header with greeting + `NotificationBell` only — there is NO hamburger inside the panel. `AccountMenu` (the hamburger) is rendered only by `components/layout/PublicLayout.tsx:36` on public pages (item, public term, organization pages); `/panel` routes are siblings of that layout (`router.tsx:78-102`). Views `HomeView` / `SpotkaniaView` / … and modals in `pages/panel/PanelModals.tsx` driven by `ModalKind` (`pages/panel/panelHelpers.ts:24-32`).
- Public term page (`pages/krag/PublicTermView.tsx`): `GroupHeader` -> `GroupVisualization` -> `TermCard` -> `NeededItemsSection` -> `AttendeeList` -> sticky `TermFooter` (RSVP).
- Admin (`pages/AdminTermsPage.tsx`): Chakra `AdminTable` (`components/shared/AdminTable.tsx`) with string column headers.

### Key components reused

| Component | Path | Used for |
|---|---|---|
| panel `ModalSheet` | `pages/panel/panelComponents.tsx:167` | every panel form (stepper, group/term modals, EditTermDialog) |
| `Field` | `pages/panel/panelComponents.tsx:158` | label + control wrapper; `inputClass` = `rounded-xl border-[1.5px] border-line bg-cream px-3.5 py-2.5 text-ink` |
| `HintCard` | `pages/panel/panelComponents.tsx:107` | Home nudges (icon, title, description, ctaLabel, `ctaTo` or `onCtaClick`, dismiss) |
| `FloatingAddButton` | `pages/panel/panelComponents.tsx` | Spotkania FAB "Dodaj termin" |
| `organizerTermCard` / `signupSummaryChip` | `pages/panel/PanelDataContext.tsx:851 / 818` | led-term card (date badge, name link, copy + pencil buttons, signup chip) |
| guest term card | `pages/panel/views/HomeView.tsx:134-163`, `SpotkaniaView.tsx:287-321` | attended-term `Link` card |
| `TermCard` | `pages/krag/components/TermCard.tsx` | public date card (`section aria-label="Termin zajęć"`) |
| `GroupHeader`, `TermFooter` | `pages/krag/components/` | header, RSVP footer |
| `AdminTable` | `components/shared/AdminTable.tsx` | Chakra table shell |
| `AccountMenu` | `components/shared/AccountMenu.tsx` | hamburger `role="menu"` with `Link role="menuitem"` rows |
| radiogroup precedent | `pages/organizer/editor/ColorsTab.tsx:53` (`role="radiogroup"` + `role="radio"` buttons, roving tabIndex) | LocationPicker saved-places list |
| inline edit/delete row precedent | `components/panel/EditTermDialog.tsx:329-400` ("Edytuj"/"Usuń" text buttons with `aria-label`, inline edit form with "Zapisz"/"Anuluj") | LocationPicker row actions |
| disclosure precedent | `PanelModals.tsx:322-370` "+ Dodaj potrzebną rzecz" -> inline form + "Zwiń" | LocationPicker "+ Dodaj nowe miejsce" |
| `DeleteGroupDialog` | `pages/panel/DeleteGroupDialog.tsx` | pattern for the delete-location confirm (hand-rolled alertdialog) |
| icons | `pages/panel/panelIcons.tsx` (`PencilIcon`, `TrashIcon`, `CopyIcon`, `BuildingIcon`, `CalendarPlusIcon`, `FamilyIcon`) | row buttons, hint icons, hamburger item (add a `MapPinIcon`/`UsersIcon` here if none exists) |

### Identified patterns

- Primary button: `rounded-[13px] bg-mint px-5 py-3 text-[13.5px] font-extrabold text-white disabled:opacity-60`; secondary: `border-[1.5px] border-line … text-ink-soft`.
- Errors: `<p role="alert" className="mt-2 text-[12.5px] font-semibold text-danger">`.
- Stepper progress: row of `h-1.5 w-1.5` dots, `aria-hidden`.
- Two short fields side by side: `grid grid-cols-2 gap-3` (used for "Lokalizacja"/"Ile miejsc" today).
- Done screens: paragraph + full-width mint `Link` + full-width bordered "Gotowe".
- Public page sections: `mx-5 mt-6 rounded-3xl border border-line bg-paper p-4`.

---

## Mockups

<a id="stepper-step1"></a>
### Mockup 1a: Stepper "Załóż grupę" – step 1 (group)

**Context**: opened from Home hint, Spotkania "+ Załóż grupę", hamburger (`/panel/spotkania?nowa=grupa`), replaces `FirstTermStepperGuest` steps `organization` + `1`. Host: panel `ModalSheet`, title `[MOD]` "Załóż grupę" (was "Zostań organizatorem" / "Dodaj pierwszy termin").

```
┌──────────────────────────────────────────────┐
│ Załóż grupę                              (×) │  ModalSheet title [MOD] + close
│                  ● ○                         │  2 dots, aria-hidden (was 3 w/ org step)
│                                              │
│ ┌─ GroupFormFields [NEW shared] ───────────┐ │  components/panel/GroupFormFields.tsx
│ │ NAZWA GRUPY                              │ │  <Field label="Nazwa grupy">
│ │ ┌──────────────────────────────────────┐ │ │
│ │ │ np. Nutki dla starszaków             │ │ │  input -> name (required)
│ │ └──────────────────────────────────────┘ │ │
│ │                                          │ │
│ │ WIDOCZNOŚĆ GRUPY                         │ │  <select aria-label="Widoczność grupy">
│ │ ┌──────────────────────────────────────┐ │ │  default: PRIVATE if organizationSlug===null
│ │ │ Prywatna — (dostęp na prośbę)     ▾  │ │ │           PUBLIC  otherwise
│ │ └──────────────────────────────────────┘ │ │  options reuse PanelModals.tsx:170-185 copy
│ │                                          │ │
│ │ STAŁE MIEJSCE SPOTKAŃ (opcjonalnie)      │ │  <Field> wrapping LocationPicker [NEW]
│ │ ┌──────────────────────────────────────┐ │ │  see Mockups 2a-2e; value -> default_location_id
│ │ │ ( ) Brak stałego miejsca             │ │ │
│ │ │ (•) Świetlica na Polnej              │ │ │
│ │ │     ul. Polna 12, Poznań  Edytuj Usuń│ │ │
│ │ │ + Dodaj nowe miejsce                 │ │ │
│ │ └──────────────────────────────────────┘ │ │
│ │                                          │ │
│ │ ILE MIEJSC (opcjonalnie)                 │ │  <Field label="Ile miejsc">
│ │ ┌──────────┐                             │ │  input type=number min=1 inputMode=numeric
│ │ │ np. 12   │                             │ │  -> default_capacity (null when blank)
│ │ └──────────┘                             │ │
│ └──────────────────────────────────────────┘ │
│                                              │
│ [role=alert] Nie udało się…   (only on error)│  text-danger, same as today
│ ┌──────────────────────────────────────────┐ │
│ │               Dalej →                    │ │  primary; disabled until name.trim()
│ └──────────────────────────────────────────┘ │
└──────────────────────────────────────────────┘
```

**Data bound**: `name`, `visibility` (`"PRIVATE" | "PUBLIC"`), `default_location_id: string | null`, `default_capacity: number | null`. Submitted on "Dalej →" via `createAdditionalMyCircle` (`POST /api/groups/mine/new`), the result (`GroupResponse` with `default_location`, `default_capacity`) seeds step 2.

**Integration points**:
- Component: `components/panel/FirstTermStepperGuest.tsx` rewritten as the 2-step stepper (keep the file or rename to `CreateGroupStepper.tsx`; `PanelModals.tsx:63-104` mounts it for the merged `ModalKind` `"zaloz-grupe"`, replacing `"zostan-organizatorem"`).
- `GroupFormFields` is a controlled component: `value: {name, visibility, defaultLocationId, defaultCapacity}`, `onChange`, `showLayoutMode?` (edit modal only), `idPrefix` so labels stay unique when two forms mount.
- Capacity sits alone (not in a `grid-cols-2` with a text input) because the picker above it is full-width; a half-width number input matches the existing "Ile miejsc" sizing.

**A11y**: `Field` label text is visual only today (no `htmlFor`); give every input an `aria-label` equal to the label (precedent: `aria-label="Nazwa organizacji"`). Visibility `<select>` keeps `aria-label="Widoczność grupy"`. "(opcjonalnie)" is part of the visible label so screen readers hear it.

<a id="stepper-step2"></a>
### Mockup 1b: Stepper – step 2 (first term)

**Context**: after step 1 succeeds. Title stays "Załóż grupę"; dots show second active.

```
┌──────────────────────────────────────────────┐
│ Załóż grupę                              (×) │
│                  ○ ●                         │
│ Pierwszy termin w grupie „Nutki"             │  [NEW] eyebrow text-ink-soft, group name
│                                              │
│ DATA I GODZINA                               │  <Field> input type=datetime-local
│ ┌──────────────────────────────────────────┐ │  aria-label="Data i godzina" (unchanged)
│ │ 2026-10-24  17:00                        │ │  -> occurs_on
│ └──────────────────────────────────────────┘ │
│ OPIS (OPCJONALNIE)                           │  unchanged input -> description
│ ┌──────────────────────────────────────────┐ │
│ │ wstęp wolny                              │ │
│ └──────────────────────────────────────────┘ │
│ MIEJSCE                                 [NEW]│  <Field label="Miejsce"> + LocationPicker
│ ┌──────────────────────────────────────────┐ │  prefilled: selected = group.default_location.id
│ │ ( ) Brak miejsca                         │ │  (radio checked on mount)
│ │ (•) Świetlica na Polnej                  │ │
│ │     ul. Polna 12, Poznań    Edytuj  Usuń │ │
│ │ + Dodaj nowe miejsce                     │ │
│ └──────────────────────────────────────────┘ │
│ ILE MIEJSC                              [NEW]│  input number prefilled = default_capacity
│ ┌──────────┐                                 │  -> capacity
│ │ 12       │                                 │
│ └──────────┘                                 │
│                                              │
│ ┌──────────┐ ┌───────────────────────────────┐│
│ │ ← Wstecz │ │           Dodaj               ││  unchanged pair (Wstecz goes to step 1 with
│ └──────────┘ └───────────────────────────────┘│  the created group kept; step 1 then PATCHes)
└──────────────────────────────────────────────┘
```

**Data bound**: `createTerm({circle_group_id, occurs_on, description, location_id, capacity})`. Send `location_id: null` / `capacity: null` explicitly when the user cleared a prefilled value (backend inherits only on omission, scope-clarifications §2).

**Integration points**: fields "Data i godzina" and "Opis (opcjonalnie)" keep their exact labels (tests). "Miejsce" and "Ile miejsc" are placed after description, mirroring the group step order (place then capacity) so the prefill reads as "copied from above".

<a id="stepper-done"></a>
### Mockup 1c: Stepper – done screen

```
┌──────────────────────────────────────────────┐
│ Załóż grupę                              (×) │
│                                              │
│ Grupa założona, termin dodany! Tę stronę     │  [MOD] copy (no "krąg", no "organizator")
│ zobaczy każdy, kto dostanie link — bez       │
│ logowania.                                   │
│ ┌──────────────────────────────────────────┐ │
│ │    Przejdź do publicznej strony →        │ │  Link to termPublicPath(group, termId)
│ └──────────────────────────────────────────┘ │  = /${organizer_slug ?? "krag"}/grupa/…/term/…
│ ┌──────────────────────────────────────────┐ │
│ │                Gotowe                    │ │  secondary bordered, onDone (unchanged)
│ └──────────────────────────────────────────┘ │
│                                              │
│ ┌─ [NEW] optional next step ───────────────┐ │  only when organizationSlug === null
│ │ Chcesz publiczną wizytówkę i własny      │ │  bg-accent-soft rounded-2xl p-3.5 (HintCard
│ │ adres strony? Możesz ją stworzyć kiedy   │ │  tone, but without the dismiss ×)
│ │ chcesz.                                  │ │
│ │ Stwórz publiczną wizytówkę / własny      │ │  Link to "/organization" (text link, like
│ │ adres →                                  │ │  HintCard cta class), calls onDone first
│ └──────────────────────────────────────────┘ │
└──────────────────────────────────────────────┘
```

**Integration points**: CTA is a plain `Link`, no organization code inside the stepper (scope-clarifications §6). Order: primary action, "Gotowe", then the soft upsell — the upsell must not compete with the public link. Hidden entirely when the user already has an Organization.

**A11y**: the done sheet's first focusable is the public-page link; the `ModalSheet` label stays "Załóż grupę".

---

<a id="location-picker"></a>
### Mockup 2: `LocationPicker` (shared, inline)

**File**: `components/shared/LocationPicker.tsx` (+ `api/locations.ts`, `hooks/useMyLocations.ts`, `lib/googleMaps.ts`). Props: `value: string | null`, `onChange(id | null)`, `label` (for `aria-label` of the radiogroup), `noneLabel` ("Brak stałego miejsca" / "Brak miejsca"), `idPrefix`. Always rendered inside a host `Field`. It never opens a sheet of its own.

<a id="location-picker-empty"></a>
#### 2a: empty state (no saved places)

```
┌─ Field "Stałe miejsce spotkań" ──────────────┐
│ Nie masz jeszcze zapisanych miejsc.          │  text-ink-soft 12.5px
│ ┌──────────────────────────────────────────┐ │
│ │ 🔍 Szukaj adresu lub nazwy miejsca…      │ │  [NEW] search input, shown immediately
│ └──────────────────────────────────────────┘ │  role=combobox (see 2c)
│ wpisz ręcznie                                │  [NEW] text button toggles manual mode (2d)
│                                              │
│ (hidden none/radio list — nothing to pick)   │  value stays null; "Brak miejsca" implied
└──────────────────────────────────────────────┘
```

When `VITE_GOOGLE_MAPS_API_KEY` is absent the search input is not rendered and the manual form (2d) is shown directly, without the toggle.

<a id="location-picker-list"></a>
#### 2b: list state with a selection

```
┌─ Field "Miejsce" ────────────────────────────┐
│ role=radiogroup aria-label="Miejsce"         │  ul/li list, precedent ColorsTab radiogroup
│ ┌──────────────────────────────────────────┐ │
│ │ ( )  Brak miejsca                        │ │  role=radio aria-checked=false -> onChange(null)
│ ├──────────────────────────────────────────┤ │
│ │ (•)  Świetlica na Polnej                 │ │  role=radio aria-checked=true (ring-2 ring-ink)
│ │      ul. Polna 12, 60-595 Poznań         │ │  name (bold) + formatted_address (ink-soft)
│ │      wejście od podwórza                 │ │  notes line only when non-null
│ │                         [Edytuj] [Usuń]  │ │  aria-label="Edytuj miejsce Świetlica na Polnej"
│ ├──────────────────────────────────────────┤ │  aria-label="Usuń miejsce Świetlica na Polnej"
│ │ ( )  Park Sołacki                        │ │
│ │      Park Sołacki, Poznań                │ │
│ │                         [Edytuj] [Usuń]  │ │
│ ├──────────────────────────────────────────┤ │
│ │ ( )  Sala nr 2 (usunięte)                │ │  [edge] selected id absent from /mine:
│ │      ul. Stara 1, Poznań                 │ │  rendered from group/term.location, no buttons
│ └──────────────────────────────────────────┘ │
│ + Dodaj nowe miejsce                         │  disclosure button (aria-expanded), like
└──────────────────────────────────────────────┘  "+ Dodaj potrzebną rzecz"
```

**Interaction**: the row is one `role="radio"` button (name + address + notes inside it); "Edytuj"/"Usuń" are sibling buttons outside the radio so they are not nested interactive content. Arrow keys move between radios (roving `tabIndex`, copy `handleKeyDown` from `ColorsTab`). "Usuń" opens a confirm (pattern `DeleteGroupDialog`) then `DELETE /api/locations/{id}`; if the deleted row was selected, selection moves to "Brak miejsca" and focus to the next row (precedent `PhotosTab`).

<a id="location-picker-add"></a>
#### 2c: add new (Google Places Autocomplete)

```
┌─ Field "Miejsce" ────────────────────────────┐
│ (radiogroup as in 2b, collapsed below)       │
│ – Dodaj nowe miejsce                 (zwiń)  │  aria-expanded=true
│ ┌──────────────────────────────────────────┐ │
│ │ 🔍 pol▌                                  │ │  input role=combobox aria-autocomplete=list
│ └──────────────────────────────────────────┘ │  aria-expanded aria-controls=…-listbox
│ ┌──────────────────────────────────────────┐ │  aria-activedescendant=…-opt-1
│ │ ▸ Polna 12, Poznań                       │ │  [NEW] own listbox rendered IN the sheet
│ │   Świetlica Osiedlowa, Polna 12, Poznań  │ │  (AutocompleteService / Places API New
│ │   Polanka 3, Poznań                      │ │   fetched with a session token, NOT the
│ └──────────────────────────────────────────┘ │   Google widget's pac-container)
│ wpisz ręcznie                                │  toggle -> 2d
└──────────────────────────────────────────────┘
          │ pick suggestion (Enter / click)
          ▼
┌─ Field "Miejsce" ────────────────────────────┐
│ – Dodaj nowe miejsce                 (zwiń)  │
│ Polna 12, 60-595 Poznań          [zmień]     │  chosen address (read-only line) + reset
│ NAZWA (ETYKIETA)                             │  input aria-label="Nazwa miejsca", required,
│ ┌──────────────────────────────────────────┐ │  prefilled with the place name
│ │ Świetlica na Polnej                      │ │
│ └──────────────────────────────────────────┘ │
│ NOTATKA (OPCJONALNIE)                        │  input aria-label="Notatka" -> notes
│ ┌──────────────────────────────────────────┐ │
│ │ wejście od podwórza                      │ │
│ └──────────────────────────────────────────┘ │
│ ┌──────────────────┐ ┌───────┐              │  "Zapisz miejsce" (rowSaveBtn style) /
│ │ Zapisz miejsce   │ │Anuluj │              │  "Anuluj" (rowCancelBtn), both small pills
│ └──────────────────┘ └───────┘              │
└──────────────────────────────────────────────┘
```

**Data**: `POST /api/locations {name, formatted_address, google_place_id, lat, lng, notes, source:"GOOGLE"}`; before posting, if `google_place_id` already exists in the loaded list, select that row instead (scope-clarifications §5). On 200/201 the new row is appended, selected, and the disclosure collapses; focus moves to the new radio.

**A11y (binding)**:
- The suggestions list is our own `role="listbox"` so it stays inside the sheet DOM (focus trap of krag `ModalSheet`, where applicable, keeps working; panel sheet has none).
- `Esc` while the listbox is open: close the listbox and `event.preventDefault()` + `stopPropagation()` so the host sheet (krag `ModalSheet` checks `defaultPrevented`) does not close. Second `Esc` closes the sheet as usual.
- `ArrowDown/ArrowUp` move `aria-activedescendant`; `Enter` picks; typing restarts the debounced (300 ms) query. No request before the first keystroke (session-token cost rule).
- Loading the Maps script happens on first focus of the search input; while loading, the input shows `aria-busy="true"` and the placeholder "Ładowanie wyszukiwarki…"; on script failure fall back to 2d with a `role="alert"` note "Wyszukiwarka niedostępna — wpisz adres ręcznie".

<a id="location-picker-manual"></a>
#### 2d: manual mode

```
┌─ Field "Miejsce" ────────────────────────────┐
│ – Dodaj nowe miejsce                 (zwiń)  │
│ NAZWA (ETYKIETA)                             │  aria-label="Nazwa miejsca"  required
│ ┌──────────────────────────────────────────┐ │
│ │ Sala nr 2                                │ │
│ └──────────────────────────────────────────┘ │
│ ADRES                                        │  aria-label="Adres"  required (non-blank)
│ ┌──────────────────────────────────────────┐ │  -> formatted_address
│ │ ul. Szkolna 5, 60-001 Poznań             │ │
│ └──────────────────────────────────────────┘ │
│ NOTATKA (OPCJONALNIE)                        │  -> notes
│ ┌──────────────────────────────────────────┐ │
│ │ I piętro, drzwi po lewej                 │ │
│ └──────────────────────────────────────────┘ │
│ [role=alert] Podaj adres     (on validation) │
│ ┌──────────────────┐ ┌───────┐              │
│ │ Zapisz miejsce   │ │Anuluj │   szukaj     │  "szukaj w Google" link back to 2c only
│ └──────────────────┘ └───────┘   w Google   │  when a key is configured
└──────────────────────────────────────────────┘
```

**Data**: `POST /api/locations {name, formatted_address, notes, source:"MANUAL"}` (no place_id, no coordinates). Maps link later built from the address.

<a id="location-picker-edit"></a>
#### 2e: inline edit row

```
┌─ Field "Miejsce" ────────────────────────────┐
│ ( )  Brak miejsca                            │
│ ┌──────────────────────────────────────────┐ │  the edited li swaps its radio for a form
│ │ NAZWA (ETYKIETA)                         │ │  (precedent EditTermDialog.tsx:338-361)
│ │ ┌──────────────────────────────────────┐ │ │
│ │ │ Świetlica na Polnej                  │ │ │  editable: name, notes;
│ │ └──────────────────────────────────────┘ │ │  formatted_address editable only when
│ │ ADRES                                    │ │  source === "MANUAL" (Google rows show the
│ │ ul. Polna 12, 60-595 Poznań (z Google)   │ │  address as read-only text)
│ │ NOTATKA (OPCJONALNIE)                    │ │
│ │ ┌──────────────────────────────────────┐ │ │
│ │ │ wejście od podwórza                  │ │ │
│ │ └──────────────────────────────────────┘ │ │
│ │ ┌────────┐ ┌───────┐                     │ │  "Zapisz" / "Anuluj" small pills;
│ │ │ Zapisz │ │Anuluj │                     │ │  PATCH /api/locations/{id}
│ │ └────────┘ └───────┘                     │ │
│ └──────────────────────────────────────────┘ │
│ ( )  Park Sołacki …            [Edytuj][Usuń]│
│ + Dodaj nowe miejsce                         │
└──────────────────────────────────────────────┘
```

**A11y**: on "Edytuj" focus moves to the name input; on save/cancel focus returns to that row's "Edytuj" button. Edit errors use `role="alert"` under the row. Only one row edits at a time (`editingId` state, as `EditTermDialog`).

---

<a id="group-form-modals"></a>
### Mockup 3: "Dodaj nową grupę" / "Edytuj grupę" with `GroupFormFields`

**Context**: `PanelModals.tsx:139-198` (`modal === "grupa"`) and `:201-279` (`"edit-grupa"`). Both replace their inline `Nazwa grupy` / `Lokalizacja` / `Ile miejsc` / selects with `<GroupFormFields>`; the edit modal additionally keeps "Szablon wizualizacji".

```
┌──────────────────────────────────────────────┐   ┌──────────────────────────────────────────────┐
│ Dodaj nową grupę                         (×) │   │ Edytuj grupę                             (×) │
│                                              │   │                                              │
│ NAZWA GRUPY                                  │   │ NAZWA GRUPY                                  │
│ ┌──────────────────────────────────────────┐ │   │ ┌──────────────────────────────────────────┐ │
│ │ np. Nutki dla starszaków                 │ │   │ │ Nutki                                    │ │
│ └──────────────────────────────────────────┘ │   │ └──────────────────────────────────────────┘ │
│ WIDOCZNOŚĆ GRUPY                             │   │ SZABLON WIZUALIZACJI    (edit only, unchanged)│
│ ┌──────────────────────────────────────────┐ │   │ ┌──────────────────────────────────────────┐ │
│ │ Publiczna                             ▾  │ │   │ │ Boisko                                ▾  │ │
│ └──────────────────────────────────────────┘ │   │ └──────────────────────────────────────────┘ │
│ STAŁE MIEJSCE SPOTKAŃ (OPCJONALNIE)     [MOD]│   │ WIDOCZNOŚĆ GRUPY                             │
│ ┌──────────────────────────────────────────┐ │   │ ┌──────────────────────────────────────────┐ │
│ │ (•) Brak stałego miejsca                 │ │   │ │ Prywatna — tylko stali członkowie     ▾  │ │
│ │ ( ) Świetlica na Polnej                  │ │   │ └──────────────────────────────────────────┘ │
│ │     ul. Polna 12, Poznań    Edytuj  Usuń │ │   │ STAŁE MIEJSCE SPOTKAŃ (OPCJONALNIE)     [MOD]│
│ │ + Dodaj nowe miejsce                     │ │   │ ┌──────────────────────────────────────────┐ │
│ └──────────────────────────────────────────┘ │   │ │ ( ) Brak stałego miejsca                 │ │
│ ILE MIEJSC (OPCJONALNIE)                [MOD]│   │ │ (•) Świetlica na Polnej …   Edytuj  Usuń │ │
│ ┌──────────┐                                 │   │ │ + Dodaj nowe miejsce                     │ │
│ │          │                                 │   │ └──────────────────────────────────────────┘ │
│ └──────────┘                                 │   │ ILE MIEJSC (OPCJONALNIE)                [MOD]│
│ [role=alert] …                               │   │ ┌──────────┐                                 │
│ ┌──────────────────────────────────────────┐ │   │ │ 12       │                                 │
│ │              Dodaj grupę                 │ │   │ └──────────┘                                 │
│ └──────────────────────────────────────────┘ │   │ ┌──────────────────────────────────────────┐ │
└──────────────────────────────────────────────┘   │ │                 Zapisz                   │ │
                                                   │ └──────────────────────────────────────────┘ │
                                                   └──────────────────────────────────────────────┘
```

**Data bound**:
- Add: `createAdditionalMyCircle({name, visibility, default_location_id, default_capacity})`. Default visibility computed the same way as the stepper (PRIVATE without Organization, PUBLIC with).
- Edit: PATCH `/api/groups/{id}` with `{name, layout_mode, visibility, default_location_id, default_capacity}` — send `null` to clear (scope-clarifications §1). Initial values from `group.default_location?.id`, `group.default_capacity` (no more `groupExtras`).

**Integration points**: field order "Nazwa -> Widoczność -> Miejsce -> Ile miejsc" is identical in the stepper and both modals (one component). "Lokalizacja" label is replaced by "Stałe miejsce spotkań" everywhere (the existing test asserting "Lokalizacja" absent in edit-group keeps passing; tests asserting it present in add-group need the new label).

---

<a id="term-forms"></a>
### Mockup 4: Term forms – "Dodaj termin zajęć", `FirstTermStepperOrganizer`, `EditTermDialog`

**Context**: `PanelModals.tsx:282-374` (`"termin"`), `components/panel/FirstTermStepperOrganizer.tsx:76-110`, `components/panel/EditTermDialog.tsx:283-327`.

```
┌──────────────────────────────────────────────┐
│ Dodaj termin zajęć                       (×) │
│ GRUPA                                        │  <select> over led groups only (was
│ ┌──────────────────────────────────────────┐ │  relevantGroupsForForm) — on change,
│ │ Nutki                                 ▾  │ │  prefill Miejsce + Ile miejsc from
│ └──────────────────────────────────────────┘ │  group.default_location / default_capacity
│ DATA I GODZINA                               │  unchanged
│ ┌──────────────────────────────────────────┐ │
│ │ 2026-10-24 17:00                         │ │
│ └──────────────────────────────────────────┘ │
│ OPIS (OPCJONALNIE)                           │  unchanged
│ ┌──────────────────────────────────────────┐ │
│ │ Park Sołacki · wstęp wolny               │ │
│ └──────────────────────────────────────────┘ │
│ MIEJSCE                                 [NEW]│  LocationPicker, noneLabel "Brak miejsca"
│ ┌──────────────────────────────────────────┐ │  prefilled from the selected group;
│ │ ( ) Brak miejsca                         │ │  helper text under the list when prefilled:
│ │ (•) Świetlica na Polnej …   Edytuj  Usuń │ │  "Domyślne miejsce grupy — możesz zmienić"
│ │ + Dodaj nowe miejsce                     │ │  (text-ink-soft 12px)
│ └──────────────────────────────────────────┘ │
│ ILE MIEJSC                              [NEW]│  number, prefilled default_capacity
│ ┌──────────┐                                 │
│ │ 12       │                                 │
│ └──────────┘                                 │
│ POTRZEBNE RZECZY (OPCJONALNIE)               │  unchanged needed-items draft block
│ + Dodaj potrzebną rzecz                      │
│ ┌──────────────────────────────────────────┐ │
│ │              Dodaj termin                │ │  unchanged
│ └──────────────────────────────────────────┘ │
└──────────────────────────────────────────────┘
```

`FirstTermStepperOrganizer` (one step, `myGroups[0]`): same fields as above minus "Grupa" and needed items — order "Data i godzina", "Opis (opcjonalnie)", "Miejsce", "Ile miejsc", button "Dodaj termin"; labels unchanged so `FirstTermStepperOrganizer.test.tsx` only needs the query wrapper and the `../api/locations` mock. Done screen as today (`:50-73`).

```
┌──────────────────────────────────────────────┐
│ Edytuj termin                            (×) │  EditTermDialog
│ DATA I GODZINA        ┌──────────────────┐   │  unchanged
│ OPIS                  └──────────────────┘   │  unchanged
│ MIEJSCE                                 [NEW]│  LocationPicker; initial = term.location?.id
│ ┌──────────────────────────────────────────┐ │  (the TERM's value, not the group default)
│ │ ( ) Brak miejsca                         │ │  a soft-deleted term.location renders as the
│ │ (•) Sala nr 2 (usunięte)                 │ │  "(usunięte)" row (2b edge)
│ │ ( ) Świetlica na Polnej …   Edytuj  Usuń │ │
│ │ + Dodaj nowe miejsce                     │ │
│ └──────────────────────────────────────────┘ │
│ ILE MIEJSC                              [NEW]│  initial = term.capacity
│ ┌──────────┐                                 │
│ │ 10       │                                 │
│ └──────────┘                                 │
│ [role=alert] …  /  Zapisano                  │  existing feedback line
│ ┌──────────────────────────────────────────┐ │
│ │                 Zapisz                   │ │  saveTermFields diff-PATCH extended with
│ └──────────────────────────────────────────┘ │  location_id / capacity (null to clear)
│ Potrzebne rzeczy                             │  unchanged section
│ …                                            │
└──────────────────────────────────────────────┘
```

**Data bound**: `CreateTermRequest {…, location_id?, capacity?}`, `UpdateTermRequest {occurs_on?, description?, location_id?: string|null, capacity?: number|null}`. The "Zapisz" diff only includes changed keys; clearing sends `null`.

---

<a id="home-view"></a>
### Mockup 5: HomeView – reworded hints + merged top-3 term cards

**Context**: `pages/panel/views/HomeView.tsx:70-119` (hints) and `:122-165` (cards). Hint matrix after the change (each still dismissible per account via `hintKey`):

| Condition | Hint title | CTA | Target |
|---|---|---|---|
| `myGroups.length === 0` | "Załóż grupę" | "Zacznijmy →" | `setModal("zaloz-grupe")` |
| `myGroups.length > 0 && organizationSlug === null` | "Stwórz wizytówkę" | "Przejdź →" | `ctaTo="/organization"` |
| `myGroups.length > 0 && organizationSlug !== null` | "Dopracuj stronę organizacji" (unchanged) | "Przejdź →" | `/${slug}?edit=1` |
| `myGroups.length > 0 && led terms === 0` | "Dodaj swój pierwszy termin" (unchanged) | "Dodaj termin →" | `FirstTermStepperOrganizer` |

```
┌──────────────────────────────────────────────┐
│ Cześć, Ania!                            🔔   │  PanelPage header: greeting + NotificationBell
│                                              │  (no hamburger in the panel; AccountMenu is a
│                                              │   public-page element — see Mockup 7)
│                                              │
│ ┌─ HintCard [MOD] ─────────────────────────┐ │  icon CalendarPlusIcon
│ │ ▣  Załóż grupę                       (×) │ │  title "Załóż grupę" (was "Dodaj swój
│ │    Zbierz znajomych lub rodziny i ustal  │ │  pierwszy termin" / "Możesz zostać
│ │    pierwsze spotkanie — bez zakładania   │ │  organizatorem"); aria-label on × =
│ │    organizacji.                          │ │  "Zamknij: Załóż grupę"
│ │    Zacznijmy →                           │ │  onCtaClick -> setModal("zaloz-grupe")
│ └──────────────────────────────────────────┘ │
│ ┌─ HintCard [MOD] (has groups, no org) ────┐ │  icon BuildingIcon
│ │ ▣  Stwórz wizytówkę                  (×) │ │  description "Publiczna strona z własnym
│ │    Publiczna strona z własnym adresem    │ │  adresem dla Twoich grup." ctaTo=/organization
│ │    dla Twoich grup.      Przejdź →       │ │
│ └──────────────────────────────────────────┘ │
│                                              │
│ Najbliższe terminy            Zobacz wszystkie│  unchanged section header
│ ┌─ organizerTermCard [MOD] (led) ──────────┐ │  PanelDataContext.tsx:851
│ │ ┌────┐ Nutki                     [⧉] [✎]│ │  date badge, name Link, copy + edit buttons
│ │ │ 24 │ godz. 17:00 · wstęp wolny         │ │
│ │ │PAŹ │ 📍 Świetlica na Polnej       [NEW]│ │  TermPlaceLine: name (bold) …
│ │ └────┘    ul. Polna 12, Poznań           │ │  … address (ink-soft) …
│ │           Otwórz w Google Maps ↗         │ │  … external link target=_blank rel=noopener
│ │        ⚑ 3 zapisy · 4 dzieci › [MOD chip]│ │  signupSummaryChip + " · 3/12 miejsc"
│ │        (piłka) (koc)                     │ │  needed-item pills unchanged
│ └──────────────────────────────────────────┘ │
│ ┌─ guest Link card [MOD] (attended) ───────┐ │  HomeView.tsx:134-163
│ │ ┌────┐ Zumba dla mam                     │ │  whole card is a Link to the public term
│ │ │ 26 │ godz. 18:30 · sala B              │ │
│ │ │PAŹ │ 📍 Dom Kultury              [NEW] │ │  TermPlaceLine without the Maps link as a
│ │ └────┘    ul. Długa 3, Poznań            │ │  nested <a> (invalid HTML): address only;
│ │           8/10 miejsc              [NEW] │ │  the public page carries the Maps link
│ └──────────────────────────────────────────┘ │  (attendee_count/capacity from MyAttendanceResponse)
│ ┌─ guest Link card (membership-only) ──────┐ │  same card for a guestCircles term the user
│ │ ┌────┐ Rowerki                           │ │  has not RSVPed (TermResponse + GroupResponse,
│ │ │ 28 │ godz. 10:00                       │ │  fetched via getTerms as today)
│ │ │PAŹ │ 📍 Park Sołacki · Poznań          │ │  TermPlaceLine from term.location
│ │ └────┘    10 miejsc                      │ │  "Y miejsc" only (no count for non-organizers)
│ └──────────────────────────────────────────┘ │
│                                              │  top-3 merged: led + attended + membership-
│                                              │  only, sorted by occurs_on, deduped by term id
│                                              │  (led > attended > membership-only)
│ Zapisane zajęcia   │  Zadeklarowane rzeczy   │  lower sections; "Zapisane zajęcia" omits
│                                              │  attendances already shown in the top-3
└──────────────────────────────────────────────┘
```

**Integration points**:
- New `TermPlaceLine` (suggested `components/shared/TermPlaceLine.tsx`): props `location: {name, formatted_address, google_place_id, notes} | null`, `capacity`, `attendeeCount`, `withMapLink`. Renders nothing when `location` is null and capacity is null. Maps URL: `https://www.google.com/maps/search/?api=1&query=<encoded address>&query_place_id=<id>` (omit the id param for MANUAL).
- Capacity text: `"X/Y miejsc"` when both `attendee_count` and `capacity` are known; `"Y miejsc"` when only capacity (attended cards from `MyAttendanceResponse` have no count); nothing when capacity is null.
- The led card appends " · X/Y miejsc" inside the existing `signupSummaryChip` so there is one status pill per card; the attended card uses a small `bg-cream` pill of its own.

**A11y**: pin glyph is `aria-hidden`; Maps link text is the full "Otwórz w Google Maps" (plus `aria-label="Otwórz Świetlica na Polnej w Google Maps"`), never icon-only. On the attended card (a `Link`), no nested anchor.

---

<a id="spotkania-view"></a>
### Mockup 6: SpotkaniaView – "Prowadzę" and "Zapisane"

**Context**: `pages/panel/views/SpotkaniaView.tsx:158-274` (organizer branch) and `:276-324` (guest branch) merge into one page with two sections; the `isOrganizer` branches disappear.

```
┌──────────────────────────────────────────────┐
│ Spotkania                                    │  h1 unchanged
│                                              │
│ Prowadzę · 2              [+ Załóż grupę]    │  [MOD] section h2 (was "Grupy"); button
│                                              │  label "+ Załóż grupę" when myGroups.length
│ ┌──────────────┐ ┌──────────────┐            │  === 0 (opens stepper) else "+ Dodaj grupę"
│ │ ◎       ✎ 🗑 │ │ ◎       ✎ 🗑 │            │  (opens "grupa" modal); always rendered
│ │              │ │              │            │
│ │ Nutki        │ │ Rowerki      │            │  tile unchanged except the lines below:
│ │ Świetlica na │ │ 3 terminy    │            │  small = group.default_location?.name
│ │ Polnej  [MOD]│ │              │            │  ?? "<n> terminów" (was groupExtras)
│ │ ul. Polna 12 │ │              │            │  [NEW] second small line: address, truncate
│ └──────────────┘ └──────────────┘            │  "wolne N miejsca" chip REMOVED
│ (empty: "Nie masz jeszcze żadnej grupy.      │  EMPTY copy + the button above
│  Załóż pierwszą, żeby dodać termin.")        │
│                                              │
│ Terminy · 2 nadchodzące                      │  unchanged header, led terms only
│ ┌─ organizerTermCard [MOD] ────────────────┐ │  same card as Mockup 5 (place line + chip)
│ │ ┌────┐ Nutki                     [⧉] [✎]│ │
│ │ │ 24 │ godz. 17:00 · wstęp wolny         │ │
│ │ │PAŹ │ 📍 Świetlica na Polnej            │ │
│ │ └────┘    ul. Polna 12, Poznań           │ │
│ │           Otwórz w Google Maps ↗         │ │
│ │        ⚑ 3 zapisy · 4 dzieci · 3/12 › ›  │ │
│ └──────────────────────────────────────────┘ │
│                                              │
│ Zapisane · 2                            [NEW]│  section h2: my RSVPs (myAttendances) PLUS
│                                              │  terms of guestCircles (family memberships,
│                                              │  getTerms as today), deduped by term id
│                                              │  (led > attended > membership-only)
│ ┌─ guest Link card [MOD] ──────────────────┐ │  attended card, as SpotkaniaView.tsx:287
│ │ ┌────┐ Zumba dla mam                     │ │
│ │ │ 26 │ godz. 18:30 · sala B              │ │
│ │ │PAŹ │ 📍 Dom Kultury · ul. Długa 3      │ │  address only (no nested link)
│ │ └────┘    8/10 miejsc                    │ │
│ └──────────────────────────────────────────┘ │
│ ┌─ guest Link card (membership-only) ──────┐ │  guestCircles term without my RSVP:
│ │ ┌────┐ Rowerki                           │ │  TermResponse.location/capacity,
│ │ │ 28 │ godz. 10:00 · 📍 Park Sołacki     │ │  "Y miejsc" pill (no count), link via
│ │ └────┘    10 miejsc                      │ │  termPublicPath(group, term.id)
│ └──────────────────────────────────────────┘ │
│ (empty: "Nie masz jeszcze zapisów na zajęcia.")│
│                                              │
│                                    (+ Dodaj  │  FloatingAddButton "Dodaj termin" shown only
│                                      termin) │  when myGroups.length > 0
└──────────────────────────────────────────────┘
```

**Integration points**: `DeleteGroupDialog` mount and `TermList` usage unchanged. A term the user both leads and attends appears once, under "Prowadzę" (dedupe by term id). Section order: Prowadzę (groups + terms) first because it holds the actions; Zapisane second.

**A11y**: both section headings are `h2`; "+ Załóż grupę" stays a real `button` with visible text (no icon-only). Group tile `aria-label`s unchanged ("Edytuj grupę X", "Usuń grupę X").

---

<a id="account-menu"></a>
### Mockup 7: AccountMenu – "Załóż grupę"

**Context**: `components/shared/AccountMenu.tsx:55-75`, rendered ONLY by `components/layout/PublicLayout.tsx:36` — i.e. on public pages (item pages, public term pages, organization pages), never inside `/panel`. The menu is outside `PanelDataContext`, so the item is a `Link` that deep-links into the panel.

```
   (public page header, e.g. /:slug/grupa/…/term/…)
                                    ┌──────────────────────┐
                                ☰ ▸ │ ⌂  Mój panel         │  (existing item; menu itself exists
                                    │                      │   only on public pages)
                                    │ ☺  Profil            │
                                    │ ⚙  Ustawienia        │
                                    │ ＋ Załóż grupę  [NEW]│  Link role=menuitem
                                    │ ▦  Moja organizacja  │  to="/panel/spotkania?nowa=grupa"
                                    │ ⌂  Mój dom           │  icon: CalendarPlusIcon (exists) or a
                                    │ (extraItems)         │  new UsersIcon in panelIcons.tsx
                                    └──────────────────────┘
```

**Integration points**: placed between "Ustawienia" and "Moja organizacja" so the two "create something" items sit together, after the account items. `pages/panel/PanelPage.tsx` (`PanelPageView`, inside `PanelDataProvider`) reads `?nowa=grupa` (via `useSearchParams`), calls `setModal("zaloz-grupe")` once and strips the param. Unconditional for every logged-in user (same reasoning as the existing comment above "Moja organizacja"). Inside the panel the equivalent entries are the Home hint (Mockup 5) and the Spotkania "+ Załóż grupę" button (Mockup 6); the panel header gets no menu.

**A11y**: `role="menuitem"` on the `Link`, `onClick={close}`, same `ACCOUNT_MENU_ITEM_CLASS`. Menu-count assertions in `PublicLayout.test.tsx` / `Sidebar*.test.tsx` shift by one; `PublicLayout.test.tsx` asserts the new item's href. The 6 baseline-failing "hamburger promotion" tests in `PanelPage.test.tsx:397-445` are deleted (the panel has no menu button); the `?nowa=grupa` landing is tested with `renderPanel("/panel/spotkania?nowa=grupa")`.

---

<a id="public-term-page"></a>
### Mockup 8: Public term page – location block + capacity line

**Context**: `pages/krag/PublicTermView.tsx:203-249`; `TermCard` (`pages/krag/components/TermCard.tsx`) grows props `location`, `capacity`, `attendeeCount`.

```
┌──────────────────────────────────────────────┐
│ (←)   (N) Nutka Studio                       │  GroupHeader unchanged
│ Nutki                                        │  h1
│ wstęp wolny                                  │  subtitle = term.description
│ ┌──────────────────────────────────────────┐ │
│ │        GroupVisualization (krąg)         │ │  unchanged
│ └──────────────────────────────────────────┘ │
│ ┌─ TermCard section "Termin zajęć" ────────┐ │  mx-5 mt-6 rounded-3xl border bg-paper p-4
│ │ ┌────┐ TERMIN ZAJĘĆ                      │ │  unchanged date badge + lines
│ │ │ pt │ piątek, 24 października 2026      │ │
│ │ │ 24 │ godz. 17:00                       │ │
│ │ └────┘                                   │ │
│ ├──────────────────────────────────────────┤ │  [NEW] divider border-t border-line mt-3 pt-3
│ │ MIEJSCE                                  │ │  eyebrow text-xs uppercase tracking (same
│ │ Świetlica na Polnej                      │ │  class as "TERMIN ZAJĘĆ"); name font-bold
│ │ ul. Polna 12, 60-595 Poznań              │ │  address text-sm ink-soft
│ │ wejście od podwórza                      │ │  notes text-sm ink-soft (only when set)
│ │ Otwórz w Google Maps ↗                   │ │  <a target=_blank rel="noopener noreferrer">
│ ├──────────────────────────────────────────┤ │  (block omitted entirely when location null)
│ │ Zapisanych 3 z 12                        │ │  [NEW] text-sm; from attendee_count/capacity
│ └──────────────────────────────────────────┘ │  (line omitted when capacity null)
│ Potrzebne rzeczy …                           │  unchanged
│ Kto przyjdzie …                              │  unchanged
├──────────────────────────────────────────────┤
│ ┌──────────────────────────────────────────┐ │  TermFooter unchanged, still active
│ │        ＋ Zapisz się na zajęcia           │ │
│ └──────────────────────────────────────────┘ │
└──────────────────────────────────────────────┘

Full variant (attendee_count >= capacity):

│ ├──────────────────────────────────────────┤ │
│ │ Zapisanych 12 z 12                       │ │
│ │ ┌──────────────────────────────────────┐ │ │  [NEW] role="status" pill, bg-accent-soft
│ │ │ ⓘ Brak wolnych miejsc                 │ │ │  text-accent-fg font-bold; informational,
│ │ └──────────────────────────────────────┘ │ │  RSVP button below is NOT disabled
│ └──────────────────────────────────────────┘ │
```

**Data bound**: `PublicTermResponse.location: {name, formatted_address, google_place_id, notes} | null`, `capacity: number | null`, `attendee_count: number` (active signups). `PublicTermView` passes `term?.location ?? null`, `term?.capacity ?? null`, `term?.attendee_count`. In the no-term state `TermCard` keeps its existing empty message.

**A11y**: location block lives inside the existing `section aria-label="Termin zajęć"` so the page's landmark list does not change; "Brak wolnych miejsc" uses `role="status"` (not `alert`: it is present on load, not an interruption). Maps link opens a new tab, so its accessible name ends with "(nowa karta)" via `sr-only` span or `aria-label`. Theme-token tests (`themeTokenUsage.test.tsx`) list krag files: use tokens only (`text-ink-soft`, `bg-accent-soft`, no raw hex).

---

<a id="admin-terms-page"></a>
### Mockup 9: AdminTermsPage – "Miejsce" and "Miejsca" columns

**Context**: `pages/AdminTermsPage.tsx:33-60`, Chakra `AdminTable`.

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ Terms                                                                                │
│ Every Circle's terms, latest first                                                   │
│ ┌────────────────┬────────┬───────────────┬──────────────────────┬─────────┬─────────┬────────┐
│ │ Date           │ Circle │ Description   │ Miejsce        [NEW] │ Signups │ Children│ Miejsca│ [NEW]
│ ├────────────────┼────────┼───────────────┼──────────────────────┼─────────┼─────────┼────────┤
│ │ 24 paź 2026,   │ Nutki  │ wstęp wolny   │ Świetlica na Polnej  │ 3       │ 5       │ 3 / 10 │
│ │ 17:00          │        │               │ ul. Polna 12, Poznań │         │         │        │
│ ├────────────────┼────────┼───────────────┼──────────────────────┼─────────┼─────────┼────────┤
│ │ 20 paź 2026,   │ Rowerki│ No description│ —                    │ 0       │ 0       │ —      │
│ │ 10:00          │        │               │ (gray italic, as     │         │         │ (gray) │
│ │                │        │               │  "No description")   │         │         │        │
│ └────────────────┴────────┴───────────────┴──────────────────────┴─────────┴─────────┴────────┘
│ Showing 2 of 2 terms                                                                 │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

**Data bound**: `ModerationTermResponse.location: {name, formatted_address} | null`, `capacity: number | null`, existing `attendee_count`/`child_count`. "Miejsce" cell = name (`fontWeight 500`) + address on a second line (`fontSize 12px`, `#64748B`). "Miejsca" cell = `` `${attendee_count} / ${capacity}` `` as a single string, or "—" (`#94A3B8` italic) when capacity is null — never a bare number, so `getByText("3")` in `AdminTermsPage.test.tsx` keeps matching only the Signups cell.

**Integration points**: `columns` array becomes `["Date", "Circle", "Description", "Miejsce", "Signups", "Children", "Miejsca"]` (admin headers are English today; keep the English/Polish mix consistent with the rest of the admin pages or translate both new headers to "Location"/"Capacity" — pick one in the plan, the mockup uses the brief's Polish labels). Null location shows "—" with the same gray-italic treatment as "No description".

---

## Reusable components

### Layout and sheet chrome
- **panel `ModalSheet`** `pages/panel/panelComponents.tsx:167` — host for stepper, group modals, term modal, `EditTermDialog`. Do not nest; the picker is inline.
- **krag `ModalSheet`** `components/krag/ModalSheet.tsx` — only if a sub-sheet is ever needed (not in these mockups); honours `defaultPrevented` on Esc.
- **`Field`** `pages/panel/panelComponents.tsx:158` — wraps every new input and the picker.

### Cards and lists
- **`HintCard`** `panelComponents.tsx:107` — reworded hints (Mockup 5).
- **`organizerTermCard` + `signupSummaryChip`** `PanelDataContext.tsx:851/818` — led term card, extended with `TermPlaceLine` and " · X/Y miejsc".
- **guest `Link` card** `HomeView.tsx:134`, `SpotkaniaView.tsx:287` — attended term card, extended with place + capacity (no nested anchors).
- **`TermCard`** `pages/krag/components/TermCard.tsx` — public date card, extended with location block + capacity line + "Brak wolnych miejsc".
- **`AdminTable`** `components/shared/AdminTable.tsx` — two extra columns.
- **`AccountMenu`** `components/shared/AccountMenu.tsx` — one extra `menuitem`.

### Interaction precedents to copy
- radiogroup with roving tabIndex: `pages/organizer/editor/ColorsTab.tsx:53-75`.
- inline edit/delete rows: `components/panel/EditTermDialog.tsx:329-400` (`rowIconBtn`, `rowSaveBtn`, `rowCancelBtn` classes).
- disclosure "+ Dodaj …" / "Zwiń": `PanelModals.tsx:322-370`.
- confirm dialog: `pages/panel/DeleteGroupDialog.tsx`.
- focus move after row removal: `pages/organizer/editor/PhotosTab.tsx`.

### New shared pieces (no existing equivalent)
- `components/panel/GroupFormFields.tsx` — name, visibility, LocationPicker, capacity (+ optional layout select).
- `components/shared/LocationPicker.tsx` — radiogroup list + add/edit/delete + Google/manual forms.
- `components/shared/TermPlaceLine.tsx` — name, address, notes, optional Maps link, capacity text; used by panel cards and `TermCard` (krag styling via tokens).
- `lib/googleMaps.ts` — lazy script loader + session-token autocomplete wrapper; `buildMapsUrl(location)` helper (can live in `TermPlaceLine` or `utils/`).

### Icons
- `pages/panel/panelIcons.tsx` — `PencilIcon`, `TrashIcon`, `CopyIcon`, `BuildingIcon`, `CalendarPlusIcon`, `FamilyIcon`, `CloseIcon`; add `MapPinIcon` (place line) and reuse `CalendarPlusIcon` for the hamburger item.

---

## Implementation notes

### Consistency checklist
- One field order everywhere a group is edited: Nazwa -> (Szablon) -> Widoczność -> Stałe miejsce spotkań -> Ile miejsc.
- One field order everywhere a term is edited: (Grupa) -> Data i godzina -> Opis -> Miejsce -> Ile miejsc -> (Potrzebne rzeczy).
- Existing labels kept verbatim: "Nazwa grupy", "Widoczność grupy", "Data i godzina", "Opis (opcjonalnie)", "Opis", "Dodaj termin", "Dodaj grupę", "Zapisz", "Gotowe", "Przejdź do publicznej strony →".
- "Lokalizacja" replaced by "Stałe miejsce spotkań" (group) / "Miejsce" (term).
- Status-level "organizator" copy removed: stepper title, `"zostan-organizatorem"` modal kind, toast "Jesteś organizatorem — …" (new toast: "Grupa założona — dodano pierwszy termin"), hint "Możesz zostać organizatorem". Per-group role copy (`TermCard:31`, `GroupHeader`, `PrivateGroupGate`) untouched.
- Null handling: `TermPlaceLine` renders nothing for null; capacity text omitted for null; admin shows "—".
- Tailwind tokens only (`bg-cream`, `text-ink-soft`, `bg-accent-soft`, `text-danger`); no new raw colours in krag files.

### Accessibility considerations
- Every new input: `aria-label` equal to its visible label ("Nazwa miejsca", "Adres", "Notatka", "Ile miejsc", "Miejsce" radiogroup).
- LocationPicker list: `role="radiogroup"` with `aria-label` from the host field; rows `role="radio"` + `aria-checked`; roving `tabIndex`; arrow-key navigation.
- Row buttons: `aria-label="Edytuj miejsce <name>"`, `aria-label="Usuń miejsce <name>"`; delete confirmed in an alertdialog.
- Autocomplete: `role="combobox"`, `aria-autocomplete="list"`, `aria-expanded`, `aria-controls`, `aria-activedescendant`; own `role="listbox"`/`role="option"` inside the sheet; **Esc with the listbox open closes only the listbox and calls `preventDefault()` + `stopPropagation()`** so no host sheet closes.
- Errors `role="alert"` (form-level and per-row); capacity-full message `role="status"`.
- Done screen CTA to `/organization` is a `Link` with visible text; no icon-only controls anywhere new.
- Maps links: `target="_blank" rel="noopener noreferrer"`, name "Otwórz w Google Maps" (+ hidden "(nowa karta)"); never nested inside another `Link` (attended cards show address only).
- Focus: after saving a new place focus moves to its radio; after "Edytuj" to the name input; after cancel back to the row's "Edytuj"; after delete to the next row or the "+ Dodaj nowe miejsce" button.
- Hamburger item keeps `role="menuitem"`.

### Responsive behaviour
- Phone (default): everything single-column inside the 430 px sheet; capacity input `w-28`; picker rows wrap "Edytuj"/"Usuń" to a second line under the address when narrow (`flex-wrap`, as `EditTermDialog` rows).
- ≥520 px: sheet centres (existing `min-[520px]:items-center`), no layout change; Spotkania tiles stay `grid-cols-2`.
- Admin table: horizontal scroll from `AdminTable` as today; the two new columns make the table wider, address line wraps inside the cell.

---

## Alternatives considered

### A. Nested "Dodaj miejsce" sheet on top of the form sheet (rejected)
The panel `ModalSheet` has no focus trap or Esc handling; stacking sheets would require migrating every host to the krag sheet first and would hide the form the user is filling. Inline disclosure already exists in the same modals ("+ Dodaj potrzebną rzecz").

### B. Google's `Autocomplete` widget with its `pac-container` (rejected)
The widget appends its dropdown to `document.body`, outside the sheet; Esc and click-outside semantics fight the sheet overlay, and the krag focus trap would bounce focus. Using `AutocompleteService`/Places API (New) with our own `listbox` keeps everything inside the dialog and testable with a fake `window.google`.

### C. `<select>` of saved places instead of a radiogroup (rejected)
A native select cannot carry address/notes per option nor inline edit/delete buttons, which the brief requires in the list.

### D. Three separate forms with copied fields (rejected)
`PanelModals.tsx` already duplicates two of them; a third copy in the stepper violates the minimal-implementation standard. `GroupFormFields` is the chosen approach (scope-clarifications §8).

### E. Two sections on Home as well (rejected)
Home stays a 3-card "what's next"; merging led + attended with dedupe keeps it short, while Spotkania gets explicit sections (scope-clarifications §7).

### F. Disable RSVP when full (out of scope)
The brief makes the limit informational; the mockup shows a `role="status"` message and keeps the button active.

---

*Generated by ui-mockup-generator subagent*
