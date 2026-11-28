# Pragmatic Review: app/email sending module

## TL;DR
- Status: **Appropriate.** The module is large (about 2,000 LOC of production code in `app/email` and `auth/account_tokens`, plus about 1,450 LOC of frontend), but nearly every mechanism traces back to an accepted ADR or a spec audit item. None of it is speculative infrastructure.
- No critical findings. There are 2 low warnings: email-address normalisation is reimplemented about 6 times and already drifts, and the frontend has duplicated category labels. There are 6 info items.
- There is no new infrastructure: no Redis, no broker, no provider SDK. The module reuses APScheduler, `httpx` and the existing port/`set_x()` pattern. The queue is one table.
- The tests fit the 2–8-per-file standard (backend 3–10 per file, frontend 2–7).
- Fixing all the findings is about 1–2 hours of mechanical work and none of it blocks merging.

## Key Decisions
- Judged against the ADRs (`analysis/research-context/decision-log.md`) and `implementation/spec.md`, not against an abstract "MVP" bar. These are deliberate, documented choices, so they are **not** flagged:
  - the full Mailgun webhook with an in-process replay memory (ADR-010, the user's choice);
  - late binding in the send job, the stuck-SENDING policy and backoff (ADR-004);
  - the constant statement count per run, and the batched skip and outcome writes;
  - the full category catalogue in the CHECK constraint;
  - no `useMutation` (spec line 471);
  - the token TTLs and rate limits placed in `email.rules`.
- The three sender adapters (Mailgun, SMTP for Mailpit, log) plus a fake in tests are justified. Each has a real consumer (production, dev, CI/off). This is not a speculative Strategy.

## Open Questions / Risks
- The address normalisation has already drifted: `auth/service.py:89` compares with `.lower()` and does not strip whitespace, while every other place uses `strip().lower()`. This is harmless today, because stored emails go through `normalize_email`. It is the kind of drift that should not grow.
- The reserved categories `MEETINGS`, `MESSAGES` and `ORGANIZER_DIGESTS` are future stubs under `minimal-implementation.md`. The spec chose them explicitly to avoid a later migration. Accept them or revisit them; that is the owner's call.

---

## 1. Complexity Assessment

| Dimension | Observation | Verdict |
|---|---|---|
| Project scale | One VPS, docker compose, a small Polish user base, a modular monolith with strict boundary tests | Early stage / small production |
| Infrastructure | One queue table (`email_messages`), plus `email_preferences`, `email_suppressions` and `account_tokens`. It uses the existing APScheduler and `httpx`, and adds only Jinja2 | Proportional |
| Abstraction layers | router → service/sending → ACL. The `EmailSender` Protocol has 3 real adapters. There are no factories, registries or DI containers. `build_sender` is a 6-line `if` | Proportional |
| Reliability machinery | Idempotency keys, late binding, backoff, stuck-SENDING recovery, the "write only while SENDING" guard, replay protection | High, but each piece answers a named failure mode (ADR-004, H-1, M-1, M-2). It is justified for mail, where a duplicate password-reset link or a mail to an unsubscribed address is a real harm |
| Configuration | 14 new settings, one fail-fast `email_configuration_errors`, two flags | Acceptable. The two-flag rollout (account mail first) is a real operational need |

**Overall complexity: Medium-High, appropriate to the problem.** This is email delivery with legal (RFC 8058, PKE) and reputation constraints. The simpler alternatives were considered in the ADRs and rejected for concrete reasons: an outbox handler would duplicate bells (F1), and early binding would ignore unsubscribes.

## 2. Key Issues Found

### Warning (low): email-address normalisation reimplemented about 6 times
- **Evidence:**
  - `app/email/sending.py:245` `_normalize`
  - `app/email/service.py:167` and `:209` inline `address.strip().lower()`
  - `app/email/webhooks.py:218` in `_recipient`, plus SQL `func.lower(func.btrim(address))` at `:298`
  - `app/auth/account_tokens.py:64` `_normalize`
  - `app/auth/service.py:89` `.lower() == .lower()`, with no strip
- **Existing helper:** `app/users/schemas.py:26` `normalize_email`, which `auth/router.py` and `auth/google.py` already import.
- **Impact:** the suppression lookup, the token snapshot comparison and the webhook upsert must normalise identically, or a suppressed address could slip through. One copy (`auth/service.py:89`) already differs.
- **Fix:**
  - Add one `normalize_address()` in `app/email/rules.py` and use it in `sending`, `service` and `webhooks`. The email module may not import `users.schemas`.
  - Have `account_tokens` and `auth/service` import `app.users.schemas.normalize_email`, as the auth router already does.
- **Effort:** about 20 min. Fixable.

### Warning (low): category labels duplicated on the frontend
- **Evidence:**
  - `features/email/unsubscribeToken.ts:4` `EMAIL_CATEGORY_LABELS`
  - `features/email/EmailSettingsView.tsx:15` `CATEGORY_COPY[*].label` repeats the same two strings
  - `EmailSettingsView.tsx:25` `CATEGORY_ORDER` restates the order the server already returns in `preferences.categories` (it comes from `rules.VISIBLE_CATEGORIES`)
- **Impact:** renaming a category means editing two places. A third category needs edits in four places on the frontend.
- **Fix:**
  - Build `CATEGORY_COPY` from `EMAIL_CATEGORY_LABELS` (for example `label: EMAIL_CATEGORY_LABELS.RESERVATIONS`), or move the labels into `api/email.ts`.
  - Iterate `preferences.categories` instead of `CATEGORY_ORDER`.
- **Effort:** about 10 min. Fixable.

### Info: reserved categories `MEETINGS` / `MESSAGES` / `ORGANIZER_DIGESTS`
- **Evidence:**
  - `app/email/models.py:62-65`
  - `rules.py:52-58` (`CATEGORY_DEFAULTS` holds defaults for categories that no kind maps to)
  - the CHECK constraint in `0110_email_tables.py:147`
- **Assessment:** these conflict with "No Future Stubs", but spec R-section line 111 chose them deliberately ("the full catalogue now, so no later migration"). The cost is small: no code path reads them, and the PUT endpoint rejects them with 400. A later addition would be a one-line CHECK swap migration.
- **Suggestion:** keep as specified. If the catalogue is revisited, drop the three from `CATEGORY_DEFAULTS` and the enum. Fixable, optional.

### Info: trivial `_utcnow()` wrapper
- **Evidence:** `app/email/webhooks.py:96`. It has one caller (`:149`) and no test patches it.
- **Fix:** inline `datetime.utcnow()`. Effort: 1 min. Fixable.

### Info: double send timeout
- **Evidence:**
  - `senders.py:158` `httpx.Timeout(SEND_TIMEOUT, connect=5.0)`
  - `sending.py:408` `asyncio.wait_for(sender.send(...), SEND_TIMEOUT)`
- **Assessment:** this is harmless and the spec asks for `wait_for`. The httpx timeout alone already bounds Mailgun. For SMTP, `wait_for` cannot cancel the `to_thread` worker, so the smtplib socket timeout is what really bounds it. Keep it as is. If anything, add a comment that `wait_for` is the guard for third-party or fake senders. No action needed.

### Info: hand-listed field names in the blank-setting validator
- **Evidence:** `app/config.py`, where `_blank_email_setting_is_unset` lists 14 field names.
- **Risk:** a future `email_*` setting added without updating this list would treat an empty `.env` placeholder as a value (for example `""` for a bool fails startup).
- **Suggestion:** a short comment next to the settings block, or a test asserting that every `email_*` field is covered. Effort: 10 min. Optional.

### Info: auth token policy lives in `email.rules` and is re-exported through `auth/infrastructure/email_acl.py`
- **Evidence:**
  - `email_acl.py:29-33` re-exports `VERIFY_TOKEN_TTL`, `RESET_TOKEN_TTL`, `TOKEN_REQUEST_MIN_INTERVAL` and `TOKEN_REQUESTS_PER_HOUR`
  - `account_tokens.py` reads them via the ACL
- **Assessment:** the token lifetime and rate limits are an `auth` concern. Putting them in the email module adds a re-export layer, and a reader looks in the wrong module. The spec (lines 176–179) placed them there, so this is cohesion polish, not a defect. Moving the four constants into `account_tokens.py` would remove the re-exports. Optional.

### Info: dense batched outcome write
- **Evidence:** `sending.py:458-512`, a `VALUES`-joined UPDATE with 8 columns and per-column `CASE WHEN status='SENDING'`.
- **Assessment:** it is dense for a batch of at most 50, where a per-row UPDATE would read more simply. It is justified by the spec's constant-statement-count rule and by H-1 (never lower a webhook-raised status). The docstring explains it well. No action.

## 3. Developer Experience
- **Positive:**
  - The `EMAIL_BACKEND=log|smtp` defaults let a developer run with no provider account; Mailpit works for visual checks.
  - The fail-fast startup names the missing variables, never their values.
  - The job logs one summary line per run.
  - Tests switch flags with `monkeypatch`, and `conftest` forces the flags off, so existing query-count pins stay stable.
  - Every frontend view uses the `resolve…View()` pattern, with table-tested view states, matching the standard.
- **Friction (minor):**
  - Adding a new mailed bell kind touches `rules.KIND_RULES` (subject and CTA) and possibly `CATEGORY_LABELS` on two stacks. This is acceptable and documented.
  - Understanding the guards on the send path requires reading `sending.py` together with `webhooks.py`. The module docstrings do this well.
- No intrusive automation was found.

## 4. Requirements Alignment
- The implementation matches the spec file list in R1 exactly: `webhooks.py` is split from `router.py` as specified, and there are 4 template pairs.
- No features were found beyond the spec: no digests, no tracking (`o:tracking=no`) and no purge job (a stretch goal, not built). This is good scope discipline.
- The deviations from the ADRs (quiet hours as a claim filter, the `want_match` day shifted after 22:00, COMPLAINT lifted only by support) are recorded in the spec's Key Decisions, and the implementation follows the spec.

## 5. Context Consistency
- No dead code was found:
  - `find_suppression` and `clear_bounce_suppression` are both called (from the router and the auth ACL).
  - `NotificationEmail.topic_id` is used by the batch path.
  - Every `EmailSkipReason` is reachable (`ORGANIZATION` through the outer join to a party without a profile).
- The error handling is consistent:
  - The job and the webhook both map `TRANSACTION_CONFLICTS` to one WARNING, and log other errors once with `logger.exception`, matching `error-handling.md`.
  - The routes use the same `ErrorResponse` envelope helper pattern as `_GOOGLE_ERRORS`.
- The one inconsistency is the email normalisation (warning above).

## 6. Recommended Simplifications (top 3)

1. **Unify address normalisation** (warning).

   Before:
   ```python
   # sending.py
   def _normalize(address): return address.strip().lower()
   # service.py
   EmailSuppression.address_normalized == address.strip().lower()
   # auth/service.py
   profile.email.lower() == claims.email.lower()
   ```
   After:
   ```python
   # app/email/rules.py
   def normalize_address(address: str) -> str: return address.strip().lower()
   # auth side: from app.users.schemas import normalize_email
   ```
   Impact: about −10 LOC, 5 copies become 2 (one per side of the module boundary), and the drift is removed.

2. **Single source for frontend category labels and order** (warning). `CATEGORY_COPY` reuses `EMAIL_CATEGORY_LABELS`, and `Switches` iterates `preferences.categories`. Impact: about −6 LOC, one place to edit.

3. **Move the token TTLs and rate limits into `auth/account_tokens.py`** (info, optional). This drops 4 re-exports from `auth/infrastructure/email_acl.py`, and the token policy then sits beside the token code. Impact: about −8 LOC, better cohesion. It needs a spec note, since the spec placed the constants in `rules`.

## 7. Summary Statistics

| Metric | Current | After simplifications |
|---|---|---|
| `app/email` production LOC (py) | ~1,560 | ~1,550 |
| `auth/account_tokens.py` + ACLs | ~475 | ~465 |
| Email-normalisation implementations | 6 | 2 |
| Frontend category label/order definitions | 3 | 1 |
| New runtime dependencies | 1 (Jinja2) | 1 |
| New infrastructure services | 0 | 0 |
| Critical / warning / info findings | 0 / 2 / 6 | — |

## 8. Conclusion
The module is **appropriately engineered**. Its size comes from real email-delivery concerns (idempotency, late binding, suppression, legal unsubscribe, a staged rollout), each recorded in an ADR, not from speculative layering. No merge blockers.

Action items:
1. (Warning, about 20 min) Consolidate email normalisation; fix the unstripped comparison in `auth/service.py:89`.
2. (Warning, about 10 min) Deduplicate the frontend category labels and order.
3. (Info, optional, about 15 min total) Inline `_utcnow`, optionally move the token constants into `auth`, and add a guard or comment for the blank-setting validator list.

Estimated total effort: 30–45 min for the warnings, under 1.5 h including the optional items.
