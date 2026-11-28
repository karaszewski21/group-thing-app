"use client";

import { useState } from "react";
import { unsubscribe, type UnsubscribeScope } from "../../api/email";
import { hasStatus } from "../../api/problem";
import { Link, useAppSearchParams } from "../../routing/navigation";
import { AuthLayout } from "../auth/AuthLayout";
import { AUTH_LINK, AUTH_SUBMIT } from "../auth/authStyles";
import { EMAIL_CATEGORY_LABELS, parseUnsubscribeCategory } from "./unsubscribeToken";
import { resolveUnsubscribeView, type UnsubscribeSubmitState } from "./unsubscribeViewState";

const SETTINGS_PATH = "/settings";
const AUTH_SECONDARY =
  "min-h-13.5 w-full rounded-full border-[1.5px] border-line bg-paper px-4 text-[17px] font-extrabold text-ink transition-transform hover:-translate-y-0.5 disabled:opacity-60 disabled:hover:translate-y-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

/** `/unsubscribe?token=`: the mail footer's opt-out link. The page names the
 * token's category from the token itself and turns it (or every
 * notification mail) off only on a click; the server checks the signature. */
export function UnsubscribePage() {
  const [searchParams] = useAppSearchParams();
  const token = searchParams.get("token") ?? "";
  const [submit, setSubmit] = useState<UnsubscribeSubmitState>({ status: "idle" });
  const view = resolveUnsubscribeView({ category: parseUnsubscribeCategory(token), submit });

  async function turnOff(scope: UnsubscribeScope) {
    if (submit.status === "pending") return;
    setSubmit({ status: "pending", scope });
    try {
      const result = await unsubscribe(token, scope);
      setSubmit({ status: "done", category: result.category, scope: result.scope });
    } catch (err) {
      setSubmit({ status: hasStatus(err, 404) ? "invalid" : "error" });
    }
  }

  switch (view.kind) {
    case "choice": {
      const busy = view.pending !== null;
      return (
        <AuthLayout
          title="Wypisz się z maili"
          subtitle={
            <>
              Ten link dotyczy kategorii <b className="text-ink">{EMAIL_CATEGORY_LABELS[view.category]}</b>.
            </>
          }
        >
          {view.failed && (
            <p role="alert" className="mb-4 rounded-2xl bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
              Nie udało się zapisać. Spróbuj ponownie.
            </p>
          )}
          <div className="flex flex-col gap-2.5" aria-busy={busy || undefined}>
            <button type="button" className={AUTH_SUBMIT} disabled={busy} onClick={() => void turnOff("category")}>
              Wyłącz tę kategorię
            </button>
            <button type="button" className={AUTH_SECONDARY} disabled={busy} onClick={() => void turnOff("all")}>
              Wyłącz wszystkie powiadomienia e-mail
            </button>
          </div>
          <p className="mt-4 text-center text-sm text-ink-soft">Maile o koncie (reset hasła) zawsze dochodzą.</p>
        </AuthLayout>
      );
    }
    case "done":
      return (
        <AuthLayout
          title="Gotowe"
          subtitle={
            view.scope === "all"
              ? "Nie wyślemy już żadnych powiadomień e-mail. Powiadomienia w aplikacji działają bez zmian."
              : (
                  <>
                    Nie wyślemy już maili z kategorii <b className="text-ink">{EMAIL_CATEGORY_LABELS[view.category]}</b>.
                    Powiadomienia w aplikacji działają bez zmian.
                  </>
                )
          }
        >
          <p aria-hidden="true" className="mb-3 text-[40px] leading-none">
            👋
          </p>
          <p className="text-center text-sm">
            <Link to={SETTINGS_PATH} className={AUTH_LINK}>
              Zmień ustawienia powiadomień
            </Link>
          </p>
        </AuthLayout>
      );
    case "invalid":
      return (
        <AuthLayout
          title="Nieprawidłowy link"
          subtitle="Nie rozpoznajemy tego linku. Ustawienia maili zmienisz po zalogowaniu."
        >
          <Link to={SETTINGS_PATH} className={`${AUTH_SUBMIT} inline-flex items-center justify-center`}>
            Przejdź do ustawień
          </Link>
        </AuthLayout>
      );
  }
}
