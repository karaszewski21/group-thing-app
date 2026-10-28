import { Link } from "react-router-dom";
import { useMyOrganization } from "../../hooks/useMyOrganization";
import { pluralPl } from "../../utils/plural";
import { ListCard } from "../../components/shared/appComponents";
import { BuildingIcon, LogoutIcon } from "../../components/shared/appIcons";
import { viewPath } from "../../utils/appHelpers";
import { MOCK_WANTS } from "../../utils/mocks";
import { useAppData } from "../../app/appDataStore";
import { ProfileView } from "../profile/ProfileView";

const SECTION_LABEL = "mb-2.5 text-[13px] font-extrabold tracking-[.12em] text-ink-soft uppercase";

export function AccountView() {
  const { organizationSlug, items, logout } = useAppData();
  const { data: organization } = useMyOrganization();

  return (
    <>
      <h1 className="mb-5 font-serif text-[30px] leading-tight font-extrabold tracking-tight text-ink">Konto</h1>

      <section aria-labelledby="konto-profil">
        <h2 id="konto-profil" className={SECTION_LABEL}>
          Profil
        </h2>
        <ProfileView />
        <div className="mt-2.5">
          <ListCard
            rows={[
              { label: "Lokalizacja", meta: "Moje miejsca", to: viewPath("places") },
              { label: "Mój dom", to: viewPath("family") },
            ]}
          />
        </div>
      </section>

      <section aria-labelledby="konto-organizacja" className="mt-6">
        <h2 id="konto-organizacja" className={SECTION_LABEL}>
          Moja organizacja
        </h2>
        {organizationSlug === null ? (
          <div className="flex flex-col gap-3 rounded-3xl border-[1.5px] border-dashed border-line-strong bg-paper p-5">
            <div className="flex items-center gap-3.5">
              <span className="flex h-13 w-13 flex-none items-center justify-center rounded-[18px] bg-accent-soft text-accent-fg">
                <BuildingIcon c="currentColor" />
              </span>
              <span>
                <span className="block text-[17px] font-extrabold text-ink">Nie masz jeszcze organizacji</span>
                <span className="block text-sm leading-snug text-ink-soft">
                  Prowadzisz zajęcia albo grupę wymiany? Załóż własną stronę.
                </span>
              </span>
            </div>
            <Link
              to="/organization"
              className="flex min-h-12 items-center justify-center rounded-full bg-primary text-[15px] font-extrabold text-on-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            >
              Załóż organizację
            </Link>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            <Link
              to={`/${organizationSlug}`}
              className="flex items-center gap-3.5 rounded-3xl bg-primary p-4 text-on-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            >
              <span className="flex h-13 w-13 flex-none items-center justify-center rounded-[18px] bg-paper text-primary-fg">
                <BuildingIcon c="currentColor" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-serif text-[19px] font-extrabold">
                  {organization?.name ?? organizationSlug}
                </span>
                <span className="block text-[13px] opacity-90">Zobacz stronę</span>
              </span>
            </Link>
            <ListCard
              rows={[
                { label: "Wygląd strony", to: `/${organizationSlug}?edit=1` },
                { label: "Dane organizacji", to: "/organization" },
                { label: "Grupy i terminy", to: viewPath("meetings") },
              ]}
            />
          </div>
        )}
      </section>

      <section aria-labelledby="konto-rzeczy" className="mt-6">
        <h2 id="konto-rzeczy" className={SECTION_LABEL}>
          Moje rzeczy
        </h2>
        <ListCard
          rows={[
            { label: "Moje rzeczy", meta: items.length > 0 ? String(items.length) : "brak", to: viewPath("items") },
            {
              label: "Szukam",
              meta: `${MOCK_WANTS.length} ${pluralPl(MOCK_WANTS.length, "rzecz", "rzeczy", "rzeczy")}`,
              to: viewPath("wanted"),
            },
          ]}
        />
      </section>

      <section aria-labelledby="konto-ustawienia" className="mt-6">
        <h2 id="konto-ustawienia" className={SECTION_LABEL}>
          Ustawienia
        </h2>
        <ListCard rows={[{ label: "Prywatność", to: viewPath("settings") }]} />
      </section>

      <button
        type="button"
        onClick={logout}
        className="mt-6 flex min-h-13 w-full items-center justify-center gap-2 rounded-full border-[1.5px] border-line bg-paper text-base font-extrabold text-danger hover:bg-danger-soft"
      >
        <LogoutIcon /> Wyloguj się
      </button>
    </>
  );
}
