import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { CalendarPlusIcon, ChevronRightIcon, CloseIcon, FamilyIcon, SearchIcon } from "../../components/shared/appIcons";
import { viewPath } from "../../utils/appHelpers";
import { useAppData } from "../../app/appDataStore";

const OPTION_CLASS =
  "flex w-full items-center gap-3.5 rounded-[22px] border border-line bg-paper p-3.5 text-left text-ink transition-colors hover:border-line-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

function OptionContent({ icon, tone, title, hint }: { icon: ReactNode; tone: string; title: string; hint: string }) {
  return (
    <>
      <span className={`flex h-12 w-12 flex-none items-center justify-center rounded-2xl ${tone}`}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-base font-extrabold">{title}</span>
        <span className="block text-[13px] text-ink-soft">{hint}</span>
      </span>
      <span className="text-ink-soft">
        <ChevronRightIcon />
      </span>
    </>
  );
}

/** The bottom bar's "+": everything a user can add, in one place. */
export function AddView() {
  const { myGroups, setModal, selectTermGroup } = useAppData();
  const hasGroups = myGroups.length > 0;

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="font-serif text-[26px] leading-tight font-extrabold tracking-tight text-ink">Co dodajesz?</h1>
        <Link
          to="/"
          aria-label="Zamknij"
          className="flex h-11 w-11 flex-none items-center justify-center rounded-full border-[1.5px] border-line bg-paper text-ink hover:border-line-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          <CloseIcon />
        </Link>
      </div>

      <section className="relative overflow-hidden rounded-[28px] bg-primary p-5 text-on-primary">
        <span aria-hidden="true" className="absolute -top-10 -right-10 h-35 w-35 rounded-full bg-accent" />
        <h2 className="relative font-serif text-2xl font-extrabold">Rzecz</h2>
        <p className="relative mt-1 max-w-58 text-[15px] leading-snug opacity-90">
          Zrób zdjęcie i zdecyduj: wypożyczysz, oddasz czy zamienisz.
        </p>
        <Link
          to="/product/new"
          className="relative mt-4 flex min-h-13 items-center justify-center rounded-full bg-paper text-base font-extrabold text-primary-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-paper"
        >
          + Dodaj rzecz
        </Link>
      </section>

      <div className="mt-4 flex flex-col gap-2.5">
        <Link to={viewPath("szukam")} className={OPTION_CLASS}>
          <OptionContent
            icon={<SearchIcon c="currentColor" />}
            tone="bg-teal-soft text-ink"
            title="Szukam rzeczy"
            hint="Damy znać, gdy ktoś doda pasującą"
          />
        </Link>
      </div>

      <section className="mt-6">
        <h2 className="mb-2.5 text-[13px] font-extrabold tracking-[.12em] text-ink-soft uppercase">Spotkania</h2>
        <div className="flex flex-col gap-2.5">
          <button
            type="button"
            className={OPTION_CLASS}
            onClick={() => {
              if (hasGroups) {
                selectTermGroup(myGroups[0].id);
                setModal("termin");
              } else {
                setModal("zaloz-grupe");
              }
            }}
          >
            <OptionContent
              icon={<CalendarPlusIcon c="currentColor" />}
              tone="bg-accent-soft text-accent-fg"
              title="Termin spotkania"
              hint={hasGroups ? "Data, godzina i rzeczy do przyniesienia" : "Najpierw załóż grupę"}
            />
          </button>
          <button
            type="button"
            className={OPTION_CLASS}
            onClick={() => setModal(hasGroups ? "grupa" : "zaloz-grupe")}
          >
            <OptionContent
              icon={<FamilyIcon c="currentColor" />}
              tone="bg-primary-soft text-primary-fg"
              title="Grupa"
              hint="Stały cykl, np. „Poniedziałki 10:00”"
            />
          </button>
        </div>
      </section>
    </>
  );
}
