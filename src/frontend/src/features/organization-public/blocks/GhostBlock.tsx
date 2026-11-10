import { Link } from "../../../routing/navigation";
import { appearancePath } from "../../../routing/paths";
import { EyeIcon } from "../../../components/shared/appIcons";
import type { BlockId } from "../layouts/types";

interface GhostCopy {
  title: string;
  body: string;
  /** Where the owner adds what this block shows (built from the page's slug). */
  cta?: { label: string; to: string | ((slug: string) => string) };
}

const ADD_TERM = { label: "Dodaj termin →", to: "/meetings" };
const ADD_EVENT = { label: "Dodaj wydarzenie →", to: "/add/event" };
const ADD_EXCHANGE_ITEM = { label: "Dodaj rzecz do wymiany →", to: "/items" };

const GHOST_COPY: Partial<Record<BlockId, GhostCopy>> = {
  about: {
    title: "O nas",
    body: "Napisz kilka zdań o sobie i swoich zajęciach — odwiedzający zobaczą je tutaj. Widzisz to tylko Ty.",
    cta: { label: "Dodaj opis →", to: (slug) => appearancePath(slug, "photos") },
  },
  gallery: {
    title: "Galeria",
    body: "Dodaj do 3 zdjęć — odwiedzający zobaczą je po sprawdzeniu. Widzisz to tylko Ty.",
    cta: { label: "Dodaj zdjęcia →", to: (slug) => appearancePath(slug, "photos") },
  },
  stats: {
    title: "Statystyki",
    body: "Statystyki pojawią się, gdy będziesz mieć więcej grup i terminów. Widzisz to tylko Ty.",
    cta: ADD_TERM,
  },
  "upcoming-dates": {
    title: "Najbliższe spotkania",
    body: "Tu pokażemy Twoje najbliższe terminy i wydarzenia. Widzisz to tylko Ty.",
    cta: ADD_EVENT,
  },
  "next-date-cta": {
    title: "Najbliższe spotkanie",
    body: "Tu pojawi się Twój najbliższy termin lub wydarzenie. Widzisz to tylko Ty.",
    cta: ADD_TERM,
  },
  "circles-grid": {
    title: "Nasze grupy",
    body: "Tu pokażemy Twoje publiczne grupy z najbliższymi terminami. Widzisz to tylko Ty.",
    cta: { label: "Dodaj grupę →", to: "/meetings" },
  },
  "exchange-counts": {
    title: "Wymiana rzeczy",
    body: "Gdy rodzice z Twoich grup wystawią rzeczy do oddania lub wymiany, pokażemy tu ich liczbę. Widzisz to tylko Ty.",
    cta: ADD_EXCHANGE_ITEM,
  },
  "exchange-board": {
    title: "Wymiana rzeczy",
    body: "Tu pojawią się rzeczy, które Ty i rodzice z Twoich grup wystawicie na najbliższe zajęcia. Widzisz to tylko Ty.",
    cta: ADD_EXCHANGE_ITEM,
  },
  "recent-items": {
    title: "Ostatnio dodane rzeczy",
    body: "Tu pokażemy rzeczy, które ostatnio wystawisz do oddania lub wymiany. Widzisz to tylko Ty.",
    cta: ADD_EXCHANGE_ITEM,
  },
  "needed-items": {
    title: "Potrzebne rzeczy",
    body: "Gdy dodasz do terminu potrzebne rzeczy, rodzice zobaczą tu, co jeszcze trzeba przynieść. Widzisz to tylko Ty.",
    cta: { label: "Dodaj potrzebną rzecz →", to: "/meetings" },
  },
};

const UNAVAILABLE_BODY = "Nie udało się wczytać danych. Odwiedzający nie widzą tej sekcji.";

interface GhostBlockProps {
  block: BlockId;
  /** The Organization's slug, for links into its "Wygląd strony". */
  slug: string;
  /** The directory failed to load: a neutral note without the panel link. */
  unavailable?: boolean;
}

/** Owner-only placeholder for a block with nothing to show. The frame itself
 * is plain text; only the optional panel link is focusable. */
export function GhostBlock({ block, slug, unavailable = false }: GhostBlockProps) {
  const copy = GHOST_COPY[block];
  if (!copy) return null;
  const cta = unavailable ? undefined : copy.cta;

  return (
    <div className="px-6 pt-5">
      <div data-ghost={block} className="rounded-2xl border-[1.5px] border-dashed border-line bg-paper/85 px-4 py-5 text-ink-soft">
        <div className="flex items-start justify-between gap-3">
          <p className="text-[13.5px] font-bold">{copy.title}</p>
          <EyeIcon c="currentColor" />
        </div>
        <p className="mt-1 text-[12.5px]">{unavailable ? UNAVAILABLE_BODY : copy.body}</p>
        {cta && (
          <Link
            to={typeof cta.to === "string" ? cta.to : cta.to(slug)}
            className="mt-1 inline-flex min-h-[44px] items-center rounded text-[13px] font-bold text-primary-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            {cta.label}
          </Link>
        )}
      </div>
    </div>
  );
}
