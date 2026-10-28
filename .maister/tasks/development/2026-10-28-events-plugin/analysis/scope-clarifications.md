# Scope Clarifications (Phase 2)

## TL;DR
Create-only events: `app/events` (migration 0070, `/api/events`, `event_banners` 1:1), plugin `plugins/events` in an iframe on `/add/event`, located via the new extension point `add.event`. Location from the Locations module. Banner optional, ≤5 MB, uploaded after the event is created. Any logged-in user can create. Name and description go through `check_text`.

## Key Decisions
- After save: confirmation built from the POST response + `done` message → host returns to `/add` with a toast; list/detail is a follow-up.
- Upload flow: POST /api/events (JSON) → then `uploadImage` → POST /api/events/{id}/banner; an upload failure = retry in the plugin.
- Registration: manual (curl PUT manifest per plugins/CLAUDE.md) + a Polish fallback "plugin niedostępny" when the plugin is missing/disabled; prod hosting = known gap.
- Banner optional.
- Locating the plugin: new extension point `add.event` (manifest slot; the host looks for the plugin with that slot) — requires widening `ExtensionPointType`, `CONTEXT_TYPE_PREFIX`, and a resolver in PluginContext, plus a provider/handler for the panel.
- Iframe height: fixed min-height (like PluginPageRoute) — no resize message.
- Navigation: narrow `done` message → host `viewPath('add')` + toast.
- Dates: `starts_at` + optional `ends_at` (full naive Warsaw datetimes); UI defaults the end to the same day; start not in the past (`clock.local_now()`); end > start.
- Permissions: any logged-in user (EDIT).
- Styling: the plugin ships its own CSS mirroring host tokens from `src/index.css`.
- Location: `location_id` from the Locations module (like Term) — the plugin needs its own picker/form calling `/api/locations` via `hostApp.fetch` (the host's `LocationAddForm` is not available inside the iframe).
- Banner: `event_banners` table 1:1 (avatar-like, with a status column for future moderation).
- Banner limit: 5 MB (backend rejects with a Polish message, plugin checks before sending); SDK timeout stays at 10 s.
- EntityId bug (app/plugin/router.py:39): separate follow-up.
- Text moderation: new TextField EVENT_NAME + EVENT_DESCRIPTION.
- Moderation of the banner image: none (Phase 1 decision).

## Open Questions / Risks
- Location in the iframe: the plugin must implement location selection/creation itself (or a simplified version: pick from my locations + add) — design in the spec.
- 10 s timeout with 5 MB on a slow connection may produce a false error even though the upload succeeded.
- Unmoderated public banner; plugin prod hosting — follow-ups.

## Follow-ups
- Event list/detail view (Meetings / organizer page).
- Banner moderation (ModerationSubjectType + group-thing-ai cron).
- Plugin hosting/registration in prod.
- EntityId int→UUID fix in app/plugin/router.py:39.
