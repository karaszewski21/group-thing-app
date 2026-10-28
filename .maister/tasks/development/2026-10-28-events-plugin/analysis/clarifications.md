# Clarifications (Phase 1)

## TL;DR
Events get a host-native `app/events` backend module (own table, `/api/events`); the `events` plugin UI runs in an iframe on `/add/event` and calls the API via `hostApp.fetch`. Banner upload goes through a new SDK `uploadImage` message (host builds FormData). Scope: create only. No banner moderation for now.

## Key Decisions
- Storage: new `app/events` module (owner, text moderation of description, Warsaw dates) — not `plugin_objects`, which has no owner and no moderation.
- Banner transport: new SDK message `uploadImage` — plugin posts a File via postMessage, host builds FormData and calls the upload endpoint (pattern: avatar / organization COVER).
- Scope: create-only form on `/add/event`, save, return to `/add`. List/detail view is a follow-up.
- Moderation: no banner moderation in this task — the banner is public immediately.

## Open Questions / Risks
- The banner becomes the first user image without moderation (conscious user decision); add a follow-up to wire in ModerationSubjectType + the group-thing-ai cron.

## Q&A
1. Storage → "Moduł app/events (Rekom.)"
2. Banner → "Nowa wiad. SDK uploadImage (Rekom.)"
3. Scope → "Tylko tworzenie (Rekom.)"
4. Banner moderation → "Bez moderacji na razie"
