# Spec Audit: B — Public organizer read model + SCHEDULE / CIRCLES / EXCHANGE layouts

Date: 2026-10-09
Spec: `implementation/spec.md`
Baseline: `main` @ `c026f28` (A2). Every claim below was checked against the working tree.

## Verdict: PASS WITH CONCERNS (conditional)

The spec is thorough, internally consistent and nearly all of its codebase claims are accurate. One defect must be fixed in the spec before planning: as specified, the term-page `thumb_url` (R10) would never reach the real term page, even though all of its tests would pass (C-1). The other findings are medium or low and can be fixed during planning.

| Severity | Count |
|---|---|
| Critical | 1 |
| High | 0 |
| Medium | 5 |
| Low | 8 |

---

## Critical

### C-1. Term-page `thumb_url` is wired to an endpoint the frontend does not call
- **Spec reference.** §Backend Design › Files: "`app/groups/router/circles.py` `get_public_circle` gains the `storage: Storage` dependency and passes it on". `get_public_circle_view(..., storage=None)` defaults to `None`. Test: "`thumb_url` present in `GET /api/groups/public/{id}`".
- **Evidence.**
  - The term page loads its data through `TermPage.tsx:13` → `useTermAccess` (`hooks/useTermAccess.ts:44`) → `getGroupAccess` → `GET /groups/public/{id}/access` (`api/groups.ts:265-267`).
  - Nothing in the frontend calls `getPublicCircle` (`api/groups.ts:232`), apart from its own definition.
  - The `/access` route (`app/groups/router/circles.py:132-145`) calls `public_view.get_group_access` (`public_view.py:303`). That function calls `get_public_circle_view(db, group_id, term_id, include_private_content=...)` at `public_view.py:334` without storage, so it would always yield `thumb_url = None`.
- **Impact.** The R10 frontend (48px thumbnail) would always show the placeholder in production, while the specified backend test passes on the wrong route. This is a false-completion trap for a binding user decision (clarification #1, screen:term-page-listing-thumb).
- **Category.** Incorrect.
- **Fix.**
  - Add `storage: Storage` to the `get_group_access` route too.
  - Thread it through `public_view.get_group_access(..., storage)` into `get_public_circle_view(..., storage=storage)`.
  - Point the thumbnail and query-count tests at `GET /api/groups/public/{id}/access` (keep `/public/{id}` too if desired).
  - The `system/router.py` OG preview callers (l.89, l.104) can stay storage-less.

---

## Medium

### M-1. Statement 3's `DISTINCT ON` next-term subquery is not scoped to the owner's circles
- **Spec reference.** Query plan step 3: "LEFT JOIN a `DISTINCT ON (circle_group_id)` subquery over `Term` where `occurs_on >= now`".
- **Evidence.** The spec does not restrict the subquery to Q. Postgres does not push the outer join predicate into a `DISTINCT ON` derived table. Every anonymous hit would therefore sort and deduplicate every future term on the platform. The new `(circle_group_id, occurs_on)` index (R11) only helps if the subquery is filtered by `circle_group_id`.
- **Impact.** The endpoint is public and unauthenticated, and its cost grows with the whole platform rather than with the organizer. The statement count is unaffected.
- **Fix.** Pick one:
  - Use `LEFT JOIN LATERAL (SELECT id, occurs_on FROM terms WHERE circle_group_id = g.id AND occurs_on >= :now ORDER BY occurs_on, id LIMIT 1)`. This is index-driven.
  - Add `circle_group_id IN (<qualifying-circle subselect>)` inside the `DISTINCT ON` subquery.

### M-2. `thumb_url: string | null` (required) breaks `tsc -b` on an existing typed fixture
- **Evidence.**
  - `src/test/TermPage.test.tsx:40` declares `const circle: PublicCircleResponse = {...}` with `item_listings` object literals (l.66-84) that have no `thumb_url`.
  - `tsconfig.app.json` includes `"src"`, and `npm run build` = `tsc -b && …`.
- **Impact.** The B-frontend commit fails the build unless the fixture is updated. The spec's "intentionally changed" test list does not mention `TermPage.test.tsx`. The `termViewModel.test.ts` fixture uses `as` casts, so it is fine.
- **Fix.** Add `TermPage.test.tsx` (`thumb_url: null` on both listings) to the list of changed tests, and grep for other typed `PublicItemListingResponse` literals.

### M-3. Existing A2 page tests will make unmocked `api/groups` calls
- **Evidence.**
  - `OrganizerEditor.test.tsx` renders `PublicOrganizationPage` (l.8, l.26-42) and mocks only `../api/organizations` (l.15-19).
  - After B, `PublicOrganizationPage` always calls `useOrganizerPage` → `getOrganizerPage`.
  - `beforeEach` calls `vi.resetAllMocks()` (l.79), so any default mock implementation has to be set in `beforeEach`.
  - The spec mentions only the badge test "(~l.241)" for this file.
- **Impact.** Every editor test would fire a real client request, ending in an error and the `unavailable` status. The existing "only Wizytówka is Polecany" test would pass by accident (LINKS ⇐ unavailable), which hides that badges are not data-driven in the test.
- **Fix.** State that every test file that renders `PublicOrganizationPage` adds a file-level `vi.mock("../api/groups", …)`, with `getOrganizerPage` resolved in `beforeEach`. Today that is `OrganizerEditor.test.tsx` and `PublicOrganizationPage.test.tsx`.

### M-4. Owner ghost body copy is not specified for most directory blocks
- **Spec reference.** The §Blocks table column "Owner ghost (title / CTA → route)". Only `stats` has a body.
- **Evidence.**
  - `GhostBlock` needs `{title, body}` (`blocks/GhostBlock.tsx:4-9`, where `body` is required).
  - The mockups give a body only for upcoming-terms ("Tu pokażemy Twoje najbliższe zajęcia. Widzisz to tylko Ty."), next-term-cta ("Tu pojawi się Twój najbliższy termin.") and agenda ("Gdy dodasz terminy, odwiedzający zobaczą tu plan zajęć.").
  - Nothing exists for circles-grid, exchange-counts, exchange-board or needed-items.
- **Impact.** The implementer would invent Polish copy for a binding UI.
- **Fix.** Add a `body` column to the table for all 8 directory blocks, using the mockup texts where they exist.

### M-5. The non-404 first-page error state on `/:slug/terminy` and in `AgendaBlock` is unspecified, and `?group_id=` is not sanitized
- **Spec reference.** §`/:slug/terminy` States lists 404 and next-page error only.
- **Evidence.**
  - `OrganizerTermsPage` seeds the chip from the `group_id` search parameter.
  - A malformed value (`?group_id=abc`) gives a backend 400 (`core/errors.py:111-118`) on the first page, a state with no rendering rule.
  - A 500 or network error on the first page is likewise undefined. The same gap applies to `AgendaBlock`'s own `useOrganizerTerms` query.
- **Fix.**
  - Specify a first-page error state ("Nie udało się wczytać terminów." plus "Spróbuj ponownie").
  - Ignore any `group_id` search parameter that is not one of `directory.circles[].id` (treat it as "Wszystkie", or apply it only after the directory resolves).

---

## Low

### L-1. Blocks keyed on the 60-day window hide a circle's next term when it falls outside that window
`next-term-cta`, LINKS "Najbliższe zajęcia" and CLASSIC's primary `upcoming-terms:list` all key on `upcoming_terms` (60-day window). `circles[].next_term` has no window. Suppose an organizer's only term is 70 days out:
- CLASSIC visitors get "Brak zaplanowanych zajęć".
- `/:slug/terminy` lists the term.
- SCHEDULE's agenda shows it.

**Fix.** Either fall back to `min(circles[].next_term)` for these surfaces, or add this to Known Limitations.

### L-2. The proposed `security.md` wording is itself inaccurate
The spec says "`auth_deps.py` only re-exports it". `app/core/auth_deps.py:22-37` re-exports only `require_any`, the principal helpers and the exception handlers. It does not re-export `AUTHORIZATION_MATRIX`.

The matrix is also never consulted at runtime: `resolve_requirement` is used only in `tests/test_authorization_matrix.py`. PUBLIC access really comes from the route having no `require_any`.

**Fix.** Reword: "The matrix lives only in `app/core/authorization_matrix.py`. It is a reference table verified by tests, and each route enforces its row via `require_any` (or none, for PUBLIC)."

### L-3. The `k-…` → 404 rule is ambiguous
A real organization can legitimately have a `k-` slug: `slugify("K-pop dzieci")` = `k-pop-dzieci` (`organizations/slugs.py:63-73`), and `RESERVED_SLUGS` does not block the prefix.

**Fix.** State that `k-…` returns 404 only because pseudo-slugs never resolve to an Organization. There must be no `startswith("k-")` special case.

### L-4. The impact of `RESERVED_SLUGS` on existing rows is unverified
- Slugs are generated only on create (`organizations/service.py:36-55`) and never regenerated on rename. The migration 0013 backfill (`0013_organizations_slug.py:44-60`) never checked reserved words.
- No local application DB was reachable to check.
- An existing organization with the slug `access`, `terms` or `terminy` stays reachable: the frontend catch-all still matches, and the organizer router comes first on the backend. It would only lose its OG preview, because `system/router.py:120` sends reserved slugs to `spa_fallback`.

**Fix.** Before deploy, run `SELECT id, slug FROM organizations WHERE slug IN ('access','terms','terminy');`.

### L-5. The `CircleVisualMini` aria-label is not pluralized
"Zapisanych N rodzin" is ungrammatical for N = 1–4. Use `pluralPl` ("Zapisana 1 rodzina" / "Zapisane 2 rodziny" / "Zapisanych 5 rodzin").

### L-6. Some composition deviations from the binding mockups need explicit user acknowledgement
- The mockup note (ui-mockups.md l.425) explicitly allows folding `circle-visual` into `circles-grid:featured`.
- `hero:cover` ≡ `hero:color` without a cover image, per the HLD.
- Moving the EXCHANGE `exchange-counts:tabs` slot into `exchange-board` is **not** pre-approved. Mockup l.463 lists it as its own slot, and INDEX.md lists a `tabs` variant for `component:exchange-counts`. The visual result is the same, but the spec drops a mockup variant.

**Fix.** Record a one-line acknowledgement from the user.

### L-7. Migration number 0053 is reassigned while the research HLD still gives it to task C
`analysis/research-context/high-level-design.md:747` still says `0053_organization_content.py` belongs to C. The spec's Known Limitations mentions this, but the HLD and roadmap documents are not updated, so task C's spec could reuse 0053.

**Fix.** Update the HLD migration table, or leave a note in the task C backlog.

### L-8. The term page and the directory use different time bases for "next term"
`public_view.py:228` picks the default term from `>= midnight today`, while the directory uses `>= datetime.now()` (R4). A term earlier today is "next" on the term page but not in the directory. This is harmless, because every directory link carries an explicit `term_id`.

**Fix.** Document it. Do not change the existing behavior.

---

## Claims verified as accurate

Each of these was checked against the code.

**Line references**
- `repository.py`: `list_groups_for_moderation` l.56, `list_needed_items_with_product_for_term` l.278, `count_active_attendances_by_term` l.373, `list_item_listing_preferences_for_parties` l.472.
- `organizations/service.py`: `get_organization_by_slug` l.69, `get_own_organization` l.77.
- `product/router.py:42`: the `Storage` alias.
- `authorization_matrix.py`: `/public/[^/]+$` at l.86, `/access` at l.93.

**Route order is required.** `GET /api/groups/public/organizers/access` would otherwise match `/public/{group_id}/access` (`group_id: uuid.UUID`, `circles.py:132`) and return 400. Including the organizer router first in `groups/router/__init__.py` fixes this. No router registered before `groups_router` in `main.py:136-143` owns `/api/groups/*`.

**Matrix regex.** `^/api/groups/public/organizers/[^/]+(/terms)?$` placed before l.86 correctly covers slug `access` (which `^/api/groups/public/[^/]+/access$` would otherwise capture) and slug `terms`.

**Pagination.** `core/pagination.py` already gives `page ≥ 1` and `1 ≤ size ≤ 100`, and validation errors become 400 (`core/errors.py:111-118`). A non-UUID `group_id` also gives 400.

**Query counting.** Ignoring `SAVEPOINT` / `RELEASE` / `ROLLBACK TO` is correct and necessary. `db_session` uses `join_transaction_mode="create_savepoint"` (`tests/conftest.py:81-85`), and those statements go through `before_cursor_execute`. The session-scoped `engine` fixture is the engine the request session's connection comes from, so a listener on `engine.sync_engine` sees every request statement. No middleware issues DB statements (`main.py:123`, CORS only).

**Statement budget.** The main endpoint uses 11 statements, which fits ≤ 12. Statements 1–2 are organization and owner, 3 is circles, 4 is upcoming terms, then attendance counts, family count, needed items, attendee parties, preferences, available items and photos. The skip rules are symmetric for uniform 1-circle and 5-circle seeding. `/terms` uses at most 5.

**Term-page photo statement.** Asserting exactly one `product_photos` statement is valid. The existing path issues none: `product_service.get_product` is a plain `select(Product)`, at `product/service.py:100-142`.

**Exchange eligibility parity** with `list_public_term_item_listings` (`term_item_listings.py:437-459`):
- active attendances only (`withdrawn_at IS NULL`, `repository.py:359-370`) plus the current leader (`_list_eligible_lister_party_ids`, l.351-365)
- item not soft-deleted (`circulation get_item`, `inventory_items.py:74-80`)
- balance `AVAILABLE`
- Q requires leadership by the owner, and `Leadership` has a partial unique index (one active row per group), so "leader = owner" holds.
- `deleted_at` refers to `InventoryItem`. `Product` has no `deleted_at` (`product/models.py:35-48`).
- Items whose photos are pending moderation have no preference row, so no read-time filter is needed.

**`claimed` rule.** It matches `list_needed_item_views` (non-`WITHDRAWN` pledge). The existing helper's inner join to `UserProfile` has no practical effect, because pledgers always have a profile.

**Thumbnails.** `ProductPhoto.thumb_key` (`/w400.webp`) and `storage.public_url` exist. Approved photos are public on the CDN (`photo_view`, `product/service.py:346-356`), and `FakeStorage.public_url` → `https://cdn.test/...`.

**Families.** `families.models` imports nothing from `app.groups`, so there is no cycle. `FamilyRole.party_id`/`valid_to` and `FamilyMembership.from_role_id`/`to_family_id`/`valid_to` exist as the spec describes.

**`get_owner_party_id`.** It is missing today, and the reverse of `get_own_organization` is the right shape.

**Index.** No `ix_terms_*` composite exists. `ix_terms_circle_group_id` exists only in migrations, not on the model, and the model already declares indexes elsewhere (`circulation/models.py:125`).

**Frontend helpers all exist:**
- `SafeImage` (`placeholderSize`)
- `PhotoPlaceholder`, `TermsIcon`, `GroupsIcon`, `BringsIcon`
- `getCirclePosition` / `getPitchPosition` / `getTablePosition`
- `pluralPl`, `CONDITION_LABELS`, `nextIndex`, `pageParams` / `Page`
- `hasStatus`, `ListingRowVM` (in `termSectionTypes.ts`), `toListingRow` (`PublicTermView.tsx:60`)
- the tokens `bg-teal-soft`, `bg-accent-soft`, `text-accent-fg`, `bg-primary-soft`, `text-on-ink`, `bg-line`

**Panel routes.** `/panel/spotkania` and `/panel/rzeczy` are valid views (`PanelPage.tsx:64-65`). "+ Dodaj grupę" lives in `SpotkaniaView`. The mockup's `/panel/terminy` example would be wrong, because `/panel/terminy` requires `:termId`, so the spec's choice is correct.

**`/:slug/terminy` routing.**
- React Router ranks the 2-segment static-suffix route above `/:organizationSlug`.
- `/panel/terminy` still hits `/panel/:view`, because static `panel` wins.
- A hard refresh is served by `spa_fallback` (`system/router.py`), with no OG meta, which is acceptable.

**Parity.** `organizerKeyParity.test.ts` regex-parses a single `frozenset({...})` literal, so the planned literal is compatible. Parity holds at both commits, because `PAGE_LAYOUT_KEYS` moves with the frontend registry.

**Exactly one primary slot for any circle count.**
- CIRCLES: 0 circles → `featured` (when max 1) → isEmpty → visitor empty state; 1 circle → `featured`; ≥ 2 circles → `cards`.
- The other layouts have a single primary slot.

**Privacy.** The allowlisted Pydantic models carry no party id or name fields. `item_id`, `term_id`, `group_id`, `attendee_count` and `description` are already public on the term page.

## Clarification questions for the user
1. (C-1) Confirm that the thumbnail must appear on the real term page, which means `/access` gets storage too.
2. (L-1) Should "Najbliższe zajęcia" / next-term-cta / CLASSIC fall back to a circle's `next_term` when the nearest term is more than 60 days away, or is the 60-day-only view intended?
3. (L-6) Do you accept that the EXCHANGE `exchange-counts:tabs` slot is merged into `exchange-board` (same visuals, one block)?
4. (M-4) Ghost body copy for circles-grid, exchange-counts/board and needed-items: should the planner draft it, or will you provide it?
