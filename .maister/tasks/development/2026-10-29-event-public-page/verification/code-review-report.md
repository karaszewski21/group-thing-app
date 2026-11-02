# Code Review Report

## TL;DR
- No critical issues. Authorization matrix rows, the anonymous sign-up path, chat access after withdraw, public payload exposure and query counts all match the spec.
- One confirmed bug: an event name containing a backslash (e.g. `Swap \o/`) makes the new OG preview route return 500. That route also serves the SPA shell, so the whole event page breaks on direct load or refresh.
- Performance: `events.author_party_id` and `event_attendances.party_id` have no index, yet both are now read on every inbox load and on every 20 s unread-count poll.
- Smaller items: lock held across the moderation call, stale guest state across `eventId` changes, and a KeyError if the author's profile can't be found.

## Key Decisions
- Anonymous sign-ups are unthrottled. This is an accepted spec risk, so it is not counted as a finding.
- `party_id` on public participants is allowed by the spec (it is needed for `is_me` and list keys). No email or account id is exposed. Guest names go through `PROFILE_NAME` moderation.

## Open Questions / Risks
- The old `/events/:eventId` route was removed with no redirect. Any links shared before this change now fall through to the SPA catch-all.
- Item links on the public page point to item pages that need a login. Anonymous visitors will hit the auth wall (per memory, this login-only rule is intended).

**Date**: 2026-10-30
**Path**: uncommitted working tree of `group-thing-app` (47 modified + 16 untracked files, `.maister/` excluded)
**Scope**: all (quality, security, performance, best practices)
**Status**: ⚠️ Issues Found

## Summary
- **Critical**: 0 issues
- **Warnings**: 4 issues
- **Info**: 8 issues

## Critical Issues
None.

## Warnings

### W1. A backslash in the event name crashes the event preview/SPA route (500)
- **Location**: `src/backend/app/system/public_preview.py:56` (`_TITLE_TAG_PATTERN.sub(f"<title>{safe_title}</title>", ...)`), now reached through `render_public_event_meta` (`public_preview.py:77-85`) and `app/system/router.py:119-139`.
- **Description**: `re.sub` treats its replacement string as a template. `html.escape` does not escape `\`. An event name such as `Swap \o/` raises `re.error: bad escape \o`, and `a\1b` raises `invalid group reference`. Both were reproduced locally. `\t`/`\n` are silently turned into control characters. `_validate_name` (`app/events/service.py:121`) accepts backslashes. `GET /<slug>/event/<id>` serves the SPA `index.html` to browsers too, so a direct load or refresh of that event's page returns 500 for every visitor, not just link-unfurling bots. The helper already existed, but event names are a new, freely editable input to it.
- **Recommendation**: Use a callable replacement, `_TITLE_TAG_PATTERN.sub(lambda _: f"<title>{safe_title}</title>", document, count=1)`, or escape it with `.replace("\\", "\\\\")`. Add a `test_public_preview.py` case with a backslash in the name.
- **Fixable**: true

### W2. Missing indexes on the party-side lookups now hit by every unread poll
- **Location**: `src/backend/app/events/models.py:36-40` (`events.author_party_id`, no index) and `models.py:108-117` (`event_attendances` indexes lead with `event_id` only). Queried by `app/events/service.py` `list_chat_event_ids_for_party` (UNION of `author_party_id = ?` and `party_id = ? AND withdrawn_at IS NULL`), `list_attending_events` and `list_my_events`.
- **Description**: `messaging/application/inbox.py:count_unread` now calls `list_chat_event_ids_for_party` on every `/api/conversations/unread-count`. The frontend polls that every 20 s per open tab (`useUnreadMessages.ts:8`). Without an index on `party_id`, each side of the UNION is a sequential scan, so the cost grows with total events and sign-ups rather than with the caller's own.
- **Recommendation**: Add a migration (or extend 0071) with `ix_events_author_party_id` and `ix_event_attendances_party_id` (optionally partial: `WHERE withdrawn_at IS NULL`).
- **Fixable**: true

### W3. Guest sign-up holds the event `FOR SHARE` lock and the transaction open across text moderation
- **Location**: `src/backend/app/events/service.py:384-421` (`sign_up`: `db.get(..., with_for_update={"read": True})` comes before `await check_text(TextField.PROFILE_NAME, name)`).
- **Description**: The row lock is taken first, then the moderation call runs (possibly a model call or network round trip). While it runs, a concurrent `PATCH`/`DELETE` by the author (both take `FOR UPDATE`) blocks, and a DB connection stays checked out. With unthrottled anonymous sign-ups, a burst of guest sign-ups can stall author edits and drain the pool.
- **Recommendation**: Validate and moderate the guest name before taking the lock: call `_validate_guest_name` + `check_text` first, then `db.get(... FOR SHARE)` and re-check `has_ended`. The validation order (ended → name) changes only for invalid names on ended events. Document it if the spec's rule order matters.
- **Fixable**: true

### W4. `useEventSignUp` keeps one event's guest state after navigating to another event
- **Location**: `src/frontend/src/pages/events/hooks/useEventSignUp.ts:20-22`
- **Description**: `guestProfileId` is read from localStorage only in the `useState` initializer. React Router reuses the same `EventPage` instance when only `:eventId` changes (back/forward between two event pages, or a link from one event to another). Event B would then show event A's `guestAttendee` merge card, or the reverse, and `sheetOpen`/`confirmingWithdraw` carry over too. It is also not re-read after logout, though that case is harmless today.
- **Recommendation**: Key the route element on `eventId` (e.g. a small wrapper `<EventPage key={eventId} />`), or derive `guestProfileId` from `[eventId, isLoggedIn]` with state reset on change. Add a test that rerenders with a different `eventId`.
- **Fixable**: true

## Informational

### I1. KeyError → 500 if the author's profile can't be resolved
- **Location**: `src/backend/app/events/page.py:111-113` (`names[author_party_id][0]`).
- Attendees with no profile are skipped (`if party_id in names`), but the author is indexed directly. If the author profile is missing, for example after account deletion or data repair, the public page returns 500. Suggestion: fall back to `names.get(author_party_id, ("", False))[0]` or a placeholder label. Fixable: true.

### I2. The OG description embeds the full 2000-character event description
- **Location**: `src/backend/app/system/public_preview.py:80-85`.
- It is escaped correctly (`html.escape` with `quote=True` covers attribute context), so there is no XSS. But unfurlers truncate at roughly 200–300 characters and the meta tags get bulky. Suggestion: truncate to about 200 characters with an ellipsis. Fixable: true.

### I3. The IntegrityError re-select path has no test
- **Location**: `src/backend/app/events/service.py:401-410`; `tests/test_event_attendance.py` has no concurrency or IntegrityError case.
- The savepoint plus re-select logic is right, but nothing exercises it. Suggestion: add one test that pre-inserts the active row between the find and the insert (monkeypatch `_find_active_attendance` to return `None` once). Fixable: true.

### I4. A logged-in client whose token went invalid gets a confusing 400
- **Location**: `src/backend/app/events/service.py:395-415` and `src/frontend/src/pages/events/hooks/useEventSignUp.ts:27-38`.
- The backend treats an invalid or expired token as a guest. The frontend still thinks it is logged in and sends `guest_name: null`, so the user sees "Podaj swoje imię." Rare, since auth refresh normally handles it. Suggestion: if the server reports a blank guest name while `isLoggedIn`, show a re-login hint. Fixable: false (UX decision).

### I5. Event chat access does not depend on the event's date (intended)
- **Location**: `src/backend/app/messaging/application/access.py:79-89`.
- After withdrawing, access is re-checked on every request, so a withdrawn attendee correctly gets 403, and the inbox/unread audience drops them. Noted only so reviewers know an ended event's chat stays writable by design. Fixable: false.

### I6. Migration 0071 re-creates the FKs with full validation under an ACCESS EXCLUSIVE lock
- **Location**: `src/backend/alembic/versions/0071_event_conversations.py:34-39, 63`.
- Dropping and re-adding `fk_messages_conversation_id_conversations` validates every `messages` row while the table is locked. This is fine at the current data size. At scale, use `postgresql_not_valid=True` followed by `VALIDATE CONSTRAINT`. The downgrade order is correct: EVENT conversations are deleted while the cascades still exist, then the FKs are restored, then the indexes, FK and column are dropped. Fixable: true.

### I7. The guest name input has no `maxLength`
- **Location**: `src/frontend/src/pages/events/components/EventGuestSignUpSheet.tsx:52-60`.
- The server limits names to 255 characters (`GUEST_NAME_MAX_LENGTH`). Suggestion: add `maxLength={255}` so the client gives early feedback (validation standard: client-side feedback). Fixable: true.

### I8. Old `/events/:eventId` links no longer resolve
- **Location**: `src/frontend/src/router.tsx` (route removed at the old lines 157-162); `utils/appHelpers.ts:99-102`.
- If any event links were shared before this change, add a small redirect route that loads the event and replaces the URL with `eventPath(author_slug, id)`. If the old route never shipped, ignore this. Fixable: true.

## Verified OK (focus areas)
- **Authorization matrix** (`app/core/authorization_matrix.py:201-211`, first match wins): `GET /mine|/attending` comes before the PUBLIC `GET /{id}`. `POST /attendances` is PUBLIC and its `$`-anchored pattern does not swallow `/attendances/withdraw`, which needs EDIT/mcp:edit. `POST /api/conversations/event` falls under the existing logged-in-only conversation rows.
- **Anonymous sign-up**: the author is refused (409), an ended event is refused (409), and attaching a logged-in user is idempotent via the partial unique index plus savepoint and re-select. `FOR SHARE` serializes against `delete_event`'s `FOR UPDATE`, and deletion is refused while there are active sign-ups.
- **Public payload**: only display names, the org name and colors, `party_id`, and items (product name, mode, thumbnail). No email, account id or profile id of others. `user_profile_id` goes only to the guest who signed up.
- **XSS**: the OG tags use `html.escape` for title, description and image URL (attribute-safe). React renders the description and names as text.
- **N+1**: the event page uses a fixed number of statements (one items join plus one photo batch). List endpoints batch locations and org slugs, the inbox adds one event-refs batch, and the unread count adds one UNION. `count_queries` tests exist in `test_event_page.py` and `test_events.py`.
- **React**: `useEvent` follows the `forToken`/`isStale` pattern from the data-fetching standard, mutations await invalidation of their prefixes, the view is resolved in a pure `resolveEventView` with a `switch` on `view.kind`, and the guest sheet uses `ModalSheet` with `aria-invalid`/`aria-describedby`/`role="alert"`.

## Metrics
- Max function length: ~85 lines (`EventPage` render switch, `EventPage.tsx:38-166`); backend max ~75 lines (`page.get_event_page`).
- Max nesting depth: 4 (`service.sign_up`).
- Potential vulnerabilities: 0 exploitable. 1 availability bug (W1).
- N+1 query risks: 0. Missing-index risk: 1 (W2).

## Prioritized Recommendations
1. Fix the `re.sub` replacement in `_inject` (W1) and add a backslash test.
2. Add `party_id`/`author_party_id` indexes (W2).
3. Move guest-name validation and moderation ahead of the `FOR SHARE` lock (W3).
4. Reset the event page's guest/sheet state when `eventId` changes (W4).
5. Optional: the I1, I2, I3 and I7 hardening items.
