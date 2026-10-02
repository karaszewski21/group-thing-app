# Moderation Architecture: Workflow Patterns

Category: `moderation-architecture`. Gathered 2026-10-01.
Confidence scale: High (several sources agree, or primary docs), Medium (one credible source, or inference from primary docs), Low (secondary or blog source, or extrapolation).

---

## 1. Sync pre-publish blocking vs async post-publish with a pending state

### Finding 1.1: There are three standard models, and real platforms mix them
- **Pre-moderation**: content is held until approved. It gives the most control. The costs are publication delay, user frustration and moderation cost.
- **Post-moderation**: content is published immediately and reviewed afterwards. Harmful content is briefly exposed.
- **Reactive moderation**: users flag content after it is published. It is used as a safety net next to the other two.
- Most platforms combine these and use automated classifiers to triage all three.

**Sources**: https://www.socialmediatoday.com/content/6-types-content-moderation-you-need-know-about ; https://www.lassomoderation.com/blog/post-moderation-pros-and-cons/ ; https://blog.pangeanic.com/what-is-content-moderation
**Confidence**: High (several industry sources agree; the taxonomy is standard).

### Finding 1.2: Pre-publication moderation costs participation only moderately
A study of Wikipedia's FlaggedRevs across 17 language editions found that the system "kept low-quality contributions from ever becoming visible". Its effects on contribution volume and quality were "moderate at most". There was some evidence that it discouraged anonymous users.

**Source**: Tran, Champion, Hill et al., https://arxiv.org/abs/2202.05548
**Confidence**: Medium. This is peer-reviewed evidence, but from a different domain (an encyclopedia, not a sharing marketplace).
**Relevance**: In this app, an item becomes visible to a group or on public pages (`/:slug/grupa/:groupId/term/:termId`). A short "pending" period (seconds to minutes) before an item shows to others is a low-cost form of pre-moderation.

### Finding 1.3: Practical decision for this project (synthesis)

| Aspect | Sync (block the create/update request) | Async (save as `pending`, moderate in background) |
|---|---|---|
| UX | The user waits for every model call (text ~10-100 ms on CPU, image ~100 ms-1 s on CPU, external API 0.3-3 s plus cold starts) | Save returns instantly. The UI shows "under review" |
| Failure mode | Model or API down means saves fail or fail open. You must choose | Model down means items stay `pending`. The outbox retries |
| Photo upload with presigned URL | Does not fit: the bytes reach Spaces after the API call | Fits naturally: a "confirm upload" step emits an event and a worker fetches and scans the object |
| Fit with existing code | Needs a timeout and fallback in each handler | Reuses `app.outbox` (`append` → `dispatch_pending` → handler) |

The hybrid used across the industry is **cheap synchronous checks plus asynchronous ML**:
- Sync: length, allowlists, a regex for URLs/phones, and optionally a fast text classifier with a tight timeout.
- Async: images and any slow model.

**Sources**: latency figures come from the hf-hosting/hf-models gatherers (synthesis inference). Outbox mechanics: `src/backend/app/outbox/service.py:22-38`, `src/backend/app/outbox/dispatcher.py:32-57`.
**Confidence**: Medium (design synthesis).

**Caveat (codebase)**: the outbox poller runs every **60 s** by default. `app.main` calls `run_forever()` without an interval, while the docstrings say "30s". Async moderation latency is therefore currently up to about 60 s plus processing time. A shorter interval, or a `NOTIFY`/in-process "kick" after commit, would make the pending period short.
**Source**: `src/backend/app/outbox/scheduler.py:14-23`, `src/backend/app/main.py:59-67`. **Confidence**: High.

---

## 2. States: pending, approved, rejected, needs_review

### Finding 2.1: A threshold-based three-way split is the standard automated pattern
- AWS Rekognition + Augmented AI (A2I) sends predictions to human review when they fall below a confidence threshold, or as a random sample. The thresholds can be changed at any time to balance accuracy and cost.
- Perspective API (Jigsaw) guidance distinguishes teams by moderator capacity:
  - A platform with few moderators might publish everything below 0.9 and hold items at 0.9 or above for review.
  - A large team might review the uncertain band 0.3-0.7.
- Perspective scores mean probability ("9 out of 10 people would consider this toxic"), not severity.

**Sources**: https://aws.amazon.com/augmented-ai/faqs/ ; https://aws.amazon.com/rekognition/faqs/ ; Perspective guidance as quoted in https://www.lassomoderation.com/blog/perspective-api-toxicity/ and the Jigsaw post https://medium.com/jigsaw/what-do-perspectives-scores-mean-113b37788a5d (returned 403 on direct fetch, so it was quoted via search results).
**Confidence**: High for the pattern. Medium for the exact Perspective numbers (seen only through secondary quotes).

### Finding 2.2: Recommended state machine (synthesis for this project)

```
          create/edit (moderated fields changed)
                    │
                    ▼
               ┌─────────┐   model error / timeout (retry via outbox, then)
               │ PENDING │───────────────────────────────┐
               └────┬────┘                               │
     all scores < low_thr  │  any score ≥ high_thr  │ in between
            ▼                    ▼                    ▼  ▼
       ┌──────────┐        ┌──────────┐        ┌──────────────┐
       │ APPROVED │        │ REJECTED │◄───────│ NEEDS_REVIEW │──► APPROVED
       └──────────┘        └────┬─────┘  admin └──────────────┘  admin
                                │ appeal (owner)
                                ▼
                          NEEDS_REVIEW (appeal=true) → APPROVED / REJECTED (final)
```

- Use a string-backed enum (`native_enum=False`), following `_enum_column` in `app/outbox/models.py:21-29` and the `models.md` standard.
- Keep the status per moderated unit:
  - on the product, for name and description;
  - per photo, so that one bad photo does not hide the whole item.
- Visibility rule: only `APPROVED` content is shown to others. The owner always sees their own content with a badge.
- A safe default for this domain is to **auto-reject only with very high confidence** (for example NSFW > 0.97). Everything in the uncertain band goes to `NEEDS_REVIEW`. With few moderators, this follows the Perspective "small team" advice: keep the review queue small by sending only probable violations.

**Confidence**: Medium (design synthesis from sources 2.1 plus codebase conventions).

### Finding 2.3: Calibrate thresholds per model and per category, and re-calibrate when the model changes
- OpenAI says it plans to "continuously upgrade the moderation endpoint's underlying model". The `omni-moderation-latest` alias can therefore change, and policies that rely on `category_scores` may need recalibration.
- The same applies to any HF model version. Store thresholds in config or DB, not in code, and pin model revisions.

**Source**: https://developers.openai.com/api/docs/guides/moderation (fetched 2026-10-01).
**Confidence**: High.

---

## 3. Human review queue and admin UI

### Finding 3.1: There is an in-repo precedent for an ADMIN-only moderation list
- `GET /api/groups/moderation` is ADMIN-only. The authorization matrix row is declared before the blanket `/api/groups` rule so that the literal segment is not swallowed.
- Path: router `app/groups/router/circles.py:247-255`, service `app/groups/application/circles.py:119`, repository `app/groups/infrastructure/repository.py:51`, matrix row `app/core/authorization_matrix.py:116-119`.
- A product review queue can copy this shape:
  - `GET /api/moderation/queue?status=NEEDS_REVIEW` (ADMIN);
  - `POST /api/moderation/decisions/{id}` with approve or reject, a reason code and a free-text note.

**Confidence**: High (code read).

### Finding 3.2: What a minimal review UI needs (industry pattern)
- Content preview with the model's per-category scores.
- Owner and context.
- One-click approve/reject with a **reason code** from a fixed list. The reason codes feed the DSA statement of reasons (see the legal findings).
- An optional note, and ordering by oldest first or highest score first.
- A2I-style tools also add random sampling of auto-approved items to measure false negatives.

**Source**: https://aws.amazon.com/augmented-ai/faqs/ (confidence threshold or random sampling routing).
**Confidence**: Medium.

---

## 4. Appeals

### Finding 4.1: Appeals are a legal expectation as well as good practice
- DSA Art. 17(3)(f) requires the statement of reasons to include "clear and user-friendly information on possibilities for redress".
- Art. 20 requires a formal internal complaint system: complaints accepted for at least 6 months, decisions "not solely on the basis of automated means". However, **Art. 20 does not apply to micro/small online platforms** (Art. 19).
- GDPR Art. 22(3) gives a right to "obtain human intervention ... and to contest the decision" where a solely automated decision significantly affects someone.

Minimal implementation:
- One "Request review" (appeal) action on a rejected item or photo, with an optional comment.
- The item goes back to `NEEDS_REVIEW` with `is_appeal=true`.
- A human decides, and the second decision is final.

**Sources**: https://www.eu-digital-services-act.com/Digital_Services_Act_Article_17.html ; .../Article_19.html ; .../Article_20.html ; https://gdpr-info.eu/art-22-gdpr/
**Confidence**: High for the legal text. Medium for the implementation shape.

---

## 5. Audit log

### Finding 5.1: Use an append-only decision log, following an existing in-repo precedent
- The repo already has an append-only audit table: `footprint_audit_log`, which has no `updated_at` and is written with tenacity retry. See `.maister/docs/project/architecture.md` (Database Schema section).
- A `moderation_decisions` table should be append-only too. One row per decision, with these columns:
  - subject type and id;
  - content hash or snapshot;
  - `decided_by` (`MODEL` or user id);
  - `model_id` and `model_revision`;
  - raw scores as JSONB;
  - thresholds used;
  - outcome;
  - reason code;
  - whether the decision was automated;
  - `created_at`.
- The current status on the product or photo is a projection of the latest decision.
- This gives what DSA Art. 17(3)(b)/(c) needs (facts relied on, and whether automated means were used). It also gives what re-moderation needs (which model decided what).

**Sources**: `.maister/docs/project/architecture.md`; DSA Art. 17 (above).
**Confidence**: Medium (design synthesis), High (legal fields).

---

## 6. Re-moderation when the model changes

### Finding 6.1: Use shadow mode first, then a selective backfill
- In shadow mode a new system "log[s] data about all of their decisions, and then return[s] a default value *as if* they were off". This answers "what if this system had been on?" using live data.
- Compare the agreement rate, false positives and false negatives against the current model and against human decisions before switching.

Plan for this project:
1. Record `model_id`/`model_revision` in every decision row (section 5).
2. When upgrading, run the new model in shadow on new content (log only) and compare it with the old model and human outcomes.
3. After the switch, **do not silently re-reject approved content**. Re-score a backfill batch of `APPROVED` content through the outbox (as low-priority events). Send only *new* flags to `NEEDS_REVIEW`, so a human confirms any takedown of content that was already public. That takedown needs a statement of reasons anyway.
4. Never automatically re-moderate items that a human approved. Human decisions take precedence, unless the policy itself changed.

**Sources**: https://nlathia.github.io/2020/07/Shadow-mode-deployments.html ; https://atlan.com/know/shadow-deployment-for-ml-models/ ; OpenAI model-update note above.
**Confidence**: Medium.

---

## 7. Re-checking on edit

### Finding 7.1: Re-moderate only the changed moderated fields, keyed by content hash
- On `PATCH` of name or description, compute a hash of the normalized text. If it differs from the last moderated hash, set the text status to `PENDING` and append an outbox event.
- Photos are immutable objects: a new photo means a new moderation, and reordering needs no re-check.
- Visibility while an edit is pending can follow one of two policies:
  - (a) keep showing the last approved version, which needs a stored `approved_snapshot`; or
  - (b) hide the item until the edit is re-approved.
- (b) is simpler and fits the minimal-implementation standard. (a) is friendlier for active items. For the MVP, (b) with a fast async pass is reasonable.
- Edits by an owner on an item that a human rejected should go to `NEEDS_REVIEW`, not auto-approve. This stops users from probing the classifier by making small edits until the item passes.

**Sources**: synthesis. The outbox staging in the same transaction is in `src/backend/app/outbox/service.py:22-38`, and it guarantees the edit and the moderation event commit atomically.
**Confidence**: Medium.
