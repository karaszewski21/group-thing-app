import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { BuildingIcon, FamilyIcon, HomeIcon, MenuIcon, SettingsIcon, UserIcon } from "../../pages/panel/panelIcons";

export const ACCOUNT_MENU_ITEM_CLASS =
  "flex w-full items-center gap-2.5 rounded-[11px] px-3 py-2.5 text-left text-sm font-bold text-ink hover:bg-cream";

/** The logged-in user's hamburger menu (Profil / Ustawienia / Moja
 * organizacja / Mój dom), shared by the Panel header and pages outside the
 * Panel. Every item is a link to its Panel section's URL. `showPanelHome`
 * adds a "Mój panel" link for pages outside the Panel; `extraItems` renders
 * host-specific items after the standard ones (`close` closes the menu). */
export function AccountMenu({
  organizationSlug,
  showPanelHome = false,
  extraItems,
}: {
  organizationSlug: string | null;
  showPanelHome?: boolean;
  extraItems?: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <div className="relative flex-none">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Menu"
        aria-expanded={open}
        className="flex h-10 w-10 items-center justify-center rounded-[14px] border border-line bg-cream transition-colors hover:bg-mint-soft"
      >
        <MenuIcon />
      </button>
      {open && (
        <>
          <button
            onClick={close}
            aria-label="Zamknij menu"
            className="fixed inset-0 z-[25] cursor-default border-none bg-transparent p-0"
          />
          <div
            role="menu"
            className="absolute right-0 top-12 z-30 min-w-[190px] rounded-2xl border border-line bg-paper p-1.5 shadow-[0_16px_34px_-16px_rgba(30,46,39,0.45)]"
          >
            {showPanelHome && (
              <Link role="menuitem" to="/panel" onClick={close} className={ACCOUNT_MENU_ITEM_CLASS}>
                <HomeIcon /> Mój panel
              </Link>
            )}
            <Link role="menuitem" to="/panel/profil" onClick={close} className={ACCOUNT_MENU_ITEM_CLASS}>
              <UserIcon /> Profil
            </Link>
            <Link role="menuitem" to="/panel/ustawienia" onClick={close} className={ACCOUNT_MENU_ITEM_CLASS}>
              <SettingsIcon /> Ustawienia
            </Link>
            {/* Unconditional — creating an Organization is deliberately
                independent of "Chcę dodać krąg"/isOrganizer (a Circle-
                leadership signal). Backend authorization agrees: any
                authenticated account (GUEST or ORGANIZER) already has
                EDIT permission, so nothing blocks a GUEST from owning
                an Organization without ever running a Circle. */}
            <Link
              role="menuitem"
              to={organizationSlug ? `/${organizationSlug}` : "/organization"}
              onClick={close}
              className={ACCOUNT_MENU_ITEM_CLASS}
            >
              <BuildingIcon /> Moja organizacja
            </Link>
            <Link role="menuitem" to="/panel/rodzina" onClick={close} className={ACCOUNT_MENU_ITEM_CLASS}>
              <FamilyIcon /> Mój dom
            </Link>
            {extraItems?.(close)}
          </div>
        </>
      )}
    </div>
  );
}
