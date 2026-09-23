# Phase 1 Clarifications

## Q1: Where does the organizer see/manage pending join requests?
**A**: Both places:
- A new card on the organizer's own group page (`PrivateTermView`, `src/frontend/src/pages/krag/TermPage.tsx`), placed alongside the existing "Dodaj stałych członków z tego terminu" card — list of pending requesters + accept/reject buttons.
- Also an entry point in `/panel` (a button/link showing the pending-request count), for organizers who manage groups primarily from the panel.
- The organizer also gets an in-app **notification** (via the existing `app.notifications` + `notifications_bridge` mechanism, e.g. `PanelHeader.tsx`'s bell) when a new join request arrives.

## Q2: Can a user re-request after rejection?
**A**: Yes — rejection is terminal for that request row, but the user can immediately submit a new request (no cooldown).

## Q3: What does the requester see immediately after submitting, before the organizer decides?
**A**: A persistent "Prośba wysłana — czeka na akceptację" state replacing the request button — not just a toast. This must survive a page revisit (i.e. be derived from server state — `GroupAccessResponse`/a new field — not just local component state), so a user who submits then navigates away and comes back still sees "pending", not the request button again.

## Q4: Scope of the PrivateTermView/PublicTermView refactor in this task?
**A**: Full continued refactor of both views in this task (not just the join-flow-adjacent parts) — the user explicitly wants "a good refactor" of these two components, not a minimal patch. This will be scoped concretely in Phase 2 (gap analysis) rather than assumed.

## Notes for downstream phases
- Single active organizer per group (via `Leadership`) — no multi-organizer fan-out to design for.
- Confirmed-likely-dead duplicate PRIVATE-denied block in `PublicTermView` (`TermPage.tsx:1454-1531`) is a real refactor target — remove once confirmed unreachable.
- Closest existing patterns to mirror for the request/approval entity: `SwapProposal`/`SwapProposalStatus` (propose→accept/reject). Closest organizer-approval UI precedent: `formalize_group_from_term`'s checkbox-list card.
