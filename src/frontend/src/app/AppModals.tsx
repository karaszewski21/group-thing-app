import { CreateFamilyDialog } from "../components/panel/CreateFamilyDialog";
import { EditTermDialog } from "../components/panel/EditTermDialog";
import { CreateGroupStepper } from "../components/panel/CreateGroupStepper";
import { FirstTermStepperOrganizer } from "../components/panel/FirstTermStepperOrganizer";
import { GroupFormFields } from "../components/panel/GroupFormFields";
import { ModalSheet } from "../components/shared/appComponents";
import { parseCapacity } from "../utils/appHelpers";
import { useAppData } from "./appDataStore";

/** The Panel's modal layer — one `{modal === "..." && ...}` block per modal
 * kind, rendered above the views/nav. Reads `useAppData()` for the form
 * state + handlers. */
export function AppModals() {
  const {
    modal,
    firstTermForOrganizer,
    myGroups,
    organizationSlug,
    editTermEntry,
    editingGroupId,
    groupForm,
    editGroupForm,
    editGroupError,
    addGroupError,
    busy,
    setModal,
    setEditTermId,
    setGroupForm,
    setEditGroupForm,
    showToast,
    load,
    handleAddGroup,
    cancelEditGroup,
    saveEditGroup,
  } = useAppData();

  const createGroupStepper = (
    <CreateGroupStepper
      organizationSlug={organizationSlug}
      onClose={() => setModal(null)}
      onCircleCreated={() => void load({ silent: true })}
      onDone={() => {
        setModal(null);
        showToast("Grupa założona — dodano pierwszy termin");
        void load();
      }}
    />
  );
  const editingGroup = myGroups.find((g) => g.id === editingGroupId) ?? null;

  return (
    <>
      {/* ---------- modal: załóż grupę (group -> first term) ---------- */}
      {modal === "zaloz-grupe" && createGroupStepper}

      {/* ---------- modal: dodaj pierwszy termin (led group without terms) ---------- */}
      {modal === "pierwszy-termin" &&
        (firstTermForOrganizer && myGroups.length > 0 ? (
          <FirstTermStepperOrganizer
            circleGroupId={myGroups[0]?.id ?? null}
            organizerSlug={myGroups[0]?.organizer_slug ?? null}
            defaultLocation={myGroups[0]?.default_location ?? null}
            defaultCapacity={myGroups[0]?.default_capacity ?? null}
            onClose={() => setModal(null)}
            onDone={() => {
              setModal(null);
              showToast("Dodano pierwszy termin");
              void load();
            }}
          />
        ) : (
          createGroupStepper
        ))}

      {/* ---------- modal: załóż rodzinę ---------- */}
      {modal === "rodzina-nowa" && (
        <CreateFamilyDialog
          onClose={() => setModal(null)}
          onCreated={() => {
            setModal(null);
            showToast("Rodzina utworzona");
            void load({ silent: true });
          }}
        />
      )}

      {/* ---------- modal: edytuj termin ---------- */}
      {modal === "edit-termin" &&
        editTermEntry &&
        (() => {
          if (!myGroups.some((g) => g.id === editTermEntry.term.circle_group_id)) return null;
          return (
            <EditTermDialog
              term={editTermEntry.term}
              neededItems={editTermEntry.neededItems}
              onChanged={() => void load({ silent: true })}
              onClose={() => {
                setModal(null);
                setEditTermId(null);
              }}
            />
          );
        })()}

      {/* ---------- modal: dodaj grupę ---------- */}
      {modal === "grupa" && (
        <ModalSheet title="Dodaj nową grupę" onClose={() => setModal(null)}>
          <GroupFormFields value={groupForm} onChange={setGroupForm} idPrefix="add-group" />
          {addGroupError && (
            <p role="alert" className="mt-2 text-[12.5px] font-semibold text-danger">{addGroupError}</p>
          )}
          <button
            onClick={() => void handleAddGroup()}
            disabled={busy || !groupForm.name.trim() || parseCapacity(groupForm.defaultCapacity) === undefined}
            className="mt-4 w-full rounded-[13px] bg-mint px-5 py-3 text-[13.5px] font-extrabold text-white disabled:opacity-60"
          >
            Dodaj grupę
          </button>
        </ModalSheet>
      )}

      {/* ---------- modal: edytuj grupę (nazwa, layout, widoczność, stałe miejsce, ile miejsc) ---------- */}
      {modal === "edit-grupa" && (
        <ModalSheet title="Edytuj grupę" onClose={cancelEditGroup}>
          <GroupFormFields
            value={editGroupForm}
            onChange={setEditGroupForm}
            showLayoutMode
            idPrefix="edit-group"
            fallbackLocation={editingGroup?.default_location ?? null}
          />
          {editGroupError && (
            <p role="alert" className="mt-2 text-[12.5px] font-semibold text-danger">{editGroupError}</p>
          )}
          <button
            onClick={() => void saveEditGroup()}
            disabled={busy || !editGroupForm.name.trim() || parseCapacity(editGroupForm.defaultCapacity) === undefined}
            className="mt-4 w-full rounded-[13px] bg-mint px-5 py-3 text-[13.5px] font-extrabold text-white disabled:opacity-60"
          >
            Zapisz
          </button>
        </ModalSheet>
      )}
    </>
  );
}
