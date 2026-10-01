# UI Mockups: Family profile completion from a term sign-up, child role/age, organizer attendee view

**Generated**: 2026-09-30
**Task Path**: `.maister/tasks/development/2026-09-29-family-profile-signup-flow`
**Feature Type**: Enhancement (parts 1-3) + New Feature (part 4, organizer page)

Legend used in all diagrams:
- `[EXISTING]` means the element is unchanged.
- `[MODIFIED]` means the element exists and its behaviour or copy changes.
- `[NEW]` means the element is added.
- `▸` marks an annotation pointing to a file or line.

All widths assume the phone frame (`PhoneFrame`, full width below 520px). The panel content column uses `px-[18px]`, so every mockup is drawn at about 360px wide.

---

## Overview

### UI Requirements
1. Banner in the logged-in RSVP dialog links to `/panel/rodzina?returnTo=<term path>`.
2. A "Wróć do terminu" button at the bottom of RodzinaView, shown only when `returnTo` is a safe path. It appears in the empty state and the populated state, and stays after CreateFamilyDialog closes.
3. Member labels depend on the role: "(Ty)", "(opiekun)" or "(dziecko)".
4. A "Rok urodzenia" input appears only when "Dziecko" is pressed, in the RodzinaView add form and in CreateFamilyDialog step 2. Child rows show "ok. N lat". Existing CHILD rows get an inline edit for the birth year only.
5. A new organizer-only page `/panel/terminy/:termId` with the attendee list. The organizer term card gets a summary chip "5 zapisów · 8 dzieci" that links to the page.

### Integration Strategy
**Decision**: every new element reuses a pattern already on the same screen.
- The return button is a full-width secondary button at the end of RodzinaView. It copies the outline style of "Dodaj kolejną osobę" from CreateFamilyDialog and uses the `BackIcon` + "Wróć" idiom.
- The birth-year input is one more `Field` in the same `grid grid-cols-1 gap-3`. It is rendered conditionally below "Rola".
- The inline birth-year edit reuses the family-rename inline editor from RodzinaView lines 56-91: pencil button, then input + "Zapisz", with Enter and Escape handling.
- The card chip reuses the pill shape of the needed-items chips on the same card (`rounded-full px-2.5 py-0.5 text-[10.5px] font-extrabold`).
- The organizer page reuses the panel's section anatomy (`h2` heading, `rounded-[22px] border border-line bg-paper p-5` panel, `rounded-2xl border border-line bg-cream p-[15px]` rows, dashed empty state).

**Rationale**: users look for the return action at the end of the form they were sent to complete. Organizers already scan the term card, so a count there, linking to the details, is the most discoverable entry point. Neither choice introduces a new visual primitive.

---

## Existing Layout Analysis

### Application Structure
- `src/frontend/src/router.tsx:89-95` defines `/panel` and `/panel/:view` as two identical routes rendering `<AuthGuard><PanelPage /></AuthGuard>`.
- `src/frontend/src/pages/panel/PanelPage.tsx:60-80` renders `PhoneFrame`, a scrolling content column (`flex-1 overflow-y-auto px-[18px] pb-6 pt-[18px]`), a view switch, `PanelNav` (bottom tab bar), `PanelModals`, and a fixed toast at `bottom-[86px]`.
- `PanelNav` (`src/frontend/src/pages/panel/PanelNav.tsx`) is shown only on the top-level views (home, spotkania, rzeczy, podarki). `rodzina` is **not** top-level, so RodzinaView has no bottom bar. The last element of the view is the last thing on screen.
- Modals render as `ModalSheet` (`src/frontend/src/pages/panel/panelComponents.tsx:101`): a bottom sheet on phone and a centred card from 520px up.

**Key Components**:
- Layout: `src/frontend/src/components/shared/PhoneFrame.tsx`, `src/frontend/src/pages/panel/PanelPage.tsx`
- Navigation: `src/frontend/src/pages/panel/PanelNav.tsx`, `src/frontend/src/components/shared/AccountMenu.tsx:71` (the "Mój dom" link)
- Form primitives: `Field`, `ModalSheet` in `src/frontend/src/pages/panel/panelComponents.tsx`
- Icons: `src/frontend/src/pages/panel/panelIcons.tsx` (`BackIcon`, `PencilIcon`, `TrashIcon`, `CopyIcon`, `FamilyIcon`, `CalendarIcon`)

### Identified Patterns
- **Role toggle**: two `flex-1` buttons with `aria-pressed`. The active one is `border-mint bg-mint-soft text-mint`, the inactive one `border-line bg-cream text-ink-soft`.
- **Inline rename**: an `h3` with a pencil icon button (`h-7 w-7 rounded-[9px]`) swaps to an input (`rounded-xl border-[1.5px] border-line bg-cream px-3 py-2`) with a mint "Zapisz" (`rounded-[11px] px-3.5 py-2 text-[12.5px]`). Enter saves, Escape cancels, and blur with no change cancels.
- **Primary CTA**: `w-full rounded-[13px] bg-mint px-5 py-3 text-[13.5px] font-extrabold text-white`.
- **Secondary CTA**: `w-full rounded-[13px] border-[1.5px] border-line px-5 py-2.5 text-[13px] font-extrabold text-ink-soft` (CreateFamilyDialog "Dodaj kolejną osobę").
- **Back link**: `inline-flex items-center gap-1.5 text-xs font-bold text-ink-soft` + `<BackIcon /> Wróć` (`src/frontend/src/pages/OrganizationPage.tsx:89-91`).
- **Empty state**: `rounded-2xl border-[1.5px] border-dashed border-line py-[26px] text-center text-[13.5px] text-ink-soft`.
- **Inline error**: `text-[12.5px] font-semibold text-danger`.
- **Date tile**: `h-[46px] w-[46px] rounded-[13px] bg-mint-soft`, serif day with an uppercase month.

---

## Mockups

<a id="rsvp-banner"></a>
### Mockup 1: RSVP dialog banner (logged in, family without children)

**Context**: the public term page `/:slug/grupa/:groupId/term/:termId`. A logged-in user taps "Zapisz się" and `family.child_count === 0`.
File: `src/frontend/src/components/krag/RsvpDialogLoggedIn.tsx:105-118`

```
┌──────────────────────────────────────────────┐
│ Zapisz się na zajęcia                   (✕)  │  ModalSheet [EXISTING]
│                                              │
│ Zapisujesz się jako Anna Nowak               │  [EXISTING]
│                                              │
│ ┌──────────────────────────────────────────┐ │  .kg-fulfill [EXISTING]
│ │ Dodaj rodzinę, aby uzupełnić liczbę      │ │
│ │ dzieci                                   │ │
│ │ Liczbę dzieci uzupełnimy automatycznie   │ │
│ │ z Twojego domu.                          │ │
│ │                                          │ │
│ │ [ Przejdź do „Mój dom” ]   [ Pomiń ]     │ │
│ │   └─ [MODIFIED] href                     │ │
│ └──────────────────────────────────────────┘ │
│                                              │
│ [          Zapisz się                      ] │  [EXISTING]
└──────────────────────────────────────────────┘

  [MODIFIED] <Link to=...>
    before:  /panel
    after:   /panel/rodzina?returnTo=<encodeURIComponent(location.pathname)>
    e.g.     /panel/rodzina?returnTo=%2Fkowalscy%2Fgrupa%2F12%2Fterm%2F34
```

**Integration Points**:
- ✅ Only the `to` prop changes. The copy, classes (`kg-btn-primary`) and "Pomiń" stay the same.
- ✅ Use `useLocation().pathname`. It already equals the term route, and the component needs no new props. The alternative is to pass `termPublicPath(group, term.id)` from `PublicTermView.tsx:122-139`.
- ✅ The dialog closes when the user leaves the page. On return, `RsvpDialogLoggedIn` remounts and refetches `getMyFamilies`, so the child-count prefill picks up the new children.

---

<a id="rodzina-populated"></a>
### Mockup 2: RodzinaView, populated state (with returnTo)

**Context**: `/panel/rodzina?returnTo=%2Fkowalscy%2Fgrupa%2F12%2Fterm%2F34`. The family exists and has members.
File: `src/frontend/src/pages/panel/views/RodzinaView.tsx`

```
┌──────────────────────────────────────────────┐
│ Mój dom                                      │  h2 [EXISTING] :55
│ Rodzina Nowak  (✎)                           │  rename [EXISTING] :81-90
│ 3 osoby                                      │  [EXISTING] :95-97
│                                              │
│ ┌──────────────────────────────────────────┐ │  member panel [EXISTING] :99
│ │┌────────────────────────────────────────┐│ │
│ ││ Anna Nowak (Ty)                        ││ │  [MODIFIED] label :113-114
│ │└────────────────────────────────────────┘│ │
│ │┌────────────────────────────────────────┐│ │
│ ││ Piotr Nowak (opiekun)             (🗑) ││ │  GUARDIAN → "(opiekun)"
│ │└────────────────────────────────────────┘│ │
│ │┌────────────────────────────────────────┐│ │
│ ││ Zosia Nowak (dziecko)             (🗑) ││ │  CHILD → "(dziecko)"  [MODIFIED]
│ ││ rocznik 2018 · ok. 8 lat  (✎)          ││ │  [NEW] child meta line
│ ││   └─ component:child-birth-year-inline ││ │
│ │└────────────────────────────────────────┘│ │
│ │┌────────────────────────────────────────┐│ │
│ ││ Staś Nowak (dziecko)              (🗑) ││ │
│ ││ [+ Dodaj rok urodzenia]                ││ │  [NEW] birth_year === null
│ │└────────────────────────────────────────┘│ │
│ └──────────────────────────────────────────┘ │
│                                              │
│ Dodaj kolejnego członka                      │  [EXISTING] :135
│ ┌──────────────────────────────────────────┐ │
│ │ IMIĘ I NAZWISKO                          │ │
│ │ [ np. Zosia Kowalska                   ] │ │
│ │ ROLA                                     │ │
│ │ [  Opiekun  ] [▓▓ Dziecko ▓▓]            │ │  aria-pressed toggle
│ │ ROK URODZENIA                            │ │  [NEW] only when CHILD
│ │ [ np. 2018                             ] │ │    └─ component:birth-year-field
│ │                                          │ │
│ │ [▓▓▓▓▓▓▓▓▓▓▓▓▓ Dodaj ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓] │ │  [EXISTING] :171-177
│ └──────────────────────────────────────────┘ │
│                                              │
│ [ ←  Wróć do terminu                       ] │  [NEW] component:return-to-term-button
│                                              │    only when isSafeReturnPath(returnTo)
└──────────────────────────────────────────────┘
   (no PanelNav: "rodzina" is not a top-level view)
```

**Integration Points**:
- ✅ The label logic at `:113-114` becomes a single `<span className="ml-1.5 text-ink-soft">`. Its text is `(Ty)` when `g.party_id === profile.party_id`, else `(dziecko)` when `g.role_type === "CHILD"`, else `(opiekun)`. The self check wins, so a user is never shown as "(dziecko)".
- ✅ The child meta line sits inside the existing `min-w-0 flex-1` column, under the `h3`: `mt-0.5 text-[12.5px] text-ink-soft`, the same as the card subtitle in `organizerTermCard`.
- ✅ The trash button keeps its position (`flex-none`, right) and stays hidden for the current user.
- ✅ The "Rok urodzenia" `Field` is the third child of the existing `grid grid-cols-1 gap-3` (`:137`). The layout needs no change.
- ✅ The return button is a sibling after the `mt-7` "Dodaj kolejnego członka" block, wrapped in `mt-7`. It is the last element of the view, so users find it after they finish adding people.

**Component Reuse**:
- `Field` (`src/frontend/src/pages/panel/panelComponents.tsx:92`) for "Rok urodzenia".
- `PencilIcon`, `BackIcon` (`src/frontend/src/pages/panel/panelIcons.tsx:104, :78`).
- The inline-rename markup (`RodzinaView.tsx:56-91`) as the template for the birth-year inline edit.

---

<a id="rodzina-empty"></a>
### Mockup 3: RodzinaView, empty state (with returnTo)

**Context**: the `family === null` branch (`RodzinaView.tsx:30-50`). This is rare because registration creates a solo family, but it must still show the button.

```
┌──────────────────────────────────────────────┐
│ Mój dom                                      │  [EXISTING]
│                                              │
│ ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐ │  dashed empty card [EXISTING]
│        Nie masz jeszcze rodziny              │
│   Załóż rodzinę, aby dodać opiekunów i       │
│   dzieci oraz wspólnie zapisywać się na      │
│   zajęcia.                                   │
│          [▓▓ Załóż rodzinę ▓▓]               │  → setModal("rodzina-nowa")
│ └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘ │
│                                              │
│ [ ←  Wróć do terminu                       ] │  [NEW] same component, mt-7
└──────────────────────────────────────────────┘
```

**Integration Points**:
- ✅ Render the button through one small local component or helper, for example `<ReturnToTermButton />` declared in `RodzinaView.tsx`, so both branches share it and the tests find it the same way.
- ✅ Both branches read the param with `useSearchParams()` inside RodzinaView, not in PanelDataContext. That keeps the scope local.

---

<a id="return-to-term-button"></a>
### Mockup 4: "Wróć do terminu" button, states and flow

```
  returnTo value                                 isSafeReturnPath   Rendered?
  ─────────────────────────────────────────────  ────────────────   ─────────
  (missing)                                      false              no
  /kowalscy/grupa/12/term/34                     true               YES
  //evil.com/x                                   false (//)         no
  https://evil.com                               false (no leading /) no
  /\evil.com                                     false (contains \)  no

  Button (component:return-to-term-button)
  ┌──────────────────────────────────────────┐
  │  ←  Wróć do terminu                      │  <Link to={returnTo}>
  └──────────────────────────────────────────┘
   inline-flex w-full items-center justify-center gap-1.5
   rounded-[13px] border-[1.5px] border-line px-5 py-2.5
   text-[13px] font-extrabold text-ink-soft
   hover:border-mint hover:text-mint
```

**Flow (the param survives the modal)**:
```
 Term page ──banner──▶ /panel/rodzina?returnTo=…   (button visible)
                           │
                           │ "Załóż rodzinę" → setModal("rodzina-nowa")
                           ▼
                 ┌─────────────────────┐
                 │ CreateFamilyDialog  │   no navigation, URL unchanged
                 │ step 1 → 2 → done   │
                 └─────────┬───────────┘
                           │ finish(): onClose() + onCreated() → load({silent})
                           ▼
                 /panel/rodzina?returnTo=…  (populated state, button still visible)
                           │
                           │ "Wróć do terminu"
                           ▼
                 Term page → RsvpDialogLoggedIn remounts → child_count prefilled
```

**Interaction Details**:
1. The button is a React Router `<Link>` (it is navigation, so it is not a `<button>`). The `returnTo` value is already decoded by `useSearchParams`.
2. `isSafeReturnPath()` is a new pure helper. Suggested home: `src/frontend/src/utils/` or `src/frontend/src/pages/panel/panelHelpers.ts`. It returns true only when the value starts with `/`, does not start with `//` and contains no `\`.
3. Any `setView()` call drops the query string (`PanelDataContext.tsx:361-363`). The button then disappears. This is accepted: the param belongs to the family view.

---

<a id="child-birth-year-inline"></a>
### Mockup 5: Inline birth-year edit on a CHILD row

**Context**: a CHILD member row in the RodzinaView member list. The pattern mirrors the family rename (`RodzinaView.tsx:56-91`).

```
 A. Display (birth_year set)
 ┌────────────────────────────────────────────┐
 │ Zosia Nowak (dziecko)                 (🗑) │
 │ rocznik 2018 · ok. 8 lat  (✎)              │  (✎) aria-label="Edytuj rok urodzenia: Zosia Nowak"
 └────────────────────────────────────────────┘

 B. Display (birth_year null)
 ┌────────────────────────────────────────────┐
 │ Staś Nowak (dziecko)                  (🗑) │
 │ + Dodaj rok urodzenia                      │  text button, text-[12px] font-bold text-mint
 └────────────────────────────────────────────┘

 C. Editing (after ✎ or "+ Dodaj")
 ┌────────────────────────────────────────────┐
 │ Zosia Nowak (dziecko)                 (🗑) │
 │ [ 2018        ] [▓ Zapisz ▓]               │  input type=number inputMode=numeric
 │                                            │  aria-label="Rok urodzenia: Zosia Nowak"
 │                                            │  Enter = save, Esc = cancel
 └────────────────────────────────────────────┘

 D. Error
 ┌────────────────────────────────────────────┐
 │ Zosia Nowak (dziecko)                 (🗑) │
 │ [ 1890        ] [▓ Zapisz ▓]               │
 │ Podaj rok urodzenia z zakresu 1900–2026    │  text-[12.5px] font-semibold text-danger
 └────────────────────────────────────────────┘
```

**Interaction Details**:
1. Only one row can be in edit mode at a time. That matches the single `renamingFamily` flag pattern; use a `editingBirthYearFor: membershipId | null` state.
2. "Zapisz" is disabled while `busy`, as in the rename. Blur with an unchanged value cancels.
3. On success, `load({ silent: true })` runs and a toast appears. Suggested copy: "Zapisano rok urodzenia".
4. The name is never editable here (decided scope).
5. Guardian rows never show this line.

---

<a id="birth-year-field"></a>
### Mockup 6: "Rok urodzenia" field (shared by both forms)

```
 Role = Opiekun (default)              Role = Dziecko
 ┌──────────────────────────────┐      ┌──────────────────────────────┐
 │ IMIĘ I NAZWISKO              │      │ IMIĘ I NAZWISKO              │
 │ [ Zosia Kowalska           ] │      │ [ Zosia Kowalska           ] │
 │ ROLA                         │      │ ROLA                         │
 │ [▓ Opiekun ▓] [  Dziecko  ]  │      │ [  Opiekun  ] [▓ Dziecko ▓]  │
 │                              │      │ ROK URODZENIA (opcjonalnie)  │  [NEW]
 │                              │      │ [ np. 2018                 ] │
 │                              │      │ ok. 8 lat                    │  live hint, text-[12px] text-ink-soft
 └──────────────────────────────┘      └──────────────────────────────┘
```

- `Field label="Rok urodzenia"` with `<input type="number" inputMode="numeric" min=1900 max={currentYear} placeholder="np. 2018">`. The class is the same as the name input on that screen.
- The field is optional: the API field is optional and "Dodaj" stays enabled with it empty.
- Switching back to "Opiekun" hides the field and clears its value, so a guardian is never sent a `birth_year`.
- After a successful add, the value resets together with `memberName` (the RodzinaView form) and `draftName` / `draftRole` (the CreateFamilyDialog form).
- The live "ok. N lat" hint is optional polish. Show it only when the value is a valid year.

---

<a id="create-family-step2"></a>
### Mockup 7: CreateFamilyDialog step 2 with a child draft

File: `src/frontend/src/components/panel/CreateFamilyDialog.tsx:145-230`

```
┌──────────────────────────────────────────────┐
│ Załóż rodzinę                           (✕)  │  ModalSheet [EXISTING]
│                  ○  ●                        │  step dots [EXISTING]
│                                              │
│ Dodaj członków (opcjonalnie)                 │
│ ┌──────────────────────────────────────────┐ │  draft list [MODIFIED]
│ │ Piotr Nowak                Opiekun  Usuń │ │
│ ├──────────────────────────────────────────┤ │
│ │ Zosia Nowak     Dziecko · ok. 8 lat Usuń │ │  [NEW] age suffix for CHILD with year
│ ├──────────────────────────────────────────┤ │
│ │ Staś Nowak                 Dziecko  Usuń │ │  CHILD without year: unchanged
│ └──────────────────────────────────────────┘ │
│                                              │
│ IMIĘ I NAZWISKO                              │
│ [ np. Zosia Kowalska                       ] │
│ ROLA                                         │
│ [  Opiekun  ] [▓▓ Dziecko ▓▓]                │
│ ROK URODZENIA (opcjonalnie)                  │  [NEW] component:birth-year-field
│ [ np. 2018                                 ] │
│                                              │
│ [    Dodaj kolejną osobę                   ] │  [EXISTING] secondary
│                                              │
│ [▓▓▓▓▓▓▓▓▓▓▓▓▓▓ Zakończ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓] │  [EXISTING] primary
└──────────────────────────────────────────────┘
```

**Integration Points**:
- ✅ `MemberDraft` gains `birthYear: number | null`. Add a `draftBirthYear` state next to `draftRole`, and reset it in `addDraftMember()` together with `draftRole`.
- ✅ The draft row role text (`:157-159`) becomes `Dziecko · ok. N lat` when a year is present.
- ✅ The `createLightweightMembers` mapping (`:84-86`) sends `birth_year` only for CHILD drafts.
- ✅ The "done" step (`:101-116`) is unchanged. The return button lives in RodzinaView, which is visible again after `finish()`.

---

<a id="organizer-term-card"></a>
### Mockup 8: Organizer term card with the sign-up summary chip

**Context**: `organizerTermCard()` in `src/frontend/src/pages/panel/PanelDataContext.tsx:1075-1150`. HomeView (`views/HomeView.tsx:~118`, the first three terms) and SpotkaniaView (`views/SpotkaniaView.tsx:~148`, all terms) render it.

```
┌──────────────────────────────────────────────┐
│ ┌──────┐  Krąg Maluchy (link)          (⧉)   │  [EXISTING] name → public term page
│ │  12  │  godz. 17:00 · Zabawy sensoryczne   │  [EXISTING]        (⧉) copy link
│ │  PAŹ │  (✓ Ciastka) (Soczki)         (✎)   │  [EXISTING] needed-items chips; (✎) edit
│ └──────┘  ( 👥 5 zapisów · 8 dzieci  › )      │  [NEW] component:signup-summary-chip
│                 └─ Link → /panel/terminy/34  │
└──────────────────────────────────────────────┘

 Chip variants
   ( 👥 5 zapisów · 8 dzieci › )   attendee_count > 0
   ( 👥 1 zapis · 2 dzieci   › )   singular
   ( 👥 3 zapisy · 0 dzieci  › )   2-4 form
   ( Brak zapisów            › )   attendee_count === 0, still a link to the page
```

**Integration Points**:
- ✅ The chip is a new row under the needed-items row, inside the `min-w-0 flex-1` column, with `mt-1.5`. It is **not** part of the needed-items `flex-wrap` group. Its meaning is different (people, not things), and the chip must stay visible when there are no needed items.
- ✅ Style: `inline-flex items-center gap-1 rounded-full border border-line bg-paper px-2.5 py-0.5 text-[10.5px] font-extrabold text-ink hover:border-mint`. It is neutral (paper on cream) to separate it from the mint and lime item chips. The leading icon can be `FamilyIcon` (`panelIcons.tsx:96`) at a small size, and the trailing `›` is decorative (`aria-hidden`).
- ✅ The counts come from the organizer terms payload (`attendee_count`, `child_count`), not from one attendees call per card. That avoids N+1 (decided scope).
- ✅ `child_count` on the chip is the **sum of RSVP `child_count`**, meaning children who are coming. It is not the number of children in the families.
- ✅ The right column keeps its two icon buttons. No third icon is added. The chip is the single entry point, so the card height grows by one short line only.
- Accessible name: `aria-label="Zapisani na termin: 5 zapisów, 8 dzieci"`.

**Polish plural helper (needed for the chip and the page)**:
```
 zapis:   1 → "zapis",  2-4 (not 12-14) → "zapisy",  otherwise → "zapisów"
 dziecko: 1 → "dziecko", otherwise → "dzieci"   (matches "przychodzi z N dzieci")
 lat:     1 → "rok",    2-4 (not 12-14) → "lata",   otherwise → "lat"
```

---

<a id="organizer-term-attendees"></a>
### Mockup 9: Organizer term attendees page `/panel/terminy/:termId`

**Context**: a new organizer-only screen reached from the chip. It uses the PhoneFrame layout with no PanelNav (not top-level) and follows the panel view anatomy.

```
┌──────────────────────────────────────────────┐
│ ← Wróć                                       │  back link (BackIcon + "Wróć") → /panel/spotkania
│                                              │
│ Zapisani                                     │  h2 text-[19px] font-semibold
│ 5 zapisów · 8 dzieci                         │  small text-[12.5px] text-ink-soft
│                                              │
│ ┌──────────────────────────────────────────┐ │  term summary [REUSE card head, read-only]
│ │ ┌──────┐ Krąg Maluchy                    │ │
│ │ │  12  │ godz. 17:00 · Zabawy sensoryczne│ │
│ │ │  PAŹ │ Zobacz stronę terminu ›         │ │  Link → termPublicPath(group, term.id)
│ │ └──────┘                                 │ │
│ └──────────────────────────────────────────┘ │
│                                              │
│ ┌──────────────────────────────────────────┐ │  rounded-[22px] border bg-paper p-5
│ │┌────────────────────────────────────────┐│ │
│ ││ Anna Nowak                             ││ │  display_name  text-[15.5px] font-semibold
│ ││ Rodzina Nowak                          ││ │  family_name   text-[12.5px] text-ink-soft
│ ││ ┌───────────────────────┐              ││ │
│ ││ │ przychodzi z 2 dzieci │              ││ │  pill bg-mint-soft text-[#12604D]
│ ││ └───────────────────────┘              ││ │
│ ││ dzieci w rodzinie: 5, 8 lat            ││ │  text-[12.5px] text-ink-soft  (ages only, no names)
│ │└────────────────────────────────────────┘│ │
│ │┌────────────────────────────────────────┐│ │
│ ││ Marek Wiśniewski                       ││ │
│ ││ Rodzina Wiśniewskich                   ││ │
│ ││ ( przychodzi z 1 dzieckiem )           ││ │  child_count === 1 wording, see note
│ ││ dzieci w rodzinie: 3 lata, wiek        ││ │
│ ││ nieznany                               ││ │  birth_year null → "wiek nieznany"
│ │└────────────────────────────────────────┘│ │
│ │┌────────────────────────────────────────┐│ │
│ ││ Ola Zielińska                          ││ │
│ ││ ( przychodzi bez dzieci )              ││ │  child_count === 0, pill bg-cream text-ink-soft
│ ││ brak dzieci w profilu rodziny          ││ │  children = []
│ │└────────────────────────────────────────┘│ │
│ └──────────────────────────────────────────┘ │
└──────────────────────────────────────────────┘
```

**Row anatomy** (`component:term-attendee-row`):
- Container: `mt-2.5 rounded-2xl border border-line bg-cream p-[15px] first:mt-0`, the same as the RodzinaView member row.
- Line 1: `display_name`.
- Line 2: `family_name`. Omit the line when it is null.
- Line 3: the RSVP `child_count` pill. It is the headline number because it says who is actually coming.
- Line 4: the family's children's ages, sorted ascending, joined with ", ". The plural of the unit follows the last number ("5, 8 lat", "1, 3 lata"). Children with no birth year are shown as "wiek nieznany" at the end. No names are shown.
- Two guardians of one family who both signed up appear as two rows with the same ages (no dedupe, per scope). The spec should mention this. The row does not need a visual hint.

**Wording for `child_count`**:
- 0 → "przychodzi bez dzieci"
- 1 → "przychodzi z 1 dzieckiem"
- N → "przychodzi z N dzieci"

The scope wording "przychodzi z N dzieci" covers N >= 2. The two special cases avoid ungrammatical Polish.

**Data**:
- Use the new TanStack hook `useTermAttendees(groupId, termId)` in `src/frontend/src/hooks/`. It wraps `getTermAttendeesForFormalization` (`src/frontend/src/api/groups.ts:329-333`), extended with `children: { birth_year: number | null }[]`. Ages come from `dayjs` in `src/utils/dayjs.ts` (`dayjs().year() - birth_year`).
- **Open point for the spec**: the endpoint needs `groupId`, but the route carries only `:termId`. Option A renders the page inside `PanelPage` (a new `termin` branch in the view switch) and resolves the group from the already-loaded `terms` (`{term, group}`) in PanelDataContext. Option B adds a backend lookup by term. A is cheaper and keeps the PhoneFrame, toast and auth handling. `/panel/terminy/:termId` needs its own route entry in `router.tsx` next to `:89-95`, because `/panel/:view` matches one segment only.

---

<a id="organizer-term-attendees-states"></a>
### Mockup 10: Organizer attendees page, states

```
 Loading                                 Empty
 ┌────────────────────────────────┐      ┌────────────────────────────────┐
 │ ← Wróć                         │      │ ← Wróć                         │
 │ Zapisani                       │      │ Zapisani                       │
 │ [term summary card]            │      │ Brak zapisów                   │
 │                                │      │ [term summary card]            │
 │  Wczytywanie zapisanych…       │      │ ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐  │
 │  (text-[12.5px] text-ink-soft) │      │  Nikt jeszcze nie zapisał się   │
 │                                │      │  na ten termin.                 │
 └────────────────────────────────┘      │ └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘  │
                                         └────────────────────────────────┘
 Error (5xx / network)                   Not organizer (403) / unknown term (404)
 ┌────────────────────────────────┐      ┌────────────────────────────────┐
 │ ← Wróć                         │      │ ← Wróć                         │
 │ Zapisani                       │      │ Zapisani                       │
 │ Nie udało się wczytać          │      │ Nie masz dostępu do tego       │
 │ zapisanych — spróbuj ponownie  │      │ terminu.                       │
 │ (text-danger)                  │      │ (text-ink-soft, no retry)      │
 │ [ Spróbuj ponownie ]           │      └────────────────────────────────┘
 └────────────────────────────────┘
```

- The loading and empty copy reuse the exact strings from `EditTermDialog.tsx:432-436`.
- "Spróbuj ponownie" calls the hook's `refetch()`. It is a secondary outline button.
- 4xx responses are not retried (shared `queryClient` rule), so a 403 shows its message at once.
- A non-organizer never sees the chip. The page must still handle direct URL entry.

---

## Reusable Components

### Layout
- **PhoneFrame**: `src/frontend/src/components/shared/PhoneFrame.tsx`. The frame for the organizer page.
- **PanelPage content column**: `src/frontend/src/pages/panel/PanelPage.tsx:62` (`flex-1 overflow-y-auto px-[18px] pb-6 pt-[18px]`). Reuse it by rendering the page as a panel view (option A) or copy it.
- **PanelNav**: `src/frontend/src/pages/panel/PanelNav.tsx`. It hides itself when `isTopLevel` is false, so neither RodzinaView nor the new page shows a tab bar. If the page is a new view, keep it out of `isTopLevel` (`PanelDataContext.tsx:1332`).

### UI Components
- **Field**: `src/frontend/src/pages/panel/panelComponents.tsx:92`. Use it for "Rok urodzenia" in both forms.
- **ModalSheet**: `src/frontend/src/pages/panel/panelComponents.tsx:101`. It already wraps RsvpDialogLoggedIn and CreateFamilyDialog. Nothing new is needed.
- **Role toggle** (inline markup, `RodzinaView.tsx:146-169`, `CreateFamilyDialog.tsx:182-209`). The birth-year field reacts to `memberRole` / `draftRole`.
- **Inline editor** (inline markup, `RodzinaView.tsx:56-91`). The template for the birth-year edit.
- **organizerTermCard head** (`PanelDataContext.tsx:1087-1103`). The date tile and title for the attendees page summary card.
- **Chip** (needed-items pill, `PanelDataContext.tsx:1105-1121`). The shape for the summary chip.
- **Toast**: `showToast()` from `usePanelData()` for "Zapisano rok urodzenia".

### Icons (`src/frontend/src/pages/panel/panelIcons.tsx`)
- `BackIcon` (:78) for "Wróć do terminu" and the page back link.
- `PencilIcon` (:104) to edit the birth year.
- `FamilyIcon` (:96), optional, as the leading icon of the summary chip.

### Helpers (new, small)
- `isSafeReturnPath(value: string | null): value is string`, used only by the return button.
- `approxAge(birthYear)` → number, via `dayjs` from `src/utils/dayjs.ts`. Formatting as "ok. N lat" uses a Polish plural helper. Add one plural function for "rok/lata/lat" and "zapis/zapisy/zapisów", in `panelHelpers.ts` or `src/utils/`.
- `useTermAttendees(groupId, termId)` in `src/frontend/src/hooks/` (TanStack Query, per the data-fetching standard).

---

## Implementation Notes

### Consistency Checklist
- ✅ No new colours or radii. Everything uses the tokens already on these screens (`mint`, `mint-soft`, `line`, `cream`, `paper`, `ink`, `ink-soft`, `danger`).
- ✅ The return button uses the secondary outline style, so it never competes with the mint "Dodaj" primary.
- ✅ Inline editing behaves the same as the family rename (Enter, Escape, blur, busy-disable, inline danger text).
- ✅ The organizer page reuses panel row and panel container classes, as well as the empty-state and loading copy from EditTermDialog.
- ✅ All copy is in Polish, with correct plural forms.

### Accessibility Considerations
- "Wróć do terminu" is a `<Link>` (it is navigation), and the arrow icon is `aria-hidden`.
- The "Rok urodzenia" input gets an accessible name. Note that `Field` renders a `<label>` without `htmlFor`, so pass `aria-label="Rok urodzenia"` as the name input in CreateFamilyDialog does.
- When the field appears after the toggle is pressed, do not move focus automatically. The toggle keeps focus, and the field is next in tab order.
- The inline edit input is autofocused (the rename does the same). The pencil button's `aria-label` includes the child's name, so repeated buttons can be told apart.
- The summary chip has a full-sentence `aria-label`, so "·" and "›" are not read out.
- The attendee list is a `<ul>` of `<li>` rows. Ages are plain text, not icons.
- Contrast: `text-ink-soft` on `bg-cream` is already used for secondary text across the panel. The chip uses `text-ink` for its count.

### Responsive Behavior
- Phone (< 520px): every mockup is drawn at this size. The return button is full width. The chip wraps below the card text, and the right icon column is unaffected.
- From 520px: `PhoneFrame` becomes a floating device frame and `ModalSheet` becomes a centred card. The layouts do not change, because they are all single-column.
- Long names: rows keep `min-w-0 flex-1`, so text wraps and never pushes the trash button off screen. A long age list wraps naturally (Mockup 9, row 2).

---

## Alternatives Considered

### Return button at the top of RodzinaView (Rejected)
**Why**: the user specified the bottom. The top would also be the first thing seen, which invites leaving before the family is completed.

### Return action inside CreateFamilyDialog's "done" step (Rejected for now)
**Why**: it is not needed because the param survives the modal and the button is visible after `finish()`. Adding it would create two places for the same action.

### Keep `returnTo` in PanelDataContext state (Rejected)
**Why**: it widens scope into the 1638-line context. Dropping the param when the user leaves the view is acceptable.

### Attendee list inside EditTermDialog or an expandable card list (Rejected)
**Why**: EditTermDialog stays focused on editing. An expandable list on every card would need per-card fetching (N+1) and would make the cards on HomeView long. A dedicated page with a chip on the card was the decided scope.

### Third icon button (people icon) on the organizer card (Rejected)
**Why**: an icon alone hides the counts. The chip shows the numbers and is the link, so it needs no extra control.

### Show children's names on the organizer page (Rejected)
**Why**: data minimisation for minors (decided scope). Ages only.

### Chosen: bottom secondary return button, conditional birth-year Field, rename-style inline edit, a card chip linking to a panel-styled organizer page (Selected)
**Why**: every element reuses a pattern from the same screen, placement follows where users finish each task, and no new visual primitives are introduced.

---

*Generated by ui-mockup-generator subagent*
