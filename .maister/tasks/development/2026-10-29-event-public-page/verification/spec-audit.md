# Spec Audit: Public event page (Term-style)

> Written by the orchestrator verbatim from the spec-auditor's returned report (the auditor did not write files).

## TL;DR
**Verdict: pass-with-concerns.** 0 critical, 0 high, 5 medium, 10 low.
Code claims verified: FK names in 0061, 0070 head, matrix ordering, router order, every messaging kind switch, named helpers. Covers every binding decision and all 7 mockups.
Main issue: the post-create toast can't survive navigation (AppDataProvider unmounts). Gaps: `test_messaging_migration.py` will break; `useEvent` token-in-key departs from data-fetching standard; `/attending` does per-author queries.

## Key Decisions
- Nothing above medium: every gap is a one-line fix or a test/UX-feedback regression.
- Not using AuthGateSheet/useAccountGate is low: binding mockup `screen:event-anonymous` wins, reason stated.
- `party_id` in public participants payload allowed (requirements.md:44; Term's PublicGuardianResponse does the same).

## Open Questions / Risks
- Anonymous footer copy: mockups disagree (`empty-participants-state.html` "Zaloguj się, żeby się zapisać" vs `anonymous-visitor-view.html` "＋ Zapisz się na wydarzenie").
- Gendered copy "Jesteś zapisana jako gość ✓" needs sign-off.
- Guest key TTL 1h (`api/groups.ts:297`): returning guest can sign up again creating a second guest party (same as Term).

## Verified claims
- 0070 revises 0069 (`alembic/versions/0070_events.py:25-26`)
- messages/conversation_reads conversation FKs have no ON DELETE (`0061_messaging.py:108-112,132-136`); no other table references conversations.id
- kind String(10) non-native, no CHECK
- Kind switches: `access.py:83-93`, `conversations.py:183-208`, `inbox.py:63-66,93-108`, `repository.py:195-218,245-291` — all named in spec; `messages.py` needs no change
- Matrix: events block `authorization_matrix.py:201-208`; new POSTs currently fall to AUTHENTICATED catch-all; row 54 (:221) covers /api/conversations/event; row 10 (:56) covers OG route
- router.tsx: /events/:eventId at 157-162, edit at 149-152, term at 208-211; no catch-all/errorElement
- Backend helpers exist (available_items_with_product_select, _exchange_candidates, first_approved_photo_by_product, list_chat_profiles_by_party_ids, get_own_organization, create_rsvp, withdraw_attendance, _insert_or_reselect, public_term_preview, clock.format_term_when); guest merge keeps party
- Frontend exports exist (uiStyles, ConfirmDeleteDialog tone/busyLabel, ModalSheet, writeGuestProfile/readValidGuestProfile, authPath, buildMapsUrl, SafeImage, organizerItemPath, OrganizerThemeScope, ListingMode); InboxPage/ThreadPage/useOpenConversation kind maps covered

## Findings

### M1 — Post-create toast lost on navigation to event page (Medium)
`showToast` from `useAppData()` (`EventCreateView.tsx:23,35`) lives in AppDataProvider mounted only in AppPage (`AppPage.tsx:54`); the event route renders outside it. Tests `AppPage.test.tsx:2928-2948, :2983` assert `/add` + toast.
Fix: pass toast via `navigate(path,{state:{toast}})` and show it in EventPage via its own `useToast`, or drop the claim; rewrite the three AppPage create-flow tests.

### M2 — `test_messaging_migration.py` exact FK set breaks (Medium)
`tests/test_messaging_migration.py:29-35,119-127` asserts exactly 5 conversation FKs; 0071 adds a 6th. Fix: update `CONVERSATION_FKS` (or assert subset) in the migration task group.

### M3 — Binding mockups conflict on anonymous footer (Medium, clarification)
`empty-participants-state.html` and INDEX.md:15 include a "Zaloguj się" variant; spec uses "＋ Zapisz się na wydarzenie" everywhere. Needs sign-off; optionally add login variant/secondary link.

### M4 — `useEvent` keeps token in query key, against data-fetching standard (Medium)
`standards/frontend/data-fetching.md:43`; current `hooks/useEvent.ts:27`. Placeholder side effects: after in-page merge, brief visitor view with one-click footer and merge card disappears; on logout, edit/delete stay visible until refetch. Fix: follow `forToken`/`isStale` pattern with resolveEventView `isStale` input + it.each rows, or document an exception.

### M5 — `/api/events/attending` 2 queries per distinct author (Medium)
`organizations/service.py:77-94`; `standards/backend/models.md:135`. Fix: batched `get_own_organizations_by_party_ids` in organizations service via `organizations_acl`; `count_queries` test 1 vs 3 authors; reuse the detail author org lookup for author_slug.

### L1 — ACL wording contradicts existing events imports (moderation/outbox/storage/users). Reword to business contexts; move AVATAR_UPLOAD_DISABLED_MESSAGE behind users_acl.
### L2 — `users_acl.create_guest_profile` spans party/users/families; document as a "guest identity" facade or split ACLs.
### L3 — Sign-up racing delete → FK IntegrityError → 500. Load event FOR SHARE or map FK error to EventNotFound.
### L4 — Partial unique index can't serve FK cascade lookup; optionally add plain `ix_conversations_event_id`.
### L5 — `EventAttendance` docstring "Nothing reads or writes it yet" (`events/models.py:95-96`) becomes stale.
### L6 — Header chip links to a 404 for `k-…` slugs; pass organizerSlug only when organization !== null.
### L7 — Withdraw should also invalidate CONVERSATIONS_KEY.
### L8 — `MeetingsView.tsx:197` empty text is Term-specific; add `/api/conversations/event` to `test_authorization_matrix.py:91-110`.
### L9 — Expired token on sign-up → anonymous branch → 400 "Podaj swoje imię."; optionally 401 when Authorization header present, or document.
### L10 — OG route `/{slug}/event/{id}` matches reserved first segments (e.g. /api); optionally guard via RESERVED_SLUGS.

## Recommendations (ordered)
1. M1 toast handover + AppPage tests  2. M2 migration test  3. M5 batched org lookup  4. M4 token pattern  5. M3 footer sign-off  6. Fold L1–L10 into task groups.
