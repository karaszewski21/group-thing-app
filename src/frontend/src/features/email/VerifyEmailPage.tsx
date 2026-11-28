"use client";

import { useState } from "react";
import { hasStatus } from "../../api/problem";
import { useAuth } from "../../auth/AuthContext";
import { authPath } from "../../auth/authPaths";
import { useAccountTokenLookup } from "../../hooks/useAccountTokenLookup";
import { useEmailVerificationConfirm, useEmailVerificationRequest } from "../../hooks/useEmailVerificationRequest";
import { Link, useAppSearchParams } from "../../routing/navigation";
import { AuthLayout } from "../auth/AuthLayout";
import { AUTH_LINK, AUTH_SUBMIT } from "../auth/authStyles";
import { resolveVerifyEmailView, type VerifyConfirmState } from "./verifyEmailViewState";

const SETTINGS_PATH = "/settings";
const TITLE = "Potwierdź adres";

/** `/verify-email?token=`: the mailed verification link. Opening it only
 * looks the token up; the address is confirmed by the button. Works for
 * guests and outside the panel (no `AppDataProvider`). */
export function VerifyEmailPage() {
  const [searchParams] = useAppSearchParams();
  const token = searchParams.get("token") || null;
  const lookup = useAccountTokenLookup(token, "VERIFY_EMAIL");
  const confirmToken = useEmailVerificationConfirm();
  const [confirm, setConfirm] = useState<VerifyConfirmState>("idle");

  const view = resolveVerifyEmailView({
    hasToken: token !== null,
    lookup: { email: lookup.data?.email ?? null, loading: lookup.loading, invalid: lookup.invalid, error: lookup.error },
    confirm,
  });

  async function runConfirm() {
    if (!token || confirm === "pending") return;
    setConfirm("pending");
    try {
      await confirmToken(token);
      setConfirm("success");
    } catch (err) {
      setConfirm(hasStatus(err, 404) || hasStatus(err, 410) ? "invalid" : "error");
    }
  }

  switch (view.kind) {
    case "loading":
      return (
        <AuthLayout title={TITLE} subtitle="Sprawdzamy link…">
          <div aria-busy="true">
            <button type="button" className={AUTH_SUBMIT} disabled>
              Potwierdź adres
            </button>
          </div>
        </AuthLayout>
      );
    case "error":
      return (
        <AuthLayout title={TITLE} subtitle="Nie udało się sprawdzić linku.">
          <p role="alert" className="mb-4 rounded-2xl bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
            Coś poszło nie tak. Spróbuj ponownie.
          </p>
          <button
            type="button"
            className={AUTH_SUBMIT}
            onClick={() => (view.retry === "confirm" ? void runConfirm() : void lookup.refetch())}
          >
            Spróbuj ponownie
          </button>
        </AuthLayout>
      );
    case "confirm":
      return (
        <AuthLayout title={TITLE} subtitle={
            <>
              Kliknij, żeby potwierdzić <b className="text-ink">{view.email}</b>.
            </>
          }>
          <button type="button" className={AUTH_SUBMIT} disabled={view.confirming} onClick={() => void runConfirm()}>
            Potwierdź adres
          </button>
        </AuthLayout>
      );
    case "success":
      return (
        <AuthLayout
          title="Adres potwierdzony"
          subtitle="Dziękujemy, Twój adres jest potwierdzony. Możemy wysyłać Ci ważne wiadomości. Ustawienia maili zmienisz w ustawieniach."
        >
          <p aria-hidden="true" className="mb-3 text-[40px] leading-none">
            ✅
          </p>
          <Link to={SETTINGS_PATH} className={`${AUTH_SUBMIT} inline-flex items-center justify-center`}>
            Ustawienia powiadomień
          </Link>
        </AuthLayout>
      );
    case "invalid":
      return (
        <AuthLayout title="Link nieważny" subtitle="Ten link wygasł (48 h) albo został już użyty.">
          <ResendLink />
        </AuthLayout>
      );
  }
}

/** A new link for a logged-in visitor; a guest logs in first and resends
 * from `/settings`. */
function ResendLink() {
  const isLoggedIn = useAuth().token !== null;
  if (!isLoggedIn) {
    return (
      <p className="text-center text-sm text-ink-soft">
        <Link to={authPath("login", SETTINGS_PATH)} className={AUTH_LINK}>
          Zaloguj się
        </Link>
        , żeby wysłać nowy.
      </p>
    );
  }
  return <ResendButton />;
}

function ResendButton() {
  const { request, sending, sent, secondsLeft, error } = useEmailVerificationRequest();
  const blocked = sending || secondsLeft > 0;
  return (
    <>
      <button
        type="button"
        className={AUTH_SUBMIT}
        aria-disabled={blocked ? "true" : undefined}
        onClick={() => {
          if (!blocked) void request();
        }}
      >
        {secondsLeft > 0 ? `Wyślij ponownie za ${secondsLeft} s` : "Wyślij nowy link"}
      </button>
      {sent && (
        <p role="status" className="mt-3 text-sm text-ink-soft">
          Wysłaliśmy nowy link. Sprawdź skrzynkę (także spam).
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 rounded-2xl bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
          {error}
        </p>
      )}
    </>
  );
}
