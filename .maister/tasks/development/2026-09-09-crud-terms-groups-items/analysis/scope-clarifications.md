# Phase 2 — Scope Clarifications

Date: 2026-09-09

## Critical decision — AUTHORIZATION_MATRIX row style
**Decision:** **Combined** `_methods("PATCH", "DELETE")` (or `_methods("PATCH")` where no DELETE) row
per path, placed ahead of the blanket rows, resolving to `("EDIT", "mcp:edit")`. One line per path,
matching the existing `organizations` idiom (`_methods("POST", "PATCH")`). Internal security-config
detail — no user-visible effect. (Orchestrator picked the recommendation; user did not need to weigh in.)

New rows to add (ahead of blanket rows, correct eval-order position):
- `(_methods("PATCH"), r"^/api/terms/[^/]+$", ("EDIT", "mcp:edit"))`
- `(_methods("PATCH", "DELETE"), r"^/api/needed-items/[^/]+$", ("EDIT", "mcp:edit"))`
- `(_methods("PATCH"), r"^/api/groups/[^/]+$", ("EDIT", "mcp:edit"))`  — after the `/mine` and `/public` group rows
- `(_methods("PATCH", "DELETE"), r"^/api/inventory-items/[^/]+$", ("EDIT", "mcp:edit"))`

## UX decisions (user overrode all three gap-analyzer defaults)

### D-term-edit-shape → per-field inline editors
**Decision:** Term edit uses **separate inline editors per field** (`occurs_on`, `description`), each
with its own save — the family-rename template (`editingTermField`/`termFieldDraft`/`termFieldError`
+ `load({ silent: true })`). NOT an expand-to-edit card. The needed-items sub-list keeps its own
inline add/edit/remove controls.

### D-term-edit-placement → edit affordance in ALL organizer term views
**Decision:** The term edit (pencil) + needed-items controls appear **wherever a term renders for the
organizer** — home "Najbliższe terminy", "Terminy" view, "Spotkania" view. NOT limited to the
"Terminy" view. Public krąg views stay read-only.

### D-delete-confirm-ux → optimistic delete + informational toast, NO ConfirmDialog
**Decision:** Deleting a needed-item or an inventory item = **optimistic removal from the list** +
a toast "Usunięto". No `ConfirmDialog`. On a server error (409 for a FULFILLED-pledge needed-item or
a non-AVAILABLE inventory item, or any other failure) → **restore the row in place and show an inline
/ toast error message**. No undo button, no restore endpoint.

## Undo / restore
**Decision:** **No restore (un-delete) endpoint.** The toast is informational only. Soft-delete is
one-way from the UI. (`deleted_at` stays as the audit trail / for a future admin tool.)

## Technical decisions carried on gap-analyzer defaults (no user input needed)
- `UpdateNeededItemRequest.category`: `NeededItemCategory | None` (it is a `StrEnum` in models — not
  free text), partial-apply. `description`: `str | None`, partial-apply.
- `UpdateTermRequest`: `occurs_on: date | None`, `description: str | None`, partial-apply.
- `UpdateGroupRequest` / `UpdateCircleRequest`: `name: str | None` (or required `name` mirroring
  `UpdateFamilyRequest` — spec-creator decides) with blank-name rejection.
- `list_pledges` gets a `get_needed_item` guard (404 when the parent needed-item is soft-deleted);
  `get_pledge` and pledge-lifecycle reads are left untouched (withdrawn pledges are terminal).
- No partial index on `deleted_at` in migration 0017 (lists are small and scoped; keeps the migration
  to one logical change). Add later if a query plan shows the need.

## Phase 4 (UI mockups)
**Skipped by user choice** — UI described in-prose in the spec.

## Scope status
**Not expanded.** All items are within the CRUD-for-3-entities frame. If anything, the Term scope
*narrowed* in Phase 1 (PATCH only, no delete).
