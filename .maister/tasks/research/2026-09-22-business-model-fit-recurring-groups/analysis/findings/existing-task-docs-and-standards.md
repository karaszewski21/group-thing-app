# Findings: Existing Task Docs & Standards (Supporting/Constraining Context)

**Source category**: existing-task-docs-and-standards
**Role**: Background/constraint context only. Primary evidence on the actual groups/membership/term domain model comes from other gatherers reading `app/groups/*` and the frontend directly — this file does NOT re-derive that evidence, and should not be used to answer membership/promotion questions.

---

## 1. `.maister/tasks/development/2026-09-20-wizualizacja-grupy/` (group visualization task)

**Scope note (important)**: This task is about the `/krag/:groupId` **visualization layout** (circle/pitch/table display modes) and an "items to exchange" card. It explicitly does **not** touch membership semantics, ad-hoc signup, or promoting a term's attendees into a standing group. Any structural facts below are incidental discoveries from that unrelated work, not conclusions about membership design — flagging so the research doesn't over-read them.

Source: `.maister/tasks/development/2026-09-20-wizualizacja-grupy/analysis/codebase-analysis.md`

Confirmed structural facts (with citations from that report):
- `Group` model (`src/backend/app/groups/models.py:61-70`) is described as "minimal" — currently just `id`/`created_at`/`updated_at` + `party_id`, `name`; no `layout_mode` field yet (this task proposes adding one, migration `0035_group_layout_mode.py`, confirmed as now present per git status). This is evidence the `Group` entity is intentionally small today, not evidence about how membership is (or isn't) modeled — that lives elsewhere in `models.py` (e.g. `TermAttendance`, per line 33) which this task's report does not analyze in depth.
- `models.py` (315 lines total) also defines `ItemListingPreference`, `SwapProposal`, `Term`, `NeededItem`, `Pledge`, `TermAttendance` (codebase-analysis.md:33) — i.e. `Term` and `TermAttendance` exist as distinct concepts from `Group`, consistent with the research brief's premise of a term/session vs. standing-group distinction, but this report does not describe their fields or relationship to `Group` membership.
- `KragFamily` (frontend, `src/frontend/src/hooks/useKragGrupy.ts:41-45`) is the frontend's representation of a group participant unit — carries `familyId: number`, `name`, `guardians` — i.e. **families**, not individual people, are the membership unit surfaced on the group screen. (codebase-analysis.md:26-27)
- `src/backend/app/families/models.py` (101 lines) is noted as "structurally identical to `Group`" (id/created_at/updated_at + presumably a name/party_id shape) but is explicitly called out as "reference pattern only, not a target of change" in that task (codebase-analysis.md:73-74) — i.e. `Family` and `Group` are separate top-level entities.
- Backend DDD-lite layering confirmed here matches project memory: `service.py` is a pure re-export facade; real logic lives in `application/*.py` (codebase-analysis.md:137). Groups-specific: `application/circles.py::update_group` (108-116) is the real PATCH implementation; `router/circles.py` PATCH handler at 177-185, with "route ordering in file is load-bearing" per docstring (codebase-analysis.md:38-42).
- `authorization_matrix.py` has blanket rules: `GET ^/api/groups(/.*)?$` → READ, `POST` → EDIT (codebase-analysis.md:54, citing authorization_matrix.py:102-103) — i.e. new group-scoped endpoints likely don't need new matrix rows unless they need a permission other than plain READ/EDIT.
- `PublicCircleResponse` / public view logic lives in `application/public_view.py::get_public_circle_view` (158-257), which selects the current/nearest `Term` (185-196) for the public link-based view (codebase-analysis.md:50-51). This confirms a public, term-scoped view exists, but the report does not describe signup/attendance-writing logic for that public view — that's for other gatherers to cover.

**Explicit scope boundary**: This report does not analyze `TermAttendance`, membership fixed-vs-ad-hoc semantics, or any "promote attendees to group members" capability. Treat any inference along those lines as out of scope for this source and unverified here.

---

## 2. `.maister/tasks/product-design/` directory

Contains one subdirectory: `2026-09-20-wizualizacja-grupy/` (the product-design phase feeding into the development task above — same feature, same scope boundary as Section 1). Files present:
- `analysis/alternatives.md`, `analysis/codebase-analysis.md`, `analysis/design-context.md`, `analysis/design-decisions.md`, `analysis/feature-spec.md`, `analysis/personas.md`, `analysis/problem-statement.md`
- `analysis/mockups/*.html` (3 layout mockups: boisko/kolo-mandala/stol)
- `context/*.png`, `context/README.md`
- `outputs/product-brief.md`
- `orchestrator-state.yml`

Read `outputs/product-brief.md` and `analysis/problem-statement.md` in full. Relevant to the recurring-groups research (as constraint/context, not primary evidence):

- Confirms `Group.layout_mode` (StrEnum, default `CIRCLE`) is the only new DB field this design introduced — explicit constraint: "no schema changes beyond one new field on `Group`" (problem-statement.md:17, product-brief.md:36, 45). This means as of this task's approval, `Group` gained exactly one field (`layout_mode`); nothing here relates to membership.
- Confirms the participant unit shown on the group screen is the **family**, not the individual — `GET /groups/{id}/families/{familyId}/exchange-offers`, 404 "for a family outside the group" (product-brief.md:50) — implying group membership is keyed by family membership in a group, at least for this view's purposes. This is a UI/API-contract observation, not a confirmed statement about the underlying membership data model (e.g., whether "family in group" is a join table, a computed set from attendance, or something else) — that must be verified against the actual `models.py`/`application/memberships.py` by the codebase gatherer.
- No content in this directory addresses ad-hoc/per-term signup, fixed vs. non-fixed membership, or converting term attendance into standing membership. Confirms this product-design effort is orthogonal to the current research question.

---

## 3. `.maister/docs/project/architecture.md`

**Caveat/flag**: This document describes a **different domain** than the one under research. It documents an "aj" plugin-based microkernel platform with verticals `category`, `product`, `plugin`, `footprint`, `auth`, `oauth2`, `system` (architecture.md:59-96), migrated from Java/Spring Boot (architecture.md:5, `.maister/tasks/migrations/2026-08-31-java-to-python-fastapi/`). It does **not mention** `groups`, `circles`, `families`, `terms`, or any krąg/group concept anywhere in its package-structure tree or content. The actual codebase (per git status and the wizualizacja-grupy task) clearly has `app/groups/`, `app/families/`, `app/core/authorization_matrix.py`, `app/groups/application/{circles,memberships,public_view,exchange_summary}.py`, etc. — none of which appear in this architecture doc.

**Conclusion**: `.maister/docs/project/architecture.md` is stale/out of sync with the actual group-thing-app codebase (it appears to document a template/prior-generation project state, possibly from an earlier or parallel scaffold). It should **not** be relied on for facts about the groups/circles bounded context or current `app/` package structure. This mismatch is itself a finding worth surfacing to the synthesizer as a documentation-debt observation, separate from the business-model-fit question.

What it *does* confirm reliably (general, stack-level facts likely still accurate since they concern cross-cutting infra, not domain):
- FastAPI + SQLAlchemy 2.0 async + `asyncpg` + Alembic + PostgreSQL stack (architecture.md:28)
- `app/core/base_model.py` (Base, `BaseEntity` mixin), `app/core/auth_deps.py` (`Principal`, `require_any()`, `AUTHORIZATION_MATRIX`) — the auth pattern named here matches what the wizualizacja-grupy report found live in `app/core/authorization_matrix.py` (Section 1 above), so this part of the doc is plausibly still accurate even though the vertical list is stale.
- No automated pytest suite is claimed to exist (architecture.md:31-32) — but this contradicts Section 1's finding that `src/backend/tests/test_circles_router.py`, `test_exchange_summary.py`, `test_group_layout_mode.py`, `test_group_privacy*` exist per git status (untracked, i.e. newly added, but present). This is further evidence the doc is stale and should be independently verified rather than cited for current test-infrastructure claims.

---

## 4. `.maister/docs/project/tech-stack.md`

Same staleness caveat as architecture.md applies to domain-specific claims (it also frames the whole project as the "aj" plugin platform). However, the SQLAlchemy/async version and convention info is general-purpose and likely still applicable to any new entity work in this codebase:

- SQLAlchemy 2.0.44, async, `asyncpg` 0.31.0 driver (tech-stack.md:21-24, 89-90)
- Declarative ORM (`Mapped[...]`/`mapped_column`) for CRUD verticals; SQLAlchemy Core `select()`/`text()` reserved for the two hand-rolled filter-DSL query services (tech-stack.md:22, 110) — not directly relevant unless a new "recurring group" concept needs a dynamic filter DSL, which is unlikely.
- Alembic 1.17.1 for migrations (tech-stack.md:26-28)
- Pydantic 2.13.5 for request/response schemas (tech-stack.md:30-31)
- `mypy --strict` is enforced (tech-stack.md:78-79) — any new entity/schema code must be fully typed.
- No automated pytest/TestContainers suite "yet" per this doc (tech-stack.md:42-44) — again contradicted by actual test files found in git status; do not treat this claim as current.

---

## 5. `.maister/docs/standards/backend/models.md` — rules a new entity must follow

This file is standards (not project-specific facts) and is more likely to still be normative even if the architecture/tech-stack docs' domain descriptions are stale. Concrete rules any new/modified entity (e.g. a hypothetical "membership promotion" or "recurring group" concept) must follow:

1. **BaseEntity mixin** (models.md:60-104): extend `app/core/base_model.py`'s `BaseEntity` abstract mapped-superclass for the standard `id`/`created_at`/`updated_at` shape. `id` is `BigInteger` + explicit Postgres `Sequence` (never `IDENTITY`/`SERIAL`) — each subclass sets `__tablename__` and `__sequence_name__`. `updated_at` doubles as the optimistic-lock `version_id_col` via a custom `version_id_generator` (models.md:85-98) — don't manage `updated_at` manually in application code.
2. **PK carve-outs** (models.md:107-111, 190-197): only skip `BaseEntity` if the PK strategy genuinely differs (business-supplied string key, or app-generated UUID) — precedents are `PluginDescriptor` (string PK) and `RegisteredClient` (UUID PK). A new membership/recurring-group entity should default to `BaseEntity` unless it has a real natural key.
3. **String-backed enums** (models.md:115-117): use `enum.StrEnum` stored as a `String` column, never integer/ordinal-backed. E.g., a new "recurring group source" or "membership type" flag should be a `StrEnum`.
4. **Relationships / eager loading** (models.md:121-130, 184-188): every `relationship()` must default to `lazy="raise"`; the querying call site must explicitly use `joinedload(...)`/`selectinload(...)`. No implicit lazy-load is possible under `AsyncSession` (`MissingGreenlet` otherwise). Only declare a `relationship()` direction that's actually queried somewhere (YAGNI).
5. **Cross-module references** (models.md:140-152): if a new membership/promotion concept needs to reference e.g. a `Term` or `Family` from a different module boundary, use a plain FK-id column (e.g. `term_id: int`), not a cross-module `relationship()`. Load related data explicitly at the query-service/service layer via an explicit join/eager-load scoped to that query, never as an always-loaded relationship on the model.
6. **Business-key identity** (models.md:156-160): `__eq__`/`__hash__` should use a business key when one exists, never the surrogate `id` (which is `None` pre-flush). Carve-out only for entities whose PK IS the business identifier (e.g. `PluginDescriptor`).
7. **JSONB usage** (models.md:38-48): use `postgresql.JSONB` only for genuinely schemaless, caller-defined data (e.g. plugin manifests) — not as a substitute for normalized child tables for this system's own domain concepts. A "recurring group" or "promoted-from-term" concept, being a first-class domain concept, should likely be a proper column/table, not JSONB.
8. **Model simplicity** (models.md:7-24): prefer plain columns/enums over a separate mapped class unless the concept needs identity/lifecycle/complex relationships. A simple "promoted_from_term_id" FK column on `Group` might suffice for a lightweight promotion marker; a full "GroupFormationEvent" entity would only be warranted if it needs its own lifecycle/audit trail.
9. **Soft delete**: not currently used anywhere (models.md:169-170) — if a promotion/undo concept needs reversibility, this codebase has no existing soft-delete convention to reuse; would need to be introduced explicitly if required.

---

## 6. `.maister/docs/standards/backend/api.md` — REST conventions for a new endpoint

This file is very short/generic (8 one-line rules, no project-specific examples):

- Resource-based URLs with appropriate HTTP verbs (GET/POST/PUT/PATCH/DELETE) (api.md:4)
- Consistent lowercase, hyphenated/underscored naming (api.md:7)
- Versioning (URL path or headers) for breaking changes (api.md:10) — note: no evidence elsewhere that this project currently versions its API (e.g. `/api/groups/...` has no version segment per Section 1's router citations); a "promote term to group" endpoint would likely follow existing unversioned convention rather than introduce one.
- Plural nouns for resources (api.md:13) — consistent with observed `/api/groups/{id}` pattern (Section 1).
- Limit nesting to 2-3 levels (api.md:16) — relevant if a promotion endpoint is nested like `/api/groups/{group_id}/terms/{term_id}/promote` (3 levels, at the limit) vs. a flatter alternative.
- Query params for filtering/sorting/pagination (api.md:19) — not obviously applicable to a one-shot promotion action.
- Proper status codes (api.md:22).
- Rate-limit headers (api.md:25) — no evidence this is actually implemented anywhere in the codebase from what's been read; likely aspirational/unenforced.

This is a generic checklist with no groups/circles-specific worked example (unlike `models.md`, which cites real project code). Treat it as a general style guide, not evidence of any existing "promote" endpoint pattern.

---

## Summary of Key Constraints for the Promotion-Flow Design (background only)

- Any new entity/field should follow `BaseEntity` + `StrEnum` + `lazy="raise"` + FK-id cross-module reference conventions (Section 5).
- No soft-delete or reversible-state convention exists yet in the codebase — a "promote and be able to undo" flow has no existing pattern to reuse (Section 5, item 9).
- The `Group`/`Family` split is already established: groups are keyed to families, not individuals, at least on the existing visualization/exchange screen (Sections 1-2) — but the actual mechanism linking families to groups (membership table vs. computed from attendance) was **not** confirmed by any source read here and must come from the primary codebase gatherer.
- `.maister/docs/project/architecture.md` and `tech-stack.md` contain a stale/mismatched description of the project's bounded contexts (they describe a "category/product/plugin/footprint" platform, not groups/circles/families) — flagged as a documentation-debt gap, and their domain-specific claims should not be cited as authoritative for this research; only their general stack-level statements (FastAPI/SQLAlchemy 2.0 async/Alembic/Postgres, mypy strict) are corroborated elsewhere and treated as reliable.
- The `wizualizacja-grupy` task (development + product-design) is confirmed out-of-scope for membership questions — it only added `Group.layout_mode` and exchange-summary aggregation endpoints; it did not touch `TermAttendance`, membership, or any promotion concept.

## Gaps / Not Covered By This Source

- No document read here describes `TermAttendance`, membership fixed-vs-ad-hoc semantics, `app/groups/application/memberships.py`, or any existing promotion capability — these require direct codebase reading (other gatherers' responsibility).
- `.maister/docs/standards/backend/migrations.md` and `security.md` were referenced by other docs but not read here (out of the assigned file list) — if promotion-flow design needs migration-sequencing or authorization-matrix specifics beyond the blanket rules already cited, those files should be consulted separately.
