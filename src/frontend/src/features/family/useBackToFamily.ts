import { useAppNavigate, useAppSearch } from "../../routing/navigation";
import { viewPath } from "../../routing/paths";

/** `/family` with the current `?returnTo=`, where every family sub-page goes back to. */
export function useBackToFamily(): { familyPath: string; backToFamily: () => void } {
  const search = useAppSearch();
  const navigate = useAppNavigate();
  const familyPath = `${viewPath("family")}${search}`;
  return { familyPath, backToFamily: () => navigate(familyPath) };
}
