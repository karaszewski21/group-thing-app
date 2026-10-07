import { useLocation, useNavigate } from "react-router-dom";
import { BackIcon } from "../panel/panelIcons";
import { BACK_LINK } from "./itemPageShared";
import { useItemRoutes } from "./useItemRoutes";

/** "Wróć": history back, or the route's fallback (`/panel/rzeczy`, or the
 * organizer page on `/:organizationSlug/produkt/...`) when opened directly. */
export function ItemBackButton() {
  const navigate = useNavigate();
  const location = useLocation();
  const { backFallback } = useItemRoutes();

  const goBack = () => {
    if (location.key !== "default") navigate(-1);
    else navigate(backFallback);
  };

  return (
    <button type="button" onClick={goBack} className={BACK_LINK}>
      <BackIcon /> Wróć
    </button>
  );
}
