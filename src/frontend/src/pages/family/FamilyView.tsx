import { Link, useLocation, useSearchParams } from "react-router-dom";
import type { GuardianResponse } from "../../api/families";
import { approxAge, formatApproxAge } from "../../utils/age";
import { familyMemberEditPath, viewPath } from "../../utils/appHelpers";
import { isSafeReturnPath } from "../../utils/url";
import { BackIcon, PencilIcon, TrashIcon } from "../../components/shared/appIcons";
import { useAppData } from "../../app/appDataStore";

const ADD_BUTTON =
  "flex min-h-10 flex-none items-center rounded-full border-[1.5px] border-line bg-paper px-3.5 text-sm font-extrabold text-ink hover:border-line-strong";
const ROW_BUTTON =
  "flex h-9 w-9 flex-none items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-paper hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

function ReturnToTermButton() {
  const [searchParams] = useSearchParams();
  const returnTo = searchParams.get("returnTo");
  if (!isSafeReturnPath(returnTo)) return null;
  return (
    <div className="mt-7">
      <Link
        to={returnTo}
        className="inline-flex w-full items-center justify-center gap-1.5 rounded-[13px] border-[1.5px] border-line px-5 py-2.5 text-[13px] font-extrabold text-ink-soft no-underline hover:border-mint hover:text-mint"
      >
        <BackIcon />
        Wróć do terminu
      </Link>
    </div>
  );
}

function roleLabel(g: GuardianResponse, selfPartyId: string): string {
  if (g.party_id === selfPartyId) return "(Ty)";
  return g.role_type === "CHILD" ? "(dziecko)" : "(opiekun)";
}

/** `/family` ("Mój dom"): the caller's family and its members, with links to
 * founding it, renaming it and adding or editing members (own pages, like
 * "Moje grupy"). A `?returnTo=` term link is carried to those pages and back. */
export function FamilyView() {
  const { profile, family, guardians, familyMemberError, busy, handleRemoveFamilyMember } = useAppData();
  const { search } = useLocation();

  if (!profile) return null;

  if (family === null) {
    return (
      <div>
        <div className="mb-3.5">
          <h2 className="text-[19px] font-semibold text-ink">Mój dom</h2>
        </div>
        <div className="rounded-2xl border-[1.5px] border-dashed border-line p-6 text-center">
          <p className="text-[15px] font-semibold text-ink">Nie masz jeszcze rodziny</p>
          <p className="mt-1.5 text-[13.5px] text-ink-soft">
            Załóż rodzinę, aby dodać opiekunów i dzieci oraz wspólnie zapisywać się na zajęcia.
          </p>
          <Link
            to={{ pathname: viewPath("family/new"), search }}
            className="mt-4 inline-block rounded-[13px] bg-mint px-5 py-3 text-[13.5px] font-extrabold text-white"
          >
            Załóż rodzinę
          </Link>
        </div>
        <ReturnToTermButton />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3.5 flex items-start justify-between gap-2.5">
        <div className="min-w-0">
          <h2 className="text-[19px] font-semibold text-ink">Mój dom</h2>
          <div className="mt-1.5 flex items-center gap-1">
            <h3 className="text-[15.5px] font-semibold wrap-break-word text-ink">{family.name}</h3>
            <Link
              to={{ pathname: viewPath("family/edit"), search }}
              aria-label="Zmień nazwę rodziny"
              className={ROW_BUTTON}
            >
              <PencilIcon />
            </Link>
          </div>
          <small className="block text-[12.5px] text-ink-soft">
            {guardians.length} {guardians.length === 1 ? "osoba" : "osoby"}
          </small>
        </div>
        <Link to={{ pathname: viewPath("family/members/new"), search }} className={ADD_BUTTON}>
          + Dodaj członka
        </Link>
      </div>
      <div className="rounded-[22px] border border-line bg-paper p-5">
        {guardians.length === 0 && (
          <div className="rounded-2xl border-[1.5px] border-dashed border-line py-[26px] text-center text-[13.5px] text-ink-soft">
            Nie masz jeszcze żadnych członków rodziny.
          </div>
        )}
        {guardians.map((g) => (
          <div
            key={g.family_membership_id}
            className="mt-2.5 flex items-center gap-2 rounded-2xl border border-line bg-cream p-[15px] first:mt-0"
          >
            <div className="min-w-0 flex-1">
              <h3 className="text-[15.5px] font-semibold text-ink">
                {g.display_name}
                <span className="ml-1.5 text-ink-soft">{roleLabel(g, profile.party_id)}</span>
              </h3>
              {g.role_type === "CHILD" && (
                <p className="mt-0.5 text-[12.5px] text-ink-soft">
                  {g.birth_year === null
                    ? "Bez roku urodzenia"
                    : `rocznik ${g.birth_year} · ${formatApproxAge(approxAge(g.birth_year))}`}
                </p>
              )}
            </div>
            {g.role_type === "CHILD" && (
              <Link
                to={{ pathname: familyMemberEditPath(g.family_membership_id), search }}
                aria-label={`Edytuj członka rodziny ${g.display_name}`}
                className={ROW_BUTTON}
              >
                <PencilIcon />
              </Link>
            )}
            {g.party_id !== profile.party_id && (
              <button
                type="button"
                onClick={() => void handleRemoveFamilyMember(g)}
                disabled={busy}
                aria-label={`Usuń członka rodziny ${g.display_name}`}
                className={`${ROW_BUTTON} hover:text-danger disabled:opacity-60`}
              >
                <TrashIcon />
              </button>
            )}
          </div>
        ))}
        {familyMemberError && (
          <p role="alert" className="mt-2.5 text-[12.5px] font-semibold text-danger">
            {familyMemberError}
          </p>
        )}
      </div>

      <ReturnToTermButton />
    </div>
  );
}
