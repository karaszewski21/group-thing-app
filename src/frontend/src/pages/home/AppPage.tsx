import { PhoneFrame } from "../../components/shared/PhoneFrame";
import { AppDataProvider } from "../../app/AppDataContext";
import { useAppData } from "../../app/appDataStore";
import { AppSkeleton } from "./AppSkeleton";
import { AppModals } from "../../app/AppModals";
import { HomeView } from "./HomeView";
import { MeetingsView } from "../meetings/MeetingsView";
import { GroupsView } from "../groups/GroupsView";
import { GroupCreateView } from "../groups/GroupCreateView";
import { GroupEditView } from "../groups/GroupEditView";
import { MyItemsView } from "../items/MyItemsView";
import { ProfileView } from "../profile/ProfileView";
import { SettingsView } from "../account/SettingsView";
import { FamilyView } from "../family/FamilyView";
import { FamilyCreateView } from "../family/FamilyCreateView";
import { FamilyEditView } from "../family/FamilyEditView";
import { FamilyMemberCreateView } from "../family/FamilyMemberCreateView";
import { FamilyMemberEditView } from "../family/FamilyMemberEditView";
import { PlacesView } from "../places/PlacesView";
import { PlaceCreateView } from "../places/PlaceCreateView";
import { PlaceEditView } from "../places/PlaceEditView";
import { AccountView } from "../account/AccountView";
import { SearchView } from "../search/SearchView";
import { WantedView } from "../search/WantedView";
import { AddView } from "../add/AddView";
import { AddTermView } from "../add/AddTermView";
import { ItemCreateView } from "../add/ItemCreateView";
import { EventCreateView } from "../add/EventCreateView";
import { HuntingCreateView } from "../add/HuntingCreateView";
import { SubPageHeader } from "../../components/shared/appComponents";
import { ACCOUNT_SUBVIEWS, viewPath } from "../../utils/appHelpers";

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
/*  Struktura: stan/efekty/handlery → app/AppDataContext (useAppData);  */
/*  ekran = przełącznik widoków (pages/<sekcja>/*View) + <AppModals/>    */
/*  (dolne menu → globalny PublicLayout). Typy/helpery →                 */
/*  utils/appHelpers, ikony → components/shared/appIcons,                */
/*  ToggleRow/HintCard/Field/ModalSheet → components/shared/appComponents.*/
/* ------------------------------------------------------------------ */

export function AppPage() {
  return (
    <AppDataProvider>
      <AppPageView />
    </AppDataProvider>
  );
}

function AppPageView() {
  const { loading, error, profile, view, toast, load } = useAppData();
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
      <div className="flex-1 overflow-y-auto px-[18px] pb-6 pt-[18px]">
        {ACCOUNT_SUBVIEWS.includes(view) && <SubPageHeader backTo={viewPath("account")} backLabel="Wróć do konta" />}
        {view === "home" && <HomeView />}
        {view === "meetings" && <MeetingsView />}
        {view === "groups" && <GroupsView />}
        {view === "groups/new" && <GroupCreateView />}
        {view === "groups/edit" && <GroupEditView />}
        {view === "items" && <MyItemsView />}
        {view === "profile" && <ProfileView />}
        {view === "settings" && <SettingsView />}
        {view === "places" && <PlacesView onPlacesChanged={() => void load({ silent: true })} />}
        {view === "places/new" && <PlaceCreateView />}
        {view === "places/edit" && <PlaceEditView onPlacesChanged={() => void load({ silent: true })} />}
        {view === "family" && <FamilyView />}
        {view === "family/new" && <FamilyCreateView />}
        {view === "family/edit" && <FamilyEditView />}
        {view === "family/members/new" && <FamilyMemberCreateView />}
        {view === "family/members/edit" && <FamilyMemberEditView />}
        {view === "account" && <AccountView />}
        {view === "search" && <SearchView />}
        {view === "wanted" && <WantedView />}
        {view === "add" && <AddView />}
        {view === "add/product" && <ItemCreateView />}
        {view === "add/term" && <AddTermView />}
        {view === "add/event" && <EventCreateView />}
        {view === "add/hunting" && <HuntingCreateView />}
      </div>

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
