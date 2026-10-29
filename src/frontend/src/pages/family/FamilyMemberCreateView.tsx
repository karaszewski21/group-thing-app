import { useState } from "react";
import { useAppData } from "../../app/appDataStore";
import { Field, INPUT_CLASS } from "../../components/shared/appComponents";
import { birthYearError } from "../../utils/age";
import type { NewFamilyMember } from "../../utils/appHelpers";
import { BirthYearField } from "./BirthYearField";
import { FamilyNotice, FamilySubPage, FormError, SubmitButton } from "./familyPages";
import { useBackToFamily } from "./useBackToFamily";

const TITLE = "Nowy członek rodziny";
const ROLES: { id: NewFamilyMember["roleType"]; label: string }[] = [
  { id: "GUARDIAN", label: "Opiekun" },
  { id: "CHILD", label: "Dziecko" },
];

/** `/family/members/new`: a guardian or a child (with an optional birth year)
 * added to the caller's family. */
export function FamilyMemberCreateView() {
  const { family, busy, handleAddFamilyMember } = useAppData();
  const { backToFamily } = useBackToFamily();
  const [name, setName] = useState("");
  const [roleType, setRoleType] = useState<NewFamilyMember["roleType"]>("GUARDIAN");
  // Raw input text; only sent (as a number) for a CHILD.
  const [birthYear, setBirthYear] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!family) {
    return (
      <FamilySubPage title={TITLE}>
        <FamilyNotice>Najpierw załóż rodzinę.</FamilyNotice>
      </FamilySubPage>
    );
  }

  const isChild = roleType === "CHILD";
  const invalid = !name.trim() || (isChild && birthYearError(birthYear) !== null);

  async function submit() {
    if (busy || invalid) return;
    const failure = await handleAddFamilyMember({
      name: name.trim(),
      roleType,
      birthYear: isChild && birthYear.trim() ? Number(birthYear) : null,
    });
    if (failure) setError(failure);
    else backToFamily();
  }

  return (
    <FamilySubPage title={TITLE}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="rounded-[22px] border border-line bg-paper p-5"
      >
        <div className="grid grid-cols-1 gap-3">
          <Field label="Imię i nazwisko">
            <input
              aria-label="Imię i nazwisko"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="np. Zosia Kowalska"
              className={INPUT_CLASS}
            />
          </Field>
          <Field label="Rola">
            <div className="flex gap-2">
              {ROLES.map((role) => (
                <button
                  key={role.id}
                  type="button"
                  onClick={() => {
                    setRoleType(role.id);
                    if (role.id === "GUARDIAN") setBirthYear("");
                  }}
                  aria-pressed={roleType === role.id}
                  className={`flex-1 rounded-xl border-[1.5px] px-3 py-2.5 text-sm font-bold transition ${
                    roleType === role.id ? "border-mint bg-mint-soft text-mint" : "border-line bg-cream text-ink-soft"
                  }`}
                >
                  {role.label}
                </button>
              ))}
            </div>
          </Field>
          {isChild && <BirthYearField value={birthYear} onChange={setBirthYear} />}
        </div>
        <FormError message={error} />
        <SubmitButton disabled={busy || invalid}>
          Dodaj
        </SubmitButton>
      </form>
    </FamilySubPage>
  );
}
