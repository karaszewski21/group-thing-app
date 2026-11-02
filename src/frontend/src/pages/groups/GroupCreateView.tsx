import { useAppData } from "../../app/appDataStore";
import { GroupFormFields } from "../../components/panel/GroupFormFields";
import { SubPageHeader } from "../../components/shared/appComponents";
import { parseCapacity, viewPath } from "../../utils/appHelpers";

const TITLE = "Nowa grupa";

/** `/groups/new`: a new group, the first one included ("Załóż grupę"
 * links from Start, /add and /add/term lead here too). The form state and
 * the save (which then goes back to "Moje grupy") live in AppDataContext. */
export function GroupCreateView() {
  const { groupForm, setGroupForm, addGroupError, busy, handleAddGroup } = useAppData();
  const invalid = !groupForm.name.trim() || parseCapacity(groupForm.defaultCapacity) === undefined;

  return (
    <section aria-label={TITLE}>
      <SubPageHeader title={TITLE} backTo={viewPath("groups")} backLabel="Wróć do moich grup" />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy && !invalid) void handleAddGroup();
        }}
        className="rounded-[22px] border border-line bg-paper p-5"
      >
        <GroupFormFields value={groupForm} onChange={setGroupForm} idPrefix="add-group" />
        {addGroupError && (
          <p role="alert" className="mt-2 text-[12.5px] font-semibold text-danger">
            {addGroupError}
          </p>
        )}
        <button
          type="submit"
          disabled={busy || invalid}
          className="mt-4 w-full rounded-[13px] bg-mint px-5 py-3 text-[13.5px] font-extrabold text-white disabled:opacity-60"
        >
          Dodaj grupę
        </button>
      </form>
    </section>
  );
}
