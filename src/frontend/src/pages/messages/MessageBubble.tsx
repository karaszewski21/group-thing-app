import { familyInitials, familyTone } from "../../components/shared/Avatar";
import { formatBubbleTime } from "./messageTime";

export interface MessageBubbleProps {
  body: string;
  /** Naive UTC audit time; shown as `HH:mm` inside the bubble. */
  createdAt: string;
  mine: boolean;
  senderName: string;
  /** GROUP and TERM chats: the sender's name (and the "Organizator" chip)
   * above others' bubbles. ITEM chats name the counterpart in the header. */
  showSender?: boolean;
  senderIsOrganizer?: boolean;
}

const BUBBLE = "max-w-[80%] rounded-[18px] px-3 py-2 text-sm leading-[1.35] whitespace-pre-line break-words";

/** One chat message: mine on the right in the primary color, others on the
 * left on paper next to the sender's initials. */
export function MessageBubble({
  body,
  createdAt,
  mine,
  senderName,
  showSender = false,
  senderIsOrganizer = false,
}: MessageBubbleProps) {
  const time = (
    <time dateTime={createdAt} className="mt-0.75 block text-right text-[10.5px] opacity-75">
      {formatBubbleTime(createdAt)}
    </time>
  );

  if (mine) {
    return (
      <div className={`${BUBBLE} self-end rounded-br-md bg-primary text-on-primary`}>
        <span className="sr-only">Ty:</span> {body}
        {time}
      </div>
    );
  }

  return (
    <>
      {showSender && (
        <p className="mt-1 ml-10.5 text-[11.5px] font-extrabold text-ink-soft">
          {senderName}
          {senderIsOrganizer && " "}
          {senderIsOrganizer && (
            <span className="ml-1 rounded-full bg-mint-soft px-1.5 text-[10px] text-primary-fg">Organizator</span>
          )}
        </p>
      )}
      <div className="flex items-end gap-2">
        <span
          aria-hidden="true"
          className={`flex h-8.5 w-8.5 shrink-0 items-center justify-center rounded-full text-xs font-extrabold text-ink ${familyTone(senderName)}`}
        >
          {familyInitials(senderName)}
        </span>
        <div className={`${BUBBLE} rounded-bl-md border border-line bg-paper text-ink`}>
          {!showSender && (
            <>
              <span className="sr-only">{senderName}:</span>{" "}
            </>
          )}
          {body}
          {time}
        </div>
      </div>
    </>
  );
}
