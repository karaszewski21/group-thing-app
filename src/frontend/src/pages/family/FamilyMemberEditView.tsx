import { useState } from "react";
import { useParams } from "react-router-dom";
import type { GuardianResponse } from "../../api/families";
import { useAppData } from "../../app/appDataStore";
import { birthYearError } from "../../utils/age";
import { BirthYearField } from "./BirthYearField";
import { FamilyNotice, FamilySubPage, FormError, SubmitButton } from "./familyPages";
import { useBackToFamily } from "./useBackToFamily";

const TITLE = "Edytuj członka rodziny";

/** `/family/members/:familyMembershipId/edit`: a child's birth year, the
 * only member detail the API lets the family change. */
export function FamilyMemberEditView() {
  const { familyMembershipId = "" } = useParams();
  const { guardians } = useAppData();
  const member = guardians.find((g) => g.family_membership_id === familyMembershipId && g.role_type === "CHILD");

  return (
    <FamilySubPage title={TITLE}>
      {member ? (
        <ChildBirthYearForm key={member.family_membership_id} member={member} />
      ) : (
        <FamilyNotice>Nie znaleziono tego dziecka w Twojej rodzinie.</FamilyNotice>
      )}
    </FamilySubPage>
  );
}

function ChildBirthYearForm({ member }: { member: GuardianResponse }) {
  const { busy, saveChildBirthYear } = useAppData();
  const { backToFamily } = useBackToFamily();
  const [birthYear, setBirthYear] = useState(member.birth_year === null ? "" : String(member.birth_year));
  const [error, setError] = useState<string | null>(null);
  const invalid = birthYearError(birthYear) !== null;

  async function submit() {
    if (busy || invalid) return;
    const next = birthYear.trim() ? Number(birthYear) : null;
    if (next === member.birth_year) {
      backToFamily();
      return;
    }
    const failure = await saveChildBirthYear(member, next);
    if (failure) setError(failure);
    else backToFamily();
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="rounded-[22px] border border-line bg-paper p-5"
    >
      <h2 className="mb-3 text-[15.5px] font-semibold text-ink">{member.display_name}</h2>
      <BirthYearField
        value={birthYear}
        onChange={(raw) => {
          setBirthYear(raw);
          setError(null);
        }}
      />
      <FormError message={error} />
      <SubmitButton disabled={busy || invalid}>
        Zapisz
      </SubmitButton>
    </form>
  );
}
