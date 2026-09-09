# Phase 5 Technical & Architecture Clarifications

Date: 2026-09-08. These SUPERSEDE any conflicting note in `scope-clarifications.md` (Phase 2).

## URL scheme (final)
- **Only public routes** (both new):
  - `/:organizationSlug/grupa/:groupId/term/:termId` — the per-term public page.
  - `/:organizationSlug/grupa/:groupId` — term-less; redirects to the nearest term's per-term URL; renders the "no terms yet" page when the circle has zero terms.
- Segment words: `grupa` and `term` (English `term`, exactly as the organizer wrote it — NOT `termin`).
- `:organizationSlug` is **cosmetic** — not validated against the circle's organizer. `:groupId` and `:termId` are numeric.
- Both routes registered **before** the last-declared `/:organizationSlug` single-segment catch-all in `router.tsx`. Multi-segment, so no `RESERVED_SLUGS` change.
- **`/krag/:groupId/publiczny` is DELETED** (route + any `/krag/:groupId/publiczny/:termId`). The app is not in production; already-shared links are not a concern. The authenticated `/krag/:groupId` (private) route stays.

## Backend endpoint (final)
- `GET /api/groups/public/{group_id}?term_id={term_id}` — query param, so the existing
  `^/api/groups/public/[^/]+$` PUBLIC matrix row still matches. **No new auth-matrix row, no route-order change.**
- Generalize `get_public_circle_view(db, group_id, term_id: int | None = None)`:
  - `term_id` present → `term = await get_term(db, term_id)` (raises `EntityNotFoundException("Term", term_id)` / 404 if missing); then guard `if term.circle_group_id != group_id: raise EntityNotFoundException("Term", term_id)` (copied from `create_rsvp` `service.py:620-622`). Use that term for needed-items + attendances.
  - `term_id` absent → current `next_term` selection (soonest upcoming, else most recent past). This branch feeds the term-less redirect resolver.
- The requested/nearest term is returned in the existing `PublicCircleResponse.next_term` field (name unchanged; no `terms` array added).
- Add `organizer_slug: str | None` to `PublicCircleResponse` — resolved via `get_current_leadership(group) → GroupRole.party_id → get_own_organization(party_id)?.slug`. `None` when the organizer has no Organization or the circle has no active Leadership.
- `list_needed_items` gains `ORDER BY id`.
- Preserve the no-`child`-identifying-field invariant (`test_groups.py:226`).

## Slug availability for in-app link builders (final)
- Add `organizer_slug: str | None` to **`GroupResponse`** (the shape the Panel already fetches via `getGroup`), resolved the same way as above.
- Link builders (`PanelPage` ×3, both first-term steppers) build `/{organizer_slug}/grupa/{groupId}/term/{termId}` **when `organizer_slug` is non-null**.
- When `organizer_slug` is null:
  - Panel term tiles → navigate to the private authenticated view `/krag/:groupId` instead of a public deep link.
  - Copy-link button → disabled, with the nudge text "Utwórz profil organizacji, aby udostępnić link" (organizer can create the org profile at `/organization`).
  - First-term stepper "done" screen → the "Przejdź do publicznej strony →" CTA is replaced by a link to `/organization` ("Utwórz profil organizacji, aby udostępnić stronę"); when the slug IS present, it deep-links to the just-created term.

## Copy-link button (final)
- Lives on **each row of the organizer "Terminy" list** in `PanelPage.tsx` (the `view === "spotkania" && isOrganizer` list, ~line 1028). Not on the guest list, not on the public page, not on the steppers.
- Copies the absolute URL `${window.location.origin}/${organizer_slug}/grupa/${groupId}/term/${termId}` to the clipboard (`navigator.clipboard.writeText`), shows the existing `showToast("Skopiowano link")` feedback.
- Disabled (with the nudge above) when the circle's `organizer_slug` is null.

## Bad / mismatched term id (final)
- Term id doesn't exist, or exists but `term.circle_group_id != groupId` → backend 404 → the public page renders its existing error state ("Nie znaleziono grupy" → reword to a generic "Nie znaleziono" / "Nie znaleziono terminu"). No redirect.

## `isPublic` route detection (final)
- The current `location.pathname.endsWith("/publiczny")` sniff in `KragGrupyPage` (`:125`) is removed. With the public `/krag/...` route gone, `KragGrupyPage` serves only the private `/krag/:groupId` route → it renders `PrivateKragGrupyView` directly.
- `PublicKragGrupyView` is mounted by a **new dedicated public page component** (route element for `/:organizationSlug/grupa/:groupId/term/:termId`) that reads `groupId` + `termId` from `useParams` and passes them to `usePublicKragGrupy`.
- The term-less redirect (`/:organizationSlug/grupa/:groupId`) is a **new thin resolver component** (pattern: `KragEntryPage` / `PublicOrganizationPage`): fetch `getPublicCircle(groupId)` (no term_id) → `<Navigate replace>` to `/{slug}/grupa/{groupId}/term/{next_term.id}`; zero terms → render the public view in its `term === null` state.
- Keep the shared `.kg-*` CSS block reachable by both `PrivateKragGrupyView` and `PublicKragGrupyView` (both currently live in `KragGrupyPage.tsx` — may stay in one module or be split; implementation detail).

## Frontend data hook / API (final)
- `usePublicKragGrupy(groupId, termId?)` — forwards `termId` to `getPublicCircle`; include in `useCallback` deps.
- `getPublicCircle(groupId, termId?)` in `api/groups.ts` — appends `?term_id=` when `termId` is given.
- `PublicCircleResponse` TS type gains `organizer_slug: string | null`.
- `GroupResponse` TS type (`api/groups.ts`) gains `organizer_slug: string | null`.
- `guestProfileIdKey(groupId, termId)` — unchanged (already term-scoped). `RsvpDialog`, `createRsvp`, `AccountMergeForm`, `service.create_rsvp` — unchanged.

## Out of scope (confirmed)
- Term switcher / any public list of a circle's terms / `GET /api/groups/public/{id}/terms`.
- The authenticated private `/krag/:groupId` view's term selection (`currentTerm = terms[0]`) — left as-is.
- Auto-creating Organizations; requiring an Organization to create a circle.
