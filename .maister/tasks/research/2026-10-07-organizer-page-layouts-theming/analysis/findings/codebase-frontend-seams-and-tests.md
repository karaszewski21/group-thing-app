# Frontend: natural seams for a layout registry + organizer theme provider, and affected tests

Paths relative to `src/frontend/src/`. These are observations of where code can be cut, not final recommendations.

## Seam 1 — Theme application point: a scoped CSS-variable wrapper (Confidence: High)

- Precedent already exists: `PublicOrganizationPage.tsx:68-73` sets `--color-mint`/`--color-lime` inline on the page root. Extend to an `OrganizerThemeScope` component that sets the full derived token set (`--color-mint`, `--color-mint-soft`, `--color-mint-bright`, `--color-lime`, `--color-lime-soft`, optionally `--color-cream`, `--color-paper`, `--color-ink`, `--color-line`) on a wrapper `div`.
- Because there is no Chakra on these pages (see `codebase-frontend-color-application.md`), no nested `ChakraProvider` is needed; Tailwind v4 utilities resolve via `var(--color-*)`.
- KragStage must be aligned: either alias its vars to the Tailwind ones (`--mint: var(--color-mint)` etc.) and move its selector from `:root` (`KragStage.tsx:7`) to the wrapper, or rename `.kg-*` rules to use `--color-*` directly. Otherwise the term page ignores the scope.
- Hard-coded hexes listed in the color-application file (TermFooter CTA, circle spokes, toast, account card, ItemTimeline pill) need converting to tokens.
- Placement options:
  - Organizer page: inside `PublicOrganizationPage` (has org data).
  - Term page: inside `TermPage`/`PublicTermView` once group data (with `organizer_slug`) is loaded, or around `KragStage`. `PrivateGroupGate` also uses `KragStage` (`PrivateGroupGate.tsx:203`), so wrapping at `TermPage` level themes both.
  - Product page: inside `ItemDetailPage` around `PhoneFrame`, given an org context source (see data-flow file §4).
  - `PublicLayout` is shared with panel/product-edit, so it is not a good global place unless it reads an org context from the matched route (could use `useMatches()`/route `handle`) — Medium confidence alternative.

## Seam 2 — Where theme data comes from (Confidence: High for facts, Medium for options)

- Organizer page: `getPublicOrganization(slug)` already returns colors (`api/organizations.ts:14-19, 48-50`) → add page layout key + palette there.
- Term page: `PublicCircleResponse` has `organizer_slug` but no theme (`api/groups.ts:197-206`). Options: (a) embed a small `organization_theme` object in the public circle / group-access payload (no extra request, no flash of default colors), or (b) second query `usePublicOrganization(group.organizer_slug)` (extra roundtrip, FOUC, 404 for `k-<hash>` slugs → default palette). The `:organizationSlug` URL param is available but documented as cosmetic/unvalidated (`router.tsx:127-129`), so trusting it for branding would let any URL show any org's colors on any group — prefer the server-resolved value.
- Product page: no org info in `ItemDetailsResponse` (`api/items.ts:26-39`); link from term page is `/product/${listing.item_id}` (`PublicTermView.tsx:67-68`).
- Query-key conventions to follow (`standards/frontend/data-fetching.md`): new hooks in `src/hooks/`, prefix constants, e.g. `["publicOrganization", slug]`, `["myOrganization", token]` (existing, `useMyOrganizationSlug.ts:10-12`). Mutation must `await invalidateQueries` on both prefixes.

## Seam 3 — Layout registry for the organizer page (Confidence: High that a seam exists; design is open)

- Existing in-codebase precedent: `GroupVisualization.tsx:280-323` — a closed union `GroupLayoutMode = "CIRCLE" | "PITCH" | "TABLE"` (`:12`) with one shared prop contract (`LayoutProps`, `:66-72`) and conditional rendering per mode. It works for 3 fixed variants but is a `switch`, not a registry; adding paid/custom layouts would require a `Record<LayoutKey, {component, label, tier, preview}>` map instead, plus a fallback for unknown keys (server may send a key the client doesn't know, or an entitlement-lapsed key).
- Panel picker precedent: `PanelModals.tsx:50-54` `LAYOUT_OPTIONS` array + `<select>` (`:232-249`). A registry could feed both the public renderer and the editor's picker (labels, thumbnails, tier badge).
- `PublicOrganizationPage` today is a single card (`:67-85`); refactor into: data hook → theme scope → `registry[layoutKey ?? DEFAULT].Component` with a common `OrganizerPageData` prop shape. The same component can render inside the editor for live preview with draft `{layout, palette}` (no API call), which only works if layouts are pure-props components (no internal fetching).

## Seam 4 — Editor placement (Confidence: Medium)

- Candidates: `/organization` (`OrganizationPage.tsx`, standalone, currently name-only, deliberate color removal documented `:23-28`), a new panel view (`/panel/:view` supports new sections via `PanelDataContext` `view` param — `router.tsx:89-101` comment), or an "edit mode" on the public page for the owner.
- Gaps to close regardless: "Moja organizacja" menu (`AccountMenu.tsx:65`) and HomeView hint (`HomeView.tsx:77-86`, copy promises "opis, kolory i logo") both go to the read-only public page once an org exists, so there is no route to edit after creation.
- `UstawieniaView` settings are local-only (`PanelDataContext.tsx:436`), so it has no persistence pattern to reuse; it's suitable only for an entry link.
- Phone-frame layout (max ~430px, `KragStage.tsx:16`, `PhoneFrame.tsx`) means a side-by-side editor+preview won't fit inside the panel shell; a full-width page or a bottom-sheet editor over the live page is more realistic.

## Affected tests

| Test | Relevance |
|---|---|
| `test/PublicOrganizationPage.test.tsx:25-46` | only name + not-found; mocks `getPublicOrganization` returning colors. Will need layout-variant and theme-var assertions; should move to the TanStack wrapper (`createQueryWrapper`) when the page gets a hook. |
| `test/OrganizationPage.test.tsx:78-98` | asserts updates send **only the name** and **no color-picker fields** render — directly contradicts a reintroduced editor on this page; must be rewritten. |
| `test/TermPage.test.tsx` (134-645) | ~35 behavioral tests, none on colors; theme wrapper must not break region/role queries. Fixtures will need any new theme field on `PublicCircleResponse`/access payload. |
| `test/GroupVisualization.test.tsx:21-160` | layout_mode rendering; unaffected unless spoke colors are tokenized (no color assertions found). |
| `test/ItemDetailPage.test.tsx:121-557` | no color assertions; affected if route/query param for org context is added. |
| `test/PublicLayout.test.tsx:47-90` | asserts "Moja organizacja" link target (org public page vs `/organization`) — affected if menu target changes to the editor. |
| `test/PanelPage.test.tsx:492,647,738`, `OnboardingHandoff.test.tsx:40` | fixtures with `primary_color/accent_color: null` — need new fields if `OrganizationResponse` grows. |
| `test/Avatar.test.tsx` | Avatar palette; affected only if avatar colors become theme-derived. |

## Tooling notes
- `package.json`: no color library (no culori/chroma-js/colord); palette derivation would add a dependency or hand-roll HSL/OKLCH math (`standards/global/conventions.md` "minimal dependencies").
- Tailwind v4 via `@tailwindcss/vite` (`vite.config.ts`), tokens in `@theme` — runtime overrides work only for tokens declared in `@theme` (they become CSS vars); arbitrary `bg-[#hex]` classes do not.
