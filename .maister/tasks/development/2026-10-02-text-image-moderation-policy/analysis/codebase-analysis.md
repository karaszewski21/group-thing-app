# Codebase Analysis — text + image moderation policy

Source: Explore subagent scan of src/backend and src/frontend (2026-10-02). Paths relative to `src/`.

## Key findings that shape the design
1. **ONNX models are loaded only in the worker process.** `backend/app/moderation/onnx_models.py` requires the `ml` dependency group (onnxruntime, tokenizers, PIL), which is installed only in the Dockerfile `worker` target. The API process has no classifier. "Sync" text moderation therefore needs an architectural change.
2. **Product text moderation already exists and is async.** `product/service.py:132 stage_text_moderation` hashes name + shared description and skips when unchanged (`text_moderated_hash`). Otherwise it sets `text_status=PENDING` and emits an outbox event `moderation.text_requested`. The worker (`moderation/service.py:141 moderate_product_text`) decides.
3. **Text is never auto-rejected.** `decide_text` (service.py:53) sets NEEDS_REVIEW when any label is ≥ `moderation_text_review_threshold=0.5`, and the admin decides via `/api/moderation/queue` + `/decisions`.
4. **Photo moderation exists and is async, using local Falconsai NSFW ONNX, not VPS B.** `decide_photo`: REJECTED at nsfw ≥ 0.97, NEEDS_REVIEW at ≥ 0.5, otherwise APPROVED. Files stay private until APPROVED. VPS B (`/v1/moderate/image`) is not called anywhere.
5. **Organization / group / term / needed-item text has no moderation and no status columns.**
6. **Terms never create a group implicitly on the backend.** The FE onboarding flows call `createMyCircle` and then `createTerm`, so "group name moderated once" falls out naturally from moderating on group create/update.
7. **Error envelope:** `{status, error, message, fieldErrors, timestamp}`. Validation errors and `ValueError` map to **400**, not 422. The contact-info rule (`moderation/rules.py ensure_no_contact_info`) is the existing sync text check and raises ValueError → 400. FE `serverMessageOr` shows `message` for 400/409 only when `fieldErrors` is absent.

## Moderation infrastructure
- `moderation/onnx_models.py`: `OnnxTextClassifier` is Bielik-Guard-0.1B-v1.1, multi-label (hate, vulgar, sex, crime, self-harm), sigmoid, 512 tokens. `OnnxImageClassifier` is Falconsai nsfw (normal/nsfw). Both expose a synchronous `scores()`, and the worker runs it via `asyncio.to_thread`.
- `moderation/classifiers.py`: Protocols. `moderation/status.py`: ModerationStatus PENDING/APPROVED/NEEDS_REVIEW/REJECTED.
- `moderation/models.py`: ModerationDecision, an append-only audit table. subject_type is PHOTO | PRODUCT_TEXT.
- `moderation/worker.py`: separate process polling the DB outbox (`events.py` WORKER_EVENT_TYPES). Compose service `moderation-worker`, profile `moderation`.
- `core/config.py` L40-50: moderation_enabled=False and the thresholds.
- Latest Alembic migration: 0046_photo_upload_moderation.

## Integration points (create/update)
| Entity | Endpoint → service | File:line |
|---|---|---|
| Organization | POST /api/organizations/mine → create_own_organization → create_organization; PATCH /api/organizations/{id} → update_organization | organizations/service.py:50, 95, 128 |
| Group | POST /api/groups, /mine, /mine/new → create_own_circle / create_additional_circle → create_circle; PATCH /api/groups/{id} → update_group | groups/application/circles.py:34, 55, 83, 142 |
| Term | POST /api/terms → create_term; PATCH /api/terms/{id} → update_term | groups/application/terms.py:29, 72 |
| Needed item (free-text description) | POST/PATCH /api/needed-items → create_needed_item / update_needed_item | groups/application/terms.py:112, 170 |
| Product | POST /api/products, /resolve, PUT /{id}, PATCH /{id}/description | product/service.py:161, 191, 176, 448 |
| Product photo | POST /api/products/{id}/photos → add_product_photo | product/service.py:363 |

## Frontend
- `ModerationBadge` (pages/product/ItemGalleryEditor.tsx:8-24): PENDING "W moderacji", NEEDS_REVIEW "Do sprawdzenia", REJECTED "Odrzucone".
- ItemDetailPage.tsx:94-100 shows an owner banner when text_status != APPROVED. ItemGallery.tsx:56 shows photo badges.
- Admin queue: pages/ContentModerationQueue.tsx.
- Errors: api/client.ts ApiError, api/problem.ts extractProblemMessage / serverMessageOr.

## Risk
Medium. The API process gains ML inference (memory/CPU, startup), new moderation call sites span 4 modules, and the VPS B integration is new.
