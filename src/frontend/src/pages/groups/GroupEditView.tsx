import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { useAppData } from "../../app/appDataStore";
import { GroupFormFields } from "../../components/panel/GroupFormFields";
import { SubPageHeader } from "../../components/shared/appComponents";
import { parseCapacity, viewPath } from "../../utils/appHelpers";

const TITLE = "Edytuj grupę";

/** `/groups/:groupId/edit`: name, layout template, visibility, default place
 * and capacity of a led group. The form is seeded from the group once per
 * id, so a silent reload never overwrites what is being typed; the form
 * state and the save (which then goes back to "Moje grupy") live in
 * AppDataContext. */
export function GroupEditView() {
  const { groupId = "" } = useParams();
  const {
    myGroups,
    editingGroupId,
    editGroupForm,
    editGroupError,
    busy,
    setEditGroupForm,
    startEditGroup,
    saveEditGroup,
  } = useAppData();
  const group = myGroups.find((g) => g.id === groupId) ?? null;
  const seeded = group !== null && editingGroupId === group.id;

  useEffect(() => {
    if (group && editingGroupId !== group.id) startEditGroup(group);
  }, [group, editingGroupId, startEditGroup]);

  const back = <SubPageHeader title={TITLE} backTo={viewPath("groups")} backLabel="Wróć do moich grup" />;
  if (!group) {
    return (
      <section aria-label={TITLE}>
        {back}
        <p className="rounded-[22px] border border-line bg-paper p-5 text-sm text-ink-soft">
          Nie znaleziono tej grupy wśród grup, które prowadzisz.
        </p>
      </section>
    );
  }

  const invalid = !editGroupForm.name.trim() || parseCapacity(editGroupForm.defaultCapacity) === undefined;
  return (
    <section aria-label={TITLE}>
      {back}
      {seeded && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy && !invalid) void saveEditGroup();
          }}
          className="rounded-[22px] border border-line bg-paper p-5"
        >
          <GroupFormFields
            value={editGroupForm}
            onChange={setEditGroupForm}
            showLayoutMode
            idPrefix="edit-group"
            fallbackLocation={group.default_location}
          />
          {editGroupError && (
            <p role="alert" className="mt-2 text-[12.5px] font-semibold text-danger">
              {editGroupError}
            </p>
          )}
          <button
            type="submit"
            disabled={busy || invalid}
            className="mt-4 w-full rounded-[13px] bg-mint px-5 py-3 text-[13.5px] font-extrabold text-white disabled:opacity-60"
          >
            Zapisz
          </button>
        </form>
      )}
    </section>
  );
}
