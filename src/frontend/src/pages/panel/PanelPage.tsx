import { Link } from "react-router-dom";
import { type NeededItemCategory } from "../../api/terms";
import { PhoneFrame } from "../../components/shared/PhoneFrame";
import { ItemQuickAddForm } from "../../components/shared/ItemQuickAddForm";
import { CreateFamilyDialog } from "../../components/panel/CreateFamilyDialog";
import { EditTermDialog } from "../../components/panel/EditTermDialog";
import { FirstTermStepperGuest } from "../../components/panel/FirstTermStepperGuest";
import { FirstTermStepperOrganizer } from "../../components/panel/FirstTermStepperOrganizer";
import {
  BackIcon,
  BoxIcon,
  BuildingIcon,
  CalendarIcon,
  CalendarPlusIcon,
  FamilyIcon,
  GiftIcon,
  HomeIcon,
  MenuIcon,
  SettingsIcon,
  UserIcon,
} from "./panelIcons";
import { Field, ModalSheet } from "./panelComponents";
import { initials, NEEDED_ITEM_LABELS, type View } from "./panelHelpers";
import { PanelDataProvider } from "./PanelDataContext";
import { usePanelData } from "./panelDataStore";
import { HomeView } from "./views/HomeView";
import { SpotkaniaView } from "./views/SpotkaniaView";
import { RzeczyView } from "./views/RzeczyView";
import { PodarkiView } from "./views/PodarkiView";
import { ProfilView } from "./views/ProfilView";
import { UstawieniaView } from "./views/UstawieniaView";
import { RodzinaView } from "./views/RodzinaView";

/* ------------------------------------------------------------------ */
/*  Panel — organizator/gość (port z pages/PanelOrganizatora.tsx +      */
/*  pages/PanelGoscia.tsx, jeden komponent sterowany realną rolą:        */
/*  obecność aktywnego Leadership = organizator, brak = gość).           */
/*                                                                       */
/*  Sekcje bez odpowiednika w modelu domenowym (profil poza imieniem/    */
/*  emailem, ustawienia, tryb rzeczy wypożyczę/oddam/zamienię, podarki)  */
/*  są — jak w mocku (pages/SPEC.md §0/§3.5: "żadna z tych akcji nic     */
/*  faktycznie nie zapisuje") — czysto lokalnym stanem komponentu:       */
/*  znikają po odświeżeniu, tak samo jak w prototypie. W odróżnieniu od  */
/*  mocka (zaszyte dane demo) realna apka startuje te sekcje puste,      */
/*  żeby nie pokazywać zmyślonych danych prawdziwemu użytkownikowi.      */
/*                                                                       */
/*  "Usuń" dla realnych encji: Grupa → prawdziwe zakończenie własnego    */
/*  Leadership (`endLeadership`) — grupa realnie znika z listy.          */
/*                                                                       */
/*  Typy/stałe/helpery → ./panelHelpers; ikony → ./panelIcons;          */
/*  ToggleRow/HintCard/Field/ModalSheet → ./panelComponents;            */
/*  stan/efekty/handlery → ./PanelDataContext (usePanelData()).          */
/* ------------------------------------------------------------------ */

const NAV_ITEMS: { key: View; label: string; Icon: typeof HomeIcon }[] = [
  { key: "home", label: "Home", Icon: HomeIcon },
  { key: "spotkania", label: "Spotkania", Icon: CalendarIcon },
  { key: "rzeczy", label: "Moje rzeczy", Icon: BoxIcon },
  { key: "podarki", label: "Podarki", Icon: GiftIcon },
];

export function PanelPage() {
  return (
    <PanelDataProvider>
      <PanelPageView />
    </PanelDataProvider>
  );
}

function PanelPageView() {
  const {
    loading,
    error,
    profile,
    myGroups,
    organizationSlug,
    view,
    modal,
    firstTermForOrganizer,
    menuOpen,
    toast,
    busy,
    localLocation,
    groupForm,
    termGroupId,
    termDate,
    termDescription,
    neededDraft,
    draftCategory,
    draftDescription,
    itemDraft,
    setView,
    setModal,
    setMenuOpen,
    setFirstTermForOrganizer,
    setGroupForm,
    setTermGroupId,
    setTermDate,
    setTermDescription,
    setDraftCategory,
    setDraftDescription,
    setEditTermId,
    setItemDraft,
    isOrganizer,
    showToast,
    load,
    relevantGroupsForForm,
    editTermEntry,
    isTopLevel,
    addDraftNeededItem,
    removeDraftNeededItem,
    handleAddGroup,
    handleAddTerm,
    handleAddItem,
  } = usePanelData();

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
      {/* ---------- nagłówek ---------- */}
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-line bg-paper px-[18px] py-4">
        {isTopLevel ? (
          <>
            <button
              onClick={() => setView("profil")}
              aria-label="Otwórz dane profilowe"
              className="flex h-12 w-12 flex-none items-center justify-center rounded-full border-2 border-mint-soft bg-mint-soft font-serif text-base font-semibold text-mint transition-transform hover:scale-105"
            >
              {initials(profile.display_name)}
            </button>
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-[16.5px] font-semibold leading-tight text-ink">
                {profile.display_name}
              </h1>
              {localLocation && <small className="mt-0.5 block text-xs text-ink-soft">{localLocation}</small>}
            </div>
            <div className="relative flex-none">
              <button
                onClick={() => setMenuOpen((o) => !o)}
                aria-label="Menu"
                aria-expanded={menuOpen}
                className="flex h-10 w-10 items-center justify-center rounded-[14px] border border-line bg-cream transition-colors hover:bg-mint-soft"
              >
                <MenuIcon />
              </button>
              {menuOpen && (
                <>
                  <button
                    onClick={() => setMenuOpen(false)}
                    aria-label="Zamknij menu"
                    className="fixed inset-0 z-[25] cursor-default border-none bg-transparent p-0"
                  />
                  <div
                    role="menu"
                    className="absolute right-0 top-12 z-30 min-w-[190px] rounded-2xl border border-line bg-paper p-1.5 shadow-[0_16px_34px_-16px_rgba(30,46,39,0.45)]"
                  >
                    <button
                      role="menuitem"
                      onClick={() => { setView("profil"); setMenuOpen(false); }}
                      className="flex w-full items-center gap-2.5 rounded-[11px] px-3 py-2.5 text-left text-sm font-bold text-ink hover:bg-cream"
                    >
                      <UserIcon /> Profil
                    </button>
                    <button
                      role="menuitem"
                      onClick={() => { setView("ustawienia"); setMenuOpen(false); }}
                      className="flex w-full items-center gap-2.5 rounded-[11px] px-3 py-2.5 text-left text-sm font-bold text-ink hover:bg-cream"
                    >
                      <SettingsIcon /> Ustawienia
                    </button>
                    {/* Unconditional — creating an Organization is deliberately
                        independent of "Chcę dodać krąg"/isOrganizer (a Circle-
                        leadership signal). Backend authorization agrees: any
                        authenticated account (GUEST or ORGANIZER) already has
                        EDIT permission, so nothing blocks a GUEST from owning
                        an Organization without ever running a Circle. */}
                    <Link
                      role="menuitem"
                      to={organizationSlug ? `/${organizationSlug}` : "/organization"}
                      onClick={() => setMenuOpen(false)}
                      className="flex w-full items-center gap-2.5 rounded-[11px] px-3 py-2.5 text-left text-sm font-bold text-ink hover:bg-cream"
                    >
                      <BuildingIcon /> Moja organizacja
                    </Link>
                    <button
                      role="menuitem"
                      onClick={() => { setView("rodzina"); setMenuOpen(false); }}
                      className="flex w-full items-center gap-2.5 rounded-[11px] px-3 py-2.5 text-left text-sm font-bold text-ink hover:bg-cream"
                    >
                      <FamilyIcon /> Mój dom
                    </button>
                    {!isOrganizer && (
                      <button
                        role="menuitem"
                        onClick={() => { setFirstTermForOrganizer(false); setModal("pierwszy-termin"); setMenuOpen(false); }}
                        className="flex w-full items-center gap-2.5 rounded-[11px] px-3 py-2.5 text-left text-sm font-bold text-ink hover:bg-cream"
                      >
                        <CalendarPlusIcon /> Dodaj pierwszy termin
                      </button>
                    )}
                    {/* {isOrganizer && terms.length === 0 && (
                      <button
                        role="menuitem"
                        onClick={() => { setFirstTermForOrganizer(true); setModal("pierwszy-termin"); setMenuOpen(false); }}
                        className="flex w-full items-center gap-2.5 rounded-[11px] px-3 py-2.5 text-left text-sm font-bold text-ink hover:bg-cream"
                      >
                        <CalendarPlusIcon /> Dodaj pierwszy termin
                      </button>
                    )} */}
                  </div>
                </>
              )}
            </div>
          </>
        ) : (
          <>
            <button
              onClick={() => setView("home")}
              className="inline-flex h-[38px] flex-none items-center gap-1.5 rounded-full bg-white px-[15px] text-[13.5px] font-bold text-ink shadow-[0_3px_10px_-6px_rgba(30,46,39,0.4)]"
            >
              <BackIcon /> Wróć
            </button>
            <h1 className="text-[16.5px] font-semibold text-ink">
              {view === "profil" ? "Dane profilowe" : view === "rodzina" ? "Mój dom" : "Ustawienia"}
            </h1>
          </>
        )}
      </header>

      {/* ---------- treść ---------- */}
      <div className="flex-1 overflow-y-auto px-[18px] pb-6 pt-[18px]">
        {view === "home" && <HomeView />}
        {view === "spotkania" && <SpotkaniaView />}
        {view === "rzeczy" && <RzeczyView />}
        {view === "podarki" && <PodarkiView />}
        {view === "profil" && <ProfilView />}
        {view === "ustawienia" && <UstawieniaView />}
        {view === "rodzina" && <RodzinaView />}
      </div>

      {/* ---------- dolne menu ---------- */}
      {isTopLevel && (
        <nav aria-label="Nawigacja panelu" className="sticky bottom-0 z-20 flex border-t border-line bg-paper px-2.5 py-2 shadow-[0_-10px_30px_-22px_rgba(30,46,39,0.7)]">
          {NAV_ITEMS.map(({ key, label, Icon }) => (
            <button
              key={key}
              onClick={() => setView(key)}
              aria-current={view === key}
              className={`flex flex-1 flex-col items-center gap-1 rounded-[14px] py-2 text-[11.5px] font-bold transition-colors hover:bg-cream ${
                view === key ? "text-mint" : "text-ink-soft"
              }`}
            >
              <Icon c={view === key ? "#1B8168" : "#5C7069"} />
              {label}
            </button>
          ))}
        </nav>
      )}

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
                    {NEEDED_ITEM_LABELS[item.category]}
                    {item.description ? ` — ${item.description}` : ""}
                  </span>
                  <button onClick={() => removeDraftNeededItem(index)} className="text-xs font-bold text-danger">
                    Usuń
                  </button>
                </div>
              ))}
              <div className="flex gap-2">
                <select
                  value={draftCategory}
                  onChange={(e) => setDraftCategory(e.target.value as NeededItemCategory)}
                  className="rounded-xl border-[1.5px] border-line bg-cream px-3.5 py-2.5 text-ink"
                >
                  {(Object.keys(NEEDED_ITEM_LABELS) as NeededItemCategory[]).map((c) => (
                    <option key={c} value={c}>{NEEDED_ITEM_LABELS[c]}</option>
                  ))}
                </select>
                <input
                  value={draftDescription}
                  onChange={(e) => setDraftDescription(e.target.value)}
                  placeholder="Opis (opcjonalnie)"
                  className="min-w-0 flex-1 rounded-xl border-[1.5px] border-line bg-cream px-3.5 py-2.5 text-ink"
                />
                <button onClick={addDraftNeededItem} className="rounded-full border border-line px-3 py-1.5 text-xs font-bold text-ink-soft">
                  Dodaj
                </button>
              </div>
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

      {toast && (
        <div role="status" className="fixed bottom-[86px] left-1/2 z-[120] -translate-x-1/2 rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-[#EAF2E9] shadow-lg">
          {toast}
        </div>
      )}
    </PhoneFrame>
  );
}
