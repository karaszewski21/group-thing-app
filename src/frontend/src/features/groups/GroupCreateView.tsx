import { useAppData } from "../panel/appDataStore";
import { GroupFormFields, isDescriptionTooLong } from "./GroupFormFields";
import { parseCapacity } from "../../utils/appHelpers";

const TITLE = "Nowa grupa";

/** `/groups/new`: a new group, the first one included ("Załóż grupę"
 * links from Start, /add and /add/term lead here too). The form state and
 * the save (which then goes back to "Moje grupy") live in AppDataContext. */
export function GroupCreateView() {
  const { groupForm, setGroupForm, addGroupError, busy, handleAddGroup } = useAppData();
  const invalid = !groupForm.name.trim() || parseCapacity(groupForm.defaultCapacity) === undefined ||
    isDescriptionTooLong(groupForm.description);

  return (
    <section aria-label={TITLE}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy && !invalid) void handleAddGroup();
        }}
        className="rounded-[22px] border border-line bg-paper p-5"
      >
        {addGroupError && (
          <p role="alert" className="mb-3 rounded-2xl bg-danger-soft px-3.5 py-3 text-[14px] font-bold text-danger">
            {addGroupError}
          </p>
        )}
        <GroupFormFields value={groupForm} onChange={setGroupForm} idPrefix="add-group" />
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
