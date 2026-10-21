# Scope Clarifications (Phase 2)

## TL;DR
The scope stays as the research designed it, with no expansion. Members who join by code are not visible to the organizer and cannot be removed; this is accepted and recorded as a follow-up.
The frontend follows existing conventions: useCallback + invalidateQueries, a local toast in JoinCodeCard, and ConfirmDeleteDialog extended with busyLabel/tone props.
The backend guards against double submits by re-checking membership and returns 200 {created:false} when an organizer redeems their own code. The limiter lives in the groups BC.

## Key Decisions
- Members who joined by code are invisible to the organizer and cannot be removed: accept, state it in the spec, add "active member list + removal" as a follow-up. The design already defers removal and notifications, and there is no production data.
- Regenerate confirm: add optional `busyLabel` + `tone` props to `ConfirmDeleteDialog`. This is additive and keeps z-70, trapFocus, Esc and useRegisterOpenSheet.
- Panel ModalSheet (no Esc or focus trap): leave it as is. The gap predates this task, and only the nested confirm traps focus.
- Toasts: `JoinCodeCard` owns `useToast` plus a `role=status` pill, so it behaves the same on both surfaces.
- Writes: useCallback + api call + `await invalidateQueries`, with a local busy state, following data-fetching.md. No useMutation.
- Double submit: re-check `_is_active_member` within the request, disable submit while busy, and make the `?code=` auto-submit fire only once (ref). The design already specifies this.
- Organizer redeeming their own group's code: 200 `{created:false}`, no membership created. Consistent with `/access`.
- "Nearest upcoming term" on GroupDetailsPage: a new `useGroupTerms(groupId, {enabled})` hook, enabled only after the join-code GET succeeds. It picks the earliest term with `occurs_on` on or after the start of today (HomeView convention). With no such term, only "Kopiuj kod" is shown.
- Limiter location: `app/groups/application/join_code_limiter.py` (the design). `TooManyAttemptsException` goes in `core/errors.py`.
- The panel's "Kopiuj link do terminu" stays unchanged. The code is shared only from JoinCodeCard; adding `?code=` is a follow-up.

## Open Questions / Risks
- Follow-up: an organizer list of active members, member removal, and a "joined by code" notification.
- Follow-up: append `?code=` to the panel term link for PRIVATE groups.
