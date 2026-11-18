# Review scope: SIMILAR tier (uncommitted working tree)

## TL;DR
These are the files this task changed. Review only these. Everything under "Excluded" belongs to a parallel ledger/0102 change that this task did not make.

## In scope
- Migrations: src/backend/alembic/versions/0100_pgvector.py, 0101_want_similar.py
- Backend:
  - src/backend/app/embeddings/ (all)
  - src/backend/app/product/{embeddings.py, service.py}
  - src/backend/app/wants/{models.py, schemas.py, router/wants.py, application/{reads,writes,embeddings}.py, infrastructure/{embeddings_acl,outbox_acl}.py}
  - src/backend/app/{main.py, config.py, core/authorization_matrix.py}
- Backend tests:
  - src/backend/tests/{conftest.py, test_embeddings.py, test_product_embeddings.py, test_want_similar_migration.py, test_wants_embeddings.py, test_wants_similar_api.py, test_wants_migration.py, test_authorization_matrix.py, test_wants_scan_removed.py, test_module_boundaries.py, test_moderation_config.py}
- Matcher:
  - src/matcher/matcher/{db,requests,rules,statements,window}.py
  - src/matcher/tests/{conftest.py, test_similar.py, test_similar_requests.py, test_constants_drift.py, test_loop.py}
- Frontend:
  - src/frontend/src/{api/wants.ts, hooks/useWantMatches.ts}
  - src/frontend/src/features/wanted/{wantMatchesViewState.ts, WantMatchesView.tsx, SimilarCard.tsx, reservedCaption.ts, MatchCard.tsx, SuggestionCard.tsx}
  - src/frontend/src/test/{WantMatchesView.test.tsx, reservedCaption.test.ts, wantMatchesViewState.test.ts, useWantMatches.test.tsx, useWants.test.tsx, fixtures/wants.ts}
- Infra: src/backend/Dockerfile, src/backend/scripts/check_embed_parity.py, docker-compose.yml, .env.example
- Docs: .maister/docs/{INDEX.md, project/architecture.md, project/tech-stack.md}

## Excluded (parallel change, not this task)
src/backend/alembic/versions/0102_ledger_entries_on_inventories.py, src/backend/app/inventory/*, tests/ledger_assertions.py, test_inventory_ledger*.py, test_ledger_entries_on_inventories_migration.py, test_event_reservations_migration.py, test_personal_pickup_migration.py, test_term_item_listings.py.
Note only where 0102 interacts with 0101 (it chains after it).
