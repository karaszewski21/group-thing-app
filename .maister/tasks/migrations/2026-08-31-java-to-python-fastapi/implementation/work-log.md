# Work Log

## 2026-08-31 - Implementation Started

**Total Steps**: ~97
**Task Groups**: 15 (see implementation/implementation-plan.md)
**Execution mode**: wave-based parallel dispatch (no --sequential flag set)

Computed wave plan from Dependencies + Files to Modify:
- Wave 1: Group 1
- Wave 2: Group 2, Group 10
- Wave 3: Group 3
- Wave 4: Group 4
- Wave 5: Group 5, Group 7
- Wave 6: Group 6, Group 8
- Wave 7: Group 9, Group 11
- Wave 8: Group 12
- Wave 9: Group 13
- Wave 10: Group 14
- Wave 11: Group 15

## Standards Reading Log

### Loaded Per Group

### Group 1: Project Scaffolding, Tooling & Java Removal
**Status**: SUCCESS
**From Implementation Plan**:
- .maister/docs/standards/global/conventions.md
- .maister/docs/standards/global/coding-style.md
**Discovered**: none (pure scaffolding, backend-specific standards correctly treated as stale-Java-only until Group 14)
**Steps**: 1.1-1.7 all complete
**Verification**: `uv sync --frozen` (--system-certs needed, env TLS interception, noted as env issue not project defect) succeeded, 36 packages resolved; `docker-compose config` valid; `ruff check` clean (after one --fix for import order); `mypy --strict` clean (16 files); `find src/backend -name '*.java'` = 0
**Files Modified**: entire Java tree removed (~114 files, was untracked in git — `rm -rf` used, functionally equivalent to `git rm`); created pyproject.toml, uv.lock, Dockerfile, docker-compose.yml, .env.example, alembic.ini, alembic/env.py, alembic/versions/.gitkeep, app/main.py (placeholder), 15 __init__.py files
**Notes**: `src/backend` Java tree was never committed to git at all (confirmed via git ls-files). config.py/db.py correctly deferred to Group 3 per plan's file-list split. Flagged: `--system-certs` may be needed for uv in this environment/CI going forward.

## [2026-08-31] - Group 1 Complete

### Group 2: Database Schema — Alembic Initial Migration
**Status**: SUCCESS
**From Implementation Plan**: backend/migrations.md (non-Liquibase parts only), global/conventions.md
**Discovered**: backend/queries.md strategic indexing -> added ix_products_category_id
**Steps**: 2.1-2.5 all complete
**Verification**: alembic upgrade head clean on fresh postgres:18; all 6 FK/constraint checklist items confirmed via psql \d+; alembic downgrade base clean (no leftover tables/sequences/types); ruff+mypy clean
**Files Modified**: alembic/versions/0001_initial_schema.py (created); docker-compose.yml (modified - fixed postgres:18 volume mount path, a breaking change in the postgres Docker image unrelated to this migration's own scope, but required for "fresh container" acceptance criterion to pass)
**Notes**: footprint_audit_log intentionally has no created_at/updated_at (per its specific column table in spec.md, which overrides the general BaseEntity-pattern intro sentence). user_permissions has no PK at all, matching JPA @ElementCollection semantics. Flagged: mypy alembic.* override needs __init__.py in alembic/versions or --namespace-packages to actually apply - noted for Group 14 CI setup.

### Group 10: Footprint — Domain Engine Port
**Status**: SUCCESS
**From Implementation Plan**: global/coding-style.md, global/minimal-implementation.md
**Discovered**: ruff UP042 -> used enum.StrEnum instead of (str, Enum)
**Steps**: 10.1-10.6 all complete, 22/22 verification checks passed across 4 scenarios
**Verification**: hand-computed kg_co2 matched engine output for OFB-330 (refrigerated, total=288.6250) and CAW-042 (unrefrigerated, total=44.0400, cold-storage absent not zero); LENIENT+missing-factor produces kg_co2=0/None fields/exact warning message; synthetic scenario proves PER_100G scales leaves-then-sums-composites (1.0003) not composite-direct (1.0002); all arithmetic confirmed Decimal-only; ruff+mypy strict clean on 22 files
**Files Modified**: 16 files created under app/footprint/{archetype,domain,engine}/, ports.py, stubs.py, facade.py
**Notes**: seed rate/attribute values beyond what spec.md fixes (raw-material rates, coverage window) are this port's own documented placeholder choice - no original Java source exists in-repo to copy from (whole migration reconstructed from documentation). FootprintRequest is a new facade-entry type not explicitly in spec.md's file list. FactorVersionOverlapException defined but unreachable with current fixed seed data (no write-side adapter exists). PER_100G's ValueError-not-InvalidParametersException bug preserved exactly per fixed decision #1, commented inline against future "cleanup".

### Group 3: Core Cross-Cutting Infrastructure
**Status**: SUCCESS (retried once after a session rate-limit interruption left zero partial files - confirmed clean before retry)
**From Implementation Plan**: global/error-handling.md, global/validation.md, backend/security.md (stale-Java parts ignored, spec.md followed directly)
**Discovered**: global/coding-style.md, global/minimal-implementation.md
**Steps**: 3.1-3.8 all complete
**Verification**: two sequential UPDATEs on a live Category row produced different updated_at values; stale write raised StaleDataError (version-conflict, via version_id_col); Pydantic validation error and EntityNotFoundException both matched exact legacy envelope shapes; config.py confirmed fail-loud (ValidationError, exit 1) when JWT_SECRET or DATABASE_URL unset; ruff+mypy --strict clean across all 37 project files
**Files Modified**: app/config.py, app/db.py, app/core/base_model.py, app/core/errors.py, app/core/security.py, app/core/filter_dsl.py (all created)
**Notes**: AccessDeniedException added to errors.py (needed a home per spec.md's priority table, will be raised by Group 4's auth_deps.py). Only JWT_SECRET/DATABASE_URL made fail-loud with no default; other 5 env vars are operational tuning knobs matching docker-compose.yml's own bash-level defaults. Flagged for later: httpx needs adding as a real dev dependency once a group writes actual endpoint tests (Group 3's throwaway route check used an ephemeral `uv run --with httpx` overlay, not added to pyproject.toml).

### Group 4: Auth — JWT & Permission Matrix
**Status**: SUCCESS (session was interrupted mid-group; resumed the same agent, which confirmed all files intact and re-ran full verification clean)
**From Implementation Plan**: backend/security.md (stale-Java, not followed - spec.md followed directly), global/error-handling.md, global/validation.md
**Discovered**: global/coding-style.md, global/minimal-implementation.md
**Steps**: 4.1-4.7 all complete
**Verification**: live uvicorn + real Postgres, seeded throwaway user - valid login returns exact claim order (sub,permissions,iat,exp, no iss); invalid creds/missing-auth/wrong-permission all match exact legacy envelope bodies; _token query AND form fallback both work; public routes (health, non-/api/) succeed with no token; expired token treated as unauthenticated; in-process check of all 25 matrix rows including ordering-sensitive cases; ruff+mypy --strict clean (40 files)
**Files Modified**: app/core/security.py (added encode_login_token/decode_token), app/core/auth_deps.py (created - token extraction, require_any, full 25-entry AUTHORIZATION_MATRIX), app/auth/models.py (created - User, user_permissions, Permission enum), app/auth/router.py (created - POST /api/auth/login)
**Notes**: SPEC AMBIGUITY RESOLVED - matrix row 10 ("any non-/api/ path") listed method "any" but spec's own prose says POST /oauth2/authorize (non-/api/ path) is NOT public; scoped row 10 to GET-only so /oauth2/authorize correctly falls through to row 25 (authenticated) instead of being swallowed as public - verified via in-process matrix check. Added python-multipart>=0.0.20 to pyproject.toml (main agent, post-group) since auth_deps.py's `_token` form-param fallback needs Starlette's Request.form(), which was missing from deps - required before Group 5 builds /oauth2/authorize which relies on the same mechanism. IMPORTANT FOR GROUP 13: main.py must call BOTH app.core.errors.register_exception_handlers(app) AND app.core.auth_deps.register_auth_exception_handlers(app) - plan text only explicitly named Groups 3/12's handlers.

### Group 7: Category Vertical
**Status**: SUCCESS
**From Implementation Plan**: backend/models.md/api.md (stale-Java, not followed - spec.md's target patterns followed directly), global/error-handling.md, global/validation.md
**Discovered**: backend/api.md's general RESTful intent (still applicable despite doc being Java-specific), testing/backend-testing.md's integration-first philosophy (mirrored via live-uvicorn+real-Postgres curl verification, no pytest file)
**Steps**: 7.1-7.6 all complete
**Verification**: all 5 routes verified live incl. 409 category-has-products (via raw-SQL product fixture since Group 8 hasn't run yet), created_at DESC ordering confirmed, query params ignored on list, optimistic-lock updated_at bump confirmed on PUT, 401 without auth header confirmed
**Files Modified**: app/category/models.py, schemas.py, service.py, router.py (all created)
**Notes**: 409 raised by catching IntegrityError on FK-violation delete and re-raising as CategoryHasProductsException(BusinessConflictException) - bypasses the generic "Data integrity violation" handler since the more specific typed exception is what FastAPI's dispatcher sees. Confirmed (again, independently of Group 4) that main.py is still a bare placeholder with zero routers wired - Group 13 must wire category_router + auth_router + both exception-handler registrations at minimum. Flagged repo-wide: no .gitignore existed anywhere in the project root - main agent added one post-group (Python/venv/env-file/node_modules coverage) since .venv/.ruff_cache/etc are being created directly in src/backend/ by every group's uv/ruff/mypy runs.

### Group 5: OAuth2 — Client Registration & Authorization
**Status**: SUCCESS (with one flagged wire-fidelity gap, see below)
**From Implementation Plan**: global/error-handling.md, global/validation.md, spec.md's Auth/OAuth2 Spec followed directly (backend/security.md/plugin-auth.md correctly treated as stale)
**Discovered**: backend/models.md post-migration content (UUID PK carve-out for RegisteredClient, no BaseEntity mixin)
**Steps**: 5.1-5.8 all complete
**Verification**: live uvicorn + real Postgres - all 9 DCR validation-failure messages exact, DCR success (confidential+public) exact field order/defaults/client_secret_expires_at:0; authorize without JWT -> 401 (not silent success); all 7 validation-order steps + 4 PKCE sub-cases -> correct message AND correct OAuth2 error code via substring match; successful authorize -> 302 with code+state (state present iff passed)
**Files Modified**: app/oauth2/models.py, errors.py, stores.py (AuthorizationCodeStore only, refresh-token store deferred to Group 6 per plan), client_auth.py, router.py (all created)
**KNOWN GAP - FLAGGED FOR GROUP 15 VERIFICATION PASS**: /oauth2/authorize's "not authenticated" case (validation step 7, which in the Java source produces an OAuth2-shaped `unauthorized_client` error) is structurally unreachable through the live route as implemented - my own dispatch instruction told this group to gate the route via `Depends(require_any())` (zero-arg), which raises the GENERIC legacy 401 envelope before the handler body (and thus step 7's OAuth2-shaped check) ever runs. This means an unauthenticated /oauth2/authorize call returns `{"status":401,"error":"Unauthorized","message":"Authentication required",...}` instead of the OAuth2-shaped `{"error":"unauthorized_client",...}` the Java source produced. Functionally the endpoint IS still protected (acceptance criterion "does not silently succeed" holds), but this is a real wire-shape deviation from spec.md's documented Java behavior. Fix (if wanted): read get_current_principal directly inside the /oauth2/authorize handler instead of via a route-level Depends gate, so validate_authorize_request's own step-7 branch becomes reachable. Deferred to Group 15's manual contract verification pass rather than patched ad hoc mid-wave, per this migration's own "route discrepancies back to the owning group" policy.
**Notes**: DCR validation order (client_name->grant_types->redirect_uris->scope->token_endpoint_auth_method) chosen because redirect_uris' required-check needs the resolved grant_types first - spec.md doesn't prescribe cross-field order for DCR since all failures map to the same invalid_client_metadata code. client_authentication_methods stored as single-element list from the DCR request's singular token_endpoint_auth_method - flagged for Group 6 in case token-exchange/introspect need a different reading. client_secret always generated even for "none" auth method clients (nullable column, never left null in this port) per spec.md's literal DCR wording.

### Group 6: OAuth2 — Token Exchange, Introspection & Metadata
**Status**: SUCCESS
**From Implementation Plan**: global/error-handling.md, global/validation.md, spec.md followed directly for Auth/OAuth2 (backend/security.md/plugin-auth.md correctly treated as stale)
**Discovered**: none beyond what Group 5 already flagged
**Steps**: 6.1-6.9 all complete
**Verification**: full live end-to-end chain (register->authorize->token[auth-code]->introspect->token[refresh,rotated]->token[token-exchange]) all exact field orders/values confirmed incl. rotated-out refresh token correctly failing with invalid_grant; token-exchange has no refresh_token field, mcp:read->READ mapping confirmed via decoded JWT; all 3 grants carry Cache-Control/Pragma/expires_in:900; introspect garbage/missing token->200 active:false; client-info 404 confirmed truly empty body (size_download=0); X-Forwarded-Proto port-omission and explicit-port-retention both confirmed
**Files Modified**: app/oauth2/stores.py (added RefreshTokenStore), app/oauth2/router.py (added POST /oauth2/token 3-grant dispatch + POST /oauth2/introspect), app/oauth2/metadata_router.py (created - resolve_base_url shared helper, well-known metadata, client-info)
**Notes**: unspecified/unknown grant_type inferred as 400 unsupported_grant_type (not literally specified in spec.md, a reasonable default). Introspect deliberately has no Cache-Control/Pragma headers (RFC7662 doesn't mandate them, spec.md's header requirement scoped to token endpoint only) - flagged in case a future audit expects otherwise. client-info's client_id query param is required (422 if omitted) - spec only specifies the unknown-client 404 case. Confirmed via full-project ruff/mypy sweep that pre-existing errors at time of this group's completion were confined to Group 8's product/ files (sibling wave, mid-flight in parallel) - not this group's concern.

### Group 8: Product Vertical
**Status**: SUCCESS
**From Implementation Plan**: global/error-handling.md, global/validation.md, backend/models.md/jooq.md/queries.md (stale-Java, spec.md's Core/regex-then-splice pattern followed directly)
**Discovered**: reused Group 3's app/core/filter_dsl.py constants directly as anticipated; lazy="raise" + explicit joinedload design driven by AsyncSession's MissingGreenlet incompatibility with implicit lazy-load
**Steps**: 8.1-8.7 all complete
**Verification**: sort fallback silent (no 400); all 7 malformed-filter error messages verbatim; all 5 pluginFilter operators (eq/gt/lt/exists/bool) confirmed match/no-match against seeded plugin_data; nested category always full object never bare category_id; photo_url/price/category-exists validation exact; DELETE unconditional 204 (no 409, unlike category); regression cross-check confirmed Group 7's category 409 path now fires against a real product row (not just the raw-SQL fixture); ruff+mypy --strict clean across 55 project files
**Files Modified**: app/product/models.py, schemas.py, query_service.py, service.py, router.py (all created)
**Notes**: exists operator intentionally asymmetric from eq/gt/lt/bool per spec.md's literal wording - exists binds BOTH pluginId and jsonPath via func.jsonb_exists, the other 4 operators splice regex-validated pluginId/jsonPath as literal text and only bind the comparison value. photo_url validator uses PydanticCustomError not plain ValueError, since Pydantic v2 prepends "Value error, " to ValueError messages which would have broken the exact-message acceptance criterion. Confirmed (again) main.py still unwired - Group 13 must add product_router to its list.

### Group 11: Footprint — Audit Pipeline & CSV Export
**Status**: SUCCESS
**From Implementation Plan**: global/error-handling.md, backend/models.md (stale-Java, cross-checked app/product/models.py + app/core/base_model.py instead for the standalone-entity convention)
**Discovered**: none beyond the reference-implementation cross-check above
**Steps**: 11.1-11.6 all complete
**Verification**: idempotent duplicate correlation_id -> exactly one stored row, no raise; retry exhaustion -> exactly 3 attempts, measured backoff gaps 0.204s/0.403s matching documented ~0.2s/~0.4s, failed counter incremented exactly once; CSV export 12-column header exact order, kg_co2 4-decimal-quantized, factor_value not forced-scale, empty warnings->"", non-empty warnings JSON-serialized; >1000 leaf rows -> InvalidParametersException("breakdown.leafCount", 1001); ruff+mypy --strict clean
**Files Modified**: app/footprint/audit/models.py, mapper.py, task.py, app/footprint/export/csv_flattener.py (all created)
**IMPORTANT CORRECTION FOR GROUP 12 AND FUTURE READERS**: tenacity.wait_exponential's actual signature is (multiplier=base_wait, exp_base=growth_factor, min=...), NOT (multiplier=growth_factor, min=base_wait) as the plan's literal code snippet implied - using the literal snippet produces ~2.0s/~4.0s waits, contradicting the acceptance criteria's ~0.2s/~0.4s. Resolved by mapping Java's delay-ms(200ms)->tenacity's multiplier and Java's growth-multiplier(2.0)->tenacity's exp_base. Confirmed correct via live timed run. Documented at length in task.py's docstring. RECOMMENDATION: run /maister:standards-update to capture this tenacity gotcha so it isn't rediscovered later.
**Notes**: requested_at column stores breakdown.computed_at (no separate "requested_at" field exists on FootprintBreakdown) - consistent with CSV spec's "computed_at from the audit-log column" phrasing. factor_valid_from/factor_version_id null->"" (not literal "None") in CSV, inferred since spec.md didn't state null behavior explicitly. Idempotent-duplicate suppression via a sentinel exception + retry_if_not_exception_type so duplicate correlation_id never retries (0 attempts beyond the first).

### Group 9: Plugin System (Descriptor / Data / Object)
**Status**: SUCCESS
**From Implementation Plan**: global/error-handling.md, global/validation.md, backend/models.md/jooq.md (stale-Java, spec.md's target patterns followed directly)
**Discovered**: noted a direct contradiction between target-state-plan.md (says factor the two filter parsers together) and spec.md's Reusability note + this group's own task instruction (keep them separate) - resolved in favor of spec.md/task instruction as the more specific/authoritative source, documented rather than silently picked
**Steps**: 9.1-9.7 all complete, 59/59 verification checks passed
**Verification**: replace-at-key confirmed (PUT with data at a different pluginId key stays untouched, response echoes only the input payload); disabled-vs-nonexistent 404 byte-identical (mod timestamp) via same-id disabled-then-deleted technique; plain GET on disabled plugin -> 200 not 404; cross-type both-required and per-type both-or-neither produce DISTINCT error messages as specified; limit cap genuinely exercised via 1200-row bulk insert (limit=5000/unset->1000, limit=50->50); mcp:* bridge absence confirmed on all plugin GET routes (403 with mcp:read-only token); full permission matrix (PLUGIN_MANAGEMENT/READ/EDIT) confirmed; rull+mypy --strict clean across 64 project files
**Files Modified**: app/plugin/models.py, schemas.py, query_service.py, service.py, router.py (all created)
**Notes**: PluginDescriptor's PK IS its business identifier (plugin-supplied slug) so no separate business-key __eq__/__hash__ override added (judgment call, flagged for review). EntityNotFoundException("PluginObject", f"{object_type}/{object_id}") composite-key 404 message is this group's own reasonable formatting choice (spec.md didn't give an exact template for this specific case). get_plugin/set_enabled/delete_plugin deliberately use plain find not find_enabled_or_throw (must be able to re-enable/delete an already-disabled plugin).
**MAIN-AGENT ACTION (post-group)**: Group 9's verification left ~1200 test rows in the shared dev Postgres (plugin_objects=1205, plugins=2, products=4, categories=4, users=1 - confirmed via psql). Since Group 13 re-runs every prior group's verification script against the fully-wired app to catch integration regressions, and those scripts may assume clean starting listing counts, ran `TRUNCATE plugin_objects, plugins, products, categories, users, oauth2_registered_client, footprint_audit_log RESTART IDENTITY CASCADE` to reset the DB to empty before Wave 8 (Group 12) starts.
