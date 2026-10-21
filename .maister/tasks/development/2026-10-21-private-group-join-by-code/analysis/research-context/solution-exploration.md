# Solution Exploration: Join a PRIVATE group by access code (replacing "poproś o dostęp")

**Task**: `.maister/tasks/research/2026-10-21-private-group-join-by-code` · **Phase**: 3 (solution brainstorming) · **Date**: 2026-10-21 · **Inputs**: `analysis/synthesis.md`, `outputs/research-report.md`, 11 findings in `analysis/findings/`, `project/tech-stack.md`, `project/architecture.md`

## TL;DR
Eight decision areas, 31 alternatives explored. Recommended combination: **9-digit numeric code + in-process per-(user, group) failed-attempt limiter with 429**, stored as one **plaintext nullable column on `groups`**, verified **per group id** with `compare_digest`, **lazily created** on the organizer's first read and rotated only by an explicit organizer action, entered through a **`ModalSheet`-based `JoinByCodeSheet`** opened from the existing gate with **`?code=` prefill + one-shot auto-submit**, with existing PENDING requests **abandoned at cutover** (two migrations: additive 0059, destructive 0060).
The limiter is the load-bearing assumption: if it is dropped from the first iteration, the format must switch to 8-char Crockford Base32 (40 bits) — not 9 unthrottled digits.
Every alternative stays inside "how to implement join-by-code"; approval toggles, per-invite codes, expiry and organizer notifications are deferred.

## Key Decisions
- 9 digits only as a pair with the limiter — 29.9 bits sits below NIST's 64-bit "no throttle needed" line but 1 000× above the 6-digit OTP floor; the user's reference product uses 9 digits and the numeric input pattern already exists (`CapacityField`).
- Plaintext column on `groups`, no separate table — the organizer must read/copy the code (hash incompatible), and per-invite/expiry/max-uses are not required by the brief (minimal-implementation J1).
- Per-group verification endpoint `POST /api/groups/public/{id}/join-code` — keeps the full 10^9 space; a global lookup would divide it by the number of live codes.
- In-process limiter keyed by `(party_id, group_id)` — matches the single-instance OAuth2 in-memory store precedent; DB counters on `groups` would fight the `updated_at` optimistic lock.
- Lazy get-or-create on organizer `GET …/join-code` — no backfill revision, no new side effect in `create_additional_circle`/`update_group`, existing PRIVATE groups covered.
- Idempotent `200 created:false` for an existing member and one generic 409 for "wrong code / no code yet" — no existence oracle, error-free `?code=` path for members.
- PENDING rows abandoned (documented) rather than auto-approved — pre-production state; an auto-approve script is listed as the one-command fallback if real users are waiting.

## Open Questions / Risks
- Whether the operator accepts the limiter as a hard prerequisite of 9 digits; without it the recommendation flips to 8-char Crockford (Alternative 1B).
- Restart resets the in-process counter (negligible at 10^9) — but if the backend is ever scaled to >1 uvicorn worker/process, the limiter silently weakens by the worker count; the same caveat already applies to the OAuth2 stores.
- Double submit can create two active `Membership` rows (OQ-8) — mitigated only by `_is_active_member` + busy guard; a partial unique index is a deferred follow-up.
- `returnTo` is not validated same-origin (OQ-10); the `?code=` deep link makes the login round-trip more frequent, so the `startsWith("/")` guard should ride along as a tiny stretch item.
- Product-pattern references (Google Classroom, Slack) are second-hand — the format recommendation rests on entropy math and the user's reference, not on vendor practice.

---

## Problem Reframing

### Research Question
> Jak dobrze zaimplementować dołączanie do grupy prywatnej (`GroupVisibility.PRIVATE`) przez kod dostępu, rezygnując całkowicie z mechanizmu "poproś o dostęp" (`GroupJoinRequest`)?

User framing: "poprawić zapisywanie się na termin do grupy prywatnej"; reference product = organizer generates and shares a 9-digit numeric code. Replacing request/approve entirely is the user's decision; a hybrid "keep approval as an organizer toggle" is out of scope (captured under Deferred Ideas only).

### Constraints inherited from research (not re-decided here)
- Login required (prior A1 KEEP); reduced `/access` response and no existence oracle for outsiders (A2, A4, L9); membership only through `add_active_membership` (A5, synthesis V2); organizer checks in the service, thin matrix (N1, synthesis pattern 1).
- No rate limiting, Redis, 429 handler or `RATE_LIMIT_*` setting exists today (synthesis V5; `docs-standards-config-inventory.md` §4).
- Standards A–K from `docs-standards-design-checklist.md`: additive-before-destructive migrations, string-backed enums, naive-UTC markers, `validation.md` numeric input pattern, `ModalSheet` for every blocking dialog, TanStack hooks in `src/hooks/`.
- Single-instance deployment (`architecture.md` Deployment Architecture: one backend service via docker-compose; `security.md` l.67 single-instance OAuth2 stores).

### How Might We questions
| # | HMW | Decision area |
|---|---|---|
| HMW-1 | …choose a code the organizer can read aloud and a visitor can type on a phone, while keeping guessing economically pointless? | 1 Format & brute-force protection |
| HMW-2 | …store the secret so the organizer can see and copy it, without inventing a table the brief does not need? | 2 Storage |
| HMW-3 | …throttle guessing without Redis, a new dependency, or fighting the `updated_at` optimistic lock? | 3 Limiter placement |
| HMW-4 | …make sure every PRIVATE group — old and new — has a code when the organizer looks for it, and let them invalidate it on demand? | 4 Generation & rotation |
| HMW-5 | …turn "term link → private group → code → member → RSVP" into one unbroken path, including the logged-out visitor? | 5 Visitor UX |
| HMW-6 | …retire the join-request tables without stranding people who already asked? | 6 PENDING cutover |
| HMW-7 | …answer a wrong code, a missing code and an already-member without leaking group state? | 7 Response semantics (exposed by synthesis C6/C7) |
| HMW-8 | …put the code where organizers meet it first, given PRIVATE is the default visibility for most founders? | 8 Organizer surface (exposed by synthesis §5.4, V9) |

SCAMPER pass used to widen each area: **Substitute** (digits ↔ letters ↔ link token), **Combine** (code + link, limiter + entropy), **Adapt** (OAuth2 in-memory stores → limiter; `get_or_create_active_group_role` → lazy code), **Modify** (length 9 → 10/12), **Put to other use** (`?nowa=grupa` strip pattern → `?code=`), **Eliminate** (no limiter, no storage, no expiry), **Reverse** (eager vs lazy, approve-then-drop vs drop-then-nothing).

---

## Explored Alternatives

### Decision Area 1 — Code format & brute-force protection (coupled)

**1A. 9 digits + per-user failed-attempt limiter (429)** — recommended
- Description: `^[0-9]{9}$`, generated with `secrets.choice("0123456789")`, shown as `123 456 789`; redeem throttled at 10 failures / 15 min per `(party_id, group_id)`.
- Strengths: matches the user's reference product exactly; mobile numeric keypad; fits the existing `type="text" inputMode="numeric" pattern="[0-9]*"` contract (`validation.md` F2, `panelComponents.tsx:174-208`); no O/0, I/1 normalisation; expected guess time ≈1 400 years for one account with the limiter (`external-code-format-entropy.md` F6 + synthesis §5.2).
- Weaknesses: 29.9 bits is below the 64-bit "no throttle" threshold, so security depends on the limiter being shipped and correct (F4); multi-account attackers only pay registration per 10 attempts.
- Best when: the team commits to shipping the limiter in the same iteration and the app stays single-instance.
- Evidence: F4, F6; synthesis C10, §5.2; report §5.2 table.

**1B. 8-char Crockford Base32, limiter optional**
- Description: alphabet `0123456789ABCDEFGHJKMNPQRSTVWXYZ`, 8 chars = 40 bits, displayed `XXXX-XXXX`; input normalises case and O→0, I/L→1.
- Strengths: 1 100× larger space (~105 000 years @10/min per group with no limiter at all — F6); removes the hard dependency on limiter correctness; precedent alphabets in Misskey (F3).
- Weaknesses: letter alphabet on mobile (`autoCapitalize="characters"`, full keyboard); needs a normalisation function and a new input pattern not covered by `validation.md`; diverges from the user's reference; harder to read aloud in Polish.
- Best when: the limiter is deferred or the team distrusts an in-memory throttle.
- Evidence: F2, F3, F6; synthesis C10 trade-off paragraph.

**1C. 10–12 digits, no limiter**
- Description: keep digits, buy entropy with length (10 digits = 33.2 bits, 12 = 39.9 bits), ship without any throttle.
- Strengths: keeps the numeric UX and keypad; no new exception/handler; 12 digits ≈ Crockford-8 strength.
- Weaknesses: 10 digits still needs a limiter under NIST's rule (F4) and only buys 10× (≈950 years @10/min — not catastrophic but unthrottled); 12 digits is long to dictate (four groups of three); either way drifts from the 9-digit reference.
- Best when: numeric UX is non-negotiable *and* the team refuses any limiter.
- Evidence: F4, F6 (10-digit row computed in synthesis §5.2).

**1D. Link-only opaque token (`token_urlsafe`), no typed entry**
- Description: the organizer shares only a link `…/term/:id?invite=<22-char token>`; there is no code field, the token is consumed from the URL.
- Strengths: 128 bits — no limiter needed; trivial generation (`app/oauth2/stores.py:58-61` precedent); nothing to type.
- Weaknesses: breaks the user's stated reference ("kod od organizatora", spoken/pasted into a field); unusable when the code is passed verbally or on a printed note; the entire secret rides in URLs (history, referrers, screenshots — report R3); `token_urlsafe` is documented as *not* for human-typed codes (F1).
- Best when: sharing is always digital and the product does not want a typed code at all.
- Evidence: F1; `external-code-format-entropy.md` F1 "token_urlsafe is for opaque URL tokens"; report R3.

**Trade-off matrix (Area 1)**

| Alternative | Technical feasibility | User impact | Simplicity | Risk | Scalability |
|---|---|---|---|---|---|
| 1A 9 digits + limiter | High — stdlib only, one exception/handler | High — matches reference, numeric keypad, `CapacityField` pattern | Medium — limiter is extra code (~40 lines + 1 test) | Medium — security contingent on limiter shipping | Medium — in-process limiter is single-instance |
| 1B Crockford-8 | High — stdlib; new normaliser | Medium — letters on mobile, O/0 confusion mitigated not removed | Medium — no limiter but a normaliser + new input pattern | Low — entropy carries the load | High — no shared state needed |
| 1C 10–12 digits | High | Medium — long to dictate; 10 digits still "needs" throttle | High — nothing new beyond the column | Medium-High — 10 digits unthrottled violates F4; 12 is awkward | High |
| 1D Link token | High — `token_urlsafe` | Low — contradicts the "typed code" reference; verbal sharing impossible | High — no field, no limiter | Medium — secret lives only in URLs | High |

**Recommendation (Area 1)**: **1A**, with **1B as the named fallback** if Area 3 resolves to "no limiter". Rejecting 1C: it either keeps the limiter dependency (10) or the readability cost (12) without the reference-product benefit. Rejecting 1D: it answers a different product (link invites), not the user's "wpisz kod" model.

---

### Decision Area 2 — Where the code lives

**2A. Single plaintext nullable column `groups.join_code`** — recommended
- Description: `Mapped[str | None] = mapped_column(String(9), nullable=True)`; no index, no uniqueness; never exposed in `GroupResponse`/`PublicCircleResponse`.
- Strengths: `models.md` A1 "prefer plain columns"; additive column precedent (`0056:30-33`, `0058:31-40`); lookup is by `group_id` then `compare_digest`, so no index (`models.md` A10); the code shares the group's lifetime and soft-delete semantics for free (`get_group` 404).
- Weaknesses: plaintext at rest (acceptable: low-value, revocable secret — synthesis C3); no history, no per-invite attribution.
- Best when: one shared code per group with organizer-triggered rotation is the whole requirement — which it is.
- Evidence: `codebase-backend-reusable-and-migrations.md` §2 Option A; report §5.1; synthesis C3.

**2B. Separate `group_join_codes` table (per-invite, expiry, max-uses, revocation)**
- Description: a `BaseEntity` row per issued code with `expires_at`, `max_uses`, `revoked_at`; a group can hold many live codes.
- Strengths: audit trail of who issued which code; revoke one invite without regenerating for everyone; natural home for expiry/max-uses later.
- Weaknesses: brief does not ask for any of this (minimal-implementation J1 — no speculative abstractions); full `BaseEntity` conventions, FK, partial indexes, migration test; expiry collides with the naive-UTC vs `freeze_local_now` test friction (checklist E1/E4); organizer UI grows from "one card" to "a list".
- Best when: per-person invites or time-boxed codes become a requirement.
- Evidence: report §5.1 "Opcja B rejected"; synthesis C4; `docs-standards-design-checklist.md` E1/E4, J1.

**2C. Hashed column (sha256) with show-once semantics**
- Description: store `sha256(code)`; show the plaintext once right after generation; organizer can only regenerate, never re-read.
- Strengths: DB dump does not reveal codes; consistent with "hash secrets at rest" instinct.
- Weaknesses: organizer loses "Kopiuj kod" on every later visit (success criterion 3 in the brief requires view/copy); users will regenerate just to see it, invalidating others' links; no standard requires it (`security.md` covers passwords/JWT only — checklist A11); the threat it mitigates (DB read access) already exposes everything a member can see.
- Best when: codes unlock high-value content or regulatory pressure demands no plaintext secrets.
- Evidence: synthesis C3; checklist A11; report D8.

**2D. Derived / no storage (HMAC of group id + server secret)**
- Description: compute `code = HMAC(JWT_SECRET, group_id)[:9 digits]` on the fly; nothing persisted.
- Strengths: no migration at all; always "exists" for every PRIVATE group.
- Weaknesses: cannot rotate without a per-group salt (which is storage again) — regeneration is a stated requirement; `organizer_slug.py` precedent is explicit that id-derived values are "not a secret"; ties secret lifetime to `JWT_SECRET` rotation.
- Best when: never for this brief — included to validate that storage is genuinely needed.
- Evidence: report §5.2 "Nigdy nie wyprowadzać kodu z id"; synthesis §9 conclusion 2.

**Trade-off matrix (Area 2)**

| Alternative | Technical feasibility | User impact | Simplicity | Risk | Scalability |
|---|---|---|---|---|---|
| 2A Plaintext column | High — one additive revision | High — view/copy/regenerate always available | High — 1 column, 0 indexes | Low-Medium — plaintext at rest, low-value secret | High — enough for one code per group |
| 2B Codes table | Medium — new entity, FKs, 2 indexes, migration test | High for power organizers, Medium for most (list instead of card) | Low — most of it is unused scaffolding | Medium — expiry/clock friction, more surface | High — handles many codes per group |
| 2C Hashed column | High | Low — show-once breaks copy-later | Medium | Low at rest, Medium operationally (regenerate-to-see) | High |
| 2D Derived | High | Low — no regeneration | High | High — no revocation, secret tied to `JWT_SECRET` | High |

**Recommendation (Area 2)**: **2A**. Why not 2B: every extra field is speculative under J1 and can be added later as its own revision if per-invite codes are ever requested. Why not 2C: it sacrifices the organizer's primary interaction to protect a secret of membership-level value. Why not 2D: no rotation.

---

### Decision Area 3 — Attempt limiter placement

**3A. In-process dict with sliding window (`time.monotonic`)** — recommended
- Description: module-level `dict[(party_id, group_id)] → (failures, window_start)` in `application/join_code.py`; `check()` raises `TooManyAttemptsException` (new 429 handler in `errors.py`, `Retry-After` header); `record_failure()` after a 409; cleared on success.
- Strengths: zero dependencies; precedent `app/oauth2/stores.py` + `security.md` l.67 single-instance decision; testable by injecting a clock; no DB writes on the hot failure path; respects `time.md` (monotonic, not `datetime.now`).
- Weaknesses: resets on restart (one extra burst of 10 — negligible at 10^9); per-process only, weakens linearly with worker count; unbounded dict unless pruned (prune on `check()`).
- Best when: single-instance deployment, which is the documented state (`architecture.md` Deployment Architecture).
- Evidence: synthesis C5; report §5.3 row 1; `docs-standards-config-inventory.md` §4.

**3B. DB-backed counter (dedicated attempts table or Core `UPDATE`)**
- Description: `join_code_attempts(party_id, group_id, failures, window_start)` updated with a Core statement outside the ORM unit of work.
- Strengths: survives restarts and multiple workers; auditable.
- Weaknesses: a new table for a counter (J1); a counter *on* `groups` would bump `updated_at` and 409 the organizer's concurrent PATCH (`codebase-backend-reusable-and-migrations.md` §5 Q3); writes on every failed attempt; needs its own migration + test; must commit independently of the request transaction to count failures that roll back.
- Best when: multi-worker/multi-host deployment arrives.
- Evidence: report §5.3 rows 2-3; synthesis C5.

**3C. No limiter — rely on entropy (forces 1B/1C-12)**
- Description: ship redeem with no throttle; pick a format ≥40 bits.
- Strengths: smallest change; no 429 handler, no new exception, no limiter test.
- Weaknesses: NIST still requires a limiter below 64 bits (F4) — Crockford-8 is "good enough" by arithmetic, not by rule; a wrong-code loop also generates log noise with no backstop; leaves the project's "no rate limiting anywhere" gap (OQ-3) untouched.
- Best when: the team prioritises shipping speed and accepts Crockford-8.
- Evidence: F4, F6; OQ-3.

**3D. Reverse-proxy `limit_req` (nginx)**
- Description: configure `limit_req_zone` on `/api/groups/public/*/join-code` in the frontend nginx that already proxies `/api/*`.
- Strengths: no app code; stops the dumbest bots.
- Weaknesses: per-IP only — explicitly insufficient (F5: Firezone FZ-2026-007, Zealynx F-2026-0007); NAT'd groups (schools, offices) get collectively throttled; nginx config was not inspected in research; cannot key on the authenticated user.
- Best when: as a *complement* in production, never as the sole control.
- Evidence: F5; report §5.3 row 5; synthesis §7 gap "nginx not inspected".

**Trade-off matrix (Area 3)**

| Alternative | Technical feasibility | User impact | Simplicity | Risk | Scalability |
|---|---|---|---|---|---|
| 3A In-process | High — ~40 lines, injected clock | High — honest users never hit 10 failures; Polish 429 message | High — no schema, no dependency | Low-Medium — restart/multi-worker reset | Medium — single instance only (documented state) |
| 3B DB counter | Medium — new table + Core writes + separate commit | High | Low | Low operationally, Medium for lock interaction | High |
| 3C None | High | High (no 429 ever) | Very high | Medium — violates F4 unless ≥40 bits | High |
| 3D nginx | Medium — config not inspected | Low — NAT collateral throttling | High in app, Medium in ops | High — per-IP bypassable | High |

**Recommendation (Area 3)**: **3A**, optionally **3D later as defence-in-depth** (deferred). Why not 3B: a counter table is the right answer only once the single-instance assumption breaks; migrate then. Why not 3C: it moves the burden to the format and still leaves the app with no throttle anywhere. Why not 3D alone: per-IP keying is the documented failure mode.

---

### Decision Area 4 — Generation & rotation semantics

**4A. Lazy get-or-create on organizer `GET /api/groups/{id}/join-code`** — recommended
- Description: `get_or_create_join_code`: `get_group` (404) → `_require_active_organizer` (403) → `visibility != PRIVATE` → 409 → `if join_code is None: generate + commit`; `POST …/regenerate` overwrites.
- Strengths: no backfill revision; no side effect in `create_additional_circle`/`update_group` (keeps `test_group_privacy.py:139-162` "visibility flip has no side effect" valid); precedent `get_or_create_active_group_role`; pre-existing PRIVATE groups covered the first time the organizer opens the card.
- Weaknesses: a visitor who redeems before the organizer ever opened the card gets the generic 409 — acceptable since the organizer must share the code first; a GET with a side effect (commit) is slightly unorthodox (tolerated: same as `get_or_create_active_group_role`).
- Best when: the organizer surface (Area 8) always fetches the code when showing a PRIVATE group, so "no code yet" is unreachable in practice.
- Evidence: synthesis C8; report §5.1 "Pierwsze wygenerowanie"; D5.

**4B. Eager at group creation / PRIVATE switch + backfill data migration (0061)**
- Description: generate in `create_additional_circle` and in `update_group` when visibility becomes PRIVATE; one data migration fills `join_code` for existing PRIVATE rows.
- Strengths: invariant "PRIVATE ⇒ code" holds in the DB; organizer GET becomes a pure read; redeem-before-first-view impossible.
- Weaknesses: two new side effects in existing use cases + a data migration separate from the schema one (`migrations.md` B3/B4); Python-side `secrets` cannot run inside Alembic SQL without a Python data step; the "visibility flip has no side effects" test must be rewritten; PUBLIC→PRIVATE→PUBLIC leaves a stale code or adds a clearing branch.
- Best when: the code must be shown in contexts that cannot call the organizer endpoint (e.g. e-mail on creation).
- Evidence: report D5 alternative; `docs-standards-design-checklist.md` B3/B4; `test_group_privacy.py:139-162`.

**4C. Explicit organizer "Wygeneruj kod" action with a "brak kodu" state**
- Description: no code until the organizer clicks; the card shows "Ta grupa nie ma jeszcze kodu" and a generate button; regenerate is the same action.
- Strengths: pure GET; organizer consciously opts in; simplest backend (one POST).
- Weaknesses: extra UI state and an extra click on the main onboarding path (PRIVATE is the default for Organization-less founders — synthesis V9); stepper done screen would need the click too; "no code" vs "wrong code" still shares one 409 for visitors.
- Best when: generating a code is a meaningful decision (e.g. legal acceptance) rather than a default.
- Evidence: synthesis V9; `codebase-frontend-removal-inventory.md` row 19 + §4.

**4D. Lazy + automatic periodic rotation (expiry)**
- Description: 4A plus `rotated_at` naive-UTC marker and auto-regeneration after N days.
- Strengths: limits the blast radius of a leaked code without organizer action.
- Weaknesses: silently breaks printed/pinned codes; needs a UTC marker column, clock-patched tests (E1/E4 friction), copy explaining expiry; prior L4 declined expiry for requests and synthesis C4 re-declined it for codes; Slack's 30-day expiry is a second-hand reference.
- Best when: codes circulate widely (public events) rather than inside a known circle.
- Evidence: synthesis C4; prior-research-decisions L4/OQ-2; report §5.1 "Wygaśnięcie: brak".

**Trade-off matrix (Area 4)**

| Alternative | Technical feasibility | User impact | Simplicity | Risk | Scalability |
|---|---|---|---|---|---|
| 4A Lazy | High — one use case, no data migration | High — code is simply there when the organizer looks | High | Low — side-effecting GET is a precedented pattern | High |
| 4B Eager + backfill | Medium — two side effects + Python data migration | High — invariant holds | Low-Medium | Medium — touches creation/update paths and an existing test | High |
| 4C Explicit action | High | Medium — extra click on the default onboarding path | Medium — extra UI state | Low | High |
| 4D Auto-rotation | Medium — marker column + clock tests | Low-Medium — surprise invalidation | Low | Medium — confusing failures | High |

**Recommendation (Area 4)**: **4A**. Why not 4B: it buys an invariant nobody reads at the price of a data migration and two side effects. Why not 4C: it taxes the default onboarding path. Why not 4D: expiry re-declined (C4); rotation stays a conscious organizer action with the confirm sheet.

---

### Decision Area 5 — Visitor UX for code entry on the TermPage gate

**5A. `ModalSheet`-based `JoinByCodeSheet` opened by "Mam kod dostępu", `?code=` prefill + one-shot auto-submit** — recommended
- Description: gate keeps `KragStage` + `GroupHeader` + `CARD` + `h2 "Ta grupa jest prywatna"`; branch `canEnterCode` renders text + primary button (`aria-haspopup="dialog"`); sheet has one numeric field (`inputMode="numeric"`, `autoComplete="one-time-code"`, `parseJoinCode`, inline `role="alert"`); `TermPage` reads `?code=` once `/access` is loaded and not stale, prefills, submits once (guarded effect), then strips with `replace: true`; logged-out visitors keep `?code=` in the URL so `returnTo` carries it through login.
- Strengths: reuses `ModalSheet` (focus trap, Esc, scrim, `useRegisterOpenSheet` — `accessibility.md` H1/H2) instead of the hand-rolled `RequestAccessDialog` chrome; the strip pattern exists (`PanelPage.tsx:44-59`, `OrganizerTermsPage.tsx:28-55`); `returnTo = pathname + search` already preserves the param (`AuthGateSheet.tsx:7-10`, `LoginPage.tsx:15,23`, `api/client.ts:37-42` — synthesis V8); members opening a `?code=` link get an error-free idempotent 200 (Area 7); one new gate branch only.
- Weaknesses: auto-submit on behalf of the user spends one limiter attempt on a mistyped link; the effect needs a re-entry guard; a wrong deep-link code leaves the sheet open with the error, which is correct but may surprise.
- Best when: the dominant sharing channel is the "Kopiuj link z kodem" button (Area 8), so most visitors never type.
- Evidence: `codebase-frontend-reusable-patterns.md` §1.2, §2.2, §4.1; report §6.1-6.2; synthesis patterns 4-6.

**5B. Inline code field directly in the gate card (no dialog)**
- Description: the gate card itself holds label + input + "Dołącz"; no sheet.
- Strengths: one fewer click; no dialog registration; the whole flow is visible at once; natural for a prefilled `?code=` (the field is already on screen).
- Weaknesses: the gate is also the `loginRequired`/`stale`/`refreshError` surface — an inline form crowds the card and the `role="status"` region; existing tests key on the gate heading and the sheet behaviour (`TermPage.test.tsx:569-731`) would be rewritten rather than retargeted; a focused input inside a card with a refresh banner has weaker focus management than `ModalSheet`'s return-to-opener.
- Best when: the gate is the only state of the page and there is no secondary content.
- Evidence: `PrivateGroupGate.tsx:131-139,204-252` structure; `accessibility.md` H1-H5.

**5C. `ModalSheet` sheet, `?code=` prefill only (manual "Dołącz")**
- Description: as 5A but the deep link only opens the sheet with the field filled; the user presses "Dołącz".
- Strengths: no automatic request on page load; no guarded effect; the user sees the code before it is sent; zero limiter spend on bad links.
- Weaknesses: one extra tap on the path the user called painful; a member opening the link still sees the sheet unless `view` short-circuits first (it does — `resolveTermAccess` runs before the sheet); marginally more test cases (prefill + manual).
- Best when: the team wants to avoid any side-effecting navigation.
- Evidence: report D6 alternative; `codebase-frontend-reusable-patterns.md` §4.3 (flow Medium confidence).

**5D. Dedicated `/join/:groupId` route with its own page**
- Description: a standalone page (outside `TermPage`) that takes the code and redirects to the term afterwards.
- Strengths: clean separation; `?code=` handling lives in one place; could later serve group-level (not term-level) invites.
- Weaknesses: the user's pain is term-centric — the shared artefact is the term link; a second route means a second `AuthGuard`/`returnTo` round-trip and loses the gate context (group name, organizer); `router.tsx:162-164` term route works without `AuthGuard` already; more files than the one-branch change.
- Best when: invites are group-level and terms are secondary.
- Evidence: report §7 flow table (term link is the entry point); `codebase-frontend-removal-inventory.md` F21.

**Trade-off matrix (Area 5)**

| Alternative | Technical feasibility | User impact | Simplicity | Risk | Scalability |
|---|---|---|---|---|---|
| 5A Sheet + auto-submit | High — shells exist, strip pattern exists | High — link tap = joined; typed path 2 taps | Medium — guarded effect, strip logic | Low-Medium — auto-request spends one attempt on bad links | High |
| 5B Inline field | High | Medium-High — fewest taps, crowded card | Medium — gate tests rewritten | Medium — weaker focus management, crowded status region | High |
| 5C Sheet + prefill | High | Medium — extra tap on the painful path | High — no effect guard | Low | High |
| 5D Dedicated route | Medium — new route + guard wiring | Low-Medium — loses term context | Low | Medium — second returnTo hop | High — group-level invites later |

**Recommendation (Area 5)**: **5A**. Why not 5B: it rewrites the tested gate instead of adding a branch and gives up `ModalSheet`'s a11y guarantees. Why not 5C: it keeps the extra tap the user is complaining about; if the team is uneasy about auto-submit, 5C is a one-line switch (remove the effect) and the cleanest fallback. Why not 5D: wrong centre of gravity (term, not group).

---

### Decision Area 6 — Migration/cutover of existing PENDING join requests

**6A. Abandon PENDING rows at 0060 with a documented notice** — recommended
- Description: `0060_drop_group_join_requests.py` deletes `GROUP_JOIN_%` notifications, drops `notifications.join_request_id`, drops `group_join_requests`; the revision docstring records that pending requests are not migrated (precedent 0041/0048 "data not reconstructible").
- Strengths: no pre-deploy choreography; the app is pre-production (report R1, R10); requesters re-enter via code which the organizer now controls; migration test downgrade→upgrade stays simple.
- Weaknesses: anyone waiting on a request gets nothing — no notification, no membership; organizers lose the list of who asked.
- Best when: the PENDING count is ~0 (pre-prod); verify with a read-only `SELECT count(*) … WHERE status='PENDING'` before deploy.
- Evidence: report R1, D3, §5.6; `prior-research-decisions.md` OQ-4; U12 "PENDING cannot be migrated in SQL".

**6B. Auto-approve script before deploy (old `approve_join_request`)**
- Description: a one-off `scripts/approve_pending_join_requests.py` run with the *old* image, calling `approve_join_request` per PENDING row, before 0060 is applied.
- Strengths: nobody is stranded; reuses tested code; same shape as `scripts/withdraw_unmoderated_listings.py` (idempotent, one transaction per row, exit 1 on failure — `architecture.md` l.100).
- Weaknesses: silently grants access the organizer never approved — contradicts the organizer's authority the new mechanism preserves via the code; requires two-step deploy (old image script → new image migrate); cannot run inside Alembic (needs `GroupRole` MEMBER creation — U12).
- Best when: real users are known to be waiting and organizers consent.
- Evidence: report R1 mitigation; `architecture.md` cutover script precedent; U12.

**6C. Keep the table read-only for one release, drop in 0061**
- Description: 0060 removes only the API/UI; the table and column remain untouched for one release; the drop lands in a later revision.
- Strengths: reversible cutover; organizers could be told who had asked (manual follow-up).
- Weaknesses: `GroupJoinRequest` model/enum must either stay (dead code) or the table becomes orphaned schema; `GROUP_JOIN_*` notification rows must still be deleted now because the string-backed enum fails on unknown values (synthesis V6) — so the "read-only" value is mostly lost; two destructive revisions instead of one.
- Best when: production data exists and a rollback window matters.
- Evidence: synthesis V6; `migrations.md` B7 zero-downtime awareness.

**6D. Notify requesters once with the organizer's code**
- Description: before dropping, insert one notification per PENDING requester with `link_path` to the term; optionally embed the (lazily created) code.
- Strengths: closes the loop for requesters.
- Weaknesses: the organizer's code generated and sent without the organizer's action breaks the "organizer shares the code" model; needs a new notification kind (≤30 chars) created only to be used once; requires Python (secrets) in a data migration; leaks the code to someone the organizer may have rejected.
- Best when: never under the current ownership model — included as a genuine but rejected option.
- Evidence: `prior-research-decisions.md` OQ-4 option 3; report §4.5 "no new notification kind".

**Trade-off matrix (Area 6)**

| Alternative | Technical feasibility | User impact | Simplicity | Risk | Scalability |
|---|---|---|---|---|---|
| 6A Abandon | High — one revision | Low for anyone pending (likely none) | High | Low (pre-prod), Medium if users exist | n/a |
| 6B Auto-approve script | Medium — old-image step before migrate | High for requesters, Medium for organizers (unconsented members) | Medium | Medium — grants unreviewed access | n/a |
| 6C Read-only release | Medium — dead model or orphaned table | Medium | Low | Low-Medium | n/a |
| 6D Notify once | Low-Medium — Python data step, new kind | Medium | Low | High — code sent without organizer action | n/a |

**Recommendation (Area 6)**: **6A** with a pre-deploy count check; **6B** is the documented escape hatch if the count is non-zero and organizers agree. Why not 6C: the enum constraint forces the destructive data step anyway, so a "read-only" release is schema theatre. Why not 6D: it hands out the organizer's secret on their behalf.

---

### Decision Area 7 — Response semantics for redeem (wrong code / no code / already member)

Exposed by synthesis C6/C7; the three alternatives differ in what the visitor learns and how the frontend branches.

**7A. 401 → 404 → 429 → 409 (one generic message) → 200 idempotent** — recommended
- Description: unknown/deleted/PUBLIC group → 404 (as `create_join_request` today); wrong code *and* "no code yet" → `BusinessConflictException` 409 with one Polish message; existing member with a correct code → `200 {created: false}`.
- Strengths: no oracle on group state (prior A4/L9); 409 passes Polish text verbatim through `serverMessageOr` (`problem.ts:67-79`), unlike 403's global `ACCESS_DENIED_MESSAGE` or 404's fixed English; idempotent 200 makes the `?code=` path error-free for members (prior L2 convergence); error order matches L8 (401 first).
- Weaknesses: a member with a *wrong* code also gets 409 (they could be short-circuited by `view` on the client, so it never surfaces in practice).
- Best when: always for this app's "private means private" posture.
- Evidence: synthesis C6, C7; `docs-standards-design-checklist.md` D2-D5; prior A4(c), L2, L8, L9.

**7B. Distinct statuses: 403 wrong code, 409 already member, 404 no code**
- Description: map each condition to its own status so the client can branch precisely.
- Strengths: explicit; API consumers can distinguish.
- Weaknesses: leaks whether a group has a code (existence oracle); 403 renders the misleading global "Nie masz uprawnień…" message on the frontend (D2); "already member" as an error breaks the deep-link path for members; more frontend branches and tests.
- Best when: an external API client needs the distinction — none exists.
- Evidence: checklist D2; synthesis C6.

**7C. Always 200 with a `result` enum (`joined | already_member | invalid`)**
- Description: never error on a submitted code; the body carries the outcome.
- Strengths: single happy path in the hook; no exception types.
- Weaknesses: a wrong code as 200 defeats `queryClient`'s 4xx/5xx retry split and the `extractProblemMessage` convention (`data-fetching.md` G3); the limiter's 429 must still be an error, so the "no errors" promise is false anyway; REST standard (`api.md`) expects failure statuses.
- Best when: RPC-style APIs; not this codebase.
- Evidence: `data-fetching.md` G3; `api.md`.

**Trade-off matrix (Area 7)**

| Alternative | Technical feasibility | User impact | Simplicity | Risk | Scalability |
|---|---|---|---|---|---|
| 7A Generic 409 + idempotent 200 | High — existing exception + handler | High — clear Polish message, deep link works for members | High — one error branch in the sheet | Low | High |
| 7B Distinct statuses | High | Medium — misleading 403 copy, member deep-link error | Medium | Medium — existence oracle | High |
| 7C 200 + enum | High | Medium | Medium — breaks hook conventions | Medium | High |

**Recommendation (Area 7)**: **7A**. Why not 7B: oracle + the app-wide 403 message. Why not 7C: fights the data-fetching conventions and still needs 429.

---

### Decision Area 8 — Organizer surface placement and gating

Exposed by synthesis §5.4 and V9 (PRIVATE is the default visibility for Organization-less founders).

**8A. `JoinCodeCard` on `GroupDetailsPage` + the `CreateGroupStepper` done screen, card hidden on 403** — recommended
- Description: `hooks/useJoinCode.ts` (`["groupJoinCode", groupId, username]`, `enabled` when PRIVATE); card under `GroupDetailsCard` with "Kopiuj kod", "Kopiuj link z kodem", "Wygeneruj nowy kod" (confirm sheet); stepper done screen fetches the same GET; members (who can open the page) see no card because the GET 403s and `queryClient` does not retry 4xx.
- Strengths: both places where organizers meet the code (first contact on the stepper; ongoing on the group page); link built from `origin + termPublicPath` (`ShareButton.tsx:13-14` hygiene); clipboard + toast precedents (`SpotkaniaView.tsx:165-178`); hook shape per `data-fetching.md` G1-G4.
- Weaknesses: one extra request for members (a 403) to decide card visibility, because `GroupResponse` has no `is_organizer`; two surfaces to keep in copy-sync.
- Best when: now — no `is_organizer` flag exists and adding one is out of scope.
- Evidence: report §6.3; synthesis §5.4, §7 "GroupResponse exposure"; `codebase-frontend-reusable-patterns.md` §3.1.

**8B. `GroupDetailsPage` only (stepper unchanged except copy)**
- Description: show the code only on the group page; the stepper's done screen just says where to find it.
- Strengths: one surface; fewer tests; the stepper stays a pure creation flow.
- Weaknesses: the first-run organizer must navigate once more to get the code they will share immediately; stepper copy today promises "osoby z linkiem poproszą o dołączenie" and must change anyway.
- Best when: the stepper is expected to be rarely used for PRIVATE groups — contradicted by V9.
- Evidence: `CreateGroupStepper.tsx:138-170`; synthesis V9.

**8C. Code embedded in `GroupResponse` for organizers (`join_code` field, null for others) + `is_organizer`**
- Description: extend `GET /api/groups/{id}` to include the code when the caller is the organizer; no separate GET.
- Strengths: no extra request; card visibility decided from the same payload.
- Weaknesses: `GET /api/groups/{id}` is a READ-row route without an organizer check (`router/circles.py:303-307`) — the service would gain caller-dependent response shaping; exact key-set assertions across `GroupResponse` tests change; mixes a secret into a widely used DTO (report I5 insists `join_code` never appears there).
- Best when: an `is_organizer`/viewer-context field is added to `GroupResponse` for other reasons.
- Evidence: report §5.1 "Ekspozycja: nigdy w GroupResponse"; `codebase-backend-reusable-and-migrations.md` §2.

**8D. Code shown in a share sheet from the public term page (organizer viewing their own term)**
- Description: when the organizer opens the public term page, the existing `ShareButton` offers "Kopiuj link z kodem".
- Strengths: shares from the place the organizer actually sends links from.
- Weaknesses: the public page is built on the reduced `/access` payload and `PublicTermView` — adding organizer-only fetches there expands the public surface; discoverability lower than the panel; still needs the panel card for regeneration.
- Best when: as a later complement, not the primary surface.
- Evidence: `ShareButton.tsx:13-35`; synthesis pattern 7.

**Trade-off matrix (Area 8)**

| Alternative | Technical feasibility | User impact | Simplicity | Risk | Scalability |
|---|---|---|---|---|---|
| 8A Page card + stepper, 403-gated | High — hook + card + stepper fetch | High — code at first contact and on return | Medium — two surfaces, one hook | Low — extra 403 request for members | High |
| 8B Page only | High | Medium — extra navigation on first run | High | Low | High |
| 8C In `GroupResponse` | Medium — caller-dependent DTO, matrix untouched | High | Medium | Medium — secret in a shared DTO | High |
| 8D Public-page share sheet | Medium | Medium | Low (still needs the card) | Medium — grows public surface | High |

**Recommendation (Area 8)**: **8A**. Why not 8B: V9 makes the stepper the first contact for most organizers. Why not 8C: it puts a secret in the general-purpose DTO the research explicitly fenced off. Why not 8D: complement at best; deferred.

---

## Trade-Off Analysis — consolidated view of the recommended combination

| Perspective | Assessment of the combination (1A+2A+3A+4A+5A+6A+7A+8A) | Main tension accepted |
|---|---|---|
| Technical feasibility | High — stdlib `secrets`/`compare_digest`, one column, one use-case module, one router, one exception/handler, one matrix row, two revisions, one sheet, one card, one hook; every shell exists (synthesis §5.1, V1-V4). | Side-effecting organizer GET (precedented). |
| User impact | High — visitor: link tap or 9 typed digits → member → RSVP with zero RSVP changes (synthesis §5.3); organizer: code at first contact + copy/regenerate. | Auto-submit may spend one attempt on a mistyped link. |
| Simplicity | High-Medium — the change is mostly deletion (~280 lines of use cases, 41 backend tests); new concepts: limiter + 429. | The limiter is the only genuinely new mechanism in the codebase. |
| Risk | Medium — security of 9 digits is contingent on the limiter; in-process counter is single-instance; OQ-8 duplicate memberships and OQ-10 returnTo remain. | Accept contingent security in exchange for the user's reference format; fallback to 1B is cheap (regex + generator + normaliser). |
| Scalability | Medium-High — one code per group scales with groups; limiter must move to DB (3B) if the deployment grows beyond one process. | Documented single-instance assumption (`architecture.md`, `security.md` l.67). |

---

## Recommended Approach

**Combination**: 1A (9 digits + per-user limiter) · 2A (plaintext `groups.join_code`) · 3A (in-process limiter, 429 + `Retry-After`) · 4A (lazy get-or-create, explicit regenerate) · 5A (`JoinByCodeSheet` on `ModalSheet`, `?code=` prefill + one-shot auto-submit, `?code=` preserved through login via `returnTo`) · 6A (abandon PENDING with pre-deploy count check) · 7A (401→404→429→409→200 idempotent) · 8A (`JoinCodeCard` on `GroupDetailsPage` + stepper done screen, hidden on 403).

**Primary rationale**: It is the only combination that honours the user's reference product (typed 9-digit code) while satisfying the entropy rule from the literature (throttle below 64 bits), and it does so with zero new dependencies, zero changes to `/access`, `create_rsvp` or the organizer page, and the smallest schema delta (one nullable column). Every UI piece reuses an existing shell (`PrivateGroupGate`, `ModalSheet`, `CapacityField` pattern, `GroupDetailsPage`, `CreateGroupStepper`, strip-param pattern, `returnTo` plumbing).

**Trade-offs accepted**
- Security of the format depends on shipping the limiter (not on entropy alone).
- Plaintext secret at rest; revocation only by regenerating for everyone.
- Limiter state is per-process and resets on restart.
- PENDING requests are not migrated.
- An extra 403 request for members on `GroupDetailsPage` to decide card visibility.

**Key assumptions (if wrong, the recommendation changes)**
1. The backend stays a single uvicorn process/instance (→ otherwise 3B DB counter, or 1B to decouple from the limiter).
2. The limiter ships in the same iteration (→ otherwise 1B Crockford-8; never 9 unthrottled digits).
3. PENDING count at cutover is ≈0 (→ otherwise 6B auto-approve script with organizer consent).
4. The term link remains the shared artefact (→ otherwise 5D group-level route).
5. No external API consumer needs distinct error statuses (→ otherwise 7B).

**Confidence**: **High** for areas 2, 4, 6, 7, 8 (standards and precedents constrain them tightly); **Medium** for areas 1, 3, 5 (defensible design choices whose attack-rate and UX assumptions are not measured — report §5.2 notes the rates are assumptions; `?code=` flow is Medium in `codebase-frontend-reusable-patterns.md` §4.3).

## Why Not Others

| Area | Rejected | Why not (one line) |
|---|---|---|
| 1 | 1B Crockford-8 | Letter alphabet on mobile and divergence from the reference; kept as the fallback if the limiter is dropped. |
| 1 | 1C 10–12 digits | 10 still needs a limiter; 12 is hard to dictate; neither matches the reference. |
| 1 | 1D Link token | Not a typed code — contradicts the user's model and puts the whole secret in URLs. |
| 2 | 2B Codes table | Speculative fields (expiry, max-uses, per-invite) the brief does not ask for (J1). |
| 2 | 2C Hashed | Show-once breaks "Kopiuj kod" on later visits for a low-value secret. |
| 2 | 2D Derived | No rotation; id-derived values are explicitly "not a secret" in this codebase. |
| 3 | 3B DB counter | Right answer only once single-instance breaks; counters on `groups` fight the optimistic lock. |
| 3 | 3C None | Leaves OQ-3 open and violates F4 unless the format changes. |
| 3 | 3D nginx | Per-IP keying is the documented failure mode (F5); complement at most. |
| 4 | 4B Eager + backfill | Two side effects + data migration + rewrites an existing invariance test. |
| 4 | 4C Explicit action | Extra click on the default onboarding path (V9). |
| 4 | 4D Auto-rotation | Expiry re-declined (C4); surprise invalidation. |
| 5 | 5B Inline field | Rewrites the tested gate and loses `ModalSheet` a11y guarantees. |
| 5 | 5C Prefill only | Keeps the extra tap on the painful path; clean fallback if auto-submit is rejected. |
| 5 | 5D Dedicated route | Term, not group, is the centre of gravity. |
| 6 | 6B Auto-approve | Grants access the organizer never approved; escape hatch only. |
| 6 | 6C Read-only release | Enum constraint forces the data step anyway — no real reversibility gained. |
| 6 | 6D Notify once | Sends the organizer's secret without the organizer. |
| 7 | 7B Distinct statuses | Existence oracle + misleading global 403 copy. |
| 7 | 7C 200 + enum | Fights `data-fetching.md` conventions; 429 is an error anyway. |
| 8 | 8B Page only | First-run organizers (PRIVATE default) must navigate again. |
| 8 | 8C In `GroupResponse` | Secret in the general-purpose DTO the research fenced off. |
| 8 | 8D Public share sheet | Grows the public surface; still needs the panel card. |

## Deferred Ideas

| Idea | Classification | Why worth revisiting |
|---|---|---|
| Hybrid: keep organizer approval as a per-group toggle alongside the code | Out of scope (user decision: full replacement) | Would reintroduce the pending-action machinery; only if organizers ask for vetting later. |
| Per-invite codes table with expiry / max-uses / per-code revocation (2B) | Out of scope | Needed only if per-person invites or time-boxed codes become a requirement. |
| Organizer notification "X dołączył(a) kodem" (prior OQ-5, report D4) | Stretch | Members list on `GroupDetailsPage` covers it now; a new kind must be ≤30 chars and wired through `notifications_bridge`. |
| Partial unique index on active memberships `(from_role_id, to_group_id) WHERE valid_to IS NULL` (OQ-8, report D7) | Stretch — separate revision | Closes the double-submit race; independent of join-by-code. |
| `returnTo` same-origin validation `startsWith("/")` in `LoginPage`/`AuthGuard` (OQ-10, R6) | Stretch — tiny | Deep links with `?code=` increase login round-trips; a one-line guard. |
| nginx `limit_req` on the redeem path as defence-in-depth (3D) | Stretch — ops | Complements the per-user limiter; config not yet inspected. |
| Per-group circuit breaker (e.g. 100 failures/h locks the code) | Out of scope | DoS-able by design (F5); revisit only with abuse data. |
| DB-backed limiter (3B) when scaling beyond one process | Out of scope now | Trigger: more than one backend worker/instance. |
| `is_organizer`/viewer-context field on `GroupResponse` | Out of scope | Would remove the 403 probe for card visibility; broader DTO change. |
| "Kopiuj link z kodem" from the public term page `ShareButton` for organizers (8D) | Stretch | Convenience once the panel card exists. |
| Member-side revocation UI ("remove member + regenerate code", OQ-6) | Out of scope | Only revocation path with a shared secret; PG20 scoped it out. |
| API privacy gaps outside `/access` (OQ-9, R7) | Out of scope — separate task | Larger "private means private" hole than any code decision. |
| Rotation timestamp "wygenerowano …" on the card | Out of scope | Add only when the UI needs it; naive-UTC marker per `time.md`. |
| Producing the missing `external-product-patterns.md` (Classroom/Slack first-hand) | Out of scope | Would only firm up vendor comparisons; does not change the entropy-based recommendation. |
