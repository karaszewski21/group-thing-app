import { useLocation, useNavigate } from "react-router-dom";
import { useUnreadMessages } from "../../hooks/useUnreadMessages";
import { INBOX_PATH } from "../../utils/messagesPaths";
import { BoxIcon, ChatIcon, HomeIcon, PlusIcon, UserIcon } from "../shared/appIcons";
import { ACCOUNT_SUBVIEWS, viewFromPath, viewPath } from "../../utils/appHelpers";

type TabKey = "home" | "chat" | "items" | "account";

const SIDE_TABS: { key: TabKey; label: string; to: string; Icon: typeof HomeIcon }[][] = [
  [
    { key: "home", label: "Start", to: viewPath("home"), Icon: HomeIcon },
    { key: "chat", label: "Czat", to: INBOX_PATH, Icon: ChatIcon },
  ],
  [
    { key: "items", label: "Moje rzeczy", to: viewPath("items"), Icon: BoxIcon },
    { key: "account", label: "Konto", to: viewPath("account"), Icon: UserIcon },
  ],
];

const TAB_CLASS =
  "flex min-h-12 flex-1 flex-col items-center gap-1 rounded-[14px] text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

/** The tab a pathname belongs to; `undefined` highlights none (item pages,
 * group details, …). */
function activeTab(pathname: string): TabKey | undefined {
  if (pathname === INBOX_PATH || pathname.startsWith(`${INBOX_PATH}/`)) return "chat";
  const view = viewFromPath(pathname);
  if (view === "home" || view === "items" || view === "account") return view;
  if (view !== null && ACCOUNT_SUBVIEWS.includes(view)) return "account";
  return undefined;
}

/** The app-wide sticky bottom tab bar: Start · Czat · a raised "+" (the Dodaj
 * page) · Moje rzeczy · Konto. Shown to anonymous visitors too — every tab
 * but Start is behind AuthGuard, which sends them to /login and back. */
export function BottomNav() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { count: unread } = useUnreadMessages();
  const active = activeTab(pathname);

  const tab = ({ key, label, to, Icon }: (typeof SIDE_TABS)[number][number]) => {
    const on = active === key;
    return (
      <button
        key={key}
        type="button"
        onClick={() => navigate(to)}
        aria-current={on}
        className={`${TAB_CLASS} ${on ? "font-extrabold text-primary-fg" : "font-bold text-ink-soft hover:text-ink"}`}
      >
        <span className={`relative flex h-7.5 w-13.5 items-center justify-center rounded-full ${on ? "bg-primary-soft" : ""}`}>
          <Icon c="currentColor" />
          {key === "chat" && unread > 0 && (
            <span className="absolute top-0.5 right-3 h-2.5 w-2.5 rounded-full border-2 border-paper bg-accent" />
          )}
        </span>
        {label}
        {key === "chat" && unread > 0 && (
          <>
            {" "}
            <span className="sr-only">({unread} nieprzeczytane)</span>
          </>
        )}
      </button>
    );
  };

  return (
    <nav
      aria-label="Nawigacja główna"
      className="sticky bottom-0 z-20 flex items-start border-t border-line bg-paper px-1.5 pt-2 pb-3"
    >
      {SIDE_TABS[0].map(tab)}
      <div className="flex flex-1 justify-center">
        <button
          type="button"
          onClick={() => navigate(viewPath("add"))}
          aria-label="Dodaj nowe"
          className="-mt-7.5 flex h-15.5 w-15.5 items-center justify-center rounded-full border-4 border-cream bg-primary text-on-primary shadow-[0_12px_22px_-10px_rgba(31,106,82,0.85)] transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          <PlusIcon />
        </button>
      </div>
      {SIDE_TABS[1].map(tab)}
    </nav>
  );
}
