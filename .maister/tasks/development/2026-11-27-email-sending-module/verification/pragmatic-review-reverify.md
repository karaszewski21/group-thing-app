# Pragmatic Re-verification: app/email sending module

## TL;DR
- Status: **Appropriate.** Both warnings from the first review (W1 and W2) are resolved, and I4 is resolved.
- The new code (access-log redaction, the GET unsubscribe redirect, the graceful send finish, the 72-byte password check, credential-error logging, and the `client.ts` empty-body handling) is small, and each piece answers a concrete problem.
- There are 2 new info items: two parallel credential-code sets in `senders.py`, and a three-way empty-body guard in `client.ts`. Neither blocks the merge.

## Key Decisions
- Only the two warnings, I4 and the code added in this cycle were re-checked. The original report (`pragmatic-review.md`) is unchanged.
- The remaining info items from the first review (I3 reserved categories, I5 double timeout, I6 validator field list, I7 token constants in `email.rules`, I8 dense outcome write) were not in this cycle's scope and stay as they were: optional or spec-sanctioned.

## Open Questions / Risks
- Mailgun 401/403/404 are now retryable, so a wrong key holds mail with backoff and then marks it FAILED after `MAX_ATTEMPTS` (about 5 h). This is intended (the mail goes out once the key is fixed). The operator should know that one ERROR line per run is the only signal.

---

## Prior findings

| ID | Severity | Status | Evidence |
|---|---|---|---|
| W1 address normalisation | warning | **Resolved** | `app/email/rules.py:83` `normalize_address` is used in `sending.py:259,286`, `service.py:167,209` and `webhooks.py:218`. `account_tokens.py:32,112,169,251` and `auth/service.py:23,90` use `users.schemas.normalize_email`. The comparison at `auth/service.py:90` now strips too. The only remaining copy is the SQL `func.lower(func.btrim(...))` in the webhook upsert, which is equivalent and acceptable. |
| W2 frontend category labels | warning | **Resolved** | `EmailSettingsView.tsx:9` imports `EMAIL_CATEGORY_LABELS`, and `:246` iterates `preferences.categories` in server order. `CATEGORY_ORDER` and the duplicate labels are gone. The hint strings stay local, which is correct because they appear only on `/settings`. |
| I4 `_utcnow` wrapper | info | **Resolved** | The wrapper no longer exists in `app/email/webhooks.py`. |

## New code

| Change | Verdict | Note |
|---|---|---|
| `app/core/access_log.py` (39 LOC) | Justified | Two regexes, one `logging.Filter`, and an idempotent install. It keeps the never-expiring unsubscribe token and the `token=` query values out of the logs. This is the minimal shape. |
| `GET /api/email/unsubscribe/{token}` → 303 to the page (`router.py:141`) | Justified | It has no side effects and handles mail clients that open `List-Unsubscribe` with GET. The `no-store` and `no-referrer` headers are appropriate. |
| Graceful send finish (`main.py:92-95`, `:166-193`, `:340-342`) | Justified | A module-level task handle and an `asyncio.wait` bounded at 15 s. Without it, every deploy restart could turn in-flight TRANSACTIONAL mail into `stuck_sending`, which would make users request their reset link again. Pausing the scheduler, then waiting, then `shutdown(wait=False)` is the simplest order that works. |
| 72-byte password check (`users/schemas.py:38-48`) | Justified | One shared function is used by both password schemas (`users/schemas.py:168`, `auth/router.py:256`). It turns a bcrypt 5 error that would surface as a 500 into a Polish 400. |
| Mailgun credential handling (`senders.py:30-33,125`, `sending.py:524-532`) | Justified, minor duplication | It logs one ERROR per run. See N1. |
| `api/client.ts` empty-body handling | Justified, slightly over-guarded | See N2. |
| `AuthLayout` subtitle as `ReactNode` | Justified | It widens the prop type and adds no logic. |

## New issues

### N1 (info): two parallel credential sets
- **Location:** `src/backend/app/email/senders.py:32-33`
- **Problem:** `CREDENTIAL_ERROR_CODES` (the strings `http_401/403/404`) and `_RETRYABLE_CLIENT_STATUSES` (the ints `401/403/404/429`) encode the same three statuses twice.
- **Suggestion:** derive one set from the other, for example `CREDENTIAL_ERROR_CODES = frozenset(f"http_{s}" for s in _CREDENTIAL_STATUSES)` and `_RETRYABLE_CLIENT_STATUSES = _CREDENTIAL_STATUSES | {429}`.
- Fixable, about 5 min.

### N2 (info): three-way empty-body guard
- **Location:** `src/frontend/src/api/client.ts`
- **Problem:** the client checks `EMPTY_BODY_STATUSES`, then `content-length === "0"`, then `text === ""`. The `text === ""` check alone covers the other two. Treating 202 as always empty would also silently drop the body of any future 202 that returns JSON. No backend route returns a 202 with a body today.
- **Suggestion:** keep 204/205 for the early return and rely on `text === ""` for the rest. Drop 202 from the set.
- Fixable, about 5 min.

## Summary

| | Critical | Warning | Info |
|---|---|---|---|
| Open from the first review (in this cycle's scope) | 0 | 0 | 0 |
| New in this cycle | 0 | 0 | 2 |

**Conclusion:** the re-verification passes. N1 and N2 are optional polish, about 10 min in total.
