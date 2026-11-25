import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { PencilIcon, TrashIcon } from "../../components/shared/appIcons";
import { Link } from "../../routing/navigation";

const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";
const ITEM = `flex min-h-10 w-full items-center gap-2 rounded-[10px] px-2.5 text-left text-sm font-bold hover:bg-cream ${FOCUS}`;

/** The „⋯” button of one of the owner's items, opening Edytuj and Usuń.
 * Esc or a click outside closes it and returns the focus to the button. */
export function ItemActionsMenu({
  itemName,
  editPath,
  onDelete,
}: {
  itemName: string;
  editPath: string;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open]);

  function close() {
    setOpen(false);
    buttonRef.current?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    close();
  }

  return (
    <div className="relative flex-none">
      <button
        ref={buttonRef}
        type="button"
        aria-label={`Więcej działań: ${itemName}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
        className={`flex h-10 w-10 items-center justify-center rounded-full border-[1.5px] border-line bg-paper text-ink-soft transition-colors hover:text-ink ${FOCUS}`}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor" className="h-4.5 w-4.5">
          <circle cx="5" cy="12" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="19" cy="12" r="2" />
        </svg>
      </button>
      {open && (
        <>
          <button
            type="button"
            tabIndex={-1}
            aria-label="Zamknij menu"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-20 cursor-default border-none bg-transparent p-0"
          />
          <div
            ref={menuRef}
            id={menuId}
            role="menu"
            aria-label={`Działania: ${itemName}`}
            onKeyDown={handleKeyDown}
            className="absolute top-12 right-0 z-30 w-44 rounded-2xl border border-line bg-paper p-1.5 shadow-[0_16px_34px_-16px_rgba(30,46,39,0.45)]"
          >
            <Link to={editPath} role="menuitem" aria-label={`Edytuj rzecz ${itemName}`} className={`${ITEM} text-ink`}>
              <PencilIcon c="currentColor" />
              Edytuj
            </Link>
            <button
              type="button"
              role="menuitem"
              aria-label={`Usuń rzecz ${itemName}`}
              onClick={() => {
                setOpen(false);
                onDelete();
              }}
              className={`${ITEM} text-danger`}
            >
              <TrashIcon />
              Usuń
            </button>
          </div>
        </>
      )}
    </div>
  );
}
