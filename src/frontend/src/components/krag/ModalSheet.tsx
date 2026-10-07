import type { ReactNode } from "react";
import { CloseIcon } from "../../pages/panel/panelIcons";

/**
 * Shared bottom-sheet chrome for every term-page dialog (`AuthGateSheet`,
 * `RsvpDialog`, `RsvpDialogLoggedIn`, `SwapProposeDialog`) — dim overlay
 * (click to close), a rounded-top card that stops the close-click from
 * bubbling, and a title row with a ✕ button. Mirrors `pages/panel/
 * panelComponents.tsx`'s `ModalSheet` (Tailwind, not `.kg-*`/inline styles).
 */
export function ModalSheet({
  title,
  ariaLabel,
  onClose,
  children,
}: {
  title: string;
  ariaLabel?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-scrim min-[520px]:items-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel ?? title}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[88vh] w-full max-w-[430px] overflow-y-auto rounded-t-[24px] bg-paper p-5 min-[520px]:max-h-[80vh] min-[520px]:rounded-[24px]"
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-serif text-lg font-semibold text-ink">{title}</h3>
          <button
            onClick={onClose}
            aria-label="Zamknij"
            className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-cream text-ink-soft hover:bg-danger-soft hover:text-danger"
          >
            <CloseIcon />
          </button>
        </div>

        {children}
      </div>
    </div>
  );
}
