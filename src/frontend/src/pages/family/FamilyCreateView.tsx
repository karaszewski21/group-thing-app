import { useState } from "react";
import { useAppData } from "../../app/appDataStore";
import { Field, INPUT_CLASS } from "../../components/shared/appComponents";
import { FamilyNotice, FamilySubPage, FormError, SubmitButton } from "./familyPages";
import { useBackToFamily } from "./useBackToFamily";

const TITLE = "Nowa rodzina";

/** `/family/new` ("Załóż rodzinę"): the family name; members are added
 * afterwards from "Mój dom". */
export function FamilyCreateView() {
  const { family, busy, handleCreateFamily } = useAppData();
  const { backToFamily } = useBackToFamily();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const invalid = !name.trim();

  async function submit() {
    if (busy || invalid) return;
    const failure = await handleCreateFamily(name.trim());
    if (failure) setError(failure);
    else backToFamily();
  }

  return (
    <FamilySubPage title={TITLE}>
      {family !== null ? (
        <FamilyNotice>Masz już rodzinę „{family.name}”.</FamilyNotice>
      ) : (
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
              placeholder="np. Kowalscy"
              className={INPUT_CLASS}
            />
          </Field>
          <FormError message={error} />
          <SubmitButton disabled={busy || invalid}>
            Załóż rodzinę
          </SubmitButton>
        </form>
      )}
    </FamilySubPage>
  );
}
