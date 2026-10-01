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
 * each tab navigates to its panel view's URL. */
export function PanelNavBar({ active }: { active: View }) {
  const navigate = useNavigate();

  return (
    <nav aria-label="Nawigacja panelu" className="sticky bottom-0 z-20 flex border-t border-line bg-paper px-2.5 py-2 shadow-[0_-10px_30px_-22px_rgba(30,46,39,0.7)]">
      {NAV_ITEMS.map(({ key, label, Icon }) => (
        <button
          key={key}
          type="button"
          onClick={() => navigate(viewPath(key))}
          aria-current={active === key}
          className={`flex flex-1 flex-col items-center gap-1 rounded-[14px]  text-[11.5px] font-bold transition-colors hover:bg-cream ${
            active === key ? "text-mint" : "text-ink-soft"
          }`}
        >
          <Icon c={active === key ? "#1B8168" : "#5C7069"} />
          {label}
        </button>
      ))}
    </nav>
  );
}

/** Inside /panel — only shown on the four top-level views. */
export function PanelNav() {
  const { isTopLevel, view } = usePanelData();

  if (!isTopLevel) return null;

  return <PanelNavBar active={view} />;
}
