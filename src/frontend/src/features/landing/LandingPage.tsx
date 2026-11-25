import { Link } from "../../routing/navigation";
import { authPath } from "../../auth/authPaths";
import { BuildingIcon } from "../../components/shared/appIcons";
import { capitalize, ITEM_MODE_TONE, ITEM_MODES, type ItemMode } from "../../utils/appHelpers";
import { HomeFeed } from "../home/HomeFeed";

const MODE_HINT: Record<ItemMode, string> = {
  "oddam": "Za darmo — komuś przyda się bardziej.",
  "zamienię": "Na coś, czego potrzebujesz teraz.",
};

const SECTION_TITLE = "font-serif text-[24px] leading-tight font-extrabold tracking-tight text-ink";
const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

/** The public home page at "/" for visitors who are not logged in (the brand
 * and "Zaloguj się" sit in PublicLayout's top bar), with the same item and
 * meeting feed a logged-in visitor gets on Start (`HomeFeed`). */
export function LandingPage() {
  return (
    <div className="flex-1 bg-cream font-sans text-ink">
      <div className="mx-auto flex max-w-xl flex-col px-4 pt-4 pb-12">

        <section className="relative mt-4 overflow-hidden rounded-4xl bg-primary px-6 pt-8 pb-7 text-on-primary">
          <span aria-hidden="true" className="absolute -top-12 -right-12 h-40 w-40 rounded-full bg-accent" />
          <span aria-hidden="true" className="absolute right-10 -bottom-16 h-32 w-32 rounded-full border-4 border-on-primary/25" />
          <h1 className="relative max-w-80 font-serif text-[34px] leading-[1.08] font-extrabold tracking-tight">
            Rzeczy i spotkania Twojej grupy w jednym miejscu
          </h1>
          <p className="relative mt-3 max-w-80 text-base leading-snug opacity-90">
            Oddawaj i zamieniaj dziecięce rzeczy z rodzicami z okolicy. Zapisuj się na zajęcia i umawiaj,
            kto co przyniesie.
          </p>
          <div className="relative mt-6 flex flex-wrap gap-2.5">
            <Link
              to={authPath("register")}
              className="flex min-h-12 items-center rounded-full bg-paper px-6 text-base font-extrabold text-primary-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-paper"
            >
              Załóż konto
            </Link>
            <Link
              to="/login"
              className="flex min-h-12 items-center rounded-full border-[1.5px] border-on-primary/50 px-6 text-base font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-paper"
            >
              Mam już konto
            </Link>
          </div>
        </section>

        <section aria-labelledby="landing-jak" className="mt-10">
          <h2 id="landing-jak" className={SECTION_TITLE}>
            Co możesz zrobić z rzeczą
          </h2>
          <ul className="mt-4 grid grid-cols-1 gap-2.5 min-[420px]:grid-cols-2">
            {ITEM_MODES.map((m) => (
              <li key={m} className={`rounded-[22px] p-4 ${ITEM_MODE_TONE[m]}`}>
                <h3 className="text-base font-extrabold">{capitalize(m)}</h3>
                <p className="mt-1 text-[13px] leading-snug">{MODE_HINT[m]}</p>
              </li>
            ))}
          </ul>
        </section>

        <div className="mt-10">
          <HomeFeed />
        </div>

        <section className="mt-10 flex gap-4 rounded-[28px] bg-accent-soft p-5">
          <span className="flex h-12 w-12 flex-none items-center justify-center rounded-2xl bg-accent text-ink">
            <BuildingIcon c="currentColor" />
          </span>
          <div>
            <h2 className="text-lg font-extrabold">Prowadzisz zajęcia?</h2>
            <p className="mt-1 text-sm leading-snug">
              Załóż organizację: dostaniesz własną stronę, grupy z terminami i zapisy rodziców.
            </p>
            <Link to={authPath("register")} className={`mt-2 inline-block rounded text-sm font-extrabold text-accent-fg hover:underline ${FOCUS}`}>
              Załóż konto →
            </Link>
          </div>
        </section>

        <footer className="mt-10 text-center text-[13px] text-ink-soft">Krąg grupy</footer>
      </div>
    </div>
  );
}
