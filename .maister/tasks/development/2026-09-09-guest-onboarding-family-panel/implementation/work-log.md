# Work Log

## 2026-09-09 - Implementation Started

**Total Steps**: 132 (checkbox leaves)
**Task Groups**: G1 (Backend RSVP attach), G2 (Backend families create/rename/child-count), G3 (Backend my-attendances), G4 (Frontend onboarding 1-step), G5 (Frontend Panel family+rename+attendances), G6 (Frontend public krąg logged-in RSVP + suggestion), G7 (Test review)
**Mode**: SEQUENTIAL (orchestrator.options.sequential: true)
**Green gate**: src/backend/tests/test_rsvp.py::test_createRsvp_loggedInUser_attachesToExistingAccountNotNewAnonymousProfile (currently FAILING → G1 makes it pass)

## Standards Reading Log

### Loaded Per Group

## 2026-09-09 - Group 1 (Backend RSVP logged-in attach, R5) — SUCCESS

**Steps**: 1.1–1.12 completed
**Standards Applied**:
- From plan: backend/security.md (route stays PUBLIC, identity via get_current_principal + get_profile_by_principal never body, matrix comment-only), backend/api.md (201 preserved, idempotent repeat = 201 not 409), backend/queries.md (idempotency = one parameterized select, no N+1), global/error-handling.md (typed EntityNotFoundException caught narrowly, bad token → anonymous never 500/401), testing/backend-testing.md (naming, real tokens, 6 tests)
- Discovered: backend/models.md (cross-BC read via function call + FK-id, no ORM relationship, no new column), global/minimal-implementation.md (reused get_current_principal, alias only)
**Tests**: `cd src/backend && uv run pytest tests/test_rsvp.py -q` → 6 passed, 0 failed. Green gate PASSES.
**Files Modified**: test_rsvp.py (+1 assert, +2 tests), app/groups/schemas.py (RsvpResponse.attached_to_account), app/core/auth_deps.py (OptionalPrincipal alias + matrix comment), app/groups/router.py (create_rsvp optional principal), app/groups/service.py (attach-to-account branch + idempotency), src/frontend/src/api/groups.ts (RsvpResponse.attached_to_account)
**Notes**: single commit/refresh shared across attach if/else. test_account_merge.py uses RSVP anonymously via its own helper — additive field, unaffected, not run here.

## 2026-09-09 - Group 2 (Backend families create-own/rename/child-count, R3/R4/R6) — SUCCESS

**Steps**: 2.1–2.12 completed
**Standards Applied**:
- From plan: backend/security.md, backend/api.md, backend/queries.md (count_active_child_members = one func.count() aggregate join), backend/models.md, backend/migrations.md (no migration), global/validation.md + error-handling.md, testing/backend-testing.md
- Discovered: app/core/errors.py maps BOTH Pydantic RequestValidationError AND validator ValueError to **HTTP 400** (not FastAPI default 422) — repo convention, confirmed by test_account_merge.py. Migration 0010 seeds dev-login families so absolute COUNT(*) is meaningless — scope assertions to caller's own family.
**Tests**: `cd src/backend && uv run pytest tests/test_families.py tests/test_lightweight_family_members.py -q` → 14 passed, 0 failed (8 + 6). ruff clean.
**Files Modified**: app/families/schemas.py (child_count default + CreateOwnFamilyRequest + UpdateFamilyRequest + _reject_blank_name), app/families/service.py (count_active_child_members, create_own_family, rename_family), app/families/router.py (POST /api/families/mine, PATCH /api/families/{id}, list_my_families child_count), app/core/auth_deps.py (2 matrix rows, G1 rows untouched), tests/test_families.py (new, 8), tests/test_lightweight_family_members.py (+1), src/frontend/src/api/families.ts (child_count, createOwnFamily, renameFamily)
**DEVIATIONS**:
- Blank-name validation returns **HTTP 400** not 422 (repo convention). G5/G6 FE error handling + spec acceptance re-check should use 400.
- Transient FE typecheck break: PanelPage.test.tsx:126 mockFamily missing child_count → G5 fixes (in G5 scope). PublicKragGrupyPage.test.tsx already has child_count: 2 (G6 scope).

## 2026-09-09 - Group 3 (Backend GET /api/groups/mine/attendances, R10) — SUCCESS

**Steps**: 3.1–3.8 completed
**Standards Applied**: backend/queries.md (single multi-entity joined select, SQL ORDER BY, bounded organizer loop over DISTINCT circles), backend/models.md (explicit multi-entity join is correct eager form — no cross-BC relationship()), backend/api.md (/mine sub-resource), backend/security.md (require_any READ + matrix row), testing/backend-testing.md
**Tests**: `cd src/backend && uv run pytest tests/test_my_attendances.py -q` → 4 passed, 0 failed
**Files Modified**: tests/test_my_attendances.py (new, 4), app/groups/schemas.py (MyAttendanceResponse), app/groups/service.py (_resolve_organizer_display_name + list_my_attendances), app/groups/router.py (route before get_group), app/core/auth_deps.py (1 matrix row, G1/G2 rows preserved), src/frontend/src/api/groups.ts (MyAttendanceResponse + getMyAttendances)
**Notes**: child_count per row = caller's own TermAttendance.child_count. No new index (out of scope, tiny data) — flagged as possible follow-up if endpoint gets hot.

## 2026-09-09 - Group 4 (Frontend guest onboarding 1-step, R1) — SUCCESS

**Steps**: 4.1–4.6 completed
**Standards Applied**: testing/frontend-testing.md (vi.mock factories, vi.resetAllMocks, describe-by-feature), frontend/components.md (OnboardingWizard stays generic shell, step count derived from Step[]), frontend/accessibility.md (drop meaningless role="status" for single step)
**Tests**: `cd src/frontend && npx vitest run src/test/OnboardingWizard.test.tsx src/test/OnboardingHandoff.test.tsx` → 2 files, 11 tests passed (8 + 3), 0 failed
**Files Modified**: guestSteps.tsx (single "items" step, removed family bodies/types/import), OnboardingWizard.tsx (hide dots + counter when total <= 1), OnboardingWizard.test.tsx (rewritten), OnboardingHandoff.test.tsx (rewritten single-step guest flow, no families/mine/members call)
**Notes**: createLightweightMembers still exported + used by PanelPage.tsx:560 (panel's own add-member) — correctly untouched. Minor: single-step layout spacing before h2 now from margins only — flag for design review if needed.

## 2026-09-09 - Group 5 (Frontend Panel: family create + inline rename + Zapisane zajęcia, R2/R4-FE/R9) — SUCCESS

**Steps**: 5.1–5.10 completed (5.9 HintCard skipped — optional, out of scope)
**Standards Applied**: frontend/components.md (CreateFamilyDialog separate component in components/panel/, local state not module-scope), frontend/accessibility.md (aria-pressed toggle, aria-label pencil + rename input, Enter/Escape), frontend/css.md (Tailwind + ModalSheet/Field reuse), testing/frontend-testing.md, global/error-handling.md (ApiError.status===400 branch for blank name — repo returns 400)
**Tests**: `cd src/frontend && npx vitest run src/test/PanelPage.test.tsx` → 34 passed, 0 failed (23 pre-existing + 11 new). `npx tsc --noEmit` clean (transient mockFamily child_count break fixed).
**Files Modified**: components/panel/CreateFamilyDialog.tsx (new, 2-step "Załóż rodzinę"), pages/panel/PanelPage.tsx (ModalKind + attendances/rename state + load() attendances + inline rename + "Zapisane zajęcia" home section + modal wiring + PencilIcon), test/PanelPage.test.tsx (mocks + 11 tests)
**Notes**: rename-error catch also closes editor so previous name is visibly restored. Circular import CreateFamilyDialog↔PanelPage follows FirstTermStepperGuest precedent — tsc + tests green.

## 2026-09-09 - Group 6 (Frontend public krąg logged-in RSVP variant + account suggestion, R7/R8) — SUCCESS

**Steps**: 6.1–6.8 completed
**Standards Applied**: frontend/components.md (RsvpDialogLoggedIn sibling of RsvpDialog, explicit props), frontend/css.md (.kg-* only, no Tailwind on krąg), frontend/accessibility.md (labelled numeric input, role=dialog, real Link), testing/frontend-testing.md, global/minimal-implementation.md (reused AccountMergeForm + RsvpDialog styling, derived state not new effects)
**Tests**: `cd src/frontend && npx vitest run src/test/PublicKragGrupyPage.test.tsx` → 22 passed, 0 failed. tsc + eslint clean on changed files.
**Files Modified**: components/krag/RsvpDialogLoggedIn.tsx (new), pages/krag/KragGrupyPage.tsx (useAuth read, CTA branch, server-derived "already signed up" via circle.guardians match, R8 suggestion block gated on !attached_to_account), test/PublicKragGrupyPage.test.tsx (rewritten, 22 tests)
**Notes**: Refactored pre-existing localStorage setState-in-effect into render-time derivation (also clears a pre-existing lint error). Logged-in path writes NO guest_profile_id key. getMyFamilies() rejection → banner path, never blocks RSVP. Edge: logged-in but displayName not yet resolved → anonymous dialog (noted for reviewer).

## 2026-09-09 - Group 7 (Test Review & Gap Analysis) — SUCCESS

**Steps**: 7.1–7.4 completed
**Standards Applied**: testing/backend-testing.md, testing/frontend-testing.md
**Added**: 6 strategic tests (cap 10) — 4 backend + 2 frontend:
- test_public_term.py: public GET exposes only guardian display_name (account name, not request guardian_name) after logged-in attach; no per-child leak
- test_rsvp.py: logged-in RSVP by non-circle-member → attendance only, zero GroupRole/FamilyRole created
- test_families.py: PATCH family A by guardian of family B → 403 (cross-family isolation)
- test_my_attendances.py: repeat RSVP child_count refresh surfaces in /mine/attendances as one row
- PanelPage.test.tsx: CreateFamilyDialog reopen-clean; getMyAttendances rejection → home still renders
**Tests**:
- Backend feature suite: `uv run pytest tests/test_rsvp.py tests/test_families.py tests/test_my_attendances.py tests/test_lightweight_family_members.py tests/test_public_term.py -q` → 34 passed, 0 failed
- Frontend feature suite: `npx vitest run src/test/{OnboardingWizard,OnboardingHandoff,PanelPage,PublicKragGrupyPage}.test.tsx` → 69 passed, 0 failed
**Confirmed guarantees**: "public-view no per-child leak" ✓ (existing + new); "never redirect to /login" ✓ (3 existing FE + 1 existing BE tests). No padding added.

## 2026-09-09 - Implementation Complete

**Total Steps**: 132 completed (all checkboxes marked; 5.9 optional HintCard skipped as out-of-scope)
**Task Groups**: G1–G7 all SUCCESS
**Full Test Suite**:
- Backend: `cd src/backend && uv run pytest -q` → **72 passed, 0 failed**
- Frontend: `cd src/frontend && npx vitest run` → **161 passed, 2 failed (163 total)**
  - The 2 failures (`src/test/auth.test.tsx` › AuthContext useAuth hook; `src/test/extension-points.test.tsx` › plugin filter iframes) are **PRE-EXISTING on baseline** — verified by stashing all frontend changes and re-running: they fail identically without this task's changes. Both are in unrelated areas (admin AppShell / plugin extension points), not touched by this feature.
**New tests added this task**: ~30 (rsvp +5, families +9, my_attendances +5, lightweight +1, public_term +1, onboarding +11, PanelPage +13, PublicKragGrupy rewrite 22)
**Green gate**: test_createRsvp_loggedInUser_attachesToExistingAccountNotNewAnonymousProfile — PASSES.

## 2026-09-09 - Post-finalization tweak (user request)

Anonymous visitor clicking "＋ Zapisz się na zajęcia" now first sees a choice gate
(`RsvpGateDialog`) instead of the guest form directly:
- "Zaloguj się" → `Link` to `/login?returnTo=<current path>` (LoginPage already honours returnTo; has a register link)
- "Zarejestruj się" → `Link` to `/register`
- "Zapisz się jako gość" → opens the existing anonymous `RsvpDialog`
Logged-in users are unaffected — they still go straight to `RsvpDialogLoggedIn`.
**Files**: new `src/frontend/src/components/krag/RsvpGateDialog.tsx`; `KragGrupyPage.tsx` (useLocation, `showRsvpGate` state, CTA branch, gate render); `PublicKragGrupyPage.test.tsx` (3 anonymous flows now click through the gate + 1 new gate test).
**Tests**: `npx vitest run src/test/PublicKragGrupyPage.test.tsx` → 23 passed; full FE suite 163 passed / 2 pre-existing baseline failures; tsc + eslint clean.

## 2026-09-09 - Post-finalization tweak 2 (user request)

Krąg pages (both `PublicKragGrupyView` and `PrivateKragGrupyView`) are standalone routes
outside the AppShell/Sidebar — a logged-in visitor landing on a shared krąg link had only
"← Wróć" and no way to the panel. Added a "Mój panel →" `Link to="/panel"` in the header
next to "← Wróć": always shown in the private view (`/krag/:groupId`, always authed),
shown only when `isLoggedIn` in the public per-term view.
**Files**: `KragGrupyPage.tsx` (Link import + header rows in both views); `PublicKragGrupyPage.test.tsx` (+1 test).
**Tests**: `PublicKragGrupyPage.test.tsx` → 24 passed; tsc + eslint clean.
