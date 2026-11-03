import { useAppNavigate, useAppSearch } from "../../routing/navigation";
import { viewPath } from "../../routing/paths";

/** Back to `/family` with the current `?returnTo=`, where every family sub-page goes after saving. */
export function useBackToFamily(): { backToFamily: () => void } {
  const search = useAppSearch();
  const navigate = useAppNavigate();
  const familyPath = `${viewPath("family")}${search}`;
  return { backToFamily: () => navigate(familyPath) };
}
