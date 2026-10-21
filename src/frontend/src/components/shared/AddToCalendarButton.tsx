import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { BTN_GHOST, BTN_LG, BTN_SM } from "./uiStyles";
import { CalendarIcon } from "../../pages/panel/panelIcons";
import { buildGoogleCalendarUrl, downloadIcs, type CalendarEvent } from "../../utils/calendar";
import { ACCOUNT_MENU_ITEM_CLASS } from "./AccountMenu";

/** "Dodaj do kalendarza" trigger with a two-item menu (Google Calendar link
 * and `.ics` download), following the `AccountMenu` popover pattern. Inside
 * a sheet it opens upward so the sheet's scroll area does not clip it. */
export function AddToCalendarButton({
  event,
  size,
  direction,
}: {
  event: CalendarEvent;
  size: "lg" | "sm";
  direction: "up" | "down";
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const closeToTrigger = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const menuItems = () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const closeOnOutside = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutside);
    return () => document.removeEventListener("pointerdown", closeOnOutside);
  }, [open]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!open) {
      if (e.key === "ArrowDown" && e.target === triggerRef.current) {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    } else if (e.key === "Tab") {
      triggerRef.current?.focus();
      setOpen(false);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const items = menuItems();
      const current = items.indexOf(document.activeElement as HTMLElement);
      const step = e.key === "ArrowDown" ? 1 : -1;
      items[(current + step + items.length) % items.length]?.focus();
    }
  };

  return (
    <div ref={rootRef} onKeyDown={onKeyDown} className={size === "lg" ? "relative" : "relative inline-block"}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        className={`${BTN_GHOST} ${size === "lg" ? `${BTN_LG} w-full` : BTN_SM} inline-flex items-center justify-center gap-2 whitespace-nowrap`}
      >
        <CalendarIcon c="currentColor" />
        Dodaj do kalendarza
        <span aria-hidden="true">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label="Dodaj do kalendarza"
          className={`absolute left-0 z-10 min-w-[220px] rounded-2xl border border-line bg-paper p-1.5 shadow-[0_16px_34px_-16px_rgba(30,46,39,0.45)] ${
            direction === "up" ? "bottom-full mb-2" : "top-full mt-2"
          }`}
        >
          <a
            role="menuitem"
            href={buildGoogleCalendarUrl(event)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={closeToTrigger}
            className={ACCOUNT_MENU_ITEM_CLASS}
          >
            Kalendarz Google
            <span aria-hidden="true" className="ml-auto">↗</span>
          </a>
          <button
            role="menuitem"
            type="button"
            onClick={() => {
              downloadIcs(event, new Date());
              closeToTrigger();
            }}
            className={ACCOUNT_MENU_ITEM_CLASS}
          >
            Apple / Outlook (.ics)
            <span aria-hidden="true" className="ml-auto">⬇</span>
          </button>
        </div>
      )}
    </div>
  );
}
