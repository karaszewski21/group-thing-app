import { HintCard } from "../../components/shared/appComponents";
import { useEmailVerificationRequest } from "../../hooks/useEmailVerificationRequest";

/** The Home banner asking to confirm the address. Shown only while
 * `emailVerified` is `false` (`null`: email is off or there is no address);
 * it has no dismiss, so it stays until the address is confirmed. */
export function VerifyEmailBanner({ emailVerified, email }: { emailVerified: boolean | null; email: string | null }) {
  if (emailVerified !== false) return null;
  return <UnverifiedBanner email={email} />;
}

function UnverifiedBanner({ email }: { email: string | null }) {
  const { request, sending, sent, secondsLeft, error } = useEmailVerificationRequest();
  const icon = (
    <span aria-hidden="true" className="text-xl">
      ✉️
    </span>
  );

  return (
    <div>
      <div role="status">
        {sent ? (
          <HintCard
            icon={icon}
            title="Sprawdź skrzynkę"
            description={`Wysłaliśmy link na ${email ?? "Twój adres"}. Kliknij go, żeby potwierdzić adres.`}
            ctaLabel="Wyślij ponownie"
            onCtaClick={() => void request()}
            ctaDisabled={sending || secondsLeft > 0}
          />
        ) : (
          <HintCard
            icon={icon}
            title="Potwierdź swój adres e-mail"
            description="Potwierdź adres, żebyśmy mogli wysyłać Ci ważne wiadomości."
            ctaLabel="Wyślij link"
            onCtaClick={() => void request()}
            ctaDisabled={sending}
          />
        )}
      </div>
      {error && (
        <p role="alert" className="-mt-1.5 mb-3.5 px-1 text-sm font-semibold text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
