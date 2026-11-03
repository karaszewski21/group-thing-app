import { useAppPathname } from "../routing/navigation";
import { matchMockRoute } from "./navigationMock";
import { PANEL_PAGES } from "./panelPages";

/** The panel page the current URL selects, as the App Router renders it
 * into the panel layout's `children`. */
export function PanelPageOutlet() {
  const match = matchMockRoute(Object.keys(PANEL_PAGES), useAppPathname());
  const Page = match ? PANEL_PAGES[match.pattern] : null;
  return Page ? <Page /> : null;
}
