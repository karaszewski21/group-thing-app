# Pragmatic Review — private group access requests (2026-09-24)

*(Saved by the verifier from the code-quality-pragmatist's returned text; the agent does not write files.)*

**Status: ✅ Appropriate** — complexity is proportionate to the problem. No Critical or High findings.
**Severity counts:** Critical 0 · High 0 · Medium 2 · Low 6

## Summary
Pre-production small app gains a request/approve lifecycle (1 entity, 6 routes, 3 notification kinds, 2 migrations), removes two self-join paths (B14) and fixes member content (B13). Follows existing precedents (SwapProposal, migrations 0031/0032, inventory race fallback). No new infrastructure, abstraction layers or dependencies. ~110 backend + ~220 frontend legacy lines deleted. S-1 (backend-only per-group list) accepted, not a finding.

## Findings
### Medium
- **M1 — Join-request machinery grows `PanelDataContext.tsx`** (now 1735 lines, +195; 5 new useState, 3 handlers, inline `JoinRequestActionSheet` ~80 lines) parallel to swap/confirm state. Justified by R16 keying by joinRequestId. *Optional (~1h):* extract `useJoinRequestActions()` + `JoinRequestActionSheet.tsx`; unify only if a third kind appears.
- **M2 — Migration 0038 + `notifications.join_request_id` plumbing** exists only to mark the matching bell notification read on decision. Small, matches `proposal_id` precedent, spec-required — keep; weakest cost/benefit item.

### Low
- **L1** Redundant client-side `.sort` of the pending list (server already orders by created_at, id); `.sort` mutates state inside `useMemo` — drop it or copy first.
- **L2** `Array.isArray(...) ? ... : []` coercion in production exists to survive test mocks (spec M-2 mandated) — test concern leaking into prod.
- **L3** `listMyPendingJoinRequests()` fetched on every panel load for every user — could gate on `activeLeaderships.length > 0`.
- **L4** `ACCOUNT_GUARDIAN_NAME_PLACEHOLDER = "Konto"` in `RsvpDialogLoggedIn.tsx` works around backend requiring an ignored `guardian_name` — real fix (optional server-side for authenticated callers) is a separate task.
- **L5** ORM round-trip test in `tests/test_group_join_request_model.py` borders on "what NOT to test"; keep the partial-unique-index tests.
- **L6** Duplicated copy „Zajęcia i lista uczestników są widoczne tylko dla członków.” in two gate branches; inline render helpers — readability acceptable.

## Developer experience
Facade discipline respected; route-order and matrix-placement comments present; global StaleDataError→409 is a broad improvement; `api/client.ts` returnTo is a strict improvement; explicit frontend state union; no polling.

## Requirements alignment & consistency
Matches R1–R16 without inflation; B14 removals complete; B13 flag server-resolved; deviation 4.3 (insert in application layer) consistent. No dead code; stale docstrings updated; consistent 404/403/409 with Polish messages.

## Top optional simplifications
1. Extract join-request slice from PanelDataContext (M1, ~1h).
2. Remove client re-sort and Array.isArray coercion (L1/L2, ~15 min).
3. Gate pending-list fetch on active leaderships (L3, ~10 min).

None block merge.

## Suggested standard
"Repositories are read-only; the application layer does add/flush" — make explicit in `standards/backend/queries.md` or `models.md`.
