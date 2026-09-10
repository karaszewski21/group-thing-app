import { Link } from "react-router-dom";
import { CONDITION_LABELS } from "../../utils/productPicker";
import { type ProductCategory } from "../../api/products";
import { type ItemCondition } from "../../api/inventories";
import { CATEGORY_LABELS, PRODUCT_CATEGORIES } from "../../utils/productCategory";
import { type NeededItemCategory } from "../../api/terms";
import { PhoneFrame } from "../../components/shared/PhoneFrame";
import { ItemQuickAddForm } from "../../components/shared/ItemQuickAddForm";
import { createEmptyItemQuickAddValue } from "../../utils/itemQuickAdd";
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
  LogoutIcon,
  MenuIcon,
  PencilIcon,
  SettingsIcon,
  TrashIcon,
  UserIcon,
} from "./panelIcons";
import { Field, HintCard, ModalSheet, ToggleRow } from "./panelComponents";
import {
  capitalize,
  dayMonth,
  GIFT_SOURCE_STYLE,
  initials,
  ITEM_MODE_STYLE,
  ITEM_MODES,
  NEEDED_ITEM_LABELS,
  termPublicPath,
  type GiftSource,
  type View,
} from "./panelHelpers";
import { PanelDataProvider } from "./PanelDataContext";
import { usePanelData } from "./panelDataStore";

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
    logout,
    loading,
    error,
    profile,
    myGroups,
    terms,
    family,
    guardians,
    myAttendances,
    renamingFamily,
    familyNameDraft,
    renameError,
    familyMemberError,
    renamingCircle,
    circleNameDraft,
    circleRenameError,
    editingItemCondition,
    itemError,
    editingItemMeta,
    itemMetaError,
    organizationSlug,
    view,
    modal,
    firstTermForOrganizer,
    menuOpen,
    toast,
    busy,
    hintFirstTermDismissed,
    hintBecomeOrganizerDismissed,
    hintOrgFirstTermDismissed,
    hintOrgPolishDismissed,
    localBio,
    localLocation,
    profileSaved,
    settings,
    groupExtras,
    itemModes,
    gifts,
    memberName,
    memberRole,
    groupForm,
    termGroupId,
    termDate,
    termDescription,
    neededDraft,
    draftCategory,
    draftDescription,
    items,
    itemDraft,
    setView,
    setModal,
    setMenuOpen,
    setFirstTermForOrganizer,
    setLocalLocation,
    setLocalBio,
    setSettings,
    setGroupForm,
    setTermGroupId,
    setTermDate,
    setTermDescription,
    setDraftCategory,
    setDraftDescription,
    setEditTermId,
    setEditingItemCondition,
    setEditingItemMeta,
    setMemberName,
    setMemberRole,
    setCircleNameDraft,
    setFamilyNameDraft,
    setItemDraft,
    isOrganizer,
    showToast,
    load,
    productName,
    itemCounts,
    giftCounts,
    removeGift,
    relevantGroupsForForm,
    editTermEntry,
    isTopLevel,
    organizerTermCard,
    dismissFirstTermHint,
    dismissBecomeOrganizerHint,
    dismissOrgFirstTermHint,
    dismissOrgPolishHint,
    handleAddGroup,
    handleRemoveGroup,
    addDraftNeededItem,
    removeDraftNeededItem,
    handleAddTerm,
    handleAddItem,
    setItemMode,
    handleAddFamilyMember,
    handleRemoveFamilyMember,
    startRenameFamily,
    cancelRenameFamily,
    saveRenameFamily,
    startRenameCircle,
    cancelRenameCircle,
    saveRenameCircle,
    saveItemCondition,
    startEditItemMeta,
    saveItemMeta,
    handleDeleteItem,
    saveProfile,
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
        {view === "home" && (
          <>
            <div className="mb-[18px]">
              <h2 className="font-serif text-xl font-semibold text-ink">
                Cześć, {profile.display_name.split(" ")[0]}!
              </h2>
              <p className="mt-1 text-[13.5px] text-ink-soft">Oto co dzieje się w Twojej grupie.</p>
            </div>

            {!isOrganizer && !hintFirstTermDismissed && (
              <HintCard
                icon={<CalendarPlusIcon c="#1B8168" />}
                title="Dodaj swój pierwszy termin"
                description="Załóż krąg i ustal pierwsze zajęcia — to pierwszy krok."
                ctaLabel="Zacznijmy →"
                onCtaClick={() => { setFirstTermForOrganizer(false); setModal("pierwszy-termin"); }}
                onDismiss={dismissFirstTermHint}
              />
            )}

            {!isOrganizer && !hintBecomeOrganizerDismissed && (
              <HintCard
                icon={<BuildingIcon c="#1B8168" />}
                title="Możesz zostać organizatorem"
                description="Załóż własny krąg, zapraszaj rodziny i planuj zajęcia — bez zakładania nowego konta."
                ctaLabel="Załóż krąg →"
                onCtaClick={() => { setFirstTermForOrganizer(false); setModal("pierwszy-termin"); }}
                onDismiss={dismissBecomeOrganizerHint}
              />
            )}

            {isOrganizer && !hintOrgPolishDismissed && (
              <HintCard
                icon={<BuildingIcon c="#1B8168" />}
                title="Dopracuj stronę organizacji"
                description="Dodaj opis, kolory i logo — zobaczą je odwiedzający Twój krąg."
                ctaLabel="Przejdź →"
                ctaTo={organizationSlug ? `/${organizationSlug}` : "/organization"}
                onDismiss={dismissOrgPolishHint}
              />
            )}

            {isOrganizer && terms.length === 0 && !hintOrgFirstTermDismissed && (
              <HintCard
                icon={<CalendarPlusIcon c="#1B8168" />}
                title="Dodaj swój pierwszy termin"
                description="Ustal pierwsze zajęcia w swoim kręgu."
                ctaLabel="Dodaj termin →"
                onCtaClick={() => {
                  setFirstTermForOrganizer(myGroups.length > 0);
                  setModal("pierwszy-termin");
                }}
                onDismiss={dismissOrgFirstTermHint}
              />
            )}

            <div className="rounded-[22px] border border-line bg-paper p-5">
              <div className="mb-3.5 flex items-center justify-between gap-2.5">
                <h3 className="text-base font-semibold text-ink">Najbliższe terminy</h3>
                <button onClick={() => setView("spotkania")} className="text-xs font-extrabold text-mint hover:underline">
                  Zobacz wszystkie
                </button>
              </div>
              {terms.length === 0 && (
                <div className="rounded-2xl border-[1.5px] border-dashed border-line py-[26px] text-center text-[13.5px] text-ink-soft">
                  Brak zaplanowanych terminów.
                </div>
              )}
              {terms.slice(0, 3).map(({ term, group, neededItems }) => {
                if (isOrganizer) {
                  return (
                    <div key={term.id} className="mt-2.5 first:mt-0">
                      {organizerTermCard(term, group, neededItems)}
                    </div>
                  );
                }
                const { day, month } = dayMonth(term.occurs_on);
                return (
                  <div key={term.id} className="mt-2.5 first:mt-0">
                  <Link
                    to={termPublicPath(group, term.id)}
                    className="flex items-start gap-3.5 rounded-2xl border border-line bg-cream p-[15px] transition-colors hover:border-mint"
                  >
                    <div className="flex h-[46px] w-[46px] flex-none flex-col items-center justify-center rounded-[13px] bg-mint-soft leading-none">
                      <b className="font-serif text-base text-ink">{day}</b>
                      <small className="text-[9.5px] uppercase tracking-wide text-ink-soft">{month}</small>
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-[15.5px] font-semibold text-ink">{group.name}</h3>
                      <small className="mt-0.5 block text-[12.5px] text-ink-soft">{term.description || "Bez opisu"}</small>
                      {neededItems.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {neededItems.map((ni) => (
                            <span key={ni.id} className="rounded-full bg-lime-soft px-2.5 py-0.5 text-[10.5px] font-extrabold text-[#56701F]">
                              {NEEDED_ITEM_LABELS[ni.category]}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </Link>
                  </div>
                );
              })}
            </div>

            <div className="mt-3.5 rounded-[22px] border border-line bg-paper p-5">
              <h3 className="mb-3.5 text-base font-semibold text-ink">Zapisane zajęcia</h3>
              {myAttendances.length === 0 ? (
                <div className="rounded-2xl border-[1.5px] border-dashed border-line py-[26px] text-center text-[13.5px] text-ink-soft">
                  Nie zapisałeś się jeszcze na żadne zajęcia.
                </div>
              ) : (
                myAttendances.map((a) => {
                  const { day, month } = dayMonth(a.occurs_on);
                  return (
                    <Link
                      key={a.attendance_id}
                      to={`/${a.organizer_slug}/grupa/${a.group_id}/term/${a.term_id}`}
                      className="mt-2.5 flex items-start gap-3.5 rounded-2xl border border-line bg-cream p-[15px] transition-colors first:mt-0 hover:border-mint"
                    >
                      <div className="flex h-[46px] w-[46px] flex-none flex-col items-center justify-center rounded-[13px] bg-mint-soft leading-none">
                        <b className="font-serif text-base text-ink">{day}</b>
                        <small className="text-[9.5px] uppercase tracking-wide text-ink-soft">{month}</small>
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="text-[15.5px] font-semibold text-ink">{a.group_name}</h3>
                        {a.organizer_display_name && (
                          <small className="mt-0.5 block text-[12.5px] text-ink-soft">
                            {a.organizer_display_name}
                          </small>
                        )}
                      </div>
                    </Link>
                  );
                })
              )}
            </div>

            <div className="mt-3.5 flex flex-col gap-3.5 rounded-[22px] border border-line bg-paper p-5">
              <h3 className="text-base font-semibold text-ink">Twoje rzeczy</h3>

              <div className="flex items-center justify-between gap-2.5">
                <span className="text-[11.5px] font-extrabold uppercase tracking-wide text-ink-soft">Dla innych</span>
                <button onClick={() => setView("rzeczy")} className="text-xs font-extrabold text-mint hover:underline">
                  Zobacz →
                </button>
              </div>
              <div className="flex gap-2.5">
                {ITEM_MODES.map((m) => {
                  const style = ITEM_MODE_STYLE[m];
                  return (
                    <div key={m} className="flex min-w-0 flex-1 flex-col items-start gap-1.5 rounded-2xl p-3.5" style={{ background: style.bg }}>
                      <span className="flex h-[30px] w-[30px] items-center justify-center rounded-[10px] bg-white/60">
                        <BoxIcon c={style.c} />
                      </span>
                      <b className="font-serif text-[27px] leading-none" style={{ color: style.c }}>{itemCounts[m]}</b>
                      <small className="text-[11.5px] font-extrabold" style={{ color: style.c }}>{capitalize(m)}</small>
                    </div>
                  );
                })}
              </div>

              <div className="h-px bg-line" />

              <div className="flex items-center justify-between gap-2.5">
                <span className="text-[11.5px] font-extrabold uppercase tracking-wide text-ink-soft">Od innych</span>
                <button onClick={() => setView("podarki")} className="text-xs font-extrabold text-mint hover:underline">
                  Zobacz →
                </button>
              </div>
              <div className="flex gap-2.5">
                {(["pożyczone", "otrzymane", "zamienione"] as GiftSource[]).map((s) => {
                  const style = GIFT_SOURCE_STYLE[s];
                  return (
                    <div key={s} className="flex min-w-0 flex-1 flex-col items-start gap-1.5 rounded-2xl p-3.5" style={{ background: style.bg }}>
                      <span className="flex h-[30px] w-[30px] items-center justify-center rounded-[10px] bg-white/60">
                        <GiftIcon c={style.c} />
                      </span>
                      <b className="font-serif text-[27px] leading-none" style={{ color: style.c }}>{giftCounts[s]}</b>
                      <small className="text-[11.5px] font-extrabold" style={{ color: style.c }}>{capitalize(s)}</small>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}

        {view === "profil" && (
          <div className="rounded-[22px] border border-line bg-paper p-5">
            <h3 className="mb-3.5 text-base font-semibold text-ink">Dane profilowe</h3>
            <div className="mb-5 flex items-center gap-4">
              <div className="flex h-[72px] w-[72px] flex-none items-center justify-center rounded-full border-[3px] border-mint-soft bg-mint-soft font-serif text-xl font-semibold text-mint">
                {initials(profile.display_name)}
              </div>
              <p className="text-xs text-ink-soft">
                Zdjęcie profilowe pojawi się tutaj, gdy będzie dostępne — dziś pokazujemy inicjały.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-extrabold tracking-wide text-ink-soft">Imię i nazwisko</label>
                <input
                  value={profile.display_name}
                  disabled
                  className="rounded-xl border-[1.5px] border-line bg-cream px-3.5 py-2.5 text-ink disabled:opacity-70"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="panel-location" className="text-xs font-extrabold tracking-wide text-ink-soft">
                  Lokalizacja
                </label>
                <input
                  id="panel-location"
                  value={localLocation}
                  onChange={(e) => setLocalLocation(e.target.value)}
                  placeholder="Miasto, dzielnica"
                  className="rounded-xl border-[1.5px] border-line bg-cream px-3.5 py-2.5 text-ink focus:border-mint focus:outline-none focus:ring-[3px] focus:ring-mint-soft"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="panel-bio" className="text-xs font-extrabold tracking-wide text-ink-soft">
                  O mnie
                </label>
                <textarea
                  id="panel-bio"
                  value={localBio}
                  onChange={(e) => setLocalBio(e.target.value)}
                  placeholder="Kilka zdań o Tobie"
                  className="min-h-[76px] resize-y rounded-xl border-[1.5px] border-line bg-cream px-3.5 py-2.5 text-ink focus:border-mint focus:outline-none focus:ring-[3px] focus:ring-mint-soft"
                />
              </div>
            </div>
            <div className="mt-4 flex flex-col gap-2.5">
              {profileSaved && <span className="text-center text-[13px] font-bold text-mint">✓ Zapisano</span>}
              <button
                onClick={saveProfile}
                className="w-full rounded-[13px] bg-mint px-5 py-3 text-[13.5px] font-extrabold text-white shadow-[0_8px_18px_-10px_rgba(27,129,104,0.85)] transition-transform hover:-translate-y-0.5"
              >
                Zapisz zmiany
              </button>
            </div>
          </div>
        )}

        {view === "ustawienia" && (
          <>
            <div className="rounded-[22px] border border-line bg-paper p-5">
              <h3 className="mb-1 text-base font-semibold text-ink">Powiadomienia</h3>
              <ToggleRow
                label="Powiadomienia e-mail"
                hint="Nowe zgłoszenia i wiadomości"
                checked={settings.emailNotifs}
                onChange={() => setSettings((s) => ({ ...s, emailNotifs: !s.emailNotifs }))}
              />
              <ToggleRow
                label="Powiadomienia SMS"
                hint="Przypomnienia o nadchodzących zajęciach"
                checked={settings.smsNotifs}
                onChange={() => setSettings((s) => ({ ...s, smsNotifs: !s.smsNotifs }))}
              />
            </div>
            <div className="mt-3.5 rounded-[22px] border border-line bg-paper p-5">
              <h3 className="mb-1 text-base font-semibold text-ink">Prywatność</h3>
              <ToggleRow
                label="Widoczny profil publiczny"
                hint="Inne rodziny mogą Cię znaleźć"
                checked={settings.publicProfile}
                onChange={() => setSettings((s) => ({ ...s, publicProfile: !s.publicProfile }))}
              />
            </div>
            <div className="mt-3.5 rounded-[22px] border border-line bg-paper p-5">
              <h3 className="mb-3.5 text-base font-semibold text-ink">Konto</h3>
              <button
                onClick={logout}
                className="flex w-full items-center justify-center gap-2 rounded-[13px] bg-danger-soft px-5 py-3 text-[13.5px] font-extrabold text-danger"
              >
                <LogoutIcon /> Wyloguj się
              </button>
            </div>
          </>
        )}

        {view === "spotkania" && isOrganizer && (
          <>
            <div>
              <div className="mb-3.5 flex items-start justify-between gap-2.5">
                <div>
                  <h2 className="text-[19px] font-semibold text-ink">Grupy</h2>
                  <small className="text-[12.5px] text-ink-soft">
                    {myGroups.length} {myGroups.length === 1 ? "grupa" : "grupy"}
                  </small>
                </div>
                <button
                  onClick={() => setModal("grupa")}
                  className="inline-flex flex-none items-center gap-1.5 rounded-full bg-ink px-[15px] py-2.5 text-[12.5px] font-extrabold text-[#EAF2E9] transition-transform hover:-translate-y-0.5"
                >
                  + Dodaj grupę
                </button>
              </div>
              <div className="rounded-[22px] border border-line bg-paper p-5">
                {myGroups.length === 0 && (
                  <div className="rounded-2xl border-[1.5px] border-dashed border-line py-[26px] text-center text-[13.5px] text-ink-soft">
                    Nie masz jeszcze żadnej grupy.
                  </div>
                )}
                {myGroups.map((g) => {
                  const extra = groupExtras[g.id];
                  return (
                    <div key={g.id} className="mt-2.5 flex items-start gap-3.5 rounded-2xl border border-line bg-cream p-[15px] first:mt-0">
                      <span className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-xl bg-mint-soft">
                        <BoxIcon c="#12604D" />
                      </span>
                      <div className="min-w-0 flex-1">
                        {renamingCircle === g.id ? (
                          <div className="flex items-center gap-2">
                            <input
                              aria-label="Nazwa kręgu"
                              autoFocus
                              value={circleNameDraft}
                              onChange={(e) => setCircleNameDraft(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") void saveRenameCircle(g);
                                if (e.key === "Escape") cancelRenameCircle();
                              }}
                              className="min-w-0 flex-1 rounded-xl border-[1.5px] border-line bg-cream px-3 py-2 text-ink"
                            />
                            <button
                              onClick={() => void saveRenameCircle(g)}
                              disabled={busy}
                              className="flex-none rounded-[11px] bg-mint px-3.5 py-2 text-[12.5px] font-extrabold text-white disabled:opacity-60"
                            >
                              Zapisz
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <h3 className="text-[15.5px] font-semibold text-ink">{g.name}</h3>
                            <button
                              onClick={() => startRenameCircle(g)}
                              aria-label="Zmień nazwę kręgu"
                              className="flex h-7 w-7 flex-none items-center justify-center rounded-[9px] text-ink-soft transition-colors hover:bg-paper hover:text-ink"
                            >
                              <PencilIcon />
                            </button>
                          </div>
                        )}
                        {circleRenameError?.groupId === g.id && (
                          <p className="mt-1.5 text-[12.5px] font-semibold text-danger">{circleRenameError.message}</p>
                        )}
                        {extra?.location && <small className="mt-0.5 block text-[12.5px] text-ink-soft">{extra.location}</small>}
                        {extra && extra.freeSpots > 0 && (
                          <span className="mt-1.5 inline-block rounded-full bg-lime-soft px-2.5 py-1 text-[11.5px] font-extrabold text-[#56701F]">
                            wolne {extra.freeSpots} miejsca
                          </span>
                        )}
                      </div>
                      <button
                        onClick={() => void handleRemoveGroup(g.id)}
                        aria-label={`Usuń grupę ${g.name}`}
                        className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[10px] text-ink-soft hover:bg-danger-soft hover:text-danger"
                      >
                        <TrashIcon />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="mt-7">
              <div className="mb-3.5 flex items-start justify-between gap-2.5">
                <div>
                  <h2 className="text-[19px] font-semibold text-ink">Terminy</h2>
                  <small className="text-[12.5px] text-ink-soft">
                    {terms.length} {terms.length === 1 ? "termin" : "terminy"}
                  </small>
                </div>
                <button
                  onClick={() => { setTermGroupId(myGroups[0]?.id ?? null); setModal("termin"); }}
                  className="inline-flex flex-none items-center gap-1.5 rounded-full bg-ink px-[15px] py-2.5 text-[12.5px] font-extrabold text-[#EAF2E9] transition-transform hover:-translate-y-0.5"
                >
                  + Dodaj termin
                </button>
              </div>
              <div className="rounded-[22px] border border-line bg-paper p-5">
                {terms.length === 0 && (
                  <div className="rounded-2xl border-[1.5px] border-dashed border-line py-[26px] text-center text-[13.5px] text-ink-soft">
                    Brak zaplanowanych terminów.
                  </div>
                )}
                {terms.map(({ term, group, neededItems }) => (
                  <div key={term.id} className="mt-2.5 first:mt-0">
                    {organizerTermCard(term, group, neededItems)}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {view === "spotkania" && !isOrganizer && (
          <div>
            <div className="mb-3.5">
              <h2 className="text-[19px] font-semibold text-ink">Spotkania</h2>
              <small className="text-[12.5px] text-ink-soft">
                {terms.length === 0
                  ? "Nie jesteś jeszcze zapisana na żadne zajęcia"
                  : `${terms.length} ${terms.length === 1 ? "termin, na który jesteś zapisana" : "terminy, na które jesteś zapisana"}`}
              </small>
            </div>
            <div className="rounded-[22px] border border-line bg-paper p-5">
              {terms.length === 0 && (
                <div className="rounded-2xl border-[1.5px] border-dashed border-line py-[26px] text-center text-[13.5px] text-ink-soft">
                  Nie jesteś jeszcze zapisana na żadne zajęcia.
                </div>
              )}
              {terms.map(({ term, group, neededItems }) => {
                const { day, month } = dayMonth(term.occurs_on);
                return (
                  <Link
                    key={term.id}
                    to={termPublicPath(group, term.id)}
                    className="mt-2.5 flex items-start gap-3.5 rounded-2xl border border-line bg-cream p-[15px] transition-colors first:mt-0 hover:border-mint"
                  >
                    <div className="flex h-[46px] w-[46px] flex-none flex-col items-center justify-center rounded-[13px] bg-mint-soft leading-none">
                      <b className="font-serif text-base text-ink">{day}</b>
                      <small className="text-[9.5px] uppercase tracking-wide text-ink-soft">{month}</small>
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-[15.5px] font-semibold text-ink">{group.name}</h3>
                      <small className="mt-0.5 block text-[12.5px] text-ink-soft">{term.description || "Bez opisu"}</small>
                      {neededItems.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {neededItems.map((ni) => (
                            <span key={ni.id} className="rounded-full bg-lime-soft px-2.5 py-0.5 text-[10.5px] font-extrabold text-[#56701F]">
                              {NEEDED_ITEM_LABELS[ni.category]}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        {view === "rzeczy" && (
          <div>
            <div className="mb-3.5 flex items-start justify-between gap-2.5">
              <div>
                <h2 className="text-[19px] font-semibold text-ink">Moje rzeczy</h2>
                <small className="text-[12.5px] text-ink-soft">
                  {items.length} {items.length === 1 ? "rzecz" : "rzeczy"}
                </small>
              </div>
              <button
                onClick={() => { setItemDraft(createEmptyItemQuickAddValue()); setModal("rzecz"); }}
                className="inline-flex flex-none items-center gap-1.5 rounded-full bg-ink px-[15px] py-2.5 text-[12.5px] font-extrabold text-[#EAF2E9] transition-transform hover:-translate-y-0.5"
              >
                + Dodaj rzecz
              </button>
            </div>
            <div className="rounded-[22px] border border-line bg-paper p-5">
              {items.length === 0 && (
                <div className="rounded-2xl border-[1.5px] border-dashed border-line py-[26px] text-center text-[13.5px] text-ink-soft">
                  Nie masz jeszcze żadnej rzeczy.
                </div>
              )}
              {items.map((it) => {
                const mode = itemModes[it.id] ?? null;
                const style = mode ? ITEM_MODE_STYLE[mode] : null;
                return (
                  <div key={it.id} className="mt-2.5 flex items-start gap-3.5 rounded-2xl border border-line bg-cream p-[15px] first:mt-0">
                    <span
                      className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-xl"
                      style={{ background: style ? style.bg : "var(--color-line)" }}
                    >
                      <BoxIcon c={style ? style.c : "#5C7069"} />
                    </span>
                    <div className="min-w-0 flex-1">
                      {editingItemMeta?.id === it.id ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            aria-label="Nazwa rzeczy"
                            value={editingItemMeta.name}
                            onChange={(e) =>
                              setEditingItemMeta((s) => (s ? { ...s, name: e.target.value } : s))
                            }
                            onKeyDown={(e) => {
                              if (e.key === "Enter") void saveItemMeta();
                              if (e.key === "Escape") setEditingItemMeta(null);
                            }}
                            className="min-w-0 flex-1 rounded-lg border-[1.5px] border-line bg-cream px-2 py-1.5 text-[13.5px] text-ink"
                          />
                          <select
                            aria-label="Typ rzeczy"
                            value={editingItemMeta.category}
                            onChange={(e) =>
                              setEditingItemMeta((s) =>
                                s ? { ...s, category: e.target.value as ProductCategory } : s,
                              )
                            }
                            onKeyDown={(e) => {
                              if (e.key === "Enter") void saveItemMeta();
                              if (e.key === "Escape") setEditingItemMeta(null);
                            }}
                            className="rounded-lg border-[1.5px] border-line bg-cream px-2 py-1.5 text-[12.5px] text-ink"
                          >
                            {PRODUCT_CATEGORIES.map((c) => (
                              <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
                            ))}
                          </select>
                          <button
                            onClick={() => void saveItemMeta()}
                            disabled={busy}
                            className="flex-none rounded-[9px] bg-mint px-3 py-1.5 text-[11.5px] font-extrabold text-white disabled:opacity-60"
                          >
                            Zapisz
                          </button>
                          <button
                            onClick={() => setEditingItemMeta(null)}
                            className="flex-none rounded-[9px] border border-line px-2.5 py-1.5 text-[11.5px] font-extrabold text-ink-soft"
                          >
                            Anuluj
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <h3 className="text-[15.5px] font-semibold text-ink">{productName(it.product_id)}</h3>
                          <button
                            onClick={() => startEditItemMeta(it)}
                            aria-label={`Edytuj rzecz ${productName(it.product_id)}`}
                            className="flex h-6 w-6 flex-none items-center justify-center rounded-[8px] text-ink-soft transition-colors hover:bg-paper hover:text-ink"
                          >
                            <PencilIcon />
                          </button>
                        </div>
                      )}
                      {editingItemMeta?.id === it.id && itemMetaError && (
                        <p className="mt-1 text-[12.5px] font-semibold text-danger">{itemMetaError}</p>
                      )}
                      {editingItemCondition?.id === it.id ? (
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <select
                            aria-label="Stan rzeczy"
                            value={editingItemCondition.condition}
                            onChange={(e) =>
                              setEditingItemCondition((s) =>
                                s ? { ...s, condition: e.target.value as ItemCondition } : s,
                              )
                            }
                            className="rounded-lg border-[1.5px] border-line bg-cream px-2 py-1.5 text-[12.5px] text-ink"
                          >
                            {(Object.keys(CONDITION_LABELS) as ItemCondition[]).map((c) => (
                              <option key={c} value={c}>{CONDITION_LABELS[c]}</option>
                            ))}
                          </select>
                          <button
                            onClick={() => void saveItemCondition()}
                            disabled={busy}
                            className="flex-none rounded-[9px] bg-mint px-3 py-1.5 text-[11.5px] font-extrabold text-white disabled:opacity-60"
                          >
                            Zapisz
                          </button>
                          <button
                            onClick={() => setEditingItemCondition(null)}
                            className="flex-none rounded-[9px] border border-line px-2.5 py-1.5 text-[11.5px] font-extrabold text-ink-soft"
                          >
                            Anuluj
                          </button>
                        </div>
                      ) : (
                        <div className="mt-0.5 flex items-center gap-1.5">
                          <small className="text-[12.5px] text-ink-soft">
                            Stan: {CONDITION_LABELS[it.condition]}
                          </small>
                          <button
                            onClick={() => setEditingItemCondition({ id: it.id, condition: it.condition })}
                            aria-label="Edytuj stan rzeczy"
                            className="flex h-6 w-6 flex-none items-center justify-center rounded-[8px] text-ink-soft transition-colors hover:bg-paper hover:text-ink"
                          >
                            <PencilIcon />
                          </button>
                        </div>
                      )}
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {ITEM_MODES.map((m) => {
                          const on = mode === m;
                          const mStyle = ITEM_MODE_STYLE[m];
                          return (
                            <button
                              key={m}
                              onClick={() => setItemMode(it.id, m)}
                              aria-pressed={on}
                              className="rounded-full border-[1.5px] border-line px-3 py-1.5 text-[11.5px] font-extrabold text-ink-soft transition-colors hover:border-sage"
                              style={on ? { background: mStyle.bg, color: mStyle.c, borderColor: "transparent" } : undefined}
                            >
                              {capitalize(m)}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <button
                      onClick={() => void handleDeleteItem(it.id)}
                      aria-label={`Usuń rzecz ${productName(it.product_id)}`}
                      className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[10px] text-ink-soft hover:bg-danger-soft hover:text-danger"
                    >
                      <TrashIcon />
                    </button>
                  </div>
                );
              })}
              {itemError && (
                <p className="mt-2 text-[12.5px] font-semibold text-danger">{itemError}</p>
              )}
            </div>
          </div>
        )}

        {view === "podarki" && (
          <div>
            <div className="mb-3.5">
              <h2 className="text-[19px] font-semibold text-ink">Podarki</h2>
              <small className="text-[12.5px] text-ink-soft">
                rzeczy od innych rodzin, które wypożyczyłaś lub się wymieniłaś
              </small>
            </div>
            <div className="rounded-[22px] border border-line bg-paper p-5">
              {gifts.length === 0 && (
                <div className="rounded-2xl border-[1.5px] border-dashed border-line py-[26px] text-center text-[13.5px] text-ink-soft">
                  Nie masz jeszcze żadnego podarku.
                </div>
              )}
              {gifts.map((g) => {
                const style = GIFT_SOURCE_STYLE[g.source];
                return (
                  <div key={g.id} className="mt-2.5 flex items-start gap-3.5 rounded-2xl border border-line bg-cream p-[15px] first:mt-0">
                    <span className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-xl" style={{ background: style.bg }}>
                      <GiftIcon c={style.c} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-[15.5px] font-semibold text-ink">{g.name}</h3>
                      <small className="mt-0.5 block text-[12.5px] text-ink-soft">Od: {g.from}</small>
                      <span className="mt-1.5 inline-block rounded-full px-2.5 py-1 text-[11.5px] font-extrabold" style={{ background: style.bg, color: style.c }}>
                        {capitalize(g.source)}
                      </span>
                    </div>
                    <button
                      onClick={() => removeGift(g.id)}
                      aria-label={`Usuń podarek ${g.name}`}
                      className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[10px] text-ink-soft hover:bg-danger-soft hover:text-danger"
                    >
                      <TrashIcon />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {view === "rodzina" && family === null && (
          <div>
            <div className="mb-3.5">
              <h2 className="text-[19px] font-semibold text-ink">Mój dom</h2>
            </div>
            <div className="rounded-2xl border-[1.5px] border-dashed border-line p-6 text-center">
              <p className="text-[15px] font-semibold text-ink">Nie masz jeszcze rodziny</p>
              <p className="mt-1.5 text-[13.5px] text-ink-soft">
                Załóż rodzinę, aby dodać opiekunów i dzieci oraz wspólnie zapisywać się na zajęcia.
              </p>
              <button
                onClick={() => setModal("rodzina-nowa")}
                className="mt-4 rounded-[13px] bg-mint px-5 py-3 text-[13.5px] font-extrabold text-white"
              >
                Załóż rodzinę
              </button>
            </div>
          </div>
        )}

        {view === "rodzina" && family !== null && (
          <div>
            <div className="mb-3.5">
              <h2 className="text-[19px] font-semibold text-ink">Mój dom</h2>
              {renamingFamily ? (
                <div className="mt-1.5 flex items-center gap-2">
                  <input
                    aria-label="Nazwa rodziny"
                    autoFocus
                    value={familyNameDraft}
                    onChange={(e) => setFamilyNameDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void saveRenameFamily();
                      if (e.key === "Escape") cancelRenameFamily();
                    }}
                    onBlur={() => {
                      if (familyNameDraft.trim() === family.name) cancelRenameFamily();
                    }}
                    className="min-w-0 flex-1 rounded-xl border-[1.5px] border-line bg-cream px-3 py-2 text-ink"
                  />
                  <button
                    onClick={() => void saveRenameFamily()}
                    disabled={busy}
                    className="flex-none rounded-[11px] bg-mint px-3.5 py-2 text-[12.5px] font-extrabold text-white disabled:opacity-60"
                  >
                    Zapisz
                  </button>
                </div>
              ) : (
                <div className="mt-1.5 flex items-center gap-2">
                  <h3 className="text-[15.5px] font-semibold text-ink">{family.name}</h3>
                  <button
                    onClick={startRenameFamily}
                    aria-label="Zmień nazwę rodziny"
                    className="flex h-7 w-7 items-center justify-center rounded-[9px] text-ink-soft transition-colors hover:bg-cream hover:text-ink"
                  >
                    <PencilIcon />
                  </button>
                </div>
              )}
              {renameError && (
                <p className="mt-1.5 text-[12.5px] font-semibold text-danger">{renameError}</p>
              )}
              <small className="mt-1 block text-[12.5px] text-ink-soft">
                {guardians.length} {guardians.length === 1 ? "osoba" : "osoby"}
              </small>
            </div>
            <div className="rounded-[22px] border border-line bg-paper p-5">
              {guardians.length === 0 && (
                <div className="rounded-2xl border-[1.5px] border-dashed border-line py-[26px] text-center text-[13.5px] text-ink-soft">
                  Nie masz jeszcze żadnych członków rodziny.
                </div>
              )}
              {guardians.map((g) => (
                <div
                  key={g.family_membership_id}
                  className="mt-2.5 flex items-center gap-3.5 rounded-2xl border border-line bg-cream p-[15px] first:mt-0"
                >
                  <div className="min-w-0 flex-1">
                    <h3 className="text-[15.5px] font-semibold text-ink">
                      {g.display_name}
                      {g.party_id === profile.party_id && <span className="ml-1.5 text-ink-soft">(Ty)</span>}
                      {g.party_id !== profile.party_id && <span className="ml-1.5 text-ink-soft">(opiekun)</span>}
                    </h3>
                  </div>
                  {g.party_id !== profile.party_id && (
                    <button
                      onClick={() => void handleRemoveFamilyMember(g)}
                      disabled={busy}
                      aria-label={`Usuń członka rodziny ${g.display_name}`}
                      className="flex h-7 w-7 flex-none items-center justify-center rounded-[9px] text-ink-soft transition-colors hover:bg-paper hover:text-danger disabled:opacity-60"
                    >
                      <TrashIcon />
                    </button>
                  )}
                </div>
              ))}
              {familyMemberError && (
                <p className="mt-2.5 text-[12.5px] font-semibold text-danger">{familyMemberError}</p>
              )}
            </div>

            <div className="mt-7">
              <h3 className="mb-3.5 text-base font-semibold text-ink">Dodaj kolejnego członka</h3>
              <div className="rounded-[22px] border border-line bg-paper p-5">
                <div className="grid grid-cols-1 gap-3">
                  <Field label="Imię i nazwisko">
                    <input
                      value={memberName}
                      onChange={(e) => setMemberName(e.target.value)}
                      placeholder="np. Zosia Kowalska"
                      className="rounded-xl border-[1.5px] border-line bg-cream px-3.5 py-2.5 text-ink"
                    />
                  </Field>
                  <Field label="Rola">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setMemberRole("GUARDIAN")}
                        aria-pressed={memberRole === "GUARDIAN"}
                        className={`flex-1 rounded-xl border-[1.5px] px-3 py-2.5 text-sm font-bold transition ${
                          memberRole === "GUARDIAN" ? "border-mint bg-mint-soft text-mint" : "border-line bg-cream text-ink-soft"
                        }`}
                      >
                        Opiekun
                      </button>
                      <button
                        type="button"
                        onClick={() => setMemberRole("CHILD")}
                        aria-pressed={memberRole === "CHILD"}
                        className={`flex-1 rounded-xl border-[1.5px] px-3 py-2.5 text-sm font-bold transition ${
                          memberRole === "CHILD" ? "border-mint bg-mint-soft text-mint" : "border-line bg-cream text-ink-soft"
                        }`}
                      >
                        Dziecko
                      </button>
                    </div>
                  </Field>
                </div>
                <button
                  onClick={() => void handleAddFamilyMember()}
                  disabled={busy || !memberName.trim()}
                  className="mt-4 w-full rounded-[13px] bg-mint px-5 py-3 text-[13.5px] font-extrabold text-white disabled:opacity-60"
                >
                  Dodaj
                </button>
              </div>
            </div>
          </div>
        )}
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
