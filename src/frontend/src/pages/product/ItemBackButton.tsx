import { useLocation, useNavigate } from "react-router-dom";
import { BackIcon } from "../../components/shared/appIcons";
import { BACK_LINK } from "./itemPageShared";
import { useItemRoutes } from "./useItemRoutes";

/** "Wróć": history back, or the route's fallback (`/items`, or the
 * organizer page on `/:organizationSlug/product/...`) when opened directly.
 * `overlay` is the round white button laid over the item photo. */
export function ItemBackButton({ overlay = false }: { overlay?: boolean }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { backFallback } = useItemRoutes();

  const goBack = () => {
    if (location.key !== "default") navigate(-1);
    else navigate(backFallback);
  };

  if (overlay) {
    return (
      <button
        type="button"
        onClick={goBack}
        aria-label="Wróć"
        className="flex h-11 w-11 items-center justify-center rounded-full bg-paper shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
      >
        <BackIcon />
      </button>
    );
  }

  return (
    <button type="button" onClick={goBack} className={BACK_LINK}>
      <BackIcon /> Wróć
    </button>
  );
}
