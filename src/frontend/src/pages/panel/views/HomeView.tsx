import { Link } from "react-router-dom";
import { BoxIcon, BuildingIcon, CalendarPlusIcon, GiftIcon } from "../panelIcons";
import { HintCard } from "../panelComponents";
import {
  capitalize,
  dayMonth,
  GIFT_SOURCE_STYLE,
  ITEM_MODE_STYLE,
  ITEM_MODES,
  termPublicPath,
  termTime,
  type GiftSource,
} from "../panelHelpers";
import { usePanelData } from "../panelDataStore";

export function HomeView() {
  const {
    profile,
    isOrganizer,
    hintFirstTermDismissed,
    hintBecomeOrganizerDismissed,
    hintOrgPolishDismissed,
    hintOrgFirstTermDismissed,
    organizationSlug,
    terms,
    myGroups,
    myAttendances,
    itemCounts,
    giftCounts,
    setView,
    setModal,
    setFirstTermForOrganizer,
    organizerTermCard,
    dismissFirstTermHint,
    dismissBecomeOrganizerHint,
    dismissOrgFirstTermHint,
    dismissOrgPolishHint,
  } = usePanelData();

  if (!profile) return null;

  return (
    <>
            <div className="mb-[18px]">
              <h2 className="font-serif text-xl font-semibold text-ink">
                Cześć, {profile.display_name.split(" ")[0]}!
              </h2>
              <p className="mt-1 text-[13.5px] text-ink-soft">Oto co dzieje się w Twojej grupie.</p>
            </div>

            {!isOrganizer && !hintFirstTermDismissed && (
              <HintCard
                icon={<CalendarPlusIcon c="#1B8168" />}
                title="Dodaj swój pierwszy termin"
                description="Załóż krąg i ustal pierwsze zajęcia — to pierwszy krok."
                ctaLabel="Zacznijmy →"
                onCtaClick={() => { setFirstTermForOrganizer(false); setModal("pierwszy-termin"); }}
                onDismiss={dismissFirstTermHint}
              />
            )}

            {!isOrganizer && !hintBecomeOrganizerDismissed && (
              <HintCard
                icon={<BuildingIcon c="#1B8168" />}
                title="Możesz zostać organizatorem"
                description="Załóż własny krąg, zapraszaj rodziny i planuj zajęcia — bez zakładania nowego konta."
                ctaLabel="Załóż krąg →"
                onCtaClick={() => { setFirstTermForOrganizer(false); setModal("pierwszy-termin"); }}
                onDismiss={dismissBecomeOrganizerHint}
              />
            )}

            {isOrganizer && !hintOrgPolishDismissed && (
              <HintCard
                icon={<BuildingIcon c="#1B8168" />}
                title="Dopracuj stronę organizacji"
                description="Dodaj opis, kolory i logo — zobaczą je odwiedzający Twój krąg."
                ctaLabel="Przejdź →"
                ctaTo={organizationSlug ? `/${organizationSlug}` : "/organization"}
                onDismiss={dismissOrgPolishHint}
              />
            )}

            {isOrganizer && terms.length === 0 && !hintOrgFirstTermDismissed && (
              <HintCard
                icon={<CalendarPlusIcon c="#1B8168" />}
                title="Dodaj swój pierwszy termin"
                description="Ustal pierwsze zajęcia w swoim kręgu."
                ctaLabel="Dodaj termin →"
                onCtaClick={() => {
                  setFirstTermForOrganizer(myGroups.length > 0);
                  setModal("pierwszy-termin");
                }}
                onDismiss={dismissOrgFirstTermHint}
              />
            )}

            <div className="rounded-[22px] border border-line bg-paper p-5">
              <div className="mb-3.5 flex items-center justify-between gap-2.5">
                <h3 className="text-base font-semibold text-ink">Najbliższe terminy</h3>
                <button onClick={() => setView("spotkania")} className="text-xs font-extrabold text-mint hover:underline">
                  Zobacz wszystkie
                </button>
              </div>
              {terms.length === 0 && (
                <div className="rounded-2xl border-[1.5px] border-dashed border-line py-[26px] text-center text-[13.5px] text-ink-soft">
                  Brak zaplanowanych terminów.
                </div>
              )}
              {terms.slice(0, 3).map(({ term, group, neededItems }) => {
                if (isOrganizer) {
                  return (
                    <div key={term.id} className="mt-2.5 first:mt-0">
                      {organizerTermCard(term, group, neededItems)}
                    </div>
                  );
                }
                const { day, month } = dayMonth(term.occurs_on);
                const time = termTime(term.occurs_on);
                return (
                  <div key={term.id} className="mt-2.5 first:mt-0">
                  <Link
                    to={termPublicPath(group, term.id)}
                    className="flex items-start gap-3.5 rounded-2xl border border-line bg-cream p-[15px] transition-colors hover:border-mint"
                  >
                    <div className="flex h-[46px] w-[46px] flex-none flex-col items-center justify-center rounded-[13px] bg-mint-soft leading-none">
                      <b className="font-serif text-base text-ink">{day}</b>
                      <small className="text-[9.5px] uppercase tracking-wide text-ink-soft">{month}</small>
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-[15.5px] font-semibold text-ink">{group.name}</h3>
                      <small className="mt-0.5 block text-[12.5px] text-ink-soft">
                        {time && <span className="font-bold text-ink">godz. {time}</span>}
                        {time && (term.description ? " · " : "")}
                        {term.description || (time ? "" : "Bez opisu")}
                      </small>
                      {neededItems.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {neededItems.map((ni) => (
                            <span key={ni.id} className="rounded-full bg-lime-soft px-2.5 py-0.5 text-[10.5px] font-extrabold text-[#56701F]">
                              {ni.product_name}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </Link>
                  </div>
                );
              })}
            </div>

            <div className="mt-3.5 rounded-[22px] border border-line bg-paper p-5">
              <h3 className="mb-3.5 text-base font-semibold text-ink">Zapisane zajęcia</h3>
              {myAttendances.length === 0 ? (
                <div className="rounded-2xl border-[1.5px] border-dashed border-line py-[26px] text-center text-[13.5px] text-ink-soft">
                  Nie zapisałeś się jeszcze na żadne zajęcia.
                </div>
              ) : (
                myAttendances.map((a) => {
                  const { day, month } = dayMonth(a.occurs_on);
                  return (
                    <Link
                      key={a.attendance_id}
                      to={`/${a.organizer_slug}/grupa/${a.group_id}/term/${a.term_id}`}
                      className="mt-2.5 flex items-start gap-3.5 rounded-2xl border border-line bg-cream p-[15px] transition-colors first:mt-0 hover:border-mint"
                    >
                      <div className="flex h-[46px] w-[46px] flex-none flex-col items-center justify-center rounded-[13px] bg-mint-soft leading-none">
                        <b className="font-serif text-base text-ink">{day}</b>
                        <small className="text-[9.5px] uppercase tracking-wide text-ink-soft">{month}</small>
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="text-[15.5px] font-semibold text-ink">{a.group_name}</h3>
                        <small className="mt-0.5 block text-[12.5px] text-ink-soft">
                          {termTime(a.occurs_on) && (
                            <span className="font-bold text-ink">godz. {termTime(a.occurs_on)}</span>
                          )}
                          {termTime(a.occurs_on) && a.organizer_display_name ? " · " : ""}
                          {a.organizer_display_name ?? ""}
                        </small>
                      </div>
                    </Link>
                  );
                })
              )}
            </div>

            <div className="mt-3.5 flex flex-col gap-3.5 rounded-[22px] border border-line bg-paper p-5">
              <h3 className="text-base font-semibold text-ink">Twoje rzeczy</h3>

              <div className="flex items-center justify-between gap-2.5">
                <span className="text-[11.5px] font-extrabold uppercase tracking-wide text-ink-soft">Dla innych</span>
                <button onClick={() => setView("rzeczy")} className="text-xs font-extrabold text-mint hover:underline">
                  Zobacz →
                </button>
              </div>
              <div className="flex gap-2.5">
                {ITEM_MODES.map((m) => {
                  const style = ITEM_MODE_STYLE[m];
                  return (
                    <div key={m} className="flex min-w-0 flex-1 flex-col items-start gap-1.5 rounded-2xl p-3.5" style={{ background: style.bg }}>
                      <span className="flex h-[30px] w-[30px] items-center justify-center rounded-[10px] bg-white/60">
                        <BoxIcon c={style.c} />
                      </span>
                      <b className="font-serif text-[27px] leading-none" style={{ color: style.c }}>{itemCounts[m]}</b>
                      <small className="text-[11.5px] font-extrabold" style={{ color: style.c }}>{capitalize(m)}</small>
                    </div>
                  );
                })}
              </div>

              <div className="h-px bg-line" />

              <div className="flex items-center justify-between gap-2.5">
                <span className="text-[11.5px] font-extrabold uppercase tracking-wide text-ink-soft">Od innych</span>
                <button onClick={() => setView("podarki")} className="text-xs font-extrabold text-mint hover:underline">
                  Zobacz →
                </button>
              </div>
              <div className="flex gap-2.5">
                {(["pożyczone", "otrzymane", "zamienione"] as GiftSource[]).map((s) => {
                  const style = GIFT_SOURCE_STYLE[s];
                  return (
                    <div key={s} className="flex min-w-0 flex-1 flex-col items-start gap-1.5 rounded-2xl p-3.5" style={{ background: style.bg }}>
                      <span className="flex h-[30px] w-[30px] items-center justify-center rounded-[10px] bg-white/60">
                        <GiftIcon c={style.c} />
                      </span>
                      <b className="font-serif text-[27px] leading-none" style={{ color: style.c }}>{giftCounts[s]}</b>
                      <small className="text-[11.5px] font-extrabold" style={{ color: style.c }}>{capitalize(s)}</small>
                    </div>
                  );
                })}
              </div>
            </div>
    </>
  );
}
