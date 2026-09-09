# TDD Green Gate — Phase 9

Date: 2026-09-09

## Test
`src/backend/tests/test_rsvp.py::test_createRsvp_loggedInUser_attachesToExistingAccountNotNewAnonymousProfile`

## Red → Green
- **Phase 3 (Red):** `assert attendance[0].party_id == guest_party_id` → `assert 16 == 15` — RSVP minted a new party instead of attaching to the logged-in user's.
- **Phase 9 (Green):**
```
uv run pytest tests/test_rsvp.py::test_createRsvp_loggedInUser_attachesToExistingAccountNotNewAnonymousProfile -q
1 passed, 32 warnings in 7.61s
```

## Fix (G1)
`POST /api/groups/public/{group_id}/rsvp` gained `principal: OptionalPrincipal = None`
(`Depends(get_current_principal)` — the existing never-raising optional principal). `service.create_rsvp`
resolves the principal defensively; when it maps to a real account, the `TermAttendance` attaches to
that party's existing `UserProfile` — no new `Party`/`UserProfile` minted — and `attached_to_account`
is `True`. Missing/invalid/expired token → unchanged anonymous behaviour, never 401.

Full `test_rsvp.py`: 7 passed. Full backend suite: 72 passed / 0 failed.
