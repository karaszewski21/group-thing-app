# UI Mockups: A2 "Układ i edytor"

**Generated**: 2026-10-08
**Task Path**: `.maister/tasks/development/2026-10-07-organizer-layout-editor-a2`
**Feature Type**: Enhancement (the public organizer page and its entry points) plus a new subsystem (layout registry and editor sheet)
**Frontend root**: `src/frontend/src/` (all paths below are relative to it)

Legend used in diagrams: `NEW` = new file or element · `MOD` = existing file changed · `EXIST` = reused as is · `[owner]` = rendered only for the owner (`mode === "owner-edit"`) · `[visitor]` = what everyone else sees.

Binding inputs: `analysis/scope-clarifications.md` (C-1, C-2, I-3, I-4, I-5, I-8), `analysis/clarifications.md`, HLD §5–§7. Where the HLD sketches disagree with the scope clarifications, the mockups follow the clarifications:
- Ghosts are non-interactive. There is no "+ Dodaj opis" button.
- In the Układ tab, the picker shows only CLASSIC and LINKS.
- There is no "Treść" tab.

---

## Overview

### UI Requirements
- The public page `/:slug` renders through `LayoutRenderer` inside `OrganizerThemeScope`, using two layouts: CLASSIC and LINKS. A2 data is name, slug and colors only.
- Owner-only extras on that page:
  - ghost blocks
  - the "Edytuj wygląd" button
  - the editor sheet on `?edit=1`
- The editor sheet is non-modal and has two tabs:
  - **Układ**: layout cards with SVG thumbnails and a "Polecany" badge.
  - **Kolory**: presets, a "Własny" picker, mini previews and "Przywróć domyślne".
- The sheet footer has Anuluj and Zapisz, plus an error area and a saved state.
- An unsaved-changes confirm dialog appears on X and on in-app navigation.
- Entry points: the AccountMenu "Moja organizacja" item and the HomeView HintCard (copy changed).

### Integration Strategy
**Decision**: Everything the visitor and the owner see on `/:slug` lives inside one `OrganizerThemeScope` subtree, in `pages/organizer/PublicOrganizationPage.tsx`, which replaces `pages/PublicOrganizationPage.tsx`. The editor is a Tailwind bottom sheet that copies the `ModalSheet` chrome without the scrim, docked under the live page. No Chakra components and no portals are used.
**Rationale**: The page under the sheet *is* the preview. The scope receives `draft.theme` and the renderer receives `draft.pageLayout`, so the preview is the real renderer and not a second rendering path. Portals (Chakra Drawer, `ConfirmDialog`) would escape the scope and lose the draft palette (HLD §5.1 rule 4).

---

## Existing Layout Analysis

### Application Structure
- `router.tsx:158-166`: the catch-all `/:organizationSlug` route sits under `components/layout/PublicLayout.tsx`, with no AuthGuard.
- `PublicLayout` (EXIST) renders, for logged-in users only, a sticky top bar `nav[aria-label="Menu konta"]` (`z-20`, `bg-paper`) with `NotificationBell` and `AccountMenu showPanelHome`. Below it is `<main><Outlet/></main>`. This bar is **platform chrome**: it sits outside the theme scope and always uses the default palette.
- `pages/PublicOrganizationPage.tsx` (MOD, then moved) today renders a single centered card (`max-w-[440px]`, `rounded-[22px] border-line bg-paper`) inside `OrganizerThemeScope`.

**Key Components**:
- Layout: `components/layout/PublicLayout.tsx`, `theme/OrganizerThemeScope.tsx`
- Navigation: `components/shared/AccountMenu.tsx` (`ACCOUNT_MENU_ITEM_CLASS`, `role="menu"`), `pages/panel/views/HomeView.tsx` + `pages/panel/panelComponents.tsx#HintCard`
- Overlay chrome: `components/krag/ModalSheet.tsx` (`fixed inset-0 z-[60]`, `rounded-t-[24px] bg-paper p-5`, `max-w-[430px]`, title row with a `CloseIcon` button `h-[34px] w-[34px] rounded-full bg-cream`)
- Tabs: `pages/panel/views/WypozyczoneView.tsx:28-50` (`role="tablist"`, pill buttons `rounded-full border-[1.5px] px-3.5 py-2 text-[12px] font-extrabold`, active `bg-ink text-[#EAF2E9]`, `aria-controls`/`aria-labelledby`)
- Toast: `pages/krag/hooks/useToast.ts` + the pill at `PublicTermView.tsx:180-184` (`fixed bottom-[90px] left-1/2 z-[120] rounded-full bg-ink text-on-ink`, `role="status"`)
- Copy-link pattern: `PanelDataContext.tsx:1217` (`navigator.clipboard.writeText` + `showToast("Skopiowano link")`)
- Icons: `pages/panel/panelIcons.tsx` (`CloseIcon`, `PencilIcon`, `CopyIcon`, `EyeIcon`, `BuildingIcon`), `components/shared/Icons.tsx` (lucide re-exports, `PhotoPlaceholder`)
- Dashed empty pattern: `HomeView.tsx` "Brak zaplanowanych terminów." (`rounded-2xl border-[1.5px] border-dashed border-line py-[26px] text-center text-[13.5px] text-ink-soft`). Ghost blocks use this pattern.

### Identified Patterns
- **430px phone column**: sheets and cards cap at `max-w-[430px]`. The public pages center one column on a `stage` background.
- **Card language**: `rounded-[22px] border border-line bg-paper p-5`. Inner items use `rounded-2xl`.
- **Bottom sheet → centered dialog at ≥520px** (`min-[520px]:items-center min-[520px]:rounded-[24px]`).
- **Pill tabs** rendered by hand, with full ARIA wiring.
- **Close button**: round `bg-cream`, `hover:bg-danger-soft hover:text-danger`, `aria-label="Zamknij"`.
- **Role tokens only** on public pages (`bg-primary`, `text-on-primary`, `text-primary-fg`, `bg-primary-soft`, `bg-accent-soft text-accent-fg`), with no hex values (HLD §5.1 rule 1).

---

## Mockups

<a id="org-public-classic"></a>
### Mockup 1: Public page, CLASSIC (`screen:org-public-classic`)

**Context**: `/:slug` when `resolveLayout(page_layout)` is CLASSIC. CLASSIC is also the fallback for unknown keys. Blocks in order are `hero:cover→color` · `share` · `about:full` (primary, ghost in A2) · `footer`. Frame `column`.

```
 Visitor (anon or other user)                Owner (logged in, sheet closed)
┌──────────────────────────────────────────┐┌──────────────────────────────────────────┐
│                                          ││ PublicLayout nav  (EXIST, default palette)│
│  (no PublicLayout bar for anon)          ││            [🔔 Bell] [☰ AccountMenu]     │
│                                          │├──────────────────────────────────────────┤
│┌─ OrganizerThemeScope (MOD) ────────────┐││┌─ OrganizerThemeScope (MOD) ────────────┐│
││ hero:color  blocks/HeroBlock.tsx  NEW  │││ hero:color                             ││
││▓▓▓▓▓▓▓▓▓▓▓▓ bg-primary ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│││▓▓▓▓▓▓▓▓▓▓▓▓ bg-primary ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓││
││▓  ( RG )   text-on-primary            ▓│││▓  ( RG )                             ▓││
││▓  Rodzinny Grajdołek     <h1> serif   ▓│││▓  Rodzinny Grajdołek                  ▓││
││▓  domena.pl/rodzinny-grajdolek        ▓│││▓  domena.pl/rodzinny-grajdolek        ▓││
││▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│││▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓││
││                                        │││                                        ││
││ share  blocks/ShareBlock.tsx  NEW      │││ share                                  ││
││ [ ↗ Udostępnij ]  bg-primary-soft      │││ [ ↗ Udostępnij ]                       ││
││                                        │││                                        ││
││ about:full  (primary slot, empty in A2)│││ about:full  [owner] GHOST              ││
││   → skipped for visitors               │││ ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐ ││
││   → OPEN POINT: empty primary would    │││ │  Opis — wkrótce                    │ ││
││     inject empty-state:visitor (below) │││ │  Tu pojawi się opis Twojej         │ ││
││ ┌────────────────────────────────────┐ │││ │  organizacji. Widzisz to tylko Ty. │ ││
││ │ Ta strona dopiero powstaje.        │ │││ └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘ ││
││ │ Zajrzyj tu wkrótce.                │ │││   border-dashed border-line, no button ││
││ └────────────────────────────────────┘ │││                                        ││
││                                        │││                                        ││
││ footer:minimal  blocks/FooterBlock NEW │││ footer:minimal                         ││
││ ───── Strona utworzona w <platforma> ──│││ ───── Strona utworzona w <platforma> ──││
│└────────────────────────────────────────┘││                                        ││
│                                          │││        ┌──────────────────────┐        ││
│                                          │││        │ ✎ Edytuj wygląd      │ NEW    ││
│                                          │││        └──────────────────────┘        ││
│                                          │││   fixed pill, bottom-center, [owner]   ││
│                                          ││└────────────────────────────────────────┘│
└──────────────────────────────────────────┘└──────────────────────────────────────────┘
```

**Integration Points**:
- ✅ `pages/organizer/PublicOrganizationPage.tsx` (NEW location, MOD content) keeps today's loading state ("Wczytywanie…") and not-found state ("Nie znaleziono strony" / "Ta organizacja nie istnieje.") without changes. Only the success branch switches to `LayoutRenderer`.
- ✅ The hero `cover` variant has no image in A2 and degrades to `color`: a `bg-primary` band with an initials avatar (`Avatar` from `components/shared/Avatar.tsx`) and the name as `<h1>`.
- ✅ The `share` button uses `navigator.share` when it exists, otherwise `navigator.clipboard.writeText(location.href)`. Clipboard success shows the toast "Skopiowano link" (`useToast` pattern, `PublicTermView.tsx:180` pill).
- ✅ When the primary slot is empty for a visitor, the renderer injects `empty-state:visitor` (HLD §6.1 rule 2). For CLASSIC, `share` is already present, so the renderer does not add a duplicate.
- ⚠ Open point for the spec: whether CLASSIC should show the visitor empty-state card at all in A2, or only hero, share and footer as in HLD Example 3. Example 3 says the visitor sees only hero, "Udostępnij" and footer. **Recommendation: follow Example 3** and keep `empty-state:visitor` for B, so that a new page does not look "unfinished" to visitors.

<a id="org-public-links"></a>
### Mockup 2: Public page, LINKS "Wizytówka" (`screen:org-public-links`)

**Context**: `page_layout = "LINKS"`. Blocks are `hero:centered` · `link-stack:buttons` (primary; only "Udostępnij stronę" in A2) · `about:short` (ghost) · `footer`. Frame `centered`, so the column is vertically centered on a cream background with a soft primary tint.

```
 Visitor                                     Owner (sheet closed)
┌──────────────────────────────────────────┐┌──────────────────────────────────────────┐
│┌─ OrganizerThemeScope ──────────────────┐││ PublicLayout nav (EXIST)    [🔔] [☰]    ││
││ bg-cream, top fade bg-primary-soft     ││├──────────────────────────────────────────┤
││                                        │││ bg-cream / primary-soft fade           ││
││               ┌──────┐                 │││               ┌──────┐                 ││
││               │  RG  │ bg-primary      │││               │  RG  │                 ││
││               └──────┘ text-on-primary │││               └──────┘                 ││
││          Rodzinny Grajdołek            │││          Rodzinny Grajdołek            ││
││     domena.pl/rodzinny-grajdolek       │││     domena.pl/rodzinny-grajdolek       ││
││                                        │││                                        ││
││ link-stack  blocks/LinkStackBlock NEW  │││ link-stack                             ││
││ ┌────────────────────────────────────┐ │││ ┌────────────────────────────────────┐ ││
││ │ ↗  Udostępnij stronę               │ │││ │ ↗  Udostępnij stronę               │ ││
││ └────────────────────────────────────┘ │││ └────────────────────────────────────┘ ││
││  bg-primary text-on-primary, h≥48px    │││                                        ││
││                                        │││ about:short [owner] GHOST              ││
││   (about:short → nothing for visitors) │││ ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐ ││
││                                        │││ │  Opis — wkrótce                    │ ││
││                                        │││ └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘ ││
││                                        │││                                        ││
││ ─────── Strona utworzona w … ───────── │││ ─────── Strona utworzona w … ───────── ││
│└────────────────────────────────────────┘││        [ ✎ Edytuj wygląd ]  [owner]    ││
└──────────────────────────────────────────┘└──────────────────────────────────────────┘
```

**Integration Points**:
- ✅ In A2, CLASSIC and LINKS differ mostly in framing (C-2). The spec should state this. Task B adds terms and exchange buttons to `link-stack` without changing keys.
- ✅ The link-stack "Udostępnij stronę" is the same share action as `ShareBlock`. Extract a shared `useSharePage()` helper (or a `ShareButton`) that both blocks use, so that they don't fork.
- ✅ "Udostępnij stronę" is the primary-slot block, so it is never empty and never needs `empty-state` injection.

<a id="ghost-block"></a>
### Mockup 3: Ghost block (`component:ghost-block`)

**Context**: the renderer in `mode="owner-edit"` replaces an empty slot with a placeholder (C-1). In A2 only `about` (full or short) produces a ghost.

```
┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐
│  Opis — wkrótce                    [👁] │   text-[13.5px] font-bold text-ink-soft
│  Tu pojawi się opis Twojej              │   text-[12.5px] text-ink-soft
│  organizacji. Widzisz to tylko Ty.      │
└ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘
 rounded-2xl border-[1.5px] border-dashed border-line bg-transparent px-4 py-5
 EyeIcon (panelIcons, decorative, aria-hidden) = "visible only to you"
```

- A `<div>` with no role, no tabindex, no button and no link, so it adds no dead action. The full text is readable to screen readers ("Widzisz to tylko Ty.").
- Lives in `pages/organizer/blocks/GhostBlock.tsx` (NEW), or as a branch in `LayoutRenderer`. Copy comes from a per-block map (`about` → "Opis — wkrótce"). Task C replaces the ghost with a real CTA.
- Tested invariant: ghosts never render in `mode="visitor"`. They render for the owner both with the sheet open and closed, because the owner always sees the owner view.

<a id="edit-appearance-button"></a>
### Mockup 4: "Edytuj wygląd" button (`component:edit-appearance-button`)

```
                ┌───────────────────────────┐
                │  ✎  Edytuj wygląd          │   fixed bottom-6 left-1/2 -translate-x-1/2
                └───────────────────────────┘   z-[50] rounded-full bg-ink text-on-ink
                                                 px-5 py-3 text-sm font-extrabold, h≥44px
                 PencilIcon (panelIcons, c=currentColor)
```

- Rendered only when `isOwner && !sheetOpen`. Click: `setSearchParams({edit: "1"}, {replace: true})`, then the sheet opens and focus moves into the sheet title.
- It uses the dark `bg-ink` toast style rather than `bg-primary`, so it reads as owner chrome and not as part of the organizer's design. It also stays legible with any palette.
- The page gets `pb-24` while the owner pill is visible, so the footer is not covered.
- The `-translate-x-1/2` sits on the pill itself, not on the scope element, so rule 4 is respected.

<a id="org-edit-sheet-layout"></a>
### Mockup 5: Editor sheet, "Układ" tab (`screen:org-edit-sheet-layout`)

**Context**: `/:slug?edit=1` once `useMyOrganization().data?.slug === slug` (I-8). The page above shows the draft live, here after picking LINKS. The sheet is non-modal: no scrim, and the page stays scrollable.

```
┌──────────────────────────────────────────┐
│ PublicLayout nav (EXIST)       [🔔] [☰]  │
├──────────────────────────────────────────┤
│┌ OrganizerThemeScope theme=draft.theme ─┐│  ← live preview = real LayoutRenderer
││           ┌──────┐                     ││     layout=draft.pageLayout, mode=owner-edit
││           │  RG  │                     ││
││      Rodzinny Grajdołek                ││
││ [ ↗ Udostępnij stronę ]                ││
││ ┌ ─ Opis — wkrótce ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐ ││  ghost
││  (page padding-bottom = sheet height)  ││
││════════════════════════════════════════││
││ EditorSheet  pages/organizer/editor/   ││  NEW  fixed bottom-0 z-[60]
││ EditorSheet.tsx                        ││  max-w-[430px] mx-auto
││ ┌────────────────────────────────────┐ ││  rounded-t-[24px] bg-paper
││ │ Wygląd strony                 [✕]  │ ││  shadow-[0_-16px_34px_-16px_…]
││ │                                    │ ││  role="dialog" aria-modal="false"
││ │ (●Układ)  ( Kolory )               │ ││  ← tablist (WypozyczoneView pattern)
││ │ ── tabpanel: LayoutTab.tsx NEW ──  │ ││     max-h-[55vh] overflow-y-auto
││ │ ┌──────────────┐ ┌──────────────┐  │ ││
││ │ │┌────────────┐│ │┌────────────┐│  │ ││  LayoutCard ×2, grid-cols-2 gap-2.5
││ │ ││ classic.svg││ ││ links.svg  ││  │ ││  assets/layouts/*.svg (static, alt)
││ │ ││ ▓▓▓▓▓▓▓▓▓▓ ││ ││    (○)     ││  │ ││
││ │ ││ ▭ ▭▭▭▭     ││ ││   ▭▭▭▭▭    ││  │ ││
││ │ ││ ┄┄┄┄┄┄     ││ ││   ▭▭▭▭▭    ││  │ ││
││ │ │└────────────┘│ │└────────────┘│  │ ││
││ │ │ Klasyczny    │ │ Wizytówka    │  │ ││  label  text-sm font-bold
││ │ │              │ │ [★ Polecany] │  │ ││  badge bg-accent-soft text-accent-fg
││ │ │ Profil z     │ │ Same linki   │  │ ││  "dla kogo" text-[12px] text-ink-soft
││ │ │ opisem i     │ │ jak w bio na │  │ ││
││ │ │ terminami.   │ │ Instagramie. │  │ ││
││ │ │          ( ) │ │          (●) │  │ ││  selected: border-2 border-primary
││ │ └──────────────┘ └──────────────┘  │ ││            + bg-primary-soft + ✓
││ │                                    │ ││
││ │ [ error area, hidden when none ]   │ ││  role="alert", see Mockup 9
││ ├────────────────────────────────────┤ ││  sticky footer, border-t border-line
││ │ │ [  Anuluj  ]        [  Zapisz  ]   │ ││  Anuluj: border-line bg-cream
││ │ └────────────────────────────────────┘ ││  Zapisz: bg-primary text-on-primary
││ └────────────────────────────────────────┘│  disabled → opacity-50 cursor-not-allowed
│└──────────────────────────────────────────┘│
└────────────────────────────────────────────┘
```

**Integration Points**:
- ✅ The sheet chrome copies `components/krag/ModalSheet.tsx`: title row, `CloseIcon` button classes, `rounded-t-[24px] bg-paper p-5`, `max-w-[430px]`. It **drops** the `fixed inset-0 bg-scrim` wrapper (non-modal) and the click-outside-to-close behavior. Do not import `ModalSheet` itself, because it is modal and scrimmed. Mirror the classes instead.
- ✅ The sheet is mounted as a child of `OrganizerThemeScope theme={draft.theme}` with no portal. Its buttons, swatches and previews therefore render in the draft palette automatically.
- ✅ Layout cards form a radio group: `role="radiogroup" aria-label="Układ strony"`, with each card `role="radio" aria-checked` (or a visually hidden `<input type="radio">` inside a `<label>`). Arrow keys move the selection. The "Polecany" badge is text and does not rely on color.
- ✅ The "Polecany" rule in A2 is `recommendWhen` from the registry, and only LINKS has one. With no directory data in A2 it is always true, so LINKS always carries the badge. The spec should state this.
- ✅ Card order follows registry order: CLASSIC first (default and fallback), then LINKS. There are no "wkrótce" cards (`minimal-implementation.md`).
- ✅ Selecting a card only sets `draft.pageLayout`. The page above re-renders immediately and nothing is saved until "Zapisz".

**Footer states**:
```
 clean draft           dirty                 saving                  saved (until next change)
[Anuluj] [Zapisz]    [Anuluj] [Zapisz]    [Anuluj] [Zapisywanie…]   ✓ Zapisano   [Anuluj] [Zapisz]
 both disabled*       both enabled          both disabled,           role="status" text-primary-fg,
                                            aria-busy on sheet       buttons back to "clean"
 * Anuluj is disabled when there is nothing to discard
```
- "Anuluj" resets `draft` to the server state. The sheet **stays open** (I-4).
- "Zapisz" sends PATCH with only the changed fields and awaits invalidation of `publicOrganization` + `myOrganization`. The sheet stays open, `draft` becomes the server state, and the footer shows "✓ Zapisano" (HLD §9.4).

<a id="org-edit-sheet-colors"></a>
### Mockup 6: Editor sheet, "Kolory" tab (`screen:org-edit-sheet-colors`)

**Context**: the same sheet with the second tab. The page above re-themes immediately when a tile is chosen.

```
││ ┌────────────────────────────────────┐ ││
││ │ Wygląd strony                 [✕]  │ ││
││ │ ( Układ )  (●Kolory)               │ ││
││ │ ── tabpanel: ColorsTab.tsx NEW ──  │ ││
││ │ Gotowe palety          text-xs     │ ││  section label (FormField label style:
││ │                                    │ ││  text-xs font-extrabold tracking-wide
││ │ ┌──────┐┌──────┐┌──────┐┌──────┐   │ ││  text-ink-soft)
││ │ │ ◐ ✓  ││  ◐   ││  ◐   ││  ◐   │   │ ││  PresetTile ×N, grid-cols-4 gap-2
││ │ │Mięta ││Ocean ││Lawen-││Malina│   │ ││  swatch: 36px circle, left half
││ │ │(domy-││      ││ da   ││      │   │ ││  primary / right half accent
││ │ │ślna) ││      ││      ││      │   │ ││  name text-[11.5px] font-bold
││ │ └──────┘└──────┘└──────┘└──────┘   │ ││  selected: ring-2 ring-ink + ✓
││ │ ┌──────┐┌──────┐┌──────┐┌──────┐   │ ││  (ring-ink, not primary: visible
││ │ │  ◐   ││  ◐   ││  ◐   ││  ◐   │   │ ││   whatever the palette)
││ │ │Słońce││ Las  ││Terak-││Grafit│   │ ││
││ │ │      ││      ││ ota  ││      │   │ ││
││ │ └──────┘└──────┘└──────┘└──────┘   │ ││
││ │ ┌──────┐┌──────┐┌──────┐           │ ││
││ │ │  ◐   ││  ◐   ││ ┌┄┐  │           │ ││
││ │ │Śliwka││Morze ││ │+│  │           │ ││  "Własny" tile: dashed swatch with +
││ │ │      ││Półn. ││Własny│           │ ││  opens the custom picker below
││ │ └──────┘└──────┘└──────┘           │ ││
││ │                                    │ ││
││ │ Podgląd                            │ ││  mini previews (Mockup 8)
││ │ ┌───────────────┐┌───────────────┐ │ ││  grid-cols-2 gap-2.5
││ │ │ TermPreview   ││ ProductPreview│ │ ││
││ │ └───────────────┘└───────────────┘ │ ││
││ │                                    │ ││
││ │ Przywróć domyślne                  │ ││  text link, text-primary-fg underline
││ │                                    │ ││  hidden/disabled when draft == default
││ ├────────────────────────────────────┤ ││
││ │ [  Anuluj  ]        [  Zapisz  ]   │ ││
││ └────────────────────────────────────┘ ││
```

**Integration Points**:
- ✅ The tiles form `role="radiogroup" aria-label="Paleta kolorów"`. Each tile is a radio with the accessible name "Ocean" or "Mięta (domyślna)", and the selection is shown by a ✓ as well as color.
- ✅ "Mięta (domyślna)" is the first tile and maps to `{palette_preset: null, primary_color: null, accent_color: null}` (I-3). There is no `MINT` key. It is selected when the draft has all three fields null.
- ✅ A preset tile writes `palette_preset=<key>` plus that preset's base `primary_color`/`accent_color` (clarification on preset precedence). Swatch colors come from `theme/palettePresets.ts` (NEW). These are the only literal colors allowed, set via inline `style` on the swatch, which is a color sample and not themed UI.
- ✅ "Przywróć domyślne" sets the same values as the Mięta tile. It is redundant with that tile, but it is the label owners look for. Keep both, as the scope requires.
- ✅ The preset count (8–12) and names follow the working list in HLD §5.2: Mięta, Ocean, Lawenda, Malina, Słońce, Las, Terakota, Grafit, Śliwka, Morze Północne, which with "Własny" makes 11 tiles.

<a id="custom-color-picker"></a>
### Mockup 7: "Własny" custom picker (`component:custom-color-picker`)

**Context**: expands under the preset grid when the "Własny" tile is selected. It is also preselected when the stored theme has `palette_preset=null` and `primary_color` set.

```
││ │ ┌──────┐                           │ ││
││ │ │(●)+  │ Własny  ← selected tile    │ ││
││ │ └──────┘                           │ ││
││ │ ┌─ CustomColorPicker.tsx NEW ────┐ │ ││  rounded-2xl border border-line
││ │ │ Kolor główny *                 │ │ ││  bg-cream p-4
││ │ │ [■] [ #3498db              ]   │ │ ││  <input type="color"> 44×44 + text
││ │ │                                │ │ ││  <input> (label for=, inputMode text)
││ │ │ ⓘ Lekko przyciemniliśmy kolor  │ │ ││  shown when primaryDarkened
││ │ │   dla czytelności.             │ │ ││  text-[12.5px] text-ink-soft, role=status
││ │ │                                │ │ ││
││ │ │ Akcent                         │ │ ││
││ │ │ (●) Automatyczny               │ │ ││  radio pair: null ↔ own color
││ │ │ ( ) Własny  [■] [ #f1c40f   ]  │ │ ││  inputs disabled until "Własny"
││ │ └────────────────────────────────┘ │ ││
```

Alternate hint and validation states:
```
 tooLight:                                 invalid hex (text input):
 ⓘ Ten kolor jest bardzo jasny —           [ #34z8db ]  border-danger
   przyciemniliśmy go wyraźnie, żeby       ⚠ Podaj kolor w formacie #RRGGBB
   tekst był czytelny.                       text-danger, aria-describedby
                                             draft keeps last valid color
```

- `describeColorAdjustment(primary) → { primaryDarkened, tooLight }` (I-2, `theme/orgPalette.ts` MOD) drives the hint. When neither flag is set there is no hint.
- The primary color is required. While "Własny" is selected with no valid primary, "Zapisz" stays disabled.
- The draft writes `palette_preset: null`, `primary_color: <hex>`, `accent_color: <hex> | null`. HLD Example 1: `#3498db` previews as `#047cbe`, and the hint is visible.
- The text input commits on valid input (on change with a regex, or on blur). The color input commits on `input`. The live page re-themes on every valid change, so no extra preview is needed.
- The tooLight copy is a proposal. The scope only fixes the "Lekko przyciemniliśmy kolor dla czytelności" text.

<a id="preview-cards"></a>
### Mockup 8: Mini preview cards (`component:preview-cards`)

**Context**: inside the Kolory tab. These show how the draft palette looks on the *other* themed surfaces (term page CTA, product pill) that the owner cannot see on `/:slug`. They are static sample data, not full pages.

```
┌ TermPreviewCard.tsx NEW ──────┐ ┌ ProductPreviewCard.tsx NEW ───┐
│ ┌────┐                        │ │ ┌───────────────────────────┐ │
│ │ 14 │ Muzyczne Maluchy       │ │ │   PhotoPlaceholder (EXIST)│ │
│ │paź │ wt · 16:30             │ │ └───────────────────────────┘ │
│ └────┘ bg-primary-soft        │ │ Kask rowerowy                 │
│ ┌───────────────────────────┐ │ │ (Dostępna)  (Oddam)           │
│ │      Zapisz się  →        │ │ │  ^primary-fg  ^bg-primary-soft│
│ └───────────────────────────┘ │ │   on primary-  text-ink       │
│  bg-primary text-on-primary   │ │   soft pill                   │
└───────────────────────────────┘ └───────────────────────────────┘
 rounded-2xl border border-line bg-paper p-3, aria-hidden="true" on
 the interactive-looking parts; wrapper role="img" aria-label=
 "Podgląd terminu w wybranych kolorach" / "Podgląd produktu …"
```

- Date tile classes mirror `HomeView` term rows (`h-[46px] w-[46px] rounded-[13px] bg-mint-soft` → `bg-primary-soft`). Pill semantics follow HLD §6.2: GIFT = `primary-soft`, SWAP = `accent-soft`.
- The cards are non-interactive (`<div>`, no buttons), so the fake CTA is not focusable.
- The HLD's "Strona / Termin / Produkt" toggle is **not** needed. Both cards fit side by side at 430px, and the page itself is the "Strona" preview.

<a id="save-error"></a>
### Mockup 9: Save error area (`component:save-error`)

```
││ │ ┌────────────────────────────────┐ │ ││
││ │ │ ⚠ Ktoś zmienił tę stronę w     │ │ ││  rounded-2xl bg-danger-soft text-danger
││ │ │   międzyczasie. Odśwież stronę │ │ ││  px-4 py-3 text-[13px] font-semibold
││ │ │   i spróbuj ponownie.          │ │ ││  role="alert", just above the footer
││ │ └────────────────────────────────┘ │ ││
││ ├────────────────────────────────────┤ ││
││ │ [  Anuluj  ]        [  Zapisz  ]   │ ││  draft is kept; Zapisz re-enabled
```
| Status | Message (via `extractProblemMessage` / `serverMessageOr`, `api/problem.ts`) |
|---|---|
| 400 | Server message if present, otherwise "Nie udało się zapisać wyglądu. Wybierz układ i kolory jeszcze raz." |
| 403 | Existing Polish 403 text from `serverMessageOr` (no access to this organization) |
| 409 | "Ktoś zmienił tę stronę w międzyczasie. Odśwież stronę i spróbuj ponownie." |
| network/5xx | "Nie udało się zapisać. Spróbuj ponownie." |

The error clears on the next draft change or the next save attempt.

<a id="unsaved-confirm"></a>
### Mockup 10: Unsaved-changes confirm (`component:unsaved-confirm`)

**Context**: triggered (I-4) by the sheet X while dirty, and by in-app navigation while dirty (`useBlocker`). Examples of in-app navigation are an AccountMenu link in `PublicLayout` and the browser Back to an in-app route. There is no `beforeunload`.

```
┌──────────────────────────────────────────┐
│░░░░░░░░░░░░ bg-scrim (fixed inset-0) ░░░░│  z-[70], above the sheet (z-[60])
│░░┌────────────────────────────────────┐░░│  inside OrganizerThemeScope, no portal
│░░│ Odrzucić zmiany?                   │░░│  role="alertdialog" aria-modal="true"
│░░│                                    │░░│  aria-labelledby / aria-describedby
│░░│ Wybrany układ i kolory nie zostały │░░│  text-sm text-ink-soft
│░░│ zapisane.                          │░░│
│░░│                                    │░░│
│░░│ [ Wróć do edycji ]   [  Odrzuć  ]  │░░│  Wróć: bg-cream border-line (autofocus)
│░░└────────────────────────────────────┘░░│  Odrzuć: bg-danger text-paper
│░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│  max-w-[340px] rounded-[24px] bg-paper p-5
└──────────────────────────────────────────┘  centered on all widths
```

- "Wróć do edycji", Esc and a scrim click do the same thing: close the dialog, call `blocker.reset()` when it was the trigger, and return focus to the element that triggered it.
- "Odrzuć" depends on the trigger. From X: reset the draft, close the sheet and drop `?edit=1` (`replace`). From navigation: `blocker.proceed()`.
- Lives in `pages/organizer/editor/UnsavedChangesDialog.tsx` (NEW). It is a Tailwind dialog modeled on `ModalSheet` chrome (`bg-scrim`, `rounded-[24px] bg-paper p-5`) and **not** `components/shared/ConfirmDialog.tsx`, which is a Chakra portal and would leave the scope.
- Focus trap: Tab cycles between the two buttons while the dialog is open.

<a id="editor-entry-flow"></a>
### Mockup 11: Editor entry and exit flow (`flow:editor-entry`)

```
 AccountMenu "Moja organizacja" ─┐
 HomeView hint "Przejdź →" ──────┼──► /rodzinny-grajdolek?edit=1
 "Edytuj wygląd" pill (on page) ─┘              │
                                                ▼
                       usePublicOrganization(slug) + useMyOrganization()
                                                │
            ┌───────────────────────────────────┼─────────────────────────────┐
            ▼                                   ▼                             ▼
   loading (either query)            myOrg.slug === slug            anon / other user /
   "Wczytywanie…" (public),          → mode="owner-edit"            myOrg 404 / error
   then page renders; sheet          → EditorSheet opens,           → ?edit=1 silently
   waits for the owner check         focus to "Wygląd strony"       ignored, visitor view,
   (no flash of the sheet)           draft := server data           no message
                                                │
             ┌──────────────────────────────────┼──────────────────────┐
             ▼                                  ▼                      ▼
        [✕] clean                          [✕] dirty             in-app link, dirty
        close sheet,                       UnsavedChangesDialog   useBlocker → same dialog
        drop ?edit=1 (replace),            Odrzuć → close         Odrzuć → proceed
        show "Edytuj wygląd" pill          Wróć → stay            Wróć → reset blocker
```

- The owner without `?edit=1` gets owner mode (ghosts and pill) with the sheet closed.
- Esc on the sheet itself does **not** close it. The sheet is non-modal, and Esc belongs to the confirm dialog only. This prevents accidental loss of the draft. Closing is explicit via X.

<a id="account-menu-entry"></a>
### Mockup 12: AccountMenu entry (`component:account-menu-entry`)

**Context**: `components/shared/AccountMenu.tsx:63-70` (MOD). It is used by the Panel header and `PublicLayout`.

```
                     ┌──────────────────────────┐
                     │ ⌂  Mój panel             │  (showPanelHome only)
                     │ 👤 Profil                │
                     │ ⚙  Ustawienia            │
                     │ 🏢 Moja organizacja      │  ← MOD: to = slug
                     │ 👪 Mój dom               │     ? `/${slug}?edit=1`
                     └──────────────────────────┘     : "/organization"
                      role="menu", ACCOUNT_MENU_ITEM_CLASS (EXIST)
```
- Only the `to` changes. The label, icon and order stay the same, and no new item is added.
- When the owner is already on `/:slug`, the link sets `?edit=1` and the sheet opens in place. If a dirty draft exists, `useBlocker` does not fire because the route path stays the same. The blocker should only block on a pathname change. Spec note: `shouldBlock = dirty && current.pathname !== next.pathname`.
- Tests: update the href assertions in `PanelPage.test` and `PublicLayout.test`.

<a id="home-hint"></a>
### Mockup 13: HomeView HintCard (`component:home-hint`)

**Context**: `pages/panel/views/HomeView.tsx:77-86` (MOD), organizers only, dismissable. Copy and target change (I-5).

```
┌─────────────────────────────────────────────────┐
│ 🏢 Dopracuj stronę organizacji             [✕]  │  HintCard (EXIST, panelComponents.tsx)
│ Wybierz układ i kolory swojej strony —          │  border-mint bg-mint-soft
│ zobaczą je odwiedzający.                        │  ← MOD description
│ [ Przejdź → ]                                   │  ← MOD ctaTo = slug
└─────────────────────────────────────────────────┘     ? `/${slug}?edit=1` : "/organization"
```
- The title stays "Dopracuj stronę organizacji". Only the description changes, from "Dodaj opis, kolory i logo — zobaczą je odwiedzający." to "Wybierz układ i kolory swojej strony — zobaczą je odwiedzający.", so it no longer promises opis or logo before tasks C and D.
- The Panel is outside the theme scope, so the hint keeps the default palette (`mint` aliases) as today.

---

## Reusable Components

### Layout and scope
- **PublicLayout**: `components/layout/PublicLayout.tsx` (EXIST). Platform bar for logged-in users. Untouched, and it stays in the default palette.
- **OrganizerThemeScope**: `theme/OrganizerThemeScope.tsx` (MOD). The prop widens to the full `OrganizerTheme`, including `palette_preset`. Receives `draft.theme` while editing. Still no className or transform.
- **resolveOrgTheme / describeColorAdjustment**: `theme/orgPalette.ts` (MOD). Adds the preset branch and the new helper.
- **palettePresets**: `theme/palettePresets.ts` (NEW). Preset keys, names, base colors and var maps.

### Reused UI patterns (copy classes, don't import modal components)
- **ModalSheet chrome**: `components/krag/ModalSheet.tsx`. Title row, close button, `rounded-t-[24px] bg-paper p-5`, `max-w-[430px]`. **Use for** the EditorSheet and UnsavedChangesDialog shells.
- **Pill tabs**: `pages/panel/views/WypozyczoneView.tsx:28-50`. **Use for** the Układ/Kolory tabs (`editor-tab-uklad`/`editor-panel-uklad` ids, plus arrow-key roving as a small addition).
- **HintCard**: `pages/panel/panelComponents.tsx:46`. **Use for** the Home entry, props only.
- **Dashed empty box**: `HomeView.tsx` "Brak zaplanowanych terminów." **Use for** GhostBlock.
- **Toast**: `pages/krag/hooks/useToast.ts` + pill classes at `PublicTermView.tsx:180-184`. **Use for** "Skopiowano link" after share.
- **Avatar**: `components/shared/Avatar.tsx`. **Use for** hero initials.
- **PhotoPlaceholder**: `components/shared/Icons.tsx:57`. **Use for** ProductPreviewCard.
- **Icons**: `pages/panel/panelIcons.tsx`. `CloseIcon` (sheet, dialog), `PencilIcon` ("Edytuj wygląd"), `EyeIcon` (ghost), `CopyIcon` or a lucide `Share2` via `Icons.tsx` (share).

### New files (`pages/organizer/…`)
| File | Role |
|---|---|
| `pages/organizer/PublicOrganizationPage.tsx` | replaces `pages/PublicOrganizationPage.tsx`; owner detection, `?edit=1`, draft state, scope + renderer + sheet |
| `pages/organizer/LayoutRenderer.tsx` | visitor/owner rules, ghost, empty-state injection |
| `pages/organizer/layouts/{types,registry}.ts`, `definitions/{classic,links}.ts` | registry (trimmed contract, I-6) |
| `pages/organizer/blocks/{HeroBlock,ShareBlock,AboutBlock,LinkStackBlock,EmptyStateBlock,FooterBlock,GhostBlock}.tsx` | blocks |
| `pages/organizer/editor/EditorSheet.tsx` | sheet shell, tabs, footer, error |
| `pages/organizer/editor/LayoutTab.tsx`, `LayoutCard.tsx` | Układ tab |
| `pages/organizer/editor/ColorsTab.tsx`, `PresetTile.tsx`, `CustomColorPicker.tsx` | Kolory tab |
| `pages/organizer/editor/TermPreviewCard.tsx`, `ProductPreviewCard.tsx` | mini previews |
| `pages/organizer/editor/UnsavedChangesDialog.tsx` | confirm |
| `assets/layouts/classic.svg`, `links.svg` | static thumbnails |

---

## Implementation Notes

### Consistency Checklist
- ✅ Only role tokens inside the scope (`bg-primary`, `text-on-primary`, `text-primary-fg`, `bg-primary-soft`, `bg-accent-soft`/`text-accent-fg`). Never `mint`/`lime` aliases or hex values on `/:slug`. Exception: preset swatch samples set via inline style.
- ✅ Sheet and dialog reuse the ModalSheet radii, padding, close button and `max-w-[430px]`.
- ✅ Tabs reuse the WypozyczoneView pill style and ARIA ids.
- ✅ The owner pill and the toast share the `bg-ink text-on-ink rounded-full` chrome.
- ✅ No Chakra (`Drawer`, `ConfirmDialog`, `PrimaryButton`) on this page, because they portal or use the blue palette.
- ✅ `/organization` (`pages/OrganizationPage.tsx`) is unchanged and not mocked.

### Accessibility Considerations
- Sheet: `role="dialog" aria-modal="false" aria-labelledby="editor-title"`. On open, focus moves to the title (`tabIndex=-1`). Tab order stays in the sheet while it is open, as HLD §7 requires ("focus trap tylko w obrębie arkusza"). The page above remains scrollable with pointer and touch.
- Tabs: `role="tablist"/"tab"/"tabpanel"`, `aria-selected`, `aria-controls`, Left/Right arrows.
- Layout cards and preset tiles: radiogroups with text labels. The selection is marked by ✓ and a border/ring, not color alone. Tap targets are at least 44px (`responsive.md`).
- Color inputs have explicit `<label>`. Hex errors are linked via `aria-describedby`. The adjustment hint is `role="status"`.
- Errors use `role="alert"`, and "✓ Zapisano" uses `role="status"`.
- The confirm dialog is `role="alertdialog"` with initial focus on the safe action ("Wróć do edycji").
- Ghosts and preview cards are non-focusable. Ghost text explicitly says it is visible only to the owner.
- Contrast: every preset passes the CI contrast test (HLD §5.2). The `bg-ink` owner pill is palette-independent.

### Responsive Behavior
- **Mobile (<520px, primary target)**: the page is a full-width 430px column. The sheet is docked at the bottom, full width, with `rounded-t-[24px]`, about 55vh tall, and its content scrolls inside. The page gets `padding-bottom` equal to the sheet height so the footer stays reachable. Preset grid 4 columns, layout cards 2 columns, preview cards 2 columns.
- **Desktop (≥520px)**: the page column stays centered at 430px on the `stage` background. The sheet stays bottom-docked (unlike ModalSheet, which centers), centered under the column with `max-w-[430px]`, `bottom-4` and `rounded-[24px]`, so the live page above is still visible. A side panel is a possible later improvement but is out of scope. The confirm dialog is centered.

---

## Alternatives Considered

### "Edytuj wygląd" in the PublicLayout top bar (Rejected)
**Why**: that bar is platform chrome outside the theme scope, and it does not know about page ownership. Adding page-specific actions there couples PublicLayout to organizer logic.

### "Edytuj wygląd" inside the hero (Rejected)
**Why**: the placement would be layout-specific (CLASSIC hero vs LINKS centered hero), it competes with "Udostępnij", and B/D will add hero content. The fixed bottom pill is layout-agnostic.

### Modal sheet with a scrim, reusing `ModalSheet` directly (Rejected)
**Why**: a scrim hides the live preview, which is the main value of the editor. `ModalSheet` also closes on outside click, which would silently discard the draft.

### Chakra `Drawer` / `ConfirmDialog` (Rejected)
**Why**: they portal out of `OrganizerThemeScope` and lose the draft palette (HLD §5.1 rule 4, gap-analysis I-4).

### Separate "Strona / Termin / Produkt" preview toggle (Rejected for A2)
**Why**: the page itself is the "Strona" preview, and two mini cards fit side by side. The toggle would add state for no gain.

### Non-modal bottom sheet in the scope + fixed owner pill (Selected)
**Why**: the live preview is the real renderer, the design matches existing ModalSheet/tab/toast patterns, and it is layout-agnostic and consistent with all binding decisions.

---

*Generated by ui-mockup-generator subagent*
