import type { ReactNode } from "react";
import Image from "next/image";
import { Link } from "../../routing/navigation";
import { CalendarIcon, CalendarPlusIcon, CloseIcon, SearchIcon } from "../../components/shared/appIcons";
import { authPath } from "../../auth/authPaths";
import { useWants } from "../../hooks/useWants";
import { viewPath } from "../../routing/paths";
import { useAppData } from "../panel/appDataStore";
import { newCountLabel } from "../wanted/wantText";

const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";
const LIFT = "transition-transform hover:-translate-y-0.5";

function CameraIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-7 w-7 @2xl:h-8.5 @2xl:w-8.5">
      <path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
      <circle cx="12" cy="13.5" r="3.5" />
    </svg>
  );
}

function ArrowIcon({ className }: { className: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M5 12h14" />
      <path d="M13 6l6 6-6 6" />
    </svg>
  );
}

/** A medium tile for the less frequent group forms (a term, an event), with
 * what it does and an arrow, so it reads as something to tap. */
function GroupTile({
  to,
  tone,
  iconTone,
  icon,
  title,
  hint,
  cta,
  ctaShort = cta,
}: {
  to: string;
  tone: string;
  iconTone: string;
  icon: ReactNode;
  title: string;
  hint: string;
  cta: string;
  /** The action on a phone, where the half-width tile has room for one short word or two. */
  ctaShort?: string;
}) {
  return (
    <Link
      to={to}
      className={`flex min-h-38 flex-col justify-between gap-4 rounded-3xl p-4 text-ink @2xl:min-h-0 @2xl:flex-row @2xl:items-start @2xl:justify-start @2xl:gap-3.5 @2xl:rounded-[26px] @2xl:p-5 ${tone} ${LIFT} ${FOCUS}`}
    >
      <span className={`flex h-11 w-11 flex-none items-center justify-center rounded-[14px] bg-paper @2xl:h-12 @2xl:w-12 @2xl:rounded-2xl ${iconTone}`}>
        {icon}
      </span>
      <span className="flex flex-col @2xl:h-full">
        <span className="font-serif text-[19px] leading-tight font-extrabold @2xl:text-[21px]">{title}</span>
        <span className="mt-1 text-[13px] leading-snug opacity-85 @2xl:mt-1.5 @2xl:text-sm">{hint}</span>
        <span className={`mt-3 inline-flex items-center gap-1.5 self-start text-[13px] font-extrabold whitespace-nowrap @2xl:mt-auto @2xl:text-sm ${iconTone}`}>
          <span className="@2xl:hidden">{ctaShort}</span>
          <span className="hidden @2xl:inline">{cta}</span>
          <span aria-hidden="true" className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-paper">
            <ArrowIcon className="h-3.5 w-3.5" />
          </span>
        </span>
      </span>
    </Link>
  );
}

/** The bottom bar's "+" in the panel, ordered by how often each is used: a
 * big tile for an item, two medium ones for a term of one of the user's
 * groups and a one-off event, and a slim row for a wanted item (with the new
 * matches of the active wants). */
export function AddView() {
  const { myGroups } = useAppData();
  const { data: wants } = useWants();
  const hasGroups = myGroups.length > 0;
  const newMatchCount = wants
    .filter((want) => want.status === "ACTIVE")
    .reduce((sum, want) => sum + want.new_match_count, 0);
  return (
    <AddTiles
      newMatchCount={newMatchCount}
      termHint={hasGroups ? "W jednej z Twoich grup" : "Najpierw załóż grupę"}
      termCta={hasGroups ? "Dodaj termin" : "Załóż grupę"}
      linkTo={(path) => (path === viewPath("add/term") && !hasGroups ? viewPath("groups/new") : path)}
    />
  );
}

/** `/add` for an anonymous visitor: the same tiles, so they see what they can
 * add; each one goes to the login page and, once logged in, on to the chosen
 * form. It reads no wants: a guest has none. */
export function PublicAddView() {
  return (
    <AddTiles termHint="W jednej z Twoich grup" termCta="Dodaj termin" linkTo={(path) => authPath("login", path)} />
  );
}

interface AddTilesProps {
  /** Unseen matches of the user's wants, shown on the "Szukam rzeczy" row. */
  newMatchCount?: number;
  termHint: string;
  termCta: string;
  /** The link of a tile, given the form it stands for. */
  linkTo: (path: string) => string;
}

function AddTiles({ newMatchCount = 0, termHint, termCta, linkTo }: AddTilesProps) {
  return (
    <div className="@container mx-auto w-full max-w-240">
      <div className="mb-4 flex items-center justify-between gap-3 @2xl:mb-6">
        <div>
          <h1 className="font-serif text-[28px] leading-tight font-extrabold tracking-tight text-ink @2xl:text-[36px]">
            Co dodajesz?
          </h1>
          <p className="mt-1 hidden text-[15px] text-ink-soft @2xl:block">Najczęściej to rzecz — zacznij od zdjęcia.</p>
        </div>
        <Link
          to="/"
          aria-label="Zamknij"
          className={`flex h-11 w-11 flex-none items-center justify-center rounded-full border-[1.5px] border-line bg-paper text-ink hover:border-line-strong @2xl:h-12 @2xl:w-12 ${FOCUS}`}
        >
          <CloseIcon />
        </Link>
      </div>

      <div className="flex flex-col gap-3.5 @2xl:grid @2xl:grid-cols-3 @2xl:grid-rows-[repeat(2,11.25rem)] @2xl:gap-4">
        <Link
          to={linkTo(viewPath("add/product"))}
          className={`relative flex min-h-80 flex-col justify-between gap-3.5 overflow-hidden rounded-[28px] bg-primary p-5 text-on-primary @2xl:col-span-2 @2xl:row-span-2 @2xl:min-h-0 @2xl:rounded-4xl @2xl:p-7 ${LIFT} ${FOCUS}`}
        >
          <Image
            src="/assets/sterta_rzeczy_w_pokoju.webp"
            alt=""
            fill
            priority
            sizes="(min-width: 768px) 640px, 100vw"
            className="object-cover object-[60%_40%] @2xl:object-[85%_55%]"
          />
          {/* The bright photo dimmed as a whole, so the white text reads anywhere on it. */}
          <span aria-hidden="true" className="absolute inset-0 bg-ink/35" />
          <span
            aria-hidden="true"
            className="absolute inset-0 bg-linear-to-t from-primary/90 from-12% via-primary/55 via-35% to-primary/0 to-60% @2xl:bg-linear-to-r @2xl:from-primary/85 @2xl:from-8% @2xl:via-primary/45 @2xl:via-32% @2xl:to-primary/0 @2xl:to-55%"
          />
          <span aria-hidden="true" className="relative flex h-14 w-14 items-center justify-center rounded-[18px] bg-paper text-primary-fg @2xl:h-17 @2xl:w-17 @2xl:rounded-[22px]">
            <CameraIcon />
          </span>
          <span className="relative [text-shadow:0_1px_12px_rgba(20,28,24,0.6)]">
            <span className="block font-serif text-[28px] leading-[1.05] font-extrabold @2xl:text-[40px] @2xl:tracking-tight">
              Dodaj rzecz
            </span>
            <span className="mt-1.5 block max-w-105 text-[15px] leading-snug @2xl:mt-2 @2xl:text-[17px]">
              Zrób zdjęcie — potem zdecydujesz, czy ją oddasz, czy zamienisz.
            </span>
          </span>
          <span className="relative flex flex-wrap items-center justify-between gap-2.5">
            <span className="flex gap-1.5" aria-hidden="true">
              <span className="rounded-full bg-orange px-2.5 py-1 text-xs font-extrabold text-ink shadow-[0_2px_8px_-2px_rgba(20,28,24,0.4)] @2xl:text-[13px]">Oddam</span>
              <span className="rounded-full bg-orange px-2.5 py-1 text-xs font-extrabold text-ink shadow-[0_2px_8px_-2px_rgba(20,28,24,0.4)] @2xl:text-[13px]">Zamienię</span>
            </span>
            <span className="inline-flex min-h-11 items-center rounded-full bg-paper px-4 text-sm font-extrabold text-primary-fg @2xl:min-h-13 @2xl:px-5.5 @2xl:text-base">
              Zacznij od zdjęcia →
            </span>
          </span>
        </Link>

        <div className="grid grid-cols-2 gap-2.5 @2xl:contents">
          <GroupTile
            to={linkTo(viewPath("add/term"))}
            tone="bg-accent-soft"
            iconTone="text-accent-fg"
            icon={<CalendarPlusIcon c="currentColor" />}
            title="Termin spotkania"
            hint={termHint}
            cta={termCta}
          />
          <GroupTile
            to={linkTo(viewPath("add/event"))}
            tone="bg-primary-soft"
            iconTone="text-primary-fg"
            icon={<CalendarIcon c="currentColor" />}
            title="Wydarzenie"
            hint="Jednorazowe: piknik, urodziny, giełda"
            cta="Utwórz wydarzenie"
            ctaShort="Utwórz"
          />
        </div>
      </div>

      <Link
        to={linkTo(viewPath("add/wanted"))}
        className={`mt-3.5 flex min-h-16 items-center gap-3 rounded-[20px] border border-line bg-paper py-2.5 pr-3 pl-2.5 text-ink hover:border-line-strong @2xl:mt-4 @2xl:min-h-18 @2xl:gap-3.5 @2xl:rounded-[22px] @2xl:pr-4.5 @2xl:pl-3 ${FOCUS}`}
      >
        <span aria-hidden="true" className="flex h-11 w-11 flex-none items-center justify-center rounded-[14px] bg-stage text-ink-soft @2xl:h-12 @2xl:w-12 @2xl:rounded-2xl">
          <SearchIcon c="currentColor" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-extrabold @2xl:text-base">Szukam rzeczy</span>
          <span className="block text-[13px] text-ink-soft @2xl:text-sm">Damy znać, gdy ktoś doda pasującą</span>
        </span>
        {newMatchCount > 0 && (
          <span className="flex-none rounded-full bg-primary px-2.5 py-0.5 text-xs font-extrabold text-on-primary @2xl:text-[13px]">
            {newCountLabel(newMatchCount)}
          </span>
        )}
        <span aria-hidden="true" className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-primary text-on-primary @2xl:h-10 @2xl:w-10">
          <ArrowIcon className="h-4 w-4" />
        </span>
      </Link>
    </div>
  );
}
