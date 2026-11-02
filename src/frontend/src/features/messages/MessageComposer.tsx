import { useEffect, useId, useRef, useState } from "react";
import { chatErrorMessage } from "../../api/conversations";

const MESSAGE_MAX = 1000;
const SEND_FALLBACK = "Nie udało się wysłać — spróbuj ponownie";

/** `useThread().send` rethrows a plain `Error` carrying Polish copy; any
 * other error (an `ApiError`, a network `TypeError`) is mapped here so the
 * composer never shows an English status line. */
function sendErrorMessage(err: unknown): string {
  if (err instanceof Error && err.name === "Error" && err.message) return err.message;
  return chatErrorMessage(err, SEND_FALLBACK);
}

/** The thread's sticky composer, rendered only for a writable thread. Enter
 * inserts a new line; only "Wyślij" sends. The text is cleared on success and
 * kept on error. The field takes focus when the composer appears and gets it
 * back after every send, so the mobile keyboard stays open. */
export function MessageComposer({ send }: { send: (body: string) => Promise<void> }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();
  const fieldRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fieldRef.current?.focus();
  }, []);

  const body = text.trim();
  const tooLong = body.length > MESSAGE_MAX;
  const disabled = busy || body.length === 0 || tooLong;

  const submit = async () => {
    if (disabled) return;
    setBusy(true);
    setError(null);
    try {
      await send(body);
      setText("");
    } catch (err) {
      setError(sendErrorMessage(err));
    } finally {
      setBusy(false);
      fieldRef.current?.focus();
    }
  };

  return (
    <form
      className="flex-none border-t border-line bg-paper px-3 pt-2.5 pb-3.5"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="flex items-end gap-2">
        <textarea
          ref={fieldRef}
          aria-label="Wiadomość"
          placeholder="Napisz wiadomość…"
          rows={1}
          maxLength={MESSAGE_MAX}
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-invalid={tooLong || undefined}
          aria-describedby={error ? errorId : undefined}
          className="field-sizing-content max-h-32 min-h-10 min-w-0 flex-1 resize-none rounded-2xl border-[1.5px] border-line bg-cream px-3 py-2.25 font-sans text-sm text-ink placeholder:text-ink-soft focus:border-focus-ring focus:shadow-[0_0_0_3px_var(--color-primary-soft)] focus:outline-none"
        />
        <button
          type="submit"
          disabled={disabled}
          className="rounded-full bg-primary px-4 py-2.5 text-[13px] font-extrabold text-on-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:opacity-60"
        >
          Wyślij
        </button>
      </div>
      <div className="mt-1.25 flex justify-between text-[11px] text-ink-soft">
        <span>Enter — nowa linia</span>
        <span>
          {text.length} / {MESSAGE_MAX}
        </span>
      </div>
      {error && (
        <p id={errorId} role="alert" className="mt-1.5 text-xs font-semibold text-danger">
          {error}
        </p>
      )}
    </form>
  );
}
