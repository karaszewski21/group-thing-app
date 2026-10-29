import { useState } from "react";
import { useAppData } from "../../app/appDataStore";
import { Field, INPUT_CLASS } from "../../components/shared/appComponents";
import { FamilyNotice, FamilySubPage, FormError, SubmitButton } from "./familyPages";
import { useBackToFamily } from "./useBackToFamily";

const TITLE = "Edytuj rodzinę";

/** `/family/edit`: the family name, seeded once on entry so a silent reload
 * never overwrites what is being typed. */
export function FamilyEditView() {
  const { family, busy, saveRenameFamily } = useAppData();
  const { backToFamily } = useBackToFamily();
  const [name, setName] = useState(family?.name ?? "");
  const [error, setError] = useState<string | null>(null);

  if (!family) {
    return (
      <FamilySubPage title={TITLE}>
        <FamilyNotice>Nie masz jeszcze rodziny.</FamilyNotice>
      </FamilySubPage>
    );
  }

  const next = name.trim();
  async function submit() {
    if (busy || !next) return;
    if (next === family?.name) {
      backToFamily();
      return;
    }
    const failure = await saveRenameFamily(next);
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
        <Field label="Nazwa rodziny">
          <input
            aria-label="Nazwa rodziny"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={INPUT_CLASS}
          />
        </Field>
        <FormError message={error} />
        <SubmitButton disabled={busy || !next}>
          Zapisz
        </SubmitButton>
      </form>
    </FamilySubPage>
  );
}
