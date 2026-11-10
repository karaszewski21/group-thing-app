import { useEffect, useRef } from "react";
import type { NeededItemResponse } from "../../api/terms";
import { useAppNavigate, useAppParams } from "../../routing/navigation";
import { useNeededItems } from "../../hooks/useNeededItems";
import { useTerm } from "../../hooks/useTerm";
import { useAppData } from "../panel/appDataStore";
import { TermEditForm } from "./TermEditForm";
import { termEditDraftFrom } from "./termDraft";
import { viewPath } from "../../routing/paths";

const TITLE = "Edytuj termin";
const NO_NEEDED_ITEMS: NeededItemResponse[] = [];

/** `/terms/:termId/edit`: date, description, place, capacity and needed items
 * of a term in a group the caller leads. The term is read by id, and each
 * `load({ silent: true })` invalidates it, refreshing the form's props. The
 * typed values live in AppDataContext (`termEdit`, seeded once per term) so
 * the place picker's trip to /places/new keeps them; saving or "Anuluj"
 * clears them and goes back to "Spotkania". */
export function TermEditView() {
  const { termId = "" } = useAppParams();
  const navigate = useAppNavigate();
  const { myGroups, load, showToast, termEdit, setTermEdit } = useAppData();
  const { term, loading } = useTerm(termId, { enabled: termId !== "" });
  const editable = term !== null && myGroups.some((g) => g.id === term.group_id);
  const { data: neededItems, refetch: refetchNeededItems } = useNeededItems(editable ? [termId] : []);
  const draft = termEdit?.termId === termId ? termEdit.draft : null;
  // Set on save/cancel: the cleared draft must not be re-seeded (from the
  // not yet reloaded term) while the page is still mounted.
  const leaving = useRef(false);

  useEffect(() => {
    if (leaving.current || !editable || termEdit?.termId === termId) return;
    setTermEdit({ termId, draft: termEditDraftFrom(term) });
  }, [editable, term, termEdit, termId, setTermEdit]);

  return (
    <section aria-label={TITLE}>
      {editable ? (
        <div className="rounded-[22px] border border-line bg-paper p-5">
          {draft && (
            <TermEditForm
              term={term}
              draft={draft}
              onDraftChange={(next) => setTermEdit({ termId, draft: next })}
              neededItems={neededItems.get(termId) ?? NO_NEEDED_ITEMS}
              onChanged={() => {
                void load({ silent: true });
                void refetchNeededItems();
              }}
              onDone={(saved) => {
                leaving.current = true;
                setTermEdit(null);
                if (saved) showToast("Zapisano termin");
                navigate(viewPath("meetings"));
              }}
            />
          )}
        </div>
      ) : (
        <p className="rounded-[22px] border border-line bg-paper p-5 text-sm text-ink-soft">
          {loading ? "Wczytywanie terminu…" : "Nie znaleziono tego terminu wśród Twoich terminów."}
        </p>
      )}
    </section>
  );
}
