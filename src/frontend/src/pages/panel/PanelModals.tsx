import { ItemQuickAddForm } from "../../components/shared/ItemQuickAddForm";
import { NeededItemQuickAddForm } from "../../components/shared/NeededItemQuickAddForm";
import { CreateFamilyDialog } from "../../components/panel/CreateFamilyDialog";
import { EditTermDialog } from "../../components/panel/EditTermDialog";
import { FirstTermStepperGuest } from "../../components/panel/FirstTermStepperGuest";
import { FirstTermStepperOrganizer } from "../../components/panel/FirstTermStepperOrganizer";
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
    editTermEntry,
    groupForm,
    termGroupId,
    termDate,
    termDescription,
    neededDraft,
    draftNeededItem,
    itemDraft,
    busy,
    relevantGroupsForForm,
    setModal,
    setEditTermId,
    setGroupForm,
    setTermGroupId,
    setTermDate,
    setTermDescription,
    setDraftNeededItem,
    setItemDraft,
    showToast,
    load,
    handleAddGroup,
    handleAddTerm,
    handleAddItem,
    addDraftNeededItem,
    removeDraftNeededItem,
  } = usePanelData();

  return (
    <>
      {/* ---------- modal: dodaj pierwszy termin (GUEST 2-step / ORGANIZER 1-step) ---------- */}
      {modal === "pierwszy-termin" && (
        // The 1-step organizer stepper only works when a circle already exists;
        // an organizer with zero circles (or a guest) needs the 2-step guest
        // stepper whose step 1 creates the circle — that step IS the "add a
        // group" shortcut.
        firstTermForOrganizer && myGroups.length > 0 ? (
          <FirstTermStepperOrganizer
            circleGroupId={myGroups[0]?.id ?? null}
            organizerSlug={myGroups[0]?.organizer_slug ?? null}
            onClose={() => setModal(null)}
            onDone={() => {
              setModal(null);
              showToast("Dodano pierwszy termin");
              void load();
            }}
          />
        ) : (
          <FirstTermStepperGuest
            onClose={() => setModal(null)}
            onCircleCreated={() => void load({ silent: true })}
            onDone={() => {
              setModal(null);
              showToast("Dodano pierwszy termin");
              void load();
            }}
          />
        )
      )}

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
      {modal === "edit-termin" && editTermEntry && (
        <EditTermDialog
          term={editTermEntry.term}
          neededItems={editTermEntry.neededItems}
          onChanged={() => void load({ silent: true })}
          onClose={() => {
            setModal(null);
            setEditTermId(null);
          }}
        />
      )}

      {/* ---------- modal: dodaj grupę ---------- */}
      {modal === "grupa" && (
        <ModalSheet title="Dodaj nową grupę" onClose={() => setModal(null)}>
          <div className="grid grid-cols-1 gap-3">
            <Field label="Nazwa grupy">
              <input
                value={groupForm.name}
                onChange={(e) => setGroupForm({ ...groupForm, name: e.target.value })}
                placeholder="np. Nutki dla starszaków"
                className="rounded-xl border-[1.5px] border-line bg-cream px-3.5 py-2.5 text-ink"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Lokalizacja">
                <input
                  value={groupForm.location}
                  onChange={(e) => setGroupForm({ ...groupForm, location: e.target.value })}
                  placeholder="Sala nr 2"
                  className="rounded-xl border-[1.5px] border-line bg-cream px-3.5 py-2.5 text-ink"
                />
              </Field>
              <Field label="Ile miejsc">
                <input
                  type="number"
                  min={0}
                  value={groupForm.freeSpots}
                  onChange={(e) => setGroupForm({ ...groupForm, freeSpots: e.target.value })}
                  placeholder="0"
                  className="rounded-xl border-[1.5px] border-line bg-cream px-3.5 py-2.5 text-ink"
                />
              </Field>
            </div>
          </div>
          <button
            onClick={() => void handleAddGroup()}
            disabled={busy || !groupForm.name.trim()}
            className="mt-4 w-full rounded-[13px] bg-mint px-5 py-3 text-[13.5px] font-extrabold text-white disabled:opacity-60"
          >
            Dodaj grupę
          </button>
        </ModalSheet>
      )}

      {/* ---------- modal: dodaj termin ---------- */}
      {modal === "termin" && (
        <ModalSheet title="Dodaj termin zajęć" onClose={() => setModal(null)}>
          <div className="grid grid-cols-1 gap-3">
            <Field label="Grupa">
              <select
                value={termGroupId ?? ""}
                onChange={(e) => setTermGroupId(Number(e.target.value))}
                className="rounded-xl border-[1.5px] border-line bg-cream px-3.5 py-2.5 text-ink"
              >
                <option value="" disabled>Wybierz grupę…</option>
                {relevantGroupsForForm.map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Data">
              <input
                type="date"
                value={termDate}
                onChange={(e) => setTermDate(e.target.value)}
                className="rounded-xl border-[1.5px] border-line bg-cream px-3.5 py-2.5 text-ink"
              />
            </Field>
            <Field label="Opis (opcjonalnie)">
              <input
                value={termDescription}
                onChange={(e) => setTermDescription(e.target.value)}
                placeholder="17:00 · Park Sołacki · wstęp wolny"
                className="rounded-xl border-[1.5px] border-line bg-cream px-3.5 py-2.5 text-ink"
              />
            </Field>
            <Field label="Potrzebne rzeczy">
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
              <NeededItemQuickAddForm value={draftNeededItem} onChange={setDraftNeededItem} />
              <button
                type="button"
                onClick={addDraftNeededItem}
                disabled={!draftNeededItem.name.trim()}
                className="mt-2 self-start rounded-full border border-line px-3 py-1.5 text-xs font-bold text-ink-soft disabled:opacity-50"
              >
                Dodaj rzecz
              </button>
            </Field>
          </div>
          <button
            onClick={() => void handleAddTerm()}
            disabled={busy || !termDate || !termGroupId}
            className="mt-4 w-full rounded-[13px] bg-mint px-5 py-3 text-[13.5px] font-extrabold text-white disabled:opacity-60"
          >
            Dodaj termin
          </button>
        </ModalSheet>
      )}

      {/* ---------- modal: dodaj rzecz ---------- */}
      {modal === "rzecz" && (
        <ModalSheet title="Dodaj rzecz" onClose={() => setModal(null)}>
          <ItemQuickAddForm value={itemDraft} onChange={setItemDraft} disabled={busy} />
          <p className="mt-2 text-xs text-ink-soft">
            Sposób udostępnienia (wypożyczę / oddam / zamienię) ustawisz na liście po dodaniu.
          </p>
          <button
            onClick={() => void handleAddItem()}
            disabled={busy || !itemDraft.name.trim()}
            className="mt-4 w-full rounded-[13px] bg-mint px-5 py-3 text-[13.5px] font-extrabold text-white disabled:opacity-60"
          >
            Dodaj rzecz
          </button>
        </ModalSheet>
      )}
    </>
  );
}
