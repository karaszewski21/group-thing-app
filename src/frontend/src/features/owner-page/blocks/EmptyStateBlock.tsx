import type { PublicOrganizationResponse } from "../../../api/organizations";
import { TermsIcon } from "../../../components/shared/Icons";
import { ShareButton } from "./ShareButton";

const TITLES: Record<string, string> = {
  CLASSIC: "Brak zaplanowanych spotkań",
  SCHEDULE: "Brak zaplanowanych spotkań",
  EXCHANGE: "Na razie nic tu nie ma",
};
const FALLBACK_TITLE = "Brak zaplanowanych spotkań";
const UNAVAILABLE_TITLE = "Brak informacji do pokazania";

interface EmptyStateBlockProps {
  layoutKey: string;
  organization: PublicOrganizationResponse;
  /** The directory could not be loaded: generic copy instead of the layout's. */
  unavailable?: boolean;
}

/** Visitor stand-in for a layout's empty primary block, with the share action
 * so the page still offers something to do. */
export function EmptyStateBlock({ layoutKey, organization, unavailable = false }: EmptyStateBlockProps) {
  const title = unavailable ? UNAVAILABLE_TITLE : (TITLES[layoutKey] ?? FALLBACK_TITLE);
  const explainExchange = !unavailable && layoutKey === "EXCHANGE";

  return (
    <div className="flex flex-col gap-3 px-6 pt-5">
      <section className="flex flex-col items-center rounded-2xl border border-line bg-paper px-6 py-8 text-center">
        <TermsIcon aria-hidden="true" className="mb-3 h-8 w-8 text-ink-soft" />
        <h2 className="font-serif text-lg font-semibold text-ink">{title}</h2>
        <p className="mt-1 text-[13px] text-ink-soft">Zajrzyj tu wkrótce albo udostępnij stronę znajomym.</p>
        {explainExchange && (
          <details className="mt-4 w-full text-left text-[13px] text-ink-soft">
            <summary className="flex min-h-[44px] cursor-pointer items-center justify-center font-bold text-primary-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring">
              Jak to działa?
            </summary>
            <p className="mt-1">
              Organizator wystawia tu rzeczy do oddania lub zamiany. Otwórz rzecz, by ją
              zarezerwować i umówić się na odbiór.
            </p>
          </details>
        )}
      </section>
      <ShareButton
        slug={organization.slug}
        name={organization.name}
        label="Udostępnij stronę"
        className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-primary px-5 text-[15px] font-extrabold text-on-primary"
      />
    </div>
  );
}
