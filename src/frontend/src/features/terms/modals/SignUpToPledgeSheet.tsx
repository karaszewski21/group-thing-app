import { ModalSheet } from "../../../components/shared/ModalSheet";
import { BTN_GHOST, BTN_LG, BTN_PRIMARY } from "../../../components/shared/uiStyles";

/** "Ja to przyniosę" from someone who does not take part in the term: only
 * people signed up for it, or standing members of its group, bring things.
 * "Zapisz się na zajęcia" starts the same sign-up as the page footer. */
export function SignUpToPledgeSheet({
  itemName,
  onSignUp,
  onClose,
}: {
  itemName: string;
  onSignUp: () => void;
  onClose: () => void;
}) {
  return (
    <ModalSheet title="Najpierw zapisz się na zajęcia" onClose={onClose}>
      <p className="-mt-1 mb-4 text-[13px] text-ink-soft">
        Rzeczy na zajęcia przynoszą osoby zapisane na ten termin albo członkowie grupy. Zapisz się, a potem
        zgłoś, że przyniesiesz „{itemName}”.
      </p>
      <div className="flex flex-col gap-2.5">
        <button type="button" onClick={onSignUp} className={`${BTN_PRIMARY} ${BTN_LG}`}>
          Zapisz się na zajęcia
        </button>
        <button type="button" onClick={onClose} className={`${BTN_GHOST} ${BTN_LG}`}>
          Anuluj
        </button>
      </div>
    </ModalSheet>
  );
}
