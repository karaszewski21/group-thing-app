# Spec Audit: Google sign-in and sign-up (pre-implementation)

## TL;DR
- Verdict: **Mostly Compliant (pass with concerns)**. The spec is complete, matches the binding inputs (requirements, ADR-001..009, clarifications, 7 mockups), and almost every codebase claim checks out (head 0106, matrix max row 71 / register row 47, login 401 at `router.py:70-81`, the callers at `families/bootstrap.py:58` and `guardians.py:32`, `check_text`, the error classes, Settings, the frontend files, compose and the Dockerfile).
- Counts: **Critical 0 · High 0 · Medium 7 · Low 9**.
- The security design holds up: RS256 pinned, iss/aud/azp/exp/iat checked, the nonce bound through a purpose-keyed signed cookie, no auto-link, a guarded downgrade. The concerns sit in the edges: the email lookup is case-sensitive while the DB index is not, the "re-raise" race branch reaches an English 409, the nonce cookie is shared across tabs, the JWKS cache scope is unclear for tests, three typed `useAuth` mocks will break `tsc`, a contradiction in the hidden/alert state, and an undocumented exception to the security standard.

## Key Decisions
- No finding is rated Critical or High. None of them opens an account-takeover path or a 500. Each degrades UX or testability, or leaves the docs inconsistent, and each has a small fix.
- I treat the 503 for a JWKS outage as correct, even though ADR-007 says "fails closed with a 401". Scope clarification `jwks-outage-status → A` replaced that later, and the spec follows the newer decision.
- I accept the spec's change to ADR-004's recovery path (dump restore only, not "delete those accounts"), because no deletion path exists. It is recorded as Low.
- The register race today is not a 500. `app/core/errors.py:115-117` maps every `IntegrityError` to an English 409, "Data integrity violation". The spec and ADR-008 call it a 500. This changes the wording, not the design.

## Open Questions / Risks
- Multi-tab use: one `aj_google_nonce` cookie per browser means any tab that mounts the button (or its 9-minute refresh) breaks the sign-in in progress in another tab (finding M3). Should the owner accept this, or does the spec need a mitigation?
- Should the nonce route stay a side-effecting `GET` outside `/api/public/`? If so, `standards/backend/security.md` and the matrix comment need an explicit exception (M7).
- For an image-only rollback, the compose backend runs `alembic upgrade head` on start (`docker-compose.yml:28`). An old image therefore fails at startup on the unknown revision 0108. It does not "return a 500 on password login" as the runbook text says (L6).
- Still open from the spec: popup blocking in in-app browsers, and the GIS iframe in the focus-trapped sheet at 375 px (manual check).

---

## 1. Claims verified against the codebase

| Spec claim | Evidence | Result |
|---|---|---|
| Alembic head is 0106 | `alembic/versions/0106_paid_terms.py:34-35` (`revision = "0106"`), no later file on `main` or the other branches | OK |
| Highest matrix row is 71; register is row 47 | `app/core/authorization_matrix.py:117` (`# 71`), `:183` (`# 47`); nothing numbered 72+ | OK |
| Login's hand-built 401 at `router.py:70-81` | `app/auth/router.py:70-81` | OK |
| `_load_permissions` in `auth/router.py` | `app/auth/router.py:49-53` | OK |
| `verify_password` is also used for OAuth2 client secrets | `app/oauth2/client_auth.py:76`, `app/oauth2/router.py:527` | OK, so keeping it strict is right |
| `verify_password(None)` gives a 500 today | `app/core/security.py:23-25` calls `hashed_password.encode` on `None`, which raises `AttributeError` | OK |
| `create_account_and_profile` callers `families/bootstrap.py:58`, `guardians.py:32` | as stated | OK |
| `users.service` imports only `app.auth.models` from `app.auth` (no cycle) | `app/users/service.py:15` | OK |
| `check_text(PROFILE_NAME)` raises `TextModerationRejected` / `ModerationUnavailable` and is a no-op when disabled | `app/moderation/text_guard.py:104-137` | OK (note: up to 5 s per call, and compose sets `MODERATION_TEXT_ENABLED: "true"`) |
| `display_name` is String(255) | `app/users/models.py:61` | OK |
| `BusinessConflictException`, `AccessDeniedException.public_message`, `ServiceUnavailableException` | `app/core/errors.py:48-67` | OK |
| `ErrorResponse` legacy envelope parsed by `api/problem.ts` | `errors.py:22-33`, `problem.ts:30-52` | OK |
| `photo_storage_configured` pattern | `app/config.py:67-78` | OK |
| `httpx` is a runtime dependency; `cryptography` absent | `pyproject.toml:21`; no `cryptography` in `uv.lock` | OK |
| Savepoint race pattern `events/service.py:401-408` | `app/events/service.py:400-408` | OK |
| `_enum_column` at `events/models.py:35` | as stated | OK |
| `0103` `_id`/`_timestamps`, 0076 guard, `test_item_visibility_migration.py` `_alembic` + `finally` | `0103_points_tables.py:32-45`; `0076_*.py:~44-61`; test `:21`, `:48-50` | OK (the 0076 line range is approximate) |
| `user_profiles.email` uniqueness | `0016_unique_user_profile_email.py:32-38`: unique index on `lower(email)` | OK, but see M1 |
| `SocialAuthButtons` divider at `:52-56`, status line `:49-51` | as stated | OK |
| `AuthTabs` mounts `<SocialAuthButtons />` with no props | `features/auth/AuthTabs.tsx:59` | OK |
| `LoginForm:60-64`, `RegisterForm:69-76` alert and switch | as stated | OK |
| `AuthContext` raw-fetch `login`/`register`, `applyToken` | `auth/AuthContext.tsx:83-151` | OK |
| `ApiError(status, statusText, body)`, `hasStatus` | `api/client.ts:3-15`, `api/problem.ts:36-38` | OK |
| No `src/api/auth.ts` exists | `src/api/` listing | OK |
| `googleMaps.ts` loader pattern (SCRIPT_ID, 10 s, memo-forget, stale tag) | `lib/googleMaps.ts:14-166` | OK |
| `auth.test.tsx` mock shape `:29-48`, defaults `:84-100` | `test/auth.test.tsx:29-48`, `:82-96` | OK (close enough) |
| `ssrSafety.test.tsx:207-220` login render | `:206-219` | OK |
| Compose `web.build.args` / Dockerfile ARG next to the Maps key | `docker-compose.yml:74-75`; `src/frontend/Dockerfile:24-25` | OK |
| `architecture.md` lines 157, 159, 532, 535, 619 | each line holds the text the spec refers to | OK |
| `/login` and `AuthSheet` never mount together; one live sheet | every `AuthSheet` is conditionally mounted (`gate.isOpen && …`) | OK |
| `trapFocus` lets Tab pass through the iframe | `components/shared/trapFocus.ts:1-2`: `iframe` is not in `FOCUSABLE`, and the trap only acts on first/last | Plausible; the manual check stays |

---

## 2. Important gaps (Medium)

### M1. The email pre-check is case-sensitive, but the unique index is on `lower(email)`
- **Spec reference**: R4.3 "Any `user_profiles.email` equals the normalized email: 409"; R4.5 re-read; Technical Approach `is_email_registered(db, email)`.
- **Evidence**: register's existing check is an exact match (`app/users/service.py:279-281`, `UserProfile.email == data.email`). The DB index is `uq_user_profiles_email_lower` on `lower(email)` (`0016_unique_user_profile_email.py:32-38`). Family-created accounts store emails **without** normalisation: `CreateFamilyRequest.email` / `AddGuardianRequest.email` (`app/families/schemas.py:62,69`) go straight into `create_account_and_profile` (`families/bootstrap.py:58`, `guardians.py:32`).
- **Gap**: take a guardian stored as `Jan@X.pl` who signs in with Google `jan@x.pl`. The pre-check misses, the create hits the lower-index violation, and the re-read (same exact match) misses again. The `IntegrityError` is then re-raised, so the user sees the central handler's English 409 "Data integrity violation" instead of the Polish copy, and the cookie is not cleared. There is no takeover, because the index still blocks the duplicate.
- **Category**: Incorrect assumption about existing code. **Severity**: Medium (wrong message on a real if uncommon path; security intact).
- **Fix**: define `is_email_registered` as `func.lower(UserProfile.email) == normalize_email(email)` (the index serves it). Use it in the pre-check and in the re-read for both Google and register. Add a test with a mixed-case stored email.

### M2. The race branch "anything else is re-raised" reaches an English 409 that the UI displays
- **Spec reference**: R4.5 and Key Decision "Race handling by re-read" ("Anything else is re-raised"); R14 alert "the backend `message` for 401/403/409/503"; Success criterion 1.
- **Evidence**: `derive_username_from_email` is check-then-insert (`app/users/service.py:240-257`), and `users.username` is unique (`app/auth/models.py:49`). Two concurrent sign-ups with the same local part but different domains (`jan@a.pl`, `jan@b.pl`) collide on `username`, which matches neither "identity exists" nor "email taken". The re-raised `IntegrityError` goes to `integrity_error_handler` (`app/core/errors.py:115-117`), which returns 409 "Data integrity violation", and R14 shows that text verbatim. The same goes for any `StaleDataError` 409 on the identity snapshot update (`errors.py:120-127`, Polish, but without the cookie cleared).
- **Category**: Ambiguous / incomplete error handling. **Severity**: Medium.
- **Fix**: either (a) retry the bootstrap once on an unclassified `IntegrityError` (the new username is computed again), or (b) map it in the route to the Google 401 copy, "Spróbuj ponownie". In both cases, make the frontend show the backend `message` for 409 only when it equals the Google 409 copy (or switch on status and use fixed frontend copies). Correct the spec's statement that the register race is "a 500 today": it is an English 409.

### M3. One nonce cookie per browser: any tab, or a 9-minute refresh, breaks another tab's sign-in
- **Spec reference**: R1 "Each call replaces the previous cookie"; R14 "Nonce refresh timer: 9 minutes after each nonce…"; Key Decision "only one live `SocialAuthButtons` per page".
- **Evidence**: the spec covers one instance per **page** but not per **browser**. `aj_google_nonce` with `Path=/api/auth/google` is shared by every tab. A background `/login` tab re-fetches every 9 minutes, and every `AuthSheet` open fetches a new nonce. Each of these overwrites the cookie while another tab's popup is open, so that tab's POST fails the nonce comparison with a 401 and the user has to click again. The same happens in one tab when the 9-minute timer fires while the popup is open.
- **Category**: Missing requirement (risk not documented). **Severity**: Medium (common multi-tab usage; recoverable by a second click).
- **Fix**: pick one. (a) Accept it and document it in Open Questions / Risks. (b) Pause the refresh while the document is hidden and while a popup or POST is in flight, and refresh on `visibilitychange`. (c) Let the cookie hold a short list (for example the last 3 nonces) and accept any of them. Option (b) is the smallest.

### M4. JWKS cache scope contradicts the injected-verifier test design
- **Spec reference**: Key Decision "Verifier … `GoogleTokenVerifier` … Tests inject a fake JWKS fetcher"; Technical Approach "JWKS cache: a module-level dict `kid → PyJWK`, an `expires_at` and an `asyncio.Lock`"; tests "unknown `kid` refreshes once and then succeeds".
- **Gap**: with a module-level cache, verifiers built in tests (and the `get_google_verifier` singleton) share keys, `expires_at` and the 60 s throttle state. The forced-refresh and throttle tests then depend on test order, and keys from one test module's RSA key leak into others.
- **Category**: Ambiguous / contradictory. **Severity**: Medium (testability and correctness of the throttle tests).
- **Fix**: keep the cache, the lock and the last-fetch time as **instance** attributes of `GoogleTokenVerifier`, with `get_google_verifier()` returning one process-wide instance. Inject a clock (or `time.monotonic` as a parameter) so the 60 s / 1 h tests need no sleeps.

### M5. Adding `loginWithGoogle` to `AuthContextValue` breaks `tsc` in three typed mocks the spec does not list
- **Spec reference**: R13 "The `AuthContextValue` type gains the method"; test plan lists only `src/test/auth.test.tsx`.
- **Evidence**: full-shape typed mocks `vi.mocked(useAuth).mockReturnValue({... login, register, logout, expireSession })` in `src/test/CategoryListPage.test.tsx:72-81`, `src/test/Sidebar.test.tsx:28-37` and `src/test/useItemActions.test.tsx:26-35`. With a new required member these stop type-checking. The typecheck baseline is 0 failures (memory: preexisting failures), so this would be a regression. `AppPage.test.tsx:41-49` is an untyped `vi.fn` and is unaffected.
- **Category**: Incomplete. **Severity**: Medium.
- **Fix**: add `loginWithGoogle: vi.fn()` to those three mocks and list them in the AuthContext test row. Also name "typecheck 0" in the baseline sentence of Testing Approach.

### M6. The `hidden` state contradicts "the alert stays visible"
- **Spec reference**: R14 States: "`hidden`: renders nothing, not even the divider"; Alert: "If a re-fetch after an error fails, the block becomes `hidden` but the alert stays visible."
- **Gap**: two rules for the same render. An implementer cannot tell whether `hidden` with an error renders the alert alone, the alert and divider, or nothing. The mockup `google-unavailable-email-only` shows nothing. No mockup covers "error, then hidden".
- **Category**: Contradictory. **Severity**: Medium (it changes the visual check and the `SocialAuthButtons` tests).
- **Fix**: define it explicitly, for example "`hidden` + `error` renders only the alert inside the `mb-4` wrapper, with no slot and no divider". Add one test row for it. Alternatively drop the rule and hide everything, since the email form remains.

### M7. The nonce `GET` is a side-effecting PUBLIC read outside `/api/public/`, against the security standard
- **Spec reference**: R1, R10; Standards Compliance "standards/backend/security.md: two PUBLIC matrix rows…".
- **Evidence**: `standards/backend/security.md:35` says every anonymous-friendly read lives under `/api/public/`, and `:53` says to keep GET routes free of side effects. The matrix comment at `app/core/authorization_matrix.py:222-225` calls `/api/categories` "the one PUBLIC read outside `/api/public/`". `GET /api/auth/google/nonce` sets a cookie. A cross-site top-level navigation to it (cookies with `SameSite=Lax` are set on top-level navigations) overwrites the victim's nonce. The impact is only a failed sign-in in progress, so this is not a security hole, but the spec claims standards compliance without naming the exception.
- **Category**: Standards conflict, not addressed. **Severity**: Medium (CLAUDE.md: "If standards conflict with the task, ask the user").
- **Fix**: either make it `POST /api/auth/google/nonce` (a JSON-less POST, PUBLIC row), or keep the `GET`, update `security.md` and the comment at `authorization_matrix.py:225` to name it as a deliberate exception (an auth-flow cookie, not a data read), and add that to R18.

---

## 3. Minor discrepancies (Low)

- **L1. "Every response clears the cookie" is not true for 400/500.** R2 promises it, but R2 also routes a malformed body to the existing `validation_error_handler` (`errors.py:130-137`), and Technical Approach lets unexpected exceptions reach the central 500 handler. Neither carries `delete_cookie`. Fix: reword R2 to "every response built by the route", or add a small dependency/middleware that clears the cookie. Neither choice is a security issue, because the cookie is stateless and expires in 10 minutes.
- **L2. The nonce is not server-side single-use.** The cookie is a stateless JWT, so clearing it does not revoke it. A captured (cookie, ID token) pair can be replayed until the earlier of cookie `exp` (10 min) and token `exp`. This is acceptable over TLS, but document it under Security notes so "clears the cookie" is not read as single use.
- **L3. `hmac.compare_digest` on attacker-shaped input.** `compare_digest(str, str)` raises `TypeError` for non-ASCII strings, and comparing with a non-str `nonce` claim also raises. Specify `isinstance(nonce, str)` and a comparison of `.encode()` bytes, mapping any failure to `GoogleTokenInvalid("nonce_mismatch")`, so it never becomes a 500. Likewise accept `email_verified` only when it `is True` (not truthy).
- **L4. `delete_cookie` attributes.** Spec: "`Max-Age=0`, same path". Specify that it uses the same `Path`, `Secure`, `HttpOnly` and `SameSite` as the set, so browsers that apply strict-secure-cookie rules accept the overwrite.
- **L5. Backend tests and `Secure`.** The test client uses `base_url="http://test"` (`tests/conftest.py:303`). httpx's cookie jar does not send `Secure` cookies over http, so the GET-nonce-then-POST tests must monkeypatch `auth_cookie_secure=False` or set the `Cookie` header explicitly. State this in the test plan.
- **L6. Runbook wording on image-only rollback.** R18 says "the old image returns a 500 on their password login". In compose, the backend runs `alembic upgrade head` on every start (`docker-compose.yml:28`). An old image without 0107/0108 fails at startup ("Can't locate revision"). Say both: it fails to start, and if started without migrations it returns a 500 for NULL-hash users.
- **L7. The empty status line is not specified.** The mockups keep an empty `<p class="status" role="status">` with `min-height:18px` under the button when there is no alert (`login-tab-google-button.html:208,239`). The spec specifies only the alert. Specify whether the empty `p` (`mt-2 min-h-4.5`) stays, so the form does not shift when an alert appears and the result matches the mockup.
- **L8. Lock timeout in 0107 and in 0108's downgrade.** 0107 adds an FK to `users` (a `SHARE ROW EXCLUSIVE` lock on `users`), and 0108's downgrade `SET NOT NULL` scans `users` under `ACCESS EXCLUSIVE`. `standards/backend/migrations.md` asks for `SET LOCAL lock_timeout = '5s'` in lock-taking revisions. Apply it to both directions.
- **L9. Standards evolution not planned.** The spec takes a documented exception to `standards/frontend/data-fetching.md` (an imperative nonce GET, no `useQuery`) and adds the first backend-set cookie. Neither is recorded in the standards. Suggest a `standards-update` for both (data-fetching exception, and security.md "auth-flow cookies: HttpOnly, purpose-keyed, Secure from config") after implementation.

---

## 4. Clarification needed

1. M3: accept the multi-tab nonce overwrite as a documented risk, or require the visibility-paused refresh?
2. M7: change the nonce to `POST`, or keep `GET` with a documented exception in `security.md`?
3. M6: what exactly renders when the block turns `hidden` while an error alert is showing?
4. M2: on an unclassified `IntegrityError` (username collision), retry once, or show the generic 401 copy?

## 5. Extra features (not in the requirements)
- None of substance. `is_email_registered`, the public `derive_display_name`, and moving `load_permissions` to `app/auth/service.py` are refactors that serve the requirements. `created` is returned but unused, as decided (`created-flag-use → A`).

## 6. Consistency with the binding inputs
- Requirements 1–12 and Q&A: all covered by R1–R18. The 9-minute refresh is a stated refinement of "when the 10-minute TTL lapses".
- ADR-001..009: followed. Two deviations, both justified: the 503 on JWKS outage (instead of ADR-007's 401, per the scope clarification) and dump-only recovery (ADR-004).
- Mockups: the copy for 401/403/409/503 matches `google-error-messages.html` and `conflict-409-register-tab.html` exactly. The GIS options (`standard/outline/pill/large`, `pl`, `signin_with`/`signup_with`, 200–400 px) and the 44 px skeleton match. The only gap is the empty status slot (L7).
- Standards: models, migrations, security and testing are honoured. The one exception is M7, with L8 and L9 as smaller items.

## 7. Recommendations (ordered)
1. M1 + M2: switch to a case-insensitive `is_email_registered`, and decide on a retry or a mapping for unclassified `IntegrityError`s. Make the frontend 409 copy robust.
2. M4: give the JWKS cache per-instance state and an injectable clock.
3. M5: add the three typed `useAuth` mocks to the test plan.
4. M6, M7, M3: resolve the clarifications above and amend R14 and R18 (plus `security.md`).
5. L1–L9: wording fixes in the spec, the test plan and the runbook.
