"""Messaging repository against real Postgres: keyset message pages (50 per
page, `has_more` from the 51st row, anchors scoped to their conversation),
the monotonic send timestamp, the GREATEST conversation bump and read
upsert, the exact unread aggregate and the inbox audience selection — each
aggregate one statement whatever the row count."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from app.messaging.infrastructure import repository
from app.messaging.models import Conversation, ConversationKind, ConversationRead, Message
from tests.conftest import count_queries
from tests.test_organizer_page import _circle, _in_days, _term
from tests.test_term_item_listings import _register


async def _conversation(
    db: AsyncSession,
    kind: ConversationKind,
    *,
    group_id: uuid.UUID | None = None,
    term_id: uuid.UUID | None = None,
    asker: uuid.UUID | None = None,
    owner: uuid.UUID | None = None,
) -> uuid.UUID:
    conversation = Conversation(
        kind=kind,
        group_id=group_id,
        term_id=term_id,
        asker_party_id=asker,
        owner_party_id=owner,
    )
    db.add(conversation)
    await db.flush()
    return conversation.id


async def _send(db: AsyncSession, conversation_id: uuid.UUID, sender: uuid.UUID) -> Message:
    """The send path's statement sequence (spec requirement 18 steps 6–10)."""
    last = await repository.lock_conversation_for_send(db, conversation_id)
    message = await repository.insert_message(db, conversation_id, sender, "cześć", last)
    await repository.bump_last_message_at(db, conversation_id, message.created_at)
    await repository.upsert_read_marker(db, conversation_id, sender, message.created_at)
    return message


async def _two_parties(client: AsyncClient, prefix: str) -> tuple[uuid.UUID, uuid.UUID]:
    _, a = await _register(client, "GUEST", f"{prefix}.a@example.com")
    _, b = await _register(client, "GUEST", f"{prefix}.b@example.com")
    return a, b


async def test_listMessagesPage_keyset_returns50WindowsWithHasMore_andScopesAnchors(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    a, b = await _two_parties(client, "mrepo.page")
    conversation_id = await _conversation(db_session, ConversationKind.ITEM, asker=a, owner=b)
    other_id = await _conversation(db_session, ConversationKind.ITEM, asker=b, owner=a)
    sent = [await _send(db_session, conversation_id, a if i % 2 else b) for i in range(60)]
    foreign = await _send(db_session, other_id, a)
    ids = [m.id for m in sent]

    newest, has_older = await repository.list_messages_page(db_session, conversation_id)
    assert [m.id for m in newest] == ids[10:]
    assert has_older is True

    older, has_older = await repository.list_messages_page(
        db_session, conversation_id, before=newest[0]
    )
    assert [m.id for m in older] == ids[:10]
    assert has_older is False

    newer, has_newer = await repository.list_messages_page(
        db_session, conversation_id, after=sent[0]
    )
    assert [m.id for m in newer] == ids[1:51]
    assert has_newer is True
    tail, has_newer = await repository.list_messages_page(
        db_session, conversation_id, after=sent[9]
    )
    assert [m.id for m in tail] == ids[10:]
    assert has_newer is False

    anchor = await repository.get_message_anchor(db_session, conversation_id, ids[5])
    assert anchor is not None and anchor.id == ids[5]
    assert await repository.get_message_anchor(db_session, conversation_id, foreign.id) is None


async def test_insertMessage_createdAtStrictlyAfterLastMessage_evenWhenClockLags(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    a, b = await _two_parties(client, "mrepo.mono")
    conversation_id = await _conversation(db_session, ConversationKind.ITEM, asker=a, owner=b)
    future = datetime.utcnow() + timedelta(minutes=5)
    await repository.bump_last_message_at(db_session, conversation_id, future)

    first = await _send(db_session, conversation_id, a)
    second = await _send(db_session, conversation_id, b)

    assert first.created_at == future + timedelta(microseconds=1)
    assert second.created_at == future + timedelta(microseconds=2)
    assert await repository.lock_conversation_for_send(db_session, conversation_id) == (
        second.created_at
    )


async def test_bumpAndReadUpsert_keepGreatest_neverMoveBackwards(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    a, b = await _two_parties(client, "mrepo.greatest")
    conversation_id = await _conversation(db_session, ConversationKind.ITEM, asker=a, owner=b)
    assert await repository.lock_conversation_for_send(db_session, conversation_id) is None
    later = datetime.utcnow()
    earlier = later - timedelta(hours=1)

    await repository.bump_last_message_at(db_session, conversation_id, later)
    await repository.bump_last_message_at(db_session, conversation_id, earlier)
    assert await repository.lock_conversation_for_send(db_session, conversation_id) == later

    await repository.upsert_read_marker(db_session, conversation_id, b, later)
    await repository.upsert_read_marker(db_session, conversation_id, b, earlier)
    rows = (
        await db_session.execute(
            select(ConversationRead.last_read_at, ConversationRead.created_at).where(
                ConversationRead.conversation_id == conversation_id
            )
        )
    ).all()
    assert len(rows) == 1
    assert rows[0].last_read_at == later


async def test_unread_excludesOwnMessages_respectsReadMarker_andLastMessageIsNewest(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    a, b = await _two_parties(client, "mrepo.unread")
    conversation_id = await _conversation(db_session, ConversationKind.ITEM, asker=a, owner=b)
    no_ids: set[uuid.UUID] = set()
    for _ in range(11):
        await _send(db_session, conversation_id, a)
    assert await repository.count_unread(db_session, conversation_id, b) == 11  # uncapped
    assert await repository.count_unread(db_session, conversation_id, a) == 0  # own messages

    from_b = [await _send(db_session, conversation_id, b) for _ in range(2)]
    assert await repository.count_unread(db_session, conversation_id, b) == 0  # send marks read
    assert await repository.count_unread(db_session, conversation_id, a) == 2
    await repository.upsert_read_marker(db_session, conversation_id, a, from_b[0].created_at)
    assert await repository.count_unread(db_session, conversation_id, a) == 1

    other_id = await _conversation(db_session, ConversationKind.ITEM, asker=b, owner=a)
    await _send(db_session, other_id, a)
    assert await repository.sum_unread(db_session, a, no_ids, no_ids, no_ids) == 1
    assert await repository.sum_unread(db_session, b, no_ids, no_ids, no_ids) == 1

    rows = await repository.select_inbox_rows(db_session, a, no_ids, no_ids, no_ids)
    assert [(row.conversation.id, row.unread_count) for row in rows] == [
        (other_id, 0),
        (conversation_id, 1),
    ]
    last = await repository.last_messages_for(db_session, [conversation_id, other_id])
    assert set(last) == {conversation_id, other_id}
    assert last[conversation_id].id == from_b[-1].id
    assert await repository.last_messages_for(db_session, []) == {}


async def test_inboxSelection_audienceSets_excludeEmpty_inOneStatementEach(
    client: AsyncClient, db_session: AsyncSession, engine: AsyncEngine
) -> None:
    org_token, org = await _register(client, "ORGANIZER", "mrepo.aud.org@example.com")
    me, stranger = await _two_parties(client, "mrepo.aud")
    led, member, foreign = [
        await _circle(client, org_token, f"Mrepo krąg {n}", "PRIVATE") for n in range(3)
    ]
    attended_term = await _term(client, org_token, foreign, _in_days(2))
    led_term = await _term(client, org_token, led, _in_days(3))
    foreign_term = await _term(client, org_token, foreign, _in_days(4))
    silent_term = await _term(client, org_token, led, _in_days(5))

    item = ConversationKind.ITEM
    visible = [
        await _conversation(db_session, item, asker=me, owner=stranger),
        await _conversation(db_session, item, asker=stranger, owner=me),
        await _conversation(db_session, ConversationKind.GROUP, group_id=led),
        await _conversation(db_session, ConversationKind.GROUP, group_id=member),
        await _conversation(
            db_session, ConversationKind.TERM, term_id=attended_term, group_id=foreign
        ),
        await _conversation(db_session, ConversationKind.TERM, term_id=led_term, group_id=led),
    ]
    hidden = [
        await _conversation(db_session, item, asker=stranger, owner=org),
        await _conversation(db_session, ConversationKind.GROUP, group_id=foreign),
        await _conversation(
            db_session, ConversationKind.TERM, term_id=foreign_term, group_id=foreign
        ),
    ]
    await _conversation(db_session, ConversationKind.TERM, term_id=silent_term, group_id=led)
    for conversation_id in visible + hidden:
        await _send(db_session, conversation_id, stranger)
    led_ids, member_ids, attended_ids = {led}, {member}, {attended_term}

    with count_queries(engine) as inbox_statements:
        rows = await repository.select_inbox_rows(db_session, me, led_ids, member_ids, attended_ids)
    with count_queries(engine) as sum_statements:
        total = await repository.sum_unread(db_session, me, led_ids, member_ids, attended_ids)

    assert [row.conversation.id for row in rows] == list(reversed(visible))
    assert all(row.unread_count == 1 for row in rows)
    assert total == len(visible)
    assert len(inbox_statements) == 1
    assert len(sum_statements) == 1
    limited = await repository.select_inbox_rows(
        db_session, me, led_ids, member_ids, attended_ids, limit=2
    )
    assert [row.conversation.id for row in limited] == list(reversed(visible))[:2]
