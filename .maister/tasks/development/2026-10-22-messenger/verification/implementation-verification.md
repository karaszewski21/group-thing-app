# Implementation Verification — Messenger

## TL;DR
- **Verdict after fix cycle 1: ✅ Passed, with minor residuals.** The plan is complete (73/73 steps). Backend 904/904, mypy 23 (baseline), ruff clean. Frontend 1114/1120: the 6 failures are pre-existing on HEAD. tsc clean.
- **All 11 fixed areas were re-verified as resolved** (`code-review-reverify.md`), including H1 (crossing message), moderation outside the transaction, the timeout, the limiter, `hide_parameters`, the OAuth scopes, deduplication and UX.
- **Remaining:** 0 critical, 1 low warning (timed-out moderation threads stay in the default pool) and about 6 info notes.
- **User decisions:** owner-name enumeration via `POST /item` is accepted. `mcp:*` scopes are removed from `/api/conversations`.
- **Not done yet:** SC16, the side-by-side check against the mockups, moves to Phase 12 E2E.

## Open Questions / Risks
- **Moderation threads after a timeout:** a timed-out moderation thread keeps running in the shared default pool. If the model hangs, these threads can pile up. Suggested follow-up: a dedicated thread pool.
- **Message retention:** there is no retention or erasure policy for messages (GDPR/RODO). This needs a product decision.
- **Rate-limit counting:** 503 attempts count toward the 30/min limit. While the classifier is down, a user retrying many times gets a 429 after 30 attempts.
- **Composer focus on open:** focusing the composer when a thread opens brings up the mobile keyboard. This is a deliberate choice; it can be limited to devices with a mouse.
- **Group-chat entry for members:** before the first message, members can reach "Czat grupy" only from the term page.

## Fix & Re-Verification History (cycle 1)
| Issue | Fix | Re-check |
|---|---|---|
| H1 crossing message | `useThread`: a server cursor that `send`/`loadOlder` do not move; 4 tests | resolved |
| No-cursor race + `has_more` | merge with the current cache; poll loop of at most 5 pages | resolved |
| Moderation inside a transaction | commit before `check_text`, then `FOR UPDATE` + `expire_all` + re-check under the lock (403/409) | resolved, with no MissingGreenlet path |
| No moderation timeout | `asyncio.wait_for` 5 s, mapped to 503 + WARNING | resolved (thread keeps running: N2) |
| Rejected sends not limited | `acquire_message` is atomic and counts 400/503 | resolved |
| Bodies in logs | `hide_parameters=True` | resolved |
| OAuth `mcp:*` | READ/EDIT-only aliases on the router; matrix rows 53-54 renumbered | resolved, with an HTTP 403 test |
| Duplication: read-only rule, title, counterpart | `read_only_reason`, `term_title`, `item_counterpart` | resolved |
| `chat_audience` pass-through wrappers | re-exported from `groups/service`; private helpers made public | resolved |
| DISTINCT ON in the inbox | LATERAL … LIMIT 1 | resolved |
| `is_active_attendee` loading all rows | EXISTS `has_active_attendance` | resolved |
| Indexes only in the migration | `__table_args__` in `models.py` (compare_metadata shows no diff) | resolved |
| Open-and-navigate duplicated 4× | `useOpenAndNavigate` + `utils/messagesPaths.ts` | resolved |
| Inbox not refreshing | `refetchInterval` 20 s | resolved |
| Composer focus | focus on mount and after send | resolved |
| Redundant mark-read | skipped when the newest message is mine | resolved |
| Focus ring + chat card gate | ring classes; gate `ready \|\| error` | resolved |
| `architecture.md` | Messaging section added (N1 wording corrected) | resolved |

New info items left as they are:
- **N3:** no 403-under-lock test.
- **N4:** scrolling after a crossing message.
- **N5:** the router keeps literal paths, consistent with the other routes.
- **N7:** consistency of a single call in `public_view`.

---
*Original pre-fix assessment below.*

## Executive summary
All three flows work end to end: a question about an item, a group chat (PRIVATE groups) and a term chat. Backend and frontend agree on the contract. Access checks hold on all 9 endpoints (IDOR, 404 before 403, cursors from other conversations rejected). The serious gap is one frontend race (H1). The rest is duplication, resilience around moderation, and polling cost.

## Implementation plan (completeness-report.md)
- 73 of 73 steps are complete. The code and tests for every group exist on disk.
- The four known deviations (duplicated rule and title, open-and-navigate flow, `familyTone` avatar, `messagesRoutes.test`) were assessed as acceptable.

## Test suite (test-suite-results.md)
| Suite | Result |
|---|---|
| Backend pytest | 900/900 ✅ |
| Frontend vitest | 1094/1101. The 7 failures are 6 that already fail on HEAD (`auth`, `extension-points` ×2, `foundation`, `PanelPage` delete 409, `TermPage` sign-up footer) and 1 flaky test (`OrganizerEditor`). |
| `tsc -b` | clean ✅ |

## Standards compliance
- 20 of 21 standards apply, and all 20 are followed.
- `InboxPage` uses an if-chain instead of a view-state file. This was assessed as acceptable: it is one screen, and only its body changes.

## Documentation
- Adequate.
- **W1:** `project/architecture.md` has no section on `app/messaging`.

## Optional reviews
| Review | Status | Critical | Warning | Info |
|---|---|---|---|---|
| Code review | issues_found | 0 | 7 | 14 |
| Pragmatic | appropriate, no blockers | 0 | 3 (Medium) | ~6 (Low) |
| Production readiness | GO_WITH_MITIGATIONS (78%) | 0 | 9 | 2 (+4 recommendations) |
| Reality check | Issues found (~90%) | 0 | 1 High + 2 Medium | 4 Low |
| Completeness | passed_with_issues | 0 | 1 | 6 |

## Issues requiring attention (deduplicated)

### Must fix
| ID | Source | Problem | Location | Fixable |
|---|---|---|---|---|
| H1 | reality | A message that crosses mine disappears: after a send, the `after=` cursor jumps past messages committed earlier. | `hooks/useThread.ts:63-68,107` | yes |

### Warnings
| ID | Source | Problem | Location | Fixable |
|---|---|---|---|---|
| W-race | code review | The no-cursor branch overwrites the cache, so the first message sent during an in-flight poll disappears. | `useThread.ts:64-66` | yes |
| W-tx | code review, prod | The DB transaction stays open (idle in transaction) during moderation. | `messages.py:84-100` | yes |
| W-timeout | prod | Moderation has no timeout, so the user gets nginx's 504 instead of a JSON 503. | `text_guard.py` | yes |
| W-limit | prod | Sends rejected by moderation are not rate-limited, so each one costs Bielik time. | `messages.py` | yes |
| W-logs | prod | `hide_parameters=True` is not set, so a failed insert can put the message body into logs. | `app/db.py` | yes |
| W-dup1 | code review, pragmatic, completeness | The read-only rule, term title and counterpart are duplicated between access/conversations and inbox. | `access.py`, `conversations.py`, `inbox.py` | yes |
| W-dup2 | code review, pragmatic, completeness | The open-and-navigate flow is copied into 4 entry points. | GroupDetails, TermAttendees, ItemDetail, PublicTermView | yes |
| W-wrap | pragmatic | `chat_audience.py` is 6 of 8 pass-through wrappers. | `groups/application/chat_audience.py` | yes |
| W-inbox | reality | The open inbox list never refreshes (no `refetchInterval`). | `useConversations.ts:21` | yes |
| W-focus | reality | The composer is not focused when a thread opens or after a send (the keyboard closes on mobile). | `pages/messages/` | yes |
| W-distinct | code review | `last_messages_for` uses DISTINCT ON over the whole history. | `repository.py:299-312` | yes |
| W-unread | prod | Unread counts are unbounded for conversations never opened, and the attended-terms IN list grows forever. | `repository.py`, `chat_audience` | partly |
| W-poll | code review | About 10 statements per 5 s poll, plus a redundant mark-read after my own send. | `access.py`, `messages.py`, `useThread.ts` | yes |
| W-monitor | prod | No logs or metrics for sends, 429s or 503s; the missing-classifier 503 is silent. | messaging, `text_guard` | yes |
| W-enum | code review | Owner-name enumeration through `POST /item`. | `conversations.py` | decision |
| W-scope | prod | `mcp:*` scopes reach private chats. | `authorization_matrix.py` | decision |
| W-gdpr | prod | No message retention. | messaging | decision |
| W-doc | completeness | `architecture.md` has no messaging section. | `.maister/docs/project/architecture.md` | yes |

### Info (selection)
- Focus rings are missing on the `GroupChatCard` and `TermHeadCard` buttons.
- The new matrix rows have no `# NN` numbers.
- Docstrings cite spec IDs (M8, L7).
- Indexes exist only in the migration, so autogenerate may drop them.
- `maxLength={1000}` makes the over-limit state unreachable.
- `has_more` is ignored in polling.
- The ITEM partial index has no CHECK constraint.
- `is_active_attendee` loads every attendance instead of using EXISTS.
- The `57px` value is a magic number.
- The "Czat grupy" card is hidden when fetching the join code fails.
- `lock_timeout` is not set in 0061.
- `moderation_text_enabled` defaults to False.

## Recommendations
1. Fix H1 and W-race in `useThread` together, and add a test for crossing messages.
2. Fix the `send_message` resilience: end the transaction before moderation, add a timeout, count rejected attempts in the limiter, and set `hide_parameters`.
3. Refactor the duplication: shared helpers for the read-only rule and title, an open-and-navigate hook, and collapsing `chat_audience`.
4. UX: poll the inbox, focus the composer, add focus rings.
5. Product decisions: name enumeration, OAuth scopes, retention.

## Verification checklist
- [x] Completeness checker
- [x] Test suite
- [x] Code review
- [x] Pragmatic review
- [x] Production readiness
- [x] Reality check
- [ ] Visual fidelity (Phase 12)

## Overall assessment
| Area | Status |
|---|---|
| Plan | ✅ 100% |
| Tests | ✅ no regressions |
| Standards | ✅ |
| Documentation | ⚠️ `architecture.md` |
| Correctness | ⚠️ H1 |
| Production | ⚠️ GO with mitigations |
