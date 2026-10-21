import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { CloseIcon } from "../../pages/panel/panelIcons";
import { useRegisterOpenSheet } from "./openSheets";
import { trapFocus } from "./trapFocus";

/**
 * Shared bottom-sheet chrome for term-page dialogs and app-wide prompts —
 * dim overlay (click to close), a rounded-top card that stops the
 * close-click from bubbling, and a title row with a ✕ button. Esc on the
 * dialog closes it unless a child already handled the key
 * (`preventDefault`). Tab/Shift+Tab wrap within the sheet. Focus moves in on open and, on close, back to the
 * element that had it, or to `main` when that element is gone.
 * `registerAsPageSheet={false}` keeps a sheet out of the open-sheet count
 * (for the app-wide host that waits on that count).
 */
export function ModalSheet({
  title,
  ariaLabel,
  onClose,
  registerAsPageSheet = true,
  children,
}: {
  title: string;
  ariaLabel?: string;
  onClose: () => void;
  registerAsPageSheet?: boolean;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [opener] = useState(() => document.activeElement);
  useRegisterOpenSheet(registerAsPageSheet);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.contains(document.activeElement)) dialog.focus();
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected && opener !== document.body) {
        opener.focus();
      } else {
        document.querySelector<HTMLElement>("main")?.focus();
      }
    };
  }, [opener]);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Tab") {
      trapFocus(event, dialogRef.current);
      return;
    }
    if (event.key !== "Escape" || event.defaultPrevented) return;
    event.preventDefault();
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-scrim min-[520px]:items-center"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel ?? title}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
        className="max-h-[88vh] w-full max-w-[430px] overflow-y-auto rounded-t-[24px] bg-paper p-5 outline-none min-[520px]:max-h-[80vh] min-[520px]:rounded-[24px]"
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-serif text-lg font-semibold text-ink">{title}</h3>
          <button
            onClick={onClose}
            aria-label="Zamknij"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-cream text-ink-soft hover:bg-danger-soft hover:text-danger"
          >
            <CloseIcon />
          </button>
        </div>

        {children}
      </div>
    </div>
  );
}
