# Notifications infra — frontend bell, pending-actions modal, polling

Paths relative to `src/frontend/src/`. Verified 2026-10-13.

## 1. API client

`api/notifications.ts:3-17` mirrors the 14 kinds; `NotificationResponse` `:19-43`; calls `getMyNotifications` `:45-47`, `getUnreadCount` `:49-51` (**defined but not imported anywhere** — grep shows no consumer), `markNotificationRead` `:53-55`, `markAllNotificationsRead` `:57-59`.

## 2. `useNotifications` hook — NO polling

`hooks/useNotifications.ts:33-83`:
```ts
const queryKey = [...NOTIFICATIONS_KEY, username] as const;
const query = useQuery({ queryKey, queryFn: getMyNotifications, enabled: token !== null });
```
(`:36-37`). **No `refetchInterval`**, no `staleTime`. The shared client sets only `retry` (`api/queryClient.ts:13-17`). So freshness relies on TanStack Query v5 defaults: refetch on mount, on window focus, on reconnect. A user who keeps the tab open but unfocused/idle, or never opens the app, sees nothing new. `refetchInterval` is used elsewhere in the app (`hooks/useItemDetail.ts:51`, `hooks/useMyOrganization.ts:49`), so a polling precedent exists; the Panel also polls items every 10 s only while photos are in moderation (`pages/panel/PanelDataContext.tsx:285`, `:678-704`, visibility-aware).

- `markRead` is optimistic + fire-and-forget (`useNotifications.ts:54-62`); `markAllRead` optimistic with invalidate on failure (`:64-71`).
- `unreadCount` is computed client-side from the ≤50 fetched rows (`:76`), not from `/unread-count`.

**Confidence**: High (100%).

## 3. `NotificationBell`

`components/shared/NotificationBell.tsx:11-85`, rendered in `components/layout/PublicLayout.tsx` (import `:5`) — top account bar on every page there.
- Badge shows unread count, caps at "9+" (`:31-35`).
- Opening an entry **marks it read and navigates** to `link_path` (`:16-20`).
- "Oznacz jako przeczytane" marks all read (`:52-59`).
- Entries show only `message`; **no timestamp, no grouping, no kind icon** (`:64-77`).
- No browser `Notification` API, no title-badge, no sound.

## 4. Global pending-actions modal (Panel only)

Defined in `pages/panel/PanelDataContext.tsx`; mounted by `PanelDataProvider` (`:1709-1717`), which wraps only `PanelPage` (`pages/panel/PanelPage.tsx:33-35`). Docstring says "global" but it appears **only on `/panel/*` routes** (`:1543-1548`).

Derivation (`:733-776`): from **unread** notifications only (`.filter((n) => n.read_at === null)` `:736`) of kinds `SWAP_PROPOSED` and `TERM_CONFIRMATION_NEEDED`, plus server-sourced pending join requests (`:762-773`). Shows one at a time, `pendingActions[0]` (`:1558`).

Behaviour that matters for "forgetting":
- `TERM_CONFIRMATION_NEEDED` sheet: **"Potwierdź"** → `confirmPendingAction` (`:804-858`, calls `confirmTransaction`); **"Później"** and ✕ both call `dismissPendingAction` (`:1567`, `:1595-1601`) which **marks the notification read on the server** (`:782-790`) → the prompt never comes back. "Później" is effectively "never".
- Contrast: join requests' "Później" is session-only, server state untouched (`:860-870`), and they are sourced from a server list so they persist until decided (`:148-150`). This is the existing precedent for "actionable item persists independent of read state".
- `SWAP_PROPOSED` sheet only links to "Moje rzeczy" (`:1603-1624`, `:798-802`).
- Clicking the same notification in the bell first also marks it read → the modal prompt silently disappears (shared cache, `useNotifications.ts:25-31` docstring).
- `termId` for confirm is regex-parsed from `link_path` (`:164-170`); reservation resolved client-side when `reservation_id` null (`:193-…`).
- **Kinds that are NOT actionable**: `ITEM_RESERVED_FOR_PICKUP`, `TERM_ITEM_LISTING_TAKEN`, `SWAP_ACCEPTED` — bell-only, so the pre-Term "bring/pick up" information exists only as a one-shot bell entry.
- Panel reloads (incl. notifications invalidate `:584`) on mount and on re-entry to `/panel/*` (`:632-660`).

**Confidence**: High (95%).

## 5. No other surfaces

grep in `src/` and `index.html` for `serviceWorker|manifest|Notification.requestPermission|PushManager|workbox|vite-plugin-pwa|.ics|text/calendar|BEGIN:VCALENDAR|calendar.google` → only plugin-manifest code (`api/plugins.ts:24-41`, `pages/PluginFormPage.tsx`), i.e. **no PWA, no web push, no calendar export** in the frontend.

Auth token is stored in `localStorage` (`auth/AuthContext.tsx:59,90`) with JWT default expiry 1 h (`JWT_EXPIRATION_MS` default 3 600 000 in `docker-compose.yml` backend env and `app/config.py:27`) — relevant if a service worker ever needs to call the API in the background (it can't read localStorage; push payloads would need to be self-contained).
