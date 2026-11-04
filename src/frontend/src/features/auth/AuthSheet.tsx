import { useState } from "react";
import type { AuthTab } from "../../auth/authPaths";
import { useAuth } from "../../auth/AuthContext";
import { ModalSheet } from "../../components/shared/ModalSheet";
import { BTN_GHOST, BTN_LG, BTN_PRIMARY } from "../../components/shared/uiStyles";
import { AuthTabs } from "./AuthTabs";
import { useAccountGate } from "./useAccountGate";

/** The one login/register prompt on public pages: a bottom sheet with both
 * forms, so the visitor never leaves the page (and its context). Logging in
 * or registering changes the token in place; the host closes the sheet
 * (`useAccountGate.isOpen` turns false) and its data refetches. */
export function AuthSheet({
  title = "Potrzebne konto",
  message,
  initialTab = "login",
  onClose,
}: {
  title?: string;
  /** Why an account is needed here. */
  message: string;
  initialTab?: AuthTab;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<AuthTab>(initialTab);
  return (
    <ModalSheet title={title} onClose={onClose}>
      <p className="-mt-1 mb-4 text-[13px] text-ink-soft">{message}</p>
      <AuthTabs tab={tab} onSelect={setTab} />
    </ModalSheet>
  );
}

const PROMPT_BUTTON = `${BTN_LG} mt-2.5 block w-full text-center`;

/** Inline "Zaloguj się" / "Załóż konto" buttons for a card that stands in
 * for content needing an account; each opens `AuthSheet` on its tab. */
export function AuthPromptButtons({ sheetMessage }: { sheetMessage: string }) {
  const isLoggedIn = useAuth().token !== null;
  const gate = useAccountGate(isLoggedIn);
  return (
    <>
      <button type="button" className={`${BTN_PRIMARY} ${PROMPT_BUTTON}`} onClick={() => gate.open("login")}>
        Zaloguj się
      </button>
      <button
        type="button"
        className={`${BTN_GHOST} ${PROMPT_BUTTON} border-primary text-primary-fg`}
        onClick={() => gate.open("register")}
      >
        Załóż konto
      </button>
      {gate.isOpen && <AuthSheet message={sheetMessage} initialTab={gate.tab} onClose={gate.close} />}
    </>
  );
}
