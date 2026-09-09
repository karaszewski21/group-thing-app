# Specification: Add per-term public pages

Date: 2026-09-09
Task path: `.maister/tasks/development/2026-09-08-per-term-public-pages`
Status: IMPLEMENTED. See `implementation/work-log.md`.

## Amendment (2026-09-09, post-implementation)

Per user request, the **null-`organizer_slug` fallback path was removed**. `resolve_organizer_slug`
now **always returns a string**: the organizer's `Organization` slug when they have one, else a
stable `k-<12 hex>` hash (`_fallback_organizer_slug`, keyed on organizer party id; group id when
there is no active leadership). No secret — the slug segment is cosmetic and unvalidated.

Consequences vs. the body of this spec:
- §3.3 / FR-4 — `resolve_organizer_slug` return type is `str`, not `str | None`. It is now also
  populated on `POST /api/groups` and `POST /api/groups/mine` (not just `GET`). `GET /api/groups`
  (list) still returns `null` (N+1 avoidance) — the Pydantic/TS field stays `str | None`.
- §3.7 / FR-6 — no null-slug branch. All 5 link builders always build
  `/{organizer_slug}/grupa/{groupId}/term/{termId}` (frontend uses `?? "krag"` only to satisfy
  the nullable type on the unused list path). Panel term tiles no longer fall back to `/krag/:id`.
  Both stepper "done" CTAs are always "Przejdź do publicznej strony →" (the `/organization` nudge
  is gone). `FirstTermStepperOrganizer` gets the slug from `myGroups[0].organizer_slug`, not the
  Panel's org-level `organizationSlug`.
- §3.7 / FR-7 — the copy-link button is **always enabled** (no `disabled`, no
  "Utwórz profil organizacji…" nudge title).
- §12.1 — backend test 6 renamed `..._isOrgSlugWhenOrgExists_elseStableHash`; no-org case asserts
  the `k-<hash>` pattern, not `None`.
- §12.3 — `PanelPage.test.tsx`: `mockGroupNoSlug` → `mockGroupHashSlug`; the "disabled copy button"
  test was deleted; fallback-URL assertions became hash-slug-URL assertions.

Everything below is the original spec, kept for context.

---

All architecture decisions were **locked** in `analysis/technical-clarifications.md` and reproduced
here.

---

## 1. Overview / Goal

Give every term of a circle its own shareable, unauthenticated public URL so an organizer can
link a parent to **one specific term** (not only the server-picked nearest one). Today the sole
public view is `/krag/:groupId/publiczny`, which always renders `circle.next_term`; every in-app
link and every shared link collapses to that nearest term.

This is a **modify-existing-capability** task: the per-term work is already parameterised by
`term_id` in the backend (`list_needed_items`, `list_attendances_for_term`), RSVP is already
term-scoped end to end, and `guestProfileIdKey(groupId, termId)` is already keyed by both ids.
The change is (a) a new slug-shaped route family, (b) a `term_id` query param on the existing
public endpoint, (c) an `organizer_slug` projection so in-app link builders can construct the
slug URL, (d) repointing 5 link builders + a new copy-link button, (e) deleting the old
`/publiczny` route.

No new database tables, no migration (read-only; `ix_term_attendances_term_id` already exists).

---

## 2. Scope

### In scope

| # | Item |
|---|------|
| 1 | New public route `/:organizationSlug/grupa/:groupId/term/:termId` → per-term public page |
| 2 | New public route `/:organizationSlug/grupa/:groupId` → term-less redirect resolver (→ nearest term; renders "no terms yet" in place when the circle has zero terms) |
| 3 | Delete route `/krag/:groupId/publiczny` and the `pathname.endsWith("/publiczny")` detection in `KragGrupyPage` |
| 4 | Generalize `get_public_circle_view(db, group_id, term_id: int \| None = None)` + `GET /api/groups/public/{group_id}?term_id=` |
| 5 | Add `organizer_slug: str \| None` to `PublicCircleResponse` **and** `GroupResponse` (+ the two TS types) |
| 6 | `list_needed_items` gains `.order_by(NeededItem.id)` |
| 7 | Frontend data path: `usePublicKragGrupy(groupId, termId?)` → `getPublicCircle(groupId, termId?)` → `?term_id=` |
| 8 | Repoint 5 in-app link builders (3 × `PanelPage`, 2 × first-term steppers) to the slug URL, with null-slug fallbacks |
| 9 | Copy-link button on each row of the organizer "Terminy" list only |
| 10 | Reword the public page's not-found state from "Nie znaleziono grupy" → generic "Nie znaleziono" / "Nie znaleziono terminu" |
| 11 | Test updates + new tests (backend + frontend) |

### Out of scope (confirmed — `analysis/technical-clarifications.md` §"Out of scope")

- Term switcher on the public page / any public list of a circle's terms / `GET /api/groups/public/{id}/terms` / a `terms[]` array on `PublicCircleResponse`.
- The authenticated private `/krag/:groupId` view's term selection (`currentTerm = terms[0]`) — left exactly as-is; the public/private term-rule inconsistency is accepted.
- Auto-creating Organizations; requiring an Organization to create a circle.
- A copy-link / share affordance anywhere other than the organizer "Terminy" rows (not the guest "Spotkania" list, not the public page, not the steppers).
- Any change to `RsvpDialog`, `AccountMergeForm`, `createRsvp`, `mergeAnonymousProfile`, `guestProfileIdKey`, `service.create_rsvp`, `service.merge_anonymous_profile`.
- Backward compatibility for already-shared `/krag/:groupId/publiczny` links — the app is **not** in production; old links may 404.
- DB migration (none needed).

---

## 3. Architecture & Technical Approach

The approach below is **decided**. It is recorded for the planner, not for re-evaluation. See
`analysis/design-context/ascii/ui-mockups.md` §"Alternatives Considered" for the rejected options
(new standalone component, on-page term switcher, server 301 group-id→slug).

### 3.1 URL scheme

Two new routes, **both** registered in `src/frontend/src/router.tsx` **before** the last-declared
single-segment `/:organizationSlug` catch-all (currently line 119). Both are multi-segment, so
React Router route-ranking never lets the catch-all shadow them and **no `RESERVED_SLUGS`
change is needed**.

| Route | Purpose |
|-------|---------|
| `/:organizationSlug/grupa/:groupId/term/:termId` | Per-term public page. Renders `PublicKragGrupyView` for the URL-named term. |
| `/:organizationSlug/grupa/:groupId` | Term-less resolver. Fetches the circle, `<Navigate replace>` to `/:organizationSlug/grupa/:groupId/term/:nearestTermId`; renders `PublicKragGrupyView` in its `term === null` state when the circle has zero terms. |

- Segment words are exactly `grupa` and `term` (English `term` — **not** `termin`).
- `:organizationSlug` is **cosmetic**: never validated against the circle's organizer, never sent to the backend. A wrong/stale slug still renders the page. It is only echoed back into the redirect target and is otherwise ignored by both route components.
- `:groupId` and `:termId` are numeric. Groups have no slug column — `:groupId` is the numeric `Group.id`, `:termId` the numeric `Term.id`.
- The old `/krag/:groupId/publiczny` route (router.tsx lines ~48–55) is **deleted** outright, along with any `/krag/:groupId/publiczny/:termId` idea from the earlier mockup draft (never built). The authenticated `/krag/:groupId` (private) route is **kept** unchanged.

### 3.2 Backend endpoint (generalized, not new)

`GET /api/groups/public/{group_id}?term_id={term_id}`

- `term_id` is a **query parameter**, so the path still matches the existing
  `^/api/groups/public/[^/]+$` PUBLIC row in `AUTHORIZATION_MATRIX` (`app/core/auth_deps.py`).
  **No new auth-matrix row, no route-registration-order change, no new `Depends`.** This is the
  core reason the query-param shape was chosen over a `/terms/{id}` path segment
  (`standards/backend/security.md` — the matrix stays the single readable reference; adding a
  path segment would require a new PUBLIC row before the blanket `GET ^/api/groups(/.*)?$` READ
  row and registration ahead of `get_group`).
- Router handler (`app/groups/router.py`, existing `get_public_circle`, line ~74) gains
  `term_id: int | None = None` and forwards it. Docstring updated to cite the unchanged matrix
  row and the new param.

`service.get_public_circle_view(db, group_id, term_id: int | None = None)` (`app/groups/service.py:546`):

- **`term_id` present**:
  1. `term = await get_term(db, term_id)` — raises `EntityNotFoundException("Term", term_id)` → 404 when the term does not exist.
  2. Ownership guard, copied verbatim from `create_rsvp` (`service.py:620–622`):
     ```
     if term.circle_group_id != group_id:
         raise EntityNotFoundException("Term", term_id)
     ```
  3. Use that `term` for `list_needed_items` + `list_attendances_for_term` instead of the computed `next_term`.
- **`term_id` absent**: keep the current selection exactly — `list_terms` (DESC by `occurs_on`),
  `upcoming = [t for t in terms if t.occurs_on >= date.today()]`,
  `next_term = min(upcoming, key=occurs_on) if upcoming else terms[0]`. This branch feeds the
  term-less redirect resolver.
- The requested/nearest term is returned in the **existing** `PublicCircleResponse.next_term`
  field. The field name does not change and no `terms` array is added.
- `get_group(db, group_id)` still runs first → unknown `group_id` → 404 (unchanged).
- The "no per-child field" invariant (`test_groups.py:226`) is preserved — the projection is
  untouched apart from the additive `organizer_slug`.

### 3.3 `organizer_slug` resolution (cross-bounded-context read)

New thin helper in `app/groups/service.py`:

```
async def resolve_organizer_slug(db, group_id) -> str | None:
    leadership = await get_current_leadership(db, group_id)
    if leadership is None:
        return None
    party_id = await _group_role_party_id(db, leadership.from_role_id)
    org = await organizations_service.get_own_organization(db, party_id)
    return org.slug if org is not None else None
```

- Chain: active `Leadership` → `GroupRole.party_id` → `organizations.service.get_own_organization(party_id)` → `Organization.slug`.
- Returns `None` when the circle has no active `Leadership` **or** the organizer owns no `Organization`.
- This is a **groups-service → organizations-service** read. It is consistent with how the
  codebase already crosses bounded contexts (plain function import / FK ids — e.g.
  `groups.service` already imports `circulation_service`). Keep it a single function import
  (`from app.organizations import service as organizations_service`); introduce **no** other
  coupling, no new shared model, no ORM relationship. No import cycle:
  `app.organizations.service` imports only `app.party` / `app.core`, never `app.groups`.
- Consumed by:
  - `get_public_circle_view` — sets `PublicCircleResponse.organizer_slug`.
  - the `get_group` router handler (`GET /api/groups/{group_id}`) — sets `GroupResponse.organizer_slug` after `model_validate`.
- **Not** wired into `list_groups` (would add a per-row lookup / N+1) — that endpoint returns
  `organizer_slug = None`. Documented as a deliberate scoping choice; the Panel fetches each
  circle individually via `getGroup`, which is the path that matters.

### 3.4 `list_needed_items` ordering

`app/groups/service.py:433` — add `.order_by(NeededItem.id)` to the `select`. Deterministic
public ordering (`standards/backend/queries.md` — explicit ordering, never rely on insertion
order).

### 3.5 Frontend data path

- `api/groups.ts` `getPublicCircle(groupId: number, termId?: number)` — appends `?term_id=${termId}` when `termId` is provided.
- `hooks/usePublicKragGrupy.ts` `usePublicKragGrupy(groupId: number, termId?: number)` — forwards `termId`; add `termId` to the `useCallback` deps so a term change refetches.
- `PublicCircleResponse` (TS) and `GroupResponse` (TS) each gain `organizer_slug: string | null`.

### 3.6 Route components

- **`KragGrupyPage`** (`src/frontend/src/pages/krag/KragGrupyPage.tsx:123`) — the
  `useLocation()` + `pathname.endsWith("/publiczny")` branch is removed. It now serves only the
  private authenticated `/krag/:groupId` route and returns `<PrivateKragGrupyView />` directly.
- **`PublicKragGrupyView`** (same file, `:494`) — `export` it; it is now mounted by the new
  per-term route element (directly, or via a one-line wrapper — implementation detail). Two
  behavioural edits only:
  - term id source is the `:termId` route param (via `usePublicKragGrupy(groupId, termId)` →
    backend puts the URL-named term in `circle.next_term`), not a client-computed selection.
    The `rsvped` mount effect and `RsvpDialog termId` already read `circle?.next_term?.id`, so
    they follow automatically.
  - `.kg-bring` heading #1 text `"Najbliższy termin"` → `"Termin"`.
  - error/empty state text `"Nie znaleziono grupy"` → `"Nie znaleziono"` (generic; a
    mismatched/deleted term produces the same 404 → same state, so the wording must not say
    "grupa"). Loading text `"Wczytywanie..."` unchanged.
- **NEW `PublicKragRedirectPage`** (`src/frontend/src/pages/krag/`, ~40 lines) — the term-less
  resolver. Pattern: `KragEntryPage.tsx` / `PublicOrganizationPage.tsx` (mount `useEffect` →
  async fetch → `navigate(target, { replace: true })`). Reuses the `.kg-stage` / `.kg-app` /
  `.kg-state` "Wczytywanie..." shell (same chrome as the destination page). Logic:
  1. `getPublicCircle(groupId)` with **no** `term_id`.
  2. `circle.next_term` present → `navigate(`/${organizationSlug}/grupa/${groupId}/term/${circle.next_term.id}`, { replace: true })` (echo the cosmetic slug straight from `useParams`).
  3. `circle.next_term` null (zero terms) → do **not** navigate; render `PublicKragGrupyView` in its `term === null` state (Mockup 3).
  4. fetch rejects (unknown `groupId` → 404) → render the `.kg-state` error frame with `"Nie znaleziono"`.
  5. `role="status"` / `aria-label="Wczytywanie"` on the loading frame (accessibility parity with `KragEntryPage`).

### 3.7 Link builders (5) + copy-link button

All five build `/${organizer_slug}/grupa/${groupId}/term/${termId}` **when `organizer_slug` is
non-null**. Row/tile/button markup is otherwise unchanged.

| # | Site | Non-null slug | Null slug |
|---|------|---------------|-----------|
| 1 | `PanelPage.tsx` ~780 — dashboard "Najbliższe terminy" tiles | slug URL from `group.organizer_slug` | `to={`/krag/${group.id}`}` (private authenticated view) |
| 2 | `PanelPage.tsx` ~1028 — organizer "Terminy" list rows | slug URL | `to={`/krag/${group.id}`}` |
| 3 | `PanelPage.tsx` ~1077 — guest "Spotkania" list rows | slug URL | `to={`/krag/${group.id}`}` |
| 4 | `FirstTermStepperOrganizer.tsx:53` — done-screen CTA | slug URL to the just-created term | `<Link to="/organization">` text `"Utwórz profil organizacji, aby udostępnić stronę"` |
| 5 | `FirstTermStepperGuest.tsx:82` — done-screen CTA | slug URL to the just-created term | `<Link to="/organization">` text `"Utwórz profil organizacji, aby udostępnić stronę"` |

- Sites 1–3: `group` in the `{ term, group, neededItems }` tuples is a `GroupResponse` (built by
  `getGroup(...)` in `PanelPage.load()`), so `group.organizer_slug` is in scope after the schema
  change. This per-circle slug is required (not the Panel's single `organizationSlug` state)
  because the guest "Spotkania" list shows circles led by **other** organizers.
- Sites 4–5: both steppers currently **discard** the `createTerm()` return. Capture it
  (`const created = await createTerm({...}); setCreatedTermId(created.id);`) to build the deep
  link. `createTerm` returns `TermResponse` (has `id`).
  - Organizer stepper has only `circleGroupId: number`. PanelPage passes a new
    `organizerSlug={organizationSlug}` prop (PanelPage already holds `organizationSlug` in
    state from `getMyOrganization()`); the organizer's own circles share their own slug.
  - Guest stepper already holds the created `circle` (`GroupResponse`) — use
    `circle?.organizer_slug` (a brand-new guest circle has no Organization → `null` → the
    `/organization` CTA, which is the intended outcome).

**Copy-link button** — organizer "Terminy" list only (`PanelPage.tsx`, the
`view === "spotkania" && isOrganizer` block, ~line 1023–1050):

- One button per row. Copies the **absolute** URL
  `${window.location.origin}/${group.organizer_slug}/grupa/${group.id}/term/${term.id}` via
  `navigator.clipboard.writeText(...)`, then `showToast("Skopiowano link")` (existing toast
  mechanism, `PanelPage.tsx:328`).
- `disabled` when `group.organizer_slug` is null, with the nudge text
  `"Utwórz profil organizacji, aby udostępnić link"` (title/aria — an organizer can create the
  profile at `/organization`).
- **Not** nested inside the row `<Link>` (nested interactive elements are invalid). Wrap each
  row in a container so the `<Link>` and the copy `<button>` are siblings; keep the existing
  row visual layout.
- Not added to the guest "Spotkania" list, the dashboard tiles, the public page, or the steppers.

### 3.8 Bad / mismatched term id

`term_id` that does not exist, or exists but `term.circle_group_id != groupId` → backend
`EntityNotFoundException("Term", term_id)` → 404 → `getPublicCircle` rejects → the per-term page
renders its existing `error || !circle` `.kg-state` frame with `"Nie znaleziono"`. **No
redirect, no `/login` bounce** (the request resolves to the PUBLIC matrix row, so
`client.request` never sees a 401).

---

## 4. API Contract — `GET /api/groups/public/{group_id}`

### Request

| Part | Value |
|------|-------|
| Method / path | `GET /api/groups/public/{group_id}` |
| Path param | `group_id`: integer, required |
| Query param | `term_id`: integer, optional |
| Auth | none — matched by the existing `^/api/groups/public/[^/]+$` PUBLIC matrix row (query string is not part of the path match) |

### Response `200` — `PublicCircleResponse`

```
{
  "id": 7,
  "name": "Nutki dla starszaków",
  "organizer_display_name": "Ania Kowalska" | null,
  "organizer_slug": "ania-kowalska" | null,          // NEW
  "next_term": {                                      // the URL-named term when term_id given,
    "id": 101,                                        //   else nearest (soonest upcoming, else
    "occurs_on": "2026-09-20",                        //   most recent past); null when the
    "description": "17:00 Park Sołacki" | null,       //   circle has zero terms
    "needed_items": [
      { "id": 501, "category": "INSTRUMENT", "description": "5 grzechotek" | null }
    ]                                                  // ordered by NeededItem.id (NEW)
  } | null,
  "guardians": [ { "display_name": "Marek Nowak" } ]  // for next_term; ordered by TermAttendance.created_at
}
```

- No field name contains `"child"` (invariant preserved — `test_groups.py:226`).

### Errors — legacy flat envelope `{ "status", "error", "message" }`

| Status | Condition |
|--------|-----------|
| `404` | `group_id` has no `Group` (`EntityNotFoundException("Group", group_id)`) |
| `404` | `term_id` given but no such `Term` (`EntityNotFoundException("Term", term_id)`) |
| `404` | `term_id` given, term exists, but `term.circle_group_id != group_id` (`EntityNotFoundException("Term", term_id)`) |
| `422` | `term_id` not integer-parseable (FastAPI query validation) — anonymous visitors never construct this; acceptable |

---

## 5. Schema / Type Changes

### Backend — `app/groups/schemas.py`

| Model | Change |
|-------|--------|
| `PublicCircleResponse` | add `organizer_slug: str \| None` (after `organizer_display_name`) |
| `GroupResponse` | add `organizer_slug: str \| None = None` (default `None`; populated only by the `get_group` handler via `service.resolve_organizer_slug`) |

`GroupResponse` keeps `model_config = ConfigDict(from_attributes=True)`; the `get_group` handler
sets `.organizer_slug` explicitly after `model_validate(group)` since it is not an ORM attribute.

### Frontend — `src/frontend/src/api/groups.ts`

| Type | Change |
|------|--------|
| `interface GroupResponse` | add `organizer_slug: string \| null` |
| `interface PublicCircleResponse` | add `organizer_slug: string \| null` |
| `getPublicCircle` | signature → `(groupId: number, termId?: number)`, appends `?term_id=` |

No change to `PublicTermResponse`, `PublicNeededItemResponse`, `PublicGuardianResponse`,
`CreateRsvpRequest`, `RsvpResponse`, `guestProfileIdKey`.

---

## 6. Routing Changes — `src/frontend/src/router.tsx`

| Action | Route |
|--------|-------|
| **Remove** | `{ path: "/krag/:groupId/publiczny", element: <KragGrupyPage /> }` (+ its explanatory comment block) |
| **Add** (before the `/:organizationSlug` catch-all) | `{ path: "/:organizationSlug/grupa/:groupId/term/:termId", element: <PublicKragGrupyView /> }` — unauthenticated, no `AuthGuard` |
| **Add** (before the `/:organizationSlug` catch-all) | `{ path: "/:organizationSlug/grupa/:groupId", element: <PublicKragRedirectPage /> }` — unauthenticated, no `AuthGuard` |
| **Keep unchanged** | `/krag/:groupId` (AuthGuard, `<KragGrupyPage />`), `/krag` (`KragEntryPage`), `/:organizationSlug` catch-all stays last |

Declare the 3-segment route before the 2-segment one for readability (route-ranking makes order
between them irrelevant, but not vs. the catch-all — keep both above line 119).

---

## 7. Component Inventory

### New

| Component | Path | Role |
|-----------|------|------|
| `PublicKragRedirectPage` | `src/frontend/src/pages/krag/PublicKragRedirectPage.tsx` | Term-less resolver: fetch circle → `<Navigate replace>` to nearest term, or render `PublicKragGrupyView` (`term===null`) on zero terms, or `.kg-state` `"Nie znaleziono"` on 404. Reuses `.kg-*` shell. |

### Modified

| Component / module | Path | Change |
|--------------------|------|--------|
| `KragGrupyPage` | `pages/krag/KragGrupyPage.tsx:123` | drop `useLocation`/`isPublic`; return `<PrivateKragGrupyView />` directly |
| `PublicKragGrupyView` | `pages/krag/KragGrupyPage.tsx:494` | `export`; read `:termId` param → `usePublicKragGrupy(groupId, termId)`; heading `"Najbliższy termin"`→`"Termin"`; error text `"Nie znaleziono grupy"`→`"Nie znaleziono"` |
| `usePublicKragGrupy` | `hooks/usePublicKragGrupy.ts` | optional `termId` param, forwarded + in `useCallback` deps |
| `getPublicCircle` | `api/groups.ts:141` | optional `termId` → `?term_id=` |
| `GroupResponse` / `PublicCircleResponse` (TS) | `api/groups.ts` | `organizer_slug: string \| null` |
| `router.tsx` | `router.tsx` | route changes per §6 |
| `PanelPage` (×3 link sites + copy-link button + stepper prop) | `pages/panel/PanelPage.tsx` ~780 / ~1028 / ~1077 / stepper mount ~1310 | slug URL w/ null-slug fallback to `/krag/:groupId`; new copy-link button on organizer "Terminy" rows; pass `organizerSlug={organizationSlug}` to `FirstTermStepperOrganizer` |
| `FirstTermStepperOrganizer` | `components/panel/FirstTermStepperOrganizer.tsx:36,53` | capture `createTerm()` return; new `organizerSlug` prop; CTA → slug URL or `/organization` |
| `FirstTermStepperGuest` | `components/panel/FirstTermStepperGuest.tsx:64,82` | capture `createTerm()` return; CTA → `circle?.organizer_slug` slug URL or `/organization` |
| `get_public_circle` (router) | `app/groups/router.py:74` | `term_id: int \| None = None` param; docstring |
| `get_public_circle_view` (service) | `app/groups/service.py:546` | optional `term_id` + ownership guard + `organizer_slug` |
| `get_group` (router) | `app/groups/router.py:114` | set `organizer_slug` via `service.resolve_organizer_slug` |
| `list_needed_items` (service) | `app/groups/service.py:433` | `.order_by(NeededItem.id)` |
| `PublicCircleResponse` / `GroupResponse` (Pydantic) | `app/groups/schemas.py` | `organizer_slug` |

### New (backend helper)

| Function | Path | Role |
|----------|------|------|
| `resolve_organizer_slug(db, group_id) -> str \| None` | `app/groups/service.py` | Leadership → party → `organizations_service.get_own_organization` → `.slug` |

### Reused unchanged (do NOT modify)

`RsvpDialog`, `AccountMergeForm`, `createRsvp`, `mergeAnonymousProfile`, `guestProfileIdKey`,
`service.create_rsvp`, `service.merge_anonymous_profile`, the `.kg-*` CSS block
(`KragGrupyPage.tsx:21–95`), `ModalSheet` / `Field`, `showToast`, the Panel term-tile visual
markup, `get_term`, `list_terms`, `list_attendances_for_term`, `get_current_leadership`,
`_group_role_party_id`, `get_own_organization`, the `AUTHORIZATION_MATRIX`, `RESERVED_SLUGS`.

---

## 8. Visual Design

Binding mockups: `analysis/design-context/ascii/ui-mockups.md`, inventory
`analysis/design-context/INDEX.md`. Mockups in `analysis/design-context/` are **binding
inputs** — the implementation-planner will attach `Visual References` (by the stable IDs below)
to the UI task groups.

| ID | Mockup | What it fixes | Fidelity |
|----|--------|---------------|----------|
| `screen:public-term` | Mockup 1 | Per-term page, populated: `.kg-head` (eyebrow "KRĄG", `<h1>` circle name, `Prowadzi:` organizer), organizer center avatar, `.kg-bring` #1 "Termin" (date + description), `.kg-bring` #2 "Potrzebne rzeczy", `.kg-card` "Zapisani opiekunowie", centered `.kg-btn-primary` "＋ Zapisz się na zajęcia" | layout pixel-faithful to today's `PublicKragGrupyView`; only the #1 heading string changes |
| `screen:public-term-post-rsvp` | Mockup 2 | Post-RSVP: `✓ Zapisano!` `.kg-card` `role="status"` replaces the CTA; needed-items gain "Zgłoś się" + inline `AccountMergeForm` | no code change — existing branch |
| `screen:public-term-no-terms` | Mockup 3 | Zero-term fallback: organizer center + "Organizator nie dodał jeszcze żadnych zajęć." + "Brak listy potrzebnych rzeczy na te zajęcia." + "Nikt jeszcze się nie zapisał." + no RSVP CTA | no code change — existing `term === null` branch |
| `screen:term-redirect-loading` | Mockup 4 | Term-less entry: brief "Wczytywanie..." in the `.kg-state` frame, then `<Navigate replace>`; zero terms → `screen:public-term-no-terms` in place | NEW resolver; chrome reused from existing loading state |
| `component:public-term-view` | Mockup 1 | MODIFIED `PublicKragGrupyView` — reads `:termId`, forwards to hook, heading rename | — |
| `component:public-term-redirect` | Mockup 4 | NEW `PublicKragRedirectPage` — `KragEntryPage` pattern | — |
| `component:panel-term-tile-links` | Mockup 5 | 3 PanelPage tiles — `to=` string only; markup unchanged | — |
| `component:stepper-done-links` | Mockup 5 | Both stepper done-screen CTAs — capture `createTerm()` return, deep-link | — |

**Superseded by `analysis/technical-clarifications.md` (the mockup file predates it — treat the
URL strings there as illustrative only, the layouts as binding):**

- Mockup 1/4/5 show a `/krag/:groupId/publiczny/:termId` "group-id form" and keep
  `/krag/:groupId/publiczny`. Those routes do **not** exist in this spec — `/krag/:groupId/publiczny`
  is **deleted** and there is no group-id public term route. The only public routes are the two
  slug routes (§3.1, §6).
- Mockup 4's redirect target "From `/krag/:groupId/publiczny` … → `/krag/:groupId/publiczny/:termId`"
  does not apply; the only term-less redirect is `/:organizationSlug/grupa/:groupId` →
  `/:organizationSlug/grupa/:groupId/term/:termId`.
- Mockup 5 shows all 5 link builders using the group-id form with no null-slug branch; the
  binding behaviour is the slug URL + null-slug fallback table in §3.7.
- The copy-link button (locked decision 10) is not in the mockups — it is a plain `.kg`-outside
  Tailwind button on the organizer "Terminy" rows, matching the surrounding Panel button styling.

**Standards**: the public page stays on hand-written `.kg-*` CSS, never Tailwind
(`standards/frontend/css.md` — consistent methodology; reusing `PublicKragGrupyView` enforces
this). The redirect frame reuses `.kg-stage`/`.kg-app`/`.kg-state` so the flash matches the
destination chrome. Panel tiles/buttons stay Tailwind, matching their surroundings
(`components.md` — encapsulation, single responsibility). Accessibility: keep `role="status"` on
the post-RSVP card and add `role="status"` / `aria-label="Wczytywanie"` on the resolver's
loading frame (`standards/frontend/accessibility.md`).

---

## 9. Reusability Analysis

### Existing code to leverage

| Need | Reuse | Location |
|------|-------|----------|
| Unauthenticated endpoint template (no `Depends`, matrix-row citation in docstring) | `get_public_organization` | `app/organizations/router.py:30` |
| Term/group ownership guard | `create_rsvp`'s `if term.circle_group_id != group_id: raise EntityNotFoundException("Term", term_id)` — copy verbatim | `app/groups/service.py:620–622` |
| Nearest-term selection (term-less branch) | existing `get_public_circle_view` body, lines 563–567 — keep as the `term_id is None` path | `app/groups/service.py:563` |
| Slug resolution | `get_current_leadership` + `_group_role_party_id` + `organizations.service.get_own_organization(party_id)` | `app/groups/service.py:245,190`; `app/organizations/service.py:71` |
| Per-term data loaders (already take `term_id`) | `list_needed_items`, `list_attendances_for_term` (N+1-safe batched `IN` profile query) | `app/groups/service.py:433,533` |
| Resolve-then-redirect page | `KragEntryPage` (spinner + `useEffect` fetch + `navigate(replace)`), `PublicOrganizationPage` (unauthenticated `useParams` page) | `pages/krag/KragEntryPage.tsx`, `pages/PublicOrganizationPage.tsx` |
| Loading / error / redirect chrome | `.kg-stage` / `.kg-app` / `.kg-state` + `<style>{CSS}</style>` | `KragGrupyPage.tsx:21–95, 540–560` |
| Public page 3 states (populated / post-RSVP / no-terms) | `PublicKragGrupyView` — all three already implemented, guarded on `term` | `KragGrupyPage.tsx:494–695` |
| RSVP end to end (dialog, API, localStorage key, service) | `RsvpDialog`, `createRsvp`, `guestProfileIdKey`, `service.create_rsvp` — already term-scoped | unchanged |
| Toast feedback for copy-link | `showToast` | `PanelPage.tsx:328` |
| Per-circle `GroupResponse` fetch (link builders) | `getGroup` already called per circle in `PanelPage.load()` (lines ~383/391) | `api/groups.ts:55` |
| Own-org slug for the organizer stepper | `PanelPage`'s existing `organizationSlug` state (`getMyOrganization()`) — pass as prop | `PanelPage.tsx:242,374` |
| Frontend test scaffolding | `PublicKragGrupyPage.test.tsx` (`MemoryRouter` + `vi.mock("../api/groups")` partial), `PanelPage.test.tsx` | `src/frontend/src/test/` |
| Backend test scaffolding | `test_groups.py` / `test_rsvp.py` helpers `_register_organizer`, `_auth_headers`, `_create_circle_with_term`; `conftest.py` TestContainers + savepoint rollback | `src/backend/tests/` |

### New components required (with justification)

| New | Why existing code can't be reused |
|-----|----------------------------------|
| `PublicKragRedirectPage` | No term-less→term resolver exists for the public view. `KragEntryPage` redirects to an **authenticated** route from the caller's own memberships; this one must fetch a **public** circle by id and canonicalize to a per-term URL, with a distinct zero-term branch (render in place, not redirect). Different data source, different target, different empty behaviour — a thin new component following the same pattern is the minimal fit. |
| `resolve_organizer_slug` service helper | The Leadership→party→Organization→slug chain is not assembled anywhere today (`PublicCircleResponse` / `GroupResponse` expose neither org id nor slug). Two call sites (`get_public_circle_view`, `get_group`) need it → one small shared helper rather than duplicated inline chains. |
| `term_id` query param on `get_public_circle` | The only per-term public read today is the server-picked nearest term; `/api/terms/{id}` requires `ReadPrincipal` and would 401-redirect an anonymous visitor. Generalizing the existing public endpoint (vs. a new one) is what keeps the auth matrix untouched. |
| copy-link button | No share/copy affordance exists on the "Terminy" list. Small inline button reusing `showToast` + `navigator.clipboard`; no abstraction. |

No new abstraction layers, factories, or speculative parameters (`standards/global/minimal-implementation.md`). `organizer_slug` is populated only where a caller consumes it.

---

## 10. Functional Requirements

Refined from `analysis/requirements.md` FR-1..FR-10 against the locked decisions.

- **FR-1** — `GET /:organizationSlug/grupa/:groupId/term/:termId` renders `PublicKragGrupyView` for exactly that term: circle name + organizer, that term's date/description, that term's needed items (ordered by id), that term's RSVP'd guardians, and the "＋ Zapisz się na zajęcia" CTA (populated state) or the post-RSVP confirmation. `:organizationSlug` is not validated.
- **FR-2** — `GET /:organizationSlug/grupa/:groupId` resolves the nearest term (soonest upcoming, else most recent past) and `<Navigate replace>`s to the FR-1 URL, echoing the same `:organizationSlug`. When the circle has zero terms, it renders the "no terms yet" public page in place (no redirect). Unknown `groupId` → `.kg-state` "Nie znaleziono".
- **FR-3** — `GET /api/groups/public/{group_id}?term_id={id}` returns that term in `next_term`; the term's needed items and guardians are that term's. Omitting `term_id` keeps the current nearest-term behaviour byte-for-byte. `term_id` missing, or belonging to a different circle → `404`.
- **FR-4** — `PublicCircleResponse` and `GroupResponse` (Pydantic + TS) carry `organizer_slug: string | null`, resolved via active Leadership → organizer party → owned Organization slug; `null` when there is no active Leadership or the organizer owns no Organization. `GET /api/groups/public/{id}` always populates it; `GET /api/groups/{id}` populates it; `GET /api/groups` (list) returns `null`.
- **FR-5** — the `/krag/:groupId/publiczny` route is deleted; `KragGrupyPage` serves only the authenticated `/krag/:groupId` and renders `PrivateKragGrupyView` with no route-sniffing.
- **FR-6** — the 3 PanelPage term-list links and both first-term-stepper done-screen CTAs point at `/:organizationSlug/grupa/:groupId/term/:termId` built from `organizer_slug` when non-null; when null, PanelPage tiles link to the private `/krag/:groupId` view and stepper CTAs link to `/organization` with the text "Utwórz profil organizacji, aby udostępnić stronę". Both steppers capture the `createTerm()` return to obtain the new term id.
- **FR-7** — each row of the organizer "Terminy" list (`view === "spotkania" && isOrganizer`) has a copy-link button that writes `${origin}/${organizer_slug}/grupa/${groupId}/term/${termId}` to the clipboard and shows `showToast("Skopiowano link")`; it is disabled with the nudge "Utwórz profil organizacji, aby udostępnić link" when `organizer_slug` is null. It appears nowhere else.
- **FR-8** — `list_needed_items` returns items ordered by `NeededItem.id`.
- **FR-9** — RSVP, account-merge and localStorage keying (`guest_profile_id:<groupId>:<termId>`) are unchanged and still work on the per-term page; the confirmation state survives reload and does not leak across circles/terms.
- **FR-10** — bad-term-id, unknown-group and zero-term states render clear Polish messages ("Nie znaleziono", "Organizator nie dodał jeszcze żadnych zajęć.") with no crash, no console error, and no `/login` redirect.

---

## 11. Non-Functional / Standards Compliance

| Standard | Application |
|----------|-------------|
| `standards/backend/security.md` | No new `AUTHORIZATION_MATRIX` row, no new `Depends`, no route-order change — query-param shape keeps the existing PUBLIC row valid. Ownership rule the matrix can't express (`term.circle_group_id == group_id`) lives in `service.py`. Endpoint docstring cites the matrix row. |
| `standards/backend/api.md` | Query param for filtering (`?term_id=`), not a deeper path nest. Path stays at 3 levels (`/api/groups/public/{id}`). Proper status codes (`200` / `404`). |
| `standards/backend/queries.md` | `list_needed_items` gets explicit `ORDER BY id`. No new N+1: `resolve_organizer_slug` is one bounded lookup per single-circle request and is deliberately **not** called in `list_groups`. `list_attendances_for_term`'s batched `IN` profile query is reused unchanged. |
| `standards/backend/models.md` | No model changes; cross-BC reference stays a plain function call + FK-id chain (no new relationship, no shared model). |
| `standards/global/error-handling.md` / `validation.md` | Typed `EntityNotFoundException` → centralized handler → legacy flat 401/403/404 envelope. Fail-fast: `get_term` + ownership guard before any per-term work. Specific messages ("Nie znaleziono terminu"). |
| `standards/global/minimal-implementation.md` | One new frontend component, one new service helper, one new query param, one new button. No speculative `terms[]`, no term-switcher scaffolding, no `organizer_slug` population where unconsumed. Old `/publiczny` route + `isPublic` sniff deleted, not left dead. |
| `standards/frontend/css.md` | Public page + resolver stay on `.kg-*`; Panel controls stay Tailwind. |
| `standards/frontend/components.md` | `PublicKragRedirectPage` single-responsibility (resolve + redirect); `PublicKragGrupyView` stays the one view for all 3 states. |
| `standards/frontend/accessibility.md` | `role="status"` + `aria-label` on the loading frame; post-RSVP `role="status"` kept; copy-link button has an accessible name and a `title`/`aria` nudge when disabled. |
| `standards/frontend/responsive.md` | No new breakpoints; `.kg-app` phone-frame media query untouched. |
| `standards/testing/backend-testing.md` | Integration-first, real PostgreSQL via TestContainers, 2–8 tests for the feature, `action_condition_expectedResult` naming, savepoint-rollback isolation, existing `_register_organizer`/`_auth_headers` helpers. |
| `standards/testing/frontend-testing.md` | Vitest + jsdom, `@testing-library/react`, per-file `MemoryRouter` + `vi.mock("../api/groups")` factory, `vi.resetAllMocks()` in `beforeEach`, `describe` named after the page/feature, tests in `src/frontend/src/test/`. |

---

## 12. Test Plan

Target 2–8 focused tests per group; verification runs only the new/changed tests.

### 12.1 Backend — `src/backend/tests/test_public_term.py` (new file) — 6 tests

Helpers: reuse `_register_organizer` / `_auth_headers` (copy the small `_create_circle_with_term`
pattern from `test_rsvp.py` / `test_groups.py`). Create circles/terms via the real authenticated
endpoints; assert via the public GET.

1. `test_getPublicCircle_withTermIdParam_returnsThatTermsItemsAndGuardians` — circle with 2 terms; needed-items + an anonymous RSVP on the **non-nearest** term; `GET /api/groups/public/{gid}?term_id={nonNearest}` → `200`, `next_term.id == nonNearest`, its `needed_items` / `guardians` reflect that term (not the nearest).
2. `test_getPublicCircle_termIdFromAnotherGroup_returns404` — term created under circle B; `GET /api/groups/public/{A}?term_id={termOfB}` → `404`.
3. `test_getPublicCircle_nonexistentTermId_returns404` — `GET /api/groups/public/{gid}?term_id=999999999` → `404`.
4. `test_getPublicCircle_noTermIdParam_returnsNearestTermUnchanged` — regression: two terms, no `term_id` → `next_term` is the nearest per the existing rule; shape identical to the pre-change response.
5. `test_getPublicCircle_neededItems_orderedById` — create needed items whose insertion order ≠ id order (or just assert ascending ids); response `needed_items` ids are ascending.
6. `test_getPublicCircle_organizerSlug_presentWhenOrganizationExists_nullOtherwise` — organizer who has created an Organization → `organizer_slug == <that slug>`; a circle whose organizer owns no Organization → `organizer_slug is None`. (Optionally split into two tests if clearer.)

Keep the existing `test_groups.py::test_getPublicCircle_responseSchema_hasNoChildIdentifyingField`
green (extend its field-name set is not required — `organizer_slug` contains no "child").
`test_rsvp.py` and `test_account_merge.py` must remain green **unchanged**.

### 12.2 Frontend — `src/frontend/src/test/PublicKragGrupyPage.test.tsx` (rework) — ~7 tests

Rework `renderAt` to mount the real routes:
```
<MemoryRouter initialEntries={[path]}>
  <Routes>
    <Route path="/:organizationSlug/grupa/:groupId/term/:termId" element={<PublicKragGrupyView />} />
    <Route path="/:organizationSlug/grupa/:groupId" element={<PublicKragRedirectPage />} />
  </Routes>
</MemoryRouter>
```
Fixtures: `circleWithTerm` gains `organizer_slug: "ania-kowalska"`; `next_term.id` stays `101`;
`GUEST_KEY = guestProfileIdKey(7, 101)`; canonical path `"/ania-kowalska/grupa/7/term/101"`.

1. renders the URL-named term (mock `getPublicCircle` resolving `circleWithTerm`; assert `getPublicCircle` called with `(7, 101)`; circle name, "Termin" heading, term date, needed item, guardian all shown).
2. loads with **no** auth token (no `/login` redirect; `mockNavigate` not called).
3. RSVP flow → "✓ Zapisano!" and `localStorage["guest_profile_id:7:101"] === "<profileId>"`.
4. reload with the stored key present → confirmation state, no CTA.
5. **regression (keep)** — stored key for a different circle/term (`guestProfileIdKey(99, 999)`) does **not** show confirmation on `/…/grupa/7/term/101`.
6. mismatched / nonexistent term → `getPublicCircle` rejects with `new ApiError(404, …)` → page shows "Nie znaleziono"; `mockNavigate` not called.
7. term-less redirect — mount `PublicKragRedirectPage` at `/ania-kowalska/grupa/7`; `getPublicCircle` (called with `(7)`, no term) resolves `next_term.id: 101` → assert `mockNavigate` called with `"/ania-kowalska/grupa/7/term/101", { replace: true }`. Second case: `next_term: null` → no navigate, "Organizator nie dodał jeszcze żadnych zajęć." rendered.
8. never renders child-identifying text (keep existing assertion) — optional if already covered.

### 12.3 Frontend — `src/frontend/src/test/PanelPage.test.tsx` (update) — existing + ~3 new

- Update the mocked `GroupResponse` fixture(s) to include `organizer_slug` (both a non-null and a null variant).
- **Update** line ~314 — guest stepper done-screen CTA `href` → `/${slug}/grupa/${mockGroup.id}/term/${createdTermId}` when the created circle has a slug; `/organization` when null. (Guest circle fixture: `organizer_slug: null` → assert `/organization` + text "Utwórz profil organizacji…".)
- **Update** line ~655 — "Spotkania"/"Terminy" tile `href` → `/${group.organizer_slug}/grupa/${group.id}/term/${term.id}` (non-null slug fixture).
- **New** — null-slug dashboard/"Spotkania" tile → `href === /krag/${group.id}` (private view fallback).
- **New** — copy-link button on an organizer "Terminy" row: present; click calls `navigator.clipboard.writeText` with `${window.location.origin}/${slug}/grupa/${groupId}/term/${termId}` and shows toast "Skopiowano link". Stub `navigator.clipboard` (`vi.stubGlobal`/`Object.assign(navigator, { clipboard: { writeText: vi.fn() } })`).
- **New** — copy-link button disabled with the nudge title when `organizer_slug` is null; `writeText` not called on click.

### 12.4 Not changed

`AccountMergeAuthHandoff.test.tsx`, `PublicOrganizationPage.test.tsx`, `RsvpDialog` (no test
file), backend `test_rsvp.py` / `test_account_merge.py` — must stay green with no edits.

---

## 13. Assumptions

1. `createTerm` (`api/terms.ts`) returns a `TermResponse` object with a numeric `id` (confirmed — `TermResponse` in `schemas.py`).
2. `PanelPage.load()` builds the `{ term, group, neededItems }` tuples with `group` being a full `GroupResponse` from `getGroup(...)` (confirmed — `PanelPage.tsx:383/391`), so `group.organizer_slug` is available at all three link sites after the schema change.
3. `PanelPage` already holds the current user's own org slug in `organizationSlug` state via `getMyOrganization()` (confirmed — `PanelPage.tsx:242,374`); passing it to `FirstTermStepperOrganizer` is acceptable and needs no new fetch.
4. `app.organizations.service` never imports `app.groups` (confirmed — imports only `app.party` / `app.core`), so `groups.service` importing `organizations.service` introduces no cycle.
5. React Router v6 route-ranking places `/:organizationSlug/grupa/:groupId/term/:termId` and `/:organizationSlug/grupa/:groupId` ahead of the single-segment `/:organizationSlug` catch-all regardless of declaration order, as long as all three are in the same route array (consistent with the existing `/krag/...` vs catch-all comment in `router.tsx:112–118`).
6. `navigator.clipboard.writeText` is available in the target browsers (HTTPS / localhost); no fallback prompt is required (not requested).
7. The `.kg-*` CSS `<style>` block and the Fraunces/Karla webfont `<link>` effect are reachable from wherever `PublicKragGrupyView` is mounted (they live in the same module and run on mount) — so `PublicKragRedirectPage` importing `PublicKragGrupyView` for the zero-term branch gets them for free.

---

## 14. Open Questions

None blocking. All URL, endpoint, schema, fallback, and scope decisions are locked in
`analysis/technical-clarifications.md`. Two minor implementation-choice notes for the planner
(either resolution is acceptable, no user input needed):

1. Whether `PublicKragGrupyView` reads `:termId` from `useParams` directly, or a one-line
   `PublicKragTermPage` wrapper reads params and passes props. Recommendation: read `useParams`
   directly (fewer files, matches how the component already reads `:groupId`).
2. Whether `PublicKragRedirectPage`'s zero-term branch renders `<PublicKragGrupyView />` (which
   will itself call `getPublicCircle(groupId)` again without `term_id`) or shares the already
   fetched circle. Recommendation: just render `<PublicKragGrupyView />` — one extra cached-ish
   GET on a rare path is not worth threading state; keeps the zero-term rendering in exactly one
   place.

---

## 15. Success Criteria

- Opening `/<anything>/grupa/<gid>/term/<tid>` with no account shows that exact term's date, description, needed items (id-ordered), guardians, and a working RSVP; a wrong `<anything>` slug still works.
- Opening `/<slug>/grupa/<gid>` redirects (URL replaced, no back-button trap) to the nearest term, or shows "Organizator nie dodał jeszcze żadnych zajęć." when the circle has no terms.
- A deleted or foreign `term_id` shows "Nie znaleziono" with no crash and no `/login` bounce.
- `GET /api/groups/public/{id}` with no `term_id` returns a response byte-for-byte equivalent to today's plus the additive `organizer_slug`.
- An organizer with an Organization can copy a per-term link from the "Terminy" list and gets a "Skopiowano link" toast; without an Organization the button is disabled with the nudge and the stepper CTA points at `/organization`.
- `/krag/:groupId/publiczny` no longer resolves; `/krag/:groupId` (private) is unchanged.
- All new backend tests pass against real PostgreSQL; reworked frontend tests pass; `test_rsvp.py`, `test_account_merge.py`, `AccountMergeAuthHandoff.test.tsx` unchanged and green.
- No new `AUTHORIZATION_MATRIX` row, no new `Depends`, no migration.

---

## 16. Self-Verification

| Check | Result |
|-------|--------|
| Requirements accuracy vs `requirements.md` / `technical-clarifications.md` | PASS — all 12 locked decisions reproduced (URL scheme, delete `/publiczny`, query-param endpoint, ownership guard, `organizer_slug` on both schemas, `next_term` field reuse, `list_needed_items` ordering, hook/API threading, `isPublic` removal, 5 link builders + fallbacks, copy-link button scope, 404 wording, out-of-scope list). Q&A 1–13 mapped to FR-1..FR-10 + §3. |
| Visual assets coverage | PASS — every ID in `design-context/INDEX.md` (`screen:*`, `component:*`) referenced in §8 with fidelity notes and binding-input language; stale mockup URL strings explicitly flagged as superseded by `technical-clarifications.md` so the planner isn't misled. |
| Spec quality | PASS — goal ties to the reported problem (non-nearest term unshareable); API contract has request/response/errors; schema, routing, component inventory (new/modified/unchanged) with file paths; FRs measurable; test plan names files and cases; 2–8 tests/group stated; approach consistent with gap-analysis integration points. |
| Over-engineering check | PASS — no `terms[]` projection, no term switcher, no new endpoint, no new auth-matrix row, no new abstraction. One new component, one small service helper (2 real call sites), one query param, one button. `organizer_slug` deliberately not populated in `list_groups` to avoid N+1. Deleted code (old route + `isPublic`) removed, not stubbed. Reuse table cites concrete file:line for every leveraged element; each "new" item carries an explicit why-not-reuse. |
| Standards compliance | PASS — §11 maps 13 standards docs to concrete choices; INDEX.md standards for security / api / queries / models / error-handling / validation / minimal-implementation / css / components / accessibility / responsive / backend-testing / frontend-testing all addressed. |

Minor issues found during verification: none requiring a spec change. The mockup file's
pre-`technical-clarifications` URL strings were the only inconsistency — resolved by an explicit
"superseded" callout in §8 rather than by editing the binding decision.
