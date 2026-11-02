import { useLocation, useNavigate } from "react-router-dom";
import { viewPath } from "../../utils/appHelpers";

/** `/family` with the current `?returnTo=`, where every family sub-page goes back to. */
export function useBackToFamily(): { familyPath: string; backToFamily: () => void } {
  const { search } = useLocation();
  const navigate = useNavigate();
  const familyPath = `${viewPath("family")}${search}`;
  return { familyPath, backToFamily: () => navigate(familyPath) };
}
