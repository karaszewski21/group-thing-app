import { useAppNavigate, useAppPathname } from "../../routing/navigation";
import { useUnreadMessages } from "../../hooks/useUnreadMessages";
import { INBOX_PATH } from "../../routing/messagesPaths";
import { BoxIcon, ChatIcon, HomeIcon, PlusIcon, UserIcon } from "../shared/appIcons";
import { isAccountSubviewPath } from "../../utils/appHelpers";
import { viewPath } from "../../routing/paths";

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
  "flex min-h-12 flex-1 flex-col items-center gap-1 rounded-[14px] text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring md:min-h-13 md:flex-row md:justify-center md:gap-2 md:rounded-full md:text-[15px] md:whitespace-nowrap";

/** The tab a pathname belongs to; `undefined` highlights none (item pages,
 * public pages, …). */
function activeTab(pathname: string): TabKey | undefined {
  if (pathname === INBOX_PATH || pathname.startsWith(`${INBOX_PATH}/`)) return "chat";
  if (pathname === viewPath("home")) return "home";
  if (pathname === viewPath("items")) return "items";
  if (pathname === viewPath("account") || isAccountSubviewPath(pathname)) return "account";
  return undefined;
}

/** The app-wide sticky bottom tab bar: Start · Czat · a raised "+" (the Dodaj
 * page) · Moje rzeczy · Konto — a full-width bar on a phone, a floating pill
 * with the labels beside the icons from `md`. Shown to anonymous visitors
 * too — every tab but Start is behind AuthGuard, which sends them to /login
 * and back. */
export function BottomNav() {
  const navigate = useAppNavigate();
  const pathname = useAppPathname();
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
        className={`${TAB_CLASS} ${on ? "font-extrabold text-primary-fg md:bg-primary-soft" : "font-bold text-ink-soft hover:text-ink"}`}
      >
        <span
          className={`relative flex h-7.5 w-13.5 items-center justify-center rounded-full md:h-auto md:w-auto ${on ? "bg-primary-soft" : ""}`}
        >
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
      className="sticky bottom-0 z-20 flex items-start border-t border-line bg-paper px-1.5 pt-2 pb-3 md:bottom-5 md:mx-auto md:mb-5 md:w-full md:max-w-140 md:items-center md:gap-1 md:rounded-full md:border md:p-2 md:shadow-[0_18px_40px_-18px_rgba(19,38,29,0.35)]"
    >
      {SIDE_TABS[0].map(tab)}
      <div className="flex flex-1 justify-center md:w-19 md:flex-none">
        <button
          type="button"
          onClick={() => navigate(viewPath("add"))}
          aria-label="Dodaj nowe"
          className="-mt-5 flex h-14 w-14 items-center justify-center rounded-full border-4 border-cream bg-accent text-ink shadow-[0_12px_22px_-10px_rgba(30,46,39,0.55)] transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring md:-my-5 md:h-16 md:w-16"
        >
          <PlusIcon />
        </button>
      </div>
      {SIDE_TABS[1].map(tab)}
    </nav>
  );
}
