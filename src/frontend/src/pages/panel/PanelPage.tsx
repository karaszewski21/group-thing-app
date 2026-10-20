import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { PhoneFrame } from "../../components/shared/PhoneFrame";
import { PanelDataProvider } from "./PanelDataContext";
import { usePanelData } from "./panelDataStore";
import { PanelNav, PanelNavBar } from "./PanelNav";
import { PanelSkeleton } from "./PanelSkeleton";
import { PanelModals } from "./PanelModals";
import { HomeView } from "./views/HomeView";
import { SpotkaniaView } from "./views/SpotkaniaView";
import { RzeczyView } from "./views/RzeczyView";
import { WypozyczoneView } from "./views/WypozyczoneView";
import { ProfilView } from "./views/ProfilView";
import { UstawieniaView } from "./views/UstawieniaView";
import { RodzinaView } from "./views/RodzinaView";
import { MiejscaView } from "./views/MiejscaView";

/* ------------------------------------------------------------------ */
/*  Panel — organizator/gość (port z pages/PanelOrganizatora.tsx +      */
/*  pages/PanelGoscia.tsx, jeden ekran sterowany realną rolą:            */
/*  obecność aktywnego Leadership = organizator, brak = gość).           */
/*                                                                       */
/*  Sekcje bez odpowiednika w modelu domenowym (widoczność profilu,      */
/*  tryb rzeczy wypożyczę/oddam/zamienię, podarki)                       */
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
  const { loading, error, profile, view, toast, setModal, load } = usePanelData();
  const [searchParams, setSearchParams] = useSearchParams();
  const createGroupRequested = searchParams.get("nowa") === "grupa";

  // `?nowa=grupa` (the public pages' "Załóż grupę" link) opens the stepper
  // once; the param is stripped so a refresh or back step doesn't reopen it.
  useEffect(() => {
    if (!createGroupRequested) return;
    setModal("zaloz-grupe");
    setSearchParams(
      (params) => {
        params.delete("nowa");
        return params;
      },
      { replace: true },
    );
  }, [createGroupRequested, setModal, setSearchParams]);

  if (loading) {
    return (
      <PhoneFrame>
        <div className="flex-1 overflow-y-auto px-[18px] pb-6 pt-[18px]">
          <PanelSkeleton />
        </div>
        {/* The tab bar's shape only — not usable until the panel has loaded. */}
        <div inert aria-hidden="true" className="sticky bottom-0 z-20">
          <PanelNavBar />
        </div>
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
        {view === "miejsca" && <MiejscaView onPlacesChanged={() => void load({ silent: true })} />}
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
