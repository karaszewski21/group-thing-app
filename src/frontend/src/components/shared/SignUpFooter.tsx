"use client";

import { useState } from "react";
import type { PaymentStatus } from "../../api/groups";
import { AuthSheet } from "../../features/auth/AuthSheet";
import { useAccountGate } from "../../features/auth/useAccountGate";
import { formatPrice, parsePaymentUrl } from "../../utils/appHelpers";

const CTA =
  "min-h-14 w-full rounded-full px-5 text-[17px] font-extrabold disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";
const CTA_PRIMARY = `${CTA} border-0 bg-primary text-on-primary`;
const CTA_OUTLINE = `${CTA} border-[1.5px] border-line-strong bg-transparent text-ink`;
const STATUS_BOX = "rounded-2xl px-3 py-2.5 text-sm font-bold";

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
  | { variant: "ended"; label: string }
  | {
      variant: "payment";
      /** Decimal string (`"25.50"`); `null` only for a term made free after it was paid. */
      price: string | null;
      paymentUrl: string | null;
      status: PaymentStatus;
    };

/** Sticky footer of the term and event pages. "Zapisz się" opens the
 * login/register sheet for an anonymous viewer and runs `onSignUp` for a
 * logged-in one, disabled while it runs. `payment` is an attendee's own
 * payment state: the external pay link, the on-site amount, or "Opłacone". */
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
      {props.variant === "payment" && <PaymentState {...props} />}
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

function PaymentState({ price, paymentUrl, status }: Extract<SignUpFooterProps, { variant: "payment" }>) {
  if (status === "PAID" || price == null) {
    return (
      <p className={`${STATUS_BOX} bg-primary-soft text-primary-fg`}>
        <span aria-hidden="true">✓</span> Opłacone
      </p>
    );
  }
  const amount = formatPrice(price);
  // Re-checked before it becomes an href: anything but a valid https link pays on site.
  const href = paymentUrl == null ? null : parsePaymentUrl(paymentUrl);
  if (typeof href !== "string") {
    return <p className={`${STATUS_BOX} bg-accent-soft text-accent-fg`}>Do zapłaty: {amount} (na miejscu)</p>;
  }
  // A new tab outside the app, never a router `Link`.
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Zapłać ${amount} (nowa karta)`}
      className={`${CTA_PRIMARY} flex items-center justify-center gap-2 no-underline`}
    >
      Zapłać {amount} <span aria-hidden="true">↗</span>
    </a>
  );
}
