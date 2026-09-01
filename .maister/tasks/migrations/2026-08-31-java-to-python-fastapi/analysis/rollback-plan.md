# Rollback Plan

## No live-traffic rollback path exists

This is a **first-ever deployment**. The Java/Spring Boot backend being replaced was never built (no `pom.xml`/`build.gradle`), never configured (no `application.properties`, no real values for `app.jwt.secret`/`app.cors.allowed-origins`/etc.), never given a database schema (no Liquibase changelog), and never containerized or deployed anywhere. There is no running instance receiving traffic today.

Consequently, none of the standard rollback mechanics apply:

- **No dual-run / blue-green**: there is nothing to run the new service alongside.
- **No traffic shifting / canary**: there is no existing traffic to shift back.
- **No database rollback**: there is no existing production schema or data to preserve or restore — the first Alembic migration is the first schema this system will ever have.
- **No "previous version" to redeploy**: nothing has ever been deployed.

## What "rollback" means here

If the Python/FastAPI rewrite needs to be aborted mid-migration or found unacceptable after completion, "rollback" means exactly one thing: **the Java source tree remains in git history and can be referenced or checked out again.** No automated rollback mechanism, feature flag, or infrastructure switch is being built or is needed, because there is no live system whose behavior would need to be reverted.

If an abort is ever needed:
1. The Java source under `src/backend/` (as it exists in git history prior to this migration) is still fully available via `git log`/`git checkout` against the relevant commit.
2. Since the Java backend was never buildable or deployable as-is, reverting to it would not restore a working system on its own — it would only restore the starting point for a fresh attempt (build tooling, config, and schema would still need to be created from scratch, exactly as this migration's target-state-plan already documents as necessary greenfield work).
3. No data migration/back-migration is required, since no production data exists under either implementation at the time of this migration.

## Why no dual-run plan was produced

Per `analysis/target-state-plan.md` §4, dual-run was assessed as infeasible: standing up the Java backend well enough to run it in parallel (writing a build file, reconstructing config, discovering the schema empirically) would itself be a large side-project duplicating exactly the reverse-engineering work already being done for the Python target — with no corresponding benefit, since there is no live traffic to protect during the switch. This is stated explicitly rather than inventing rollback/dual-run mechanics that would not reflect the actual deployment situation.
