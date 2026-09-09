# TDD Red Gate — Phase 3

Date: 2026-09-09

## Defect
`POST /api/groups/public/{group_id}/rsvp` ignores the `Authorization: Bearer` header.
A logged-in user who RSVPs via the public per-term page gets a fresh detached anonymous
`UserProfile` (`account_user_id=None`) + new `Party` minted, instead of the `TermAttendance`
attaching to their existing account/Party.

Root cause (Phase 1/2): route declared with no principal dependency; `service.create_rsvp`
has no `principal` param and unconditionally creates `Party(PERSON)` + `UserProfile(account_user_id=None)`.

## Failing test
`src/backend/tests/test_rsvp.py::test_createRsvp_loggedInUser_attachesToExistingAccountNotNewAnonymousProfile`

Registers a GUEST (real account → token + `party_id`), creates a circle+term as a separate
organizer, then POSTs the RSVP **with the guest's bearer token**. Asserts:
1. exactly one `TermAttendance` for the term, with `party_id == <guest's existing party>`
2. no anonymous (`account_user_id IS NULL`) `UserProfile` was created for the guardian name
3. the returned `user_profile_id` resolves to the guest's existing profile (`account_user_id` set)
4. `RsvpResponse.attached_to_account is True` (new field, D5)

## Red result (confirmed FAILING)
```
uv run pytest tests/test_rsvp.py -q
>       assert attendance[0].party_id == guest_party_id
E       assert 16 == 15
tests\test_rsvp.py:139: AssertionError
FAILED tests/test_rsvp.py::test_createRsvp_loggedInUser_attachesToExistingAccountNotNewAnonymousProfile
1 failed, 3 passed
```
The RSVP created a new party (16) rather than attaching to the guest's party (15) — the defect,
reproduced. The 3 pre-existing anonymous-RSVP tests still pass (no regression from the test addition).

## Green gate (Phase 9)
This test must PASS after the optional-token fix lands in `create_rsvp` route + service and
`RsvpResponse` gains `attached_to_account`.
