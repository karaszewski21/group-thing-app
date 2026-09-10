import { BoxIcon, CalendarIcon, GiftIcon, HomeIcon } from "./panelIcons";
import { type View } from "./panelHelpers";
import { usePanelData } from "./panelDataStore";

const NAV_ITEMS: { key: View; label: string; Icon: typeof HomeIcon }[] = [
  { key: "home", label: "Home", Icon: HomeIcon },
  { key: "spotkania", label: "Spotkania", Icon: CalendarIcon },
  { key: "rzeczy", label: "Moje rzeczy", Icon: BoxIcon },
  { key: "podarki", label: "Podarki", Icon: GiftIcon },
];

/** Sticky bottom tab bar — only shown on the four top-level views. */
export function PanelNav() {
  const { isTopLevel, view, setView } = usePanelData();

  if (!isTopLevel) return null;

  return (
    <nav aria-label="Nawigacja panelu" className="sticky bottom-0 z-20 flex border-t border-line bg-paper px-2.5 py-2 shadow-[0_-10px_30px_-22px_rgba(30,46,39,0.7)]">
      {NAV_ITEMS.map(({ key, label, Icon }) => (
        <button
          key={key}
          onClick={() => setView(key)}
          aria-current={view === key}
          className={`flex flex-1 flex-col items-center gap-1 rounded-[14px] py-2 text-[11.5px] font-bold transition-colors hover:bg-cream ${
            view === key ? "text-mint" : "text-ink-soft"
          }`}
        >
          <Icon c={view === key ? "#1B8168" : "#5C7069"} />
          {label}
        </button>
      ))}
    </nav>
  );
}
