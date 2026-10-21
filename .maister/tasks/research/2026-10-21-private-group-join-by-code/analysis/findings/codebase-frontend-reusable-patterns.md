# Frontend findings — reusable shells, hook/query patterns, `?code=` handling (SQ2/SQ3/SQ5-UX)

**Category**: `codebase-frontend`
**Root**: `src/frontend/src/`
**Date**: 2026-10-21

---

## 1. Access resolution today (what `join_request` feeds) — SQ3

### 1.1 Data path
- `api/groups.getGroupAccess(groupId, termId)` → `GET /groups/public/{id}/access?term_id=` (`api/groups.ts` l.282-285) returns `{ group: PublicCircleResponse, access: GroupAccessDetails }` (l.277-280).
- `GroupAccessDetails` (l.262-272): `is_member`, `is_organizer`, `can_view_content`, `is_attending`, `join_request: JoinRequestSummary | null` where `JoinRequestSummary = { id, status: "PENDING" | "REJECTED" }` (l.469-472).
- `PublicCircleResponse` for PRIVATE comes back reduced: `term: null`, `guardians: []` (docstring l.219-221; test fixture `TermPage.test.tsx` l.517-523).

### 1.2 Resolution (`pages/krag/termAccess.ts`)
```ts
// l.17-25
export function resolveTermAccess(data: GroupAccessResponse, identified: boolean): TermAccess {
  const { group, access } = data;
  if (access.can_view_content) return { kind: "view", group, isAttending: access.is_attending };
  if (!identified) return { kind: "gate", group, gate: { kind: "loginRequired" } };
  const request = access.join_request;
  if (request?.status === "PENDING") return { kind: "gate", group, gate: { kind: "pending", requestId: request.id } };
  if (request?.status === "REJECTED") return { kind: "gate", group, gate: { kind: "rejected" } };
  return { kind: "gate", group, gate: { kind: "canRequest" } };
}
```
- `identified` is `state.forToken !== null` (`TermPage.tsx` l.21) — "was fetched with a token", not "has a token now" (docstring l.14-16).
- **Branches that survive join-by-code**: `view` (l.19) and `loginRequired` (l.20). Lines 21-24 collapse into a single `{ kind: "canEnterCode" }` (name TBD). The `TermAccess` union shape (`view` | `gate`) and `TermPage`'s dispatch (l.23-50) do not change.

### 1.3 `useTermAccess` (`hooks/useTermAccess.ts`) — KEEP verbatim
- Query key `["groupAccess", groupId, termId ?? null]` (l.43); token deliberately **not** in the key; `queryFn` stores `forToken` alongside data (l.44).
- Token change triggers `queryRefetch()` via a ref comparison (l.52-57); `isStale = state.forToken !== token` (l.72).
- `refetch(): Promise<void>` (l.48-50) is what a successful code redemption must `await` so the gate flips to the member view (same contract `RequestAccessDialog.onSubmitted` uses today: `PrivateGroupGate.tsx` l.213-218).
- `TermPage.tsx` l.37: while `isStale && refreshError === null` it shows the skeleton rather than a gate for the wrong token — keep this.

### 1.4 Gate shell (`pages/krag/PrivateGroupGate.tsx`) — pieces to keep
| Piece | Lines | Why keep |
|-------|-------|----------|
| `KragStage` with `overlay` slot for a bottom sheet | l.204-228 | Overlay slot already renders the dialog after content |
| `GroupHeader eyebrow="Krąg" title subtitle="Prowadzi: …" / "Brak organizatora"` with `onBack={() => navigate(-1)}` | l.229-234 | Same header the member view uses |
| `CARD` with `h2 ref={headingRef} tabIndex={-1}` "🔒 Ta grupa jest prywatna" | l.236-239 | Tests key on this heading (`TermPage.test.tsx` l.305-313, l.528-540); focus target after submit (l.216, l.222) |
| `<div role="status" aria-live="polite">` for the status line | l.240-246 | Where "Dołączono" / "Kod nieprawidłowy" live-region text could go |
| `stale` branch → `REFRESH_ERROR` alert + "Spróbuj ponownie" | l.131-139, l.14 | Token-change failure path; tested at `TermPage.test.tsx` l.710-731 |
| `refreshError !== null` alert | l.248-252 | Keep |
| `loginRequired` branch → `AuthGateLinks` (login/register with `?returnTo=pathname+search`) | l.140-151, `AuthGateSheet.tsx` l.7-10 | `?returnTo` already carries `location.search`, so a `?code=` survives login/registration round-trip — see §4 |
| `requestTriggerRef` + `closeDialog()` focus return | l.42, l.98-101 | Pattern for returning focus to the opener; `ModalSheet` does this itself (l.30, l.36-42), so a `ModalSheet`-based code sheet needs no manual ref |
| `BUTTON_STYLE`, `BODY_STYLE`, `BTN_PRIMARY`/`BTN_GHOST`/`BTN_SM`/`ERROR_TEXT`/`STATUS_LINE`/`CARD` from `kragStyles.ts` | l.12-13; `kragStyles.ts` l.5-19 | Term-page design tokens; `FIELD` (l.12-13) is the input class to use for a code input on the krag side |

Pieces to **drop**: `withdraw*` state and handler (l.47-50, l.79-91), focus/visibilitychange polling (l.52-67 — only meaningful while a request is pending), `createConflict` (l.45, l.160-164), `canRequest`/`pending`/`rejected` bodies (l.152-199), `canOpenDialog` (l.201).

---

## 2. Reusable UI shells for a "join by code" sheet (visitor side)

### 2.1 `components/krag/ModalSheet.tsx` — the preferred wrapper (accessibility standard says "prefer shared `components/krag/ModalSheet`")
- Props: `title`, `ariaLabel?`, `onClose`, `registerAsPageSheet = true`, `children` (l.16-28).
- Does for free: `useRegisterOpenSheet(registerAsPageSheet)` (l.31), focus into dialog on open (l.33-35), focus back to opener or `main` on close (l.36-42), Tab trap (l.46-49), Esc close unless `defaultPrevented` (l.50-53), scrim click close (l.56-59), `role="dialog" aria-modal="true" aria-label` (l.62-64), centered on ≥520px (l.57, l.68).
- Styling: Tailwind tokens only (`bg-scrim`, `bg-paper`, `text-ink`), `font-serif` title (l.71), ✕ button `aria-label="Zamknij"` (l.72-78).
- Contrast with `RequestAccessDialog.tsx`, which hand-rolls the same chrome with inline styles and `var(--color-*)` (l.72-117) and its own `document` keydown listener (l.44-51). The new sheet should **not** copy that; use `ModalSheet`.
- Precedent for a `ModalSheet` with a form inside and the Esc-vs-listbox rule: `components/shared/LocationAddForm.tsx` (inline combobox; standard cites it) and `AuthGateSheet.tsx` l.55-74 (simplest `ModalSheet` consumer: `<p>` + links).

### 2.2 Input/field primitives
- Krag side: `FIELD` class in `kragStyles.ts` l.12-13 (`rounded-xl border-[1.5px] border-line bg-cream … focus:border-focus-ring`).
- Panel side: `Field` + `INPUT_CLASS` in `pages/panel/panelComponents.tsx` l.159-168; `CapacityField` l.174-208 is the canonical **constrained text input** per `validation.md`: `type="text" inputMode="numeric" pattern="[0-9]*"`, `aria-invalid={invalid || undefined}`, `aria-describedby={invalid ? errorId : undefined}`, inline `<p id={errorId} role="alert">` (l.189-206). A code input should mirror this shape with `inputMode="text"`/`autoCapitalize="characters"`, `autoComplete="one-time-code"` (no precedent in repo — only `autoComplete="email"/"current-password"/"new-password"` in `LoginPage.tsx` l.41/56, `RegisterPage.tsx` l.78/93), and `aria-invalid`/`role="alert"` on a 4xx.
- Error copy helper: `serverMessageOr(err, fallback)` (`api/problem.ts` l.67-79) — returns the backend's Polish `message` for 400/409/503, a fixed `ACCESS_DENIED_MESSAGE` for 403 (l.59-60), else the fallback. `extractProblemMessage` (l.40-57) for query errors. `hasStatus(err, 404)` (l.36-38).
- Busy state convention: `disabled={busy} aria-busy={busy}` and "…" suffixed label while in flight (`RequestAccessDialog.tsx` l.134-138; `PrivateGroupGate.tsx` l.121-125; `PendingActionsHost.tsx` l.353-357).

### 2.3 Toast
- `pages/krag/hooks/useToast.ts` (l.6-16): `{ toast, showToast }`, self-clears after 2600 ms. Rendered as a fixed pill with `role="status"` (`PendingActionsHost.tsx` l.222-229; `ShareButton.tsx` l.49-55). On the term page, `PublicTermView` owns its own toast; the gate can render one in `KragStage`'s `overlay`.

### 2.4 Where the submit lands
- On success: `await refetch()` from `useTermAccess` → `resolveTermAccess` returns `view` because the backend now reports `is_member: true` / `can_view_content: true` (`TermPage.test.tsx` l.694-708 shows this flip today via visibilitychange refetch). No client-side membership state is needed.
- Backend errors to map (frontend side only; backend gatherer defines exact codes): wrong/expired code (likely 404/409/422 → inline alert, keep sheet open — mirrors `RequestAccessDialog` "non-409 keeps the dialog open with an alert" at l.67, tested `TermPage.test.tsx` l.680-692), already a member (409 → close sheet + `refetch()` — mirrors `onConflict` l.63-66 / `PrivateGroupGate.tsx` l.219-224), 429 (new; show the server message and disable submit until retry).

---

## 3. Organizer "code card" (view / copy / regenerate)

### 3.1 Where it lives
- `pages/panel/GroupDetailsPage.tsx` is the per-group organizer page (`/panel/grupy/:groupId`, `router.tsx` l.112-117; linked from the "Prowadzę" tile `SpotkaniaView.tsx` l.189-194 "Szczegóły › grupy …"). `GroupDetailsCard` (l.118-155) is a `<dl>` of rows — "Widoczność", "Układ", "Domyślne miejsce", "Domyślny limit miejsc", "Utworzono" — inside `rounded-2xl border border-line bg-cream p-[15px]`, followed by a "Zobacz stronę organizatora ›" link. A code card fits as a sibling block under this card, rendered only when `group.visibility === "PRIVATE"`.
- The page is **outside `PanelDataProvider`** (docstring l.13-16) and uses `useGroupDetails(groupId)` (hooks l.29-60): two queries `["group", groupId]` and `["groupMembers", groupId]`, 403→`denied`, 404→`notFound`. The backend lets **organizer and members** in (l.16) — the code card must additionally gate on organizer role (either a `GroupResponse` flag or a 403 from the code endpoint mapped to "hide card"). `GroupResponse` (`api/groups.ts` l.19-30) carries no `is_organizer`; `getCurrentLeadership(groupId)` (l.141-143) exists but is a second round trip.
- Secondary surfaces: `CreateGroupStepper` done screen (l.138-170) — currently says the private group's visitors "poproszą o dołączenie"; the natural place to show/copy the freshly generated code right after creation. The edit-group sheet (`PanelModals.tsx` l.148-168, `GroupFormFields` visibility select l.66-76) is a form, not a good place for an action card.

### 3.2 Copy-to-clipboard precedents
- `pages/organizer/blocks/ShareButton.tsx` l.18-35: `navigator.share` first (AbortError swallowed), fallback `navigator.clipboard.writeText(url)` → `showToast("Skopiowano link")` / `"Nie udało się skopiować linku"`. Builds the URL from `window.location.origin + /slug`, never `location.href`, "so the owner's `?edit=1` never leaks" (l.13-14) — the same hygiene applies to a `?code=` link: build it from `termPublicPath(group, termId)` (`panelHelpers.ts`) + `?code=…`, never from the current URL.
- `PanelDataContext.tsx` l.901-915: icon button `aria-label="Kopiuj link do terminu"` → `navigator.clipboard.writeText(\`${origin}${termPublicPath(group, term.id)}\`)` + `showToast("Skopiowano link")`; uses `CopyIcon` from `panelIcons`.

### 3.3 Hook shape to follow for the code card (per `data-fetching.md`; no `useMutation` anywhere in `src/` — grep confirms zero hits)
- Read hook pattern: `hooks/useGroupDetails.ts` (`useQuery` + `useCallback` refetch, `hasStatus` for 403/404, stable `NO_MEMBERS` fallback).
- Mutation pattern A (mutations exposed from the resource hook): `hooks/useMyLocations.ts` l.44-92 — `invalidate = () => queryClient.invalidateQueries({ queryKey: [LOCATIONS_KEY] })`, each mutation `try { await api… } catch (err) { throw new Error(extractProblemMessage(err)); } await invalidate(); return created;`.
- Mutation pattern B (standalone mutation hook): `hooks/useUpdateOrganization.ts` l.24-46 — invalidates on failure too; maps 409 to a fixed Polish conflict message, 400 to a context fallback, else `serverMessageOr`.
- Query-key convention: resource-name prefix constant + params — `["group", groupId]` (`useGroupDetails.ts` l.11-12), `[LOCATIONS_KEY, "mine", token]` (`useMyLocations.ts` l.33), `[PENDING_JOIN_REQUESTS_KEY, username]` (`usePendingJoinRequests.ts` l.23), `[...NOTIFICATIONS_KEY, username]` (`useNotifications.ts` l.36). Keying by `username`/`token` when the data is per-account so another account never sees it (`usePendingJoinRequests.ts` l.17-19; `useMyLocations.ts` l.26-27). Suggested: `GROUP_JOIN_CODE_KEY = "groupJoinCode"`, key `[GROUP_JOIN_CODE_KEY, groupId, username]`, `regenerate()` invalidates `[GROUP_JOIN_CODE_KEY, groupId]`.
- Child components receive the host hook's mutation callbacks as props rather than re-subscribing (`LocationAddForm.create` prop, l.36-38 docstring) — a `JoinCodeCard` should take `code`, `loading`, `error`, `onRegenerate` from `GroupDetailsPage`'s hook, not call its own `useQuery`.
- `queryClient.ts` l.8-11: no retry on `ApiError` < 500 — a 403 (member, not organizer) on a code fetch fails fast, which is what the card needs to hide itself.

### 3.4 Regenerate UX precedents
- Destructive-ish confirmations in the panel use a dialog opened from a button with `aria-haspopup="dialog"` and an explicit `event.currentTarget.focus()` for Safari (`SpotkaniaView.tsx` l.165-178). A "Wygeneruj nowy kod" action that invalidates the old code could reuse this (confirm sheet via `panelComponents.ModalSheet` l.213-266, which focuses the first field or the dialog and restores focus on close).
- Optimistic-locking conflict copy precedent: `useUpdateOrganization.ts` l.9-10 ("Ktoś zmienił tę stronę w międzyczasie…") — reusable if regenerate hits a 409 from `updated_at` version col.

---

## 4. Consuming a `?code=` query param on the term route — SQ5 (UX)

### 4.1 Routing facts
- Term route: `/:organizationSlug/grupa/:groupId/term/:termId` → `<TermPage />`, **no `AuthGuard`** (`router.tsx` l.150-164). Anonymous visitors render the page; the gate's `loginRequired` branch sends them to `/login?returnTo=<pathname+search>` (`AuthGateSheet.tsx` l.7-10) and `LoginPage` navigates back to `returnTo` verbatim (`LoginPage.tsx` l.15, l.23); registration forwards `returnTo` through `/onboarding` (`AuthGuard.tsx` l.42-45; `RegisterPage.tsx` l.20-32; `OnboardingPage.tsx` l.48-62). **So a `?code=` link already survives the login/register detour with no new plumbing.**
- `api/client.ts` l.37-42: a 401 also redirects with `returnTo = pathname + search`, preserving the code.

### 4.2 Existing "read a query param once, then strip it" precedents
- `pages/panel/PanelPage.tsx` l.44-59: `useSearchParams()`; `createGroupRequested = searchParams.get("nowa") === "grupa"`; effect opens the modal then `setSearchParams(p => { p.delete("nowa"); return p; }, { replace: true })` "so a refresh or back step doesn't reopen it". This is exactly the shape for `?code=`: read → act → strip with `replace: true`.
- `pages/organizer/OrganizerTermsPage.tsx` l.28-55: validates a `group_id` param against loaded data and strips it with `replace: true` only after the directory has loaded — the pattern for "don't act on the param until the access query has resolved".
- `pages/organizer/editor/EditorSheet.tsx` l.59-62: `?tab=` driving UI state; `useBlocker` ignores query-only changes (l.71-73).
- Term route links are built with `termPublicPath(group, termId)` from `panelHelpers.ts` (`CreateGroupStepper.tsx` l.147; `PanelDataContext.tsx` l.908) — append `?code=` there for the organizer's share link.

### 4.3 Proposed consumption flow (frontend-only reasoning, to be reconciled with backend design)
1. `TermPage` (or the gate) reads `code = searchParams.get("code")`.
2. While `state.status === "loading"` do nothing (`TermPage.tsx` l.16).
3. If `resolveTermAccess` → `view`: strip `code` (`replace: true`) and ignore it (member already).
4. If `gate.kind === "loginRequired"`: keep the param in the URL (it is what `returnTo` carries); render the gate with a line like "Masz kod? Zaloguj się, żeby go użyć."
5. If `gate.kind === "canEnterCode"` and `code` present: prefill the code sheet input (or auto-submit once; `PanelPage.tsx` effect pattern guards against repeats), then strip the param on success/failure so refresh/back does not resubmit and the code does not sit in history (`ShareButton.tsx` l.13-14 hygiene rationale).
6. On success `await refetch()`; the `groupAccess` query flips to `view`.
- Risk noted for synthesis: `PrivateGroupGate`'s old pending-branch focus/visibilitychange polling (l.52-67) must not be revived for the code path — nothing is pending server-side anymore.

---

## 5. Test infrastructure to reuse
- `test/queryClient.tsx` `createQueryWrapper()` (used in `TermPage.test.tsx` l.148, `useTermAccess.test.ts` l.29).
- `vi.mock("../api/groups", async (importOriginal) => ({ ...actual, getGroupAccess: vi.fn(), … }))` partial-mock form in `TermPage.test.tsx` l.14-24 keeps `guestProfileIdKey` real — add `redeemJoinCode`/`getJoinCode`/`regenerateJoinCode` (names TBD) to this list.
- Route harness for the term page: `TermPage.test.tsx` l.135-149 (`MemoryRouter initialEntries=[PATH]` + `Route path="/:organizationSlug/grupa/:groupId/term/:termId"`); for `?code=` tests set `initialEntries=[\`${PATH}?code=ABCD\`]`.
- Open-sheet-count assertion harness: `test/ModalSheet.test.tsx` l.170-190.
- Theme-token guard lists: `test/themeTokenUsage.test.tsx` l.55-90 (`NO_HEX_FILES`, `NO_LEGACY_UTILITY_FILES`) and `test/themeDefects.test.tsx` l.83-120 (`IN_SCOPE_FILES`) — register any new krag-side component there.

**Confidence**: High (90%+) on all code facts (direct reads). The §4.3 flow is a recommendation, not a finding (Medium).
