"use client";

import { useState } from "react";
import { AuthSheet } from "../../features/auth/AuthSheet";
import { useAccountGate } from "../../features/auth/useAccountGate";

const CTA =
  "min-h-14 w-full rounded-full px-5 text-[17px] font-extrabold disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";
const CTA_PRIMARY = `${CTA} border-0 bg-primary text-on-primary`;
const CTA_OUTLINE = `${CTA} border-[1.5px] border-line-strong bg-transparent text-ink`;

export type SignUpFooterProps =
  | {
      variant: "signUp";
      isLoggedIn: boolean;
      /** Why signing up needs an account, shown in the login sheet. */
      authMessage: string;
      /** The logged-in sign-up; handles its own errors. */
      onSignUp: () => Promise<void>;
    }
  | { variant: "withdraw"; onWithdraw: () => void }
  | { variant: "ended"; label: string };

/** Sticky footer of the term and event pages. "Zapisz się" opens the
 * login/register sheet for an anonymous viewer and runs `onSignUp` for a
 * logged-in one, disabled while it runs. */
export function SignUpFooter(props: SignUpFooterProps) {
  return (
    <footer className="sticky bottom-0 z-20 mt-6 border-t border-line bg-cream px-5 pt-3.5 pb-5">
      {props.variant === "signUp" && <SignUpButton {...props} />}
      {props.variant === "withdraw" && (
        <button type="button" className={CTA_OUTLINE} onClick={props.onWithdraw}>
          Wypisz się
        </button>
      )}
      {props.variant === "ended" && (
        <button type="button" className={CTA_PRIMARY} disabled>
          {props.label}
        </button>
      )}
    </footer>
  );
}

function SignUpButton({ isLoggedIn, authMessage, onSignUp }: Extract<SignUpFooterProps, { variant: "signUp" }>) {
  const gate = useAccountGate(isLoggedIn);
  const [busy, setBusy] = useState(false);

  const signUp = gate.guard(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onSignUp();
    } finally {
      setBusy(false);
    }
  });

  return (
    <>
      <button type="button" className={CTA_PRIMARY} disabled={busy} onClick={() => signUp()}>
        ＋ Zapisz się
      </button>
      {gate.isOpen && <AuthSheet title="Zapisz się" message={authMessage} onClose={gate.close} />}
    </>
  );
}
