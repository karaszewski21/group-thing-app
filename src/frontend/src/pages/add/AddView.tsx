import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { BoxIcon, CalendarIcon, CalendarPlusIcon, CloseIcon, SearchIcon } from "../../components/shared/appIcons";
import { viewPath } from "../../utils/appHelpers";
import { useAppData } from "../../app/appDataStore";

const TILE_CLASS =
  "relative flex aspect-[4/5] flex-col justify-between overflow-hidden rounded-[26px] p-4 text-left transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

function TileContent({ icon, iconTone, title, hint }: { icon: ReactNode; iconTone: string; title: string; hint: string }) {
  return (
    <>
      <span className={`flex h-13 w-13 items-center justify-center rounded-[18px] ${iconTone}`}>{icon}</span>
      <span>
        <span className="block font-serif text-[21px] leading-tight font-extrabold">{title}</span>
        <span className="mt-1 block text-[13px] leading-snug opacity-85">{hint}</span>
      </span>
    </>
  );
}

/** The bottom bar's "+": four big tiles — an item, a wanted item, a term of
 * one of the user's groups and a one-off event. */
export function AddView() {
  const { myGroups, setModal } = useAppData();
  const hasGroups = myGroups.length > 0;
  const termTile = (
    <TileContent
      icon={<CalendarPlusIcon c="currentColor" />}
      iconTone="bg-paper text-accent-fg"
      title="Termin spotkania"
      hint={hasGroups ? "W jednej z Twoich grup" : "Najpierw załóż grupę"}
    />
  );

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

      <div className="grid grid-cols-2 gap-3">
        <Link to="/add/product" className={`${TILE_CLASS} bg-primary text-on-primary`}>
          <span aria-hidden="true" className="absolute -top-8 -right-8 h-24 w-24 rounded-full bg-accent" />
          <span className="relative flex h-full flex-col justify-between">
            <TileContent
              icon={<BoxIcon c="currentColor" />}
              iconTone="bg-paper text-primary-fg"
              title="Rzecz"
              hint="Zrób zdjęcie: oddasz czy zamienisz"
            />
          </span>
        </Link>
        <Link to={viewPath("add/hunting")} className={`${TILE_CLASS} bg-teal-soft text-ink`}>
          <TileContent
            icon={<SearchIcon c="currentColor" />}
            iconTone="bg-paper text-ink"
            title="Szukam rzeczy"
            hint="Damy znać, gdy ktoś doda pasującą"
          />
        </Link>
        {hasGroups ? (
          <Link to={viewPath("add/term")} className={`${TILE_CLASS} bg-accent-soft text-ink`}>
            {termTile}
          </Link>
        ) : (
          <button type="button" onClick={() => setModal("zaloz-grupe")} className={`${TILE_CLASS} bg-accent-soft text-ink`}>
            {termTile}
          </button>
        )}
        <Link to={viewPath("add/event")} className={`${TILE_CLASS} bg-primary-soft text-ink`}>
          <TileContent
            icon={<CalendarIcon c="currentColor" />}
            iconTone="bg-paper text-primary-fg"
            title="Wydarzenie"
            hint="Jednorazowe: piknik, urodziny"
          />
        </Link>
      </div>
    </>
  );
}
