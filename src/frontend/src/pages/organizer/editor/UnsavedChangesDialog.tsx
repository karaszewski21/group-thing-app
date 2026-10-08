import { useEffect, useRef, type KeyboardEvent } from "react";

interface UnsavedChangesDialogProps {
  onDiscard: () => void;
  onKeepEditing: () => void;
}

/** Confirms dropping an unsaved draft. Tailwind-only and rendered in place
 * (never Chakra's portalled ConfirmDialog), so it stays inside the
 * organizer's theme scope. It is the page's only focus trap. */
export function UnsavedChangesDialog({ onDiscard, onKeepEditing }: UnsavedChangesDialogProps) {
  const keepRef = useRef<HTMLButtonElement>(null);
  const discardRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    keepRef.current?.focus();
  }, []);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onKeepEditing();
      return;
    }
    if (event.key !== "Tab") return;
    event.preventDefault();
    const next = document.activeElement === keepRef.current ? discardRef.current : keepRef.current;
    next?.focus();
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-scrim px-4" onClick={onKeepEditing}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="unsaved-changes-title"
        aria-describedby="unsaved-changes-body"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
        className="w-full max-w-[340px] rounded-[24px] bg-paper p-5 font-sans"
      >
        <h2 id="unsaved-changes-title" className="font-serif text-lg font-semibold text-ink">
          Odrzucić zmiany?
        </h2>
        <p id="unsaved-changes-body" className="mt-2 text-sm text-ink-soft">
          Wybrany układ i kolory nie zostały zapisane.
        </p>
        <div className="mt-5 flex gap-2.5">
          <button
            ref={keepRef}
            type="button"
            onClick={onKeepEditing}
            className="min-h-[44px] flex-1 rounded-full border-[1.5px] border-line bg-cream px-4 py-2.5 text-sm font-extrabold text-ink"
          >
            Wróć do edycji
          </button>
          <button
            ref={discardRef}
            type="button"
            onClick={onDiscard}
            className="min-h-[44px] flex-1 rounded-full bg-danger px-4 py-2.5 text-sm font-extrabold text-paper"
          >
            Odrzuć
          </button>
        </div>
      </div>
    </div>
  );
}
