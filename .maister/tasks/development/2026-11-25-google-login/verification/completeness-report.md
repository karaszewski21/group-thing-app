# Implementation Completeness Report: Google sign-in and sign-up (re-verification 1)

## TL;DR
- **Status: passed.** 0 critical, 0 warnings, 2 info. Every earlier completeness finding is resolved, withdrawn or moved to Phase 12.
- Plan: 50 of 50 steps are still checked, with no unchecked boxes. R1–R18 are still implemented, and all 14 fixes have code or doc evidence.
- Standards: 18 of the 21 indexed standards apply, and all 18 are followed. The owner approved the hand-made standards edits (W8), so the process gap is closed.
- Docs: the work-log has a dated fix entry, and the runbook now puts the kill switch first, says that a dump restore loses later writes, and says that local uvicorn reads `src/backend/.env`.

## Key Decisions
- Test evidence comes from the fresh full-suite re-run in `verification/test-suite-results.md`: backend 1792 of 1794 and frontend 2084 of 2117, every failure on the baseline plus one flake that passes alone. Feature tests were not run a third time.
- Owner decisions are treated as final: W4 (keep the per-login snapshot refresh, spec R4.1) and W8 (standards edits approved).
- W9 and W10 are deferred to D12 and D13. W11–W13, including the earlier completeness W2 (manual 375 px and real sign-in check), belong to Phase 12 E2E, so they are not counted here.
- The earlier I3 ("work-log names a nonexistent `auth_cookie` suite") was a false positive: `src/backend/tests/test_auth_cookie.py` exists. It is withdrawn.

## Open Questions / Risks
- Phase 12 must still do the real sign-in with the dev client ID (presence check only, never printed), the GIS-iframe Tab and popup check in `AuthSheet` at 375 px, and success criterion 8.
- A new observation (info): during the 60 s failure backoff, a token whose `kid` is missing from a still-fresh key set gets a 503 instead of a 401 `unknown_kid`. The fail-safe direction is fine, but the response code differs.

---

## 1. Plan Completion

**Status: complete.** 50 of 50 steps are checked (`grep "- [ ]"` finds no unchecked boxes, and the file is intact).

### Fix evidence (spot-checked in the code)

| Fix | Evidence |
|---|---|
| W1 JWKS backoff + grace | `app/auth/google.py:37-38`: `FAILURE_BACKOFF_SECONDS = 60.0` and `JWKS_GRACE_SECONDS = 24 * 3600.0`. In `_key_for` (`:249-273`), a recent failure skips the fetch and goes to `_grace_key`, and a failed refresh goes there too. `_grace_key` (`:280-286`) serves the last key set until expiry + 24 h, then fails closed with a 503. `_refresh` sets and clears `_failed_at`. |
| W2 single nonce request | `useGoogleSignIn.ts:82,112-121`: the `nonceRequest` ref holds one shared promise and clears it on settle. The ref survives StrictMode's remount. |
| W3 one copy source | `router.py:118-125`: `_GOOGLE_ERRORS` reuses `GOOGLE_UNAVAILABLE_COPY` from `google.py:60`. `GoogleEmailTaken`, `GoogleEmailUnverified` and `GoogleSignInFailed` (`service.py:38-48`) are plain types with no copy. `GoogleKeysUnavailable` passes the same constant on to the central 503 handler. |
| W5 one retry shape | `users/service.py:344` and `auth/service.py:133` both use `for _attempt in range(2)` around `begin_nested()`. |
| W6 outcome logs | `router.py:164,202,205,208`: `rejected: reason=…`, `email_unverified`, `email_taken`, and `ok: created=%s`. None of them logs an email, a subject or a token. |
| W7 runbook | `architecture.md:956`: a "Kill switch first" paragraph. `:963`: a restore loses every write made since the dump. |
| W14 skeleton | `SocialAuthButtons.tsx:33`: `animate-pulse rounded-full bg-line`, tokens only. |
| I1 focus refresh | `useGoogleSignIn.ts:146-155`: `onFocus` waits `FOCUS_REFRESH_DELAY_MS`, then `onReturn` checks again for `stale`, `inFlight`, visibility and `hasFocus()`. |
| I2 script listeners | `googleIdentity.ts:83-107`: one `pendingScript {script, loaded}` per tag, so a pending tag returns the same promise instead of adding listeners. |
| I3 GIS types / unmount | The unused members are gone from `googleIdentity.ts`. The `initialize` effect guards its callback with `current`. |
| I7 timing | `router.py:60,94-97`: `_DUMMY_PASSWORD_HASH`, and `verify_password` always runs once. |
| I9 whitespace ID | `config.py:75-77`: a validator strips `google_client_id`. |
| I11 0107 downgrade | `0107_user_identities.py:71`: `SET LOCAL lock_timeout = '5s'` in the downgrade too. |
| I12 docstrings/runbook | A grep for `_load_permissions` and `_derive_display_name` in `app/` and `tests/` finds nothing. `architecture.md:958` names `src/backend/.env` for local uvicorn. |

### Spec requirement trace (re-checked)

| Req | Status | Note |
|---|---|---|
| R1 Nonce POST, R2 Sign-in POST | ✅ | Unchanged. Every route-built response still clears the cookie through `_google_json`. |
| R3 Verification | ✅ | RS256, `azp`, nonce and `email_verified is True` are unchanged. W1 only adds availability behaviour: keys past expiry are served for at most 24 h, and only after a failed fetch. |
| R4 Resolution policy | ✅ | The snapshot refresh is kept (W4, owner). The `StaleDataError` → 401 path is still in place. |
| R5 Response | ✅ | `{token, created, party_id}` is unchanged. |
| R6 Bootstrap, R7 Register | ✅ | The register retry now has the loop shape (W5). The rule is still one savepoint, a re-read and one retry. |
| R8 Login guard | ✅ | A NULL hash still gives the same 401. It now also runs the dummy bcrypt verify (I7). |
| R9 Migrations/ORM | ✅ | 0107 has a lock timeout on both sides (I11). 0108 is unchanged. |
| R10 Matrix, R11 Config | ✅ | The ID is stripped (I9). |
| R12–R16 Frontend | ✅ | Loader (I2/I3), slot (W2/W14/I1) and SSR safety are unchanged in contract. |
| R17 Deploy | ✅ | Unchanged. |
| R18 Docs | ✅ | The runbook is updated (W7/I12), and the standards edits are approved (W8). |

---

## 2. Standards Compliance

**Status: compliant.** 21 standards checked, 18 applicable, 18 followed.

| Standard | Applies? | Reasoning / evidence |
|---|---|---|
| global/error-handling.md | ✅ Yes | Typed exceptions are mapped in one table. The JWKS outage now degrades gracefully: a 60 s backoff, a 24 h grace, then a 503 with one WARNING per failed fetch. Followed. |
| global/validation.md | ✅ Yes | Pydantic bodies, `normalize_email`, and a stripped client ID. Followed. |
| global/conventions.md | ✅ Yes | Settings, compose and `.env.example` placeholders; the runbook names the env file each run mode reads. Followed. |
| global/coding-style.md | ✅ Yes | The two flows now use one retry shape. ruff is at 64, below the baseline of 65. Followed. |
| global/commenting.md | ✅ Yes | Stale private names are gone. Docstrings explain the backoff, the grace and the focus delay. Followed. |
| global/minimal-implementation.md | ✅ Yes | Unused GIS members and the duplicated exception copy are removed. Followed. |
| backend/api.md | ✅ Yes | Unchanged routes. Followed. |
| backend/models.md | ✅ Yes | `UserIdentity` is unchanged. Followed. |
| backend/queries.md | ✅ Yes | Parameterized selects and `begin_nested()` savepoints. Followed. |
| backend/jooq.md | ❌ No | Only the filter-DSL query services, which this change does not touch. |
| backend/migrations.md | ✅ Yes | `lock_timeout` is now in both directions of 0107 and 0108. The guarded 0108 downgrade and the runbook are present. Followed. |
| backend/security.md | ✅ Yes | PUBLIC POST rows 72/73, constant-time login on both the missing-user and the NULL-hash path, and logs without PII. The hand edits are owner-approved. Followed. |
| backend/plugin-auth.md | ❌ No | The plugin token contract is untouched. |
| backend/time.md | ❌ No | No Warsaw wall-clock logic. The verifier's injected monotonic-style clock drives the TTL, backoff and grace. |
| frontend/css.md | ✅ Yes | `animate-pulse` plus the `bg-line` token, no hex. Followed. |
| frontend/components.md | ✅ Yes | The state-bound flow stays in its hook, and rendering is SSR-safe. Followed. |
| frontend/accessibility.md | ✅ Yes | The skeleton is `aria-hidden`, and the alert and status lines are unchanged. The manual 375 px check is in Phase 12. Followed. |
| frontend/responsive.md | ✅ Yes | The button width is still clamped from the slot width. Followed. |
| frontend/data-fetching.md | ✅ Yes | The imperative nonce POST is the recorded exception, now de-duplicated by the shared promise. Followed. |
| testing/backend-testing.md | ✅ Yes | 3 verifier tests were added for backoff and grace, and the log test was extended. Naming and placement follow the standard. Followed. |
| testing/frontend-testing.md | ✅ Yes | A shared-nonce test was added, plus googleIdentity and ssrSafety updates. Followed. |

**Gaps:** none.

---

## 3. Documentation Completeness

**Status: complete.**
- **implementation-plan.md**: intact, every step checked.
- **work-log.md**: a new dated entry, "2026-11-25T18:23:45Z - Verification fixes applied (Phase 11, cycle 1)". It lists the 14 fixes, the owner decisions on W4 and W8, the test results and the files touched, and it records the `test_auth_cookie.py` false positive.
- **Runbook** (`architecture.md:952-966`):
  - Kill switch first (`:956`): empty both IDs, rebuild `web`, restart the backend.
  - Restore loses every write made since the dump (`:963`).
  - Local uvicorn reads `src/backend/.env` while compose reads the root `.env` (`:958`).
  - The 0107 downgrade `lock_timeout` is reflected (`:954`).
- **INDEX.md**: the Google sign-in summaries are present.
- **Spec alignment**: R1–R18 are traced above. The skeleton now pulses, which closes the earlier mockup deviation.

---

## 4. Earlier completeness findings: status

| Earlier # | Finding | Status |
|---|---|---|
| W1 | Standards edited by hand, not through `/maister:standards-update` (= verification W8) | **Resolved.** The owner approved the edits as written. |
| W2 | Manual 375 px Tab/popup check and real sign-in still open (= W11/W13) | **Moved to Phase 12 E2E.** Not a completeness gap. |
| W3 | Static skeleton, no shimmer (= W14) | **Resolved.** `animate-pulse` on `bg-line`, `SocialAuthButtons.tsx:33`. |
| I1 | Stale `_load_permissions`/`_derive_display_name` docstrings (= I12) | **Resolved.** The grep finds nothing. |
| I2 | `get_google_verifier` cached before the 503 gate | **Residual (accepted).** It is harmless, because settings are read only at startup. No change is needed. |
| I3 | Work-log names a nonexistent `auth_cookie` suite | **Withdrawn (false positive).** `src/backend/tests/test_auth_cookie.py` exists. |
| I4 | Unrequested CSP/COOP and JS-origin doc notes | **Residual (accepted).** They are accurate, and the standards edits are approved. |

The verification-level items outside completeness are covered in the fix evidence in section 1: W1–W3, W5–W7, W14, I1–I3, I7, I9, I11 and I12 are resolved; W4 is kept as specified by the owner; W8 is approved; W9 and W10 are deferred to D12 and D13; and W11–W13 belong to Phase 12.

---

## Issues

| # | Source | Severity | Description | Location | Fixable | Suggestion |
|---|---|---|---|---|---|---|
| N1 | plan_completion | info | During the 60 s failure backoff, or right after a failed refresh, a token whose `kid` is missing from a still-fresh key set gets a 503 (`GoogleKeysUnavailable`) instead of a 401 `unknown_kid`. It still fails closed, so this is not a security issue. | `src/backend/app/auth/google.py:258-286` (`_key_for` → `_grace_key`) | true | Accept it as is, or return 401 `unknown_kid` from `_grace_key` when `now < self._expires_at`. |
| I2 | standards | info | `get_google_verifier` is cached before the 503 gate runs, so an unconfigured process caches a verifier with `client_id=""`. It is harmless, because settings are read only at startup. | `app/auth/google.py` (`get_google_verifier`), `router.py::google_sign_in` | true | No action needed. |

**Issue counts**: critical 0, warning 0, info 2.
