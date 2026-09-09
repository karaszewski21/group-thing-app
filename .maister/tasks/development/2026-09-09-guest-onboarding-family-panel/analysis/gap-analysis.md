# Gap Analysis: Guest onboarding simplification + family-in-Panel + logged-in RSVP fix + soft account suggestion

**Date**: 2026-09-09
**Inputs**: `analysis/codebase-analysis.md`, `analysis/clarifications.md` (Q1–Q5), project docs (`.maister/docs/INDEX.md`, `standards/backend/security.md`, `standards/frontend/*`)

## Summary
- **Risk Level**: Medium-High (RSVP thread changes the trust model of an intentionally-anonymous public endpoint; onboarding + Panel threads are Low-Medium)
- **Estimated Effort**: Medium (4 threads, ~15 files, 1 tiny backend schema/behaviour change, 1 new frontend dialog, 1 route dependency change)
- **Detected Characteristics**: reproducible defect + modifies existing code + creates new entities (family-creation dialog) + data operations (Family + TermAttendance lifecycle) + UI-heavy

## Task Characteristics
| Characteristic | Value | Evidence |
|---|---|---|
| has_reproducible_defect | yes | Thread 3: logged-in user RSVPing via public krąg link is minted a fresh anonymous `Party`+`UserProfile` instead of the attendance attaching to their session. `create_rsvp` (`app/groups/service.py:666-702`) hardcodes `account_user_id=None`; route (`app/groups/router.py:98-107`) has no principal dep; `PublicKragGrupyView`/`usePublicKragGrupy`/`RsvpDialog` never call `useAuth()`. |
| modifies_existing_code | yes | `guestSteps.tsx` (remove 2 steps), `PanelPage.tsx` (no-family state + dialog wiring), `create_rsvp` route+service, `RsvpDialog.tsx`/`KragGrupyPage.tsx`, `create_lightweight_members_batch` (honour typed name), onboarding tests. |
| creates_new_entities | yes | New `CreateFamilyDialog` (or in-Panel 2-step dialog) component; optional new soft-auth usage; optional `family_name` request field. |
| involves_data_operations | yes | Family CREATE/READ (+ latent UPDATE gap); TermAttendance CREATE (anonymous vs attached); lightweight `UserProfile` rows. |
| ui_heavy | yes | Onboarding wizard steps, Panel "Mój dom" empty state + modal, public per-term RSVP dialog + post-RSVP account suggestion. |

---

## Thread 1 — Guest onboarding simplification

### Current vs desired
| | Current | Desired (Q1) |
|---|---|---|
| `guestSteps` | 3 steps: `family-name` (draft, never persisted), `family-members` (`createLightweightMembers` batch on advance), `items` | 1 step: `items` only |
| Wizard chrome | "Krok 1 z 3", 3 step-dots, "Pomiń"/"Dalej →" | Single step → "Krok 1 z 1" + 1 dot + "Zakończ ✓" |
| Route | register(GUEST) → `/onboarding` → guest wizard → `/panel` | unchanged (Q1: keep the wizard) |

### Gaps
- **Missing**: nothing new; this is deletion. `FamilyNameStepBody` + `FamilyMembersStepBody` bodies are removed from `guestSteps.tsx` (their UX is re-created in Thread 2's dialog, not literally moved — different state model).
- **Behavioural change**: a fresh guest now reaches `/panel` with **no family at all** (`getMyFamilies()` → `[]`). Previously a family was auto-bootstrapped only if they added ≥1 member in step 2. This is the intended trigger for Thread 2's empty state.
- **Dead code after change**: `createLightweightMembers` import in `guestSteps.tsx` is dropped; the function stays (used by `PanelPage` + Thread 2).

### User journey impact
| Dimension | Current | After | Assessment |
|---|---|---|---|
| Onboarding friction | 3 skippable steps, family setup at account creation | 1 skippable step | ✅ improved (matches stated goal) |
| Family discoverability | set during onboarding | deferred to Panel "Mój dom" | ⚠️ depends entirely on Thread 2 empty state being clear (see discoverability score below) |

### Test impact
- `OnboardingWizard.test.tsx`: asserts GUEST = 3 steps `["family-name","family-members","items"]` / titles — **must be rewritten** to 1 step.
- `OnboardingHandoff.test.tsx`: "GUEST: register → 3-step wizard → Pomiń → /panel" — **must be rewritten**.
- No backend test impact (endpoint unchanged).

---

## Thread 2 — Family creation moved into the Panel

### Current vs desired
| | Current | Desired (Q2, Q3) |
|---|---|---|
| Explicit "create family" action | none anywhere; family springs into existence on first `POST /api/families/mine/members` | Button in "Mój dom" empty state → 2-step dialog (step 1 name, step 2 members) |
| No-family state | "rodzina" view renders empty-state card "Nie masz jeszcze żadnych członków rodziny." + inline "Dodaj kolejnego członka" form (keys off `guardians.length === 0`) | Empty state "Nie masz jeszcze rodziny" + CTA opening the dialog (keys off `family === null`). NOT a full-panel route (Q2). |
| Typed family name | discarded; backend auto-names `f"Rodzina {display_name}"` (`service.py:168`) | Persisted: request carries optional `family_name`; auto-name is fallback (Q3) |
| Inline add-member form (family exists) | present in "rodzina" view | keep for the has-family case (not stated to be removed) |

### Gaps
- **Missing frontend**: the 2-step dialog component. Template exists: `FirstTermStepperGuest.tsx` (local `useState` `step:1|2|"done"`, `ModalSheet`/`Field` from `PanelPage`, `load({silent})` after step 1, inline error on catch). Member-row draft UI can be lifted from the deleted `FamilyMembersStepBody`.
- **Missing frontend**: a `ModalKind` entry (currently `"grupa"|"termin"|"rzecz"|"pierwszy-termin"|null`) + conditional modal block + open handler.
- **Missing frontend state**: no-family branch in `load()` — today `myFamilies[0] ?? null` already computes `family`; the view just needs to switch on `family === null` vs `guardians.length === 0`.
- **Missing backend**: `family_name` is not accepted or plumbed anywhere.
  - Layer 1 (endpoint): `CreateLightweightMembersBatchRequest` has only `members: [...]` (`app/families/schemas.py:49-50`).
  - Layer 2 (service): `create_lightweight_members_batch(db, guardian_party_id, members)` — no name param; bootstrap hardcodes `f"Rodzina {guardian_profile.display_name}"` (`service.py:155-169`).
  - Layer 3 (bootstrap): `bootstrap_family_for_party(db, name, guardian_party_id)` already takes a `name` string — so the plumb-through is shallow (schema field → batch fn param → existing `name` arg).
- **Reusable, currently dead**: `POST /api/families` + `createFamily()` exist but create a *new login* (`CreateFamilyRequest` requires `username`/`password`) — **not** usable for an already-logged-in guardian. Do not repurpose; extend the members endpoint instead (lower blast radius).

### Data lifecycle — Family entity

| Operation | Backend | UI component | User access | Status |
|---|---|---|---|---|
| CREATE | `POST /api/families/mine/members` bootstraps family (⚠️ name not honoured yet) | new 2-step dialog (to build) | "Mój dom" empty-state CTA (to build) | ❌ → ✅ after Thread 2 |
| READ | `GET /api/families/mine` + `/guardians` | "rodzina" view guardian list | hamburger → "Mój dom" (`setView("rodzina")`), reachable GUEST + ORGANIZER | ✅ exists |
| UPDATE (rename family) | none | none | none | ❌ latent gap — see decision D4 |
| UPDATE (add/remove member) | add: `POST /api/families/mine/members`; remove: **none** | add: inline form + dialog step 2; remove: **none** | add: "Mój dom" | ⚠️ add only; no member removal (pre-existing, likely out of scope) |
| DELETE family | none | none | none | ❌ out of scope (pre-prod, per memory) |

**Completeness (create + read + add-member, the in-scope slice)**: ~90% after implementation — the only *new* orphan risk is D4 (name is now user-supplied and meaningful but not editable afterward).

### User journey impact
| Dimension | Current | After | Assessment |
|---|---|---|---|
| Reachability of family creation | implicit side-effect only | hamburger (1 tap) → "Mój dom" → CTA (2 taps total) | ✅ |
| Discoverability | N/A (invisible) | empty-state card with primary button, standard pattern | 7/10 — good, but depends on the user opening the hamburger and choosing "Mój dom"; nothing on the Panel home surface points there. Consider a `HintCard` on the home view (precedent: existing dismissible hints). |
| Flow integration | family setup blocked account creation | deferred, opt-in | ✅ matches goal |
| Multi-persona | "Mój dom" reachable for GUEST and ORGANIZER (`PanelPage.test.tsx` asserts this) | must stay reachable for both; ORGANIZER can also lack a family | ✅ if the empty state is role-agnostic |

### Test impact
- `PanelPage.test.tsx`: add no-family empty state renders → CTA opens dialog → 2-step flow calls `createLightweightMembers` (with `family_name`) → list refreshes in place; both GUEST and ORGANIZER. Existing "Rodzina Mój dom" inline-add test stays (has-family case).
- New `src/backend/tests/test_lightweight_family_members.py` cases (file exists): `family_name` honoured on bootstrap; omitted → auto-name fallback; `family_name` ignored when family already exists.

---

## Thread 3 — Logged-in user RSVP attaches to session (the defect)

### Reproduction data
- **Steps**: (1) log in (e.g. dev `karaszewski21@gmail.com`), (2) open a public class link `/:slug/grupa/:groupId/term/:termId`, (3) click "＋ Zapisz się na zajęcia", (4) enter any name + child count, (5) submit.
- **Expected**: the `TermAttendance` attaches to the logged-in user's existing `Party`; no new identity is created; the user sees a confirmation.
- **Actual**: `create_rsvp` unconditionally runs `create_party(PERSON)` + `UserProfile(account_user_id=None, email=None)` + `TermAttendance`; returns a fresh `user_profile_id` that the browser stashes in `localStorage[guest_profile_id:groupId:termId]`. The bearer token that `api.post` always attaches is received and ignored. The user now has a detached anonymous profile unrelated to their account.

### Root cause hypothesis (confirmed, not a regression)
The "attach RSVP to an existing session" branch was never built — the entire public krąg flow landed anonymous-only in commit `1ff6f13`. Three independent omissions:
1. `POST /api/groups/public/{group_id}/rsvp` declares no principal dependency (`app/groups/router.py:98-107`).
2. `service.create_rsvp` has no `principal` param and hardcodes `account_user_id=None` (`service.py:666-702`).
3. `PublicKragGrupyView`, `usePublicKragGrupy`, `RsvpDialog` never read `useAuth()`.

### Desired (Q4 = Option A)
- Route reads an **optional** principal. **A suitable dependency already exists**: `get_current_principal` (`app/core/auth_deps.py:90-116`) returns `Principal | None`, never raises on missing/malformed/expired token (`require_any` is the only thing that turns `None` into 401). It can be used directly as `Depends(get_current_principal)` — no new dependency strictly required, though a named alias (`OptionalPrincipal`) improves readability and matches the `EditPrincipal`/`ReadPrincipal` router convention.
- `create_rsvp` gains `principal: Principal | None`. When it resolves via `get_profile_by_principal` to a real `UserProfile` (`account_user_id` not null): create only the `TermAttendance` against `profile.party_id`; return that existing `user_profile_id`. When `None`/unresolvable: current anonymous behaviour unchanged.
- Frontend: `PublicKragGrupyView` reads auth; logged-in → confirmation pre-filled from profile (no "Imię" field), child count still editable; do **not** write the `guest_profile_id` localStorage key (or write it — see D5); genuine guest → unchanged `RsvpDialog`.
- **Scope note (Q4)**: logged-in RSVP attaches attendance only — no auto family/circle membership.

### Regression risk areas
- `test_rsvp.py` asserts `profile.account_user_id is None` for the RSVP path — valid only for the anonymous branch after the fix. Existing test must call the endpoint **with no header explicitly**; a new test covers the authenticated branch (delta assertion: no new `UserProfile` row, `TermAttendance.party_id == caller party`).
- `PublicKragGrupyPage.test.tsx` guarantee "loads with NO auth token and never bounces to `/login`" **must keep passing** — an expired/invalid token on this route must degrade to anonymous, never 401 (`api/client.ts` redirects to `/login` on any 401; `get_current_principal` already returns `None` on expired tokens, so this holds as long as the route never uses `require_any`).
- `AUTHORIZATION_MATRIX` row `(_POST, r"^/api/groups/public/[^/]+/rsvp$", "PUBLIC")` — reference-only; update its comment, no enforcement change.
- `guardian_name` is currently required by `CreateRsvpRequest`; for the logged-in path the frontend can send the profile display name, so the schema need not change (confirm in spec).

### Data lifecycle — TermAttendance (RSVP)
| Operation | Backend | UI | User access | Status |
|---|---|---|---|---|
| CREATE (anonymous) | `create_rsvp` no principal | `RsvpDialog` | public link | ✅ works |
| CREATE (logged-in, attached) | **missing** | **missing** (no auth read) | public link | ❌ → ✅ after Thread 3 |
| READ (organizer) | `get_public_circle_view` returns `guardians[].display_name` | public per-term page guardian list | public link | ✅ |
| READ (the attendee, in-app) | no endpoint | **no "classes I'm attending" view anywhere** (`grep` for attendance/attend in `src/frontend` → 0 hits) | none | ❌ orphan — see decision D6 |

**Orphaned operation**: after the fix, a logged-in user can RSVP and the attendance is correctly attached — but there is **no screen in the app where they can see it**. Only the organizer sees them (in the public guardian list). CREATE without in-app READ for the attendee.

### User journey impact
| Dimension | Current | After | Assessment |
|---|---|---|---|
| Logged-in RSVP correctness | broken (detached profile) | attached to account | ✅ fixes the defect |
| Logged-in RSVP friction | asked for "Imię" despite being known | pre-filled confirmation | ✅ |
| Post-RSVP: "did it work?" | guest confirmation via localStorage | logged-in: needs a confirmation state; no persistent in-app record | ⚠️ D6 |

---

## Thread 4 — Genuine guest: soft account suggestion

### Current vs desired
| | Current | Desired (Q5) |
|---|---|---|
| After guest RSVP | confirmation view; `AccountMergeForm` is only rendered inline on a *needed item's* "Zgłoś się" CTA when a guest profile exists | after RSVP, surface a **visible but skippable** "załóż konto" suggestion reusing `AccountMergeForm` (`mergeAnonymousProfile` → `applyExternalToken` → `/panel`) |
| Forcing | not forced | not forced; RSVP already succeeded |

### Gaps
- **Missing**: a placement for the post-RSVP suggestion. `AccountMergeForm` exists and is the right primitive (email+password mini-form, not full `RegisterPage`). Decision D7: where it renders (inside `RsvpDialog` post-submit state, vs in the `PublicKragGrupyView` confirmation block).
- **Styling constraint**: this lives on the `.kg-*` `<style>`-string CSS page, not Tailwind — the suggestion UI must use `.kg-*` tokens (`AccountMergeForm` already does).

### Test impact
- `PublicKragGrupyPage.test.tsx`: add "guest sees account suggestion after RSVP, can ignore it, RSVP still recorded"; existing 409 inline-error path stays.

---

## Integration Points

**Backend**
- `app/groups/router.py` — `create_rsvp` route gains `Depends(get_current_principal)` (reuse existing) → `principal: Principal | None`.
- `app/groups/service.py` — `create_rsvp(..., principal=None)`; branch on `get_profile_by_principal` (from `app.users.service`, already imported pattern in `families/router.py`).
- `app/families/schemas.py` — `CreateLightweightMembersBatchRequest.family_name: str | None = Field(default=None, max_length=255)`.
- `app/families/service.py` — `create_lightweight_members_batch(db, guardian_party_id, members, family_name=None)`; pass `family_name or f"Rodzina {display_name}"` into existing `bootstrap_family_for_party`.
- `app/core/auth_deps.py` — optional named alias `OptionalPrincipal = Annotated[Principal | None, Depends(get_current_principal)]`; update `AUTHORIZATION_MATRIX` comment for the rsvp row.
- No Alembic migration (no schema change; `family_name` is a request field, `Family.name` column already exists).

**Frontend**
- `components/onboarding/steps/guestSteps.tsx` — reduce to `[items]`.
- `test/OnboardingWizard.test.tsx`, `test/OnboardingHandoff.test.tsx` — rewrite GUEST expectations.
- `pages/panel/PanelPage.tsx` — no-family branch in "rodzina" view; new `ModalKind`; modal block; open handler; `load({silent})` after submit.
- New `components/panel/CreateFamilyDialog.tsx` (mirror `FirstTermStepperGuest`; imports `ModalSheet`/`Field` from `PanelPage` per existing convention).
- `api/families.ts` — `createLightweightMembers(members, familyName?)` → body `{ members, family_name }`.
- `hooks/usePublicKragGrupy.ts` — stays anonymous-safe; auth read happens in the page/dialog (keep hook clean).
- `pages/krag/KragGrupyPage.tsx` (`PublicKragGrupyView`) — `useAuth()` read; logged-in confirmation path; guest path unchanged + post-RSVP suggestion.
- `components/krag/RsvpDialog.tsx` — logged-in variant (hide "Imię", prefill) or a sibling confirmation component; `.kg-*` styling.
- `api/groups.ts` — `RsvpResponse` may gain `attached_to_account?: boolean` so the page can skip guest-scoped localStorage / suggestion.
- `test/PanelPage.test.tsx`, `test/PublicKragGrupyPage.test.tsx` — new cases per threads above.

**Standards touchpoints**
- `standards/backend/security.md` — worth a new note: "public endpoints that optionally honour a session token: read via `get_current_principal`, never `require_any`; treat invalid/expired as anonymous, never 401" (raise with user post-implementation, per CLAUDE.md standards-evolution).
- `standards/frontend/components.md` — `PanelPage.tsx` near-circular import (steppers + new dialog import `ModalSheet`/`Field` from it); extracting a `components/panel/shared.tsx` is an opportunity, not in-scope.

---

## Issues Requiring Decisions (NEW — not covered by Q1–Q5)

### Critical (decide before spec)

**D1 — Persisted family name: which endpoint shape?**
Q3 explicitly left open "extend `POST /api/families/mine/members` **or** a dedicated create-family endpoint."
- Options: (A) add optional `family_name` to the existing batch request (shallow plumb: schema field → batch param → existing `bootstrap_family_for_party` arg; ~3 lines + tests). (B) new dedicated `POST /api/families/mine` create-family endpoint, members added separately.
- Recommendation: **(A)**. Smallest blast radius, the dialog already submits one batch, `bootstrap_family_for_party` already accepts a name. A dedicated endpoint duplicates bootstrap logic and adds a 2nd round trip from the dialog.
- Rationale: matches the existing "create own X, idempotent" service pattern; `POST /api/families` (the login-creating one) stays untouched.

**D2 — Family created with a name but zero members?**
The 2-step dialog collects a name (step 1) then members (step 2). Onboarding's old step 2 guarded `if (members.length === 0) return;` — so an empty member list created nothing. In the Panel dialog the user has explicitly named a family; do we bootstrap it with zero extra members (the caller is still added as primary-contact guardian by `bootstrap_family_for_party`)?
- Options: (A) yes — finishing step 1 + skipping step 2 creates a named, member-less family (caller is the sole guardian). (B) no — require ≥1 member; block "Zakończ" on step 2 until one is added.
- Recommendation: **(A)**. The user's goal ("I have a family") is satisfied by naming it; forcing a fake member is friction. `create_lightweight_members_batch` already bootstraps regardless of member count.
- Rationale: consistent with "don't burden the user" goal; the caller is always registered as primary contact.

### Important (decide during spec)

**D3 — Onboarding wizard chrome with a single step.**
`OnboardingWizard` renders step-dots + "Krok 1 z 1" + "Pomiń"/"Zakończ ✓" for one step, which reads oddly.
- Options: (A) leave as-is (1 dot, "Krok 1 z 1"). (B) hide the dot row + step counter when `steps.length === 1`. (C) drop wizard chrome for guests, render the items form bare with "Pomiń"/"Zakończ".
- Default: **(B)** — minimal change to the shared shell, keeps guest and organizer on the same component.

**D4 — Family name is now user-authored but not editable afterward.**
Once the dialog persists a name, there is no rename UI anywhere (Family UPDATE is a full orphan). Users who typo the name are stuck with it (pre-prod: DB edits possible, users can't).
- Options: (A) accept — out of scope, add a rename field later. (B) add a small inline "edit family name" affordance in "Mój dom" (needs a `PATCH /api/families/{id}` — new endpoint + service + test).
- Default: **(A)** — keep this task minimal; flag `PATCH /api/families/{id}` as a follow-up. Note in spec so it's a conscious choice.

**D5 — Logged-in RSVP: how does the "already signed up" state persist on reload?**
Guest flow gates the confirmation purely on `localStorage[guest_profile_id:groupId:termId]`. For a logged-in user, Q4 says return the existing `user_profile_id`.
- Options: (A) also write the localStorage key for logged-in users (cheap, keeps one code path; but it's a device-local signal, not real state). (B) `RsvpResponse.attached_to_account` + the public GET already returns `guardians[].display_name` — derive "you're signed up" by matching the logged-in display name / party against the returned guardians (real server state, survives device change).
- Default: **(A)** for this task (matches existing pattern, lowest risk); note (B) as the more correct long-term approach.

**D6 — Attendee has no in-app view of classes they signed up for (orphaned READ).**
After Thread 3, a logged-in user's RSVP is correctly attached but invisible to them in the app (`grep` confirms zero attendance-related UI). Only the organizer sees them.
- Options: (A) accept — out of scope; the confirmation screen on the public page is the only feedback. (B) add a minimal "Zapisane zajęcia" list to the Panel (new read endpoint `GET /api/groups/mine/attendances` + a Panel section).
- Recommendation: **(A)** for scope control, but this is a genuine user-journey gap the orchestrator should surface to the user explicitly — a user who signs up for a class and later opens the app has no way to confirm or find it. If the product intent is that logged-in RSVP is a real feature (not just "not a bug"), (B) is warranted.
- Rationale: Q4's scope note ("attaches attendance only — keep minimal") leans (A), but the user should confirm they're OK with the invisibility.

**D7 — Placement of the guest account suggestion.**
Q5 says "refine copy/placement."
- Options: (A) a post-submit state inside `RsvpDialog` (replaces the form with "Zapisano! Chcesz zachować dostęp? Załóż konto" + `AccountMergeForm` + "Może później" closing the dialog). (B) render it in the `PublicKragGrupyView` confirmation block after the dialog closes.
- Default: **(A)** — keeps the flow in one surface, `onSubmitted` already fires; "Może później" / ✕ is the skip.

---

## Recommendations
1. Do Thread 3 backend first (route + service + `test_rsvp.py` split) — highest risk, unblocks frontend RSVP work, and `get_current_principal` already existing makes it smaller than the codebase analysis implied.
2. Thread 1 is a 1-file deletion + 2 test rewrites — do it early to de-risk the test suite.
3. Thread 2 backend change is ~3 lines + test; the dialog is a near-copy of `FirstTermStepperGuest` — treat as one unit.
4. Keep the genuine-guest RSVP path byte-for-byte unchanged except for the added (skippable) suggestion; the `PublicKragGrupyPage.test.tsx` "never bounce to /login" test is the guardrail.
5. Surface D1, D2 (blocking) and D6 (user-journey) to the user before spec; D3/D4/D5/D7 can be resolved inside the spec with the defaults above.

## Risk Assessment
- **Complexity Risk**: Medium — `PanelPage.tsx` (1612 LOC, ~30 `useState`, near-circular stepper coupling) is the largest single edit target; new dialog should live in `components/panel/`.
- **Integration Risk**: Medium-High — the RSVP route gains a conditional trusted branch on an intentionally-anonymous public endpoint; cross-context call `groups.service → users.service.get_profile_by_principal`.
- **Regression Risk**: Medium — `test_rsvp.py` `account_user_id is None` assertion, the "public page never redirects to /login" guarantee, and 4 onboarding/panel test files need updates. No data migration; pre-production removes backward-compat burden.
