# Synthesis: organizer page layouts and color theming (rev. 2, deep dives integrated)

Date: 2026-10-07 · Research type: mixed (technical + requirements + literature) · Inputs: 17 finding files in `analysis/findings/` (13 first-pass + 4 deep dives), plus `planning/research-brief.md` and `planning/research-plan.md`.

Finding-file abbreviations:
- First pass: `FE-COL` codebase-frontend-color-application · `FE-PAGES` codebase-frontend-pages-and-data-flow · `FE-SEAMS` codebase-frontend-seams-and-tests · `BE-CUR` codebase-backend-current-state · `BE-STO` codebase-backend-storage-options · `UX-MOCK` docs-ux-mockups-and-content-blocks · `UX-PRIOR` docs-ux-prior-tasks · `UX-STD` docs-ux-standards-and-docs · `EXT-CHAKRA` external-theming-chakra-v3-mechanism · `EXT-A11Y` external-theming-contrast-fouc-editor · `EXT-TOK` external-theming-tokens-and-palette-generation · `EXT-SAAS` external-saas-platforms · `EXT-PROP` external-saas-patterns-and-proposal.
- Deep dives (rev. 2): `DL` deep-layouts · `DC` deep-content · `DCOL` deep-colors · `DPM` deep-product-monetization.

Revision note: rev. 2 replaces these rev. 1 statements:
- "color-mix in CSS is an option for tints": replaced by a JS generator, hand-written `orgPalette.ts`.
- "~12 hard-coded hexes": replaced by the full inventory, with about 14 must-change themable sites.
- "portals unverified (G1)": resolved. There are no portals.
- "EXCHANGE = needed items + counts first": redefined as an item board.
- "public read model under `/api/organizations/public/{slug}`": moved to a groups-owned path.
- "SCHEDULE = Grafik": renamed to "Plan zajęć".
- Content and media storage, monetization price point and task split are now specified.

---

## 1. Research question

How should the public organizer page (`/:organizationSlug`) be designed so that the organizer can pick 1 of 5 layout presets and a color palette? The palette must also recolor the term page (`/:slug/grupa/:groupId/term/:termId`) and the product page (`/product/:id`), which keep one fixed structure. The organizer needs an easy editor, and the architecture must allow selling paid custom layouts later.

## 2. Executive summary

**Theming mechanism is verified, not just plausible.** All three target pages use Tailwind v4 tokens plus the KragStage stylesheet; Chakra is used only in `/admin` (FE-COL, UX-STD D6).
- DCOL compiled the repo's real `index.css` with `@tailwindcss/node` 4.3.3. Every named-token utility compiles to `var(--color-*)` at the element, including opacity modifiers inside the `@supports color-mix` branch. A scoped override on a wrapper element therefore recolors the subtree (DCOL §1.1, High).
- A Chromium test confirmed the pitfall: any variable defined in terms of another `var()` on `:root` freezes at `:root`. That covers non-inline `@theme` derived tokens and KragStage's `:root{--mint…}` aliases (DCOL §2).
- The chosen design follows from this. A pure, synchronous JS generator, a hand-written `orgPalette.ts` of about 0.9 KB gz versus 6.8 KB gz for `culori/fn`, computes **all 13 themable leaf variables** and writes them inline on an `OrganizerThemeScope` element. Fixed tokens stay on `:root` and are marked `@theme static`, because Tailwind tree-shakes theme variables that no utility uses.
- CSS `color-mix` alone cannot choose an on-primary color or correct contrast, so it is rejected as the main mechanism.
- There are **no portals** in `src/`, so every sheet and toast inherits the scope if it is mounted at page level (DCOL §4).

**Data, not rendering, is the critical path.** The layout set is refined (DL):
- `CLASSIC`, `SCHEDULE` ("Plan zajęć"), `CIRCLES` ("Grupy", with a `featured` single-circle variant), `LINKS` ("Wizytówka") and `EXCHANGE` ("Wymiana").
- `EXCHANGE` is redefined as a photo **item board**. The rev. 1 version was CLASSIC reordered and failed a distinctness test.
- All five layouts are built from a 17-block library behind a JSON-serializable `PageLayoutDefinition` registry. A paid or custom layout then becomes just a new registry entry.

Content needs new data and new endpoints (DC):
- Text fields (`tagline`, `bio`, `location`) are columns moderated synchronously via `check_text` (Bielik).
- `links` is one Pydantic-validated JSONB column.
- Images (logo, cover, gallery) go in a new `organization_media` table. Its column set matches what the VPS B moderation cron expects, so the cron only needs a new `ORGANIZATION_MEDIA` subject and grants (a two-repo change).
- The organizer's circles, terms and exchange come from a new **groups-owned** `GET /api/groups/public/organizers/{slug}`. It has a constant query plan of about 12 queries, includes PUBLIC circles only and exposes no personal names.

**Product page and monetization** (DPM):
- "The organizer of an item" is undefined: an item belongs to a user and can be listed on terms of several organizers. So the product page takes its palette from navigation context. MVP is `?org=<organizer_slug from server response>` on links from the term page, with the default palette elsewhere. `?term=` is v2.
- The product page stays authenticated.
- Monetization: one subscription ("Organizator Pro", about 19–29 PLN net per month) unlocks premium layouts. Bespoke layouts are a service, entitled per organization.
- Only the storage seam is built now: `page_layout` VARCHAR with a code allowlist, the registry with fallback, content kept orthogonal, and one server-side place that returns the layout. Entitlements, `tier`, the catalog endpoint and the `effective_layout` resolver come later and are purely additive.

## 3. Cross-source analysis

### 3.1 Validated findings

| # | Finding | Sources | Confidence |
|---|---|---|---|
| V1 | Target pages are Tailwind v4 + CSS vars; Chakra only in admin | FE-COL, UX-STD D6, UX-PRIOR, DCOL §1 | High |
| V2 | Named-token utilities compile to `var(--color-*)`; wrapper override recolors the subtree incl. `/50` opacity modifiers | DCOL §1.1 (compiled with repo Tailwind 4.3.3 + shipped `dist` CSS), EXT-CHAKRA F5 | **High (upgraded from Medium-High)** |
| V3 | `var()`-derived vars on `:root` (non-inline `@theme`, KragStage aliases) freeze; derived vars must be on the scope selector, inlined via `@theme inline`, or computed in JS | DCOL §2 (Chromium test), EXT-CHAKRA F4 | High |
| V4 | Tailwind tree-shakes unused theme vars (`--color-mint-bright`, `--color-sage`, `--color-teal` absent in sample) | DCOL §1.2 | High (Chromium/compile), Medium (exhaustiveness) |
| V5 | No `createPortal`/Chakra `Portal`/`document.body` in `src/`; all overlays are in-tree `position:fixed` | DCOL §4 | High |
| V6 | `Organization` stores `primary_color`/`accent_color` (hex CHECK); no content fields; PATCH can't clear | BE-CUR, DC §5, UX-STD D5 | High |
| V7 | `Group` has no description/capacity/image; `Term` has no title/place/capacity | DL §0, DC §2 (`groups/models.py:97-117,215-229`) | High |
| V8 | Public term payload already exposes `item_listings` + `needed_items` for PUBLIC circles | DL §0, DC §4.3 | High |
| V9 | Moderation as built: text = synchronous Bielik `check_text` (fails closed, 503); images = Spaces private-until-approved + VPS B ShieldGemma cron over tables with an identical column set | DC §1 (code read in both repos) | High |
| V10 | Item → organizer is many-to-many over time; only "term through which the user arrived" is defined | DPM A3, BE-CUR §7 | High |
| V11 | No entitlement/plan concept; prior business research excluded pricing | BE-CUR §9, UX-PRIOR P5, DPM B1 | High |
| V12 | Editor = live preview with real components + explicit save; "seeing is deciding" precedent | UX-PRIOR P1, EXT-SAAS, EXT-A11Y F5 | High |
| V13 | Personas 2–4 (family, class, team) are mostly PRIVATE circles, so public-data-heavy layouts are often near-empty | DL §0/§4 (prior research 2026-09-22) | Medium-High |
| V14 | Default palette already fails WCAG AA in several pairs | DCOL §3.6 (measured) | High |

### 3.2 Contradictions and resolutions

**C1. Chakra `colorPalette` vs Tailwind pages (unchanged from rev. 1, now verified).** We adopt the Chakra lesson ("emit every leaf on a scoped wrapper") but target Tailwind `--color-*`. DCOL's compile and Chromium tests upgrade the confidence to High.

**C2. CSS `color-mix()` tints (rev. 1 option a) vs JS generator (DCOL §5).** `color-mix` on the scope selector does follow the override (DCOL §2 case b). But it cannot choose the on-primary color, cannot darken to a contrast target, and gives a different perceived lightness for each hue.
**Resolution:** a hand-written JS generator `src/theme/orgPalette.ts` computes all 13 leaves. Its prototype passes every threshold across 9 test seeds, including white, black, yellow and pink. `color-mix` is kept only as a possible no-JS fallback for decorative tints via `@theme inline`. Use `culori/fn` (never the default entry) only if P3 or APCA are needed later. Confidence: High (mechanism), Medium (generator constants need visual tuning).

**C3. Public organizer read-model path: DL `GET /api/organizations/public/{slug}/page` (one `OrganizerPageData`) vs DC `GET /api/groups/public/organizers/{slug}` (groups-owned).**
DC shows that the dependency today runs one way only, `app.groups → app.organizations` via `organizations_acl.py` ("the ONLY app.groups module that imports the organizations vertical"). An organizations-owned endpoint returning circles and terms would make `app.organizations` import `app.groups`, a reverse dependency and a cycle risk (`exchange_summary.py:13-18` already documents cycle workarounds).
**Resolution: groups-owned path wins.**
- The organization payload (`GET /api/organizations/public/{slug}`, extended with `page_layout` and content) carries the theme and gates first paint.
- The groups payload loads in parallel; its sections show skeletons until it arrives.
- `OrganizerPageData` from DL stays as the **frontend view model** composed by a hook from the two queries. The block library and registry are unaffected.
- Matrix: a new PUBLIC row `^/api/groups/public/organizers/[^/]+(/terms)?$`, placed next to the existing `/api/groups/public/...` rows and ahead of row 26 (`GET ^/api/groups(/.*)?$` READ), instead of "before row 49".
Confidence: High (placement).

**C4. Read-model caps: DL (6 weeks / 30 terms / 24 listings) vs DC (60 days / 10 terms / 12 items / 30 circles, paged `/terms` sub-resource).**
**Resolution:** use DC's caps for the aggregate endpoint. They are SQL `LIMIT`s per `jooq.md`. SCHEDULE's "Pokaż kolejne tygodnie" uses the paged `/terms?page=&size=&group_id=`, built together with SCHEDULE, which is task B. That moves the item from DC's D2 into B, because SCHEDULE ships in B. Confidence: Medium.

**C5. Lister and guardian names on the organizer page.** DL's item-board card shows "od: Rodzina Nowaków", and DL's `circle-visual:mini` needs `guardians[]`. DC's privacy rules forbid aggregating any personal names across circles: no guardian list, no `lister_display_name`, no children data.
**Resolution: privacy wins.**
- Item cards show the product, condition, mode pills and "odbiór: wt 14.10". The lister appears only on the term page the card links to.
- The `featured` mini visualization renders **anonymous seats** (dots or count) around the organizer avatar, or is gated behind an explicit decision to reuse the term-page payload for that one circle.
Confidence: Medium-High.

**C6. Needed items on the organizer page.** DL's EXCHANGE has a `needed-items` block; DC's response shape omits it.
**Resolution:** add `needed_items: [{term_id, group_id, product_name, claimed}]` (next term per PUBLIC circle, no claimer names) to the groups endpoint as part of task B. It is already public per term, so it adds no new exposure. Confidence: Medium.

**C7. Per-circle "families" metric.** DL's circle cards show "12 rodzin". DC defines `family_count` only org-wide (members only, suppressed below 3) and gives each circle `next_term.attendee_count`.
**Resolution:** circle cards show "zapisanych: N" from the next term's `attendee_count`. `family_count` is used only in the CLASSIC stats tile, with suppression. Confidence: Medium (product decision).

**C8. `page_layout` length.** Rev. 1 said VARCHAR(40), DPM says VARCHAR(32), and DL uses `custom:<uuid>`, which is 43 characters.
**Resolution:** use **`VARCHAR(64)`**. It costs nothing and fits either `custom:<uuid>` or DPM's `custom:<slug>`. Confidence: High.

**C9. Accent semantics on the term page.** Rev. 1 said "lime = udostępnia".
DCOL's inventory shows the legend "udostępnia" uses `--mint`, which becomes primary (`GroupVisualization.tsx:259`). Lime appears only as soft pill and badge backgrounds. "Przynosi" uses fixed teal.
**Resolution:**
- "Udostępnia" = `primary`.
- Pills and badges = `accent-soft` / `accent-fg`.
- "Przynosi" = fixed teal, with a contrast fix: a white icon on teal is 2.32:1, so use a darker teal or an ink icon.
- Exchange tiles: GIFT = primary-soft, SWAP = accent-soft, LEND = teal-soft (DL §1 principle 5).
Confidence: Medium-High.

**C10. Storage (rev. 1 C2, unchanged and extended).**
- Columns: `page_layout` plus colors, plus the text columns.
- `links` JSONB is allowed by `models.md:9` ("JSONB for value collections").
- Media go in a table.
- `theme_settings` JSONB stays deferred.
Confidence: High.

**C11. Editor location (rev. 1 C5, unchanged).** Inline owner-only mode on `/:slug` with a bottom sheet. DL adds owner "ghost" blocks that act as an onboarding checklist.

**C12. Rev. 1 plan claim that term/visualization already use org colors.** It was wrong (unchanged).

## 4. Patterns and themes

| Pattern | Description | Evidence | Quality / action |
|---|---|---|---|
| P-A Scoped CSS-variable override | Recolor subtree via vars on wrapper | `PublicOrganizationPage.tsx:68-73`, DCOL §1-2 | Correct idea, incomplete (2 vars); generalize to 13 leaves |
| P-B Two token systems | Tailwind `--color-*` vs KragStage `:root{--mint…}` (13 vars), plus dependents reading `var(--ink-soft)` etc. | DCOL §1.2/§3.2-3.3 (`GroupVisualization`, `PrivateGroupGate`, `RequestAccessDialog`, `AccountMergeForm`) | Debt; delete KragStage vars only after migrating dependents |
| P-C Hard-coded colors | Arbitrary hex, inline styles, SVG strokes, `c=` icon props | DCOL §3 (term ~22 + KragStage ~10, product ~22 incl. 16 panelIcons, org 3) | ~14 must-change themable sites; rest tokenized as fixed |
| P-D String-backed enum + server default | `layout_mode`, `_enum_column(native_enum=False)`, migration 0035 | BE-CUR §6 | Template for `page_layout` |
| P-E Moderated-media table contract | Identical column set + PENDING claim index across `product_photos`, `profile_avatars` | DC §1.2 (`0051`, `photo_store.py:79-115`) | Template for `organization_media` |
| P-F Synchronous text moderation on write | `check_text(field, new, current)`, enum with mandatory message | DC §1.1 | Template for tagline/bio/location |
| P-G Registry: definition (code) vs values (data) | Shopify schema/data/presets; DL `PageLayoutDefinition` + `LayoutRenderer` | EXT-SAAS 1.1, DL §5 | Adopted; declarative `blocks` are JSON-serializable for future DB-stored layouts |
| P-H Narrow public DTOs + ACL boundary | `PublicOrganizationResponse` minimal; groups → organizations only via ACL | BE-CUR §2/§5, DC §4.1 | Decides endpoint ownership (C3) |
| P-I Graceful degradation per block | Every block declares `isEmpty`; one primary block per layout with an empty state; owner sees ghosts | DL §1 | Needed because data is sparse (V13) |
| P-J Seed → derived roles with auto on-color | Squarespace, Radix, Material, Hi.Events | EXT-TOK, DCOL §5 | Implemented by `orgPalette.ts` |
| P-K Entitlement as temporal rows | `valid_from/valid_to` like `Leadership`/`Membership`; plan-key expansion in code | DPM B2 | Deferred until the first paid item |
| P-L Data-fetching standard drift | `PublicOrganizationPage` uses `useState`+`useEffect` | FE-PAGES §2 | Fix when the page is rebuilt (hooks) |

## 5. Key insights

1. **The theming problem is "complete, scoped, computed".** The scope element sets 13 leaves computed in JS. Fixed tokens stay on `:root` as `@theme static`, and nothing derived is declared on `:root`. This works today with zero dependencies. High.
2. **Role names must replace brand names now.** Use `primary`, `on-primary`, `primary-fg`, `primary-soft`, `focus-ring`, `accent`, `accent-soft`, `accent-fg`, `cream`, `stage`, `stage-wide`, `line`, `line-strong`. A `primary-fg` text token separate from the `primary` fill is what fixes the existing 4.45:1 link failure. Old names (`mint`, `lime`) survive only as transitional `@theme inline` aliases. High.
3. **Default and curated presets should be hand-tuned maps, not generator output.** Running the generator on `#1b8168` changes cream from `#f4f8f0` to `#eff9f5`. Presets as fixed maps keep the current look pixel-identical, apart from the deliberate contrast fixes, and argue for storing a preset key (open decision). Medium-High.
4. **Layout distinctness depends on data.** Under PoC-realistic data (a name, maybe 1 public circle) only LINKS and CIRCLES:featured stay clearly distinct. Mitigations: deliver CLASSIC and LINKS first, add a computed "Polecany" badge, and show ghost blocks to owners. Medium.
5. **Endpoint ownership follows the dependency direction.** The circles, terms and exchange read model belongs to `app.groups`. Content and theme belong to `app.organizations`. Two parallel requests, with the theme in the first, keep FOUC at zero. High.
6. **The media path is "copy a known contract".** A new table with the avatar column set, one `Subject` line in the cron, grants, admin union/decide extensions and a deploy order (migration → grants → cron). The only new behavior is "keep the last approved image live until the replacement is approved" (Option B). High (contract), Medium (Option B).
7. **The product page's palette is navigation context by nature.** `?org=` taken from the server-validated `organizer_slug` needs zero backend changes. The panel chrome (`PhoneFrame`, `PanelNavBar`) stays neutral because it is the user's own space. Medium-High.
8. **The paid seam is 3–4 cheap items now; everything else is additive later.** Nothing deferred requires changing a column type, URL scheme or stored data. Medium-High.
9. **The research surfaced pre-existing defects** (§7.2): default-palette contrast failures, any-user item-by-id read, DELETE falling to the catch-all matrix row, and the KragStage global `box-sizing` leak. They should be fixed or tracked separately.

## 6. Relationships and dependencies

```
organizations (primary_color, accent_color, +page_layout, +palette_preset?, +tagline, +bio, +location, +links JSONB)
  └ organization_media (LOGO|COVER|GALLERY, moderated)  ← VPS B cron (Subject ORGANIZATION_MEDIA, grants)
        │
GET /api/organizations/public/{slug}  (theme + layout + content + approved media)   [matrix row 48, PUBLIC]
GET /api/groups/public/organizers/{slug}[/terms] (circles, terms, exchange, needed, stats)  [NEW PUBLIC row before row 26]
        │ (parallel; first gates paint)
        ▼
usePublicOrganization + useOrganizerPage → OrganizerPageData (FE view model)
  → OrganizerThemeScope(buildOrgThemeVars(seeds|preset)) → LayoutRenderer(resolveLayout(key)) → BLOCKS
  owner → EditorSheet (draft {layout, palette}) → PATCH /api/organizations/{id} (model_fields_set) → invalidate
Term: GET /api/groups/public/{id}?term_id → PublicCircleResponse(+organizer_theme via organizations_acl, also PRIVATE branch)
  → TermPage → OrganizerThemeScope → KragStage(.kg-* on --color-*) → PublicTermView | PrivateGroupGate (+ in-tree sheets/toast)
  → listing link /product/:id?org=<organizer_slug>
Product: ItemDetailPage → OrganizerThemeScope(usePublicOrganization(org) | default) around content only; Edit/Back keep location.search
Later: organization_entitlements → effective_layout(org) wraps the single layout-returning call site
```

## 7. Gaps and uncertainties

### 7.1 Remaining gaps
- G-a: Firefox and Safari were not executed; only Chromium 154 was (DCOL §6). The behavior follows the spec and Baseline data.
- G-b: The generator constants (L ladder, chroma factors, accent hue +300°) need visual tuning with real colors.
- G-c: The constant-query plan for the groups endpoint has not been prototyped (Medium-High).
- G-d: Option B pending-image semantics has no precedent in the repo.
- G-e: Persona-to-layout mapping has not been validated with users.
- G-f: Downgrade behavior for applied premium themes: platforms do not document it (Linktree, Carrd, Squarespace). The policy is design judgment.
- G-g: PL/EU legal points (14-day withdrawal, JDG treated as a consumer) need confirmation by counsel before a checkout ships. Pricing benchmarks are mostly from secondary aggregators; Bookero's are official.
- G-h: There is no PL benchmark for the price of a bespoke layout service.
- G-i: Project docs (`architecture.md`, `tech-stack.md`) are outdated for the groups/organizations domain.

### 7.2 Out-of-scope defects found (for the report's dedicated section)

| # | Defect | Evidence |
|---|---|---|
| X1 | Default palette fails AA: `mint` text on cream 4.45:1, `sage` on cream 3.70 and on paper 3.98, white icon on teal 2.32 (non-text minimum is 3:1), `ink-soft` on `mint-soft` 4.41 | DCOL §3.6 |
| X2 | Any authenticated user can read any item by UUID (`/details` + `/history`, matrix row 40); item UUIDs are public via PUBLIC term listings | DPM A2/A5 (`authorization_matrix.py:166`, `item_details.py:45-108`, `groups/schemas.py:264-276`) |
| X3 | `DELETE /api/organizations/...` is not covered by row 50 (POST, PATCH) and falls to the catch-all `AUTHENTICATED` (`authorization_matrix.py:231`) | DC §3.2 |
| X4 | KragStage injects an unlayered global `*,*::before,*::after{box-sizing}` rule (`KragStage.tsx:13`) and a global `:root` palette, so the term page leaks styles to the whole app once mounted | DCOL §1.2 |
| X5 (minor) | Danger color drift: KragStage `#B4443A` vs Tailwind `--color-danger #b23b3b` | DCOL §3.2 |
| X6 (minor) | `PublicOrganizationPage` breaks `data-fetching.md` (`useState`+`useEffect`) | FE-PAGES §2 |
| X7 (minor) | HomeView promises "Dodaj opis, kolory i logo", but no edit path exists; colors were removed from `/organization` | FE-SEAMS, UX-PRIOR |

## 8. Synthesis by framework (mixed)

**Technical: component and flow.** See §6. Theme flows in the same payload as the page (org endpoint, `PublicCircleResponse`, `?org=` on product). Derivation is a pure `useMemo`. The scope sits at page level and must not carry `transform`/`filter`/`contain` (they would break the fixed-position sheets). `display: contents` is allowed, with the background kept on the child.

**Requirements: needs, constraints, gaps.**
- Stated: 5 layouts; palette on 3 pages; fixed structure for term and product; easy editor; paid layouts later.
- Implicit: WCAG AA guaranteed for any seed; no FOUC; default theme for `k-…` organizers; layout switch never loses content; owner-only editing; moderation of all new text and images; privacy of the circles directory (PUBLIC only, no names, suppressed small counts).
- Constraints: 430px phone column; Tailwind; minimal dependencies; TanStack hooks; matrix row ordering; two-repo deploy order for media.

**Literature: applicability.**
- Hi.Events: blueprint for the editor (live preview, explicit save).
- Luma: preset swatches plus one custom option.
- Shopify: definition/values split, "presets copy presentational values only", try-before-buy draft, "breaking redesign = new key".
- Linktree, Carrd, Bookero: bundle look-and-feel into one subscription.
- Stripe Entitlements: persist our own entitlement table and move `valid_to` from webhooks.
- Wix "can't swap template": the anti-pattern.

## 9. Conclusions

**Primary**
1. **Theme:** `OrganizerThemeScope` sets 13 role tokens computed by a hand-written `orgPalette.ts` (OKLCH + WCAG). The default palette and curated presets are hand-tuned maps. Prerequisites: migrate KragStage and its dependents to `--color-*`, tokenize about 14 themable sites, and declare `@theme static` for fixed tokens. (High)
2. **Storage:**
   - `page_layout VARCHAR(64) NOT NULL DEFAULT 'CLASSIC'` with a code allowlist; optional `palette_preset`.
   - Text columns `tagline` (160), `bio` (2000), `location` (120); `links JSONB`.
   - An `organization_media` table.
   - `model_fields_set` PATCH (explicit `null` clears a field).
   - No `theme_settings` yet.
   (High / Medium-High)
3. **Public data:** a groups-owned `GET /api/groups/public/organizers/{slug}`:
   - PUBLIC circles only, no names, SQL caps, about 12 constant queries;
   - `needed_items` added;
   - paged `/terms` built with SCHEDULE.
   (High placement, Medium shape)
4. **Layouts:**
   - CLASSIC: profile.
   - SCHEDULE "Plan zajęć": agenda by day.
   - CIRCLES "Grupy": cards, or featured for a single circle.
   - LINKS "Wizytówka": button stack.
   - EXCHANGE "Wymiana": photo item board.
   All five render from 17 blocks via a `PageLayoutDefinition` registry. SHOWCASE is the first paid candidate. Delivery order: CLASSIC + LINKS first. (Medium-High structure, Medium personas)
5. **Editor:**
   - Inline owner mode with a bottom sheet "Układ / Kolory" (later "Treść").
   - Static SVG thumbnails plus a computed "Polecany" badge; the live page under the sheet is the preview.
   - Curated palettes plus "Własny" with automatic correction shown to the user.
   - Ghost blocks act as a checklist; explicit save.
   (Medium-High)
6. **Product page:** `?org=` from term-page links (server slug) themes the content area only; the default palette applies elsewhere; the page stays authenticated; `?term=` is v2. (Medium-High)
7. **Monetization:**
   - One subscription (about 19–29 PLN net per month); bespoke layouts as a service.
   - Downgrade renders CLASSIC with the organizer's palette and keeps the stored choice; the page never goes offline.
   - Build now only the seam; entitlements and the rest come later and are additive.
   (Medium, Low-Medium for downgrade evidence)
8. **Split:**
   - A: theme + layout + editor shell.
   - B: groups read model + data-heavy layouts.
   - C: text content.
   - D: media + cron (two repos).
   - D2: gallery, `og:image`.
   - Later: monetization.
   A and B backend run in parallel. (High)

**Overall confidence:** High for mechanism, storage, endpoint placement and moderation path. Medium-High for the token set, editor and product context. Medium for layout personas, caps and privacy thresholds. Low-Medium for monetization specifics (price, downgrade, legal).
