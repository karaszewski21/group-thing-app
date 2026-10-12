import { useNavigate } from "react-router-dom";
import { BoxIcon, CalendarIcon, GiftIcon, HomeIcon } from "./panelIcons";
import { viewPath, type View } from "./panelHelpers";
import { usePanelData } from "./panelDataStore";

const NAV_ITEMS: { key: View; label: string; Icon: typeof HomeIcon }[] = [
  { key: "home", label: "Home", Icon: HomeIcon },
  { key: "spotkania", label: "Spotkania", Icon: CalendarIcon },
  { key: "rzeczy", label: "Moje rzeczy", Icon: BoxIcon },
  { key: "podarki", label: "Wypożyczone", Icon: GiftIcon },
];

/** The panel's sticky bottom tab bar, outside the panel too (item pages):
 * each tab navigates to its panel view's URL. Without `active` no tab is
 * highlighted — an item page is not one of the panel's views. */
export function PanelNavBar({ active }: { active?: View }) {
  const navigate = useNavigate();

  return (
    <nav
      aria-label="Nawigacja panelu"
      className="sticky bottom-0 z-20 flex border-t border-line bg-paper px-2 pt-2 pb-3"
    >
      {NAV_ITEMS.map(({ key, label, Icon }) => {
        const on = active === key;
        return (
          <button
            key={key}
            type="button"
            onClick={() => navigate(viewPath(key))}
            aria-current={on}
            className={`flex min-h-12 flex-1 flex-col items-center gap-1 rounded-[14px] text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring ${
              on ? "font-extrabold text-primary-fg" : "font-bold text-ink-soft hover:text-ink"
            }`}
          >
            <span
              className={`flex h-7.5 w-13.5 items-center justify-center rounded-full ${on ? "bg-primary-soft" : ""}`}
            >
              <Icon c="currentColor" />
            </span>
            {label}
          </button>
        );
      })}
    </nav>
  );
}

/** Inside /panel — only shown on the four top-level views. */
export function PanelNav() {
  const { isTopLevel, view } = usePanelData();

  if (!isTopLevel) return null;

  return <PanelNavBar active={view} />;
}
