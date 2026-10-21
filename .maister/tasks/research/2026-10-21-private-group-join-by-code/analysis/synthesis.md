# Synthesis — Join a PRIVATE group by access code (replacing "poproś o dostęp")

## TL;DR
Every artifact of the request/approve mechanism is inventoried (13 backend modules, 3 migrations as history, 7 backend test files, 23 frontend files) and nothing outside those trees depends on it; the membership primitive (`add_active_membership`), the `/access` resolver, the PRIVATE RSVP guard and the gate shell survive unchanged.
The code should be a plain nullable column on `groups`, verified **per group id** with `secrets.compare_digest`, shown in plaintext to the organizer, no expiry, organizer-triggered regeneration only.
A 9-digit numeric code (29.9 bits) is adequate for this app **only together with** per-group verification and a per-user failed-attempt limit (none exists today); 8-char Crockford (40 bits) is the safer alternative if the team does not want to depend on the limiter.
Migration order: additive `groups.join_code` (0059) before the destructive drop of `group_join_requests` + `notifications.join_request_id` (0060); existing PENDING rows are lost unless approved by script before deploy.

## Key Decisions
- Per-group verification (`POST /api/groups/public/{id}/join-code`) — makes the attacker's target one code, so 9 digits keeps the full 10^9 space and no global-unique index is needed.
- Plaintext storage of the code — the organizer must view/copy it; hashing is incompatible with that UX and the secret is low-value (membership in a hobby group, revocable by regeneration).
- Lazy get-or-create on the organizer read — avoids a backfill data migration and a new side effect in `create_additional_circle`/`update_group`.
- In-process attempt limiter + new 429 handler — consistent with the single-instance OAuth2 in-memory stores; DB counters would fight the `updated_at` optimistic lock on `groups`.
- Error shape: 401 → 404 (unknown/deleted/PUBLIC) → 429 → 409 (wrong code, one generic Polish message) → 200 (idempotent, also for an existing member).

## Open Questions / Risks
- Existing PENDING join requests are discarded by the drop revision; auto-approving them requires a pre-deploy script using the old `approve_join_request`.
- No `Membership` uniqueness constraint (OQ-8): a double submit can still create two active rows; the frontend busy-guard is the only mitigation unless a partial unique index is added.
- `returnTo` is not validated as a same-origin path (OQ-10); a `?code=` link that round-trips through login inherits that open-redirect risk.
- API-level privacy gaps outside `/access` (`/api/terms`, `/api/pledges`, …, OQ-9) are untouched by this change and remain the biggest "private means private" hole.
- The external finding `external-product-patterns.md` referenced by the entropy file was never written; product-pattern claims (Google Classroom 6–8 chars, Slack 30-day expiry) are second-hand.

---

## 1. Research question

> Jak dobrze zaimplementować dołączanie do grupy prywatnej (`GroupVisibility.PRIVATE`) przez kod dostępu, rezygnując całkowicie z mechanizmu "poproś o dostęp" (`GroupJoinRequest`, `RequestAccessDialog`, `PrivateGroupGate`, decyzje organizatora, powiadomienia `GROUP_JOIN_*`, `PendingActionsHost`)?

Added at resume: the user's reference product issues a **9-digit numeric code** generated and shared by the organizer, and the user's actual pain is "zapisanie się na termin w grupie prywatnej" — the visitor flow *term link → private group → code → member → RSVP* must work end to end.

## 2. Sources integrated

| File | Category | What it contributed | Confidence (self-reported) |
|---|---|---|---|
| `codebase-backend-removal-inventory.md` | codebase-backend | 13-row backend delete/change table, Alembic history, 7 test files, "no rate limiting" proof | High |
| `codebase-backend-membership-and-gating.md` | codebase-backend | `add_active_membership` contract, `_is_active_member`, `get_group_access` branch to replace, `create_rsvp` guard, matrix rows | High |
| `codebase-backend-reusable-and-migrations.md` | codebase-backend | Precedents (`secrets`, partial unique index, savepoint race, `_require_active_organizer`), `BaseEntity` constraints, 0059 outline, where new code lives | High |
| `codebase-frontend-removal-inventory.md` | codebase-frontend | 23-row frontend inventory, test-impact counts, dependency graph | High (95%) |
| `codebase-frontend-reusable-patterns.md` | codebase-frontend | `resolveTermAccess`, `useTermAccess` keep-verbatim, `ModalSheet`, `CapacityField` input pattern, clipboard precedents, `?code=` strip pattern | High; §4.3 flow Medium |
| `codebase-frontend-polish-copy.md` | codebase-frontend | Verbatim Polish copy of gate/dialog/panel + proposal skeleton | High (§1–6), proposal §7 |
| `docs-standards-design-checklist.md` | docs-standards | Rules A–K (models, migrations, matrix, envelopes, clock, validation, hooks, a11y, tests, scope) | High/Medium per row |
| `docs-standards-config-inventory.md` | docs-standards | No `JOIN_CODE_*`/`RATE_LIMIT_*`/Redis; stdlib `secrets` enough; no 429 handler | High |
| `prior-research-decisions.md` | prior-research | 26 decisions tagged KEEP/CHANGE/DROP, 12 open questions OQ-1…12, invite-link history | High facts, Medium tags |
| `prior-research-timeline.md` | prior-research | Chronology (join-link → login → request/approve → app-wide pending host → soft delete) and artefact inconsistencies | High |
| `external-code-format-entropy.md` | external | `secrets.choice`, Crockford Base32, NIST 20/64-bit rules, per-IP-only failures, brute-force table | High (math), assumptions on rates |

Missing: `external-product-patterns.md` (referenced, not produced) — see §7.

## 3. Cross-source validation

### 3.1 Confirmed by ≥2 independent sources (High)

| # | Claim | Sources |
|---|---|---|
| V1 | The join-request feature is a closed tree: backend grep over `app/`/`tests/`/`alembic/` and frontend grep over `src/` found no reader outside the listed files. | backend-removal §1 "No other module", frontend-removal §3 "Nothing outside these two trees" |
| V2 | `add_active_membership` is the single membership factory (flush only, caller commits), and the approve path's `if not _is_active_member → add_active_membership` + `commit` is the idiom to copy. | backend-gating §1; prior-decisions A5 (B14 closed `/join`, helper kept); `tests/test_add_active_membership.py` |
| V3 | `/access` already yields everything the gate needs; only the PRIVATE branch l.399-409 (`find_latest_join_request`) and the `join_request` field go. `can_view_content = is_member or is_organizer` stays. | backend-gating §2; frontend-reusable §1.2 (lines 21-24 collapse); prior-decisions A2/A3/N5 KEEP |
| V4 | `create_rsvp`'s PRIVATE guard already accepts any active member — once a code creates a `Membership`, RSVP works with zero changes (`test_group_access.py:366-391` proves approve → RSVP 201). | backend-gating §2 `create_rsvp`; prior-decisions L4 "membership ≠ RSVP" KEEP |
| V5 | No rate limiting exists anywhere: no lib, no Redis, no 429 handler, no setting. | backend-removal §4; config-inventory §4; design-checklist D6/K; prior-decisions OQ-3 |
| V6 | Removing `GROUP_JOIN_*` enum members requires deleting existing notification rows first (string-backed enum fails to coerce unknown values; 0038's downgrade is the precedent). | backend-removal row 10; backend-migrations §3 fact 1; prior-decisions N3/L1 |
| V7 | `notifications.join_request_id` is a loose pointer (no FK) — drop order column→table is convention, not a DB constraint. | backend-migrations §3 fact 1; design-checklist B5 |
| V8 | A `?code=` deep link survives the login/register round-trip with no new plumbing (`returnTo = pathname + search` in `AuthGateSheet`, `LoginPage`, `AuthGuard`, `api/client.ts` 401 path). | frontend-reusable §4.1; prior-decisions OQ-7 |
| V9 | PRIVATE is the **default** visibility for a founder without an Organization (`panelHelpers.defaultVisibility`), so the code UX is the main onboarding path. | frontend-removal row 19 + §4; `CreateGroupStepper.test.tsx:120-127` |
| V10 | `PendingActionsHost`, `snoozeStore`, `openSheets`, `pendingActionResolved` and the `StaleDataError` handler survive — they serve swap/confirm prompts and other verticals. | frontend-removal rows 7-10 + §4; prior-decisions L3/N2 |
| V11 | Human-typed codes need `secrets.choice` over a chosen alphabet; `token_urlsafe` is for opaque URL tokens; compare with `compare_digest`. | external F1; config-inventory §4 table; backend-reusable §1 row 1 |
| V12 | Anything under 64 bits of entropy requires a rate limiter (NIST 5.1.2.2); 20 bits is the floor; the limit key must not be per-IP only. | external F4, F5 |
| V13 | The organizer-only read/regenerate endpoints need no new matrix rows (READ row 26 / EDIT row 27) with the ownership check in the service; the visitor redeem route needs an explicit AUTHENTICATED row ahead of blanket row 27. | backend-gating §3; design-checklist C1-C3; prior-decisions N1/T3 |

### 3.2 Contradictions and how they were resolved

| # | Contradiction | Resolution |
|---|---|---|
| C1 | `GroupVisibility` docstrings (backend `models.py:84-90`, frontend `api/groups.ts:13-16`, migration `0036` l.6-7) disagree: backend says "request → organizer approves", frontend and 0036 still say "join link". | All three are prose; the frontend/0036 wording predates DEV24 (prior-decisions I1/I2). Rewrite all three to "kod dostępu". No code consequence. |
| C2 | `migrations.md` B3/B4/B7: "additive nullable columns in their own revision", "schema and data separate", "additive before destructive" vs backend-migrations §3 fact 4 suggesting drop + add in one 0059 as "a judgment call". | Follow the standard: **0059 = add `groups.join_code`** (additive), **0060 = drop join requests** (destructive, with the row delete inside `upgrade()` as 0038's downgrade did — a data step inside a destructive schema revision is the recorded precedent, prior-decisions L1). One migration test downgrades to 0058 (locations precedent for two interacting revisions). |
| C3 | Backend-reusable §1 row "Hashing secrets at rest": sha256 would be the precedent-consistent hash, but "a hashed code cannot be shown back to the organizer". Design-checklist A11: no standard forbids plaintext. | **Plaintext.** The organizer's view/copy/regenerate UX (success criterion 3) is a hard requirement; the secret's value is low (revocable, no PII unlocked beyond what a member sees); verification uses `compare_digest`. Documented as a decision, not a default. |
| C4 | Design-checklist E1 says marker timestamps are naive UTC; E4 notes `freeze_local_now` cannot freeze a UTC-based expiry. | Avoided entirely: **no expiry column**. Regeneration is the only invalidation (minimal-implementation J1; prior-decisions L4 "expiry declined for requests; re-decide for code" → decided: none). If a rotation timestamp is ever wanted it is a UTC marker and tests seed it by SQL like `test_group_join_requests_router.py:226`. |
| C5 | Rate-limit storage: config-inventory says a DB counter is "the only option that survives restarts"; backend-migrations §5 Q3 warns a counter on `groups` bumps `updated_at` and can 409 the organizer. | **In-process limiter** (precedent: OAuth2 in-memory stores, `security.md` l.67 single-instance decision). Restart resets the counter — acceptable at 10^9 space (see §5.2 math). A separate attempts table was rejected as a new `BaseEntity` for a counter (J1). |
| C6 | Error status for a wrong code: D3 (404 has a fixed English message), D2 (403 maps to a generic Polish `ACCESS_DENIED_MESSAGE` app-wide), D4 (409 passes Polish `message` verbatim), D5 (`ValueError` → 400 with message). | **409 `BusinessConflictException`** with one generic Polish message for "wrong code" *and* "group has no code yet" (no oracle, prior-decisions A4(c)/L9). 400 stays for Pydantic pattern violations (never user-visible thanks to client-side `parseJoinCode`). 404 for unknown/deleted/PUBLIC group exactly as `create_join_request` does today. |
| C7 | "Already a member" on redeem: today's `create_join_request` → 409 "Masz już dostęp do tej grupy"; prior-decisions L2 says the operation should converge. | **Idempotent 200** (`created: false`). It makes the `?code=` auto-submit path error-free for members and removes an error branch from the sheet. |
| C8 | Where the first code comes from: backend-migrations §5 Q1 offers create/switch side effect vs lazy; design-checklist B3 notes existing PRIVATE groups would hold NULL without a backfill. | **Lazy get-or-create** in the organizer `GET …/join-code` use case (precedent: `get_or_create_active_group_role`). Covers existing groups with no data migration and keeps `test_group_privacy.py:139-162` ("visibility flip has no side effect") valid. A visitor redeeming before the organizer ever opened the card gets the generic 409 — acceptable because the organizer must share the code first anyway. |
| C9 | Prior-decisions A5 says self-service membership was deliberately closed (B14). | Not a contradiction with the brief but must be stated: the new path is self-service **gated by an organizer-controlled secret**; it is not a return to `/join`. No name/child form, no anonymous branch (A1 KEEP). |
| C10 | The user's 9-digit reference vs external F6 "digits-only 6-char codes are too weak". | 9 digits ≠ 6 digits: 10^9 = 2^29.9 — the same entropy as 6-char Crockford, which F6 rates "safe with per-user limiting and per-group verification". Resolved in §5.2. |

### 3.3 Evidence-quality notes
- Everything in the removal map is a direct read with file:line (High).
- Test-impact rows are inferred from mocks/assertions, not by running pytest/Vitest (Medium — frontend-removal §4 says so explicitly).
- KEEP/CHANGE/DROP tags are interpretations (Medium, prior-decisions §4); this synthesis cross-checked them against the code inventories: all tags hold, with the one nuance that `PendingActionsHost` is CHANGE not DROP (V10).
- The external attempt rates (10/min, 60/min) are assumptions; the arithmetic is deterministic.

## 4. Patterns and themes

| Pattern | Evidence | Prevalence / quality | Consequence for join-by-code |
|---|---|---|---|
| **Service-level ownership checks, thin matrix** — `_require_active_organizer` in the use case; the matrix only decides AUTHENTICATED/READ/EDIT. | `circles.py:246`, `authorization_matrix.py:113-135`, `security.md` C1-C4, prior N1 | Established, tested (`test_authorization_matrix.py`) | Organizer code endpoints: no new rows; visitor redeem: one explicit AUTHENTICATED row in the old join-requests slot. |
| **404-before-403, no existence oracle for outsiders** | `_get_private_group` 404 for non-PRIVATE; `/access` reduced 200; `term_id` nulled not 404 (W5) | Deliberate, documented across RR23/DEV24 | Wrong code and "no code set" share one message; unknown/PUBLIC/deleted group → 404; never 403 for the code itself. |
| **Membership through one primitive; flush-only, single trailing commit** | `add_active_membership`, prior T4 | Established | Redeem use case = guard + primitive + commit. |
| **State derived from server, pure resolver on the client** (`resolveTermAccess`, `forToken`/`isStale`) | frontend-reusable §1, prior N5 | Mature, tested | Keep; union shrinks to `loginRequired \| canEnterCode`; success = `await refetch()`. |
| **Shared `ModalSheet` for every blocking dialog** | `ModalSheet.tsx`, a11y standard H1/H2; `RequestAccessDialog` hand-rolls the same chrome (anti-pattern) | Standard says prefer shared | The code sheet must be `ModalSheet`-based; do not copy `RequestAccessDialog`. |
| **Constrained text input pattern** (`CapacityField`: `type="text" inputMode="numeric" pattern="[0-9]*"`, shared parser, inline `role="alert"`) | validation.md F2, frontend-reusable §2.2 | Established for numeric input | A 9-digit numeric code fits this pattern *exactly* — a point in favour of digits over Crockford on the UI side. |
| **Read-param-once-then-strip** (`?nowa=grupa` with `replace: true`) | `PanelPage.tsx:44-59`, `OrganizerTermsPage.tsx:28-55` | Two precedents | `?code=` consumption follows it. |
| **Share links built from `origin + termPublicPath`, never `location.href`** | `ShareButton.tsx:13-14`, `PanelDataContext.tsx:901-915` | Established | Organizer "Kopiuj link z kodem" = `termPublicPath(group, termId) + ?code=`. |
| **In-memory, single-instance stores are an accepted trade-off** | `app/oauth2/stores.py` docstring, `security.md` l.67 | Deliberate | Licenses an in-process attempt limiter. |
| **Partial unique indexes, additive nullable columns, per-revision migration test** | 0056/0057/0058, migrations.md B3-B7 | Established | 0059 additive + 0060 destructive + `test_group_join_code_migration.py`. |
| **Prose drift**: docstrings/labels lag the mechanism (`join-link` → `dostęp na prośbę` → …) | C1 above; `user-guide.md` l.214 | Recurring weakness | List every prose site to update (report §9). |

## 5. Key insights

### 5.1 The replacement is small on the backend, mostly deletion
Backend additions: one use-case module (`application/join_code.py`: `get_or_create_join_code`, `regenerate_join_code`, `redeem_join_code`), one router, one `Group` column, one exception + handler (429), one matrix row swap, ~6-8 tests. Deletions: ~280 lines of use cases, 91 lines of router, 75 lines of repository, 3 enum members, 1 column, 4 schemas, 41 backend tests across 3 files, plus edits in 5 more. The surviving surface (`/access`, `create_rsvp`, organizer page) needs no behavioural change — only the `join_request` field and four exact-key-set assertions. **Confidence: High** (V1-V4).

### 5.2 Is a 9-digit numeric code adequate? Yes — conditionally. (Medium-High)
- Entropy: 10^9 ≈ 2^29.9 (29.9 bits) — above NIST's 20-bit floor, below 64 ⇒ a rate limiter is mandatory (F4). It equals 6-char Crockford (30 bits), which F6 calls "safe *with* per-user limiting and per-group verification", and is 1000× larger than the 6-digit OTP row F6 rejects.
- Per-group verification (code submitted to `/api/groups/public/{group_id}/join-code`) is what keeps the full space: with a global lookup and 1 000 live codes the expected work drops to ~5×10^5 guesses (≈35 days at 10/min — F6 sensitivity). With per-group verification: 5×10^8 expected guesses ⇒ ≈95 years at 10/min, ≈16 years at 60/min; with the proposed limiter (10 failed attempts per 15 min per user-group) ≈ 40/h ⇒ ≈1 400 years for one account. Multi-account attackers pay registration per 10 attempts.
- Restart of the in-process limiter resets counters; an attacker gains at most one extra burst per restart — negligible against 10^9.
- UX: digits map onto the existing `CapacityField`/`validation.md` input contract (`inputMode="numeric"`), the mobile numeric keypad, Polish users' BLIK/PIN habits, and need no case/O-vs-0 normalisation. 9 digits displayed as `123 456 789` is as readable as `XXXX-XXXX`.
- Trade-off vs 8-char Crockford (40 bits, 1 100× more space): Crockford removes the dependency on "getting the limiter right" and tolerates a weaker/absent limiter, at the cost of a letter alphabet (needs uppercase + O/0, I/1/L normalisation, `autoCapitalize`) and diverging from the user's reference product.
- **Recommendation**: 9 digits **if** both conditions hold (per-group endpoint + per-user limiter with 429). If the team wants to ship without a limiter in the first iteration, use 10 digits minimum or 8-char Crockford instead — do not ship 9 digits unthrottled.

### 5.3 The visitor's end-to-end path exists today except for one step (High)
`term link → TermPage → /access (reduced) → gate` and `member → PublicTermView → POST /rsvp (201)` are both implemented and tested; the only missing link is "code → Membership". Login round-trip with `?code=` preserved is already there (V8). Therefore the user's pain ("zapisanie się na termin") is solved by exactly one new POST and one new gate branch, not by touching RSVP.

### 5.4 The organizer side is where the new UI lives (High)
`GroupDetailsPage` (`/panel/grupy/:groupId`) is the per-group organizer page and is reachable by members too; the code card must hide on 403 from the code endpoint. `CreateGroupStepper`'s done screen is the second surface — it currently promises "osoby z linkiem poproszą o dołączenie" and, because PRIVATE is the default for Organization-less founders (V9), it is the first time most organizers meet the code.

### 5.5 Brute force replaces notification spam as the risk to design for (High)
DEV24's only anti-abuse control was the 24 h re-notify cooldown (prior L5). Dropping it is fine because nobody is notified; the new abuse vector is guessing, and the project has zero throttling (V5). The 429 handler and the limiter are therefore not optional hardening but the compensating control required by the entropy choice (F4).

### 5.6 Migration risk is low and well-precedented (High)
No FK from `notifications` to the dropped table (V7); only 0037/0038/0041 touch it; 0041 is irreversible but needs no edit; downgrade recreates the post-0041 UUID shape. The only data risk is PENDING rows (C8 / OQ-4).

## 6. Relationships and dependencies

```
Visitor (logged in)                              Organizer
  TermPage ──useTermAccess──► GET /access ──► get_group_access ──► _is_active_member/_is_active_organizer
     │  gate: loginRequired | canEnterCode                                 ▲
     │  JoinByCodeSheet (ModalSheet) ── POST /api/groups/public/{id}/join-code         │
     │        ├─ require_any() [AUTHENTICATED row]                          │
     │        ├─ _get_caller_party_id (401) → get_group (404) → PRIVATE? (404)
     │        ├─ limiter.check(party, group) (429)                          │
     │        ├─ compare_digest(group.join_code, code) (409)                │
     │        └─ if not member: add_active_membership ─► Membership ────────┘
     │  await refetch() → view → PublicTermView → POST /rsvp (create_rsvp PRIVATE guard: member ✓)
     │
  GroupDetailsPage ──useJoinCode──► GET /api/groups/{id}/join-code  (READ row; _require_active_organizer; get-or-create)
  JoinCodeCard ──regenerate──► POST /api/groups/{id}/join-code/regenerate (EDIT row; organizer; secrets.choice)
  CreateGroupStepper done screen ──► same GET
```

Cross-context: the only foreign data is the caller's `UserProfile`/party (`get_profile_by_principal`), already used by `join_requests.py`; no new ACL needed. Notifications: no new kind (if one is added later it must be ≤30 chars — the guard test being deleted is the only check).

## 7. Gaps and uncertainties

| Gap | Impact | Mitigation |
|---|---|---|
| `external-product-patterns.md` was never produced; Google Classroom "6–8 chars" and Slack "30-day expiry" are second-hand (external F6, prior I4). | Low — the recommendation rests on entropy math and project constraints, not product mimicry. | Flag as unverified in the report. |
| Test-impact lists are inferred, not executed. | Medium — counts may be off by a few. | Development phase runs both suites before deleting. |
| nginx config not inspected (config-inventory §3) — no knowledge whether `limit_req` exists. | Low — app-level limiter is required anyway (per-IP alone is insufficient, F5). | Note only. |
| `PG20` (panel group page with members list) status unknown — folder has only a task description, but `GroupDetailsPage.tsx` exists in code with members query. | Low — the code gatherer read the page; it exists. | Treat the page as present. |
| Whether GUEST principals pass `require_any()` with no args (AUTHENTICATED) — design-checklist C3 says "account-backed principal". | Low — same dependency as the old create route; guests could never request either. | Keep identical behaviour. |
| Exact `GroupResponse` exposure: organizer-only gating for the code card relies on a 403 from the code endpoint, since `GroupResponse` has no `is_organizer`. | Low | Accept the extra request; or add `is_organizer` later. |
| Concurrency: no unique index on active memberships (OQ-8). | Medium | Busy-guard on the sheet; optional partial unique index as a follow-up revision. |
| `returnTo` open redirect (OQ-10) | Medium (pre-existing) | Out of scope; listed as risk. |

## 8. Framework application (mixed)

**Technical — component/flow**: see §5.1, §6. **Requirements — need/constraint/gap**: needs = (a) visitor self-join with a secret, (b) organizer view/copy/regenerate, (c) full removal; constraints = standards A–K (all satisfied by the design in the report), login required (A1), reduced response (A2), no oracle (A4/L9); gaps = limiter, 429 envelope, prose drift, PENDING rows. **Literature — current vs best practice**: current = approval gate (no brute-force surface, spam surface); best practice for look-up secrets = ≥20 bits, limiter below 64 bits, per-user keying, `secrets` + `compare_digest`, unambiguous alphabet or digits; applicability = small-community app, single instance, Polish mobile users ⇒ 9 digits + limiter or 8 Crockford.

## 9. Conclusions
1. The removal is complete and safe (V1, V6, V7); the plan in the report lists every path.
2. Data model: `groups.join_code VARCHAR(9) NULL`, no index, no expiry, no history; verified per group id with `compare_digest`; lazy get-or-create; regenerate replaces in place (bumps `updated_at` → 409 for a concurrent stale PATCH, acceptable and already handled app-wide).
3. API: `POST /api/groups/public/{id}/join-code` (AUTHENTICATED row), `GET /api/groups/{id}/join-code`, `POST /api/groups/{id}/join-code/regenerate` (organizer in service); statuses 401/404/409/429/200.
4. UX: gate keeps its shell and heading; `JoinByCodeSheet` on `ModalSheet` with one numeric field; `?code=` prefilled and auto-submitted once, then stripped; organizer `JoinCodeCard` (copy code / copy link / regenerate with confirm) on `GroupDetailsPage` and on the stepper's done screen.
5. 9 digits is adequate with per-group verification and a per-user limiter; otherwise choose 8-char Crockford.
6. Ready for `/maister:development` — no further analysis pass is needed; six decisions remain for the operator (report §8).
