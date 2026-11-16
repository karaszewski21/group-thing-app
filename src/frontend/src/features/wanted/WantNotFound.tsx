import { SearchIcon } from "../../components/shared/appIcons";
import { Link } from "../../routing/navigation";
import { viewPath } from "../../routing/paths";

/** Shown instead of the match list or the edit form when the want is
 * unknown, foreign, withdrawn or already removed. */
export function WantNotFound() {
  return (
    <div className="mt-15 flex flex-col items-center gap-2.5 rounded-[28px] border-[1.5px] border-dashed border-line-strong bg-paper px-5 py-7 text-center">
      <span
        aria-hidden="true"
        className="flex h-16 w-16 items-center justify-center rounded-3xl bg-accent-soft text-accent-fg"
      >
        <SearchIcon c="currentColor" />
      </span>
      <h1 className="font-serif text-[22px] font-extrabold text-ink">Nie ma takiego poszukiwania</h1>
      <p className="max-w-70 text-[15px] leading-snug text-ink-soft">
        Mogło zostać wycofane albo usunięte po zakończeniu.
      </p>
      <Link
        to={viewPath("wanted")}
        className="mt-1.5 flex min-h-12 items-center justify-center rounded-full bg-primary px-5 text-[15px] font-extrabold text-on-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
      >
        Wróć do listy „Szukam”
      </Link>
    </div>
  );
}
