# Implementation Verification: Product page reservations, item visibility, physical location, reserved badges

## TL;DR
**Final verdict (after two fix rounds): ✅ Passed.** There are no critical or warning-level code issues left. What remains is 2 infrastructure questions and a few info items.
- **Plan:** 136/136 items done.
- **Backend:** 1121 passed; mypy at the 15-error baseline.
- **Frontend:** 1347 passed; the 13 failures that remain all predate this branch. tsc is clean.
- **Production readiness:** GO (92%). The reality check confirms every user requirement end to end.
- **Fixed:** all 11 fixable first-pass warnings (W1–W11), plus re-verification finding N1 (privacy) and the documentation drift D1–D5.

## Open Questions / Risks
- **Infra:** does the production CDN/proxy in front of `/api/*` honour `Vary: Authorization`? If not, logged-in users can be served the anonymous copy, which lacks their own reserver markers, for up to 60 s. Nothing leaks either way, because personalised responses use `private, no-store`.
- **Infra:** is `index.html` served with `no-cache`? Browser tabs opened before the deploy keep calling the removed take/propose routes until they are refreshed.
- **Accepted (user decision):** anonymous visitors get a 60 s shared cache on the event page, `/access`, `/details` and the organizer routes. An item switched to PRIVATE can stay visible for up to 60 s.
- **Accepted:** an image-only rollback is safe only when the runbook's guard counts for 0074 and 0076 are both 0. No code can enforce that check.
- **Pending:** no browser run yet (Phase 12 E2E) and no commit yet (finalization).

## Executive summary
The three slices are implemented as specified:
- **S1:** inventory pickup place, `PersonalContext`, the unified take/propose endpoint, the 3-action product page with party settlement, and intent tiles.
- **S2:** reserved items stay on lists with a reserver badge, a pending proposal blocks the item, a RESERVED count, cache headers, and the privacy fixes.
- **S3:** PUBLIC/PRIVATE visibility with safe-by-default selects and 404 gates.

The first verification pass found 0 critical and 12 warnings. Two user-approved fix rounds resolved every fixable warning. A focused re-verification (code review, production readiness, completeness) then confirmed the fixes and found one more privacy issue of the same kind (N1), which round 2 fixed together with the documentation drift.

## Implementation plan verification
- **Plan:** 136 of 136 items, 100%. Every group was spot-checked against the code.
- **Visual coverage:** 13 of 13 design IDs are covered. Accepted deviations:
  - owner names are not declined;
  - the visibility toggle sits on its own row;
  - non-party viewers of a term/event reservation keep the existing "odbiór na terminie" copy.

## Test suite
| Suite | Result |
|---|---|
| Backend `uv run python -m pytest` | **1121 passed**, 0 failed (after round 2) |
| mypy `app` | 15 errors, the baseline; none added |
| Frontend `npx vitest run` | **1347 passed**, 13 failed |
| `tsc -p tsconfig.app.json` | clean |
| ruff (changed lines) | clean; every remaining finding also exists at `bf55353` |

The 13 frontend failures predate this branch: auth, extension-points ×2, foundation, PublicLayout ×2, AppPage add-term ×5, PendingActionsHost GIFT owner-side, TermPage anonymous sign-up. OrganizerEditor and DeleteGroupDialog also fail sometimes under load; both pass when run alone.

## Standards compliance
All 20 applicable standards are followed. Suggested standards are recorded in `architecture.md` as "not yet adopted"; adopting them is the user's decision, via `/maister:standards-update`:
- listing-preference selects are safe-by-default on visibility;
- personalised public GETs use `app/core/cache_headers.set_personalised_cache_headers`;
- downgrade-refusal tests run `upgrade head` in `finally`;
- Tailwind pages use `ConfirmDeleteDialog`.

## Documentation
Complete and aligned after round 2:
- **`architecture.md`:** product page reservations, the 0074–0077 runbook with mandatory guard counts, the cache helper on 7 routes, the owner-membership rule for PRIVATE items, and `pages/product/useItemTake.ts`.
- **`INDEX.md`:** updated.
- **`spec.md`:** Rev 3, and `spec.html` has been regenerated.

## Review results
| Review | First pass | After fixes |
|---|---|---|
| Completeness | passed with issues (0/3/6) | resolved; D1–D5 drift fixed in round 2 |
| Code review | 0 critical / 5 warning / 8 info | W1–W5 resolved; N1 fixed in round 2; info N2 fixed, N3 documented, N4 deliberate |
| Pragmatic review | appropriate (3 medium / 8 low) | M1 (=W9), M2 (=W8), M3 (=W6) resolved; L1–L8 remain as optional refactors |
| Production readiness | GO with mitigations, 83% | **GO, 92%**; W1, W2, W3, W5, W7 resolved; W4 and W6 are infra questions |
| Reality check | issues, no critical gaps | browser smoke test and commit still pending (Phases 12 and 14) |

## Visual fidelity
Pending. Phase 12 (E2E) will produce `verification/visual-fidelity.md`.

## Fix & Re-Verification History
| Issue | Fix applied | Re-check outcome |
|---|---|---|
| W1: PRIVATE items of an owner who only RSVPs were listed to members, who then got 404 | Owner-membership rule: `_visible_preferences(private_circle_id)` / `_owner_in_circle` on listings, browse, `/actions` `private_only`, and take/propose (`TermContext.allows`) | resolved (code review re-check; test `test_privateItem_rsvpOnlyOwner_…`) |
| W2: no index on `swap_proposals.listing_item_id` | Migration 0077 adds the partial index CONCURRENTLY; model `__table_args__` updated | resolved (round-trip test) |
| W3: `/actions` and other personalised GETs sent no cache headers | `app/core/cache_headers.py` applied on 7 routes | resolved (parametrised header test: 4 routes × anonymous/authenticated/invalid token) |
| W4: visibility was not re-checked after the lock | `require_placeable` runs before and after `FOR UPDATE` | resolved (forced-ordering race test → 409) |
| W5: "Odbiorę osobiście" was blocked with no hint | Hint text plus `aria-describedby` | resolved |
| W6: duplicated invalidation; cancel/reject acted on one click | `useReservationSettlement`, `RESERVATION_STATE_KEYS`, `isAlreadyResolved`, `ConfirmDeleteDialog` | resolved |
| W7: a chained downgrade could stop halfway after losing data | 0075 downgrade guarded; runbook requires both guard counts; `lock_timeout` on 0075/0076 | resolved (test; production re-check) |
| W8: `&&`/`\|\|` mismatch in personal-swap detection | `isPersonalSwapAccept` checks all four fields; shared copy | resolved |
| W9: ref plus effects for opening the chat after a take | `onReserved` callback; files moved to `pages/product` | resolved |
| W10: E501 | Comment rewrapped | resolved |
| W11: spec said 422 | Spec now says 400 (`fieldErrors`) | resolved |
| N1 (re-verification): `exchange_summary` exposed an RSVP-only co-guardian's PRIVATE items | `private_circle_id` in both paths | resolved in round 2 (regression test written first) |
| N2 (info): confirm dialog always closed | Actions return the error or `null`; the dialog closes only on success | resolved in round 2 |
| D1–D5: documentation drift | `architecture.md` and `spec.md` aligned | resolved in round 2 |

Re-verification reports: `code-review-reverify.md`, `production-readiness-reverify.md`, `completeness-reverify.md`. Round 2 was confirmed by the full suites, not by a separate review pass.

## Remaining items (non-blocking)
- **Info:**
  - The concurrency test still uses one session, not a real two-connection race.
  - Personal pickup has no rate limit or cap per taker.
  - `/actions` returns 404 for a principal without a profile (this predates the branch).
  - `resolve_organizer_slugs` adds up to 5 statements.
  - Moje rzeczy refreshes only when navigated to.
  - Two simultaneous proposals offering the same item are not locked against each other (this predates the branch).
  - Pragmatic L1–L8 duplication refactors.
- **Pre-existing lint:** ESLint errors in untouched files; ruff E501 on untouched lines.

## Verification checklist
- [x] Completeness, code review, pragmatic review, production readiness and reality check all ran, with reports on disk
- [x] Test suites: verified after each fix round (backend 1121, frontend 1347 + 13 pre-existing failures)
- [x] Fix rounds: 2, re-verification count 1
- [x] Overall status: passed
- [ ] Visual fidelity: pending Phase 12
