import { Fragment, useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import type { ConversationResponse, MessageResponse, ReadOnlyReason } from "../../api/conversations";
import { Avatar } from "../../components/shared/Avatar";
import { useConversation } from "../../hooks/useConversation";
import { useThread } from "../../hooks/useThread";
import { INBOX_PATH } from "../../utils/messagesPaths";
import { pluralPl } from "../../utils/plural";
import { BackIcon } from "../panel/panelIcons";
import { MessageBubble } from "./MessageBubble";
import { MessageComposer } from "./MessageComposer";
import { formatDaySeparator, localDayKey } from "./messageTime";
import { resolveThreadView, type ThreadContentView } from "./threadViewState";
import { useThreadReadMarker } from "./useThreadReadMarker";

/** Within this distance of the bottom the list follows new messages. */
const STICK_TO_BOTTOM_PX = 48;

const HEADER_LINE: Record<NonNullable<ReadOnlyReason>, string> = {
  GROUP_DELETED: "Grupa usunięta",
  GROUP_PUBLIC: "Grupa publiczna",
};

const READ_ONLY_BANNER: Record<NonNullable<ReadOnlyReason>, string> = {
  GROUP_DELETED: "Grupa usunięta — czat jest tylko do odczytu",
  GROUP_PUBLIC: "Grupa jest publiczna — czat jest tylko do odczytu",
};

const FOCUS_RING = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

type Thread = ReturnType<typeof useThread>;

/** One conversation, full height under the top bar: header, scrolling
 * messages and the sticky composer (or the read-only banner). */
export function ThreadPage() {
  const { conversationId = "" } = useParams();
  const conversation = useConversation(conversationId);
  // A conversation known to be missing or off-limits stops the 5 s poll.
  const thread = useThread(conversationId, { poll: !conversation.notFound && !conversation.denied });
  const view = resolveThreadView({ conversation, thread });
  const last = thread.items.at(-1);
  useThreadReadMarker(view.kind, last?.id ?? null, last?.is_mine ?? false, thread.markRead);

  const { send } = thread;
  const { refetch: refetchConversation } = conversation;
  // A send can fail because the chat just became read-only (409); reloading
  // the header lets the banner replace the composer.
  const sendAndRefresh = useCallback(
    async (body: string) => {
      try {
        await send(body);
      } catch (err) {
        void refetchConversation();
        throw err;
      }
    },
    [send, refetchConversation],
  );

  switch (view.kind) {
    case "loading":
      return <ThreadLoading />;
    case "notFound":
      return <ThreadUnavailable message="Nie znaleziono rozmowy." />;
    case "denied":
      return <ThreadUnavailable message="Nie masz dostępu do tej rozmowy." />;
    case "error":
      return (
        <ThreadError
          message={view.message}
          onRetry={() => void Promise.all([conversation.refetch(), thread.refetch()])}
        />
      );
    case "readOnly":
    case "ready":
      return <ThreadContent view={view} thread={thread} send={sendAndRefresh} />;
  }
}

function ThreadShell({ children }: { children: ReactNode }) {
  return <div className="flex h-[calc(100dvh-57px)] flex-col bg-paper font-sans text-ink">{children}</div>;
}

function BackButton() {
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <button
      type="button"
      aria-label="Wróć"
      onClick={() => (location.key !== "default" ? navigate(-1) : navigate(INBOX_PATH))}
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-cream text-ink ${FOCUS_RING}`}
    >
      <BackIcon />
    </button>
  );
}

function ThreadContent({
  view,
  thread,
  send,
}: {
  view: ThreadContentView;
  thread: Thread;
  send: (body: string) => Promise<void>;
}) {
  const { conversation } = view;
  const showSender = conversation.kind !== "ITEM";
  return (
    <ThreadShell>
      <ThreadHeader conversation={conversation} />
      <MessageList thread={thread} showSender={showSender} />
      {view.kind === "readOnly" ? (
        <p
          role="status"
          className="flex-none border-t border-line bg-stage p-3.5 text-center text-[12.5px] font-bold text-ink-soft"
        >
          {READ_ONLY_BANNER[view.reason]}
        </p>
      ) : (
        <MessageComposer send={send} />
      )}
    </ThreadShell>
  );
}

function ThreadHeader({ conversation }: { conversation: ConversationResponse }) {
  const isItem = conversation.kind === "ITEM";
  const item = conversation.item;
  const groupName = conversation.group_name ?? conversation.title;

  let title: ReactNode;
  let subtitle: ReactNode;
  if (isItem) {
    title = item?.deleted ? (
      <>
        {item.name} <span className="font-semibold text-ink-soft">(usunięte)</span>
      </>
    ) : (
      (item?.name ?? conversation.title)
    );
    // The counterpart's name truncates first so the item link stays visible.
    subtitle = (
      <span className="flex min-w-0">
        <span className="min-w-0 truncate">Rozmowa z: {conversation.counterpart_name}</span>
        {item && !item.deleted && (
          <>
            <span className="shrink-0 whitespace-pre">{" · "}</span>
            <Link to={`/product/${item.id}`} className={`shrink-0 whitespace-nowrap underline ${FOCUS_RING}`}>
              zobacz rzecz
            </Link>
          </>
        )}
      </span>
    );
  } else {
    const count = conversation.participant_count;
    title = `${groupName} · ${conversation.kind === "TERM" ? "czat terminu" : "czat grupy"}`;
    subtitle =
      conversation.read_only_reason !== null
        ? HEADER_LINE[conversation.read_only_reason]
        : count !== null && `${count} ${pluralPl(count, "uczestnik", "uczestników", "uczestników")}`;
  }

  return (
    <header className="flex flex-none items-center gap-2.5 border-b border-line px-3 py-2.5">
      <BackButton />
      {isItem ? (
        <span
          aria-hidden="true"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-linear-135 from-line-strong to-accent-soft text-lg"
        >
          📦
        </span>
      ) : (
        <Avatar name={groupName} size="md" />
      )}
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-[14.5px] leading-tight font-bold">{title}</h1>
        {subtitle && <p className="truncate text-[11.5px] text-ink-soft">{subtitle}</p>}
      </div>
    </header>
  );
}

function MessageList({ thread, showSender }: { thread: Thread; showSender: boolean }) {
  const { items, hasOlder, loadOlder, loadingOlder } = thread;
  const [olderError, setOlderError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const previous = useRef<{ first?: string; last?: string; height: number }>({ height: 0 });

  // New messages at the end follow the bottom when the reader was there (or
  // sent them); older ones prepended above keep the visible message in place.
  // The list sets `overflow-anchor: none`, so this is the only compensation
  // (browser scroll anchoring would add the same delta a second time).
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const prev = previous.current;
    const first = items[0]?.id;
    const last = items.at(-1);
    if (last?.id !== prev.last) {
      if (prev.last === undefined || atBottom.current || last?.is_mine) el.scrollTop = el.scrollHeight;
    } else if (first !== prev.first && prev.first !== undefined) {
      el.scrollTop += el.scrollHeight - prev.height;
    }
    previous.current = { first, last: last?.id, height: el.scrollHeight };
  }, [items]);

  const showOlder = useCallback(async () => {
    setOlderError(null);
    try {
      await loadOlder();
    } catch (err) {
      setOlderError(err instanceof Error ? err.message : "Nie udało się wczytać wiadomości");
    }
  }, [loadOlder]);

  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_TO_BOTTOM_PX;
    if (el.scrollTop === 0 && hasOlder && !loadingOlder && olderError === null) void showOlder();
  };

  return (
    <div
      ref={listRef}
      onScroll={onScroll}
      role="log"
      aria-label="Wiadomości"
      tabIndex={0}
      className={`relative flex flex-1 flex-col gap-1.5 overflow-y-auto bg-cream px-3 pt-3 pb-1.5 [overflow-anchor:none] ${FOCUS_RING}`}
    >
      {hasOlder && (
        <button
          type="button"
          onClick={() => void showOlder()}
          disabled={loadingOlder}
          className={`self-center rounded-full border-[1.5px] border-line bg-paper px-3.5 py-1.5 text-xs font-extrabold text-ink disabled:opacity-60 ${FOCUS_RING}`}
        >
          Wcześniejsze wiadomości
        </button>
      )}
      {olderError && (
        <p role="alert" className="self-center text-xs font-semibold text-danger">
          {olderError}
        </p>
      )}
      {items.map((m, i) => (
        <Fragment key={m.id}>
          {(i === 0 || localDayKey(items[i - 1].created_at) !== localDayKey(m.created_at)) && (
            <DaySeparator message={m} />
          )}
          <MessageBubble
            body={m.body}
            createdAt={m.created_at}
            mine={m.is_mine}
            senderName={m.sender_name}
            showSender={showSender}
            senderIsOrganizer={m.sender_is_organizer}
          />
        </Fragment>
      ))}
    </div>
  );
}

function DaySeparator({ message }: { message: MessageResponse }) {
  return (
    <p className="my-1.5 self-center rounded-full border border-line bg-paper px-2.5 py-0.5 text-[11px] font-bold text-ink-soft">
      {formatDaySeparator(message.created_at)}
    </p>
  );
}

function ThreadLoading() {
  return (
    <ThreadShell>
      <div className="flex flex-none items-center gap-2.5 border-b border-line px-3 py-2.5">
        <span className="h-9 w-9 rounded-full bg-stage" />
        <span className="h-10 w-10 rounded-xl bg-stage" />
        <span className="h-4 w-40 rounded-[10px] bg-stage" />
      </div>
      <div role="status" className="flex flex-1 flex-col gap-2 bg-cream p-3">
        <span className="sr-only">Wczytywanie rozmowy…</span>
        <span className="h-10 w-2/3 rounded-[18px] bg-stage" />
        <span className="h-10 w-1/2 self-end rounded-[18px] bg-stage" />
      </div>
    </ThreadShell>
  );
}

function ThreadUnavailable({ message }: { message: string }) {
  return (
    <ThreadShell>
      <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-cream p-4 text-center">
        <p className="text-sm font-semibold">{message}</p>
        <Link
          to={INBOX_PATH}
          className={`rounded-full border-[1.5px] border-line bg-paper px-4 py-2 text-[13px] font-extrabold ${FOCUS_RING}`}
        >
          Wróć do wiadomości
        </Link>
      </div>
    </ThreadShell>
  );
}

function ThreadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <ThreadShell>
      <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-cream p-4 text-center">
        <p role="alert" className="text-sm font-semibold text-danger">
          {message}
        </p>
        <button
          type="button"
          onClick={onRetry}
          className={`rounded-full bg-primary px-4 py-2 text-[13px] font-extrabold text-on-primary ${FOCUS_RING}`}
        >
          Spróbuj ponownie
        </button>
      </div>
    </ThreadShell>
  );
}
