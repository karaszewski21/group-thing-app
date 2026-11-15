# Codebase (frontend): the existing mock "Szukam"

## TL;DR
- The frontend ships a complete but disconnected mock: a list at `/wanted`, a create form at `/add/hunting`, a tile on `/add`, a row in "Konto" and an empty-search prompt. None of it calls the API; there is no `api/` or `hooks/` file for wants.
- The mock promises one thing in its copy, five times: "Damy znać, gdy ktoś doda pasującą rzecz" — a notification to the seeker when a matching item is added. It promises nothing to item owners.
- A want in the mock is `{id, name, modes, matches}`. The form adds an optional description (max 1000) that is thrown away. No category, condition, location, radius, expiry, photo or visibility field exists.
- The two screens do not share state: a want saved on `/add/hunting` never appears on `/wanted`, and the "Konto" count is the constant 3.
- Routing, login gate, reserved slug (frontend and backend) and tests are already in place for `/wanted` and `/add/hunting`.

## Key Decisions
- Treat the mock as a statement of intent for a private, seeker-side list ("moja lista szukam") — every entry point sits under the logged-in panel and "Konto"; nothing shows other people's wants.
- Report the brief/mock field gap without resolving it — the plan assigns that to synthesis (`planning/research-plan.md:20`).

## Open Questions / Risks
- The mock has no screen where a giver browses other people's wants or answers "mam to". Whether wants are public at all is undecided in code.
- The match line ("2 pasujące rzeczy") is plain text, not a link; where matches would open (search with the want as query, a dedicated list) is not designed.
- `modes` is shown on each want but cannot be chosen anywhere; new wants get both modes. Whether offer type is a real field is open.
- Two create paths exist (inline on `/wanted`, full form on `/add/hunting`) with different fields; a real implementation must pick or reconcile them.
- A guest's empty-search click on "Dodaj do listy „szukam”" goes through the login gate (`/add/` is protected); I did not trace whether `?name=` survives the `returnTo` round trip.
- The panel shell's page title for `/wanted` and `/add/hunting` was not located (no title map references these views); low impact.

## Findings

### F1. `/wanted` list — `WantedView` is local state seeded from a constant
**Source**: `src/frontend/src/features/search/WantedView.tsx:7-19`
**Evidence**:
```tsx
/** "Szukam" — things the user is looking for. MOCK: kept in local state
 * only (lost on refresh) until the backend stores wanted items. */
export function WantedView() {
  const [wants, setWants] = useState<MockWant[]>(MOCK_WANTS);
  ...
    setWants((list) => [{ id: crypto.randomUUID(), name, modes: [...ITEM_MODES], matches: 0 }, ...list]);
```
What the screen shows and does:
- Intro copy: "Zapisz, czego potrzebujesz. Damy znać, gdy ktoś doda pasującą rzecz." (`WantedView.tsx:23-25`).
- Inline add: one text input, label "Czego szukasz?" (sr-only), `maxLength={120}`, placeholder "Np. fotelik 9–18 kg", button "Dodaj" disabled while blank (`:27-46`). A new want is prepended with both modes and `matches: 0` (`:17`).
- Empty state: "Czego potrzebujesz?" card (`:48-57`).
- Each row: name as `h2`, mode pills ("Oddam"/"Zamienię") from `w.modes`, a delete button `aria-label="Usuń: <name>"` that removes without confirmation (`:60-81`).
- Match line: `matches > 0` → "N pasująca rzecz / pasujące rzeczy / pasujących rzeczy" on a highlighted pill; otherwise bell icon + "Jeszcze nic · powiadomimy Cię" (`:82-90`). Neither is a link or button.
- No edit, no expiry, no pause, no loading or error state.
**Confidence**: high.

### F2. Mock data shape — `MockWant` and `MOCK_WANTS`
**Source**: `src/frontend/src/utils/mocks.ts:25-30`, `:48-52`
**Evidence**:
```ts
export interface MockWant {
  id: string;
  name: string;
  modes: ItemMode[];
  matches: number;
}
export const MOCK_WANTS: MockWant[] = [
  { id: "w1", name: "Fotelik samochodowy 9–18 kg", modes: ["oddam"], matches: 2 },
  { id: "w2", name: "Kurtka zimowa 110", modes: ["oddam", "zamienię"], matches: 0 },
  { id: "w3", name: "Rowerek biegowy", modes: ["oddam", "zamienię"], matches: 1 },
];
```
`ItemMode` is `"oddam" | "zamienię"` (`src/frontend/src/utils/appHelpers.ts:54`), mapped to backend `GIFT`/`SWAP` by `ITEM_MODE_TO_RESERVATION_TYPE` (`appHelpers.ts:83-86`). The file header says the mocks stand in "for panel sections that have no backend yet … Replace with real API hooks once the endpoints exist" (`mocks.ts:3-7`). `MOCK_WANTS` has two consumers: `WantedView.tsx:10` and `AccountView.tsx:44`.
**Confidence**: high.

### F3. `/add/hunting` form — `HuntingCreateView` stores nothing
**Source**: `src/frontend/src/features/add/HuntingCreateView.tsx:9-31`
**Evidence**:
```tsx
interface HuntingDraft { name: string; description: string; }
/** ... MOCK: nothing matches wanted items yet, so saving only shows a
 * confirmation; nothing is stored. */
const [draft, setDraft] = useState<HuntingDraft>(() => ({ ...EMPTY, name: params.get("name")?.trim() ?? "" }));
...
function submit(e: FormEvent) {
  e.preventDefault();
  if (!valid) return;
  setSaved(draft.name.trim());
  setDraft(EMPTY);
}
```
Fields and behaviour:
- "Czego szukasz?" — required, `maxLength={120}`, placeholder "Np. Kask rowerowy dla dziecka" (`:68-78`).
- "Szczegóły (opcjonalnie)" — textarea, `maxLength={1000}`, placeholder "Rozmiar, kolor, stan" (`:82-92`). The value is discarded on submit; only the name is kept for the confirmation (`:29`).
- Submit "Zapisz poszukiwanie", natively `disabled` while the name is blank (`:95-101`).
- Prefill: `?name=` is trimmed into the name on first render (`:21`), tested in `src/frontend/src/test/HuntingCreateView.test.tsx:7-17`.
- After submit: a `role="status"` card "Zapisane" + the name + "To wersja próbna — nie damy jeszcze znać, gdy ktoś doda pasującą rzecz." (`:36-40`), then "Dodaj kolejną" (back to an empty form) and "Gotowe" (link to `/add`) (`:42-54`). It does not link to `/wanted`.
- Intro copy: "Napisz, czego szukasz — damy znać, gdy ktoś doda pasującą rzecz." (`:62-64`).
- No inline validation message, no server call, no moderation feedback path.
**Confidence**: high.

### F4. The two screens are disconnected, and the two create paths differ
**Source**: `WantedView.tsx:10`, `HuntingCreateView.tsx:26-31`, `AccountView.tsx:44`
**Evidence**: `WantedView` keeps wants in component `useState`; `HuntingCreateView` keeps only `saved: string | null`; neither writes to `AppDataContext`, storage or an API. `/wanted` creates a want from a name only; `/add/hunting` collects a name and a description. "Konto" renders `MOCK_WANTS.length`, so it always reads "3 rzeczy" whatever the user adds or deletes.
**Context**: a real implementation needs one source of truth (a `useWants`-style hook) feeding the list, the count and the form.
**Confidence**: high.

### F5. Entry point: "Szukam rzeczy" tile on `/add`
**Source**: `src/frontend/src/features/add/AddView.tsx:75-82`
**Evidence**:
```tsx
<Link to={linkTo(viewPath("add/hunting"))} className={`${TILE_CLASS} bg-teal-soft text-ink`}>
  <TileContent icon={<SearchIcon c="currentColor" />} iconTone="bg-paper text-ink"
    title="Szukam rzeczy" hint="Damy znać, gdy ktoś doda pasującą" />
```
It is the second of four tiles (Rzecz, Szukam rzeczy, Termin spotkania, Wydarzenie; `AddView.tsx:23-24`). For an anonymous visitor `PublicAddView` sends the tile to `/login?returnTo=%2Fadd%2Fhunting` (`AddView.tsx:39-41`; asserted in `src/frontend/src/test/addRoute.test.tsx:24-27`).
**Confidence**: high.

### F6. Entry point: "Szukam" row in "Konto"
**Source**: `src/frontend/src/features/account/AccountView.tsx:42-46`
**Evidence**:
```tsx
{ label: "Szukam",
  meta: `${MOCK_WANTS.length} ${pluralPl(MOCK_WANTS.length, "rzecz", "rzeczy", "rzeczy")}`,
  to: viewPath("wanted") },
```
It sits in the "Rzeczy" section after "Moje rzeczy" and "Zarezerwowane" (`AccountView.tsx:30-48`). `wanted` is an `ACCOUNT_SUBVIEWS` entry (`src/frontend/src/utils/appHelpers.ts:13-22`), so the bottom bar keeps "Konto" active on `/wanted` (`src/frontend/src/components/layout/BottomNav.tsx:30`; test `src/frontend/src/test/AppPage.test.tsx:2977-2985`).
**Confidence**: high.

### F7. Entry point: empty item search → `/add/hunting?name=<q>`
**Source**: `src/frontend/src/features/search/SearchView.tsx:260-281`
**Evidence**:
```tsx
<h2 ...>{scope === "mine" ? "Nikt w Twoich grupach tego nie oddaje" : "Nikt tego jeszcze nie oddaje"}</h2>
<p ...>Dodaj to do listy „szukam” — dasz znać, czego potrzebujesz.
  {scope === "mine" && " Możesz też szukać wszędzie."}</p>
<Link to={q ? `${viewPath("add/hunting")}?name=${encodeURIComponent(q)}` : viewPath("add/hunting")} ...>
  Dodaj do listy „szukam”
</Link>
```
- Shown only for the `empty-items` view state (`src/frontend/src/features/search/searchViewState.ts:48-53`): items mode, no rows, no error, not stale. The meetings empty state has no such prompt (`SearchView.tsx:101-114`).
- Only the query text is carried. The active filters — category, condition, offer type, locality and radius, scope (`src/frontend/src/api/search.ts:16-24`) — are dropped, although they are exactly the structured fields a want could hold.
- With a blank `q` (a filtered browse with no results) the link goes to an empty form.
- The copy here says "dasz znać, czego potrzebujesz" (you let others know), which differs from the other four places ("damy znać", we will notify you).
- `/search` is open to guests but `/add/` is a protected prefix (`src/frontend/src/routing/paths.ts:126-146`), so a guest is sent to login first.
- Test: `src/frontend/src/test/SearchView.test.tsx:233-240` asserts `/add/hunting?name=rowerek%20biegowy`.
**Confidence**: high.

### F8. Routes, gate and reserved slug
**Source**: `src/frontend/src/app/(site)/(panel)/wanted/page.tsx:1-7`, `src/frontend/src/app/(site)/(panel)/add/hunting/page.tsx:1-7`, `src/frontend/src/routing/paths.ts:19,24,138-139`, `src/frontend/src/routing/reservedSlugs.ts:16`
**Evidence**: both pages are thin `"use client"` route files rendering the feature view; `wanted/` also has `error.tsx`, `loading.tsx`, `not-found.tsx`. `View` includes `"wanted"` and `"add/hunting"`; `PROTECTED_PREFIXES` includes `"/wanted"` and `"/add/"`. `"wanted"` is in the frontend `RESERVED_SLUGS` and in the backend list (`src/backend/app/organizations/slugs.py:42`). Both paths are in the route manifest test (`src/frontend/src/test/routeManifest.test.ts:40,45,127,132`) and `src/frontend/src/test/panelPages.ts:42,69`. Both live in the `(panel)` group, which is client-only behind `PanelGate` (`src/frontend/src/app/(site)/(panel)/layout.tsx:9-15`).
**Context**: no new top-level segment is needed for a real `/wanted`; a public or per-owner wants page would need a new route and, if top-level, a new reserved slug on both sides.
**Confidence**: high.

### F9. Tests pin the mock's behaviour
**Source**: `src/frontend/src/test/AppPage.test.tsx:2987-2997`, `:3028-3038`, `:2934`
**Evidence**: "Szukam adds and removes a wanted item" (adds "Kask rowerowy", deletes it); "the hunting form (mock) needs a name, then shows a confirmation"; the Konto row list expects `[/^Szukam/, "/wanted"]`. These tests, plus F5 and F7's, will need rewriting when the views call an API.
**Confidence**: high.

### F10. No API client, hook or DTO for wants exists
**Source**: grep for `wanted|hunting|MOCK_WANTS|WantedView|HuntingCreate` over `src/frontend/src` (2026-11-14)
**Evidence**: matches only in the files named in F1–F9; nothing under `src/frontend/src/api/` or `src/frontend/src/hooks/`. `NotificationKind` has no match-related member (`src/frontend/src/api/notifications.ts:3-15`).
**Confidence**: high.

### F11. Earlier task folders: "szukam" was deferred on purpose, and was meant to feed search ranking
**Source**: `.maister/tasks/development/2026-11-12-global-search-group-description/analysis/task-description.md:45,64,72`; `analysis/clarifications.md:8,18`; `implementation/spec.md:84,215,418`; `analysis/codebase-analysis.md:28,48`
**Evidence**:
- Original search request: item ranking rule (1) "pasuje do listy „szukam” usera", and "listy „szukam” … nigdy w wynikach" (wants are never search results).
- Decision: "Lista „szukam” — defer vs build backend? — A: Odłożyć"; the empty-state button "navigates to `/add/hunting?name=<q>` (prefill, no write)".
- Spec: ranking "Rule (1), the 'szukam' list, is deferred"; out of scope: "'Szukam' list backend and ranking rule (1)".
- The search codebase analysis already noted that `NeededItem` "is a per-term organizer list, a different concept".
- The user guide tells users the list is a demo: "Zapisywanie listy „szukam” jest na razie wersją pokazową" (`documentation/user-guide.md:12`).
- An older add-hub mockup names the tile "Polowanie — Szukam czegoś" (`.maister/tasks/development/2026-10-28-events-plugin/analysis/design-context/mockups/hub-dodawania-z-toastem.html:253`), the origin of the `hunting` route name.
**Context**: prior intent treats a want as a private per-user list that (a) triggers a notification on a new matching item and (b) boosts matching items in the user's own search. Neither a public wanted board nor an owner-side notification appears in any earlier document I found.
**Confidence**: high for the quotes; medium for the reading of intent.

## Mock versus brief: field comparison

| Aspect | Mock today | Brief scope (`planning/research-brief.md:27-33`) |
|---|---|---|
| Name / free text | yes, max 120 (`WantedView.tsx:35`, `HuntingCreateView.tsx:75`) | yes |
| Description | form only, max 1000, discarded (`HuntingCreateView.tsx:85-92`, `:29`) | implied |
| Offer type (gift/swap) | displayed as `modes`, not selectable (`WantedView.tsx:17,66-70`) | yes |
| Category | none | yes |
| Condition | none (placeholder text mentions "stan") | yes |
| Location / radius | none | yes |
| Expiry / renewal | none | yes |
| Photos | none | to be considered |
| Match count | number per want, hard-coded (`mocks.ts:49-51`) | matching |
| Notification to seeker | promised in copy; no code | yes |
| Notification to item owner | not mentioned anywhere | yes ("notifies both sides") |
| Visibility of wants to others | none; private list under "Konto" | to be decided |
| Edit / fulfil / pause | delete only (`WantedView.tsx:75`) | yes |
| Moderation feedback | none | yes |

**Confidence**: high (left column from code; right column from the brief).
