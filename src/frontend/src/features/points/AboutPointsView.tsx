import { Link } from "../../routing/navigation";
import { viewPath } from "../../routing/paths";

const CARD = "rounded-[22px] border border-line bg-paper p-5";
const HEADING = "m-0 text-lg font-extrabold text-ink";
const TEXT = "mt-1.5 text-[14px] leading-relaxed text-ink";
const LIST = "mt-2 flex list-disc flex-col gap-1.5 pl-5 text-[14px] leading-relaxed text-ink";
const FOCUS_RING = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

/** The public explanation of points and reputation (/about/points). Uses no
 * configured numbers, since the admin can change every one of them. */
export function AboutPointsView() {
  return (
    <article className="mx-auto flex w-full max-w-130 flex-col gap-3.5 px-4.5 pt-4 pb-8 font-sans text-ink">
      <header className="px-1">
        <h1 className="m-0 font-serif text-[28px] font-extrabold text-ink">Punkty i reputacja</h1>
        <p className="mt-1 text-[14px] text-ink-soft">
          Nagradzamy dzielenie się rzeczami i przychodzenie na spotkania.
        </p>
      </header>

      <section aria-labelledby="about-points-what" className={CARD}>
        <h2 id="about-points-what" className={HEADING}>
          Co to są punkty?
        </h2>
        <p className={TEXT}>
          Punkty to nagroda za to, że rzeczy krążą dalej, zamiast leżeć w szafie. Zbierasz je na swoim koncie i widzisz
          tylko Ty.
        </p>
        <p className={TEXT}>
          <b>Reputacja</b> to osobny licznik: rośnie tylko wtedy, gdy oddajesz coś za darmo. Nie da się jej wydać — pokazuje,
          ile już dałeś(-aś) innym.
        </p>
      </section>

      <section aria-labelledby="about-points-earn" className={CARD}>
        <h2 id="about-points-earn" className={HEADING}>
          Jak je zdobyć?
        </h2>
        <ul className={LIST}>
          <li>
            <b>Oddaj coś za darmo</b> — dostajesz punkty i tyle samo reputacji. Większa i lepiej zachowana rzecz jest warta
            więcej.
          </li>
          <li>
            <b>Wymień się</b> — punkty dostają obie strony wymiany.
          </li>
          <li>
            <b>Oddaj rzecz, której ktoś szuka</b> — jeśli była na liście „Szukam” odbiorcy, dostajesz premię.
          </li>
          <li>
            <b>Przyjdź na spotkanie</b> — terminy oznaczone plakietką „+pkt” dają punkty za obecność. Organizator zaznacza,
            kto był, a punkty przychodzą, gdy zbierze się wystarczająco dużo osób.
          </li>
        </ul>
        <p className={TEXT}>
          Punkty za oddanie lub wymianę przychodzą dopiero wtedy, gdy przekazanie zostanie potwierdzone w aplikacji.
        </p>
      </section>

      <section aria-labelledby="about-points-rules" className={CARD}>
        <h2 id="about-points-rules" className={HEADING}>
          Kiedy punktów nie ma?
        </h2>
        <ul className={LIST}>
          <li>Przekazania w obrębie jednej rodziny nie dają punktów.</li>
          <li>Częste przekazania tej samej osobie liczą się tylko do pewnego limitu.</li>
          <li>Punkty za obecność mają miesięczny limit na osobę.</li>
          <li>Organizator nie dostaje punktów za obecność na własnym terminie.</li>
          <li>Punkty zbierają osoby — konta organizacji ich nie dostają.</li>
        </ul>
      </section>

      <section aria-labelledby="about-points-spend" className={CARD}>
        <h2 id="about-points-spend" className={HEADING}>
          Co można z nimi zrobić?
        </h2>
        <p className={TEXT}>
          Wkrótce wymienisz punkty na przedmioty oznaczone „za punkty”. Do tego czasu punkty czekają na Twoim koncie.
        </p>
      </section>

      <Link
        to={viewPath("points")}
        className={`flex min-h-12 items-center justify-center rounded-full bg-primary text-[15px] font-extrabold text-on-primary ${FOCUS_RING}`}
      >
        Zobacz swoje punkty
      </Link>
    </article>
  );
}
