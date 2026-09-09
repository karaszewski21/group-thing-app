# UI Mockups: Add per-term public pages

**Generated**: 2026-09-08
**Task Path**: `.maister/tasks/development/2026-09-08-per-term-public-pages`
**Feature Type**: Enhancement (route + data-source change to an existing view; no new visual layout)

---

## Overview

### UI Requirements

| # | Element | Status |
|---|---------|--------|
| 1 | Per-term PUBLIC page rendering exactly one URL-named term (circle name + organizer, that term's date + description, that term's needed-items, "Zapisani opiekunowie" list, RSVP CTA + post-RSVP confirmation) | Existing layout, new data source |
| 2 | "No terms yet" fallback state (organizer center + "Organizator nie dodał jeszcze żadnych zajęć." + no RSVP CTA) | Already exists in current component when `next_term` is null |
| 3 | Term-less redirect / loading state ("Wczytywanie..." then `<Navigate replace>` to nearest term) | New tiny resolver view |
| 4 | 5 in-app links re-pointed to the per-term URL (before/after only — layout unchanged) | Existing UI, destination string change |

### Integration Strategy

**Decision**: Do **not** build a new page. Make the existing `PublicKragGrupyView`
(`src/frontend/src/pages/krag/KragGrupyPage.tsx` lines 494-695) term-aware: it reads a
`:termId` route param, the data hook forwards it as `?term_id=` to the existing public
endpoint, and the component renders `circle.next_term` exactly as today (the backend now
puts the URL-named term in that field). All `.kg-*` markup, the phone-frame shell, the
RSVP modal and the account-merge form are untouched.

**Rationale**:
- Scope-clarifications.md Decision 1 locks the layout as "the SAME visual layout as the
  existing `PublicKragGrupyView`". A new component would duplicate ~200 lines of `.kg-*` JSX.
- The "no terms yet" and post-RSVP states already exist in this component — reusing it keeps
  all three states in one code path.
- `frontend/css.md` (Consistent Methodology): this page deliberately stays on hand-written
  `.kg-*` CSS, not Tailwind. Reusing the component preserves that decision automatically.

**Alternative rejected**: a term switcher / dropdown on the page. Explicitly out of scope
(Decision 3: "No term switcher / no public terms-list endpoint. One page = one term.").

---

## Existing Layout Analysis

### Application structure

The public circle page is a **standalone route** (no `AppShell`, no sidebar) — same pattern
as `/login`, `/oauth2/authorize`. It renders its own phone-frame chrome:

- `.kg-stage` — full-viewport `#EDF1EA` backdrop, centers content
- `.kg-app` — `max-width: 430px` column, `--cream` background; at `min-width: 520px` it gets
  the rounded phone-frame border + shadow (`box-shadow: ... 0 0 0 9px #1E2E27`)
- `<style>{CSS}</style>` — the entire `.kg-*` token + class block is inlined in
  `KragGrupyPage.tsx` (lines 21-95); the Fraunces/Karla webfont `<link>` is appended in a
  `useEffect`

### Key components

| Concern | File | Role |
|---------|------|------|
| Route entry + public/private branch | `src/frontend/src/pages/krag/KragGrupyPage.tsx` (`KragGrupyPage`, line 123) | `location.pathname.endsWith("/publiczny")` → `PublicKragGrupyView` |
| **Public view (the template)** | `src/frontend/src/pages/krag/KragGrupyPage.tsx` (`PublicKragGrupyView`, lines 494-695) | Header, organizer center, term block, needed-items, guardian list, RSVP CTA / confirmation |
| Public data hook | `src/frontend/src/hooks/usePublicKragGrupy.ts` | Calls `getPublicCircle(groupId)` only — never an authed call |
| Public API call | `src/frontend/src/api/groups.ts` (`getPublicCircle`, line 141) | `GET /groups/public/{groupId}` → `PublicCircleResponse` |
| RSVP modal | `src/frontend/src/components/krag/RsvpDialog.tsx` | `.kg-*`-styled bottom sheet; writes `guestProfileIdKey(groupId, termId)` to localStorage |
| Account-merge inline form | `src/frontend/src/components/krag/AccountMergeForm.tsx` | Shown per needed-item after RSVP |
| Resolve-then-redirect precedent | `src/frontend/src/pages/krag/KragEntryPage.tsx`, `src/frontend/src/pages/PublicOrganizationPage.tsx` | `useEffect` fetch → `navigate(..., { replace: true })`; spinner / "Wczytywanie…" while resolving |
| Router table | `src/frontend/src/router.tsx` | `/krag/:groupId/publiczny` at line 53; catch-all `/:organizationSlug` last (line 119) |
| In-app term tiles | `src/frontend/src/pages/panel/PanelPage.tsx` lines ~780, ~1028, ~1077 | `<Link to={`/krag/${group.id}/publiczny`}>` term tiles |
| Stepper done screens | `src/frontend/src/components/panel/FirstTermStepperOrganizer.tsx:53`, `FirstTermStepperGuest.tsx:82` | `<Link to={`/krag/${circleId}/publiczny`}>` "Przejdź do publicznej strony →" |

### Identified patterns

- **Standalone phone-frame page**: `.kg-stage` > `.kg-app`, inline `<style>`, webfont link in effect.
- **Loading / error states**: `<div className="kg-state">Wczytywanie...</div>` and
  `<div className="kg-state">{error}</div>` inside the same shell (lines 540-560).
- **Resolve-then-redirect**: mount `useEffect` → async fetch → `navigate(url, { replace: true })`;
  render a spinner (`KragEntryPage`) or `Wczytywanie…` (`PublicOrganizationPage`) meanwhile.
- **Card sections**: `.kg-bring` (soft-bordered rounded panel) for content blocks, `.kg-card`
  for the guardian list and the post-RSVP confirmation.
- **RSVP state derived from localStorage** (survives reload), scoped per `groupId:termId`.

---

## Mockups

<a id="screen-public-term-populated"></a>
### Mockup 1 — Per-term public page, populated (RSVP not yet done)

**Route**: `/:organizationSlug/grupa/:groupId/term/:termId` (canonical)
or `/krag/:groupId/publiczny/:termId` (group-id form, renders directly)
**Component**: `PublicKragGrupyView` (MODIFIED — term-aware) in `KragGrupyPage.tsx`
**Context**: A visitor opens a shared link to one specific term.

```
              ┌───────────────────────────────────┐  <- .kg-stage (#EDF1EA)
              │ ┌───────────────────────────────┐ │  <- .kg-app  max-width 430px
              │ │ ← Wróć                        │ │     .kg-head  (sticky, --paper)
              │ │ KRĄG                          │ │     .kg-eyebrow
              │ │ Nutki dla starszaków          │ │     <h1> circle.name
              │ │ Prowadzi: Ania Kowalska       │ │     .kg-head-sub  organizer_display_name
              │ ├───────────────────────────────┤ │
              │ │                               │ │     .kg-circle-wrap
              │ │            ( A )               │ │     .kg-center-av  (organizer initial)
              │ │        Ania Kowalska           │ │     .kg-center strong
              │ │        prowadzi zajęcia        │ │     .kg-center span
              │ │        (NO family orbit)       │ │
              │ ├───────────────────────────────┤ │
              │ │ Termin                        │ │  <- .kg-bring  #1   [CHANGED: heading
              │ │ 2026-09-20 — 17:00 Park       │ │     .kg-bring-sub    was "Najbliższy
              │ │ Sołacki                       │ │     term.occurs_on + term.description
              │ ├───────────────────────────────┤ │        term"; now the URL-named term]
              │ │ Potrzebne rzeczy              │ │  <- .kg-bring  #2
              │ │  • Instrumenty — 5 grzechotek │ │     term.needed_items[]  (.kg-bring-item)
              │ │  • Materiały plastyczne       │ │
              │ ├───────────────────────────────┤ │
              │ │ Zapisani opiekunowie          │ │  <- .kg-card
              │ │  Ania Kowalska                │ │     circle.guardians[] (display_name)
              │ │  Marek Nowak                  │ │
              │ ├───────────────────────────────┤ │
              │ │      ＋ Zapisz się na zajęcia │ │  <- .kg-btn-primary (centered)
              │ │                               │ │     onClick -> setShowRsvpDialog(true)
              │ └───────────────────────────────┘ │
              └───────────────────────────────────┘
```

**What changes vs today**
- `usePublicKragGrupy(groupId)` -> `usePublicKragGrupy(groupId, termId)` — forwards `?term_id=`.
- `getPublicCircle(groupId)` -> `getPublicCircle(groupId, termId?)` — appends the query param.
- Backend `GET /api/groups/public/{group_id}?term_id={term_id}` returns that term in
  `next_term` (field name unchanged; no `terms` array added).
- `.kg-bring` #1 heading `"Najbliższy termin"` -> `"Termin"` (it is no longer necessarily
  the nearest one).
- The localStorage RSVP-state effect keys off the resolved term id (already the case —
  `circle?.next_term?.id`), so no change there.

**Component reuse**
| Component | Path | Change |
|-----------|------|--------|
| `PublicKragGrupyView` | `KragGrupyPage.tsx:494` | MODIFIED — reads `:termId`, passes it to the hook |
| `.kg-*` CSS block | `KragGrupyPage.tsx:21-95` | UNCHANGED |
| `RsvpDialog` | `components/krag/RsvpDialog.tsx` | UNCHANGED (already takes `termId` prop) |
| `AccountMergeForm` | `components/krag/AccountMergeForm.tsx` | UNCHANGED |

---

<a id="screen-public-term-post-rsvp"></a>
### Mockup 2 — Post-RSVP confirmation state

**Context**: Same page after the visitor submits `RsvpDialog`, or on reload when
`localStorage["guest_profile_id:<groupId>:<termId>"]` is present.

```
              │ │ ...header / organizer / term / needed-items unchanged... │
              │ ├───────────────────────────────┤ │
              │ │ Potrzebne rzeczy              │ │  <- needed items now each show a
              │ │  • Instrumenty — 5 grzech. [Zgłoś się] │     "Zgłoś się" button (canMerge)
              │ │       └─ AccountMergeForm (inline, when a row is expanded)
              │ ├───────────────────────────────┤ │
              │ │ Zapisani opiekunowie          │ │
              │ │  Ania Kowalska                │ │
              │ │  Marek Nowak                  │ │
              │ ├───────────────────────────────┤ │
              │ │ ✓ Zapisano! Do zobaczenia na │ │  <- .kg-card role="status"
              │ │   zajęciach.                  │ │     .kg-status-line
              │ └───────────────────────────────┘ │     [RSVP CTA button is GONE]
              └───────────────────────────────────┘
```

**No change required** — this branch (`hasGuestProfile ? <confirmation> : <CTA>`,
lines 664-682) already works once the term id is the URL-named one.

---

<a id="screen-public-no-terms"></a>
### Mockup 3 — "No terms yet" fallback

**Route**: any public entry when the circle has **zero** terms
(`/:organizationSlug/grupa/:groupId`, `/krag/:groupId/publiczny`, or a per-term URL whose
circle turns out to have no terms). No redirect happens — this state renders in place.
**Context**: Organizer created the circle but has not added a term.

```
              │ ┌───────────────────────────────┐ │
              │ │ ← Wróć                        │ │
              │ │ KRĄG                          │ │
              │ │ Nutki dla starszaków          │ │
              │ │ Prowadzi: Ania Kowalska       │ │
              │ ├───────────────────────────────┤ │
              │ │            ( A )               │ │  <- organizer center only
              │ │        Ania Kowalska           │ │
              │ │        prowadzi zajęcia        │ │
              │ ├───────────────────────────────┤ │
              │ │ Termin                        │ │  <- .kg-bring #1
              │ │ Organizator nie dodał jeszcze │ │     .kg-bring-sub  (term === null)
              │ │ żadnych zajęć.                │ │
              │ ├───────────────────────────────┤ │
              │ │ Potrzebne rzeczy              │ │  <- .kg-bring #2
              │ │ Brak listy potrzebnych rzeczy │ │     .kg-bring-empty
              │ │ na te zajęcia.               │ │
              │ ├───────────────────────────────┤ │
              │ │ Zapisani opiekunowie          │ │  <- .kg-card
              │ │ Nikt jeszcze się nie zapisał. │ │     .kg-bring-empty
              │ └───────────────────────────────┘ │     [NO RSVP CTA — term is null]
              └───────────────────────────────────┘
```

**No change required** — this is the current behavior of `PublicKragGrupyView` when
`circle.next_term` is `null` (lines 606-608, 614-616, 664-682 all already guard on `term`).

---

<a id="screen-term-redirect-loading"></a>
### Mockup 4 — Term-less redirect / loading state

**Routes**: `/krag/:groupId/publiczny` (kept) and (optional) `/:organizationSlug/grupa/:groupId`
**Component**: NEW tiny resolver view (follows `KragEntryPage` / `PublicOrganizationPage` pattern)
**Context**: A visitor opens an old term-less shared link, or the org-slug circle root.

```
   t = 0ms                              t ~ 200-500ms
 ┌─────────────────────────┐          ┌─────────────────────────┐
 │ ┌─────────────────────┐ │          │  fetch getPublicCircle  │
 │ │                     │ │   ───►   │  compute nearest term:  │
 │ │     Wczytywanie...  │ │          │   soonest upcoming,     │
 │ │   (.kg-state, in    │ │          │   else most recent past │
 │ │    the .kg-app      │ │          └───────────┬─────────────┘
 │ │    phone frame)     │ │                      │
 │ └─────────────────────┘ │          ┌───────────┴─────────────┐
 └─────────────────────────┘          │ terms > 0 ?             │
                                      │  YES → <Navigate replace│
                                      │    to per-term URL>     │
                                      │  NO  → render Mockup 3  │
                                      │    ("no terms yet")     │
                                      └─────────────────────────┘
```

**Redirect target**
- From `/krag/:groupId/publiczny` (no slug available) → `/krag/:groupId/publiczny/:termId`.
- From `/:organizationSlug/grupa/:groupId` → `/:organizationSlug/grupa/:groupId/term/:termId`.

**Implementation notes**
- Reuse the `.kg-stage` / `.kg-app` / `.kg-state` shell for the "Wczytywanie..." frame so the
  redirect flashes the same chrome the destination page uses (no Tailwind spinner mismatch).
- "Nearest term" = the existing `get_public_circle_view` `next_term` rule (soonest upcoming,
  else most recent past) — server already computes this; the resolver can just read
  `next_term.id` from a plain `getPublicCircle(groupId)` call (no `term_id`).
- Zero terms → do not call `<Navigate>`; render `PublicKragGrupyView` in its `term === null`
  state (Mockup 3).

---

<a id="links-before-after"></a>
## Mockup 5 — Before / after of the 5 in-app link destinations

Layout of every tile / button below is **unchanged** — only the `to=` string changes.
`term` / `group` / `circle` are already in local scope at each call site.

```
┌────────────────────────────────────────────────────────────────────────────────┐
│ #  Call site                                          BEFORE            AFTER   │
├────────────────────────────────────────────────────────────────────────────────┤
│ 1  PanelPage.tsx ~line 780                                                      │
│    Dashboard "Najbliższe terminy" tile (organizer + guest home)                 │
│      to={`/krag/${group.id}/publiczny`}   →   to={`/krag/${group.id}/publiczny/${term.id}`}
│                                                                                │
│ 2  PanelPage.tsx ~line 1028                                                     │
│    Organizer "Terminy" list tile                                                │
│      to={`/krag/${group.id}/publiczny`}   →   to={`/krag/${group.id}/publiczny/${term.id}`}
│                                                                                │
│ 3  PanelPage.tsx ~line 1077                                                     │
│    Guest "Spotkania" list tile                                                  │
│      to={`/krag/${group.id}/publiczny`}   →   to={`/krag/${group.id}/publiczny/${term.id}`}
│                                                                                │
│ 4  FirstTermStepperOrganizer.tsx:53                                             │
│    "Przejdź do publicznej strony →" (done screen)                               │
│      to={`/krag/${circleGroupId}/publiczny`}                                    │
│                        →   to={`/krag/${circleGroupId}/publiczny/${createdTermId}`}
│      + capture createTerm() return:  const t = await createTerm({...});         │
│        setCreatedTermId(t.id);   (currently the return value is discarded)      │
│                                                                                │
│ 5  FirstTermStepperGuest.tsx:82                                                 │
│    "Przejdź do publicznej strony →" (done screen)                               │
│      to={`/krag/${circle?.id}/publiczny`}                                       │
│                        →   to={`/krag/${circle?.id}/publiczny/${createdTermId}`}│
│      + capture createTerm() return in handleStep2() the same way                │
└────────────────────────────────────────────────────────────────────────────────┘
```

All 5 use the **group-id form** (`/krag/:groupId/publiczny/:termId`) — the anonymous page
has no org slug, and the guest stepper's user typically has no organization at all
(scope-clarifications.md Decision 1). Tiles 1-3 still point at the term-less
`/krag/:groupId/publiczny` only if `term.id` is somehow absent — it never is in these loops
(`terms.map(({ term }) => ...)`).

### Tile anatomy (unchanged — shown for reference)

```
┌──────────────────────────────────────────────┐  <- <Link> .rounded-2xl .border .bg-cream
│ ┌────┐  Nutki dla starszaków                 │     hover:border-mint
│ │ 20 │  17:00 Park Sołacki                   │     h-[46px] date chip (.bg-mint-soft)
│ │WRZ │  [Instrumenty] [Materiały]            │     group.name / term.description
│ └────┘                                       │     neededItems -> .bg-lime-soft pills
└──────────────────────────────────────────────┘
```

---

## Reusable Components

### Reused UNCHANGED
- **`RsvpDialog`** — `src/frontend/src/components/krag/RsvpDialog.tsx`. Already accepts
  `groupId` + `termId`; writes the per-term localStorage key. No change.
- **`AccountMergeForm`** — `src/frontend/src/components/krag/AccountMergeForm.tsx`. Inline
  per-needed-item form after RSVP. No change.
- **`.kg-*` CSS + phone-frame shell** — inline in `KragGrupyPage.tsx:21-95`. No change.
- **`ModalSheet` / `Field`** — exported from `PanelPage.tsx`, used by both steppers. No change.
- **Panel term-tile markup** — `PanelPage.tsx` (3 sites). Visual markup unchanged.

### Modified
- **`PublicKragGrupyView`** — `src/frontend/src/pages/krag/KragGrupyPage.tsx:494`.
  Read `:termId` param; pass to hook; rename `.kg-bring` #1 heading to "Termin".
- **`usePublicKragGrupy`** — `src/frontend/src/hooks/usePublicKragGrupy.ts`.
  Accept optional `termId`; include in `getPublicCircle` call + `useCallback` deps.
- **`getPublicCircle`** — `src/frontend/src/api/groups.ts:141`.
  Optional `termId` → `?term_id=` query string.
- **`router.tsx`** — add `/:organizationSlug/grupa/:groupId/term/:termId`,
  `/krag/:groupId/publiczny/:termId`, and the resolver routes; keep multi-segment routes
  **above** the last-declared `/:organizationSlug` catch-all (line 119).
- **`PanelPage.tsx`** (×3), **`FirstTermStepperOrganizer.tsx`**, **`FirstTermStepperGuest.tsx`** —
  link `to=` string + (steppers) capture `createTerm` return.

### New
- **Term-less public redirect resolver** — small component in the `krag/` folder following
  `KragEntryPage.tsx` (spinner + `useEffect` fetch + `navigate(replace)`). Reuses the
  `.kg-state` "Wczytywanie..." frame. Renders `PublicKragGrupyView` (term-null) on zero terms.

---

## Implementation Notes

### Consistency checklist
- Public page stays on hand-written `.kg-*` CSS (not Tailwind) — `frontend/css.md` Consistent
  Methodology; reusing `PublicKragGrupyView` enforces this for free.
- Redirect/loading frame reuses `.kg-stage`/`.kg-app`/`.kg-state`, matching the destination
  chrome and the existing `KragGrupyPage` loading state (lines 540-548).
- New routes registered before the `/:organizationSlug` catch-all, multi-segment so no
  reserved-slug change (scope-clarifications.md Decision 1).
- In-app tiles keep identical markup — only the destination URL changes.

### Accessibility
- RSVP confirmation `.kg-card` keeps `role="status"` (line 665) so the state change is announced.
- "Wczytywanie..." redirect frame should carry `role="status"` / `aria-label="Wczytywanie"`
  like `KragEntryPage`'s spinner (line 57-58).
- Guardian list is a plain `<ul>` with `list-style: none` — unchanged; still a real list for
  screen readers.
- `← Wróć` (`navigate(-1)`) still present in `.kg-head`; on a fresh deep-link with no history
  this is a no-op — acceptable, unchanged from today.

### Responsive behavior
- < 520px: full-bleed `.kg-app` column, `max-width: 430px`, `min-height: 100vh`.
- ≥ 520px: centered, rounded phone-frame border + shadow (`.kg-app` media query, line 91-94).
- No new breakpoints introduced.

---

## Alternatives Considered

### Option A — New standalone `PublicTermPage` component (Rejected)
Would duplicate the header / organizer-center / needed-items / guardian-list / RSVP-CTA JSX
and re-inline or import the `.kg-*` CSS. Higher maintenance, two code paths for the same
three states. Rejected — Decision 1 mandates the identical layout.

### Option B — On-page term switcher / list (Rejected)
A `<select>` or tab strip to move between terms without changing URL. Explicitly out of scope
(Decision 3: "One page = one term. No term switcher."). Also needs a public terms-list
endpoint that Decision 3 forbids.

### Option C — Server 301 from group-id form to slug form (Rejected)
`/krag/:groupId/publiczny/:termId` → `/:organizationSlug/grupa/:groupId/term/:termId`.
Rejected — the anonymous page and the guest stepper have no org slug to build that URL
(Decision 1); the group-id form renders directly instead.

### Option D (Selected) — Term-aware reuse of `PublicKragGrupyView` + thin redirect resolver
One component, three states already built, `.kg-*` methodology preserved, minimal route
additions. Matches every locked decision in scope-clarifications.md.

---

*Generated by ui-mockup-generator subagent*
