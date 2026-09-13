# Specification Audit: Admin Panel — Plugins and Product Categories

## Round 1 (pre-revision) — Verdict: FAIL
Critical: C1 (app/product/* not touched), C2 (app/groups/application/*.py DTO builders
unnamed), C3 (wrong/missing test-impact list), C4 (frontend consumer list undercounted by 4).
High: H1 (wrong repository.py function names/lines). Medium: M1 (ambiguous matrix
placement), M2 (unstated migration backfill id-resolution).
→ Spec revised (Revision 2) to address all 6 items; every added/corrected citation
independently re-verified against current file contents at revision time.

## Round 2 (post-revision) — Verdict: FAIL
All 6 Round-1 fixes independently re-verified as accurate (no citation errors found in the
revision). But an independent sweep found 2 NEW critical gaps in the same failure category:

- **Critical**: `src/frontend/src/hooks/useProducts.ts` imports/uses `ProductCategory`
  (line 6 import, line 26 `UseProductsParams.category?`, line 48 passed to `getProducts()`)
  and is called from `ProductListPage.tsx:53` — a 13th touch file, unlisted, causes a dangling
  TS import once `api/products.ts`'s `ProductCategory` export is removed. Also unitemized in
  the same file: `api/products.ts`'s `ProductSearchParams.category` (L37) and
  `getProducts()`'s query-string serialization (L50).
- **Critical**: 8 frontend test files have breaking `category:`/`product_category:` mock
  literals, unflagged: `test/PanelPage.test.tsx` (11 occurrences), `test/pages.test.tsx`,
  `test/extension-points.test.tsx`, `test/FootprintComparisonPage.test.tsx`,
  `test/KragGrupyPage.test.tsx`, `test/ProductFootprintPage.test.tsx`,
  `test/PublicKragGrupyPage.test.tsx` (the public-page test — same file family as the task's
  own "highest-risk" endpoint), `test/CarbonFootprintLandingPage.test.tsx`.
- **Medium**: `plugins/PluginMessageHandler.ts:108` forwards a plugin-supplied `category`
  filter straight through to `/api/products?category=...` — becomes a silent no-op once the
  query param renames to `category_id`. Not scoped/accepted anywhere in spec.

## Round 3 (this revision) — see implementation/spec.md's own Self-Verification
"Revision 3" subsection for the fix-by-fix account. Adds `hooks/useProducts.ts` +
`api/products.ts`'s remaining fields as frontend item, expands Testing Approach with the 8
test files, and records the plugin-SDK category-filter regression as an accepted, explicitly
scoped known limitation (fixing `PluginMessageHandler.ts` is out of scope for this task —
flagged for a follow-up, not silently ignored).

## Process note
Two consecutive FAIL verdicts on this high-risk spec both stemmed from the same pattern:
each pass correctly fixed everything it was pointed at, but an independent sweep by a fresh
auditor found additional touch files in the same category (frontend consumers of
`ProductCategory`, tests with category mock literals) that the fixing pass did not itself
discover via its own sweep. This is reported to the user rather than looped a third time
automatically, per the framework's max-iteration guidance for repeated verification failures.

## Round 3 (post-Revision 3) — Verdict: FAIL

Independent re-audit of Revision 3. Methodology: every citation Revision 3's own
"Revision 3 — audit-fix pass" self-verification subsection added or relied on (backend
`app/product/*`, `app/groups/*`, `app/core/authorization_matrix.py`, `app/plugin/router.py`,
`hooks/useProducts.ts`, `api/products.ts`, `ProductListPage.tsx`, all 8 newly-cited frontend
test files, `plugins/PluginMessageHandler.ts`, `plugins/sdk.ts`) was independently re-read or
re-grepped this session against the current file contents, not reused from the spec's or
prior audit rounds' own line numbers. Every single one of those citations checked out exactly
as claimed — Revision 3 did not introduce any new citation errors. However, a fresh
category-sweep (grepping broader than what Revision 3's own fix-list pointed at, per this
round's explicit charge) found sibling touch-files in the same two failure categories that
caused Round 1 and Round 2 to fail, plus two smaller new gaps:

### Critical
- **3 more backend test files with the exact same breaking `/api/products/resolve` pattern
  that Revision 3's own Testing Approach claims to have exhaustively swept for.** Revision 3's
  self-verification states the backend test grep was "verified via direct grep + read of each
  file," listing only `test_product_resolution.py`, `test_public_term.py`, `test_groups.py`.
  A broader grep this session (`grep -rn "\"category\":\|category=" src/backend/tests`) found
  three additional files with the identical `POST /api/products/resolve` +
  `json={"name": ..., "category": "TOY"/"OTHER"}` helper pattern, which will 422 once
  `ResolveProductRequest.category` becomes `category_id: int` (Backend Core Requirement #3):
  - `src/backend/tests/test_circulation.py` — `_create_item()`'s helper at lines 31-35:
    `json={"name": "Klocki Duplo", "category": "TOY"}` (also a second `_resolve`-style call
    at line 101 with the same shape, `"category": "TOY"`).
  - `src/backend/tests/test_notifications.py` — `_resolve_product()`'s helper at line 46:
    `json={"name": name, "category": "OTHER"}`.
  - `src/backend/tests/test_pledge_fulfillment.py` — `_resolve_product()`'s helper at line 35:
    `json={"name": name, "category": "OTHER"}`.
  None of these three files are named anywhere in spec.md (Testing Approach, Success Criteria,
  or the Revision 3 self-verification's fix-by-fix account). This is not a cosmetic miss —
  these are shared test helper functions (`_create_item`, `_resolve_product`) used throughout
  each file's test suite to bootstrap fixtures; every test in these three files that calls the
  helper will fail once the rename lands. This is the identical failure category as Round 1's
  C3 and Round 2's 8-file frontend-test gap: an incomplete sweep of the existing test suite for
  the `category` → `category_id` rename, recurring for a third round in the backend half this
  time. The existing-test-rewrite tally stated in spec.md ("13 existing test files... 3
  backend + 10 frontend") is wrong; it is at minimum 16 (6 backend + 10 frontend).

### High
- **`src/frontend/src/api/groups.ts` is an unflagged 14th frontend touch-file for the
  `ProductCategory` rename, and it is the file backing the task's own declared
  "highest-risk integration point."** Confirmed by direct read: line 2 —
  `import type { ProductCategory } from "./products"`; line 110 —
  `PublicNeededItemResponse.product_category: ProductCategory`. This interface is not a dead
  type — `getPublicCircle()` (line 153) returns `PublicCircleResponse`, which nests
  `PublicTermResponse.needed_items: PublicNeededItemResponse[]`, and `usePublicKragGrupy.ts`
  (the hook backing the public, unauthenticated `/:slug/grupa/:groupId/term/:termId` page)
  consumes exactly this type. Backend Core Requirement #8 does name `api/groups.ts` (line 110)
  as needing the same `product_category_id`/`product_category_name` rename as `api/terms.ts` —
  so an implementer who reads Backend item 8 carefully will not miss it — but:
  1. It is absent from every Frontend Core Requirement (items 1-12), including item 11's
     "5 additional consumers" list, even though it has the identical shape/defect as item 11's
     first bullet (`api/terms.ts`).
  2. It is not counted in the "13 total frontend touch points" tally repeated in Frontend
     items 10-12's closing sentences and in Success Criteria ("All 13 listed frontend touch
     points... render/submit categories via `useCategories()` or `category_id`") — the true
     count is 14, and `api/groups.ts` is not one of the "13 listed."
  3. Once `api/products.ts`'s `ProductCategory` type is deleted (Frontend item 12), this file's
     `import type { ProductCategory } from "./products"` at line 2 would dangle with no
     Frontend Core Requirement or Success Criteria bullet covering it — only an implementer
     who separately internalizes Backend item 8 as also being a frontend-file instruction
     would catch it.
  This is exactly the pattern named in this round's brief: a sibling touch-file in the same
  category, present in the spec but miscounted/misplaced rather than cleanly covered. Its test
  companion (`test/PublicKragGrupyPage.test.tsx`) IS correctly listed in the Testing Approach,
  which is why this wasn't caught as a "missing file" outright — but the source file itself is
  incompletely tracked.

### Medium
- **`Sidebar.tsx` has a second, unaddressed `hasPluginManagement` gate.** Direct read of
  `src/frontend/src/components/layout/Sidebar.tsx` confirms two separate
  `{hasPluginManagement && ...}` conditionals: line 94 (the "Plugins" `NavItem`, which Frontend
  Core Requirement #8 correctly updates to `hasPluginManagement || isAdmin`) and line 97 —
  `{hasPluginManagement && <PluginMenuItems />}`, a second gate wrapping the
  plugin-contributed sidebar menu items (`PluginMenuItems()`, defined lines 43-63, renders one
  `NavItem` per installed/enabled plugin's own `menu.main` extension point). Frontend Core
  Requirement #8 only cites and changes line 94, and explicitly states "`hasPluginManagement`
  itself, line 67, is unchanged" without acknowledging the second call site at line 97. As
  written, an `ADMIN`-only principal (no `PLUGIN_MANAGEMENT`) will see the "Plugins" nav link
  after this task ships, but will not see any installed plugin's own sidebar shortcut links —
  an inconsistency with the stated additive-coexistence intent ("ADMIN as an additive
  alternative to PLUGIN_MANAGEMENT... gating the existing Plugins section"). Neither fixed nor
  called out as an accepted, deliberate limitation anywhere in Core Requirements, Out of
  Scope, or Known Limitations.

### Low
- **`plugins/server-sdk.ts`'s `getProducts` has the identical category-forwarding regression
  as `PluginMessageHandler.ts`, via a separate code path Revision 3's sweep didn't reach.**
  Revision 3's Known Limitations bullet documents `PluginMessageHandler.ts`'s browser-side
  postMessage proxy (`handleApiMessage`'s `"getProducts"` case, line 108) forwarding a
  plugin-supplied `category` filter verbatim, and cross-references `plugins/sdk.ts`'s doc
  comment (line 34) as the client-facing contract that becomes stale. However,
  `plugins/server-sdk.ts` (the separate `createServerSDK`-based surface used by a plugin's own
  backend code, referenced in `standards/backend/plugin-auth.md`) has its own `getProducts`
  implementation (lines 83-88) that forwards an arbitrary `params` object as literal query
  string keys/values via `new URLSearchParams(Object.entries(params)...)` — the same class of
  silent no-op once `category` stops being a recognized `/api/products` query param. This is a
  structurally distinct file/path from the one named in Known Limitations, not just a second
  call site of the same function. As with the browser-side case, no first-party plugin
  currently invokes `getProducts({category: ...})` through `createServerSDK` (confirmed:
  `plugins/ai-description/src/pages/api/generate.ts` is the only `createServerSDK` consumer,
  and it does not call `getProducts` with a category filter), so nothing breaks today — but
  the spec's Known Limitations bullet describes the mechanism as if `PluginMessageHandler.ts`
  were the only forwarding path, which is incomplete.

### Verified accurate (no error found)
Every citation independently re-checked this round matched the current file contents exactly,
including the previously-fixed items: `app/product/{models,schemas,service,router,
query_service}.py` (all line numbers), `app/groups/{infrastructure/repository.py,
application/terms.py, application/public_view.py, schemas.py}` (all line numbers, including
the newly-precise 196-205/211-219 ranges), `app/core/authorization_matrix.py`'s row-52/
catch-all insertion point (file confirmed at exactly 176 lines, row 52 at line 154, catch-all
at line 155), `app/plugin/router.py`'s `ManagementPrincipal` (line 34) and matrix rows 20-22,
`hooks/useProducts.ts` (lines 6/26/37/48), `api/products.ts` (lines 12/24/33/37/45/50),
`ProductListPage.tsx`'s `useProducts` call site, all 8 of the newly-added frontend test file
line citations (`PanelPage.test.tsx`'s 11 lines including the correctly-excluded prose match
at line 1477, `pages.test.tsx`, `extension-points.test.tsx`, `FootprintComparisonPage.test.tsx`,
`KragGrupyPage.test.tsx`, `ProductFootprintPage.test.tsx`, `CarbonFootprintLandingPage.test.tsx`,
`PublicKragGrupyPage.test.tsx`), and the `PluginMessageHandler.ts:108`/`plugins/sdk.ts:34`
citations. The 8-UI-consumer list (Frontend item 10) was independently re-derived via
`grep -rln "CATEGORY_LABELS\|PRODUCT_CATEGORIES\|CATEGORY_COLORS"` and matches exactly with no
extra or missing files.

### Process note (continued)
This is the third consecutive FAIL, and the failure mode is again the same shape: Revision 3's
fixes were all individually correct, but its own re-verification pass swept only as far as the
specific files the Round 2 audit had named, rather than re-running a category-level grep (e.g.
`grep -rn "category" src/backend/tests`, or `grep -rln "ProductCategory"` across the whole
frontend `src/`) that would have caught the sibling files directly. Both of those exact greps
were run this round and immediately surfaced the Critical and High findings above. Recommended
before a Revision 4: run both category-level greps (not per-file re-reads of previously-named
files) as the first step of the next fix pass, and reconcile every frontend/backend "N files"
tally in spec.md against the live grep count before re-submitting for audit.
