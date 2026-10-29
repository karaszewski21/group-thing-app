import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { BuildingIcon, CalendarPlusIcon } from "../../components/shared/appIcons";
import { HintCard, ItemTile } from "../../components/shared/appComponents";
import { capitalize, ITEM_MODE_TONE, ITEM_MODES, viewPath } from "../../utils/appHelpers";
import { MOCK_RECENT_ITEMS } from "../../utils/mocks";
import { useAppData } from "../../app/appDataStore";

const SECTION_TITLE = "font-serif text-[21px] font-bold text-ink";
const SECTION_LINK = "text-sm font-extrabold text-primary-fg hover:underline";
const CARD = "rounded-[22px] border border-line bg-paper";

/** The `localStorage` key of a home hint's "dismissed" flag for one account. */
function hintKey(flag: string, username: string | null): string {
  return `${flag}:${username ?? ""}`;
}

/** A dismissible banner's flag: read once on mount, written on dismiss. */
function useDismissibleHint(storageKey: string): [boolean, () => void] {
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(storageKey) === "1");
  function dismiss() {
    localStorage.setItem(storageKey, "1");
    setDismissed(true);
  }
  return [dismissed, dismiss];
}

export function HomeView() {
  const { profile, organizationSlug, terms, myGroups, items, itemModes, setView, setModal } = useAppData();
  const { username } = useAuth();
  // Dismissed flags are per account (`hintKey`): a browser shared by several
  // accounts never hides a new account's hints because another dismissed them.
  //  - "Załóż grupę": no led group yet
  //  - "Stwórz wizytówkę": groups but no Organization
  //  - "Dopracuj stronę organizacji": groups and an Organization
  //  - "Dodaj swój pierwszy termin": groups but no term
  const [hintCreateGroupDismissed, dismissCreateGroupHint] = useDismissibleHint(
    hintKey("hint_create_group_dismissed", username),
  );
  const [hintCreateOrgDismissed, dismissCreateOrgHint] = useDismissibleHint(
    hintKey("hint_create_org_dismissed", username),
  );
  const [hintOrgFirstTermDismissed, dismissOrgFirstTermHint] = useDismissibleHint(
    hintKey("hint_org_first_term_dismissed", username),
  );
  const [hintOrgPolishDismissed, dismissOrgPolishHint] = useDismissibleHint(
    hintKey("hint_org_polish_dismissed", username),
  );
  const itemCounts = {
    oddam: items.filter((i) => itemModes[i.id] === "oddam").length,
    zamienię: items.filter((i) => itemModes[i.id] === "zamienię").length,
  };

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
            <button onClick={() => setView("items")} className={SECTION_LINK}>
              Zobacz →
            </button>
          )}
        </div>
        {items.length === 0 ? (
          <div className={`${CARD} flex flex-col items-center gap-2.5 border-dashed px-5 py-6 text-center`}>
            <p className="text-[17px] font-extrabold text-ink">Nie masz jeszcze żadnych rzeczy</p>
            <p className="max-w-68 text-sm leading-snug text-ink-soft">
              Dodaj coś, co możesz oddać albo zamienić z innymi rodzicami.
            </p>
            <Link
              to="/add/product"
              className="mt-1 flex min-h-12 items-center rounded-full bg-primary px-5.5 text-[15px] font-extrabold text-on-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            >
              + Dodaj pierwszą rzecz
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2.5">
            {ITEM_MODES.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setView("items")}
                className={`flex flex-col items-start rounded-[20px] p-3.5 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring ${ITEM_MODE_TONE[m]}`}
              >
                <b className="font-serif text-[30px] leading-none font-extrabold">{itemCounts[m]}</b>
                <small className="mt-1 text-[13px] font-extrabold">{capitalize(m)}</small>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="mt-7">
        <div className="mb-1 flex items-baseline justify-between gap-2.5">
          <h2 className={SECTION_TITLE}>Ostatnio dodane</h2>
          <Link to={viewPath("search")} className={SECTION_LINK}>
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
            ctaTo={viewPath("groups/new")}
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
              setModal("pierwszy-termin");
            }}
            onDismiss={dismissOrgFirstTermHint}
          />
        )}
      </div>
    </>
  );
}
