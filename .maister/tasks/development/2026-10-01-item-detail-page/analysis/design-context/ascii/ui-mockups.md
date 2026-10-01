# UI Mockups: Item detail page `/product/:id` (+ entry points)

**Generated**: 2026-10-01
**Task Path**: `.maister/tasks/development/2026-10-01-item-detail-page`
**Feature Type**: New Feature (new page) + Enhancement (RzeczyView, WypozyczoneView, PublicTermView, NotificationBell)

Binding decisions are taken from `analysis/scope-clarifications.md`. All copy is Polish. All paths are relative to `src/frontend/src/`.

---

## Overview

### UI Requirements
- A new standalone page at `/product/:id`, keyed by `InventoryItem.id` (UUID). It is AuthGuard'ed and visible to any logged-in user.
- **View mode**:
  - back link
  - gallery: up to 10 URLs, falling back to `Product.photo_url`, then to a placeholder
  - name, category, condition, description (from `plugin_data`)
  - "Aktualny status"
  - "Historia" timeline
  - "Edytuj" entry point (owner only)
- **Edit mode** (owner only): each field gets its own pencil and its own inline Zapisz/Anuluj, for name+category, condition, description and gallery.
- **States**: loading, not found, error + retry, deleted (banner, read-only), non-owner (no edit controls), empty history.
- **Entry points**:
  - Moje rzeczy (view + edit icons)
  - Wypożyczone (view icon)
  - term page listing title (link)
  - notification bell (new `ITEM_RESERVED_FOR_PICKUP` copy)

### Integration Strategy
**Decision**: A standalone PhoneFrame page, registered next to `/panel/terminy/:termId` in `router.tsx` under PublicLayout + `AuthGuard`. Its structure copies `pages/panel/TermAttendeesPage.tsx`:
- back link
- `h2`
- a `*Body` component that branches on loading/notFound/error before the content

The inline per-field edit UI copies the existing RzeczyView inline editors (input/select + mint "Zapisz" + outlined "Anuluj", Enter saves, Escape cancels).

**Rationale**:
- TermAttendeesPage is the only standalone Tailwind page outside `PanelDataProvider`, and it already has the needed state branching.
- The RzeczyView inline editors are the established pattern for editing this exact data (name/category, condition). Users already know them.

---

## Existing Layout Analysis

### Application Structure
```
PublicLayout (top account bar: AccountMenu + NotificationBell)
└─ PhoneFrame (components/shared/PhoneFrame.tsx): bg-cream, full-height mobile, floating "device" >=520px
   └─ scroll container  "flex-1 overflow-y-auto px-[18px] pb-6 pt-[18px]"
      ├─ back Link  "mb-4 inline-flex items-center gap-1.5 text-xs font-bold text-ink-soft" + <BackIcon/>
      ├─ h2  "text-[19px] font-semibold text-ink"
      └─ cards  "rounded-[22px] border border-line bg-paper p-5"
           └─ rows "rounded-2xl border border-line bg-cream p-[15px]"
```

**Key Components**:
- Layout: `components/shared/PhoneFrame.tsx`, `router.tsx` (PublicLayout children), `auth/AuthGuard.tsx` (redirects to `/login?returnTo=<pathname+search>`)
- Page template: `pages/panel/TermAttendeesPage.tsx` (`TermAttendeesBody`, `TermHeadCard`)
- Icons:
  - `pages/panel/panelIcons.tsx`: `BackIcon`, `PencilIcon`, `TrashIcon`, `CloseIcon`, `BoxIcon`, `GiftIcon`
  - `components/shared/Icons.tsx`: `PhotoPlaceholder` (lucide `Image`); `lucide-react` is available, e.g. for `Eye`, `ChevronUp`, `ChevronDown`
- Inline edit pattern: `pages/panel/views/RzeczyView.tsx` (name+category L208-260, condition L264-302)
- Helpers:
  - `utils/productCategory.ts` (`CONDITION_LABELS`)
  - `utils/url.ts` (`isValidImageUrl`)
  - `utils/dayjs.ts` (Polish locale)
  - `pages/panel/panelHelpers.ts` (`dayMonth`, `ITEM_MODE_STYLE`)
- Notification dropdown: `components/shared/NotificationBell.tsx` (already calls `navigate(n.link_path)`)
- Term rows: `pages/krag/PublicTermView.tsx` `toListingRow` → `pages/krag/components/AttendeeList.tsx` (`kg-bring-item` / `kg-bring-body`, CSS in `KragStage.tsx`)

### Identified Patterns
- **Status pill**: `rounded-full px-2.5 py-0.5 text-[10.5px] font-extrabold`. Mint variant: `bg-mint-soft text-[#12604D]`. Neutral variant: `border border-line bg-cream text-ink-soft`.
- **Text-carried status**: a dot plus a label (`role="status"`), never colour alone (RzeczyView `badgeLabel`).
- **Icon button**:
  - small: `h-6 w-6 rounded-[8px] text-ink-soft hover:bg-paper hover:text-ink` for the inline pencil
  - large: `h-[30px] w-[30px] rounded-[10px]` for the row-level trash
- **Primary small action**: `rounded-[9px] bg-mint px-3 py-1.5 text-[11.5px] font-extrabold text-white disabled:opacity-60`.
- **Secondary small action**: `rounded-[9px] border border-line px-2.5 py-1.5 text-[11.5px] font-extrabold text-ink-soft`.
- **Inline error**: `text-[12.5px] font-semibold text-danger`.
- **Empty block**: `rounded-2xl border border-dashed border-line p-[15px] text-[12.5px] text-ink-soft`.
- **Date tile**: `h-[46px] w-[46px] rounded-[13px] bg-mint-soft` with `day` in serif and `month` uppercase (TermHeadCard).
- **Mint text link**: `text-[12.5px] font-bold text-mint hover:underline` ("Zobacz stronę terminu ›").

---

## Mockups

<a id="item-page-view"></a>
### Mockup 1: Item page, view mode (owner)

**Context**: `/product/:id`, owner is viewing, item is lent out, photos present. Width is about 360px.

```
┌──────────────────────────────────────────────┐
│ [EXISTING] PublicLayout top bar   [🔔] [👤]   │
├──────────────────────────────────────────────┤
│ PhoneFrame  (bg-cream)                        │
│                                               │
│ ‹ Wróć                    ← BackIcon + Link    │
│                             (navigate(-1); see │
│                             Q3)                │
│ ┌──────────────────────────────────────────┐ │
│ │ NEW <ItemGallery>  (rounded-[22px] card) │ │
│ │ ┌──────────────────────────────────────┐ │ │
│ │ │                                      │ │ │
│ │ │          main photo 4:3              │ │ │
│ │ │   <img loading=lazy                  │ │ │
│ │ │    referrerPolicy=no-referrer        │ │ │
│ │ │    onError→PhotoPlaceholder>         │ │ │
│ │ │                              1 / 4   │ │ │  ← counter pill
│ │ └──────────────────────────────────────┘ │ │
│ │ ┌────┐┌────┐┌────┐┌────┐  → scroll-x    │ │  ← thumbnails strip
│ │ │▣on ││    ││    ││    │                │ │    (button, aria-label
│ │ └────┘└────┘└────┘└────┘                │ │     "Zdjęcie 2 z 4")
│ └──────────────────────────────────────────┘ │
│                                               │
│ Wózek spacerowy Baby Jogger    [✎ Edytuj]    │  ← h2 19px; owner-only
│ Wózki · Stan: Dobry                           │     pill button → edit
│                                               │     mode (Q1)
│ ┌──────────────────────────────────────────┐ │
│ │ NEW Opis                                  │ │  ← card bg-paper p-5
│ │ Lekki, składany, z daszkiem i koszem.     │ │     label 11.5px
│ │ Brak pokrowca przeciwdeszczowego.         │ │     extrabold uppercase
│ │                                           │ │     ink-soft; body 13.5px
│ └──────────────────────────────────────────┘ │     (whitespace-pre-line)
│                                               │
│ ┌──────────────────────────────────────────┐ │
│ │ NEW Aktualny status                       │ │
│ │ ┌──────────────────────────────────────┐ │ │
│ │ │ ● Pożyczona do 20.10.2026            │ │ │  ← status pill + text
│ │ │   U: Anna Kowalska                   │ │ │     (bg-cream row)
│ │ └──────────────────────────────────────┘ │ │
│ └──────────────────────────────────────────┘ │
│                                               │
│ ┌──────────────────────────────────────────┐ │
│ │ NEW Historia                              │ │
│ │ ┌────┐ Pożyczona                          │ │  ← date tile (TermHead-
│ │ │ 12 │ Ty → Anna Kowalska                 │ │     Card pattern) +
│ │ │PAŹ │ na terminie 12.10.2026             │ │     type bold + desc
│ │ └────┘                                    │ │
│ │   │                                       │ │  ← 1px border-line
│ │ ┌────┐ Dodana                             │ │     connector (optional)
│ │ │ 03 │ Ty dodajesz rzecz                  │ │
│ │ │WRZ │                                    │ │
│ │ └────┘                                    │ │
│ └──────────────────────────────────────────┘ │
└──────────────────────────────────────────────┘
```

**Integration Points**:
- ✅ The shell (PhoneFrame, scroll container, back link, `h2`) is identical to TermAttendeesPage.
- ✅ Category and condition sit in one meta line, `text-[12.5px] text-ink-soft`, in the same style as RzeczyView's "Stan: …".
- ✅ "Edytuj" is a secondary pill in the title row: `rounded-full border-[1.5px] border-line px-3 py-1.5 text-[11.5px] font-extrabold text-ink-soft` with `<PencilIcon/>`. It renders only when `is_owner && !deleted_at`.
- ✅ The history is a newest-first list (Q4) of `bg-cream` rows inside a `bg-paper` card. The date tile is reused visually from `TermHeadCard` but is smaller, `h-[40px] w-[40px]`. The term date is plain text with no link (binding).
- ✅ Every "label" string in the status and history blocks comes from the server (privacy rule). The UI never builds names.

**Component Reuse**:
- `PhoneFrame` (`components/shared/PhoneFrame.tsx`) for the shell
- `BackIcon`, `PencilIcon` (`pages/panel/panelIcons.tsx`)
- `PhotoPlaceholder` (`components/shared/Icons.tsx`) as the gallery fallback, with `isValidImageUrl` (`utils/url.ts`)
- `CONDITION_LABELS` (`utils/productCategory.ts`)
- `dayjs` (`utils/dayjs.ts`) for `DD.MM.YYYY` and the `D` / `MMM` tile; `dayMonth` (`pages/panel/panelHelpers.ts`) if it accepts a plain date

<a id="item-gallery"></a>
### Mockup 2: Gallery variants (view)

```
A) many photos (2..10)         B) 1 photo / Product.photo_url   C) none / all invalid
┌──────────────────────┐       ┌──────────────────────┐          ┌──────────────────────┐
│ ┌──────────────────┐ │       │ ┌──────────────────┐ │          │ ┌──────────────────┐ │
│ │    main photo    │ │       │ │    main photo    │ │          │ │                  │ │
│ │            2 / 6 │ │       │ │                  │ │          │ │   [▧] 64px       │ │
│ └──────────────────┘ │       │ └──────────────────┘ │          │ │ PhotoPlaceholder │ │
│ [▣][ ][ ][ ][ ][ ]→  │       │  (no strip, no       │          │ │  bg-cream        │ │
│  thumbs 56px,        │       │   counter)           │          │ └──────────────────┘ │
│  ring-2 ring-mint on │       └──────────────────────┘          │  owner: "Dodaj       │
│  active              │                                          │  zdjęcia w trybie    │
└──────────────────────┘                                          │  edycji" (hint)      │
                                                                  └──────────────────────┘
```
- The thumbnail strip uses `flex gap-2 overflow-x-auto`, so the page itself never scrolls horizontally.
- A thumbnail click swaps the main image. Thumbnails are `<button aria-pressed>`, which makes them keyboard accessible.
- When an `<img>` fails, `onError` swaps it for a placeholder tile and the layout stays the same.
- A product-photo fallback (B) looks identical to a single item photo and has no "catalog" badge. See Q6.

<a id="item-status-block"></a>
### Mockup 3: "Aktualny status" variants

The counterparty label (Ty / name / inna rodzina) is resolved server-side.

```
┌ Aktualny status ─────────────────────────────┐
│ ● Dostępna                                   │  pill: bg-mint-soft text-[#12604D]
├──────────────────────────────────────────────┤
│ ● Zarezerwowana — odbiór na terminie 12.10   │  pill: bg-lime-soft (neutral-warm)
│   Dla: Ty                                    │  ← viewer is the taker
├──────────────────────────────────────────────┤
│ ● W drodze — odbiór na terminie 12.10        │  IN_TRANSIT (confirmed)
│   Dla: inna rodzina                          │  ← 3rd-party viewer
├──────────────────────────────────────────────┤
│ ● Pożyczona do 20.10.2026                    │  LENT, pill: bg-teal-soft
│   U: Anna Kowalska                           │  ← owner viewing
├──────────────────────────────────────────────┤
│ ● Usunięta                                   │  deleted (see Mockup 9)
└──────────────────────────────────────────────┘
```
- One `bg-cream` row. The first line is a dot + label pill (text-carried, `role="status"`). The second line, `text-[12.5px] text-ink-soft`, holds the counterparty, and is omitted when there is none.
- The term date uses `dayjs(...).format("DD.MM")`, matching the notification copy. A due date is formatted `DD.MM.YYYY`, as in WypozyczoneView `LoanRow`.
- Whether `RETURNED` is shown as "Dostępna" is a spec decision (Q7).

<a id="item-history"></a>
### Mockup 4: "Historia" timeline entries and privacy labels

```
┌ Historia ────────────────────────────────────────────┐
│ ┌────┐ Zamieniona                     ← type, 13.5px  │
│ │ 02 │ inna rodzina → Ty                semibold ink  │
│ │LIS │ na terminie 02.11.2026          ← 12.5px soft  │
│ └────┘                                                │
│ ┌────┐ Zwrócona                                       │
│ │ 25 │ Anna Kowalska → Ty         ← name only because │
│ │PAŹ │ na terminie 25.10.2026       viewer took part  │
│ └────┘                                                │
│ ┌────┐ Pożyczona                                      │
│ │ 12 │ Ty → Anna Kowalska                             │
│ │PAŹ │ na terminie 12.10.2026                         │
│ └────┘                                                │
│ ┌────┐ Podarowana                                     │
│ │ 01 │ inna rodzina → inna rodzina  ← viewer absent   │
│ │PAŹ │ na terminie 01.10.2026                         │
│ └────┘                                                │
│ ┌────┐ Dodana                                         │
│ │ 03 │ Dodana przez: inna rodzina                     │
│ │WRZ │                     ← no term line (REGISTER)  │
│ └────┘                                                │
└───────────────────────────────────────────────────────┘
```
Movement labels: `REGISTER`→Dodana, `GIFT`→Podarowana, `LEND`→Pożyczona, `RETURN`→Zwrócona, `SWAP`→Zamieniona, `REMOVE`→Usunięta.
- The description string is built server-side, for example "Ty → Anna Kowalska". The frontend renders it verbatim.
- A swap shows the movement type only, with no counterpart item (binding).
- `<ol aria-label="Historia rzeczy">`. Each entry has a `<time dateTime>`.
- Entries without a term omit the "na terminie …" line.

<a id="item-page-edit"></a>
### Mockup 5: Edit mode, idle (owner)

**Context**: `/product/:id?mode=edit` (Q1). Every field shows its own pencil. No field is open yet.

```
┌──────────────────────────────────────────────┐
│ ‹ Wróć do podglądu       ← in edit mode the    │
│                            back link exits to  │
│                            view mode (Q2)      │
│ Edycja rzeczy                 [Gotowe]         │  ← h2 + mint "Gotowe"
│                                                │     → ?mode removed
│ ┌──────────────────────────────────────────┐  │
│ │ ZDJĘCIA (4/10)                       [✎] │  │  ← section label row +
│ │ [▣][ ][ ][ ]                              │  │     PencilIcon h-6 w-6
│ └──────────────────────────────────────────┘  │
│ ┌──────────────────────────────────────────┐  │
│ │ NAZWA I KATEGORIA                    [✎] │  │
│ │ Wózek spacerowy Baby Jogger              │  │
│ │ Wózki                                    │  │
│ ├──────────────────────────────────────────┤  │
│ │ STAN                                 [✎] │  │
│ │ Dobry                                    │  │
│ ├──────────────────────────────────────────┤  │
│ │ OPIS                                 [✎] │  │
│ │ Lekki, składany, z daszkiem i koszem.    │  │
│ │ (empty → "Brak opisu" in ink-soft italic)│  │
│ └──────────────────────────────────────────┘  │
│                                                │
│ Aktualny status / Historia: still rendered     │
│ below, read-only (not editable)                │
└──────────────────────────────────────────────┘
```
- Every field row repeats one pattern: an uppercase label `text-[11.5px] font-extrabold tracking-wide text-ink-soft`, then the value, then a pencil button on the right with `aria-label="Edytuj nazwę i kategorię"`, `"Edytuj stan"`, `"Edytuj opis"` or `"Edytuj zdjęcia"`.
- **Only one field may be open at a time.** Opening another field cancels the current draft, which mirrors RzeczyView, where `editingItemMeta` and `editingItemCondition` are independent. See Q5.
- An edit-mode URL from a non-owner, or for a deleted item, silently renders view mode (Mockup 10).

<a id="item-edit-name-category"></a>
### Mockup 6: Inline edit, name + category

This is the RzeczyView L208-260 pattern, moved to the item page.

```
┌──────────────────────────────────────────────┐
│ NAZWA I KATEGORIA                             │
│ ┌──────────────────────────────────────────┐ │
│ │ Wózek spacerowy Baby Jogger              │ │ ← input aria-label
│ └──────────────────────────────────────────┘ │   "Nazwa rzeczy"
│ ┌──────────────────────────┐                  │
│ │ Wózki                  ▾ │                  │ ← select "Typ rzeczy"
│ └──────────────────────────┘                  │   (useCategories)
│ [ Zapisz ]  [ Anuluj ]                         │ ← mint / outlined 11.5px
│ Ta zmiana podepnie rzecz pod inny produkt      │ ← hint 11.5px ink-soft
│ z katalogu — innych rzeczy nie zmienia.        │   (optional, Q8)
│ ⚠ Podaj nazwę rzeczy                           │ ← text-danger error
└──────────────────────────────────────────────┘
```
- Saving runs `resolveProduct(name, category_id)` followed by `updateInventoryItem(item.id, { product_id })`. This is the existing `saveItemMeta` mechanism. `Product.name` is never edited.
- Enter saves and Escape cancels. "Zapisz" is `disabled` while busy.
- Because the description lives on the Product, re-pointing to another product changes the description shown. See Q8.

<a id="item-edit-condition"></a>
### Mockup 7: Inline edit, condition and description

```
STAN                                           OPIS
┌───────────────────┐                          ┌──────────────────────────────────────┐
│ Dobry           ▾ │ ← select "Stan rzeczy"   │ Lekki, składany, z daszkiem...       │
└───────────────────┘   CONDITION_LABELS       │                                      │ ← textarea rows=4
[ Zapisz ] [ Anuluj ]                          │                                      │   aria-label "Opis
                                               └──────────────────────────────────────┘   rzeczy"
                                               123 / 2000                 ← counter (Q9)
                                               ⓘ Opis jest wspólny dla wszystkich
                                                 rzeczy tego produktu.     ← hint (Q8)
                                               [ Zapisz ] [ Anuluj ]
```
- Condition is saved with `updateInventoryItem(id, { condition })`, as in the existing `saveItemCondition`.
- The description is saved through the plugin-data mechanism (`/api/plugins/{id}/data/{productId}`, key `description`). The textarea uses the same `rounded-lg border-[1.5px] border-line bg-cream px-2 py-1.5 text-[13.5px]` style as the inputs.
- In the textarea, Escape cancels but Enter does **not** save, because Enter inserts a newline.

<a id="item-edit-gallery"></a>
### Mockup 8: Inline edit, gallery

```
┌──────────────────────────────────────────────────┐
│ ZDJĘCIA (4/10)                                    │
│ ┌──────────────────────────────────────────────┐ │
│ │ ┌────┐ 1. https://i.imgur.com/ab…  [▲][▼][🗑] │ │ ← bg-cream row; thumb
│ │ └────┘                              ▲ disabled│ │   48px; URL truncated
│ │ ┌────┐ 2. https://cdn.olx.pl/…     [▲][▼][🗑] │ │   (title=full URL);
│ │ └────┘                                        │ │   ChevronUp/Down
│ │ ┌────┐ 3. https://…                [▲][▼][🗑] │ │   (lucide) + TrashIcon,
│ │ └────┘                                        │ │   h-[30px] w-[30px]
│ │ ┌────┐ 4. https://…                [▲][▼][🗑] │ │
│ │ └────┘                                 ▼ dis. │ │
│ └──────────────────────────────────────────────┘ │
│ ┌──────────────────────────────────┐ [+ Dodaj]   │ ← input type=url
│ │ Wklej link do zdjęcia (https://…)│             │   aria-label "Link do
│ └──────────────────────────────────┘             │   zdjęcia"; Enter adds
│ ⚠ Podaj poprawny link zaczynający się od https:// │ ← isValidImageUrl
│                                                   │   fails → text-danger
│ [ Gotowe ]                                        │ ← closes the gallery
└──────────────────────────────────────────────────┘   editor

Limit reached (10/10):
│ ┌──────────────────────────────────┐ [+ Dodaj]   │  input + button disabled
│ Osiągnięto limit 10 zdjęć.                        │  12.5px ink-soft
```
- Interaction model (Q10): each action (add, remove, up, down) is **saved immediately**, so the gallery has no Zapisz/Anuluj. That suits a list editor, because the alternative is a local draft that is saved as a whole with Zapisz/Anuluj, like the other fields. The scope says "Zapisz/Anuluj per field", so the spec must pick one.
- Moving an item up or down keeps focus on the same photo's button at its new position.
- Removing a photo needs no confirm dialog. `ConfirmDialog` is Chakra and does not fit the panel. Removal is reversible by pasting the URL again.
- A server 4xx (max 10, invalid URL) is shown verbatim, in `text-danger` under the input.

<a id="item-page-states"></a>
### Mockup 9: States (loading / not found / error / deleted / empty history)

The `ItemDetailBody` branch order follows TermAttendeesBody: notFound → error → loading → content. The back link and the `h2` placeholder stay visible in every state.

```
LOADING                               NOT FOUND (404 or 422 malformed UUID)
┌─────────────────────────────┐       ┌─────────────────────────────┐
│ ‹ Wróć                      │       │ ‹ Wróć                      │
│ Rzecz                       │       │ Rzecz                       │
│ ┌─────────────────────────┐ │       │ Nie znaleziono tej rzeczy.  │ ← 12.5px soft
│ │ ░░░░ gallery skeleton ░ │ │       └─────────────────────────────┘
│ │ (bg-line animate-pulse) │ │
│ └─────────────────────────┘ │       ERROR (5xx / network)
│ Wczytywanie rzeczy…         │       ┌─────────────────────────────┐
└─────────────────────────────┘       │ ‹ Wróć                      │
                                      │ Rzecz                       │
                                      │ Nie udało się wczytać rzeczy│ ← danger semibold
                                      │ — spróbuj ponownie          │
                                      │ <extractProblemMessage>     │ ← 11.5px soft
                                      │ [ Spróbuj ponownie ]        │ ← TermAttendees btn
                                      └─────────────────────────────┘

DELETED (deleted_at set) — read-only for everyone, owner included
┌─────────────────────────────────────────────┐
│ ‹ Wróć                                      │
│ ┌─────────────────────────────────────────┐ │
│ │ 🗑 Rzecz usunięta                        │ │ ← banner role="status":
│ │ Ta rzecz została usunięta 14.10.2026.   │ │   rounded-2xl bg-danger-soft
│ │ Możesz przejrzeć jej historię.          │ │   text-danger, TrashIcon
│ └─────────────────────────────────────────┘ │
│ [gallery, slightly faded: opacity-70]       │
│ Wózek spacerowy Baby Jogger   (no Edytuj)   │
│ Wózki · Stan: Dobry                         │
│ Opis …                                      │
│ Aktualny status: ● Usunięta                 │
│ Historia: … last entry "Usunięta / Ty"      │
└─────────────────────────────────────────────┘

EMPTY HISTORY (only possible for legacy rows without REGISTER)
┌ Historia ───────────────────────────────────┐
│ ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐ │
│   Brak zdarzeń w historii tej rzeczy.        │ ← dashed empty block
│ └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘ │
└─────────────────────────────────────────────┘
```
- The history query and the detail query are separate (`/details` + `/history`). If the history query alone fails, only the history card shows the inline error and retry; the rest of the page still renders.

<a id="item-page-non-owner"></a>
### Mockup 10: Non-owner viewer

The page is identical to Mockup 1, with these differences:
- no "Edytuj" button
- no pencils
- no "Dodaj zdjęcia" hint
- `?mode=edit` is ignored, and the URL is optionally replaced with the plain path
- the status and history use third-party labels

```
│ Wózek spacerowy Baby Jogger                  │  ← no edit affordance
│ Wózki · Stan: Dobry                          │
│ ┌ Aktualny status ───────────────────────┐   │
│ │ ● Zarezerwowana — odbiór na terminie   │   │
│ │   12.10   Dla: inna rodzina            │   │
│ └────────────────────────────────────────┘   │
```
- The page does not show who owns the item (Q11).

<a id="rzeczy-card-icons"></a>
### Mockup 11: "Moje rzeczy" card, new view + edit icons

**File**: `pages/panel/views/RzeczyView.tsx`, the item card at L196-424.

```
EXISTING card (bg-cream rounded-2xl p-[15px])                       right rail
┌──────────────────────────────────────────────────────────────┬─────────┐
│ ┌────┐ Wózek spacerowy Baby Jogger [✎]  ← existing inline     │ [👁] NEW│ ← Link to
│ │ ▣  │ Stan: Dobry [✎]                    pencils (Q12)       │         │  /product/:id
│ └────┘ (Pożyczę)(Oddam)(Zamienię) ● czeka na potwierdzenie    │ [✎] NEW│ ← Link to
│        Propozycje zamiany (1) …                               │         │  ?mode=edit
│                                                               │ [🗑] old│ ← existing delete
└──────────────────────────────────────────────────────────────┴─────────┘
```
- The right column becomes `flex flex-col gap-1`, holding three `h-[30px] w-[30px] rounded-[10px]` icon buttons. View and edit are `<Link>`s with `text-ink-soft hover:bg-paper hover:text-ink`. Trash keeps its danger hover.
- aria-labels: `Zobacz rzecz {name}`, `Edytuj rzecz {name} na stronie rzeczy`, and the existing `Usuń rzecz {name}`.
- Icons:
  - view: lucide `Eye`, or a new `EyeIcon` in `panelIcons.tsx` in the same SVG style, which is preferred
  - edit: the existing `PencilIcon`
- **Mobile**: stacking the icons vertically keeps the card body width unchanged at 360px. Three icons in a horizontal row would steal about 100px from the title.
- `RzeczyView` item ids are typed `number`, but the item page takes a UUID string. The Link must use `it.id` as is, and the types should be fixed (gap analysis notes the id type drift).

<a id="wypozyczone-row-icon"></a>
### Mockup 12: "Wypożyczone" row, view icon

**File**: `pages/panel/views/WypozyczoneView.tsx` `LoanRow`.

```
Tab "Wypożyczone od innych"
┌──────────────────────────────────────────────────────────────┐
│ ┌────┐ Fotelik Cybex              [👁] NEW   [ Oddaję ] old    │
│ │ 🎁 │ Od: Jan Nowak                                         │
│ └────┘ Oddaj do: 20.10.2026                                  │
└──────────────────────────────────────────────────────────────┘
Tab "Wypożyczone innym"
┌──────────────────────────────────────────────────────────────┐
│ ┌────┐ Wózek spacerowy            [👁] NEW                   │
│ │ 🎁 │ U: Anna Kowalska                                      │
│ └────┘ Zwrot do: 20.10.2026                                  │
└──────────────────────────────────────────────────────────────┘
```
- `LoanRow` gets a new `itemId` prop and always renders a view `<Link>` (`h-[30px] w-[30px]`) before `children`.
- `aria-label="Zobacz rzecz {productName}"`.
- The ids come from `b.itemId` / `it.id`.

<a id="term-listing-link"></a>
### Mockup 13: Public term page, listing title as link

**Files**: `pages/krag/PublicTermView.tsx` `toListingRow` (L66), rendered by `pages/krag/components/AttendeeList.tsx` (`kg-bring-body`).

```
Attendee entry "Rodzina Kowalskich"
┌───────────────────────────────────────────────┐
│ Udostępnia:                                   │
│ ┌───────────────────────────────────────────┐ │
│ │ Wózek spacerowy Baby Jogger ›             │ │ ← <Link to=/product/:id>
│ │ ‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾              │ │   <strong> kept, underline
│ │ [ Pożycz ] [ Weź na stałe ] [ Zamień ]    │ │   decoration-line + "›"
│ └───────────────────────────────────────────┘ │   (affordance)
│ Przynosi:                                     │
│ │ Ciastka — owsiane                 (no link) │ ← needed items stay plain
└───────────────────────────────────────────────┘

Anonymous click:
/product/:id → AuthGuard → /login?returnTo=%2Fproduct%2F<id>
→ login → back to /product/<id>        (no new code needed)
```
- Link styling stays inside the `kg-*` CSS world: inherit the colour, `underline decoration-[1.5px] underline-offset-2`, hover in mint. No Tailwind panel tokens are needed beyond that.
- The action buttons are unchanged. Only the title is a link, so tapping it never triggers "Pożycz".
- Optionally use `aria-label={`Zobacz szczegóły: ${product_name}`}`, or keep the visible name as the accessible name, which is preferred.

<a id="notification-reserved"></a>
### Mockup 14: Notification bell, new ITEM_RESERVED_FOR_PICKUP entry

**File**: `components/shared/NotificationBell.tsx`. Its rendering is unchanged. This mockup only shows the content.

```
                                  [🔔 ²]
            ┌──────────────────────────────────────┐
            │ POWIADOMIENIA   Oznacz jako przeczyt. │
            │ ● Zarezerwowano „Wózek spacerowy      │ ← NEW kind, unread:
            │   Baby Jogger” — odbierz na terminie  │   bold + mint dot
            │   12.10                               │   click → markRead +
            │                                       │   navigate("/product/<id>")
            │ ● Anna chce wziąć Twoją rzecz „…”     │ ← TERM_ITEM_LISTING_TAKEN
            │                                       │   (link now /product/:id)
            │   Nowy zapis na termin …              │ ← read: ink-soft
            └──────────────────────────────────────┘
```
- Width 290px. Long product names wrap (`leading-snug`). No truncation is needed.
- The only frontend change is adding `"ITEM_RESERVED_FOR_PICKUP"` to the kind union in `api/notifications.ts`.
- The landing page for this notification shows Mockup 3, "Zarezerwowana — odbiór na terminie 12.10 · Dla: Ty", so the notification and the page agree.

---

## Reusable Components

### Layout
- **PhoneFrame**: `components/shared/PhoneFrame.tsx`. The page shell.
- **TermAttendeesPage structure**: `pages/panel/TermAttendeesPage.tsx`. Copy its back link, `h2` and `*Body` branching, error + retry button, and `TermHeadCard` date tile.

### UI pieces (by class pattern; there is no shared Tailwind Button component)
- Mint primary small button, outlined secondary small button, icon buttons, inline inputs, select and error: from `pages/panel/views/RzeczyView.tsx`.
- Status pill + dot: RzeczyView `badgeLabel` span and TermAttendeesPage `pillClass`.
- Empty block: TermAttendeesPage dashed `p`.
- Row: `LoanRow` in `WypozyczoneView.tsx` (icon tile + title + small lines + trailing action).

### Icons
- `BackIcon`, `PencilIcon`, `TrashIcon`, `BoxIcon`, `GiftIcon`: `pages/panel/panelIcons.tsx`.
- `PhotoPlaceholder`: `components/shared/Icons.tsx`.
- **NEW (suggested)**: `EyeIcon`, `ChevronUpIcon`, `ChevronDownIcon` in `panelIcons.tsx`, in the same hand-drawn SVG style with stroke `#1E2E27`/`#5C7069`, width 2. Alternatively, lucide `Eye`/`ChevronUp`/`ChevronDown` (already a dependency).

### Helpers
- `CONDITION_LABELS` (`utils/productCategory.ts`), `isValidImageUrl` (`utils/url.ts`), `dayjs` (`utils/dayjs.ts`), `dayMonth` (`pages/panel/panelHelpers.ts`), `useCategories` (`hooks/useCategories`).
- `resolveProduct` / `updateInventoryItem`, as used by `PanelDataContext.saveItemMeta`. They need to be callable outside `PanelDataProvider`, because the page is a standalone route.

### Suggested new components (page-local, in the page file or `pages/product/`)
- `ItemDetailPage`, `ItemDetailBody`
- `ItemGallery` (view)
- `ItemGalleryEditor`
- `ItemStatusCard`
- `ItemHistoryList`
- `EditableField`: label row + pencil, rendering children in view or edit

---

## Implementation Notes

### Consistency Checklist
- ✅ Same shell, spacing and type scale as TermAttendeesPage (19px h2, 15.5px row titles, 12.5px meta, 11.5px buttons).
- ✅ Inline edits copy RzeczyView exactly: Zapisz/Anuluj, Enter/Escape, `disabled={busy}`, inline error.
- ✅ Only Tailwind tokens: `bg-cream`, `bg-paper`, `border-line`, `text-ink(-soft)`, `bg-mint(-soft)`, `text-danger`, `bg-danger-soft`, `bg-teal-soft`, `bg-lime-soft`.
- ✅ Polish copy throughout, dates via `utils/dayjs`.
- ✅ Data via a TanStack Query hook (`hooks/useItemDetail.ts`) per `standards/frontend/data-fetching.md`.

### Accessibility Considerations
- Every icon button has a Polish `aria-label`, and every SVG is `aria-hidden`.
- Status is text-carried; colour is never the only signal.
- Gallery thumbnails are `<button aria-pressed>`. Every `<img>` has `alt="{name} — zdjęcie N"`.
- Up/down buttons are disabled at the ends and have `aria-label="Przesuń zdjęcie N w górę"`.
- When an editor opens, focus moves to its first input. On Zapisz/Anuluj, focus returns to that field's pencil.
- History is an `<ol>` with `<time dateTime>`. The deleted banner is `role="status"`.

### Responsive Behavior
- Mobile (<520px): full-height PhoneFrame. The gallery main image is `w-full aspect-[4/3] object-cover rounded-2xl`. Thumbnails scroll horizontally inside the card. The page itself never scrolls horizontally.
- Desktop (>=520px): the same single column inside the PhoneFrame "device". No two-column layout, which matches the rest of the panel.

---

## Alternatives Considered

### Edit as one big form/modal (Rejected)
**Why**: The binding scope requires per-field inline editing with a pencil per field. A modal also conflicts with the "view/edit state machine" URL model.

### Edit controls always visible to the owner in view mode, with no separate edit mode (Rejected)
**Why**: The scope explicitly asks for a view/edit state machine and a separate "edit" entry from Moje rzeczy. It would also clutter the read-only page that most viewers see.

### Gallery as a full-width swipe carousel with dots (Considered)
**Why not chosen**: It needs touch/scroll-snap logic and offers no keyboard parity without extra work. A main image plus a thumbnail strip is simpler and accessible. Scroll-snap could be added later.

### Separate photo-management route (Rejected)
**Why**: The scope places the gallery editor inline on the item page, like the other fields.

### Title link (instead of icons) in Moje rzeczy (Rejected by scope)
**Why**: The scope says "only icons". The title already hosts the inline pencil, and making it a link would collide with that.

---

## Open UI Questions for the Spec

| # | Question | Options | Suggested default |
|---|---|---|---|
| Q1 | Edit-mode URL | (a) `/product/:id?mode=edit`; (b) `/product/:id/edit` (precedent: admin `products/:id/edit`) | **(a)**. One route and one component, survives AuthGuard `returnTo` (it keeps `search`), and toggles with `setSearchParams` without remounting or refetching. |
| Q2 | Leaving edit mode | (a) "Gotowe" button + back link "Wróć do podglądu"; (b) the back link only | **(a)**. Explicit exit. Unsaved open drafts are discarded. |
| Q3 | Back link target | (a) `navigate(-1)`, with a fallback to `/panel/rzeczy` when there is no history entry (deep link from a notification); (b) always `/panel/rzeczy` | **(a)**. Entries come from 5 places. |
| Q4 | History order | newest first vs oldest first (ledger spec: oldest first) | **Newest first in the UI**. Reverse on the client if the API returns oldest first. |
| Q5 | Several fields open at once? | single open editor vs independent | **Single**. Simpler, avoids conflicting saves. |
| Q6 | Mark the `Product.photo_url` fallback as a catalog photo? | badge vs none | **None** |
| Q7 | Status label for `RETURNED` / `AVAILABLE` | both "Dostępna"? | **Both "Dostępna"** |
| Q8 | Description is shared by all items of the product, and re-pointing name/category changes it | show a hint in the editor? Carry the description over to the new product on re-point? | **Show the hint. Do not carry it over.** Needs a spec decision. |
| Q9 | Description max length / counter | 2000 + counter vs no limit | 2000 |
| Q10 | Gallery: immediate save per action vs a local draft + Zapisz/Anuluj | | **Immediate**. Each action is one API call, so there is no draft divergence. |
| Q11 | Show the owner on the page ("Właściciel: Ty / inna rodzina")? | | Not in scope. Only the status counterparty is shown. |
| Q12 | Keep the existing inline pencils (name, condition) in RzeczyView, or remove them in favour of the new edit icon? | keep / remove | **Spec must decide.** "Only icons" suggests removal, but removal regresses quick edits. |
| Q13 | View icon glyph | new `EyeIcon` in panelIcons vs lucide `Eye` | New `EyeIcon` (visual consistency) |
| Q14 | Show a link back to the term ("Zobacz stronę terminu ›") in the status block for a reservation? | | No. Scope says term as plain text. |

---

*Generated by ui-mockup-generator subagent*
