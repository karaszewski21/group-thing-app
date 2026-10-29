import { useNavigate, useParams } from "react-router-dom";
import { useAppData } from "../../app/appDataStore";
import { TermEditForm } from "../../components/panel/TermEditForm";
import { SubPageHeader } from "../../components/shared/appComponents";
import { viewPath } from "../../utils/appHelpers";

const TITLE = "Edytuj termin";

/** `/terms/:termId/edit`: date, description, place, capacity and needed items
 * of a term in a group the caller leads. The term comes from the panel's live
 * `terms`, so each `load({ silent: true })` refreshes the form's props; after
 * saving, back to "Spotkania". */
export function TermEditView() {
  const { termId = "" } = useParams();
  const navigate = useNavigate();
  const { terms, myGroups, load, showToast } = useAppData();
  const entry = terms.find((t) => t.term.id === termId) ?? null;
  const editable = entry !== null && myGroups.some((g) => g.id === entry.term.circle_group_id);

  return (
    <section aria-label={TITLE}>
      <SubPageHeader title={TITLE} backTo={viewPath("meetings")} backLabel="Wróć do spotkań" />
      {editable ? (
        <div className="rounded-[22px] border border-line bg-paper p-5">
          <TermEditForm
            term={entry.term}
            neededItems={entry.neededItems}
            onChanged={() => void load({ silent: true })}
            onDone={(saved) => {
              if (saved) showToast("Zapisano termin");
              navigate(viewPath("meetings"));
            }}
          />
        </div>
      ) : (
        <p className="rounded-[22px] border border-line bg-paper p-5 text-sm text-ink-soft">
          Nie znaleziono tego terminu wśród Twoich terminów.
        </p>
      )}
    </section>
  );
}
