# Implementation Completeness Report: app/email sending module (stages 1+2)

## TL;DR
- Status: **passed_with_issues**. There are 0 critical issues, 1 warning and 7 info items.
- Plan: 136/136 checkboxes are `[x]` (117 steps plus 19 group headers). Spot checks found code for every task group.
- Standards: 22 of the 24 indexed standards apply, and all 22 are followed. The gaps are minor: test-count guidance and a duplicated label map.
- Docs: the architecture.md E-mail section and the 0110–0112 runbook, security.md, tech-stack.md, INDEX.md and CHANGELOG are all updated, and none contains a secret value.
- The one warning: the frontend full-suite count (49 failed) is above the recorded baseline (32). The work-log puts the +20 on HEAD commit 3bb3591 (MyItemsViewCategory). The test runner should confirm this.

## Key Decisions
- Two deviations from the plan text are documented in the work-log and accepted as equivalent:
  - The ACL is `find_own_address` (plan 8.2 named it `find_party_id_by_principal`).
  - `PROTECTED_PREFIXES` lives in `routing/paths.ts`, so `proxy.ts` is unchanged (plan 12.2).
- APScheduler `coalesce`/`misfire_grace_time=None` come from the scheduler's `job_defaults` (`app/main.py:292-293`). Only `max_instances=1` is set on the job itself, and that meets plan step 10.4.

## Open Questions / Risks
- Frontend baseline drift: 49 failed vs 32. The work-log names 20 failures in `MyItemsViewCategory.test.tsx` caused by HEAD 3bb3591 (`useQueryClient` at `MyItemsView.tsx:126`) and reports 3 baseline failures fixed. The test-suite-runner should confirm no feature file is involved.
- Some copy is proposed by the spec and still needs a product read: BOUNCE state, `scope=all` text, loading/error copy, the „wkrótce” note and the mail bodies.
- An ADR to replace handover ADR-009 is not written yet (work-log follow-up). The two ADR-009 deviations are recorded only in spec Key Decisions and architecture.md.
- Visual deviation: `AuthLayout.subtitle` is typed `string`, so the address or label cannot be bold on the token pages. Follow-up: widen it to `ReactNode`.

## 1. Plan Completion

| Metric | Value |
|---|---|
| Total checkboxes | 136 (117 steps + 19 group headers) |
| Checked | 136 |
| Unchecked | 0 |
| Completion | 100 % |
| Status | Complete |

### Code spot checks (evidence)
| Group | Evidence |
|---|---|
| 1 Config/clock/deps | `jinja2>=3.1.6` in `src/backend/pyproject.toml:23`, `uv.lock:919`. Mailpit `axllent/mailpit:v1.27.10` with `profiles: ["dev"]` in `docker-compose.yml`. `.env.example` has 14 empty placeholders. |
| 2 Migrations/models | `alembic/versions/0110_email_tables.py` (`lock_timeout` l.59/201, reverse-order downgrade l.202-211), `0111` (l.29-35), `0112` (no-op downgrade l.43). `app/email/models.py` uses `BaseEntity` + `_enum_column`. `AccountToken` in `app/auth/models.py:121` has named constraints. |
| 3 Email core | `app/email/{rules,links,rendering,senders}.py` and 10 templates in `app/email/templates/` |
| 4 Profile/Google | `MyProfileResponse` in `users/schemas.py`; Google paths in `auth/service.py` (diff) |
| 5 Enqueue/hook | `notifications/service.py` gets an explicit `id=uuid4()` + `email_acl.stage`, and `create_notifications` → `email_acl.enqueue`. `NotificationEntry.topic_id` added. `notifications/infrastructure/email_acl.py` |
| 6 Send job | `app/email/sending.py`: `with_for_update(skip_locked=True)` l.223, `clock.local_to_utc` l.133/270, `asyncio.wait_for(..., SEND_TIMEOUT)` l.408, `case((status == SENDING, new), else_=current)` outcome write l.457-500, summary line l.531 |
| 7 Webhook | `app/email/webhooks.py`: `hmac.compare_digest` l.134, skew l.140, WARNING/`logger.exception` → 503 l.161-167, INFO rejection l.101 |
| 8 Preferences/unsubscribe | `app/email/router.py`, `schemas.py`, `service.py` (read/set/find_suppression) |
| 9 Account tokens | `app/auth/account_tokens.py`: SHA-256 l.61, `token_urlsafe` l.107, atomic `UPDATE … used_at IS NULL … RETURNING` l.224-228. `AccountTokenNotFound`/`Gone` l.45/49 |
| 10 Wiring | `app/main.py`: `_check_email_settings` l.178 (names only), `_run_email_send` l.160 (WARNING on conflict, `logger.exception` otherwise), `set_sender` l.280/322, job only when `email_enabled` l.305. Matrix rows 74–77/82 at l.194-200 and 78–81 at l.291-296 |
| 11–17 Frontend | `api/email.ts`, the three new hooks, the four thin route files (token pages carry `referrer: "no-referrer"` + `robots.index=false`), `features/email/*`, `features/auth/ResetPasswordPage.tsx`, the LoginForm link l.61, AuthSheet `onNavigateAway={onClose}` l.29, the HomeView banner l.72, the AccountView row l.129 |
| 18 Docs | See section 3 |
| 19 Test review | `tests/test_email_flows.py` (3 end-to-end flows) |

Test functions per file:

| File | Tests |
|---|---|
| `test_email_config.py` | 9 |
| `test_email_enqueue.py` | 7 |
| `test_email_flows.py` | 3 |
| `test_email_migrations.py` | 4 |
| `test_email_preferences.py` | 7 |
| `test_email_rendering.py` | 5 |
| `test_email_senders.py` | 4 |
| `test_email_sending.py` | 8 |
| `test_email_webhook.py` | 8 |
| `test_account_tokens.py` | 10 |

Frontend: 10 new test files.

## 2. Standards Compliance

| Standard | Applies? | Followed? | Reasoning / evidence |
|---|---|---|---|
| global/error-handling.md | Yes | Yes | The job and webhook map `TRANSACTION_CONFLICTS` to one WARNING; other failures go to `logger.exception` and are not re-raised (`main.py:160-175`, `webhooks.py:161-167`). Polish user messages. |
| global/validation.md | Yes | Yes | Reset password: `aria-invalid`/`aria-describedby`/`role="alert"`, submit `aria-disabled` (`ResetPasswordPage.tsx:300-313`). Server-side Pydantic bodies. No integer inputs added. |
| global/conventions.md | Yes | Yes | `.env.example` names only, `uv.lock` shipped, docs updated |
| global/coding-style.md | Yes | Yes | ruff/mypy at baseline per the work-log (64/15) |
| global/commenting.md | Yes | Yes | Docstrings explain why. No change-log comments seen. |
| global/minimal-implementation.md | Yes | Yes | Only visible categories get switches; no admin UI or purge |
| backend/api.md | Yes | Yes | `/api/email/preferences`, `/api/auth/password-reset[/confirm]`, plural/flat paths |
| backend/models.md | Yes | Yes | `BaseEntity`, StrEnum + `_enum_column`, loose `notification_id`/`source_message_id`, no cross-module `relationship()` |
| backend/queries.md | Yes | Yes | Constant statement count (pinned by a `count_queries` test), batched `VALUES` update, `SKIP LOCKED` |
| backend/jooq.md | No | n/a | The filter-DSL query services are untouched |
| backend/migrations.md | Yes | Yes | `lock_timeout`, explicit names, schema/column/data split, round-trip test restoring head (`test_email_migrations.py:137-147`), runbook in architecture.md |
| backend/security.md | Yes | Yes | Matrix rows with ordering/resolve tests, `compare_digest`, hashed single-use tokens, no secrets in logs, PUBLIC POST justification comments; the standard itself is updated |
| backend/plugin-auth.md | No | n/a | Plugin auth is untouched |
| backend/time.md | Yes | Yes | `clock.local_to_utc` added, `app/email` added to the clock guard, no `datetime.now`/`date.today` in `app/email` or `account_tokens.py` (grep) |
| frontend/css.md | Yes | Yes | Tailwind tokens (`bg-danger-soft`, `text-ink`) |
| frontend/components.md | Yes | Yes | Thin route files that match existing panel pages, `features/email`, `*ViewState.ts` resolvers, no `next/navigation`/`next/link` in features (grep), full reload via `replaceDocument` |
| frontend/accessibility.md | Yes | Yes | `role="switch"`/`status`/`alert`, `aria-disabled` + handler guard for the cooldown |
| frontend/responsive.md | Yes | Yes | The pages reuse the AuthLayout/panel shells |
| frontend/data-fetching.md | Yes | Yes | Hooks in `src/hooks/`, prefix keys, awaited invalidation. No `useMutation`; the only `useEffect` is the cooldown tick in `useEmailVerificationRequest.ts:55`, not a fetch. |
| testing/backend-testing.md | Yes | Mostly | Integration-first, `freeze_local_now`, `count_queries`, camelCase naming. `test_account_tokens.py` has 10 tests (guidance 2–8). |
| testing/frontend-testing.md | Yes | Yes | Every new test file imports from `"vitest"`. No `as …Response` casts in the new files (grep). |
| project/architecture.md, tech-stack.md | Yes | Yes | Updated, see section 3 |

Totals:
- Checked: 24
- Applicable: 22
- Followed: 22, one of them only mostly (backend-testing, minor)

### Gaps
- **testing/backend-testing.md (info):**
  - `tests/test_account_tokens.py` has 10 test functions and `tests/test_email_config.py` has 9. The standard says 2–8 per feature.
  - The extra tests are justified (two groups add to each file), so no action is needed.
- **Duplication (info):** the category labels are defined twice:
  - `features/email/unsubscribeToken.ts:4` (`EMAIL_CATEGORY_LABELS`)
  - `features/email/EmailSettingsView.tsx:17-21`

  The work-log notes this too.

## 3. Documentation Completeness

| Artifact | Status | Evidence |
|---|---|---|
| implementation-plan.md | Complete | 136/136 checked, file intact |
| work-log.md | Complete (minor gap) | Dated entries for all 19 groups and the 17b follow-up, standards per group, files, final completion entry. The "Standards Reading Log → Loaded Per Group" heading still holds only its placeholder line (l.12-13); the per-group entries carry that content. |
| spec alignment | Complete | Audit items H-1, M-1, M-2, M-4, M-5, M-9 and L-3/L-12/L-15 are visible in code (outcome CASE guard, post-commit replay record, atomic claim, claim filter, `useOptionalPanelReload`, reset-page guard scope, matrix order, category tokens, `no-referrer` + slug query) |
| visual-coverage.md | Complete | 11/11 IDs mapped; deliberate copy deviations listed |
| architecture.md | Complete | E-mail section l.553+, integrations l.577, schema l.585, configuration l.592, Mailpit l.681, runbook l.1032-1045 (`pg_dump`, slug-collision query, no image-only rollback, lossy `downgrade 0109`, presence-only checks, kill switches, DMARC ramp, COMPLAINT only by support, Mailgun-side suppression and 5-min skew). The old „In-app notifications only” line is replaced (l.480). The unrelated "Visibility predicates" line is excluded from this check. |
| security.md | Complete | l.72-81: rows 74–79/82 reasoning, token flows, HMAC webhook, atomic claim, `no-referrer` |
| tech-stack.md | Complete | jinja2 3.1.6 (l.161), Mailpit tag (l.123), Mailgun, env names (l.45) |
| INDEX.md | Complete | Tech-stack, architecture and security summaries updated |
| CHANGELOG.md | Complete | 2 Polish bullets under `## Unreleased` |
| ADR | Gap (info) | No ADR replaces ADR-009 (work-log l.267) |
| Secrets | Clean | `.env.example` values are empty; docs name variables only |

## Issues

| # | Source | Severity | Description | Location | Fixable | Suggestion |
|---|---|---|---|---|---|---|
| 1 | plan_completion | warning | Frontend full suite is at 49 failed vs the 32 baseline. The +20 is attributed to HEAD 3bb3591, not to this feature. | `src/frontend/src/test/MyItemsViewCategory.test.tsx`, work-log l.289-292 | false | Confirm in test-suite-runner (run the file at HEAD). Update the baseline memory if confirmed. |
| 2 | documentation | info | Plan text is out of date on two points: the ACL name (`find_own_address`) and the `proxy.ts` step (12.2). | implementation-plan.md 8.2, 12.2 | true | Annotate the plan, or leave it as is (the work-log already records both). |
| 3 | documentation | info | No ADR replaces ADR-009 (quiet hours as a claim filter, `want_match` day). | analysis/research-context/decision-log.md | true | Write a short superseding ADR. |
| 4 | standards | info | Category label map is duplicated. | `features/email/unsubscribeToken.ts:4`, `features/email/EmailSettingsView.tsx:17-21` | true | Import `EMAIL_CATEGORY_LABELS` in the settings view. |
| 5 | standards | info | Test counts are above the 2–8 guideline. | `tests/test_account_tokens.py` (10), `tests/test_email_config.py` (9) | false | None needed. |
| 6 | documentation | info | Work-log "Loaded Per Group" section still holds only its placeholder line. | work-log.md l.12-13 | true | Remove the placeholder, or point it to the per-group entries. |
| 7 | spec | info | Proposed copy and the `AuthLayout` string subtitle (no bold address) need a product read. | `features/email/*`, `features/auth/ResetPasswordPage.tsx` | false | Product review; widen `subtitle` to `ReactNode` as a follow-up. |
| 8 | documentation | info | Rollout prerequisites (D14 privacy policy, Mailgun DPA) are outside the code. | architecture.md runbook stage 0 | false | Track them outside the code. |

Issue counts: critical 0, warning 1, info 7.
