# Technical Clarifications (Phase 5A)

| Question | Decision |
|----------|----------|
| How to hide deleted groups | **Central getter + explicit predicates**: `circles.get_group` → 404 when `deleted_at IS NOT NULL`; `get_group_including_deleted` for restore/admin; explicit `Group.deleted_at.is_(None)` in every listing/join query (per standards: no global filter); guards in endpoints that bypass get_group. Global ORM filter (with_loader_criteria) rejected. |
| Terms of deleted groups | **Split get_term**: `get_term` → 404 when the term's group is deleted (blocks term edit, needed items, pledges, listings); `get_term_any` (unfiltered) for transaction confirm/cancel (`term_item_listings.py` ~962) and `term_end_scan`. Point guards rejected. |
