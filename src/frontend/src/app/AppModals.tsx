import { FirstTermStepperOrganizer } from "../components/panel/FirstTermStepperOrganizer";
import { useAppData } from "./appDataStore";

/** The Panel's modal layer — one `{modal === "..." && ...}` block per modal
 * kind, rendered above the views/nav. Reads `useAppData()` for the form
 * state + handlers. */
export function AppModals() {
  const {
    modal,
    myGroups,
    setModal,
    showToast,
    load,
  } = useAppData();

  return (
    <>
      {/* ---------- modal: dodaj pierwszy termin (led group without terms) ---------- */}
      {modal === "pierwszy-termin" && myGroups.length > 0 && (
        <FirstTermStepperOrganizer
          circleGroupId={myGroups[0].id}
          organizerSlug={myGroups[0].organizer_slug ?? null}
          defaultLocation={myGroups[0].default_location ?? null}
          defaultCapacity={myGroups[0].default_capacity ?? null}
          onClose={() => setModal(null)}
          onDone={() => {
            setModal(null);
            showToast("Dodano pierwszy termin");
            void load();
          }}
        />
      )}
    </>
  );
}
