import { NavLink } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { useUnreadMessages } from "../../hooks/useUnreadMessages";
import { INBOX_PATH } from "../../utils/messagesPaths";

/** The 💬 link to the inbox in the top account bar, with the polled unread
 * badge (same classes as NotificationBell's). Rendered only when logged in. */
export function MessagesButton() {
  const { token } = useAuth();
  if (!token) return null;
  return <MessagesLink />;
}

function MessagesLink() {
  const { count } = useUnreadMessages();
  return (
    <NavLink
      to={INBOX_PATH}
      aria-label={count > 0 ? `Wiadomości (${count} nieprzeczytane)` : "Wiadomości"}
      className={({ isActive }) =>
        `relative flex h-10 w-10 flex-none items-center justify-center rounded-full text-[19px] text-ink transition-colors hover:bg-mint-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring ${
          isActive ? "bg-mint-soft" : ""
        }`
      }
    >
      <span aria-hidden="true">💬</span>
      {count > 0 && (
        <span
          data-testid="messages-badge"
          aria-hidden="true"
          className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-mint px-1 text-[10.5px] font-extrabold text-white"
        >
          {count > 9 ? "9+" : count}
        </span>
      )}
    </NavLink>
  );
}
