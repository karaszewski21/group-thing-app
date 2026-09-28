import { AccountMenu, ACCOUNT_MENU_ITEM_CLASS } from "../../components/shared/AccountMenu";
import { BackIcon, CalendarPlusIcon } from "./panelIcons";
import { initials } from "./panelHelpers";
import { usePanelData } from "./panelDataStore";

/** Sticky Panel header: on the four top-level views an avatar + name + the
 * shared `AccountMenu` (plus "Dodaj pierwszy termin" for a GUEST); on the
 * sub-views (profil / ustawienia / rodzina) a "Wróć" button + the view title. */
export function PanelHeader() {
  const {
    profile,
    isTopLevel,
    isOrganizer,
    localLocation,
    organizationSlug,
    view,
    setView,
    setModal,
    setFirstTermForOrganizer,
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
          <AccountMenu
            organizationSlug={organizationSlug}
            extraItems={(close) => (
              <>
                {!isOrganizer && (
                  <button
                    role="menuitem"
                    onClick={() => { setFirstTermForOrganizer(false); setModal("pierwszy-termin"); close(); }}
                    className={ACCOUNT_MENU_ITEM_CLASS}
                  >
                    <CalendarPlusIcon /> Dodaj pierwszy termin
                  </button>
                )}
                {/* {isOrganizer && terms.length === 0 && (
                  <button
                    role="menuitem"
                    onClick={() => { setFirstTermForOrganizer(true); setModal("pierwszy-termin"); close(); }}
                    className={ACCOUNT_MENU_ITEM_CLASS}
                  >
                    <CalendarPlusIcon /> Dodaj pierwszy termin
                  </button>
                )} */}
              </>
            )}
          />
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
