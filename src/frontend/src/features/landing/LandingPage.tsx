import type { ReactNode } from "react";
import { Link } from "../../routing/navigation";
import { authPath } from "../../auth/authPaths";
import { GiftIcon } from "../../components/shared/appIcons";
import { HomeFeed } from "../home/HomeFeed";

function SwapIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
      <path d="M17 2l4 4-4 4" />
      <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
      <path d="M7 22l-4-4 4-4" />
      <path d="M21 13v1a4 4 0 0 1-4 4H3" />
    </svg>
  );
}

function Hero() {
  return (
    <section className="relative min-w-0 overflow-hidden rounded-[28px] bg-primary px-5 pt-6 pb-5.5 text-on-primary md:flex-[1.4] md:rounded-4xl md:px-9 md:pt-9 md:pb-8">
      <span aria-hidden="true" className="absolute -top-11 -right-11 h-32 w-32 rounded-full bg-accent md:-top-12 md:-right-12 md:h-44 md:w-44" />
      <span aria-hidden="true" className="absolute right-24 -bottom-20 hidden h-40 w-40 rounded-full border-[5px] border-on-primary/20 md:block" />
      <h1 className="relative max-w-130 font-serif text-[29px] leading-[1.06] font-extrabold tracking-tight md:text-[44px] md:leading-[1.04]">
        Rzeczy i spotkania Twojej grupy w jednym miejscu
      </h1>
      <p className="relative mt-2.5 max-w-120 text-[15px] leading-snug opacity-90 md:mt-3.5 md:text-[17px]">
        Oddawaj i zamieniaj dziecięce rzeczy z rodzicami z okolicy. Zapisuj się na zajęcia i umawiaj, kto co
        przyniesie.
      </p>
      <div className="relative mt-4.5 flex flex-wrap gap-2 md:mt-6 md:gap-2.5">
        <Link
          to={authPath("register")}
          className="flex min-h-12 items-center rounded-full bg-paper px-5 text-[15px] font-extrabold text-primary-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-paper md:min-h-13 md:px-6.5 md:text-base"
        >
          Załóż konto
        </Link>
        <Link
          to="/login"
          className="flex min-h-12 items-center rounded-full border-[1.5px] border-on-primary/60 px-5 text-[15px] font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-paper md:min-h-13 md:px-6.5 md:text-base"
        >
          Mam już konto
        </Link>
      </div>
    </section>
  );
}

/** The hero beside the location card (stacked on a phone). */
function heroRow(location: ReactNode) {
  return (
    <div className="flex flex-col gap-7 md:flex-row md:items-stretch md:gap-6">
      <Hero />
      <div className="md:w-95 md:flex-none">{location}</div>
    </div>
  );
}

/** The public home page at "/" for visitors who are not logged in: the hero
 * with sign-up beside the location card, the same item and meeting feed a
 * logged-in visitor gets on Start (`HomeFeed`), what one can do with a
 * thing and the invitation for organizers. */
export function LandingPage() {
  return (
    <div className="flex-1 bg-cream font-sans text-ink">
      <div className="mx-auto flex w-full max-w-300 flex-col px-4 pt-4 pb-12 md:px-6 md:pt-7">
        <HomeFeed top={heroRow} />

        <section aria-labelledby="landing-jak" className="mt-10 md:mt-12">
          <h2 id="landing-jak" className="sr-only">
            Co możesz zrobić z rzeczą
          </h2>
          <ul className="grid grid-cols-2 gap-2.5 md:gap-4">
            <li className="flex flex-col gap-1 rounded-[20px] bg-primary-soft p-3.5 text-primary-fg md:flex-row md:items-center md:gap-4 md:rounded-3xl md:px-6 md:py-5">
              <span aria-hidden="true" className="hidden h-12 w-12 flex-none items-center justify-center rounded-2xl bg-primary text-on-primary md:flex">
                <GiftIcon c="currentColor" />
              </span>
              <div>
                <h3 className="text-base font-extrabold md:text-lg">Oddam</h3>
                <p className="mt-0.5 text-[12.5px] leading-snug md:text-sm">Za darmo — komuś przyda się bardziej.</p>
              </div>
            </li>
            <li className="flex flex-col gap-1 rounded-[20px] bg-accent-soft p-3.5 text-accent-fg md:flex-row md:items-center md:gap-4 md:rounded-3xl md:px-6 md:py-5">
              <span aria-hidden="true" className="hidden h-12 w-12 flex-none items-center justify-center rounded-2xl bg-accent text-ink md:flex">
                <SwapIcon />
              </span>
              <div>
                <h3 className="text-base font-extrabold md:text-lg">Zamienię</h3>
                <p className="mt-0.5 text-[12.5px] leading-snug md:text-sm">Na coś, czego potrzebujesz teraz.</p>
              </div>
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}
