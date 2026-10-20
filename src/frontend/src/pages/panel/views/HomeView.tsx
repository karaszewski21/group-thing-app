import { Link } from "react-router-dom";
import dayjs from "../../../utils/dayjs";
import { BuildingIcon, CalendarPlusIcon, GiftIcon } from "../panelIcons";
import { HintCard } from "../panelComponents";
import { capitalize, dayMonth, ITEM_MODES, termTime, type ItemMode } from "../panelHelpers";
import { usePanelData } from "../panelDataStore";

/** Soft tile + readable text per item mode, matching the exchange tones. */
const ITEM_MODE_TILE: Record<ItemMode, string> = {
  "wypożyczę": "bg-teal-soft text-ink",
  "oddam": "bg-primary-soft text-primary-fg",
  "zamienię": "bg-accent-soft text-accent-fg",
};

const SECTION_TITLE = "font-serif text-[21px] font-bold text-ink";
const SECTION_LINK = "text-sm font-extrabold text-primary-fg hover:underline";
const CARD = "rounded-[22px] border border-line bg-paper";
const EMPTY = "text-[13px] leading-snug text-ink-soft";

function DateBadge({ iso, tone = "bg-primary-soft text-primary-fg" }: { iso: string; tone?: string }) {
  const { day, month } = dayMonth(iso);
  return (
    <div className={`flex h-14.5 w-13 flex-none flex-col items-center justify-center rounded-2xl leading-none ${tone}`}>
      <b className="font-serif text-[22px] font-extrabold text-ink">{day}</b>
      <small className="mt-0.5 text-[10px] font-extrabold tracking-wide uppercase">{month}</small>
    </div>
  );
}

export function HomeView() {
  const {
    profile,
    hintCreateGroupDismissed,
    hintCreateOrgDismissed,
    hintOrgPolishDismissed,
    hintOrgFirstTermDismissed,
    organizationSlug,
    terms,
    myGroups,
    myAttendances,
    savedCards,
    myPledges,
    withdrawMyPledge,
    itemCounts,
    borrowedItems,
    setView,
    setModal,
    setFirstTermForOrganizer,
    organizerTermCard,
    guestTermCard,
    dismissCreateGroupHint,
    dismissCreateOrgHint,
    dismissOrgFirstTermHint,
    dismissOrgPolishHint,
  } = usePanelData();

  if (!profile) return null;

  // "Najbliższe" means from today on; past terms stay on Spotkania.
  const today = dayjs().startOf("day");
  const isUpcoming = (iso: string) => !dayjs(iso).isBefore(today);
  // Led terms first, then the guest cards (already deduped against them), so
  // the stable sort keeps a led card ahead of a same-time guest one.
  const upcoming = [
    ...terms
      .filter(({ term }) => isUpcoming(term.occurs_on))
      .map((entry) => ({ termId: entry.term.id, occursOn: entry.term.occurs_on, led: entry, guest: null })),
    ...savedCards
      .filter((card) => isUpcoming(card.occursOn))
      .map((card) => ({ termId: card.termId, occursOn: card.occursOn, led: null, guest: card })),
  ].sort((a, b) => a.occursOn.localeCompare(b.occursOn));
  const topTerms = upcoming.slice(0, 3);
  const shownTermIds = new Set(topTerms.map((t) => t.termId));
  // An attendance already shown in "Najbliższe terminy" is not repeated below.
  const restAttendances = myAttendances.filter((a) => !shownTermIds.has(a.term_id));
  const bothEmpty = myAttendances.length === 0 && myPledges.length === 0;
  const hasGroups = myGroups.length > 0;

  return (
    <>
      <div className="mb-5">
        <h2 className="font-serif text-[32px] leading-tight font-extrabold tracking-tight text-ink">
          Cześć, {profile.display_name.split(" ")[0]}!
        </h2>
      </div>

      {!hasGroups && !hintCreateGroupDismissed && (
        <HintCard
          icon={<CalendarPlusIcon c="currentColor" />}
          title="Załóż grupę"
          description="Zbierz znajomych lub rodziny i ustal pierwsze spotkanie — bez zakładania organizacji."
          ctaLabel="Zacznijmy →"
          onCtaClick={() => setModal("zaloz-grupe")}
          onDismiss={dismissCreateGroupHint}
        />
      )}

      {hasGroups && organizationSlug === null && !hintCreateOrgDismissed && (
        <HintCard
          icon={<BuildingIcon c="currentColor" />}
          title="Stwórz wizytówkę"
          description="Publiczna strona z własnym adresem dla Twoich grup."
          ctaLabel="Przejdź →"
          ctaTo="/organization"
          onDismiss={dismissCreateOrgHint}
        />
      )}

      {hasGroups && organizationSlug !== null && !hintOrgPolishDismissed && (
        <HintCard
          icon={<BuildingIcon c="currentColor" />}
          title="Dopracuj stronę organizacji"
          description="Wybierz układ i kolory swojej strony — zobaczą je odwiedzający."
          ctaLabel="Przejdź →"
          ctaTo={`/${organizationSlug}?edit=1`}
          onDismiss={dismissOrgPolishHint}
        />
      )}

      {hasGroups && terms.length === 0 && !hintOrgFirstTermDismissed && (
        <HintCard
          icon={<CalendarPlusIcon c="currentColor" />}
          title="Dodaj swój pierwszy termin"
          description="Ustal pierwsze spotkanie w swojej grupie."
          ctaLabel="Dodaj termin →"
          onCtaClick={() => {
            setFirstTermForOrganizer(true);
            setModal("pierwszy-termin");
          }}
          onDismiss={dismissOrgFirstTermHint}
        />
      )}

      <section className="mt-6">
        <div className="mb-2.5 flex items-baseline justify-between gap-2.5">
          <h3 className={SECTION_TITLE}>Najbliższe terminy</h3>
          <button onClick={() => setView("spotkania")} className={SECTION_LINK}>
            Zobacz wszystkie
          </button>
        </div>
        {upcoming.length === 0 && (
          <div className={`${CARD} border-dashed p-5 text-center ${EMPTY}`}>Brak zaplanowanych terminów.</div>
        )}
        <div className="flex flex-col gap-2.5">
          {topTerms.map(({ termId, led, guest }) => (
            <div key={termId}>
              {led ? organizerTermCard(led.term, led.group, led.neededItems) : guest && guestTermCard(guest)}
            </div>
          ))}
        </div>
      </section>

      {bothEmpty ? (
        <div className="mt-6 grid grid-cols-2 gap-2.5">
          <section className={`${CARD} p-4`}>
            <h3 className="text-[15px] font-extrabold text-ink">Zapisane zajęcia</h3>
            <p className={`mt-1 ${EMPTY}`}>Nie masz jeszcze zapisów na zajęcia.</p>
          </section>
          <section className={`${CARD} p-4`}>
            <h3 className="text-[15px] font-extrabold text-ink">Zadeklarowane rzeczy</h3>
            <p className={`mt-1 ${EMPTY}`}>Brak deklaracji przyniesienia rzeczy.</p>
          </section>
        </div>
      ) : (
        <>
          {(myAttendances.length === 0 || restAttendances.length > 0) && (
            <section className="mt-6">
              <h3 className={`mb-2.5 ${SECTION_TITLE}`}>Zapisane zajęcia</h3>
              {myAttendances.length === 0 ? (
                <div className={`${CARD} border-dashed p-5 text-center ${EMPTY}`}>Nie masz jeszcze zapisów na zajęcia.</div>
              ) : (
                <div className="flex flex-col gap-2.5">
                  {restAttendances.map((a) => (
                    <Link
                      key={a.attendance_id}
                      to={`/${a.organizer_slug}/grupa/${a.group_id}/term/${a.term_id}`}
                      className={`${CARD} flex items-start gap-3 p-3.5 transition-colors hover:border-line-strong`}
                    >
                      <DateBadge iso={a.occurs_on} />
                      <div className="min-w-0 flex-1">
                        <h4 className="text-base font-bold text-ink">{a.group_name}</h4>
                        <small className="mt-0.5 block text-sm text-ink-soft">
                          {termTime(a.occurs_on) && (
                            <span className="font-bold text-ink">godz. {termTime(a.occurs_on)}</span>
                          )}
                          {termTime(a.occurs_on) && a.organizer_display_name ? " · " : ""}
                          {a.organizer_display_name ?? ""}
                        </small>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </section>
          )}

          <section className="mt-6">
            <h3 className={`mb-2.5 ${SECTION_TITLE}`}>Zadeklarowane rzeczy</h3>
            {myPledges.length === 0 ? (
              <div className={`${CARD} border-dashed p-5 text-center ${EMPTY}`}>Brak deklaracji przyniesienia rzeczy.</div>
            ) : (
              <div className="flex flex-col gap-2.5">
                {myPledges.map((p) => {
                  const time = termTime(p.occurs_on);
                  const statusLabel =
                    p.status === "FULFILLED" ? "Zrealizowane ✓" : p.registered ? "Zarejestrowane" : "Zadeklarowane";
                  return (
                    <div key={p.pledge_id} className={`${CARD} flex items-start gap-3 p-3.5`}>
                      <DateBadge iso={p.occurs_on} tone="bg-accent-soft text-accent-fg" />
                      <div className="min-w-0 flex-1">
                        <h4 className="text-[15px] font-bold wrap-break-word text-ink">
                          {p.product_name}
                          {p.item_description ? ` — ${p.item_description}` : ""}
                        </h4>
                        <small className="mt-0.5 block text-sm text-ink-soft">
                          {p.group_name}
                          {time ? ` · godz. ${time}` : ""} · {statusLabel}
                        </small>
                      </div>
                      {p.status === "CLAIMED" && !p.registered && (
                        <button
                          onClick={() => void withdrawMyPledge(p.pledge_id)}
                          className="min-h-9 flex-none rounded-full border-[1.5px] border-line px-3 text-xs font-bold text-danger hover:bg-cream"
                        >
                          Rezygnuję
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}

      <section className="mt-6">
        <div className="mb-2.5 flex items-baseline justify-between gap-2.5">
          <h3 className={SECTION_TITLE}>Twoje rzeczy</h3>
          <button onClick={() => setView("rzeczy")} className={SECTION_LINK}>
            Zobacz →
          </button>
        </div>
        <div className="grid grid-cols-3 gap-2.5">
          {ITEM_MODES.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setView("rzeczy")}
              className={`flex flex-col items-start rounded-[20px] p-3.5 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring ${ITEM_MODE_TILE[m]}`}
            >
              <b className="font-serif text-[30px] leading-none font-extrabold">{itemCounts[m]}</b>
              <small className="mt-1 text-[13px] font-extrabold">{capitalize(m)}</small>
            </button>
          ))}
        </div>
      </section>

      <button
        type="button"
        onClick={() => setView("podarki")}
        className={`${CARD} mt-3.5 flex w-full items-center gap-3.5 p-4 text-left transition-colors hover:border-line-strong`}
      >
        <span className="flex h-12 w-12 flex-none items-center justify-center rounded-2xl bg-cream text-ink">
          <GiftIcon c="currentColor" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-extrabold text-ink">Rzeczy wypożyczone</span>
          <span className="block text-[13px] text-ink-soft">
            {borrowedItems.length === 0 ? "Teraz nic nie pożyczasz od innych." : "Rzeczy pożyczone od innych"}
          </span>
        </span>
        <span className="font-serif text-[26px] font-extrabold text-ink-soft">{borrowedItems.length}</span>
      </button>
    </>
  );
}
