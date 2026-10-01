import { useLocation, useNavigate } from "react-router-dom";
import { BackIcon } from "../panel/panelIcons";
import { BACK_LINK } from "./itemPageShared";

/** "Wróć": history back, or `/panel/rzeczy` when the page was opened directly. */
export function ItemBackButton() {
  const navigate = useNavigate();
  const location = useLocation();

  const goBack = () => {
    if (location.key !== "default") navigate(-1);
    else navigate("/panel/rzeczy");
  };

  return (
    <button type="button" onClick={goBack} className={BACK_LINK}>
      <BackIcon /> Wróć
    </button>
  );
}
