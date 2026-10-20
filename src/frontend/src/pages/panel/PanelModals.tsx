import { useState } from "react";
import { NeededItemQuickAddForm } from "../../components/shared/NeededItemQuickAddForm";
import { CreateFamilyDialog } from "../../components/panel/CreateFamilyDialog";
import { EditTermDialog } from "../../components/panel/EditTermDialog";
import { CreateGroupStepper } from "../../components/panel/CreateGroupStepper";
import { FirstTermStepperOrganizer } from "../../components/panel/FirstTermStepperOrganizer";
import { GroupFormFields } from "../../components/panel/GroupFormFields";
import { LocationPicker } from "../../components/shared/LocationPicker";
import { Field, ModalSheet } from "./panelComponents";
import { usePanelData } from "./panelDataStore";

/** The Panel's modal layer — one `{modal === "..." && ...}` block per modal
 * kind, rendered above the views/nav. Reads `usePanelData()` for the form
 * state + handlers. */
export function PanelModals() {
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
    addTermError,
    termGroupId,
    termDate,
    termDescription,
    termLocationId,
    termCapacity,
    neededDraft,
    draftNeededItem,
    busy,
    setModal,
    setEditTermId,
    setGroupForm,
    setEditGroupForm,
    selectTermGroup,
    setTermDate,
    setTermDescription,
    setTermLocationId,
    setTermCapacity,
    setDraftNeededItem,
    showToast,
    load,
    handleAddGroup,
    cancelEditGroup,
    saveEditGroup,
    handleAddTerm,
    addDraftNeededItem,
    removeDraftNeededItem,
  } = usePanelData();

  // "Potrzebne rzeczy" is optional — collapsed behind a small button until
  // the organizer actually wants to add one (same pattern as EditTermDialog).
  const [addingNeeded, setAddingNeeded] = useState(false);

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
  const termGroup = myGroups.find((g) => g.id === termGroupId) ?? null;

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
          const group = myGroups.find((g) => g.id === editTermEntry.term.circle_group_id);
          if (!group) return null;
          return (
            <EditTermDialog
              term={editTermEntry.term}
              neededItems={editTermEntry.neededItems}
              group={group}
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
            disabled={busy || !groupForm.name.trim()}
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
            disabled={busy || !editGroupForm.name.trim()}
            className="mt-4 w-full rounded-[13px] bg-mint px-5 py-3 text-[13.5px] font-extrabold text-white disabled:opacity-60"
          >
            Zapisz
          </button>
        </ModalSheet>
      )}

      {/* ---------- modal: dodaj termin ---------- */}
      {modal === "termin" && (
        <ModalSheet
          title="Dodaj termin zajęć"
          onClose={() => {
            setModal(null);
            setAddingNeeded(false);
          }}
        >
          <div className="grid grid-cols-1 gap-3">
            <Field label="Grupa">
              <select
                value={termGroupId ?? ""}
                onChange={(e) => selectTermGroup(e.target.value || null)}
                className="rounded-xl border-[1.5px] border-line bg-cream px-3.5 py-2.5 text-ink"
              >
                <option value="" disabled>Wybierz grupę…</option>
                {myGroups.map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Data i godzina">
              <input
                type="datetime-local"
                value={termDate}
                onChange={(e) => setTermDate(e.target.value)}
                className="rounded-xl border-[1.5px] border-line bg-cream px-3.5 py-2.5 text-ink"
              />
            </Field>
            <Field label="Opis (opcjonalnie)">
              <input
                value={termDescription}
                onChange={(e) => setTermDescription(e.target.value)}
                placeholder="Park Sołacki · wstęp wolny"
                className="rounded-xl border-[1.5px] border-line bg-cream px-3.5 py-2.5 text-ink"
              />
            </Field>
            <Field label="Miejsce">
              <LocationPicker
                value={termLocationId}
                onChange={setTermLocationId}
                label="Miejsce"
                noneLabel="Brak miejsca"
                idPrefix="add-term-place"
                fallbackLocation={termGroup?.default_location ?? null}
                helperText={
                  termGroup?.default_location && termLocationId === termGroup.default_location.id
                    ? "Domyślne miejsce grupy — możesz zmienić"
                    : undefined
                }
              />
            </Field>
            <Field label="Ile miejsc">
              <input
                type="number"
                min={1}
                inputMode="numeric"
                aria-label="Ile miejsc"
                value={termCapacity ?? ""}
                onChange={(e) => setTermCapacity(e.target.value.trim() === "" ? null : Number(e.target.value))}
                placeholder="np. 12"
                className="w-28 rounded-xl border-[1.5px] border-line bg-cream px-3.5 py-2.5 text-ink"
              />
            </Field>
            <Field label="Potrzebne rzeczy (opcjonalnie)">
              {neededDraft.map((item, index) => (
                <div key={index} className="mb-1.5 flex items-center gap-2 text-[13px]">
                  <span className="flex-1">
                    {item.name}
                    {item.description ? ` — ${item.description}` : ""}
                  </span>
                  <button onClick={() => removeDraftNeededItem(index)} className="text-xs font-bold text-danger">
                    Usuń
                  </button>
                </div>
              ))}
              {addingNeeded ? (
                <div className="mt-1.5 flex flex-col gap-1.5">
                  <NeededItemQuickAddForm value={draftNeededItem} onChange={setDraftNeededItem} />
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={addDraftNeededItem}
                      disabled={!draftNeededItem.name.trim()}
                      className="rounded-full border border-line px-3 py-1.5 text-xs font-bold text-ink-soft disabled:opacity-50"
                    >
                      Dodaj rzecz
                    </button>
                    <button
                      type="button"
                      onClick={() => setAddingNeeded(false)}
                      className="rounded-full px-3 py-1.5 text-xs font-bold text-ink-soft hover:bg-cream"
                    >
                      Zwiń
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setAddingNeeded(true)}
                  className="mt-1 self-start rounded-[9px] px-1.5 py-1 text-[12px] font-bold text-ink-soft transition-colors hover:bg-cream hover:text-ink"
                >
                  + Dodaj potrzebną rzecz
                </button>
              )}
            </Field>
          </div>
          {addTermError && (
            <p role="alert" className="mt-2 text-[12.5px] font-semibold text-danger">{addTermError}</p>
          )}
          <button
            onClick={() => void handleAddTerm()}
            disabled={busy || !termDate || !termGroupId}
            className="mt-4 w-full rounded-[13px] bg-mint px-5 py-3 text-[13.5px] font-extrabold text-white disabled:opacity-60"
          >
            Dodaj termin
          </button>
        </ModalSheet>
      )}
    </>
  );
}
