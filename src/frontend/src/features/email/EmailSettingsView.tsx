import type { ReactNode } from "react";
import type { EmailCategory, EmailPreferencesResponse } from "../../api/email";
import { FOCUS_CLASS } from "../../components/shared/chipStyles";
import { useEmailPreferences } from "../../hooks/useEmailPreferences";
import { useEmailVerificationRequest } from "../../hooks/useEmailVerificationRequest";
import { Link } from "../../routing/navigation";
import { viewPath } from "../../routing/paths";
import { EmailCategoryToggle } from "./EmailCategoryToggle";
import { EMAIL_CATEGORY_LABELS } from "./unsubscribeToken";
import {
  resolveEmailSettingsView,
  type EmailAddressState,
  type EmailSettingsView as View,
} from "./emailSettingsViewState";

const CATEGORY_HINTS: Record<EmailCategory, string> = {
  RESERVATIONS: "Ktoś wziął Twoją rzecz, propozycje wymian, potwierdzenie po terminie",
  WANTS: "Nowe rzeczy pasujące do tego, czego szukasz (najwyżej 1 mail dziennie na wpis)",
};

const BADGES: Partial<Record<EmailAddressState, { label: string; tone: string }>> = {
  verified: { label: "Potwierdzony", tone: "bg-primary-soft text-primary-fg" },
  unverified: {
    label: "Niepotwierdzony",
    tone: "bg-accent-soft text-accent-fg",
  },
  sent: { label: "Niepotwierdzony", tone: "bg-accent-soft text-accent-fg" },
  bounce: { label: "Wstrzymane", tone: "bg-danger-soft text-danger" },
  complaint: { label: "Wstrzymane", tone: "bg-danger-soft text-danger" },
};

const SECTION_HEADING = "mx-1 mt-[18px] mb-2 text-xs font-extrabold tracking-[.06em] text-ink-soft uppercase";
const CARD = "rounded-3xl border border-line bg-paper px-4 py-1";
const BUTTON = `inline-flex min-h-10 items-center justify-center rounded-full bg-primary px-3.5 text-[13px] font-extrabold text-on-primary disabled:opacity-60 aria-disabled:opacity-60 ${FOCUS_CLASS}`;
const NOTE = "my-2.5 rounded-2xl px-3.5 py-2.5 text-[13px]";

/** `/settings`: the account's mail address state and the notification mail
 * switches. Account mail (verification, password) cannot be turned off. */
export function EmailSettingsView() {
  const { data, loading, error, refetch, update } = useEmailPreferences();
  const verification = useEmailVerificationRequest();
  const view = resolveEmailSettingsView({
    preferences: data,
    loading,
    error,
    sent: verification.sent,
  });

  return (
    <div>
      <Link
        to={viewPath("account")}
        className={`mb-1.5 inline-block rounded-md text-sm font-extrabold text-primary-fg ${FOCUS_CLASS}`}
      >
        ‹ Konto
      </Link>
      <h1 className="mt-1 mb-1 font-serif text-[26px] leading-tight font-extrabold tracking-tight text-ink">
        Powiadomienia e-mail
      </h1>
      <p className="mb-3.5 text-[15px] text-ink-soft">
        Wybierz, o czym chcesz dostawać maile. Powiadomienia w aplikacji działają zawsze.
      </p>
      <Body view={view} refetch={refetch} update={update} verification={verification} />
    </div>
  );
}

function Body({
  view,
  refetch,
  update,
  verification,
}: {
  view: View;
  refetch: () => Promise<void>;
  update: ReturnType<typeof useEmailPreferences>["update"];
  verification: ReturnType<typeof useEmailVerificationRequest>;
}) {
  switch (view.kind) {
    case "loading":
      return <SettingsSkeleton />;
    case "error":
      return (
        <div role="alert" className="rounded-2xl bg-danger-soft px-3.5 py-3 text-sm text-danger">
          <p>Nie udało się wczytać ustawień powiadomień.</p>
          <button
            type="button"
            onClick={() => void refetch()}
            className={`mt-2 font-extrabold underline ${FOCUS_CLASS}`}
          >
            Spróbuj ponownie
          </button>
        </div>
      );
    case "ready":
      return (
        <>
          <AddressCard view={view} verification={verification} />
          <Switches preferences={view.preferences} disabled={view.togglesDisabled} update={update} />
        </>
      );
  }
}

function AddressCard({
  view,
  verification,
}: {
  view: Extract<View, { kind: "ready" }>;
  verification: ReturnType<typeof useEmailVerificationRequest>;
}) {
  const { preferences, address } = view;
  const badge = BADGES[address];
  let detail: ReactNode = null;
  switch (address) {
    case "unverified":
      detail = (
        <ResendBlock verification={verification}>
          <p className="mb-2.5 text-[13px] text-ink-soft">
            Potwierdź adres, żeby maile zaczęły przychodzić. Do tego czasu nic nie wysyłamy.
          </p>
        </ResendBlock>
      );
      break;
    case "bounce":
      detail = (
        <ResendBlock verification={verification}>
          <p className="mb-2.5 text-[13px] text-ink-soft">
            Maile na ten adres nie dochodziły, więc przestaliśmy je wysyłać. Potwierdź adres jeszcze raz, żeby je
            wznowić.
          </p>
        </ResendBlock>
      );
      break;
    case "sent":
      detail = (
        <ResendBlock verification={verification}>
          <p role="status" className={`${NOTE} mt-0 bg-primary-soft font-bold text-primary-fg`}>
            Wysłaliśmy link na {preferences.email}. Sprawdź skrzynkę (także spam).
          </p>
        </ResendBlock>
      );
      break;
    case "complaint":
      detail = (
        <p role="status" className={`${NOTE} mt-0 mb-3.5 bg-danger-soft text-sm text-danger`}>
          Twój adres oznaczył nasz mail jako spam, więc przestaliśmy wysyłać powiadomienia. Jeśli to pomyłka, napisz do
          nas: {preferences.support_address}.
        </p>
      );
      break;
    case "unknown":
    case "verified":
      break;
  }

  return (
    <section aria-labelledby="email-address-heading">
      <h2 id="email-address-heading" className={SECTION_HEADING}>
        Twój adres
      </h2>
      <div className={CARD}>
        <div className="flex items-center gap-2.5 py-3.5">
          <span className="min-w-0 text-[15px] font-bold break-all text-ink">
            {preferences.email ?? "Brak adresu e-mail"}
          </span>
          {badge && (
            <span className={`flex-none rounded-full px-2.5 py-0.5 text-xs font-extrabold ${badge.tone}`}>
              {badge.label}
            </span>
          )}
        </div>
        {detail}
      </div>
    </section>
  );
}

function ResendBlock({
  verification,
  children,
}: {
  verification: ReturnType<typeof useEmailVerificationRequest>;
  children: ReactNode;
}) {
  const { request, sending, sent, secondsLeft, error } = verification;
  const coolingDown = secondsLeft > 0;
  let label = "Wyślij link weryfikacyjny";
  if (sending) label = "Wysyłanie…";
  else if (coolingDown) label = `Wyślij ponownie za ${secondsLeft} s`;
  else if (sent) label = "Wyślij ponownie";

  return (
    <>
      {children}
      <div className="pb-3.5">
        <button
          type="button"
          disabled={sending}
          aria-disabled={coolingDown || undefined}
          onClick={() => {
            if (coolingDown) return;
            void request();
          }}
          className={BUTTON}
        >
          {label}
        </button>
        {error && (
          <p role="alert" className={`${NOTE} mb-0 bg-danger-soft text-sm text-danger`}>
            {error}
          </p>
        )}
      </div>
    </>
  );
}

function Switches({
  preferences,
  disabled,
  update,
}: {
  preferences: EmailPreferencesResponse;
  disabled: boolean;
  update: ReturnType<typeof useEmailPreferences>["update"];
}) {
  return (
    <section aria-labelledby="email-notifications-heading">
      <h2 id="email-notifications-heading" className={SECTION_HEADING}>
        Powiadomienia
      </h2>
      {!preferences.notifications_live && (
        <p role="status" className={`${NOTE} mt-0 bg-stage text-ink`}>
          Powiadomienia e-mail ruszają wkrótce. Twoje ustawienia zapiszemy już teraz.
        </p>
      )}
      <div className={CARD}>
        <EmailCategoryToggle
          label="Wszystkie powiadomienia e-mail"
          hint="Wyłącza każdą kategorię poniżej"
          checked={preferences.all_enabled}
          disabled={disabled}
          onSave={(enabled) => update("ALL", enabled)}
        />
        {preferences.categories.map(({ category, enabled }) => (
          <EmailCategoryToggle
            key={category}
            label={EMAIL_CATEGORY_LABELS[category]}
            hint={CATEGORY_HINTS[category]}
            checked={preferences.all_enabled && enabled}
            disabled={disabled || !preferences.all_enabled}
            onSave={(enabled) => update(category, enabled)}
          />
        ))}
        <div className="flex items-center justify-between gap-3 border-t border-line py-3.5">
          <div>
            <strong className="block text-sm text-ink">Wiadomości o koncie</strong>
            <small className="mt-0.5 block text-xs text-ink-soft">Weryfikacja adresu, reset i zmiana hasła</small>
          </div>
          <span className="flex-none rounded-full bg-stage px-2.5 py-1 text-xs font-extrabold text-ink-soft">
            Zawsze włączone
          </span>
        </div>
      </div>
    </section>
  );
}

function SettingsSkeleton() {
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">Wczytywanie ustawień…</span>
      <div aria-hidden="true" className="animate-pulse">
        <div className={`${SECTION_HEADING} h-3 w-24 rounded bg-line`} />
        <div className={`${CARD} py-4`}>
          <div className="h-4 w-2/3 rounded bg-line" />
        </div>
        <div className={`${SECTION_HEADING} h-3 w-28 rounded bg-line`} />
        <div className={CARD}>
          {[0, 1, 2].map((row) => (
            <div
              key={row}
              className="flex items-center justify-between gap-3 border-t border-line py-3.5 first:border-t-0"
            >
              <div className="flex-1">
                <div className="h-3.5 w-1/2 rounded bg-line" />
                <div className="mt-1.5 h-3 w-3/4 rounded bg-line" />
              </div>
              <div className="h-[26px] w-11 rounded-full bg-line" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
