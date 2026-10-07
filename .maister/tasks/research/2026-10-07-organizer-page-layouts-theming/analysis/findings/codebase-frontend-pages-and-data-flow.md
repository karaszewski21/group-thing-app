# Frontend: pages, routing and how organizer data reaches each page

Paths relative to `src/frontend/src/`. Confidence: High unless stated.

## 1. Routing and shells

| Route | Element | Guard | Shell | Source |
|---|---|---|---|---|
| `/:organizationSlug` | `PublicOrganizationPage` | none (public) | `PublicLayout` | `router.tsx:136-145` (declared last, catch-all) |
| `/:organizationSlug/grupa/:groupId/term/:termId` | `TermPage` | none (page branches on auth) | `PublicLayout` | `router.tsx:122-135` |
| `/product/:id` | `ItemDetailPage` | `AuthGuard` | `PublicLayout` | `router.tsx:114-117` |
| `/product/new`, `/product/:id/edit` | `ItemCreatePage`, `ItemEditPage` | `AuthGuard` | `PublicLayout` | `router.tsx:110-121` |
| `/panel`, `/panel/:view` | `PanelPage` | `AuthGuard` | `PublicLayout` | `router.tsx:94-101` |
| `/organization` | `OrganizationPage` (name-only edit form) | `AuthGuard` | standalone, NOT under PublicLayout | `router.tsx:72-78` |
| `/admin/*` | Chakra admin (`AppShell`) | `AuthGuard` | `Layout` | `router.tsx:148-175` |

- Router comment states `:organizationSlug` on the term route is **cosmetic** ("echoed into redirect targets, never validated / never sent to the backend") — `router.tsx:127-129`.
- `PublicLayout` (`components/layout/PublicLayout.tsx:11-26`) is a pathless layout: for logged-in users only it renders a sticky account bar (`NotificationBell` + `AccountMenu`) then `<main><Outlet/></main>`. It has no knowledge of which organizer page is shown. It wraps panel and product pages too, so it is NOT an organizer-specific scope by itself.
- Providers: `main.tsx:12-22` — `QueryClientProvider > ChakraProvider(value=system) > AuthProvider > RouterProvider`. Single global Chakra system, no per-route theming.

## 2. Public organizer page — `pages/PublicOrganizationPage.tsx` (86 lines)

- Data: `getPublicOrganization(slug)` called from `useState`+`useEffect` (`:16-43`) — violates `standards/frontend/data-fetching.md` (no TanStack hook). Any rewrite should add a `usePublicOrganization(slug)` hook in `src/hooks/`.
- Payload type `PublicOrganizationResponse` = `{slug, name, primary_color, accent_color}` only (`api/organizations.ts:14-19`). **No groups, terms, description, logo, contact** — every layout preset richer than "name card" needs a backend payload extension (cross-ref backend gatherer).
- Render (`:64-85`): one centered card: "Organizacja" badge, `h1` name, `domena.pl/{slug}` text. That is the whole page today — effectively a placeholder; there is no existing layout to preserve.
- States: loading text (`:45-51`), not-found (`:53-62`).

## 3. Term page — `pages/krag/TermPage.tsx` → `PublicTermView.tsx`

- `TermPage` (`TermPage.tsx:10-45`) reads `groupId`, `termId` from params (ignores slug), uses `useTermAccess` (`hooks/useTermAccess.ts:40-74`, key `["groupAccess", groupId, termId]`, token deliberately not in key) and renders `PublicTermView` or `PrivateGroupGate`.
- Group payload `PublicCircleResponse` (`api/groups.ts:197-206`) contains `organizer_display_name`, **`organizer_slug`**, `visibility`, `layout_mode`, `term`, `guardians` — but **no colors / no organization theme**.
- `organizer_slug` is "always set by the backend (the organizer's Organization slug, or a stable `k-<hash>` when they have no Organization)" — `pages/panel/panelHelpers.ts:100-107`. So a slug-based theme lookup on the term page can 404 for organizers without an Organization → must fall back to the default palette. (Confidence: High for comment; backend gatherer should confirm `k-<hash>` generation in `groups/domain/organizer_slug.py`.)
- Composition (`PublicTermView.tsx:118-228`): `KragStage` (shell + inline CSS) > `GroupHeader`, `main.kg-main` > `GroupVisualization` (CIRCLE/PITCH/TABLE by `group.layout_mode`), `TermCard`, `NeededItemsSection`, `AttendeeList`, account-suggestion card; `TermFooter`; overlays (RSVP dialogs, `AuthGateSheet`, `SwapProposeDialog`, toast).
- `PrivateGroupGate.tsx:203-253` also renders inside `KragStage` — gate screen would inherit theme for free if theme is applied at `KragStage`/route level.
- Each listing links to `/product/${listing.item_id}` (`PublicTermView.tsx:67-73`) — **this is the only entry from an organizer context to the product page**, and it carries no organizer info.

## 4. Product page — `pages/product/ItemDetailPage.tsx`

- `/product/:id`, AuthGuard'ed, wrapped in `PhoneFrame` + `PanelNavBar` (panel bottom tabs) — `ItemDetailPage.tsx:23-42`. Back button falls back to `/panel/rzeczy` (`ItemBackButton.tsx:10-13`). The page is presently a **personal-inventory / panel page**, not an organizer-branded page.
- Payload `ItemDetailsResponse` (`api/items.ts:26-39`): id, product_id, name, category, condition, description, photos, `is_owner`, `deleted_at`, status — **no organizer / group / organization reference**. Hooks: `useItemDetail` key `["itemDetails", itemId]`, `useItemHistory` key `["itemHistory", itemId]` (`hooks/useItemDetail.ts:20-21,48-50,82-84`).
- An item is owned by a user/family and may be listed on terms of several organizers' groups, so "the organizer of a product page" is not intrinsic. Feasible sources of org context (design decision, Confidence: Medium):
  1. Carry context from the term page link: `/product/:id?org=<slug>` or router `state` (state is lost on refresh/share; query param survives).
  2. Nested route `/:organizationSlug/product/:id` (mirrors term URL; requires router change and `product` handling under slug).
  3. Backend derives "listing context" (e.g. `term_id` query → group → organization theme) in the details payload.
  Without context the page must render the default palette.

## 5. Panel / organizer editing surfaces

- `OrganizationPage.tsx` (`/organization`, 153 lines): name-only form; doc comment `:23-28` says the color-customization step "was removed from this form (per user feedback)" and `createMyOrganization`/`updateOrganization` "still accept color fields on the backend; this page simply never sends them". Test `OrganizationPage.test.tsx:78,91` asserts no color fields are sent/rendered — **these tests encode the removal and must be updated** if the editor returns here.
- Reachability: `AccountMenu.tsx:65` and HomeView hint (`views/HomeView.tsx:77-86`) link to `/${organizationSlug}` when an organization exists, else `/organization`. So once an org exists, **there is currently no navigable link to an edit page** — "Moja organizacja" opens the public page. The HomeView hint copy already promises "Dodaj opis, kolory i logo — zobaczą je odwiedzający." (`HomeView.tsx:80-81`) but leads to a read-only page — product gap the new editor should close.
- `UstawieniaView.tsx:5-45`: notifications/privacy toggles + logout; settings are **local state only** (`PanelDataContext.tsx:436`, and `PanelPage.tsx` header comment "czysto lokalnym stanem"). Natural home for an "Wygląd strony" card only as a link-out; full editor with live preview needs more room than a 430px phone panel card.
- `PanelDataContext.tsx:356-359, 560-566`: fetches `getMyOrganization()` imperatively and stores only `organizationSlug`; `PublicLayout` separately uses `useMyOrganizationSlug` (`hooks/useMyOrganizationSlug.ts:8-16`, key `["myOrganization", token]`). Two parallel sources of "my organization" — an editor should reuse/extend the TanStack `["myOrganization", token]` query (e.g. `useMyOrganization()`), and invalidate it plus the public `["publicOrganization", slug]` key on save.
- Organization creation also occurs in `components/panel/FirstTermStepperGuest.tsx:46-64` (name step, `createMyOrganization({name})`) — the onboarding could later offer a layout/palette step.
- Precedent picker UI: group "Szablon wizualizacji" `<select>` with `LAYOUT_OPTIONS` CIRCLE/PITCH/TABLE (`PanelModals.tsx:50-54, 232-249`) — plain select, no preview. Same naming ("layout"/"szablon") as the new organizer-page layout → use distinct terms (e.g. `page_layout` / "Układ strony") to avoid confusion with `layout_mode`.

## 6. API layer — `api/organizations.ts` (50 lines)

- `OrganizationResponse` incl. `primary_color`, `accent_color` (`:3-12`); `UpdateOrganizationRequest {name?, primary_color?, accent_color?}` (`:25-29`); `PATCH /organizations/{id}` (`:41-46`); `GET /organizations/public/{slug}` (`:48-50`); `GET/POST /organizations/mine` (`:31-39`).
- No hook wraps `getPublicOrganization` or `updateOrganization` yet.
