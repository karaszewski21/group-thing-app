# Codebase Analysis Report

**Date**: 2026-09-09
**Task**: Guest onboarding simplification + move family creation into Panel + fix logged-in-user RSVP minting a new anonymous account + soft account-suggestion for genuine guests
**Description**: Drop the family-name and family-members steps from guest onboarding (keep only "add items/things"). Move family creation into the Panel: when a logged-in user has no family, show a 404-style state with a dialog carrying onboarding step 1 (family name) + step 2 (members). Fix the bug where an already-logged-in user signing up for a class/term via the public krąg page gets a NEW anonymous/temporary account minted instead of the RSVP being attached to their existing session. For a genuine guest (no account) signing up for a class, suggest creating an account but do not force it.
**Analyzer**: codebase-analyzer skill (3 Explore agents: File Discovery, Code Analysis (enhancement + bug), Context Discovery)

---

## Summary

The four sub-tasks touch three subsystems that are already cleanly separated: the onboarding wizard (`src/frontend/src/components/onboarding/`), the Panel (`src/frontend/src/pages/panel/PanelPage.tsx` + its two `FirstTermStepper*` modals), and the public krąg RSVP flow (`src/frontend/src/pages/krag/` + backend `app/groups/`). Onboarding simplification is low-risk deletion plus relocating two existing, already-wired step bodies into a new Panel dialog — the backend endpoint they call (`POST /api/families/mine/members`, which auto-bootstraps the family) is unchanged. The RSVP bug is not a regression but a missing feature: `POST /api/groups/public/{group_id}/rsvp` is declared with **no auth dependency at all**, its service hardcodes `account_user_id=None`, and the public page/hook/dialog never call `useAuth()` — so a logged-in user is always given the anonymous path. Fixing it means adding an optional-principal branch on both backend and frontend without breaking the genuine-guest path, which must stay anonymous and only *suggest* an account.

---

## Files Identified

### Primary Files — Onboarding simplification

**src/frontend/src/components/onboarding/steps/guestSteps.tsx** (~209 lines)
- `guestSteps: Step[]` with 3 steps, all `isSkippable: true`: (1) family-name "Nazwa rodziny" — frontend-only draft, `setSubmit(null)`, never POSTed (comment at lines ~14-18); (2) family-members "Członkowie rodziny" — draft list of `{name, roleType: GUARDIAN|CHILD}`, batch-submitted to `POST /api/families/mine/members` via `createLightweightMembers` only when `members.length > 0` (lines ~63-66); (3) items "Co chcesz oddać, wymienić lub wypożyczyć?" — `ItemQuickAddForm` → `getMyProfile` → `getInventories`/`createInventory(PERSONAL)` → `resolveProduct` → `registerInventoryItem` (lines ~169-182).
- Task: remove steps 1 and 2, keep only step 3 (items). The typed family name in step 1 is already discarded; backend auto-names the family `f"Rodzina {display_name}"` (`app/families/service.py:168`).

**src/frontend/src/components/onboarding/OnboardingWizard.tsx** (~143 lines)
- Generic prop-configured wizard shell; defines `Step` / `StepContext` interfaces; step dots, "Krok N z M", "Pomiń"/"✕" unless `isSkippable === false`, "Dalej →"/"Zakończ ✓"; per-step imperative `setSubmit` bridge via `submitRef`.
- The step 1/2 bodies to be relocated conform to this `Step` shape — the new Panel dialog can either reuse this shell or the Panel's own `ModalSheet`/`Field`.

**src/frontend/src/pages/OnboardingPage.tsx** (~67 lines)
- Route element for `/onboarding`; role from `useAuth().registeredRole`, falls back to `getMyProfile` + `getLeadershipsForPerson` on refresh; passes `organizerSteps` or `guestSteps`; `onSkip`/`onComplete` both `navigate("/panel")`.
- After simplification, a guest wizard with a single skippable step is nearly a no-op — confirm whether the guest wizard should still exist or whether guests should route straight to `/panel`.

**src/frontend/src/components/shared/ItemQuickAddForm.tsx** + **src/frontend/src/utils/itemQuickAdd.ts**
- 3-field add-item form reused by onboarding step 3, the Panel "Dodaj rzecz" modal, and the guest first-term flow. Unaffected but confirms step 3 is safe to keep standalone.

### Primary Files — Family creation in the Panel

**src/frontend/src/pages/panel/PanelPage.tsx** (~1612 lines, single component driven by real role)
- `load()` (lines ~338-425): single data loader. `const myFamilies = await getMyFamilies(); const myFamily = myFamilies[0] ?? null` (lines ~376-378) → `setFamily(myFamily)`; guardians fetched only if `myFamily` exists. **"No family" = `family === null` / `guardians.length === 0`.**
- `isOrganizer` (line ~265) = `profile?.is_organizer === true || myGroups.length > 0`.
- Hamburger menu (`menuOpen` state, lines ~634-710): Profil, Ustawienia, "Moja organizacja" (Link to slug or `/organization`), "Mój dom" → `setView("rodzina")`, "Dodaj pierwszy termin" (two variants). **No explicit "create family" action exists today** — family is only created as a side effect of `handleAddFamilyMember()` (lines ~556-570) → `createLightweightMembers([{name, role_type}])`.
- "rodzina" ("Mój dom") view (lines ~1230-1307): empty-state card ("Nie masz jeszcze żadnych członków rodziny.") + inline "Dodaj kolejnego członka" form (`memberName`, `memberRole` state at lines ~316-317).
- No-organization/404 precedent (lines ~248-251, ~381-387): `getMyOrganization()` in try/catch, 404 sets `organizationSlug = null`, menu link + HintCard fall back to `/organization`. **This is the pattern to mirror for the no-family 404-style state.**
- Exports reusable `Field` (line ~1582) and `ModalSheet` (line ~1573) — already imported by both steppers (near-circular coupling). `ModalKind` state: `"grupa" | "termin" | "rzecz" | "pierwszy-termin" | null` (line ~65); conditional modal blocks at lines ~1330-1489. `HintCard` (line ~1533) for dismissible localStorage banners.

**src/frontend/src/components/panel/FirstTermStepperGuest.tsx** (~173 lines)
- Closest existing analogue for the new family dialog: a GUEST 2-step modal built from `ModalSheet`/`Field` imported from `PanelPage`. Step 1 "Nazwa kręgu" → `createMyCircle`; step 2 "Data" + "Opis" → `createTerm`; then a "done" screen. Cross-step state is **local `useState`** (`step: 1|2|"done"`, `circleName`, `circle`, ...), deliberately NOT module-scoped — header comment cites `spec.md §2` and the modal being reopened many times per session. `handleStep1` has a catch → inline error "Nie udało się utworzyć kręgu — spróbuj ponownie". Host calls `load({silent: true})` after step 1 so the refresh does not unmount the open modal.
- The new family dialog should follow this exact shape: local `useState` for step 1 (family name) + step 2 (members list), submit via `createLightweightMembers`, `load({silent})` after.

**src/frontend/src/components/panel/FirstTermStepperOrganizer.tsx** (~107 lines)
- ORGANIZER 1-step variant (term only), `circleGroupId` pre-filled from `myGroups[0].id`. Confirms the project's "separate component per role/variant" convention (`scope-clarifications.md` Decision #3).

**src/frontend/src/api/families.ts** (~100 lines)
- `createFamily`, `getMyFamilies`, `getGuardians`, `getMembershipsForFamily`, `createLightweightMembers(members)` → `POST /api/families/mine/members`. `createFamily` currently has **no non-test consumer**.

### Primary Files — RSVP bug (logged-in user minted a new anonymous account)

**src/backend/app/groups/router.py** (~312 lines)
- Lines ~98-107: `@router.post("/api/groups/public/{group_id}/rsvp", ...)` `async def create_rsvp(group_id: int, body: CreateRsvpRequest, db: DbSession) -> RsvpResponse: return await service.create_rsvp(db, group_id, body.term_id, body.guardian_name, body.child_count)`. **No `principal: EditPrincipal`, no `Depends(require_any(...))`, no optional principal.** Every other write route (`create_term`, `create_membership`) takes `principal: EditPrincipal`.
- Also hosts `POST /api/groups/public/merge` (PUBLIC, mints `["READ","EDIT"]` token) and `POST /api/groups/mine` (EDIT, promotes guest to organizer).

**src/backend/app/groups/service.py** (~743 lines)
- `create_rsvp` (lines ~666-702): unconditionally `party = await create_party(db, PartyType.PERSON)`; `profile = UserProfile(party_id=party.id, account_user_id=None, display_name=guardian_name, email=None)`; `attendance = TermAttendance(...)`. **No principal arg, no lookup of an existing session/profile.** Comment at lines ~669-674 notes it deliberately mirrors `create_lightweight_family_member`'s four-step shape.
- `merge_anonymous_profile` (line ~708): in-place upgrade of the anon `UserProfile` (sets `account_user_id`/`email`, keeps `id`/`party_id`/`display_name`/`TermAttendance`), pg advisory lock on `hashtext(email)`, dup-email check → 409; returns a JWT.
- `get_public_circle_view`, `resolve_organizer_slug` / `_fallback_organizer_slug` (k-`<blake2s hash>`, never null).

**src/frontend/src/pages/krag/KragGrupyPage.tsx** (~694 lines)
- Exports `KragGrupyPage` → `PrivateKragGrupyView` (authenticated `/krag/:groupId`, uses `useKragGrupy`, calls `getMyProfile` + `createPledge` with principal) and `PublicKragGrupyView` (unauthenticated per-term page, mounted by slug routes, uses `usePublicKragGrupy`). **`PublicKragGrupyView` never calls `useAuth()`.**
- RSVP CTA "＋ Zapisz się na zajęcia" opens `RsvpDialog` (line ~671); "already RSVP'd" gated purely on `localStorage[guest_profile_id:groupId:termId]`; renders inline `AccountMergeForm` on a needed item's "Zgłoś się" when a guest profile exists.

**src/frontend/src/components/krag/RsvpDialog.tsx** (~138 lines)
- Guest RSVP bottom-sheet: "Imię" + "Liczba dzieci" → `createRsvp(groupId, {term_id, guardian_name, child_count})` (`RsvpDialog.tsx:28`); on success stores `guestProfileIdKey(groupId, termId) = rsvp.user_profile_id` in localStorage.
- This is where the "logged-in vs guest" branch belongs on the frontend — and where the soft "suggest creating an account" prompt for genuine guests should surface.

**src/frontend/src/components/krag/AccountMergeForm.tsx** (~97 lines)
- Inline email+password mini-form (NOT the full `RegisterPage`, no role toggle) that upgrades an anon guest RSVP profile: `mergeAnonymousProfile({user_profile_id, email, password})` → `auth.applyExternalToken(token)` → `navigate("/panel")`. This is the existing "soft account suggestion" primitive to reuse for the genuine-guest case.

**src/frontend/src/hooks/usePublicKragGrupy.ts** (~42 lines)
- Anonymous-safe hook, calls only `getPublicCircle(groupId, termId)`, never an authenticated endpoint. Returns `{loading, error, circle, refetch}`. Only consumer: `KragGrupyPage.tsx:494` (`PublicKragGrupyView`).

**src/frontend/src/api/groups.ts** (~186 lines)
- `createRsvp` → `api.post("/groups/public/${groupId}/rsvp", ...)` (line ~162); `guestProfileIdKey(groupId, termId)` localStorage helper (line ~158); `mergeAnonymousProfile` → `POST /groups/public/merge`; `getPublicCircle`, `createMyCircle`.

**src/frontend/src/api/client.ts**
- `api` fetch wrapper **always** attaches `Authorization: Bearer <auth_token>` from localStorage if present — **including the public RSVP call**. FastAPI receives and silently ignores the header because the route has no principal dependency. This means the token is *already on the wire*; the backend just needs to read it.

### Primary Files — Auth / session

**src/frontend/src/auth/AuthContext.tsx** (~189 lines)
- `AuthProvider` holds `token`/`username`/`permissions`/`displayName`/`registeredRole`; `loadStoredAuth()` reads `localStorage["auth_token"]`, decodes JWT (`sub`, `permissions`, `exp`), drops expired. `login()` → `POST /api/auth/login`; `register()` → `POST /api/auth/register`; `applyExternalToken` (public alias of `applyToken`, used by account-merge); `logout()` clears storage + hard-redirect to `/login`. `useAuth()` hook.

**src/backend/app/core/auth_deps.py**
- `Principal`, `require_any(...)` dependency; JWT decode; `AUTHORIZATION_MATRIX` (25 entries, first-match-wins, **reference-only** — enforcement is per-route via `require_any`; a route with no dependency = simply unauthenticated). Line ~220: `(_methods("POST"), r"^/api/groups/public/[^/]+/rsvp$", "PUBLIC")`. `_extract_token` form-parsing degrades silently (python-multipart not in pyproject). **Need an optional-principal dependency** (`get_current_principal` returning `Principal | None`) for the RSVP route — check whether one already exists or must be added.

**src/backend/app/auth/router.py** (~87 lines)
- `POST /api/auth/login`: resolves `UserProfile` by email → `auth.User` via `account_user_id`; lightweight/temp profiles with null `account_user_id` fail like an unknown email (guard at lines ~65-69). Email normalized.

**src/backend/app/users/service.py** (~217 lines)
- `create_account` (grants READ+EDIT), `register` (ORGANIZER branch only grants `UserRole(ORGANIZATOR)` — **no circle/family bootstrap at registration**, moved to onboarding), `derive_username_from_email` (shared with merge), `is_active_organizer`; `AlreadyMergedException`, `DuplicateEmailException`.

### Related Files

- **src/frontend/src/components/onboarding/steps/organizerSteps.tsx** (~248 lines) — organizer wizard, unaffected but shares the shell; note the `let createdCircle` module-scoped anti-pattern the Panel steppers explicitly avoid.
- **src/frontend/src/router.tsx** (~133 lines) — `/onboarding`, `/panel`, `/krag/:groupId`, `/krag` (auth); unauthenticated public: `/:organizationSlug/grupa/:groupId/term/:termId` → `PublicKragGrupyView`, `/:organizationSlug/grupa/:groupId` → `PublicKragRedirectPage`, `/:organizationSlug` → `PublicOrganizationPage`.
- **src/frontend/src/pages/krag/PublicKragRedirectPage.tsx** (~75 lines) — term-less resolver; redirects to `.../term/:nextTermId` or renders `PublicKragGrupyView` in place for a zero-term circle.
- **src/frontend/src/pages/krag/KragEntryPage.tsx** (~64 lines) — `/krag` (no id) entry; already has no-family states ("Nie należysz jeszcze do żadnej rodziny…"). Precedent for no-family copy.
- **src/backend/app/families/service.py** (~297 lines) — `bootstrap_family_for_party` (Party(ORGANIZATION) + Family + FamilyRole(GUARDIAN) + FamilyMembership(is_primary_contact=True)); `create_lightweight_members_batch` (auto-bootstraps family `f"Rodzina {display_name}"` on first call — the frontend draft name is never sent); `create_lightweight_family_member` (UserProfile `account_user_id=None`).
- **src/backend/app/families/router.py** (~129 lines) — `POST /api/families` (EDIT), `GET /api/families/mine` (READ), `POST /api/families/mine/members` (EDIT, batch, bootstraps family on first call).
- **src/backend/app/families/schemas.py** — `CreateLightweightMemberRequest` (`role_type: GUARDIAN|CHILD`), `CreateLightweightMembersBatchRequest`, `FamilyOut`.
- **src/backend/app/groups/models.py** — `TermAttendance`, `Group`, `Leadership`, `Membership`, `Term`, `NeededItem`, `Pledge`.
- **src/backend/app/groups/schemas.py** (~206 lines) — `CreateRsvpRequest`/`RsvpResponse`, `MergeAnonymousProfileRequest`/`Response`, `PublicCircleResponse`.
- **src/frontend/src/auth/AuthGuard.tsx** (~34 lines) — the auth gate; `requireAuth && !token` → `/login?returnTo=…`.
- **src/frontend/src/api/people.ts** — `getMyProfile`, `UserProfileResponse` (`is_organizer`, `account_user_id`, `party_id`).

---

## Current Functionality

### Guest onboarding (today)

`register (role=GUEST)` → `navigate("/onboarding")` → `OnboardingPage` picks `guestSteps` → 3-step wizard, all steps skippable:
1. **family-name** — pure local draft, `setSubmit(null)`, never persisted. Backend will auto-name the family later.
2. **family-members** — accumulate `{name, roleType}` draft rows; on advance, if non-empty, `createLightweightMembers(...)` → `POST /api/families/mine/members`, which **auto-bootstraps the caller's family** (named from display_name) and adds members + sets caller as primary contact.
3. **items** — `ItemQuickAddForm` → resolve/create PERSONAL inventory → `resolveProduct` → `registerInventoryItem`.

`onSkip`/`onComplete` → `/panel`.

### Family creation (today)

There is **no explicit "create a family" action anywhere**. A family springs into existence the first time `POST /api/families/mine/members` is called — from onboarding step 2, or from the Panel "Mój dom" inline add-member form (`handleAddFamilyMember`). `POST /api/families` (`createFamily`) exists but is only used to create a brand-new account+family together and has no live caller. The Panel's "no family" condition (`family === null`) currently only produces an empty-state card in the "rodzina" view; there is no 404-style gate.

### Public class/term signup (today) — the bug

Shared links resolve to `/:slug/grupa/:groupId/term/:termId` → `PublicKragGrupyView` (mounted with **no `AuthGuard`**, never calls `useAuth()`). "＋ Zapisz się na zajęcia" → `RsvpDialog` → `createRsvp(groupId, {term_id, guardian_name, child_count})` → `POST /api/groups/public/{group_id}/rsvp`.

The endpoint has **no auth dependency**. `service.create_rsvp` unconditionally creates a fresh `Party(PERSON)` + `UserProfile(account_user_id=None, email=None)` + `TermAttendance`, and returns `user_profile_id`, which the browser stores in `localStorage[guest_profile_id:groupId:termId]`. The `Authorization: Bearer` header that `api.post` always attaches is received and ignored.

**Result:** a logged-in user who follows a public class link and clicks "Zapisz się" gets a brand-new detached anonymous profile/party — never linked to their real account, Party, or Family. Their session is completely bypassed. The only recovery is `AccountMergeForm` → `POST /api/groups/public/merge`, which is designed for genuine guests, not for someone who already has an account.

Confirmed via git history (commit `1ff6f13` "add krog"): the entire public krąg flow was introduced wholesale in the most recent commit, anonymous-only by design (`test_rsvp.py` and router docstrings state "anyone with the link may RSVP without an account"). **This is a missing feature, not a regression** — nobody added "if a valid session token is present, attach the RSVP to that account."

### Key Components/Functions

- **`OnboardingWizard` / `Step` / `StepContext`** — generic wizard shell + step contract; imperative `submitRef` bridge.
- **`guestSteps` / `organizerSteps`** — step arrays consumed by the shell.
- **`PanelPage.load()`** — the single data-fetch fan-out; where the no-family decision is made (`myFamilies[0] ?? null`).
- **`PanelPage` `ModalSheet` / `Field`** — exported modal + input primitives, reused by both steppers; the new family dialog should reuse them.
- **`FirstTermStepperGuest`** — the structural template for the new family dialog (local `useState`, 2 steps + done, `load({silent})` after step 1).
- **`service.create_rsvp`** — the unconditional anonymous-profile minting; needs an optional-principal branch.
- **`service.merge_anonymous_profile`** — in-place anon→real upgrade; the model for what "attach to existing account" should also do (but without creating a new `auth.User`).
- **`createLightweightMembers` / `create_lightweight_members_batch`** — the family bootstrap + member add path, reused by both onboarding step 2 and the future Panel dialog.
- **`AccountMergeForm`** — the existing soft account-creation mini-form for genuine guests.

### Data Flow

- **Onboarding step 2 / future Panel family dialog:** frontend draft rows → `createLightweightMembers(members)` → `POST /api/families/mine/members` → `create_lightweight_members_batch` resolves caller's family via `list_families_for_guardian_party`; if none → `bootstrap_family_for_party(f"Rodzina {display_name}", guardian_party_id)`; then per member `create_lightweight_family_member` (Party(PERSON) + UserProfile(`account_user_id=None`) + FamilyRole + FamilyMembership); one commit; returns `{family, guardians}`.
- **Public RSVP (today):** `RsvpDialog` → `createRsvp` → `POST /api/groups/public/{id}/rsvp` (no principal) → `create_rsvp` → new Party(PERSON) + UserProfile(`account_user_id=None`) + TermAttendance → `user_profile_id` → `localStorage[guest_profile_id:groupId:termId]`.
- **Account merge (genuine guest, later):** `AccountMergeForm` → `mergeAnonymousProfile({user_profile_id, email, password})` → `POST /api/groups/public/merge` → in-place update of the anon `UserProfile` (`account_user_id`/`email` set, `id`/`party_id`/`TermAttendance` preserved) → JWT → `applyExternalToken` → `/panel`.

### Three "account" concepts (critical distinction for the bug fix)

1. **GUEST account** — real login-backed (`account_user_id` set), created by `POST /api/auth/register role:"GUEST"`. Promoted to organizer by `POST /api/groups/mine` (grants `GroupRole(ORGANIZATOR)` + `Leadership`, **not** a users-BC `UserRole`, so `profile.is_organizer` stays `false` — frontend compensates with `|| myGroups.length > 0`).
2. **Lightweight family member** — `UserProfile` with `account_user_id = NULL`, no `auth.User`, cannot log in (login guard `auth/router.py:65-69`). Created by `POST /api/families/mine/members`.
3. **Anonymous RSVP profile** — `Party` + `UserProfile(account_user_id=None)` + `TermAttendance`. Created by the unauthenticated RSVP endpoint. Converted to a real account via `POST /api/groups/public/merge`.

The bug: a logged-in **type 1** user is being handed a fresh **type 3** profile instead of the RSVP attaching to their existing Party.

---

## Dependencies

### Imports (What This Depends On)

- **Frontend:** `api/client.ts` fetch wrapper (always attaches bearer token, auto-redirects on 401); `AuthContext` (token/role/`applyExternalToken`); `api/groups.ts`, `api/families.ts`, `api/people.ts`, `api/terms.ts`, `api/organizations.ts`; `PanelPage` exports `ModalSheet`/`Field` (consumed by steppers); `OnboardingWizard` `Step` contract.
- **Backend:** `app/core/auth_deps.py` (`Principal`, `require_any`, `AUTHORIZATION_MATRIX`); `app/core/security.py` (`encode_login_token`, `hash_password`, `verify_password`); `get_profile_by_principal` (principal → `UserProfile` via `User.username`); vertical-slice services call cross-context via plain function calls + FK-id chaining (`groups.service` ↔ `families.service` ↔ `users.service`), never shared ORM models.

### Consumers (What Depends On This)

- **`guestSteps`** — `OnboardingPage.tsx`, `OnboardingWizard.test.tsx`, `OnboardingHandoff.test.tsx`.
- **`FirstTermStepperGuest` / `FirstTermStepperOrganizer`** — only `PanelPage.tsx` (+ `PanelPage.test.tsx`). Both import `Field` + `ModalSheet` from `PanelPage.tsx`.
- **`PanelPage`** — `router.tsx` (`/panel` under `AuthGuard`), `PanelPage.test.tsx`.
- **`usePublicKragGrupy`** — only `KragGrupyPage.tsx:494` (`PublicKragGrupyView`).
- **`createRsvp` / `guestProfileIdKey`** — `RsvpDialog.tsx`, `KragGrupyPage.tsx`.
- **`mergeAnonymousProfile`** — `AccountMergeForm.tsx`.
- **`createLightweightMembers`** — `PanelPage.tsx` (~560), `guestSteps.tsx` (~65).
- **`createFamily`** — no non-test consumer.
- **`POST /api/groups/public/{id}/rsvp`** — `test_rsvp.py`, `test_public_term.py` (helper).
- **"is logged in" consumers** — `AuthGuard.tsx` (the gate), `OnboardingPage.tsx`, `PanelPage.tsx` (logout only; role derived from data), `RegisterPage`/`LoginPage`, `AccountMergeForm.tsx`, `api/client.ts` (reads token directly).

**Consumer Count**: ~10 frontend modules + 2 backend test modules directly touch the changed surface; `PanelPage.tsx` is the single largest blast radius (1612 lines, ~30 `useState`, imported by the steppers).

**Impact Scope**: **Medium-High** — onboarding change is isolated (1 file + tests); Panel change adds a new dialog + a new gated state to an already-large component; RSVP fix spans backend route + service + frontend hook + page + dialog, and is security-adjacent (an endpoint that currently trusts nothing must now conditionally trust a token).

---

## Test Coverage

### Test Files

- **`src/frontend/src/test/PanelPage.test.tsx`** — mocks `useAuth` as a fixed guest stub + all API modules; `renderPanel()` = MemoryRouter + `<PanelPage/>`; `mockGuestDefaults()`/`mockOrganizerDefaults()`. Tests GUEST-without-circle menu, both `FirstTermStepper*` flows, "Moja organizacja" link fallback, full GUEST 2-step circle+term flow + done screen, inline-error regression on `createMyCircle` rejection, `ItemQuickAddForm`, dismissible hints, **Rodzina "Mój dom" section: family list + inline add-member calling `createLightweightMembers([{name, role_type:"GUARDIAN"}])`, reachable for GUEST and ORGANIZER**. `TODO(Group 8)` at line 6: add Playwright E2E for the full GUEST flow.
- **`src/frontend/src/test/PublicKragGrupyPage.test.tsx`** — mocks `api/groups` (`getPublicCircle`, `createRsvp`, `mergeAnonymousProfile`), stubs `useAuth` (**token null**), stubs `useNavigate`; `renderAt(path)` mounts real slug routes. Tests: renders URL-named term; **loads with NO auth token and never bounces to `/login`**; RSVP flow → confirmation + `guestProfileIdKey` stored; confirmation persists on reload; per-circle+term key scoping regression; 404 term; never renders child-identifying fields; account-merge trigger → `mergeAnonymousProfile` → `applyExternalToken` → `/panel`, 409 → inline error.
- **`src/frontend/src/test/OnboardingWizard.test.tsx`** — step-dot progress, "Krok X z N" aria-label, "Pomiń"/"X" → `onSkip` with no submit call; **GUEST config asserted as 3 steps `["family-name","family-members","items"]` / `["Nazwa rodziny","Członkowie rodziny","Rzeczy, które masz"]`**; ORGANIZER config; family-members step `createLightweightMembers` once with accumulated draft. **This test will need updating for the simplified guest wizard.**
- **`src/frontend/src/test/OnboardingHandoff.test.tsx`** — register → `/onboarding` → `/panel` with REAL `AuthProvider`, fetch stubbed. **GUEST: register → 3-step wizard → "Pomiń" → `/panel`.** Needs updating.
- **`src/frontend/src/test/AccountMergeAuthHandoff.test.tsx`** — real `AuthProvider`, real `applyExternalToken`; successful merge stores token, triggers `getMyProfile()`, `navigate("/panel")`.
- **`src/frontend/src/test/auth.test.tsx`** — client attaches bearer, 401 clears token + redirects; `LoginPage`/`RegisterPage`/`AuthContext` contracts.
- **`src/backend/tests/test_rsvp.py`** — `POST /api/groups/public/{group_id}/rsvp` (no auth): creates Party + `UserProfile(account_user_id=None)` + TermAttendance; `guardian_name` → `display_name`; appears in subsequent public GET guardians; mismatched group/term → 404. **`account_user_id is None` is explicitly asserted — this assertion must be revisited for the logged-in branch.**
- **`src/backend/tests/test_account_merge.py`** — `POST /api/groups/public/merge` (5 mandatory + 1 regression): in-place `account_user_id`/`email` update (no 2nd row), merge-then-login, preserves `TermAttendance`, email-already-has-account → 409, already-merged → 409, malformed email → 400.
- **`src/backend/tests/test_public_term.py`** — `GET /api/groups/public/{group_id}?term_id=`; helpers register ORGANIZER, create circle/term/needed-item, RSVP.
- **`src/backend/tests/test_lightweight_family_members.py`** — `POST /api/families/mine/members`: first call auto-bootstraps family ("Rodzina <display_name>", never the frontend draft name) + 2 guardians; second call reuses family; CHILD role persists; lightweight member `account_user_id IS NULL`; cannot log in → 401.
- **`src/backend/tests/test_promotion.py`**, **`test_groups.py`**, **`test_registration.py`**, **`test_login.py`**, **`test_organizations.py`** — supporting contracts (guest→organizer promotion, circle idempotency, register shape, login normalization).

### Backend test conventions (actual, from `conftest.py`)

Session-scoped `PostgresContainer("postgres:18")` via testcontainers; `alembic upgrade head` once; function-scoped `db_session` outer transaction + SAVEPOINT rolled back per test; `client` = `httpx.AsyncClient` + `ASGITransport(app)` with `dependency_overrides[get_db]`. **No auth/session faking** — every test calls `POST /api/auth/register` for a real JWT, then passes `Authorization: Bearer <token>`. Helpers `_register_organizer()` / `_register_guest()` + `_auth_headers(token)`. Anonymous endpoints called with no header. Naming: `action_condition_expectedResult`.

### Frontend test conventions

Vitest + jsdom, `globals: true`, setup `./src/test/setup.ts`; per-file `renderWithProviders()` wrapping `ChakraProvider` + `MemoryRouter`; `vi.mock()` factory functions + `vi.resetAllMocks()` in `beforeEach`; `describe()` named after page/feature; test files in `src/test/`.

### Coverage Assessment

- **Test count**: ~11 relevant frontend + backend test modules.
- **Good coverage:** the anonymous RSVP path, account merge, lightweight family members, guest circle/term steppers, onboarding step config, the "public page never redirects to /login" guarantee.
- **Gaps directly relevant to this task:**
  - **No test for a logged-in user hitting the RSVP endpoint** (the entire bug scenario is untested — `test_rsvp.py` only exercises the anonymous path).
  - No frontend test for `PanelPage`'s no-family / guest-circles branch (`load()` lines ~394-404 fan-out when `activeLeaderships.length === 0`).
  - No backend `test_families.py` for `POST /api/families` or guardian/make-primary.
  - `FirstTermStepper*` error paths partly untested.
  - No E2E/Playwright for the full GUEST flow (`TODO(Group 8)`).
  - `OnboardingPage` stored-token fallback untested; token expiry mid-session untested.
  - `AccountMergeForm` non-409 network-error path untested.

---

## Coding Patterns

### Naming Conventions

- **Backend:** vertical slices `app/<context>/{router,service,schemas,models}.py`. Router = HTTP + response shaping only; logic + ownership checks in `service.py` raising `AccessDeniedException` / `EntityNotFoundException`. Auth via `Annotated[Principal, Depends(require_any("EDIT","mcp:edit"))]` type aliases (`EditPrincipal`, `ReadPrincipal`) per router; **public routes take no principal**. Principal → domain always via `get_profile_by_principal(db, principal)` then `profile.party_id`; never trust client-supplied party ids. Idempotent "create own X" (`create_own_circle`, `create_own_organization`). Roles as standing capacities (`get_or_create_active_group_role` reuses one active row per (party, role_type)); relationships carry `valid_from`/`valid_to` bitemporal (soft-close by setting `valid_to`). Route ordering: `/public/...` before `/{id}` catch-alls. Heavy explanatory docstrings citing `spec.md` / `standards/`.
- **Frontend:** `api` client wrapper (`get/post/put/patch/delete`), throws `ApiError`, auto-redirects to `/login` on 401. Typed request/response interfaces co-located in `src/frontend/src/api/*.ts` mirroring backend schemas. Function components + hooks only; `void asyncFn()` in effects with a `cancelled` guard; `useCallback`/`useMemo` for derived data. Polish UI strings inline; comments referencing `spec.md §`, `scope-clarifications.md`, mockup numbers. **Separate components per role/variant** rather than one parametrized component (`FirstTermStepperGuest` vs `FirstTermStepperOrganizer`, per `scope-clarifications.md` Decision #3).

### Architecture Patterns

- **Style:** microkernel/plugin backend (Python 3.12+, FastAPI, SQLAlchemy 2.0 async, asyncpg, Alembic, PostgreSQL); React 18 + TypeScript + Vite frontend.
- **State Management (frontend):** no global store (no Redux/Zustand/Jotai). One React context: `AuthContext`. Per-page custom hooks own server state (`useKragGrupy`, `usePublicKragGrupy` → `{loading, error, data, refetch}`). Everything else is local `useState` (`PanelPage` ~30 calls). Draft-list pattern: accumulate rows in local state, submit batch on advance/save. `localStorage` for lightweight persistence (`hint_*_dismissed`, `guest_profile_id:<groupId>:<termId>`). Imperative `submitRef` bridge for wizard steps. **Module-scoped mutable var (`let createdCircle` in `organizerSteps.tsx:30`) is a known anti-pattern the Panel steppers deliberately avoid** — the new family dialog must use local `useState`.
- **Two parallel styling systems:** Tailwind (Panel/onboarding) vs hand-written `.kg-*` CSS injected as a `<style>` string (krąg pages) — **deliberately not unified**. The new family dialog is Panel-side → Tailwind + `ModalSheet`/`Field`.
- **Data refresh:** single `load()` / `refetch()` after every mutation; `load({silent: true})` to refresh without unmounting an open modal.

---

## Complexity Assessment

| Factor | Value | Level |
|--------|-------|-------|
| File Size | `PanelPage.tsx` ~1612 lines (primary edit target); `groups/service.py` ~743; ~15 files touched total | High |
| Dependencies | Cross-context service calls (groups ↔ families ↔ users), auth_deps, ~6 frontend api modules | Medium-High |
| Consumers | ~10 frontend modules + backend test modules; `PanelPage` imported by both steppers | Medium-High |
| Test Coverage | Good for existing paths; **zero coverage for the logged-in-RSVP scenario**; onboarding tests need rewrites | Medium |

### Overall: Complex

Four related but distinct sub-tasks across frontend and backend. Individually each is Simple–Moderate (onboarding deletion is trivial; the family dialog closely mirrors `FirstTermStepperGuest`; the RSVP fix is a well-understood single-cause bug). Collectively they touch onboarding, the Panel's largest component, the public krąg flow, and auth/session handling — and the RSVP fix is security-adjacent (an intentionally-anonymous endpoint gaining a conditional trusted branch). The clear cause analysis and strong existing test scaffolding keep it from being High.

---

## Key Findings

### Strengths

- **The RSVP bug has a single, fully-identified root cause:** `POST /api/groups/public/{group_id}/rsvp` has no auth dependency and `create_rsvp` has no principal param. The `Authorization` header is *already sent* by `api.post` — the fix is to read it, not to plumb it through.
- Onboarding steps 1 and 2 are already-isolated `Step` objects; step 2's body (`createLightweightMembers`) is identical to what the Panel "Mój dom" form already does, so relocating it is low-risk.
- `FirstTermStepperGuest` is a precise structural template for the new family dialog (local `useState`, 2 steps + done, `load({silent})` after step 1, inline error on catch).
- The no-organization 404-style fallback in `PanelPage` (`getMyOrganization` try/catch → `slug = null` → menu + HintCard fall back) is a direct precedent for the no-family gate.
- `merge_anonymous_profile` proves the in-place profile-upgrade pattern (preserve `id`/`party_id`/`TermAttendance`) that an "attach to my account" path can reuse conceptually.
- Pre-production project (per memory): no backward-compat shims needed; URLs and data can change freely.

### Concerns

- **`test_rsvp.py` asserts `profile.account_user_id is None`** for the RSVP path — this assertion is only valid for genuine guests after the fix; the logged-in branch must be a separate test and the existing test may need to explicitly call the endpoint with no header.
- `PanelPage.tsx` is 1612 lines with ~30 `useState` and near-circular coupling to both steppers (they import `ModalSheet`/`Field` from it). Adding a new dialog + gated state increases that load; consider whether the new family dialog should live in `src/frontend/src/components/panel/` like the steppers.
- The public krąg page uses the separate `.kg-*` `<style>`-string CSS system; if the account-suggestion prompt for genuine guests is added inside `RsvpDialog`/`PublicKragGrupyView`, it must use `.kg-*` styling, not Tailwind.
- `usePublicKragGrupy` and `PublicKragGrupyView` deliberately never call `useAuth()` — adding a logged-in branch there is a deliberate architectural change; the "public page never redirects to /login" test guarantee (`PublicKragGrupyPage.test.tsx`) must keep passing (reading a token to *enhance* behavior is fine; a *missing/expired* token must still not bounce).
- `api/client.ts` clears the token and redirects to `/login` on any 401 — if the new "attach RSVP to my account" backend path can 401 on an expired token, the public page could get bounced. The backend branch should treat an invalid/expired token on the RSVP route as "fall back to anonymous", never 401.
- Guest→organizer promotion means `profile.is_organizer` can be `false` for a user who nonetheless leads a circle; any new "does this user have a family/account" logic should not conflate organizer status with account status.
- The simplified guest wizard may become a single skippable step — decide whether to keep the wizard at all for guests or route them straight to `/panel` (affects `OnboardingPage`, `router.tsx`, `OnboardingWizard.test.tsx`, `OnboardingHandoff.test.tsx`, `AuthGuard` `authenticatedRedirect="/onboarding"` on `/register`).

### Opportunities

- Move `FirstTermStepper*` and the new family dialog's shared primitives (`ModalSheet`, `Field`) out of `PanelPage.tsx` into a small `src/frontend/src/components/panel/shared.tsx` to break the near-circular import (suggest as a standards note, not in-scope).
- Add the missing `test_families.py` for `POST /api/families` while touching this area.
- Introduce a reusable optional-principal FastAPI dependency (`get_current_principal_optional`) if one does not exist — useful beyond this endpoint.

---

## Impact Assessment

### Primary changes

- **`src/frontend/src/components/onboarding/steps/guestSteps.tsx`** — remove `family-name` and `family-members` steps; keep `items`.
- **`src/frontend/src/pages/panel/PanelPage.tsx`** — add a no-family 404-style gated state (mirror the no-organization pattern) with a CTA opening a new family-creation dialog; wire the dialog into `ModalKind` / the modal block; `load({silent})` refresh after.
- **New: `src/frontend/src/components/panel/CreateFamilyDialog.tsx`** (or similar) — 2-step local-`useState` dialog (step 1 family name, step 2 members list) built from `ModalSheet`/`Field`, submitting via `createLightweightMembers`. Note: backend auto-names the family from `display_name`; if the typed family name must actually be honored, that requires a backend change to `create_lightweight_members_batch` / a new field on `CreateLightweightMembersBatchRequest` (currently the draft name is discarded).
- **`src/backend/app/groups/router.py`** — add an optional principal to `create_rsvp` (`principal: Principal | None = Depends(get_current_principal_optional)`), invalid/expired token → treated as absent (never 401 on this route).
- **`src/backend/app/groups/service.py`** — `create_rsvp` gains an optional principal param: when a valid principal resolves to an existing `UserProfile`/`Party`, attach the `TermAttendance` to that party instead of minting a new `Party`+`UserProfile`; otherwise unchanged anonymous behavior.
- **`src/frontend/src/components/krag/RsvpDialog.tsx`** and/or **`src/frontend/src/pages/krag/KragGrupyPage.tsx` (`PublicKragGrupyView`)** — read auth state; for a logged-in user, skip/adjust the guest dialog and confirmation-via-localStorage logic (their RSVP is now real, not guest-scoped); for a genuine guest, add a non-blocking "create an account?" suggestion (reuse `AccountMergeForm` styling/flow) after RSVP.
- **`src/frontend/src/hooks/usePublicKragGrupy.ts`** — may need to expose or coordinate with auth state (or the auth read stays in the page/dialog to keep the hook anonymous-safe).

### Related changes

- **`src/frontend/src/pages/OnboardingPage.tsx`**, **`src/frontend/src/router.tsx`**, **`src/frontend/src/auth/AuthGuard.tsx`** — if the guest wizard is dropped or bypassed.
- **`src/backend/app/core/auth_deps.py`** — add `get_current_principal_optional` if absent; possibly update the `AUTHORIZATION_MATRIX` comment for the RSVP row.
- **`src/frontend/src/api/groups.ts`** — `createRsvp` / `RsvpResponse` may gain a field indicating whether the RSVP was attached to an existing account.

### Test updates

- **`src/frontend/src/test/OnboardingWizard.test.tsx`** — GUEST config assertion (3 steps → 1) must change.
- **`src/frontend/src/test/OnboardingHandoff.test.tsx`** — GUEST "3-step wizard" expectation must change.
- **`src/backend/tests/test_rsvp.py`** — anonymous-path test must call the endpoint with no header explicitly; add a new test for a registered user RSVPing → `TermAttendance` linked to their existing `Party`, no new `UserProfile` row (delta assertion).
- **`src/frontend/src/test/PublicKragGrupyPage.test.tsx`** — add a logged-in-user RSVP case; keep the "no token → never redirect to /login" guarantee; add a genuine-guest "account suggestion shown, not forced" case.
- **`src/frontend/src/test/PanelPage.test.tsx`** — add no-family 404-state + CreateFamilyDialog flow (GUEST and ORGANIZER, since "Mój dom" is reachable for both).
- New **`src/backend/tests/test_families.py`** recommended for `POST /api/families` coverage if the family-name-honoring backend change is made.

### Risk Level: Medium-High

The onboarding and Panel-dialog work is Low-Medium risk (deletion + a near-copy of an existing component + an established fallback pattern). The RSVP fix is Medium-High: it changes the trust model of an intentionally-anonymous public endpoint, the genuine-guest path must remain exactly as-is (anonymous, with a *soft* suggestion), an expired/invalid token must degrade to anonymous rather than 401 (the frontend client redirects to `/login` on any 401), and the existing `test_rsvp.py` `account_user_id is None` assertion encodes the current behavior. The public krąg page's deliberate `useAuth()`-free design and its dual styling system add friction. No data migration is required; pre-production status removes backward-compat burden.

---

## Recommendations

This task combines a **defect fix** (RSVP) and **modifying existing code** (onboarding, Panel).

### RSVP bug — root cause and fix approach

- **Root cause (confirmed):** `POST /api/groups/public/{group_id}/rsvp` (`app/groups/router.py:98-107`) has no auth dependency and `service.create_rsvp` (`app/groups/service.py:666-702`) has no principal param and hardcodes `account_user_id=None`. The frontend public page/hook/dialog never consult `useAuth()`, so a logged-in user is always shown the anonymous flow. Not a regression — the feature to attach an RSVP to an existing session was never built (commit `1ff6f13`).
- **Backend fix:** give `create_rsvp` an optional principal. Add/locate an optional-principal dependency that returns `Principal | None` and **never raises** on a missing/expired/invalid token for this route. When a principal resolves to a real `UserProfile` (`account_user_id` not null), create the `TermAttendance` against that user's existing `Party` (resolve via `get_profile_by_principal`), do **not** create a new `Party`/`UserProfile`, and return an indicator (e.g. `attached_to_account: true`) so the frontend can skip guest-scoped localStorage handling. When there is no valid principal, behavior is unchanged.
- **Frontend fix:** in `PublicKragGrupyView` / `RsvpDialog`, read auth state (a scoped `useAuth()` read is acceptable here, or pass a prop). Logged-in user: either RSVP directly with a lighter confirmation (no name field needed if it can be derived from the profile — confirm with product) and no `guest_profile_id` localStorage key; genuine guest: unchanged flow plus a **non-blocking** account suggestion after the confirmation (reuse `AccountMergeForm`, which already does `mergeAnonymousProfile` → `applyExternalToken` → `/panel`).
- **Testing:** backend — new `test_rsvp.py` case: register a user, RSVP with `Authorization: Bearer`, assert no new `UserProfile` row and `TermAttendance.party_id == <their party>`; keep the anonymous case (call with no header) asserting the current behavior. Frontend — `PublicKragGrupyPage.test.tsx`: logged-in RSVP does not write `guest_profile_id`; expired token still does not redirect to `/login`; guest sees the account suggestion but can dismiss/ignore it.
- **Verification:** manually (or via `maister:e2e-test-verifier`) — log in, open a public class link, RSVP, confirm in the Panel the attendance shows under the real family/account and no orphan anonymous profile was created.

### Onboarding simplification — implementation strategy

- Edit `guestSteps.tsx` to a single `items` step. Decide with the user whether the guest wizard is kept (single skippable step) or guests route straight to `/panel` (then also touch `OnboardingPage.tsx`, `router.tsx`, `AuthGuard` `authenticatedRedirect`).
- Update `OnboardingWizard.test.tsx` and `OnboardingHandoff.test.tsx` GUEST expectations.
- Backward compatibility: none required (pre-production).

### Family creation in the Panel — implementation strategy

- Add a no-family gate in `PanelPage` mirroring the no-organization pattern (`load()` already computes `family === null`). Render a 404-style state with a CTA that opens the new dialog.
- Build `CreateFamilyDialog` as a near-copy of `FirstTermStepperGuest`: local `useState` (`step: 1|2|"done"`, `familyName`, `members[]`, `busy`, `formError`), step 1 = family name, step 2 = members list (reuse the member-row UI from `guestSteps` step 2 / the Panel "Mój dom" form), submit via `createLightweightMembers`, `load({silent})` after, inline error on catch.
- **Decision point for the user:** the backend currently discards the typed family name and auto-names `f"Rodzina {display_name}"`. If step 1's family name must be persisted, add an optional `family_name` to `CreateLightweightMembersBatchRequest` and honor it in `create_lightweight_members_batch` / `bootstrap_family_for_party` (with a `test_families.py` case). If auto-naming is acceptable, step 1 stays a pure draft like it is in onboarding today.
- Testing: `PanelPage.test.tsx` — no-family state renders, CTA opens dialog, 2-step flow calls `createLightweightMembers`, family list refreshes in place, reachable for GUEST and ORGANIZER.

### Standards notes to raise with the user

- Consider extracting `ModalSheet`/`Field` (and the `FirstTermStepper*` + new dialog) shared primitives out of `PanelPage.tsx` to break the near-circular import — matches `standards/frontend/components.md` (single responsibility, clear interfaces).
- A convention for public endpoints that optionally honor a session token ("read token to enhance, never 401") would be worth documenting in `standards/backend/security.md` alongside the existing `AUTHORIZATION_MATRIX` guidance.

---

## Next Steps

Hand this report to **`maister:gap-analyzer`** to produce a current-vs-desired gap analysis with a user-journey walkthrough for: (a) genuine guest RSVP + soft account suggestion, (b) logged-in user RSVP attaching to their session, (c) new user onboarding (items only), (d) logged-in user with no family landing on the Panel 404 state. Then proceed to specification (`maister:specification-creator`), resolving the two open product decisions first: (1) keep the guest onboarding wizard or route guests straight to `/panel`; (2) persist the typed family name (backend change) or accept auto-naming.
