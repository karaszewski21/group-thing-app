# Frontend findings — join-request removal inventory (SQ2)

**Category**: `codebase-frontend`
**Root**: `src/frontend/src/` (all paths below relative to it unless stated)
**Date**: 2026-10-21
**Method**: Grep for `joinrequest|join_request|RequestAccess|PrivateGroupGate|PendingActions|snoozeStore|pendingAction|GROUP_JOIN|usePendingJoinRequests` across `*.ts(x)`, then full reads of every hit.

---

## 1. Inventory table

Legend: **DELETE** = file has no purpose without join requests; **CHANGE** = file survives but has join-request code/copy to cut or replace; **KEEP** = untouched, listed because the brief named it.

| # | Path | Role today | Action | Tests that break / need edits |
|---|------|-----------|--------|-------------------------------|
| 1 | `components/krag/RequestAccessDialog.tsx` | Confirm-only bottom sheet; calls `createJoinRequest(groupId, termId)` (l.60), 409 → `onConflict` (l.63-66), own `trapFocus` + `useRegisterOpenSheet(true)` (l.38, l.47) | **DELETE** (or rewrite as `JoinByCodeSheet` — see reusable-patterns file §2) | `test/TermPage.test.tsx` (describe "TermPage — private group gate", l.569-731), `test/ModalSheet.test.tsx` l.5, l.10, l.180-186 (open-sheet count test mounts it), `test/themeTokenUsage.test.tsx` l.6-10, l.81, l.146-158 (`describe("RequestAccessDialog")`), `test/themeDefects.test.tsx` l.91 (IN_SCOPE_FILES list) |
| 2 | `pages/krag/PrivateGroupGate.tsx` | Gate screen for a PRIVATE group; branches on `gate.kind` (`loginRequired`/`canRequest`/`pending`/`rejected`, l.140-199); `withdrawJoinRequest` (l.83); focus/visibility refetch while pending (l.52-67); renders `RequestAccessDialog` as `KragStage` overlay (l.204-227) | **CHANGE** (keep shell: `KragStage` + `GroupHeader` + `CARD` + `h2 "Ta grupa jest prywatna"` + `stale`/`refreshError` handling; replace the three request branches with a code-entry branch) | `test/TermPage.test.tsx` l.305-313 (theme scope test keys on heading `/Ta grupa jest prywatna/`), l.528-540 (anonymous gate), l.569-731, l.777-790 (member sees no "Poproś o dostęp"), `test/themeDefects.test.tsx` l.88, `test/themeTokenUsage.test.tsx` l.76 |
| 3 | `pages/krag/termAccess.ts` | `PrivateGate` union (l.4-8) with `pending`/`rejected`/`canRequest`; `resolveTermAccess` reads `access.join_request` (l.21-24) | **CHANGE** (collapse `PrivateGate` to `loginRequired` \| `canEnterCode`; drop l.21-23) | `test/termAccess.test.ts` l.25, l.37-50 (5 of 8 cases reference `join_request`/`canRequest`/`pending`/`rejected`) |
| 4 | `hooks/useTermAccess.ts` | Query `["groupAccess", groupId, termId]` over `getGroupAccess` (l.43-45); `forToken`/`isStale` pattern (l.52-57, l.72) | **KEEP** (no join-request code; the `refetch()` it exposes is what a successful code submit should call) | `test/useTermAccess.test.ts` — unaffected (fixtures cast `as unknown as GroupAccessResponse`, l.14) |
| 5 | `pages/krag/TermPage.tsx` | Wires `useTermAccess` → `resolveTermAccess` → `PublicTermView` or `PrivateGroupGate` (l.21-50) | **KEEP / minor CHANGE** (prop list of the gate may change; docstring l.9-11 mentions `PrivateGroupGate`) | see rows 2-3 |
| 6 | `hooks/usePendingJoinRequests.ts` | Query `[PENDING_JOIN_REQUESTS_KEY="pendingJoinRequests", username]` over `listMyPendingJoinRequests`, enabled when token (l.7, l.22-26) | **DELETE** | `test/PendingActionsHost.test.tsx` l.19, l.400; `test/PublicLayout.test.tsx` l.21, l.52, l.139, l.146 |
| 7 | `components/pending/PendingActionsHost.tsx` | App-wide prompt host. Join-request parts: imports l.5, l.10, l.22-26; state l.53-59; filter l.71-77; `forgetResolvedState` branch l.86-89; `invalidatePendingQueries` l.106-111 (invalidates `[PENDING_JOIN_REQUESTS_KEY]`); `acknowledgeResolvedJoinRequest` l.164-169; `decideJoinRequest` l.171-195; render branch l.201-210; `JoinRequestActionSheet` l.306-377; docstring l.34-35 | **CHANGE** (strip join-request branch; swap/confirm prompts stay). Net: `derivePendingActions(notifications)` loses its 2nd arg | `test/PendingActionsHost.test.tsx`: mock l.28-32, `beforeEach` l.133, l.400 (`invalidate` called with `[PENDING_JOIN_REQUESTS_KEY]` in confirm flow), whole `describe("PendingActionsHost — organizer join requests")` l.544-733 (8 tests); `test/PublicLayout.test.tsx` l.20-24, l.52, l.122-147 |
| 8 | `components/pending/pendingActions.ts` | `PendingJoinRequestAction` l.45-52; `PendingAction` union l.54; `JoinRequestDecision` l.56; `derivePendingActions(notifications, joinRequests)` l.68-105 (join part l.94-103); `pendingActionKey` `jr:` prefix l.108-110; import l.1 | **CHANGE** (remove join-request type, 2nd param, `jr:` key) | `test/PendingActionsHost.test.tsx` l.688 (`jr:11` snooze key) |
| 9 | `components/pending/snoozeStore.ts` | Generic snooze map; only the docstring (l.3-4) mentions `jr:{joinRequestId}` | **KEEP** (docstring tweak only) | none |
| 10 | `components/pending/pendingActionResolved.ts` | Pub/sub "a pending action was resolved" → panel reload (`PanelDataContext.tsx` l.484) | **KEEP** (used by confirm flow too) | `test/PanelPage.test.tsx` l.21, l.2643 — unaffected |
| 11 | `api/groups.ts` | `GroupAccessDetails.join_request` l.268-271; section banner l.461-464; `JoinRequestStatus` l.466; `JoinRequestSummary` l.469-472; `JoinRequestResponse` l.474-482; `PendingJoinRequestResponse` l.486-494; `createJoinRequest` l.497-499; `withdrawJoinRequest` l.501-503; `listMyPendingJoinRequests` l.506-508; `approveJoinRequest` l.510-512; `rejectJoinRequest` l.514-516; `GroupVisibility` docstring l.13-16 already says "new members join only via the group's join link" (stale wording — update) | **CHANGE** (delete l.461-516, drop `join_request` from `GroupAccessDetails`, add join-code types/functions in the same section slot) | every test that mocks these: `TermPage.test.tsx` l.11, l.21-22, l.123, l.525, l.576-690; `PendingActionsHost.test.tsx` l.28-32; `PublicLayout.test.tsx` l.20-24; `ModalSheet.test.tsx` l.10; `themeTokenUsage.test.tsx` l.8-10; `termAccess.test.ts` l.25 |
| 12 | `api/notifications.ts` | `NotificationKind` members `GROUP_JOIN_REQUESTED`/`GROUP_JOIN_APPROVED`/`GROUP_JOIN_REJECTED` l.15-17; `join_request_id?: string \| null` l.33-37 | **CHANGE** (drop 3 kinds + field once backend drops them; nothing else in the frontend reads `join_request_id` except `PendingActionsHost.tsx` l.179) | `test/PendingActionsHost.test.tsx` l.562-574 (`joinNotif` fixture, `kind: "GROUP_JOIN_REQUESTED"`, `join_request_id: "11"`), l.721-731; `test/NotificationBell.test.tsx` — no join references (verified by grep) |
| 13 | `components/layout/PublicLayout.tsx` | Mounts `<PendingActionsHost />` for logged-in users (l.6, l.42) | **KEEP** | `test/PublicLayout.test.tsx` l.122-147 asserts `listMyPendingJoinRequests` call counts — rewrite those two assertions |
| 14 | `components/krag/AuthGateSheet.tsx` | `AuthGateLinks` with `?returnTo=` (l.7-10, l.18-46) — rendered bare inside the gate's `loginRequired` branch (`PrivateGroupGate.tsx` l.148); docstring l.15 names `PrivateGroupGate` | **KEEP** (docstring tweak if gate file is renamed) | none |
| 15 | `pages/panel/GroupDetailsPage.tsx` | `VISIBILITY_LABEL.PRIVATE = "Prywatna (dostęp na prośbę)"` l.11, used in `GroupDetailsCard` rows l.120; card is a `<dl>` of label/value rows l.135-154 — the natural host for a "code card" | **CHANGE** (label copy; add code card) | `test/GroupDetailsPage.test.tsx` l.77 (`getByText("Prywatna (dostęp na prośbę)")`); mock l.10-13 only mocks `getGroup`/`getGroupMembers` — a code fetch will need a new mock |
| 16 | `components/panel/GroupFormFields.tsx` | `<option value="PRIVATE">Prywatna — (dostęp na prośbę)</option>` l.74 | **CHANGE** (copy) | `test/CreateGroupStepper.test.tsx` l.120-127 reads the select by label `"Widoczność grupy"` and asserts value, not option text — safe; no test asserts the option label (grep) |
| 17 | `components/panel/CreateGroupStepper.tsx` | Done-screen copy for PRIVATE l.143-145: "Grupa jest prywatna — osoby z linkiem poproszą o dołączenie, a Ty je zaakceptujesz." | **CHANGE** (copy; possibly show the code here) | `test/CreateGroupStepper.test.tsx` l.73-74 (`PRIVATE_DONE` const), l.259, l.276, l.296 |
| 18 | `pages/panel/PanelDataContext.tsx` | `subscribePendingActionResolved` l.7, l.484; edit-group form carries `visibility` l.940, l.967; `defaultVisibility` l.81, l.236, l.294 | **KEEP** | `test/PanelPage.test.tsx` l.2643 — unaffected |
| 19 | `pages/panel/panelHelpers.ts` | `defaultVisibility(slug)` → PRIVATE without an Organization (l.25-29) | **KEEP** (note: new groups default to PRIVATE for users without an Organization, so the code UX is the *default* onboarding path, not an edge case) | `test/CreateGroupStepper.test.tsx` l.120 |
| 20 | `api/problem.ts` | `ACCESS_DENIED_MESSAGE` l.59-60: "...albo poproś organizatora o dostęp." (shown for any 403 via `serverMessageOr`) | **CHANGE** (optional copy: "poproś organizatora o kod"?) | grep in tests for the string: none found in `src/test` by the grep above (only source hit) |
| 21 | `router.tsx` | Term route l.162-164 (no `AuthGuard`), organizer page l.180-182, panel group l.115-117 | **KEEP** | — |
| 22 | `test/themeDefects.test.tsx` | `IN_SCOPE_FILES` l.88 (`PrivateGroupGate.tsx`), l.91 (`RequestAccessDialog.tsx`) — the test `readFileSync`s each path | **CHANGE** (remove/rename entries or the test throws ENOENT) | itself |
| 23 | `test/themeTokenUsage.test.tsx` | imports `RequestAccessDialog` l.6; mocks `createJoinRequest` l.8-10; `NO_HEX_FILES` l.68 and `NO_LEGACY_UTILITY_FILES` l.76, l.81, l.87 list `PendingActionsHost.tsx`, `PrivateGroupGate.tsx`, `RequestAccessDialog.tsx`; `describe("RequestAccessDialog")` l.146-158 | **CHANGE** (drop import/mocks/describe; keep or rename list entries; a new `JoinByCodeSheet` should be added to both lists so the no-hex/no-legacy-utility checks keep covering it) | itself |

### Files confirmed to have NO join-request references (grep-verified, KEEP)
`hooks/useNotifications.ts`, `components/shared/NotificationBell.tsx`, `hooks/useGroupDetails.ts`, `pages/panel/PanelModals.tsx`, `pages/panel/views/SpotkaniaView.tsx`, `pages/krag/PublicTermView.tsx`, `pages/krag/components/GroupHeader.tsx`, `pages/krag/components/KragStage.tsx`, `components/krag/ModalSheet.tsx`, `components/shared/openSheets.ts`, `components/krag/trapFocus.ts`, `test/NotificationBell.test.tsx`.

---

## 2. Test-impact summary (counts)

| Test file | Tests to delete | Tests to rewrite | Setup lines to edit |
|-----------|----------------|------------------|---------------------|
| `test/TermPage.test.tsx` | 10 in "TermPage — private group gate" (l.574-731): canRequest/Wyślij, Tab trap in dialog, failed-withdraw alert, withdraw→canRequest, rejected, 409 no-organizer, Esc/overlay close, non-409 error, visibility refetch on pending, token-change retry | 3: anonymous gate (l.528-540, asserts "Zaloguj się, aby poprosić organizatora o dostęp."), theme-scope gate (l.305-313, keys on heading only — survives if heading text stays), member-no-gate (l.777-790, asserts no "Poproś o dostęp" button) | `vi.mock` l.14-24 (`createJoinRequest`, `withdrawJoinRequest`), `access()` fixture l.123 (`join_request: null`), `privateAccess`/`pendingAccess` l.517-525, type import l.11 |
| `test/termAccess.test.ts` | 3 cases (PENDING, REJECTED, PENDING-without-token l.38-50) | 1 ("logged in, no request" → "logged in, can enter code" l.37) | fixture l.25 |
| `test/PendingActionsHost.test.tsx` | 8 in "organizer join requests" (l.544-733) | 1 (confirm flow l.378-407 asserts `invalidate` was called with `[PENDING_JOIN_REQUESTS_KEY]` at l.400) | mock l.28-32, import l.19, `beforeEach` l.133 |
| `test/PublicLayout.test.tsx` | 0 | 2 (l.122-140 asserts `listMyPendingJoinRequests` called once; l.142-147 asserts not called) | mock l.20-24, `beforeEach` l.52, import l.11 (`resetSnoozeStoreForTests` stays) |
| `test/ModalSheet.test.tsx` | 0 | 1 (open-sheet-count test l.170-190 mounts `RequestAccessDialog` as one of 3 sheets; replace with another `useRegisterOpenSheet(true)` dialog or the new code sheet) | import l.5, mock l.10 |
| `test/themeTokenUsage.test.tsx` | 1 (`describe("RequestAccessDialog")` l.146-158) | 0 | import l.6, mock l.8-10, lists l.68/76/81/87 |
| `test/themeDefects.test.tsx` | 0 | 0 | list l.88, l.91 |
| `test/GroupDetailsPage.test.tsx` | 0 | 1 (l.77 label string) | mock l.10-13 (add code endpoint mock if the card fetches) |
| `test/CreateGroupStepper.test.tsx` | 0 | 0-3 (l.73-74 `PRIVATE_DONE` string; l.259, l.276, l.296 use it) | — |
| `test/useTermAccess.test.ts` | 0 | 0 | — |

---

## 3. Dependency graph of the join-request feature (frontend)

```
PublicLayout.tsx (l.42)
  └─ PendingActionsHost.tsx
       ├─ usePendingJoinRequests.ts ──► api/groups.listMyPendingJoinRequests (l.506)
       ├─ api/groups.approveJoinRequest / rejectJoinRequest (l.510-516)
       ├─ pendingActions.derivePendingActions(notifications, joinRequests) (l.68)
       ├─ snoozeStore (key "jr:<id>", pendingActions.ts l.109)
       ├─ useNotifications (NOTIFICATIONS_KEY; reads n.join_request_id at l.179)
       └─ pendingActionResolved.emit ──► PanelDataContext.load({silent}) (l.484)

TermPage.tsx (l.41)
  └─ PrivateGroupGate.tsx
       ├─ termAccess.PrivateGate (kinds pending/rejected/canRequest)
       │    └─ resolveTermAccess reads access.join_request (termAccess.ts l.21)
       │         └─ api/groups.GroupAccessDetails.join_request (l.271)
       ├─ api/groups.withdrawJoinRequest (l.83)
       ├─ AuthGateLinks (loginRequired branch, l.148)
       └─ RequestAccessDialog.tsx ──► api/groups.createJoinRequest (l.60)
```

Nothing outside these two trees imports any join-request symbol (grep across `src/` excluding tests returned only the files above).

---

## 4. Observations relevant to the removal

- **`PendingActionsHost` survives**: swap-proposal and term-confirmation prompts are independent of join requests (`pendingActions.ts` l.73-93). Only the join branch is cut; the "waits for page dialogs" mechanism (`openSheets.ts`) is unrelated and stays.
- **`GroupVisibility` docstring is already stale** (`api/groups.ts` l.13-16): it describes "join link → standing membership", which is closer to the *new* model than the join-request one; it will need a final rewrite to mention the code.
- **`defaultVisibility` makes PRIVATE the default** for a founder without an Organization (`panelHelpers.ts` l.27-29; `CreateGroupStepper.test.tsx` l.120-127). The code UX therefore sits on the main onboarding path, which argues for surfacing the code on the stepper's done screen (l.138-170) and not only on `GroupDetailsPage`.
- **No frontend file reads `GROUP_JOIN_APPROVED` / `GROUP_JOIN_REJECTED`** by name; they only exist in the `NotificationKind` union (`api/notifications.ts` l.16-17). The bell renders any kind via `message`/`link_path` (`NotificationBell.tsx` l.64-78), so backend removal of those kinds needs no bell change.
- **Confidence**: High (95%+) for every row — all based on direct reads and a repo-wide grep; the only inference is which tests "break" (inferred from mocks/assertions, not by running Vitest).
