import { Link } from "react-router-dom";
import { EyeIcon } from "../../panel/panelIcons";
import type { BlockId } from "../layouts/types";

interface GhostCopy {
  title: string;
  body: string;
  /** Where in the panel the owner adds what this block shows. */
  cta?: { label: string; to: string };
}

const ADD_TERM = { label: "Dodaj termin →", to: "/panel/spotkania" };
const ADD_EXCHANGE_ITEM = { label: "Dodaj rzecz do wymiany →", to: "/panel/rzeczy" };

const GHOST_COPY: Partial<Record<BlockId, GhostCopy>> = {
  about: {
    title: "Opis — wkrótce",
    body: "Tu pojawi się opis Twojej organizacji. Widzisz to tylko Ty.",
  },
  stats: {
    title: "Statystyki",
    body: "Statystyki pojawią się, gdy będziesz mieć więcej grup i terminów. Widzisz to tylko Ty.",
    cta: ADD_TERM,
  },
  "upcoming-terms": {
    title: "Najbliższe terminy",
    body: "Tu pokażemy Twoje najbliższe zajęcia. Widzisz to tylko Ty.",
    cta: ADD_TERM,
  },
  "next-term-cta": {
    title: "Najbliższe zajęcia",
    body: "Tu pojawi się Twój najbliższy termin. Widzisz to tylko Ty.",
    cta: ADD_TERM,
  },
  agenda: {
    title: "Plan zajęć",
    body: "Gdy dodasz terminy, odwiedzający zobaczą tu plan zajęć. Widzisz to tylko Ty.",
    cta: ADD_TERM,
  },
  "circles-grid": {
    title: "Nasze grupy",
    body: "Tu pokażemy Twoje publiczne grupy z najbliższymi terminami. Widzisz to tylko Ty.",
    cta: { label: "Dodaj grupę →", to: "/panel/spotkania" },
  },
  "exchange-counts": {
    title: "Wymiana rzeczy",
    body: "Gdy rodzice z Twoich grup wystawią rzeczy do oddania, wymiany lub wypożyczenia, pokażemy tu ich liczbę. Widzisz to tylko Ty.",
    cta: ADD_EXCHANGE_ITEM,
  },
  "exchange-board": {
    title: "Wymiana rzeczy",
    body: "Tu pojawią się rzeczy, które Ty i rodzice z Twoich grup wystawicie na najbliższe zajęcia. Widzisz to tylko Ty.",
    cta: ADD_EXCHANGE_ITEM,
  },
  "needed-items": {
    title: "Potrzebne rzeczy",
    body: "Gdy dodasz do terminu potrzebne rzeczy, rodzice zobaczą tu, co jeszcze trzeba przynieść. Widzisz to tylko Ty.",
    cta: { label: "Dodaj potrzebną rzecz →", to: "/panel/spotkania" },
  },
};

const UNAVAILABLE_BODY = "Nie udało się wczytać danych. Odwiedzający nie widzą tej sekcji.";

interface GhostBlockProps {
  block: BlockId;
  /** The directory failed to load: a neutral note without the panel link. */
  unavailable?: boolean;
}

/** Owner-only placeholder for a block with nothing to show. The frame itself
 * is plain text; only the optional panel link is focusable. */
export function GhostBlock({ block, unavailable = false }: GhostBlockProps) {
  const copy = GHOST_COPY[block];
  if (!copy) return null;
  const cta = unavailable ? undefined : copy.cta;

  return (
    <div className="px-6 pt-5">
      <div data-ghost={block} className="rounded-2xl border-[1.5px] border-dashed border-line px-4 py-5 text-ink-soft">
        <div className="flex items-start justify-between gap-3">
          <p className="text-[13.5px] font-bold">{copy.title}</p>
          <EyeIcon c="currentColor" />
        </div>
        <p className="mt-1 text-[12.5px]">{unavailable ? UNAVAILABLE_BODY : copy.body}</p>
        {cta && (
          <Link
            to={cta.to}
            className="mt-1 inline-flex min-h-[44px] items-center rounded text-[13px] font-bold text-primary-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            {cta.label}
          </Link>
        )}
      </div>
    </div>
  );
}
