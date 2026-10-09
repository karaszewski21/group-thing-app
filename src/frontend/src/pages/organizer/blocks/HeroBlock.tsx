import { familyInitials } from "../../../components/shared/Avatar";
import type { BlockProps } from "../layouts/types";
import { ShareButton } from "./ShareButton";

/** Organization name, initials and public address. `cover` has no image yet,
 * so it renders as a primary color band; `centered` is the LINKS hero;
 * `compact` is a top bar that carries the share action itself. */
export function HeroBlock({ data, variant }: BlockProps) {
  const { name, slug } = data.organization;
  const initials = familyInitials(name);

  if (variant === "compact") {
    return (
      <header className="flex items-center gap-3 border-b border-line bg-paper px-6 py-4">
        <span
          aria-hidden="true"
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary font-serif text-lg font-semibold text-on-primary"
        >
          {initials}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-serif text-xl font-semibold text-ink">{name}</h1>
          <p className="truncate text-[12.5px] text-ink-soft">domena.pl/{slug}</p>
        </div>
        <ShareButton
          slug={slug}
          name={name}
          label="Udostępnij"
          className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-full bg-primary-soft px-4 text-sm font-extrabold text-primary-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        />
      </header>
    );
  }

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
