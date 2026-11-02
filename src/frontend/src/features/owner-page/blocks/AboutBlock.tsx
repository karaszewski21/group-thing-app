import type { BlockProps, OrganizerPageData } from "../layouts/types";

// eslint-disable-next-line react-refresh/only-export-components -- the renderer reads each block's isEmpty next to it
export function isAboutEmpty(data: OrganizerPageData): boolean {
  return !data.organization.description?.trim();
}

/** The organization's description, line breaks kept. `on-primary` is for the
 * primary-colored LINKS page. */
export function AboutBlock({ data, variant }: BlockProps) {
  const onPrimary = variant === "on-primary";

  return (
    <section aria-labelledby="organizer-about" className={`px-6 pt-6 ${onPrimary ? "text-center" : ""}`}>
      <h2
        id="organizer-about"
        className={`mb-2 font-serif text-xl font-bold ${onPrimary ? "text-on-primary" : "text-ink"}`}
      >
        O nas
      </h2>
      <p
        className={`text-[15px] leading-relaxed wrap-break-word whitespace-pre-line ${onPrimary ? "text-on-primary" : "text-ink-soft"}`}
      >
        {data.organization.description}
      </p>
    </section>
  );
}
