"use client";

import { useId, useState, type FormEvent } from "react";
import { confirmPasswordReset, requestPasswordReset } from "../../api/auth";
import { EMAIL_UNAVAILABLE_MESSAGE } from "../../api/email";
import { hasStatus } from "../../api/problem";
import { useAuth } from "../../auth/AuthContext";
import { AuthGuard } from "../../auth/AuthGuard";
import { clearSession } from "../../auth/session";
import { useAccountTokenLookup } from "../../hooks/useAccountTokenLookup";
import { replaceDocument } from "../../routing/documentNavigation";
import { Link, useAppSearchParams } from "../../routing/navigation";
import { AuthLayout } from "./AuthLayout";
import { AUTH_INPUT, AUTH_LABEL, AUTH_LINK, AUTH_SUBMIT } from "./authStyles";
import {
  resolveResetPasswordView,
  type ResetConfirmStatus,
  type ResetPasswordViewState,
  type ResetRequestStatus,
} from "./resetPasswordViewState";

const REQUEST_TITLE = "Nie pamiętasz hasła?";
const REQUEST_SUBTITLE = "Podaj adres konta, wyślemy link do ustawienia nowego hasła.";
const FORM_TITLE = "Ustaw nowe hasło";
const ERROR_MESSAGE = "Coś poszło nie tak. Spróbuj ponownie.";
const MISMATCH_MESSAGE = "Hasła nie są takie same.";

const ALERT = "rounded-2xl bg-danger-soft px-3.5 py-2.5 text-sm text-danger";

function BackToLogin() {
  return (
    <p className="mt-3.5 text-center text-sm">
      <Link to="/login" className={AUTH_LINK}>
        Wróć do logowania
      </Link>
    </p>
  );
}

function errorSubtitle({ retry, email }: Extract<ResetPasswordViewState, { kind: "error" }>): string {
  if (retry === "request") return REQUEST_SUBTITLE;
  return email ? `Dla konta ${email}` : "Nie udało się sprawdzić linku.";
}

/** `/reset-password`: without a token, asks for a reset link (logged-in
 * visitors are sent on by AuthGuard); with `?token=` from the mail, sets a
 * new password for anyone holding the link, a logged-in visitor included,
 * whose session is then cleared so they log in again with the new password. */
export function ResetPasswordPage() {
  const [searchParams] = useAppSearchParams();
  const token = searchParams.get("token") || null;
  const hasSession = useAuth().token !== null;

  const [email, setEmail] = useState("");
  const [requestStatus, setRequestStatus] = useState<ResetRequestStatus>("idle");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [confirmStatus, setConfirmStatus] = useState<ResetConfirmStatus>("idle");
  const lookup = useAccountTokenLookup(token, "PASSWORD_RESET");

  const view = resolveResetPasswordView({
    token,
    request: { status: requestStatus, email: email.trim() },
    lookup: { loading: lookup.loading, invalid: lookup.invalid, error: lookup.error, email: lookup.data?.email ?? null },
    confirm: { status: confirmStatus, password, repeat },
  });

  async function sendRequest() {
    setRequestStatus("sending");
    try {
      await requestPasswordReset(email.trim());
      setRequestStatus("sent");
    } catch (err) {
      setRequestStatus(hasStatus(err, 503) ? "unavailable" : "error");
    }
  }

  async function savePassword() {
    if (token === null) return;
    setConfirmStatus("saving");
    try {
      await confirmPasswordReset(token, password);
      if (hasSession) clearSession();
      setConfirmStatus("success");
    } catch (err) {
      setConfirmStatus(hasStatus(err, 404) || hasStatus(err, 410) ? "invalid" : "error");
    }
  }

  function retry(failed: Extract<ResetPasswordViewState, { kind: "error" }>["retry"]) {
    if (failed === "request") void sendRequest();
    else if (failed === "lookup") void lookup.refetch();
    else void savePassword();
  }

  const content = (() => {
    switch (view.kind) {
      case "request":
      case "unavailable":
        return (
          <AuthLayout title={REQUEST_TITLE} subtitle={REQUEST_SUBTITLE}>
            <RequestForm
              email={email}
              onEmailChange={setEmail}
              sending={view.kind === "request" && view.sending}
              unavailable={view.kind === "unavailable"}
              onSubmit={() => void sendRequest()}
            />
          </AuthLayout>
        );
      case "sent":
        return (
          <AuthLayout
            title="Sprawdź skrzynkę"
            subtitle={
              <>
                Jeśli konto z adresem <b className="text-ink">{view.email}</b> istnieje, wysłaliśmy na nie link. Jest
                ważny przez godzinę.
              </>
            }
          >
            <p className="rounded-2xl bg-stage px-3.5 py-2.5 text-[13px] text-ink">
              Nie widzisz maila? Zajrzyj do spamu albo spróbuj ponownie za minutę.
            </p>
            <BackToLogin />
          </AuthLayout>
        );
      case "loading":
        return (
          <AuthLayout title={FORM_TITLE} subtitle="Sprawdzamy link…">
            <PasswordForm
              password=""
              repeat=""
              onPasswordChange={() => undefined}
              onRepeatChange={() => undefined}
              busy
              mismatch={false}
              canSave={false}
              onSubmit={() => undefined}
            />
          </AuthLayout>
        );
      case "form":
        return (
          <AuthLayout title={FORM_TITLE} subtitle={`Dla konta ${view.email}`}>
            <PasswordForm
              password={password}
              repeat={repeat}
              onPasswordChange={setPassword}
              onRepeatChange={setRepeat}
              busy={view.saving}
              mismatch={view.mismatch}
              canSave={view.canSave}
              onSubmit={() => void savePassword()}
            />
          </AuthLayout>
        );
      case "invalid":
        return (
          <AuthLayout
            title="Link wygasł"
            subtitle="Ten link do zmiany hasła jest już nieważny: minęła godzina albo został użyty."
          >
            <Link to="/reset-password" className={`mt-2 flex items-center justify-center ${AUTH_SUBMIT}`}>
              Wyślij nowy link
            </Link>
          </AuthLayout>
        );
      case "success":
        return (
          <AuthLayout
            title="Hasło zmienione"
            subtitle="Możesz się teraz zalogować nowym hasłem. Wysłaliśmy też potwierdzenie na Twój adres."
          >
            <button type="button" className={`mt-2 ${AUTH_SUBMIT}`} onClick={() => replaceDocument("/login")}>
              Przejdź do logowania
            </button>
          </AuthLayout>
        );
      case "error":
        return (
          <AuthLayout
            title={view.retry === "request" ? REQUEST_TITLE : FORM_TITLE}
            subtitle={errorSubtitle(view)}
          >
            <div role="alert" className={ALERT}>
              {ERROR_MESSAGE}
            </div>
            <button type="button" className={`mt-4 ${AUTH_SUBMIT}`} onClick={() => retry(view.retry)}>
              Spróbuj ponownie
            </button>
            {view.retry === "request" && <BackToLogin />}
          </AuthLayout>
        );
    }
  })();

  return token === null ? <AuthGuard requireAuth={false}>{content}</AuthGuard> : content;
}

function RequestForm({
  email,
  onEmailChange,
  sending,
  unavailable,
  onSubmit,
}: {
  email: string;
  onEmailChange: (email: string) => void;
  sending: boolean;
  unavailable: boolean;
  onSubmit: () => void;
}) {
  const id = useId();

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (sending || !email.trim()) return;
    onSubmit();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div>
        <label htmlFor={`${id}-email`} className={AUTH_LABEL}>
          E-mail
        </label>
        <input
          id={`${id}-email`}
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => onEmailChange(e.target.value)}
          placeholder="ty@przyklad.pl"
          className={AUTH_INPUT}
        />
      </div>
      {unavailable && (
        <div role="alert" className={ALERT}>
          {EMAIL_UNAVAILABLE_MESSAGE}
        </div>
      )}
      <button type="submit" disabled={sending || !email.trim()} className={`mt-1 ${AUTH_SUBMIT}`}>
        {sending ? "Wysyłanie…" : "Wyślij link"}
      </button>
      <BackToLogin />
    </form>
  );
}

function PasswordForm({
  password,
  repeat,
  onPasswordChange,
  onRepeatChange,
  busy,
  mismatch,
  canSave,
  onSubmit,
}: {
  password: string;
  repeat: string;
  onPasswordChange: (value: string) => void;
  onRepeatChange: (value: string) => void;
  busy: boolean;
  mismatch: boolean;
  canSave: boolean;
  onSubmit: () => void;
}) {
  const id = useId();
  const errorId = `${id}-mismatch`;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (canSave) onSubmit();
  }

  return (
    <form onSubmit={handleSubmit} aria-busy={busy || undefined} className="flex flex-col gap-3">
      <div>
        <label htmlFor={`${id}-password`} className={AUTH_LABEL}>
          Nowe hasło
        </label>
        <input
          id={`${id}-password`}
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => onPasswordChange(e.target.value)}
          disabled={busy}
          className={AUTH_INPUT}
        />
      </div>
      <div>
        <label htmlFor={`${id}-repeat`} className={AUTH_LABEL}>
          Powtórz hasło
        </label>
        <input
          id={`${id}-repeat`}
          type="password"
          autoComplete="new-password"
          value={repeat}
          onChange={(e) => onRepeatChange(e.target.value)}
          disabled={busy}
          aria-invalid={mismatch || undefined}
          aria-describedby={mismatch ? errorId : undefined}
          className={`${AUTH_INPUT} ${mismatch ? "border-danger" : ""}`}
        />
        {mismatch && (
          <p id={errorId} role="alert" className="mt-1.5 text-[13px] text-danger">
            {MISMATCH_MESSAGE}
          </p>
        )}
      </div>
      <button
        type="submit"
        disabled={busy}
        aria-disabled={!canSave || undefined}
        className={`mt-1 ${AUTH_SUBMIT} ${!canSave && !busy ? "opacity-60 hover:translate-y-0" : ""}`}
      >
        {busy && password ? "Zapisywanie…" : "Zapisz hasło"}
      </button>
    </form>
  );
}
