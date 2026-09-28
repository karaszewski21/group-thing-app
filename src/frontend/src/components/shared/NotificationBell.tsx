import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { NotificationResponse } from "../../api/notifications";
import { useNotifications } from "../../hooks/useNotifications";
import { BellIcon } from "../../pages/panel/panelIcons";

/** The logged-in user's notification bell with its dropdown — opening an
 * entry marks it read and follows its `link_path`. Rendered in the top
 * account bar (`PublicLayout`), so it is available on every page there,
 * the Panel included. */
export function NotificationBell() {
  const { data: notifications, unreadCount, markRead, markAllRead } = useNotifications();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  function openNotification(n: NotificationResponse) {
    setOpen(false);
    if (n.read_at === null) markRead(n.id);
    if (n.link_path) navigate(n.link_path);
  }

  return (
    <div className="relative flex-none">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={unreadCount > 0 ? `Powiadomienia (${unreadCount} nieprzeczytane)` : "Powiadomienia"}
        aria-expanded={open}
        className="relative flex h-10 w-10 items-center justify-center rounded-[14px] border border-line bg-cream transition-colors hover:bg-mint-soft"
      >
        <BellIcon />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-mint px-1 text-[10.5px] font-extrabold text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>
      {open && (
        <>
          <button
            onClick={() => setOpen(false)}
            aria-label="Zamknij powiadomienia"
            className="fixed inset-0 z-[25] cursor-default border-none bg-transparent p-0"
          />
          <div
            role="menu"
            className="absolute right-0 top-12 z-30 max-h-[70vh] w-[290px] overflow-y-auto rounded-2xl border border-line bg-paper p-1.5 shadow-[0_16px_34px_-16px_rgba(30,46,39,0.45)]"
          >
            <div className="flex items-center justify-between px-2.5 py-2">
              <span className="text-xs font-extrabold uppercase tracking-wide text-ink-soft">
                Powiadomienia
              </span>
              {unreadCount > 0 && (
                <button
                  onClick={() => void markAllRead()}
                  className="text-[11px] font-bold text-mint hover:underline"
                >
                  Oznacz jako przeczytane
                </button>
              )}
            </div>
            {notifications.length === 0 ? (
              <p className="px-2.5 py-4 text-center text-[13px] text-ink-soft">Brak powiadomień</p>
            ) : (
              notifications.map((n) => (
                <button
                  key={n.id}
                  role="menuitem"
                  onClick={() => openNotification(n)}
                  className={`block w-full rounded-[11px] px-2.5 py-2 text-left text-[12.5px] leading-snug hover:bg-cream ${
                    n.read_at === null ? "font-bold text-ink" : "text-ink-soft"
                  }`}
                >
                  {n.read_at === null && (
                    <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-mint align-middle" />
                  )}
                  {n.message}
                </button>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
