import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { GroupResponse } from "../../api/groups";
import { trapFocus } from "../../components/krag/trapFocus";
import { useRegisterOpenSheet } from "../../components/shared/openSheets";

const FALLBACK_ERROR = "Nie udało się usunąć grupy. Spróbuj ponownie.";

interface DeleteGroupDialogProps {
  group: GroupResponse;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}

/** Confirms deleting a group. Tailwind-only and rendered in place, so it stays
 * inside the organizer's theme scope. Only a resolved `onConfirm` ends it (the
 * parent unmounts it); a rejection is shown inline and the dialog stays open. */
export function DeleteGroupDialog({ group, onConfirm, onClose }: DeleteGroupDialogProps) {
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
      setError(err instanceof Error && err.message ? err.message : FALLBACK_ERROR);
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
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-scrim px-4"
      onClick={busy ? undefined : onClose}
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
          Usunąć grupę „{group.name}”?
        </h2>
        <p id={bodyId} className="mt-2 text-sm text-ink-soft">
          Grupa zniknie dla uczestników. Jeśli to pomyłka, napisz do nas — przywrócimy ją.
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
            onClick={handleConfirm}
            disabled={busy}
            aria-busy={busy || undefined}
            className="min-h-[44px] flex-1 rounded-full bg-danger px-4 py-2.5 text-sm font-extrabold text-paper disabled:opacity-60"
          >
            {busy ? "Usuwanie…" : "Usuń grupę"}
          </button>
        </div>
      </div>
    </div>
  );
}
