import type { ReactNode } from "react";
import { PhoneFrame } from "../../components/shared/PhoneFrame";
import { AppDataProvider } from "./AppDataContext";
import { useAppData } from "./appDataStore";
import { AppSkeleton } from "./AppSkeleton";
import { AppModals } from "./AppModals";

/* ------------------------------------------------------------------ */
/*  Panel — organizator/gość (port z pages/PanelOrganizatora.tsx +      */
/*  pages/PanelGoscia.tsx, jeden ekran sterowany realną rolą:            */
/*  obecność aktywnego Leadership = organizator, brak = gość).           */
/*                                                                       */
/*  Sekcje bez odpowiednika w modelu domenowym (widoczność profilu,      */
/*  tryb rzeczy oddam/zamienię)                                         */
/*  są — jak w mocku (pages/SPEC.md §0/§3.5) — czysto lokalnym stanem     */
/*  (znikają po odświeżeniu, tak jak w prototypie).                      */
/*                                                                       */
/*  Struktura: stan/efekty/handlery → ./AppDataContext (useAppData);     */
/*  ramka = strona sekcji (children z app/(site)/(panel)) + <AppModals/> */
/*  (dolne menu → globalny PublicLayout). Typy/helpery →                 */
/*  utils/appHelpers, ikony → components/shared/appIcons,                */
/*  ToggleRow/HintCard/Field/ModalSheet → components/shared/appComponents.*/
/* ------------------------------------------------------------------ */

export function AppPage({ children }: { children: ReactNode }) {
  return (
    <AppDataProvider>
      <AppPageView>{children}</AppPageView>
    </AppDataProvider>
  );
}

function AppPageView({ children }: { children: ReactNode }) {
  const { loading, error, profile, toast } = useAppData();
  if (loading) {
    return (
      <PhoneFrame>
        <div className="flex-1 overflow-y-auto px-[18px] pb-6 pt-[18px]">
          <AppSkeleton />
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
      {children}

      <AppModals />

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
