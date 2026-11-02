const CHAT_BUTTON =
  "flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-full border-[1.5px] border-line bg-paper px-3 text-[13px] font-extrabold text-ink hover:border-line-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:opacity-60";

/** "Czat wydarzenia" for the author and active attendees. The caller opens
 * the chat (`useOpenAndNavigate`) and passes its state in. */
export function EventChatRow({
  onOpen,
  busy,
  error,
}: {
  onOpen: () => void;
  busy: boolean;
  error: string | null;
}) {
  return (
    <div className="mx-5 mt-3">
      <div className="flex">
        <button type="button" className={CHAT_BUTTON} disabled={busy} onClick={onOpen}>
          <span aria-hidden="true">💬</span> Czat wydarzenia
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-1.5 text-xs font-semibold text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
