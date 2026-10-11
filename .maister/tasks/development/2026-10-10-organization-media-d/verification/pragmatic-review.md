# Pragmatic Review — Organization Media (task D)

**Status: Appropriate. 0 Critical, 0 High, 2 Medium, 7 Low.** No blocking findings.
(Report produced by code-quality-pragmatist; saved by the orchestrator.)

## Complexity assessment
Medium-High, mostly justified. Most of it comes from the external cron flipping PENDING→APPROVED outside the app's org lock: Core-only writes, status-predicated `DELETE … RETURNING`, retire decisions from the returned status, and the SKIP LOCKED sweep. Each mechanism maps to a spec/audit item (H2, L1, L2, L4, L11, M1) and is covered by race tests. No new infrastructure (the sweep reuses the existing AsyncIOScheduler); the cron change is one `Subject` entry plus grants; `images.py` was a plain `git mv`. No scope creep.

## Findings
| ID | Sev | Where | Finding | Fix |
|---|---|---|---|---|
| M1 | Medium | `app/organizations/media.py:497-498, 514-521`; `hooks/useOrganizationMedia.ts:24-38` | `reorder_gallery` returns 409 when storage is None, contradicting R11. The storage check exists only to build the response URLs, and the frontend never reads the response (it refetches `/mine`). | Return 204 and drop the storage param, the 409 and the post-commit SELECT (~12 LOC less). Needs a spec/user decision. |
| M2 | Medium (info) | `media.py:167-191` | Five eager retire paths plus the sweep. Only delete/takedown retire is needed for the "never resurfaces" guarantee; the others are cleanup. | No change now. |
| L1 | Low | `moderation/service.py:131-133, 154, 160, 166` | `_Subject.count` can be derived from `model` (the `_count` helper and `functools.partial` are redundant). | Remove (~8 LOC). |
| L2 | Low | `moderation/router.py:58-59` | Stale docstring: "a product photo or an avatar". | Mention organization media. |
| L3 | Low | `PhotosTab.tsx:55-58`, EditorSheet, `PublicOrganizationPage.tsx:124-125` | PhotosTab receives `media` via props and also calls `useMyOrganization` for the same query. | Optional: use a single source. |
| L4 | Low | `organizations/models.py`, `organizations/router.py` | Unrelated formatting changes in the diff. | Cosmetic. |
| L5 | Low | `GalleryBlock.tsx` | Duplicate empty check (`LayoutRenderer` already applies `isGalleryEmpty`). | Remove. |
| L6 | Low | `PhotoModerationCard.tsx:21-26` | Unreachable fallback branch for a null `media_kind`. | Remove. |
| L7 | Low | `PhotosTab.tsx:41` | Invented cover S1 copy. | Product decision. |

## Developer experience
Good: docstrings explain why each concurrency rule exists; error messages are in Polish and verbatim; a new moderated type is one `_SUBJECTS` entry. Friction: `media.py` (521 LOC) needs the spec/audit context to read. The test volume (~1667 LOC) is proportional to how race-heavy the spec is.

## Context consistency
Every new function has a caller, and there are no dead helpers or duplicate implementations. The group-thing-ai change is minimal and consistent.

## Top actions
1. M1: reorder returns 204 without storage (after a decision).
2. L1 + L2: remove the redundant count field; fix the docstring.
3. L3/L5/L6: frontend tidy-ups (optional).
