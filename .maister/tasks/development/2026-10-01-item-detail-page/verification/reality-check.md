# Reality Check

(The orchestrator saved this from the reality-assessor's output. The subagent is not allowed to write report files.)

**Status: issues found, GO for pre-production.** All requested points work end to end. No completion claim was false. Functionally the request is about 95% done.

## Tests I ran
- Backend feature suites: 77 passed.
- Frontend feature suites: 30 passed.
- I did not check the live browser (no credentials).

## Request vs. reality
Each of these works:
- `/product/:id` is login-only (AuthGuard, ReadPrincipal, RESERVED_SLUGS).
- Name, description, condition and category are shown.
- Gallery: ProductPhoto with fallbacks, an editor, a max of 10, and a FOR UPDATE lock.
- History: built server-side as one query, with privacy labels and no ids.
- Status block covers all codes.
- Notification links are repointed. TERM_CONFIRMATION_NEEDED keeps the term link.
- Taker gets an ITEM_RESERVED_FOR_PICKUP notification.
- Term page has a listing link.
- Edit page has per-field pencils and a guard.
- Moje rzeczy and Wypożyczone have icons.
- There are two standalone pages.

## Gaps
- **H1 (high, consequence of a user decision): photos and description are global and any user can edit them.**
  - `get_or_create_product_by_name` matches by name and category across all users. Every user has EDIT, and the product photo/description endpoints have no owner check.
  - Effect: any logged-in user can change the gallery or description that every family sees. Hiding the controls in the UI is cosmetic only.
  - Cheap fix: a server-side check that the caller owns at least one non-deleted item of the product.
- **M1: renaming an item silently drops its photos and description.** The rename re-points the item to another product. Add a hint, or decide to carry them over.
- **M2: back-navigation loop.** Going Moje rzeczy → edit → Gotowe → Wróć returns to the edit page. Fix with `replace` on the "Gotowe" and "Wróć do podglądu" links.
- **M3: nothing is committed yet.** Commit everything, including migration 0045.
- **Low:**
  - L1: PROPOSED_SWAP has no link to accept or reject.
  - L2: the TAKEN notification no longer links to the term (accepted in the spec).
  - L3: after a login redirect, `ItemBackButton` can go back to `/login`.
  - L4: `LoanRow.itemId` is typed as `number`.
  - L5: the notification date has no timezone.
  - L6: deleting a product that has photos fails on the FK.
