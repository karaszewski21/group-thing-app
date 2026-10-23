import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { ConversationKind, InboxRow } from "../../api/conversations";
import { Avatar } from "../../components/shared/Avatar";
import { PhoneFrame } from "../../components/shared/PhoneFrame";
import { useConversations } from "../../hooks/useConversations";
import { threadPath } from "../../utils/messagesPaths";
import { BackIcon } from "../../components/shared/appIcons";
import { formatInboxTime } from "./messageTime";

const FOCUS_RING = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

const KIND_CHIP: Record<ConversationKind, { label: string; className: string }> = {
  ITEM: { label: "Rzecz", className: "bg-accent-soft text-ink" },
  GROUP: { label: "Grupa", className: "bg-mint-soft text-primary-fg" },
  TERM: { label: "Termin", className: "bg-teal-soft text-ink" },
};

/** The messages inbox (`/wiadomosci`): every conversation with a
 * message, newest first, read-only chats included. */
export function InboxPage() {
  const { data, loading, error, refetch } = useConversations();

  let body: ReactNode;
  if (loading) body = <InboxSkeleton />;
  else if (error) body = <InboxError message={error} onRetry={() => void refetch()} />;
  else if (data.length === 0) body = <InboxEmpty />;
  else
    body = (
      <ul className="mt-2.5">
        {data.map((row) => (
          <li key={row.id}>
            <InboxRowLink row={row} />
          </li>
        ))}
      </ul>
    );

  return (
    <PhoneFrame>
      <div className="flex-1 overflow-y-auto px-[18px] pb-6 pt-[18px]">
        <Link to="/" className={`inline-flex items-center gap-1.5 text-xs font-bold text-ink-soft ${FOCUS_RING}`}>
          <BackIcon /> Wróć
        </Link>
        <h1 className="mt-2 text-[19px] font-semibold text-ink">Wiadomości</h1>
        {body}
      </div>
    </PhoneFrame>
  );
}

function LeadingVisual({ row }: { row: InboxRow }) {
  switch (row.kind) {
    case "ITEM":
      return <RoundIcon className="bg-accent-soft">📦</RoundIcon>;
    case "GROUP":
      return <Avatar name={row.group_name ?? row.title} size="md" />;
    case "TERM":
      return <RoundIcon className="bg-teal-soft">📅</RoundIcon>;
  }
}

function RoundIcon({ className, children }: { className: string; children: ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg ${className}`}
    >
      {children}
    </span>
  );
}

function previewSender(message: InboxRow["last_message"]): string {
  if (message.is_mine) return "Ty";
  if (message.sender_is_organizer) return "Organizator";
  return message.sender_name;
}

function InboxRowLink({ row }: { row: InboxRow }) {
  const chip = KIND_CHIP[row.kind];
  const unread = row.unread_count > 0;
  const emphasis = unread ? "font-extrabold text-ink" : "";
  return (
    <Link
      to={threadPath(row.id)}
      className={`flex items-start gap-3 border-b border-line px-1 py-3 hover:bg-paper ${FOCUS_RING}`}
    >
      <LeadingVisual row={row} />
      <div className="min-w-0 flex-1">
        <div className="flex justify-between gap-2 text-[14.5px] font-semibold">
          <span className="min-w-0 truncate">
            <span
              className={`mr-1.5 inline-block rounded-full px-2 py-px align-[1px] text-[10px] font-extrabold ${chip.className}`}
            >
              {chip.label}
            </span>
            <span className={emphasis}>{row.title}</span>
          </span>
          <time dateTime={row.last_message.created_at} className="flex-none text-[11.5px] font-semibold text-ink-soft">
            {formatInboxTime(row.last_message.created_at)}
          </time>
        </div>
        <div className="mt-0.5 flex items-center text-[12.5px] text-ink-soft">
          <span className={`min-w-0 truncate ${emphasis}`}>
            {previewSender(row.last_message)}: {row.last_message.body}
          </span>
          {unread && (
            <span className="ml-1.5 flex-none rounded-full bg-mint px-[7px] py-px text-[10.5px] font-extrabold text-white">
              {row.unread_count}{" "}
              <span className="sr-only">nieprzeczytane</span>
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

function InboxEmpty() {
  return (
    <p className="mt-3.5 rounded-2xl border border-dashed border-line p-[15px] text-[12.5px] text-ink-soft">
      Nie masz jeszcze rozmów. Zapytaj o rzecz na jej stronie albo napisz na czacie swojej grupy lub terminu.
    </p>
  );
}

function InboxSkeleton() {
  return (
    <div role="status" className="mt-2.5 flex gap-3 px-1 py-3">
      <span className="sr-only">Wczytywanie wiadomości…</span>
      <span className="h-10 w-10 shrink-0 rounded-full bg-stage" />
      <div className="flex-1">
        <span className="block h-3.5 w-3/5 rounded-[10px] bg-stage" />
        <span className="mt-1.5 block h-[11px] w-4/5 rounded-[10px] bg-stage" />
      </div>
    </div>
  );
}

function InboxError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="mt-3.5 flex flex-col items-start gap-2.5">
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
  );
}
