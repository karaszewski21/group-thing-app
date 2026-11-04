import { useAppNavigate, useHasInAppHistory } from "../../../routing/navigation";
import { BackIcon } from "../../../components/shared/appIcons";
import { BACK_LINK } from "./itemPageShared";
import { useItemBackFallback } from "./useItemRoutes";

/** "Wróć": history back, or the owner's page (`/:slug`) when opened directly.
 * `overlay` is the round white button laid over the item photo. */
export function ItemBackButton({ overlay = false }: { overlay?: boolean }) {
  const navigate = useAppNavigate();
  const hasInAppHistory = useHasInAppHistory();
  const backFallback = useItemBackFallback();

  const goBack = () => {
    if (hasInAppHistory) navigate(-1);
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
