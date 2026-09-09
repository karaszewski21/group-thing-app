# Phase 1 — Clarifications

Date: 2026-09-09

## Q1 — Guest onboarding after simplification
**Decision:** Keep the wizard, reduced to **1 step** ("Co chcesz oddać, wymienić lub wypożyczyć?" / add items).
Family is NOT created during onboarding. Family name step + members step are removed from `guestSteps`.

## Q2 — "Create family" moved to the Panel — the no-family state
**Decision:** Empty state inside the **"Mój dom" (rodzina) view**. Entering "Mój dom" with no family
shows a card ("Nie masz jeszcze rodziny") with a button that opens a **2-step dialog**:
- Step 1: family name
- Step 2: members (name + role GUARDIAN/CHILD, draft list) — same UX as the removed onboarding steps.
Not a full-panel 404 route — just the section empty state.

## Q3 — Persist the typed family name
**Decision:** **Yes — persist it (backend change).** The bootstrap-on-first-member path currently
discards the typed name and auto-names `f"Rodzina {display_name}"`. Backend must accept an optional
family name (extend `POST /api/families/mine/members` request, or a dedicated create-family endpoint)
and use it when bootstrapping the family. Auto-name remains the fallback when no name supplied.

## Q4 — Logged-in user signing up for a class (temp-account bug)
**Decision:** **Option A** — single RSVP endpoint reads an **optional** bearer token.
- New soft auth dependency (`get_optional_principal` or equivalent) that returns `None` on missing/invalid/expired
  token and **never raises 401** (client.ts redirects to /login on 401; public page must never bounce).
- `create_rsvp` gains an optional `principal`. When present + valid: resolve the caller's `UserProfile`
  via `get_profile_by_principal`, attach `TermAttendance` to that existing party, do **not** create a new
  `Party`/`UserProfile`. Return the existing `user_profile_id`.
- When absent/invalid: current anonymous behaviour (new `Party` + `UserProfile(account_user_id=None)` + `TermAttendance`).
- Frontend public per-term page: when logged in, show a confirmation pre-filled from the profile instead of
  asking for "Imię"; still allow entering child count.
- **Scope note (defer to spec):** logged-in RSVP attaches attendance only — no automatic family/circle
  membership. Keep minimal.

## Q5 — Guest (no account) signing up for a class
**Decision (from task description, not disputed):** After a guest RSVP, **suggest** creating an account
(existing `AccountMergeForm` upgrade path) but **do not force it**. RSVP succeeds without an account.
Refine copy/placement so the suggestion is visible but skippable.
