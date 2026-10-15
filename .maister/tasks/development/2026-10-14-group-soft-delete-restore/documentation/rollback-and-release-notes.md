# Rollback & Release Notes: Group Soft Delete

## Release notes
- **New**: organizers (and admins) can delete a group from Panel → Spotkania (trash → confirmation). The group disappears for everyone; Leadership, terms, RSVPs and members are kept.
- **New**: admins see deleted groups on `/admin/groups` → **Deleted** (date, who deleted) and can **Restore** them.
- **Blocked**: deleting a group with an upcoming term that has active RSVPs returns 409 with the nearest date.
- **Behaviour change**: `POST /api/leaderships` (assign leadership) is now **ADMIN-only**. `POST /api/leaderships/{id}/end` requires the active organizer of that group or ADMIN (previously any EDIT user). External/MCP clients relying on these lose access.
- **Behaviour change**: `GET /api/groups/{id}/leadership|leaderships|memberships` return 404 for unknown or deleted groups (previously `null`/`[]`).
- **Accepted behaviour**: if an organizer creates a new group after deleting one, an admin restore leaves them leading two live groups (organizers may lead several groups).

## Deploy
Migration `0056_group_soft_delete` (additive, nullable `groups.deleted_at`, `groups.deleted_by_party_id` + FK) runs via `alembic upgrade head` before the backend starts (docker-compose). Old code ignores the new columns.

## Rollback
**Prefer a forward fix.** Rolling back the backend code, or downgrading to `0055`, makes every soft-deleted group live, public and joinable again, and (on downgrade) loses who deleted it.

If a rollback is unavoidable:
1. Export the deleted rows first:
   ```sql
   SELECT id, name, deleted_at, deleted_by_party_id FROM groups WHERE deleted_at IS NOT NULL;
   ```
2. Roll back the code. Do **not** run `alembic downgrade 0055` unless the columns must be removed; old code works with them present.
3. After re-deploying the feature, re-apply deletions from the export (`UPDATE groups SET deleted_at = ..., deleted_by_party_id = ... WHERE id = ...`).
