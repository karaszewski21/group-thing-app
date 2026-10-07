# UI Mockups: A1 „Motyw” — motyw kolorystyczny organizatora

**Wygenerowano**: 2026-10-07
**Ścieżka zadania**: `.maister/tasks/development/2026-10-07-organizer-theme-a1`
**Typ**: Enhancement (re-theming + nowa trasa zagnieżdżona; **bez nowego UI edytora** — to A2)
**Kolumna referencyjna**: mobile 360–430 px (szkice ~52 znaki szerokości)

---

## Spis treści

- [Legenda tokenów ról](#legenda-tokenow)
- [Mapa nawigacji](#mapa-nawigacji) — `nav:product-entry-points`
- [1. Strona terminu z motywem](#term-page-themed) — `screen:term-page-themed`
- [2. Bramka grupy prywatnej + arkusz prośby](#private-group-gate-themed) — `screen:private-group-gate-themed`
- [3. Strona produktu organizatora](#organizer-product-page) — `screen:organizer-product-page`
- [4. Edycja produktu organizatora](#organizer-product-edit) — `screen:organizer-product-edit`
- [5. Stany ładowania / 404 slug](#organizer-product-loading) — `state:organizer-product-loading`
- [6. Strona produktu w panelu (porównanie)](#panel-product-page) — `screen:panel-product-page`
- [7. Publiczna strona organizacji](#public-organization-page) — `screen:public-organization-page`
- [Komponenty](#komponenty) — `component:*`
- [Uwagi implementacyjne](#uwagi-implementacyjne)

---

<a id="legenda-tokenow"></a>
## Legenda tokenów ról

Oznaczenia w nawiasach kwadratowych to utility/tokeny Tailwind `--color-*` (HLD §5.1).
**Motywowane (13, ustawiane inline przez `OrganizerThemeScope`)**:

| Znacznik | Token | Domyślnie (A1) | Przykład: bordo `#7a2a4f`* | Rola |
|---|---|---|---|---|
| `[primary]` | `--color-primary` | `#1b8168` | `#7a2a4f` | wypełnienia: CTA, aktywna szprycha, znacznik „udostępnia” |
| `[on-primary]` | `--color-on-primary` | `#ffffff` | `#ffffff` | tekst/ikona NA primary |
| `[primary-fg]` | `--color-primary-fg` | `#117b63` | `#7a2a4f` | tekst w kolorze marki (linki, eyebrow, „Dostępna”) |
| `[primary-soft]` | `--color-primary-soft` | jaśniej niż `#d8f0e6` (L 0,95) | ~`#f7e9ef` | zaznaczenie, pierścień aktywnego awatara, pigułki |
| `[focus-ring]` | `--color-focus-ring` | `#1b8168` | `#7a2a4f` | obrys fokusu ≥3:1 |
| `[accent]` | `--color-accent` | `#a9c24f` | auto (z generatora) | dekoracja, bez tekstu |
| `[accent-soft]` | `--color-accent-soft` | `#eaf2ce` | auto | tło badge'a |
| `[accent-fg]` | `--color-accent-fg` | `#56701f` | auto | tekst na accent-soft |
| `[cream]` | `--color-cream` | `#f4f8f0` | lekko podbarwiony | tło strony / inputów |
| `[stage]` / `[stage-wide]` | `--color-stage(-wide)` | `#edf1ea` / `#e7ede4` | podbarwione | tło za kolumną `PhoneFrame` |
| `[line]` / `[line-strong]` | `--color-line(-strong)` | `#e2eadf` / `#cbdac7` | podbarwione | ramki, nieaktywne szprychy |

\* wartości bordo poglądowe — faktyczne liczy `buildOrgThemeVars` (OKLCH + WCAG, może przyciemnić seed, ADR-002).

**Stałe (`@theme static`, NIE zmieniają się z motywem)**: `[paper]`, `[ink]`, `[ink-soft]`, `[on-ink]`, `[teal]`, `[teal-soft]`, `[sage]`, `[sage-soft]`, `[danger]`/`[danger-soft]` (`#b23b3b`), `[scrim]`.
**Poza tokenami (literały na allowliście)**: `Avatar PALETTE` (kolory rodzin), murawa PITCH `#4E9A5F→#3E8A4E`, drewno TABLE `#e7cfa8`.
**Chrom platformy (paleta domyślna, POZA zakresem)**: pasek konta `PublicLayout` + `NotificationBell` (`bg-mint`, legacy statyczny — decyzja C-2/B), tło `body`.

Oznaczenia stanu: `NEW` nowy · `MOD` zmieniony · `EXIST` bez zmian · `FIXED` stały kolor.

---

<a id="mapa-nawigacji"></a>
## Mapa nawigacji — `nav:product-entry-points`

```
                    ┌─────────────────────────────────────────┐
                    │ /:slug/grupa/:g/term/:t  (TermPage)     │
                    │ OrganizerThemeScope(organizer_theme)    │
                    └───────────────┬─────────────────────────┘
          link nazwy przedmiotu     │ (PublicTermView.toListingRow)
          ┌─────────────────────────┴───────────────┐
          │ organizer_slug != null                  │ organizer_slug == null (defensywnie)
          ▼                                         ▼
┌───────────────────────────────┐        ┌──────────────────────────────┐
│ NEW /:slug/produkt/:id        │        │ EXIST /product/:id           │
│ AuthGuard → login?returnTo=   │        │ AuthGuard                    │
│ OrganizerItemLayout (motyw)   │        │ PhoneFrame + PanelNavBar     │
│ PhoneFrame BEZ PanelNavBar    │        │ paleta domyślna              │
└───────┬───────────────▲───────┘        └──────▲────────────▲──────────┘
  Edytuj│(właściciel)   │Gotowe / Wróć do       │            │
        ▼               │podglądu               │            │
┌───────────────────────┴───────┐               │            │
│ NEW /:slug/produkt/:id/edit   │     panel „Moje rzeczy”   powiadomienia
│ (ten sam prefiks i motyw)     │     (/panel/rzeczy)       (link_path backendu
│ „Moje rzeczy →” → /panel/rzeczy│                           bez zmian)
└───────────────────────────────┘

„Wróć” (ItemBackButton): historia → navigate(-1);
   wejście bezpośrednie: /:slug/produkt/* → /${slug}   |   /product/* → /panel/rzeczy
```

Źródło prefiksu: `useItemRoutes()` czyta `useParams().organizationSlug` (obecny tylko na trasie zagnieżdżonej) → `{ base, editPath, viewPath, backFallback }`.

---

<a id="term-page-themed"></a>
## 1. Strona terminu z motywem — `screen:term-page-themed`

**Kontekst**: `/:slug/grupa/:groupId/term/:termId`, gałąź `access.kind === "view"`.
`TermPage` (MOD) owija wynik w `OrganizerThemeScope` z `state.data.group.organizer_theme`
(`pages/krag/TermPage.tsx`). Struktura strony **bez zmian** — KragStage to goły `<div>`, brak ramki/stage
(`.kg-stage`/`.kg-app` martwe → usuwane).

### 1a. Motyw organizatora (bordo `#7a2a4f`)

```
┌──────────────────────────────────────────────────┐
│ PublicLayout <nav> (tylko zalogowany)   FIXED    │ ← poza zakresem: [paper] tło,
│                              [🔔³]  [Konto ▾]    │   [line], badge 🔔 = bg-mint
├──────────────────────────────────────────────────┤   (zostaje ZIELONY, domyślny)
│╔════════════════════════════════════════════════╗│
│║ OrganizerThemeScope (NEW, inline 13 × --color-*)║│ ← bez transform/filter/contain
│║ KragStage <div> (MOD: bez :root, bez *{box})   ║│
│║                                                ║│
│║ GroupHeader  (bg-transparent)                  ║│
│║  Taniec dla maluchów            [ink]          ║│
│║                                                ║│
│║ GroupVisualization CIRCLE (MOD)                ║│
│║            (AK)          (MW)                  ║│ ← awatary: Avatar PALETTE FIXED
│║              ╲ ░░        ╱                     ║│   obwódka awatara: [cream]
│║   (JN)──────── ┌──────┐ ────(ZK)●             ║│ ← aktywna szprycha [primary]
│║               │  ⬤ E │  ┌─ szprycha            ║│   nieaktywne [line-strong]
│║   (PL)◐      │ [ink] │    nieaktywna            ║│
│║              └──────┘                          ║│ ← kg-center-av: [ink] + [on-ink]
│║            Ewa Kowalska   [ink]                ║│
│║            prowadzi zajęcia [ink-soft]         ║│
│║                                                ║│
│║  (ZK)● = is-on: pierścień 4px [primary-soft]   ║│
│║   ●↘ znacznik „udostępnia”: tło [primary],     ║│
│║        ikona [on-primary], obwódka [cream]     ║│
│║   ◐↙ znacznik „przynosi”: tło [teal] FIXED,    ║│
│║        ikona [ink] FIXED (było białe 2,32:1)   ║│
│║                                                ║│
│║  Legenda: (●) udostępnia rzecz                 ║│ ← kropka [primary]+[on-primary]
│║           (◐) przynosi na zajęcia  [ink-soft]  ║│ ← kropka [teal] + ikona [ink]
│║                                                ║│
│║ ┌ TermCard .kg-term ───────────────────────┐   ║│ ← gradient [primary-soft]→[paper]
│║ │ TERMIN ZAJĘĆ           [primary-fg]      │   ║│   ramka [line]
│║ │ 14 października 2026   ┌──────────────┐  │   ║│
│║ │       [ink]            │🕒 godz. 17:00│  │   ║│ ← pigułka [paper]/[line]/[ink]
│║ └────────────────────────┴──────────────┴──┘   ║│
│║                                                ║│
│║ ┌ NeededItemsSection .kg-bring ────────────┐   ║│ ← [paper], ramka [line]
│║ │ Zgłoś się, jeśli możesz…    [ink-soft]   │   ║│
│║ │ Wałek do ciasta     ( Ja to przyniosę )  │   ║│ ← .kg-bring-btn: ramka+tekst
│║ │──────────────────────────────── [line]   │   ║│   [primary-fg] na [paper]
│║ │ Farby  — Przynosi: Ty      [ink-soft]    │   ║│
│║ └──────────────────────────────────────────┘   ║│
│║                                                ║│
│║ ┌ AttendeeList .kg-bring ──────────────────┐   ║│
│║ │╭────────────────────────────────────────╮│   ║│
│║ ││(ZK)● Zofia K.         .kg-attendee.is-on││   ║│ ← tło [primary-soft], tekst [ink]
│║ ││      Rowerek biegowy ›                 ││   ║│ ← Link: [ink] podkreślony,
│║ ││      → /ania/produkt/9                 ││   ║│   hover [primary-fg]
│║ ││      (Pożycz) (Zamień)                 ││   ║│ ← .kg-bring-btn [primary-fg]
│║ │╰────────────────────────────────────────╯│   ║│
│║ │(JN)  Jan N.                              │   ║│
│║ │      Klocki drewniane ›  → /ania/produkt/10│ ║│
│║ └──────────────────────────────────────────┘   ║│
│║                                                ║│
│║ [ AccountMergeForm card (warunkowa) ]          ║│ ← [paper]/[line]; „Może później”
│║                                                ║│   ramka [line], tekst [ink-soft]
│║ TermFooter (MOD)                               ║│
│║      ┌──────────────────────────────┐          ║│
│║      │  ＋ Zapisz się na zajęcia    │          ║│ ← bg [primary], tekst [on-primary]
│║      └──────────────────────────────┘          ║│   (było bg-[#1B8168] text-white)
│║                                                ║│
│║ overlay: toast  ( Zapisano! )                  ║│ ← [ink] tło + [on-ink] FIXED
│║          arkusze AuthGate/Rsvp/Swap            ║│   (w drzewie zakresu → motyw)
│╚════════════════════════════════════════════════╝│
└──────────────────────────────────────────────────┘
```

### 1b. Porównanie: domyślna vs bordo (te same elementy)

```
Element                         Domyślna (organizer_theme=null)   Bordo #7a2a4f
──────────────────────────────  ────────────────────────────────  ──────────────────────
TermFooter CTA                  ███ #1b8168 / tekst #fff          ███ #7a2a4f / tekst #fff
„TERMIN ZAJĘĆ” eyebrow          #117b63 (było #1b8168, 4,45:1)    #7a2a4f
aktywna szprycha                #1b8168                           #7a2a4f
nieaktywna szprycha             #cbdac7 [line-strong]             podbarwiona szarość
.kg-attendee.is-on tło          L0,95 mint (było #d8f0e6, 4,41:1) ~#f7e9ef
znacznik „udostępnia”           mint + biała ikona                bordo + biała ikona
znacznik „przynosi”             teal + ikona INK (FIX)            teal + ikona INK (bez zmian)
awatary rodzin                  PALETTE (zielenie)                PALETTE (bez zmian)
centrum (prowadzący)            ink                               ink
pasek konta / 🔔                domyślny                          domyślny (bez zmian)
PITCH murawa / TABLE drewno     literały                          literały (bez zmian)
```

**Punkty integracji**:
- ✅ `TermPage.tsx` (MOD) — scope owija **oba** wyniki (`PublicTermView`, `PrivateGroupGate`); stany „Wczytywanie...”/„Nie znaleziono” pozostają bez zakresu (paleta domyślna).
- ✅ `KragStage.tsx` (MOD) — `.kg-*` czytają `--color-*`; usunięte `:root{--mint…}` i `*{box-sizing}` (dopiero po migracji wszystkich `var(--ink…)`).
- ✅ `GroupVisualization.tsx` (MOD) — `stroke` → `var(--color-primary)` / `var(--color-line-strong)`; `bg-[var(--ink)]` → `bg-ink`; legenda → `bg-primary text-on-primary`, `bg-teal text-ink`.
- ✅ `PublicTermView.tsx` (MOD) — link `/${group.organizer_slug}/produkt/${item_id}` (fallback `/product/:id` gdy slug null); `hover:text-mint` → `hover:text-primary-fg`; toast `bg-ink text-on-ink`; `#E2EADF`/`#5C7069` → `border-line`/`text-ink-soft`.
- ✅ `TermFooter.tsx` (MOD) — `bg-primary text-on-primary`.
- ✅ Klasy `.kg-head-sub`, `is-on` zachowane (asercje `TermPage.test.tsx:149,183`).

---

<a id="private-group-gate-themed"></a>
## 2. Bramka grupy prywatnej + arkusz prośby — `screen:private-group-gate-themed`

**Kontekst**: ta sama trasa, `access.kind !== "view"`. Motyw z `organizer_theme`, który backend zwraca **także** w zredukowanej odpowiedzi PRIVATE.

### 2a. Bramka (`gate.kind = "canRequest"`), motyw bordo

```
┌──────────────────────────────────────────────────┐
│ PublicLayout <nav>  [🔔] [Konto ▾]      FIXED    │
├──────────────────────────────────────────────────┤
│╔════════════════════════════════════════════════╗│
│║ OrganizerThemeScope → KragStage                ║│
│║ GroupHeader: Taniec dla maluchów   [ink]       ║│
│║                                                ║│
│║ ┌ .kg-card ────────────────────────────────┐   ║│ ← [paper], ramka [line]
│║ │ 🔒 Ta grupa jest prywatna       [ink]    │   ║│
│║ │                                          │   ║│
│║ │ ⏳ Prośba wysłana — czeka…  (pending)    │   ║│ ← .kg-status-line [sage] FIXED
│║ │                                          │   ║│   (przyciemniony, ≥4,5:1)
│║ │ Zajęcia i lista uczestników są widoczne  │   ║│ ← BODY_STYLE: var(--ink-soft)
│║ │ tylko dla członków…        [ink-soft]    │   ║│   → var(--color-ink-soft) (MOD)
│║ │                                          │   ║│
│║ │ ┌──────────────────┐                     │   ║│
│║ │ │ Poproś o dostęp  │                     │   ║│ ← .kg-btn-primary
│║ │ └──────────────────┘                     │   ║│   [primary] / [on-primary]
│║ │                                          │   ║│
│║ │ (pending) [Sprawdź ponownie] (Wycofaj)   │   ║│ ← ghost: ramka [line], [ink-soft]
│║ │ Nie udało się… [danger] #b23b3b FIXED    │   ║│ ← .kg-error (było #B4443A)
│║ └──────────────────────────────────────────┘   ║│
│║ loginRequired: AuthGateLinks → linki [primary-fg]║
│╚════════════════════════════════════════════════╝│
└──────────────────────────────────────────────────┘
```

### 2b. Otwarty `RequestAccessDialog` (overlay w drzewie zakresu)

```
┌──────────────────────────────────────────────────┐
│░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│ ← scrim [scrim] FIXED
│░░ (bramka pod spodem, przyciemniona) ░░░░░░░░░░░░│   rgba(20,28,24,.55) → bg-scrim
│░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│   position:fixed, z-60
│░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│   (className kg-modal-overlay usunięty)
│╭────────────────────────────────────────────────╮│
││ Poprosić o dostęp?  [ink]                 (✕)  ││ ← ✕: tło [cream], ikona [ink-soft]
││                                                ││ ← arkusz: [paper], max-w 430
││ Wyślesz prośbę do organizatora grupy           ││
││ „Taniec dla maluchów”…          [ink-soft]     ││
││                                                ││
││ Nie udało się wysłać…   [danger] (failed)      ││
││ ┌────────────────────────────────────────────┐ ││
││ │                  Wyślij                    │ ││ ← .kg-btn-primary [primary]/[on-primary]
││ └────────────────────────────────────────────┘ ││   focus: [focus-ring]
││ ┌────────────────────────────────────────────┐ ││
││ │                  Anuluj                    │ ││ ← .kg-btn-ghost [line]/[ink-soft]
││ └────────────────────────────────────────────┘ ││
│╰────────────────────────────────────────────────╯│
└──────────────────────────────────────────────────┘
```

**Punkty integracji**:
- ✅ `PrivateGroupGate.tsx` (MOD) — `BODY_STYLE` i pending `color: var(--ink-soft)` → `var(--color-ink-soft)` (lub klasa `text-ink-soft`), L12, L169.
- ✅ `RequestAccessDialog.tsx` (MOD) — inline `rgba(20,28,24,.55)` → `bg-scrim`; `var(--paper|cream|ink-soft)` → `--color-*`; usunięty `className="kg-modal-overlay"`.
- ✅ Dialog renderowany w `overlay` KragStage, czyli **wewnątrz** `OrganizerThemeScope` — przycisk „Wyślij” bierze motyw; scrim stały. Element zakresu bez `transform` → `position:fixed` działa względem viewportu.
- ✅ `AccountMergeForm.tsx` (MOD) — `var(--ink-soft)` → token; `#B4443A` → `text-danger`.

---

<a id="organizer-product-page"></a>
## 3. Strona produktu organizatora — `screen:organizer-product-page`

**Kontekst**: NEW `/:organizationSlug/produkt/:id` pod `PublicLayout`. Layout route
(`pages/product/OrganizerItemPage.tsx`, NEW): `AuthGuard` → `usePublicOrganization(slug)` →
`OrganizerThemeScope` → `PhoneFrame` (MOD, tokenizowany) → `<Outlet/>` → `ItemDetailContent`
(wydzielone z `ItemDetailPage`). **Bez `PanelNavBar`**.

```
┌──────────────────────────────────────────────────┐
│ PublicLayout <nav>   [🔔] [Konto ▾]    FIXED     │ ← neutralny, poza zakresem
├──────────────────────────────────────────────────┤
│╔════════════════════════════════════════════════╗│
│║ OrganizerThemeScope (org = ania, bordo)        ║│
│║┌──────────────────────────────────────────────┐║│
│║│ PhoneFrame (MOD)  bg [stage] / ≥520 [stage-wide]║
│║│┌────────────────────────────────────────────┐│║│
│║││ kolumna bg [cream]                         ││║│
│║││                                            ││║│
│║││ ← Wróć                        [ink-soft]   ││║│ ← ItemBackButton (MOD):
│║││                                            ││║│   historia | fallback /ania
│║││ ┌ ItemGallery ───────────────────────────┐ ││║│ ← [paper], ramka [line]
│║││ │ ┌────────────────────────────────────┐ │ ││║│
│║││ │ │            [ zdjęcie 4:3 ]         │ │ ││║│
│║││ │ │                          (1/3)     │ │ ││║│ ← licznik bg-ink/70 FIXED
│║││ │ └────────────────────────────────────┘ │ ││║│
│║││ └────────────────────────────────────────┘ ││║│
│║││                                            ││║│
│║││ Rowerek biegowy  [ink]       ( ✎ Edytuj )  ││║│ ← tylko is_owner && !deleted
│║││ Zabawki · Stan: Dobry  [ink-soft]          ││║│   Link → /ania/produkt/9/edit
│║││                                            ││║│   ramka [line], [ink-soft]
│║││ ┌ Opis ──────────────────────────────────┐ ││║│ ← [paper]/[line]
│║││ │ OPIS          [ink-soft]               │ ││║│
│║││ │ Lekki, aluminiowy…   [ink]             │ ││║│
│║││ └────────────────────────────────────────┘ ││║│
│║││                                            ││║│
│║││ ┌ ItemStatusCard ────────────────────────┐ ││║│
│║││ │ AKTUALNY STATUS                        │ ││║│
│║││ │ ┌────────────────────────────────────┐ │ ││║│ ← wnętrze [cream]/[line]
│║││ │ │ (• Dostępna)                       │ │ ││║│ ← pigułka AVAILABLE (MOD):
│║││ │ └────────────────────────────────────┘ │ ││║│   bg [primary-soft]
│║││ └────────────────────────────────────────┘ ││║│   text [primary-fg]
│║││                                            ││║│   (było bg-mint-soft #12604D)
│║││ ┌ ItemHistoryCard ───────────────────────┐ ││║│
│║││ │ HISTORIA                               │ ││║│
│║││ │ ┌────┐ Dodana            [ink]         │ ││║│ ← data: bg [primary-soft]
│║││ │ │ 3  │ Zarejestrowana…   [ink-soft]    │ ││║│   (było bg-mint-soft)
│║││ │ │paź │                                 │ ││║│
│║││ │ └────┘                                 │ ││║│
│║││ └────────────────────────────────────────┘ ││║│
│║││                                            ││║│
│║││   (BRAK PanelNavBar)                       ││║│
│║│└────────────────────────────────────────────┘│║│
│║└──────────────────────────────────────────────┘║│
│╚════════════════════════════════════════════════╝│
└──────────────────────────────────────────────────┘
```

Inne pigułki statusu (bez zmian semantyki): RESERVED / IN_TRANSIT / RETURNING / PROPOSED_SWAP →
`bg-accent-soft text-ink`; LENT → `bg-teal-soft text-ink` FIXED; DELETED → `bg-danger-soft text-danger` FIXED.
Baner „Rzecz usunięta” → `[danger-soft]`/`[danger]` FIXED. `FailedPhotosNotice` → `[cream]`/`[line]`/`[ink]`.

**Punkty integracji**:
- ✅ `router.tsx` (MOD) — w `PublicLayout.children`: `{ path: "/:organizationSlug/produkt", element: <AuthGuard><OrganizerItemLayout/></AuthGuard>, children: [":id", ":id/edit"] }`. Segment statyczny `produkt` wygrywa z catch-all `/:organizationSlug`.
- ✅ `ItemDetailPage.tsx` (MOD) — rozdział na ramę (`/product/:id`: PhoneFrame + PanelNavBar) i treść (`ItemDetailContent`); `Edytuj` → `routes.editPath(item.id)`.
- ✅ `ItemBackButton.tsx` (MOD) — `backFallback` z `useItemRoutes()`.
- ✅ `ItemTimeline.tsx` (MOD) — `text-[#12604D]` → `text-primary-fg`, `bg-mint-soft` → `bg-primary-soft`, `bg-lime-soft` → `bg-accent-soft` (tylko w plikach w zakresie; legacy tokeny zostają dla panelu).
- ✅ `PhoneFrame.tsx` (MOD) — `bg-[#EDF1EA]`/`bg-[#E7EDE4]` → `bg-stage`/`min-[520px]:bg-stage-wide`; w panelu tokeny mają wartości domyślne → wygląd panelu identyczny.

---

<a id="organizer-product-edit"></a>
## 4. Edycja produktu organizatora — `screen:organizer-product-edit`

**Kontekst**: NEW `/:organizationSlug/produkt/:id/edit` (dziecko tego samego layoutu — motyw i rama współdzielone). Nie-właściciel / usunięta rzecz → `<Navigate to={routes.viewPath(id)} replace/>` (= `/ania/produkt/9`).

```
┌──────────────────────────────────────────────────┐
│ PublicLayout <nav>   [🔔] [Konto ▾]    FIXED     │
├──────────────────────────────────────────────────┤
│╔ OrganizerThemeScope ═══════════════════════════╗│
│║┌ PhoneFrame [stage] ──────────────────────────┐║│
│║│┌ kolumna [cream] ───────────────────────────┐│║│
│║││ ← Wróć do podglądu   [ink-soft]            ││║│ ← Link → /ania/produkt/9 (MOD)
│║││                                            ││║│
│║││ Edycja rzeczy  [ink]          ┌────────┐   ││║│
│║││                               │ Gotowe │   ││║│ ← PRIMARY_BTN (MOD):
│║││                               └────────┘   ││║│   bg [primary] text [on-primary]
│║││                                            ││║│   → /ania/produkt/9
│║││ ┌ status (photosInModeration) ───────────┐ ││║│ ← [cream]/[line]/[ink]
│║││ │ Rzecz zdjęta z terminów do czasu       │ ││║│
│║││ │ zatwierdzenia zdjęć… w „Moje rzeczy”.  │ ││║│
│║││ │ Moje rzeczy →          [primary-fg]    │ ││║│ ← ZOSTAJE → /panel/rzeczy
│║││ └────────────────────────────────────────┘ ││║│   (I-9: A)
│║││ ┌ alert (details.failed) ────────────────┐ ││║│
│║││ │ Nie udało się wczytać…                 │ ││║│
│║││ │ Spróbuj ponownie       [primary-fg]    │ ││║│ ← było text-mint
│║││ └────────────────────────────────────────┘ ││║│
│║││ ┌ [paper]/[line] ────────────────────────┐ ││║│
│║││ │ ZDJĘCIA (3/10)                    [✎]  │ ││║│ ← ołówek [ink-soft]
│║││ │ [▣][▣][▣]                              │ ││║│
│║││ └────────────────────────────────────────┘ ││║│
│║││ ┌ [paper]/divide-[line] ─────────────────┐ ││║│
│║││ │ NAZWA I KATEGORIA                 [✎]  │ ││║│
│║││ │ Rowerek biegowy / Zabawki              │ ││║│
│║││ │────────────────────────────────────────│ ││║│
│║││ │ STAN                              [✎]  │ ││║│
│║││ │────────────────────────────────────────│ ││║│
│║││ │ OPIS                              [✎]  │ ││║│
│║││ └────────────────────────────────────────┘ ││║│
│║││ ReadOnlyCards (status + historia jak §3)   ││║│
│║││   (BRAK PanelNavBar)                       ││║│
│║│└────────────────────────────────────────────┘│║│
│║└──────────────────────────────────────────────┘║│
│╚════════════════════════════════════════════════╝│
└──────────────────────────────────────────────────┘
```

**Punkty integracji**:
- ✅ `ItemEditPage.tsx` (MOD) — rama / `ItemEditContent` rozdzielone; `/product/${id}` w L38, L46, L107 → `routes.viewPath(id)`; L115 „Moje rzeczy →” bez zmiany adresu, `text-mint` → `text-primary-fg`.
- ✅ `itemPageShared.ts` (MOD) — `PRIMARY_BTN`: `bg-mint text-white` → `bg-primary text-on-primary`.
- ⚠ `ItemFieldEditors`/`ItemGalleryEditor` używają już tylko tokenów — sprawdzić grep `mint|lime` przy implementacji.

---

<a id="organizer-product-loading"></a>
## 5. Stany ładowania / błędne slugi — `state:organizer-product-loading`

**Kontekst**: cache `["publicOrganization", slug]` jest **zawsze zimny** po stronie terminu (gap §2). Zapytania organizacji i przedmiotu startują **równolegle** (oba hooki w drzewie od razu); motyw bramkuje tylko malowanie treści.

```
5a. org pending (dowolny stan item)       5b. org 404 / błąd / slug k-…
    → neutralny loader, paleta DOMYŚLNA       → treść w palecie DOMYŚLNEJ (nie błąd!)
┌──────────────────────────────────────┐  ┌──────────────────────────────────────┐
│ <nav> [🔔] [Konto ▾]        FIXED    │  │ <nav> [🔔] [Konto ▾]        FIXED    │
├──────────────────────────────────────┤  ├──────────────────────────────────────┤
│┌ PhoneFrame [stage] (domyślne) ─────┐│  │╔ OrganizerThemeScope(null) ════════╗ │
││┌ [cream] ─────────────────────────┐││  │║ = DEFAULT_THEME_VARS              ║ │
│││                                  │││  │║┌ PhoneFrame [stage] ─────────────┐║ │
│││ ← Wróć                           │││  │║│ ← Wróć  (fallback /k-3f9a)      │║ │
│││ Rzecz          [ink]             │││  │║│ [galeria]                        │║ │
│││ ┌──────────────────────────────┐ │││  │║│ Rowerek biegowy     (✎ Edytuj)   │║ │
│││ │░░░░░░ animate-pulse [line] ░░│ │││  │║│ (• Dostępna) mint-soft/#117b63   │║ │
│││ └──────────────────────────────┘ │││  │║│ …                                │║ │
│││ Wczytywanie rzeczy…  [ink-soft]  │││  │║└──────────────────────────────────┘║ │
│││                                  │││  │╚═══════════════════════════════════╝ │
││└──────────────────────────────────┘││  └──────────────────────────────────────┘
│└────────────────────────────────────┘│
└──────────────────────────────────────┘   5c. org OK, item 404/błąd
  Reużywa ItemLoadStates(loading=true)          → ItemLoadStates w motywie org
  – brak mignięcia złej palety (FOUC = 0)        („Nie znaleziono tej rzeczy.” /
  – PanelNavBar: brak                            [Spróbuj ponownie] [paper]/[line])

5d. anonim → AuthGuard → /login?returnTo=/ania/produkt/9 (strona logowania bez motywu)
```

**Tablica decyzji** (`OrganizerItemLayout`):

| `usePublicOrganization` | Render |
|---|---|
| `loading` | `PhoneFrame` (bez zakresu) + `ItemLoadStates loading` |
| sukces | `OrganizerThemeScope(theme z org)` + `Outlet` |
| `notFound` (404) / `error` / slug `k-…` | `OrganizerThemeScope(null)` + `Outlet` — **nigdy** strona błędu |

---

<a id="panel-product-page"></a>
## 6. Strona produktu w panelu (porównanie) — `screen:panel-product-page`

**Kontekst**: EXIST `/product/:id` — wejścia z panelu i powiadomień. Bez zakresu motywu → tokeny mają wartości domyślne z `@theme static`. Jedyna widoczna różnica vs dziś: poprawki kontrastu domyślnej palety (pigułka „Dostępna” `#117b63` na jaśniejszym soft).

```
┌──────────────────────────────────────────────────┐
│ PublicLayout <nav>   [🔔] [Konto ▾]    FIXED     │
├──────────────────────────────────────────────────┤
│┌ PhoneFrame [stage] (domyślne) ──────────────────┐│
││┌ [cream] ──────────────────────────────────────┐││
│││ ← Wróć          (fallback /panel/rzeczy)      │││ ← bez zmian
│││ [galeria]                                     │││
│││ Rowerek biegowy               ( ✎ Edytuj )    │││ ← → /product/9/edit
│││ …opis, status (• Dostępna), historia…         │││
││├───────────────────────────────────────────────┤││
│││ PanelNavBar (EXIST)                           │││ ← sticky bottom, [paper]/[line]
│││  [⌂ Home] [📅 Spotkania] [▣ Moje rzeczy] [🎁 Wypożyczone]│ ← brak aktywnej zakładki
││└───────────────────────────────────────────────┘││   ikony currentColor (MOD)
│└─────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────┘
```

| Cecha | `/product/:id` (panel) | `/:slug/produkt/:id` (organizator) |
|---|---|---|
| Rama | `PhoneFrame` + `PanelNavBar` | `PhoneFrame`, **bez** `PanelNavBar` |
| Paleta | domyślna | motyw organizatora (404 → domyślna) |
| „Wróć” fallback | `/panel/rzeczy` | `/${slug}` |
| „Edytuj” / „Gotowe” | `/product/:id[/edit]` | `/${slug}/produkt/:id[/edit]` |
| „Moje rzeczy →” | `/panel/rzeczy` | `/panel/rzeczy` |
| `/product/new` | tak | nie (tworzenie tylko w panelu) |

---

<a id="public-organization-page"></a>
## 7. Publiczna strona organizacji — `screen:public-organization-page`

**Kontekst**: EXIST `/:organizationSlug` (`pages/PublicOrganizationPage.tsx`, MOD). Migracja `useState`+`useEffect` → `usePublicOrganization`; inline `--color-mint/--color-lime` + `DEFAULT_PRIMARY/ACCENT` → `OrganizerThemeScope`. Karta i układ **bez zmian** (układy/edytor to A2).

```
7a. sukces (motyw bordo)                  7b. loading            7c. 404 / brak slug
┌──────────────────────────────────────┐  ┌────────────────────┐ ┌────────────────────┐
│ <nav> (zalogowany)          FIXED    │  │ <nav>     FIXED    │ │ <nav>     FIXED    │
├──────────────────────────────────────┤  ├────────────────────┤ ├────────────────────┤
│╔ OrganizerThemeScope(org) ══════════╗│  │ [cream] DOMYŚLNA   │ │ [cream] DOMYŚLNA   │
│║ min-h-screen bg [cream]            ║│  │ (bez zakresu)      │ │ (bez zakresu)      │
│║                                    ║│  │                    │ │ Nie znaleziono     │
│║ ┌ karta [paper], ramka [line] ───┐ ║│  │  Wczytywanie…      │ │ strony     [ink]   │
│║ │                                │ ║│  │     [ink-soft]     │ │ Ta organizacja nie │
│║ │      ( Organizacja )           │ ║│  │                    │ │ istnieje [ink-soft]│
│║ │   badge: bg [accent-soft]      │ ║│  └────────────────────┘ └────────────────────┘
│║ │          text [accent-fg]      │ ║│
│║ │   (było bg-lime-soft           │ ║│  Org tylko z accent_color (bez primary):
│║ │    text-[#56701F])             │ ║│  → paleta domyślna (I-7: A) — lone accent
│║ │                                │ ║│    przestaje być widoczny.
│║ │   Studio Ania   [ink] serif    │ ║│
│║ │                                │ ║│
│║ │   domena.pl/ania   [ink-soft]  │ ║│
│║ └────────────────────────────────┘ ║│
│╚════════════════════════════════════╝│
└──────────────────────────────────────┘
```

**Punkty integracji**:
- ✅ `hooks/usePublicOrganization.ts` (NEW) — klucz `["publicOrganization", slug]`, zwrot `{ data, loading, notFound, error, refetch }` wg `data-fetching.md`; bez retry na 404. Współdzielony z §3/§5.
- ✅ Loading i 404 renderowane **poza** zakresem (paleta domyślna, HLD §9.1).
- ✅ `PublicOrganizationPage.test.tsx` — dodać `createQueryWrapper`.

---

<a id="komponenty"></a>
## Komponenty

<a id="organizer-theme-scope"></a>
### `component:organizer-theme-scope` — `theme/OrganizerThemeScope.tsx` (NEW)

```
<div data-organizer-theme={preset|custom|default}
     style={{ "--color-primary": …, …13 kluczy… }}
     className="contents?  /  min-h-full">   ← bez transform/filter/perspective/contain/will-change
  {children}
</div>
```
Zawsze ustawia **wszystkie 13** zmiennych (także domyślne) → zagnieżdżenie/porzucenie motywu deterministyczne. Wejście: `theme: OrganizerTheme | null` → `resolveOrgTheme()`.

<a id="item-routes"></a>
### `component:item-routes` — `useItemRoutes()` (NEW, w `pages/product/`)

```
organizationSlug = "ania"  → base "/ania/produkt", backFallback "/ania"
brak parametru             → base "/product",      backFallback "/panel/rzeczy"
```

<a id="organizer-item-layout"></a>
### `component:organizer-item-layout` — `pages/product/OrganizerItemPage.tsx` (NEW)
AuthGuard (w routerze) → `usePublicOrganization(slug)` → [loader | `OrganizerThemeScope`] → `PhoneFrame` → `<Outlet/>`. Patrz §5.

<a id="themed-cta"></a>
### `component:themed-primary-button` — `TermFooter`, `.kg-btn-primary`, `PRIMARY_BTN`
`bg-primary text-on-primary`, `disabled:opacity-60`, fokus `[focus-ring]`.

<a id="brings-marker"></a>
### `component:exchange-markers` — `Avatar` `.kg-mark-shares` / `.kg-mark-brings` + `ExchangeLegend`
```
 ( ● )  udostępnia: [primary] + ikona [on-primary], obwódka [cream]   ← motywowany
 ( ◐ )  przynosi:   [teal]    + ikona [ink]                            ← stały (fix 2,32→ink)
```

<a id="available-pill"></a>
### `component:item-status-pill` — `ItemTimeline.statusLines`
`AVAILABLE`: `bg-primary-soft text-primary-fg`; „w toku”: `bg-accent-soft text-ink`; LENT/DELETED stałe.

<a id="org-badge"></a>
### `component:org-badge` — badge „Organizacja”
`bg-accent-soft text-accent-fg` (kontrast ≥4,5:1 zapewnia generator).

### Reużywane bez zmian
- **PublicLayout**: `components/layout/PublicLayout.tsx` — pasek konta, poza zakresem.
- **NotificationBell**, **AccountMenu**: `components/shared/` — chrom platformy, legacy `mint`.
- **Avatar** (`components/shared/Avatar.tsx`) — `PALETTE` stała.
- **ItemLoadStates**, **ItemGallery**, **ItemReadOnlyParts** — już na tokenach (`line`, `paper`, `cream`, `ink*`).
- **AuthGuard** — `returnTo` z pełną ścieżką.

---

<a id="uwagi-implementacyjne"></a>
## Uwagi implementacyjne

### Spójność
- ✅ Żadnych hexów w klasach arbitralnych / `style` / `stroke=` / `c=` na 3 stronach poza allowlistą (murawa, drewno, Avatar PALETTE).
- ✅ Żadnych `var(--ink|--mint|--teal|--paper|--cream|--sage|--line|--danger|--lime)` po migracji (grep gate).
- ✅ Pliki w zakresie przechodzą na utility ról (`bg-primary`, `text-primary-fg`, `bg-primary-soft`, `bg-accent-soft`…); legacy `mint*/lime*/sage` zostają statyczne dla panelu.
- ✅ Kolejność: tokeny → `.kg-*` i konsumenci `var(--…)` → usunięcie `:root` w KragStage.

### Dostępność
- Tekst ≥4,5:1 (`primary-fg` na `cream`/`paper`/`primary-soft`, `accent-fg` na `accent-soft`, `on-primary` na `primary`), ikony/fokus ≥3:1 (`focus-ring`, ikona ink na teal).
- Scrim + arkusz: istniejący focus trap i Escape bez zmian.
- Status przedmiotu niesiony tekstem — kolor pigułki tylko wzmacnia.

### Responsywność
- < 520 px: `PhoneFrame` pełnoekranowy, tło `[stage]`; ≥ 520 px: padding 24 px, tło `[stage-wide]`.
- Strona terminu: bez ramki (jak dziś), `#root` max 1200 px.

### Alternatywy odrzucone
- **Nowa `PublicColumnFrame` dla terminu i produktu** — zmienia strukturę strony terminu (poza zakresem HLD §16). Wybrano tokenizowany `PhoneFrame` bez `PanelNavBar`.
- **Render produktu od razu w palecie domyślnej, potem przełączenie** — mignięcie palety (FOUC). Wybrano neutralny loader.
- **Ukrycie „Moje rzeczy →” na trasie organizatora** — to własny inwentarz użytkownika; link zostaje.
- **Motyw na pasku konta / dzwonku** — chrom platformy musi być rozpoznawalny między organizatorami (ADR-014).

---

*Generated by ui-mockup-generator subagent*
