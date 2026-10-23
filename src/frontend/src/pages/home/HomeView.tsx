import { Link } from "react-router-dom";
import { BuildingIcon, CalendarPlusIcon, GiftIcon } from "../../components/shared/appIcons";
import { HintCard, ItemTile } from "../../components/shared/appComponents";
import { capitalize, ITEM_MODE_TONE, ITEM_MODES, viewPath } from "../../utils/appHelpers";
import { MOCK_RECENT_ITEMS } from "../../utils/mocks";
import { useAppData } from "../../app/appDataStore";

const SECTION_TITLE = "font-serif text-[21px] font-bold text-ink";
const SECTION_LINK = "text-sm font-extrabold text-primary-fg hover:underline";
const CARD = "rounded-[22px] border border-line bg-paper";

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
    items,
    itemCounts,
    borrowedItems,
    setView,
    setModal,
    setFirstTermForOrganizer,
    dismissCreateGroupHint,
    dismissCreateOrgHint,
    dismissOrgFirstTermHint,
    dismissOrgPolishHint,
  } = useAppData();

  if (!profile) return null;

  const hasGroups = myGroups.length > 0;

  return (
    <>
      <h1 className="mb-5 truncate text-[17px] font-semibold text-ink">
        Witaj, <b className="font-extrabold">{profile.display_name.split(" ")[0]}</b>
      </h1>

      <section>
        <div className="mb-2.5 flex items-baseline justify-between gap-2.5">
          <h2 className={SECTION_TITLE}>Twoje rzeczy</h2>
          {items.length > 0 && (
            <button onClick={() => setView("rzeczy")} className={SECTION_LINK}>
              Zobacz →
            </button>
          )}
        </div>
        {items.length === 0 ? (
          <div className={`${CARD} flex flex-col items-center gap-2.5 border-dashed px-5 py-6 text-center`}>
            <p className="text-[17px] font-extrabold text-ink">Nie masz jeszcze żadnych rzeczy</p>
            <p className="max-w-68 text-sm leading-snug text-ink-soft">
              Dodaj coś, co możesz wypożyczyć, oddać albo zamienić z innymi rodzicami.
            </p>
            <Link
              to="/product/new"
              className="mt-1 flex min-h-12 items-center rounded-full bg-primary px-5.5 text-[15px] font-extrabold text-on-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            >
              + Dodaj pierwszą rzecz
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2.5">
            {ITEM_MODES.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setView("rzeczy")}
                className={`flex flex-col items-start rounded-[20px] p-3.5 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring ${ITEM_MODE_TONE[m]}`}
              >
                <b className="font-serif text-[30px] leading-none font-extrabold">{itemCounts[m]}</b>
                <small className="mt-1 text-[13px] font-extrabold">{capitalize(m)}</small>
              </button>
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={() => setView("podarki")}
          className={`${CARD} mt-2.5 flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors hover:border-line-strong`}
        >
          <span className="flex h-10 w-10 flex-none items-center justify-center rounded-[14px] bg-cream text-ink">
            <GiftIcon c="currentColor" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-extrabold text-ink">Wypożyczone</span>
            <span className="block text-[13px] text-ink-soft">
              {borrowedItems.length === 0 ? "Teraz nic nie pożyczasz od innych." : "Rzeczy pożyczone od innych"}
            </span>
          </span>
          <span className="font-serif text-[22px] font-extrabold text-ink-soft">{borrowedItems.length}</span>
        </button>
      </section>

      <section className="mt-7">
        <div className="mb-1 flex items-baseline justify-between gap-2.5">
          <h2 className={SECTION_TITLE}>Ostatnio dodane</h2>
          <Link to={viewPath("szukaj")} className={SECTION_LINK}>
            Przeglądaj
          </Link>
        </div>
        <p className="mb-2.5 text-sm text-ink-soft">Rzeczy od innych z Twoich grup i okolicy</p>
        <div className="grid grid-cols-2 gap-3">
          {MOCK_RECENT_ITEMS.map((item) => (
            <ItemTile key={item.id} name={item.name} owner={item.owner} mode={item.mode} note={item.addedAgo} />
          ))}
        </div>
      </section>

      <div className="mt-7">
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
      </div>
    </>
  );
}
