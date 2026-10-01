# Pragmatic Review

(The orchestrator saved this from the code-quality-pragmatist output, because the subagent is not allowed to write report files.)

**Overall: Appropriate.** Complexity is Low–Medium. There are no Critical or High findings: 2 Medium and 6 Low. The backend is lean and stays within scope. All of the excess is small copy-paste in the frontend. Nothing is over-engineered.

## Medium
- **M1. Birth-year validation is duplicated.**
  - Where: `birthYearError` is byte-identical in `RodzinaView.tsx:455-464` and `CreateFamilyDialog.tsx:98-106`. The ~20-line "Rok urodzenia" field block appears twice. The parse expression appears 3×.
  - Fix: move `birthYearError` and a new `parseBirthYear` into `utils/age.ts`. Optionally add a `BirthYearField` component. This removes ~40 lines.
- **M2. Server-error-message handling exists in 5 variants.**
  - Where: `extractProblemMessage`, the new `serverErrorMessage` (PanelDataContext:259), an inline copy in CreateFamilyDialog:114-119, the old inline copy in `handleRemoveFamilyMember` (PanelDataContext:1062-1067), and AccountMergeForm:44.
  - Problem: helpers 2 and 3 show the English "Validation failed" for Pydantic 400s (`errors.py:105`). Variant 4 can render "[object Object]".
  - Fix: add one `serverMessageOr(err, fallback)` to `api/problem.ts` that skips envelopes with `fieldErrors`, and use it in all the family call sites.

## Low
- **L1.** The "N zapisów · M dzieci" summary is built twice (`signupSummaryChip` and `TermAttendeesBody`). Fix: add a shared `formatSignupSummary`.
- **L2.** The "other error" expression in `useTermAttendees.ts:69-77` is hard to read. Fix: simplify it.
- **L3.** `TermAttendeesBody` takes 8 props that it only forwards. Fix: pass the hook result as a single object.
- **L4.** The facade export `service.list_terms` is no longer used after the router switched to `list_terms_with_counts`. Fix: drop it from the imports and `__all__`.
- **L5.** The router changes response models in place after `model_validate` (`router/terms.py:57-61`). Fix: build them with `model_copy(update=...)` in a comprehension.
- **L6.** `test_user_profile_birth_year.py` only tests ORM plumbing, which the HTTP tests already cover. Fix: delete it, or keep it only as a migration smoke test.

## Notes, no action needed
- The birth-year editor keeps its state locally while the rename editor keeps it in context. Local is the better choice, so leave it.
- Two "unchanged" comparisons in RodzinaView. They agree with each other.
- The PATCH response is ignored by the frontend. That is harmless and consistent with REST.

## Requirements alignment
There is no scope creep. Every addition maps to R11, R24-R29.

## Top actions (~1 h)
1. M2: a shared `serverMessageOr` (also stops "Validation failed" leaking to users).
2. M1: a shared birth-year validation/parse in `utils/age.ts`.
3. L1 and L4.
