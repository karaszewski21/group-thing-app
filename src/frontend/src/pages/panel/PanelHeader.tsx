import { Link } from "react-router-dom";
import {
  BackIcon,
  BellIcon,
  BuildingIcon,
  CalendarPlusIcon,
  FamilyIcon,
  MenuIcon,
  SettingsIcon,
  UserIcon,
} from "./panelIcons";
import { initials } from "./panelHelpers";
import { usePanelData } from "./panelDataStore";

/** Sticky Panel header: on the four top-level views an avatar + name + a menu
 * dropdown (Profil / Ustawienia / Moja organizacja / Mój dom / Dodaj pierwszy
 * termin); on the sub-views (profil / ustawienia / rodzina) a "Wróć" button +
 * the view title. */
export function PanelHeader() {
  const {
    profile,
    isTopLevel,
    isOrganizer,
    localLocation,
    organizationSlug,
    view,
    menuOpen,
    setView,
    setModal,
    setMenuOpen,
    setFirstTermForOrganizer,
    notifications,
    unreadCount,
    notifOpen,
    setNotifOpen,
    openNotification,
    markAllRead,
  } = usePanelData();

  if (!profile) return null;

  return (
    <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-line bg-paper px-[18px] py-4">
      {isTopLevel ? (
        <>
          <button
            onClick={() => setView("profil")}
            aria-label="Otwórz dane profilowe"
            className="flex h-12 w-12 flex-none items-center justify-center rounded-full border-2 border-mint-soft bg-mint-soft font-serif text-base font-semibold text-mint transition-transform hover:scale-105"
          >
            {initials(profile.display_name)}
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[16.5px] font-semibold leading-tight text-ink">
              {profile.display_name}
            </h1>
            {localLocation && <small className="mt-0.5 block text-xs text-ink-soft">{localLocation}</small>}
          </div>
          <div className="relative flex-none">
            <button
              onClick={() => setNotifOpen((o) => !o)}
              aria-label={
                unreadCount > 0 ? `Powiadomienia (${unreadCount} nieprzeczytane)` : "Powiadomienia"
              }
              aria-expanded={notifOpen}
              className="relative flex h-10 w-10 items-center justify-center rounded-[14px] border border-line bg-cream transition-colors hover:bg-mint-soft"
            >
              <BellIcon />
              {unreadCount > 0 && (
                <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-mint px-1 text-[10.5px] font-extrabold text-white">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </button>
            {notifOpen && (
              <>
                <button
                  onClick={() => setNotifOpen(false)}
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
                    <p className="px-2.5 py-4 text-center text-[13px] text-ink-soft">
                      Brak powiadomień
                    </p>
                  ) : (
                    notifications.map((n) => (
                      <button
                        key={n.id}
                        role="menuitem"
                        onClick={() => void openNotification(n)}
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
          <div className="relative flex-none">
            <button
              onClick={() => setMenuOpen((o) => !o)}
              aria-label="Menu"
              aria-expanded={menuOpen}
              className="flex h-10 w-10 items-center justify-center rounded-[14px] border border-line bg-cream transition-colors hover:bg-mint-soft"
            >
              <MenuIcon />
            </button>
            {menuOpen && (
              <>
                <button
                  onClick={() => setMenuOpen(false)}
                  aria-label="Zamknij menu"
                  className="fixed inset-0 z-[25] cursor-default border-none bg-transparent p-0"
                />
                <div
                  role="menu"
                  className="absolute right-0 top-12 z-30 min-w-[190px] rounded-2xl border border-line bg-paper p-1.5 shadow-[0_16px_34px_-16px_rgba(30,46,39,0.45)]"
                >
                  <button
                    role="menuitem"
                    onClick={() => { setView("profil"); setMenuOpen(false); }}
                    className="flex w-full items-center gap-2.5 rounded-[11px] px-3 py-2.5 text-left text-sm font-bold text-ink hover:bg-cream"
                  >
                    <UserIcon /> Profil
                  </button>
                  <button
                    role="menuitem"
                    onClick={() => { setView("ustawienia"); setMenuOpen(false); }}
                    className="flex w-full items-center gap-2.5 rounded-[11px] px-3 py-2.5 text-left text-sm font-bold text-ink hover:bg-cream"
                  >
                    <SettingsIcon /> Ustawienia
                  </button>
                  {/* Unconditional — creating an Organization is deliberately
                      independent of "Chcę dodać krąg"/isOrganizer (a Circle-
                      leadership signal). Backend authorization agrees: any
                      authenticated account (GUEST or ORGANIZER) already has
                      EDIT permission, so nothing blocks a GUEST from owning
                      an Organization without ever running a Circle. */}
                  <Link
                    role="menuitem"
                    to={organizationSlug ? `/${organizationSlug}` : "/organization"}
                    onClick={() => setMenuOpen(false)}
                    className="flex w-full items-center gap-2.5 rounded-[11px] px-3 py-2.5 text-left text-sm font-bold text-ink hover:bg-cream"
                  >
                    <BuildingIcon /> Moja organizacja
                  </Link>
                  <button
                    role="menuitem"
                    onClick={() => { setView("rodzina"); setMenuOpen(false); }}
                    className="flex w-full items-center gap-2.5 rounded-[11px] px-3 py-2.5 text-left text-sm font-bold text-ink hover:bg-cream"
                  >
                    <FamilyIcon /> Mój dom
                  </button>
                  {!isOrganizer && (
                    <button
                      role="menuitem"
                      onClick={() => { setFirstTermForOrganizer(false); setModal("pierwszy-termin"); setMenuOpen(false); }}
                      className="flex w-full items-center gap-2.5 rounded-[11px] px-3 py-2.5 text-left text-sm font-bold text-ink hover:bg-cream"
                    >
                      <CalendarPlusIcon /> Dodaj pierwszy termin
                    </button>
                  )}
                  {/* {isOrganizer && terms.length === 0 && (
                    <button
                      role="menuitem"
                      onClick={() => { setFirstTermForOrganizer(true); setModal("pierwszy-termin"); setMenuOpen(false); }}
                      className="flex w-full items-center gap-2.5 rounded-[11px] px-3 py-2.5 text-left text-sm font-bold text-ink hover:bg-cream"
                    >
                      <CalendarPlusIcon /> Dodaj pierwszy termin
                    </button>
                  )} */}
                </div>
              </>
            )}
          </div>
        </>
      ) : (
        <>
          <button
            onClick={() => setView("home")}
            className="inline-flex h-[38px] flex-none items-center gap-1.5 rounded-full bg-white px-[15px] text-[13.5px] font-bold text-ink shadow-[0_3px_10px_-6px_rgba(30,46,39,0.4)]"
          >
            <BackIcon /> Wróć
          </button>
          <h1 className="text-[16.5px] font-semibold text-ink">
            {view === "profil" ? "Dane profilowe" : view === "rodzina" ? "Mój dom" : "Ustawienia"}
          </h1>
        </>
      )}
    </header>
  );
}
