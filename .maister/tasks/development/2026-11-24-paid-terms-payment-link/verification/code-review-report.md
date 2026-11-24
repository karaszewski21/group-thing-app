# Code Review Report

**Date**: 2026-11-24
**Path**: group-thing-app working tree (paid-terms feature: migration 0106, `app/groups/*`, matrix row 71, frontend helpers/components/forms). Re-verification cycle 1, after fixes.
**Scope**: all (quality, security, performance, best practices)
**Status**: ✅ Clean (0 critical, 0 warnings, 10 info)

## TL;DR
- Both previous warnings are resolved. The "Zapłać" href goes through `parsePaymentUrl` and falls back to the on-site box, and 0106 plus the models add `ck_*_payment_url_https` (`ILIKE 'https://%'`).
- Uppercase `HTTPS://` works end to end: the client regex is `/i`, the server compares `scheme.lower()`, the DB uses `ILIKE`, and the link is returned exactly as typed. Tests cover all three layers.
- The fixes introduced no regressions. 69 payment-related frontend tests pass, and the idempotent PUT logs only on a real change (proved by a caplog test).
- One small client/server gap remains: `https://@x.pl` and `https://x.pl\@evil.tld` pass the client and get a 400 from the server. A few inputs are also accepted by the server but refused by the client. Details in I-10.

## Key Decisions
- In the client check, `[\s\p{C}]` matches Python `isprintable()`/`isspace()` for every category (Cc, Cf, Cs, Co, Cn, Zs, Zl, Zp). The literal `^https://` prefix makes `https:host` and `https:\host` fail on both sides. The client sends the trimmed, parsed value, never the raw text, so the different whitespace sets of JS `trim` and Python `strip` (U+FEFF, U+0085) cannot cause a 400.
- `set_payment_status` now lives in `attendance_points.py` next to `set_presence`, with the same check order (403 → 404 term → 404 row), the same `FOR UPDATE` + `populate_existing`, and `mapped_transaction_conflicts`. Comparing with `is not` is safe here: the SQLAlchemy `Enum` column returns enum members, and the caplog test shows that repeated PUTs log nothing and do not touch `paid_marked_at`. The log line carries only ids and the status, never the URL (asserted).
- `/attendees` and `/mine/attendances` call `set_personalised_cache_headers` after the service call succeeds, so the headers are only set on success. Both routes have an authenticated principal, which gives `private, no-store` (asserted in both test files).
- The shared `Switch` (`role="switch"`, `aria-checked`, `aria-label`) is used for the payment toggle. Payment errors are caught in the parent's `togglePayment` (`paymentError` alert), so `void togglePaid()` cannot leave an unhandled rejection.
- The `!= null` changes are consistent. The remaining `!== null` checks (`FirstTermStepperOrganizer` 88-89, `parsePayment`) act on values typed `string | null` that `parsePayment` returns, so they are correct.

## Open Questions / Risks
- The organizer-supplied link is still a phishing risk, accepted in the spec. Userinfo is now rejected, but the button still does not show the destination host (I-3).

## Summary
- **Critical**: 0 issues
- **Warnings**: 0 issues
- **Info**: 10 issues (I-1, I-2, I-4, I-5, I-6, I-8 and I-9 unchanged; I-3 partly resolved; I-7 resolved; new I-10, I-11 and I-12)

## Re-check (cycle 1)

| Previous finding | Result | Evidence |
|---|---|---|
| W-1 href without a client scheme guard; no DB https CHECK | **Resolved** | `SignUpFooter.tsx:91-95`: `href = paymentUrl == null ? null : parsePaymentUrl(paymentUrl)`; the `<a>` renders only when `typeof href === "string"`, otherwise "Do zapłaty: … (na miejscu)". `0106_paid_terms.py` `_CHECKS` and `models.py:145,300` add `ck_groups_default_payment_url_https` / `ck_terms_payment_url_https` (`IS NULL OR … ILIKE 'https://%'`); the migration test checks both names and a violating UPDATE. |
| W-2 client `parsePaymentUrl` looser than the server | **Resolved (small residual, I-10)** | `appHelpers.ts:178-194`: `^https://` (i), `[\s\p{C}]/u`, a non-empty `hostname`, and rejection of `username`/`password`. Tests in `paymentHelpers.test.ts:52-72` cover U+200B, U+0085, a tab, `a@evil.tld`, `bank.pl:secret@evil.tld` and `HTTPS://`. |
| I-1 CHECK validated under ACCESS EXCLUSIVE | Unchanged (accepted) | Two more CHECKs in the same loop. The columns are new and NULL, so the scans stay cheap, and `lock_timeout` is still 5s. |
| I-2 `datetime.utcnow()` | Unchanged (follows the standard) | `attendance_points.py` `set_payment_status`. |
| I-3 userinfo URLs; destination not shown | **Partly resolved** | The server rejects `"@" in parts.netloc` (`schemas.py:152`) and the client rejects `username`/`password`; tests for both. Showing the destination host is still open (accepted spec risk). |
| I-4 unlocked `attendance_closed_at` on re-RSVP | Unchanged (accepted) | — |
| I-5 `payment_url` in the anonymous public API | Unchanged (spec intent) | — |
| I-6 no unique `(term_id, party_id)` | Unchanged (pre-existing) | `set_payment_status` still uses `scalar_one_or_none`. |
| I-7 function-local imports in `term_payments` | **Resolved** | `term_payments.py` is now free of dependencies (constant + two pure functions). The toggle moved to `attendance_points.py`, which already imports `_require_active_organizer`/`_require_term_in_group` at module level. |
| I-8 cross-field 400 as `detail` | Unchanged | — |
| I-9 `/api/groups/mine` validates ignored fields | Unchanged | — |

## Critical Issues
None.

## Warnings
None.

## Informational

### I-1 to I-9
Their state is listed in the Re-check table above. Their text from the previous report still applies, except for I-3 (partly resolved) and I-7 (resolved).

### I-10 Edge inputs where client and server still disagree (residual from W-2)
- **Location**: `src/frontend/src/utils/appHelpers.ts:178-194` vs `src/backend/app/groups/schemas.py:130-154`
- **Description**: Checked by running both validators on the inputs below.
  - **Client accepts, server returns 400**:
    - `https://@x.pl` and `https://:@x.pl`: WHATWG gives empty `username`/`password`, but the server rejects any `@` in the netloc.
    - `https://x.pl\@evil.tld`: the browser reads `\` as `/`, so the host is `x.pl`. `urlsplit` puts the whole thing in the netloc and finds the `@`.
    - The save shows the same Polish message as the inline check, so the user is not misled.
  - **Server accepts, client refuses**: `https://x.pl:99999` and `https://a<b.pl`.
    - The client refuses them because `new URL` throws.
    - If one of these is stored through the API or MCP, the footer quietly falls back to "na miejscu". That is safe, just silent.
- **Suggestion**: Optional.
  - Client: add `if (/@/.test(trimmed.slice(8).split(/[/?#]/)[0])) return undefined;` (an `@` in the raw authority).
  - Server: optionally reject `\` and read `parts.port` inside the `try` to catch an invalid port.
- **Fixable**: true

### I-11 `is not` for the enum comparison in `set_payment_status`
- **Location**: `src/backend/app/groups/application/attendance_points.py` (`changed = attendance.payment_status is not new_status`)
- **Description**: Correct with the SQLAlchemy `Enum` column, which returns members, and the caplog test proves it. It would silently break idempotence, by rewriting `paid_marked_at` on every repeated PUT, if the column ever returned plain strings.
- **Suggestion**: `!=` is just as cheap and robust to a column-type change.
- **Fixable**: true

### I-12 A free term's payment footer reads "Opłacone"
- **Location**: `src/frontend/src/components/shared/SignUpFooter.tsx:82` (`status === "PAID" || price == null`)
- **Description**: Intended and documented: `price` is `null` only for a term made free after it was paid. An UNPAID attendee of a term made free later would also see "✓ Opłacone", which is fine in practice but not literally true.
- **Suggestion**: No action, or make sure `TermSignUp` picks the payment variant only when `price != null || status === "PAID"`.

## Metrics
- Max function length (changed code): ~55 lines (`create_rsvp`, `list_term_attendees`); `set_payment_status` ~45 lines
- Max nesting depth: 3 levels
- Potential vulnerabilities: 0 exploitable; 0 defense-in-depth gaps open (W-1 closed); 1 accepted phishing risk (destination host not shown)
- N+1 query risks: 0
- Tests run in this cycle: `vitest` on `paymentHelpers`, `SignUpFooter`, `TermPagePayment` and `TermAttendeesPage`: 4 files and 69 tests, all passed. Validator edge cases were checked directly on the server function and with WHATWG `URL` in Node.

## Prioritized Recommendations
1. I-10 (optional): reject `@` in the raw authority on the client, so `https://@x.pl` and `https://x.pl\@…` fail before submit.
2. I-11: change `is not` to `!=` in `set_payment_status`.
3. I-3: show the link's hostname near the "Zapłać" button (product decision).
4. I-4 / I-6: optional hardening later.
