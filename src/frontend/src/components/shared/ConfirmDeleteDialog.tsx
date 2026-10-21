import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { trapFocus } from "./trapFocus";
import { useRegisterOpenSheet } from "./openSheets";

interface ConfirmDeleteDialogProps {
  title: string;
  body: string;
  confirmLabel: string;
  /** Shown when `onConfirm` rejects without a message. */
  fallbackError: string;
  /** `primary` for a confirm that is not destructive (default `danger`). */
  tone?: "danger" | "primary";
  /** The confirm label while `onConfirm` runs. */
  busyLabel?: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}

const CONFIRM_TONE = { danger: "bg-danger text-paper", primary: "bg-primary text-on-primary" } as const;

/** Confirms a delete (or, with `tone="primary"`, another irreversible action). Tailwind-only and rendered in place, so it stays inside
 * the host's theme scope. Only a resolved `onConfirm` ends it (the parent
 * unmounts it); a rejection is shown inline and the dialog stays open. On
 * unmount focus returns to the element that opened it. */
export function ConfirmDeleteDialog({
  title,
  body,
  confirmLabel,
  fallbackError,
  tone = "danger",
  busyLabel = "Usuwanie…",
  onConfirm,
  onClose,
}: ConfirmDeleteDialogProps) {
  const titleId = useId();
  const bodyId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [opener] = useState(() => document.activeElement);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useRegisterOpenSheet(true);

  useEffect(() => {
    cancelRef.current?.focus();
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected && opener !== document.body) {
        opener.focus();
      } else {
        document.querySelector<HTMLElement>("main")?.focus();
      }
    };
  }, [opener]);

  useEffect(() => {
    if (error) cancelRef.current?.focus();
  }, [error]);

  async function handleConfirm() {
    // The focused button is about to be disabled; keep focus inside the dialog.
    dialogRef.current?.focus();
    setError(null);
    setBusy(true);
    try {
      await onConfirm();
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error && err.message ? err.message : fallbackError);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Tab") {
      if (busy) event.preventDefault();
      else trapFocus(event, dialogRef.current);
      return;
    }
    if (event.key !== "Escape" || event.defaultPrevented || busy) return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-scrim px-4"
      onClick={(event) => {
        event.stopPropagation();
        if (!busy) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
        className="w-full max-w-[340px] rounded-[24px] bg-paper p-5 font-sans outline-none"
      >
        <h2 id={titleId} className="font-serif text-lg font-semibold text-ink">
          {title}
        </h2>
        <p id={bodyId} className="mt-2 text-sm text-ink-soft">
          {body}
        </p>
        {error && (
          <p role="alert" className="mt-3 text-sm font-semibold text-danger">
            {error}
          </p>
        )}
        <div className="mt-5 flex gap-2.5">
          <button
            ref={cancelRef}
            type="button"
            onClick={onClose}
            disabled={busy}
            className="min-h-[44px] flex-1 rounded-full border-[1.5px] border-line bg-cream px-4 py-2.5 text-sm font-extrabold text-ink disabled:opacity-60"
          >
            Anuluj
          </button>
          <button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={busy}
            aria-busy={busy || undefined}
            className={`min-h-[44px] flex-1 rounded-full px-4 py-2.5 text-sm font-extrabold disabled:opacity-60 ${CONFIRM_TONE[tone]}`}
          >
            {busy ? busyLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
