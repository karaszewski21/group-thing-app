import { PhoneFrame } from "../../components/shared/PhoneFrame";
import { PanelDataProvider } from "./PanelDataContext";
import { usePanelData } from "./panelDataStore";
import { PanelNav } from "./PanelNav";
import { PanelModals } from "./PanelModals";
import { HomeView } from "./views/HomeView";
import { SpotkaniaView } from "./views/SpotkaniaView";
import { RzeczyView } from "./views/RzeczyView";
import { WypozyczoneView } from "./views/WypozyczoneView";
import { ProfilView } from "./views/ProfilView";
import { UstawieniaView } from "./views/UstawieniaView";
import { RodzinaView } from "./views/RodzinaView";

/* ------------------------------------------------------------------ */
/*  Panel — organizator/gość (port z pages/PanelOrganizatora.tsx +      */
/*  pages/PanelGoscia.tsx, jeden ekran sterowany realną rolą:            */
/*  obecność aktywnego Leadership = organizator, brak = gość).           */
/*                                                                       */
/*  Sekcje bez odpowiednika w modelu domenowym (profil poza imieniem/    */
/*  emailem, ustawienia, tryb rzeczy wypożyczę/oddam/zamienię, podarki)  */
/*  są — jak w mocku (pages/SPEC.md §0/§3.5) — czysto lokalnym stanem     */
/*  (znikają po odświeżeniu, tak jak w prototypie).                      */
/*                                                                       */
/*  Struktura: stan/efekty/handlery → ./PanelDataContext (usePanelData); */
/*  ekran = przełącznik widoków (./views/*) +                            */
/*  <PanelNav/> + <PanelModals/>. Typy/stałe/helpery → ./panelHelpers,   */
/*  ikony → ./panelIcons, ToggleRow/HintCard/Field/ModalSheet →          */
/*  ./panelComponents.                                                   */
/* ------------------------------------------------------------------ */

export function PanelPage() {
  return (
    <PanelDataProvider>
      <PanelPageView />
    </PanelDataProvider>
  );
}

function PanelPageView() {
  const { loading, error, profile, view, toast } = usePanelData();

  if (loading) {
    return (
      <PhoneFrame>
        <div className="flex flex-1 items-center justify-center text-ink-soft">Wczytywanie…</div>
      </PhoneFrame>
    );
  }

  if (error || !profile) {
    return (
      <PhoneFrame>
        <div className="flex flex-1 items-center justify-center text-ink-soft">
          {error ?? "Nie znaleziono profilu"}
        </div>
      </PhoneFrame>
    );
  }

  return (
    <PhoneFrame>
      <div className="flex-1 overflow-y-auto px-[18px] pb-6 pt-[18px]">
        {view === "home" && <HomeView />}
        {view === "spotkania" && <SpotkaniaView />}
        {view === "rzeczy" && <RzeczyView />}
        {view === "podarki" && <WypozyczoneView />}
        {view === "profil" && <ProfilView />}
        {view === "ustawienia" && <UstawieniaView />}
        {view === "rodzina" && <RodzinaView />}
      </div>

      <PanelNav />
      <PanelModals />

      {toast && (
        // Wraps within the 16 px gutter for long server messages; a pill
        // only fits one line, so longer text gets a rounded box.
        <div
          role="status"
          className={`fixed bottom-[86px] left-1/2 z-[120] w-max max-w-[calc(100%-32px)] -translate-x-1/2 bg-ink px-5 py-2.5 text-center text-sm font-semibold text-[#EAF2E9] shadow-lg ${
            toast.length > 40 ? "rounded-2xl" : "rounded-full"
          }`}
        >
          {toast}
        </div>
      )}
    </PhoneFrame>
  );
}
