import { familyInitials } from "../../../components/shared/Avatar";
import type { BlockProps } from "../layouts/types";

/** Organization name, initials and public address. `cover` has no image yet,
 * so it renders as a primary color band; `centered` is the LINKS hero. */
export function HeroBlock({ data, variant }: BlockProps) {
  const { name, slug } = data.organization;
  const initials = familyInitials(name);

  if (variant === "centered") {
    return (
      <header className="flex flex-col items-center px-6 pt-10 pb-6 text-center">
        <span
          aria-hidden="true"
          className="mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-primary font-serif text-2xl font-semibold text-on-primary"
        >
          {initials}
        </span>
        <h1 className="font-serif text-3xl font-semibold text-ink">{name}</h1>
        <p className="mt-1 text-sm text-ink-soft">domena.pl/{slug}</p>
      </header>
    );
  }

  return (
    <header className="bg-primary px-6 pt-10 pb-8 text-on-primary">
      <span
        aria-hidden="true"
        className="mb-4 flex h-16 w-16 items-center justify-center rounded-full border-2 border-on-primary font-serif text-xl font-semibold"
      >
        {initials}
      </span>
      <h1 className="font-serif text-3xl font-semibold">{name}</h1>
      <p className="mt-1 text-sm">domena.pl/{slug}</p>
    </header>
  );
}
