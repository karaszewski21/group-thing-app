import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import {
  getMyNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationResponse,
} from "../../api/notifications";
import { getMyPledges, withdrawPledge, type MyPledgeResponse } from "../../api/pledges";
import {
  createLightweightMembers,
  getGuardians,
  getMembershipsForFamily,
  getMyFamilies,
  removeFamilyMember,
  renameFamily,
  type FamilyOut,
  type GuardianResponse,
} from "../../api/families";
import {
  createMyCircle,
  endLeadership,
  getGroup,
  getMyAttendances,
  updateCircle,
  type GroupResponse,
  type LeadershipResponse,
  type MyAttendanceResponse,
} from "../../api/groups";
import {
  createInventory,
  deleteInventoryItem,
  getInventories,
  getInventoryItems,
  registerInventoryItem,
  updateInventoryItem,
  type InventoryItemResponse,
  type ItemCondition,
} from "../../api/inventories";
import { getLeadershipsForPerson, getMyProfile, type UserProfileResponse } from "../../api/people";
import { getMyOrganization } from "../../api/organizations";
import {
  getProducts,
  resolveProduct,
  type ProductCategory,
  type ProductResponse,
} from "../../api/products";
import {
  createNeededItem,
  createTerm,
  getNeededItems,
  getTerms,
  type NeededItemResponse,
  type TermResponse,
} from "../../api/terms";
import { createEmptyItemQuickAddValue, type ItemQuickAddValue } from "../../utils/itemQuickAdd";
import {
  createEmptyNeededItemQuickAddValue,
  type NeededItemQuickAddValue,
} from "../../utils/neededItemQuickAdd";
import { ApiError } from "../../api/client";
import { CopyIcon, PencilIcon } from "./panelIcons";
import {
  dayMonth,
  termTime,
  termPublicPath,
  type ItemMode,
  type LocalGift,
  type ModalKind,
  type TermWithNeeded,
  type View,
} from "./panelHelpers";
import { PanelDataContext } from "./panelDataStore";

/* ------------------------------------------------------------------ */
/*  Panel — warstwa stanu (state/effects/handlers/derived) wydzielona  */
/*  z PanelPage.tsx w niezmienionej postaci. Render (widoki/nagłówek/  */
/*  nawigacja/modale) zostaje w PanelPage.tsx i czyta stąd przez       */
/*  usePanelData(). Zero zmian zachowania.                              */
/* ------------------------------------------------------------------ */

export type PanelDataContextValue = ReturnType<typeof usePanelDataValue>;

function usePanelDataValue() {
  const { logout } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<UserProfileResponse | null>(null);
  const [myLeaderships, setMyLeaderships] = useState<LeadershipResponse[]>([]);
  const [myGroups, setMyGroups] = useState<GroupResponse[]>([]);
  const [guestCircles, setGuestCircles] = useState<GroupResponse[]>([]);
  const [terms, setTerms] = useState<TermWithNeeded[]>([]);
  const [family, setFamily] = useState<FamilyOut | null>(null);
  const [guardians, setGuardians] = useState<GuardianResponse[]>([]);
  const [myAttendances, setMyAttendances] = useState<MyAttendanceResponse[]>([]);
  // "Zadeklarowane rzeczy" (HomeView) — the caller's own non-withdrawn pledges.
  const [myPledges, setMyPledges] = useState<MyPledgeResponse[]>([]);
  // In-app notification bell (PanelHeader). `notifOpen` drives the dropdown.
  const [notifications, setNotifications] = useState<NotificationResponse[]>([]);
  const [notifOpen, setNotifOpen] = useState(false);
  // Inline "Mój dom" family rename (D4 / TC4) — no dedicated modal.
  const [renamingFamily, setRenamingFamily] = useState(false);
  const [familyNameDraft, setFamilyNameDraft] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [familyMemberError, setFamilyMemberError] = useState<string | null>(null);
  // Term editing (date, description, needed-items sub-CRUD) lives in the
  // `EditTermDialog` opened from each organizer tile — the tile itself is a
  // read-only compact card. `editTermId` is resolved back to a live `terms`
  // entry at render time so the open dialog always sees fresh props after a
  // `load({ silent: true })` refresh.
  const [editTermId, setEditTermId] = useState<number | null>(null);
  // Inline circle rename next to each led circle in the "Grupy" section.
  const [renamingCircle, setRenamingCircle] = useState<number | null>(null);
  const [circleNameDraft, setCircleNameDraft] = useState("");
  const [circleRenameError, setCircleRenameError] = useState<
    { groupId: number; message: string } | null
  >(null);
  // InventoryItem condition edit + optimistic delete in the "Moje rzeczy" view.
  const [editingItemCondition, setEditingItemCondition] = useState<
    { id: number; condition: ItemCondition } | null
  >(null);
  const [itemError, setItemError] = useState<string | null>(null);
  // Inline name+category edit for a single item — re-resolves a Product then
  // re-points the item's product_id at it.
  const [editingItemMeta, setEditingItemMeta] = useState<
    { id: number; name: string; category: ProductCategory } | null
  >(null);
  const [itemMetaError, setItemMetaError] = useState<string | null>(null);
  // `null` = no Organization created yet (404) — "Moja organizacja"/the
  // org-polish hint then link to the /organization create form; once an
  // Organization exists, both link straight to its public page instead.
  const [organizationSlug, setOrganizationSlug] = useState<string | null>(null);

  // Either signal makes someone an organizer, independently:
  // - `profile.is_organizer`: the users-BC UserRole(ORGANIZATOR) grant —
  //   set at ORGANIZER registration. Covers a freshly-registered organizer
  //   who hasn't created a circle yet (e.g. skipped onboarding).
  // - `myGroups.length > 0`: actually leading >=1 Circle. Covers the
  //   "Chcę dodać krąg" GUEST->organizer promotion, which grants a
  //   groups-BC GroupRole(ORGANIZATOR) via `create_own_circle` but
  //   deliberately does NOT touch the users-BC UserRole — promotion via
  //   that path was never meant to imply a global "may found
  //   Organizations" declaration, just "leads this one Circle now".
  // A plain `??` here would be wrong: `profile.is_organizer === false` is
  // itself meaningful (not "unknown"), so it must not suppress the
  // Circle-ownership check.
  const isOrganizer = profile?.is_organizer === true || myGroups.length > 0;

  const [view, setView] = useState<View>("home");
  const [modal, setModal] = useState<ModalKind>(null);
  // Which "pierwszy-termin" variant to render, captured at the moment the
  // hamburger item is clicked rather than read live from `isOrganizer` at
  // render time — the GUEST stepper's own step 1 flips `isOrganizer` via a
  // silent `load()` mid-flow (spec.md §2), and re-deriving the branch from
  // the live value on every render would swap the mounted component out
  // from under the user (losing the just-created circle / step-2 progress)
  // the instant that happens. The picking decision itself still lives only
  // in the host, per spec.md §2 — this just freezes *when* it is read.
  const [firstTermForOrganizer, setFirstTermForOrganizer] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState(false);

  // --- Panel home dismissible hints (spec.md §3) — dismissible-banner
  // `localStorage` convention: read the flag once on mount, write it on
  // dismiss-click. Independent flags:
  //  - `hint_first_term_dismissed`  — GUEST "add your first term" nudge (!isOrganizer)
  //  - `hint_become_organizer_dismissed` — GUEST "you can become an organizer" nudge (!isOrganizer)
  //  - `hint_org_first_term_dismissed` — ORGANIZER-with-zero-terms nudge; a SEPARATE
  //    key from the guest one so a guest who dismissed the pre-promotion card
  //    still sees this one after creating their circle.
  //  - `hint_org_polish_dismissed`  — ORGANIZER-only "polish your org page" nudge
  const [hintFirstTermDismissed, setHintFirstTermDismissed] = useState(
    () => localStorage.getItem("hint_first_term_dismissed") === "1",
  );
  const [hintBecomeOrganizerDismissed, setHintBecomeOrganizerDismissed] = useState(
    () => localStorage.getItem("hint_become_organizer_dismissed") === "1",
  );
  const [hintOrgFirstTermDismissed, setHintOrgFirstTermDismissed] = useState(
    () => localStorage.getItem("hint_org_first_term_dismissed") === "1",
  );
  const [hintOrgPolishDismissed, setHintOrgPolishDismissed] = useState(
    () => localStorage.getItem("hint_org_polish_dismissed") === "1",
  );

  function dismissFirstTermHint() {
    localStorage.setItem("hint_first_term_dismissed", "1");
    setHintFirstTermDismissed(true);
  }

  function dismissBecomeOrganizerHint() {
    localStorage.setItem("hint_become_organizer_dismissed", "1");
    setHintBecomeOrganizerDismissed(true);
  }

  function dismissOrgFirstTermHint() {
    localStorage.setItem("hint_org_first_term_dismissed", "1");
    setHintOrgFirstTermDismissed(true);
  }

  function dismissOrgPolishHint() {
    localStorage.setItem("hint_org_polish_dismissed", "1");
    setHintOrgPolishDismissed(true);
  }

  // --- lokalne, niepersystentne pola (patrz komentarz na górze pliku) ---
  const [localBio, setLocalBio] = useState("");
  const [localLocation, setLocalLocation] = useState("");
  const [profileSaved, setProfileSaved] = useState(false);
  const [settings, setSettings] = useState({ emailNotifs: true, smsNotifs: false, publicProfile: true });
  const [groupExtras, setGroupExtras] = useState<Record<number, { location: string; freeSpots: number }>>({});
  const [itemModes, setItemModes] = useState<Record<number, ItemMode | null>>({});
  const [gifts, setGifts] = useState<LocalGift[]>([]);

  // --- formularz: dodaj członka rodziny ("Rodzina" section, inline form) ---
  const [memberName, setMemberName] = useState("");
  const [memberRole, setMemberRole] = useState<"GUARDIAN" | "CHILD">("GUARDIAN");

  // --- formularz: dodaj grupę ---
  const [groupForm, setGroupForm] = useState({ name: "", location: "", freeSpots: "" });

  // --- formularz: dodaj termin ---
  const [termGroupId, setTermGroupId] = useState<number | null>(null);
  const [termDate, setTermDate] = useState("");
  const [termDescription, setTermDescription] = useState("");
  const [neededDraft, setNeededDraft] = useState<NeededItemQuickAddValue[]>([]);
  const [draftNeededItem, setDraftNeededItem] = useState<NeededItemQuickAddValue>(
    createEmptyNeededItemQuickAddValue(),
  );

  // --- Moje rzeczy (realny Inventory/InventoryItem/Product) ---
  const [inventoryId, setInventoryId] = useState<number | null>(null);
  const [items, setItems] = useState<InventoryItemResponse[]>([]);
  const [products, setProducts] = useState<ProductResponse[]>([]);
  const [itemDraft, setItemDraft] = useState<ItemQuickAddValue>(createEmptyItemQuickAddValue());

  const showToast = useCallback((msg: string) => setToast(msg), []);

  const load = useCallback(async (options?: { silent?: boolean }) => {
    // `silent` skips the full-page "Wczytywanie…" early-return branch — used
    // when a mid-flow modal (e.g. FirstTermStepperGuest's step 1 -> step 2
    // transition) needs `myGroups`/`isOrganizer` refreshed in the background
    // without unmounting the still-open modal underneath it.
    if (!options?.silent) setLoading(true);
    setError(null);
    try {
      const me = await getMyProfile();
      setProfile(me);

      // The authenticated user's own profile always has a login-backed
      // `account_user_id` — only lightweight family members (who never
      // log in) can have a null one, so this fail-fast guard should never
      // actually trigger for `me` (`standards/global/error-handling.md`).
      if (me.account_user_id == null) {
        throw new Error("Zalogowany profil nie ma powiązanego konta użytkownika");
      }

      const [leaderships, inventories, productsData] = await Promise.all([
        getLeadershipsForPerson(me.id),
        getInventories(me.account_user_id),
        getProducts(),
      ]);
      setProducts(productsData);

      let inventory = inventories.find((i) => i.inventory_type === "PERSONAL") ?? null;
      if (!inventory) inventory = await createInventory({ inventory_type: "PERSONAL" });
      setInventoryId(inventory.id);
      setItems(await getInventoryItems(inventory.id));

      const activeLeaderships = leaderships.filter((l) => l.valid_to === null);
      setMyLeaderships(activeLeaderships);

      // "Rodzina" section (§7): family membership is independent of
      // organizer status, so this runs for both GUEST and ORGANIZER —
      // fetched once here and reused below for the guest-circles branch
      // instead of a second `getMyFamilies()` round trip.
      const myFamilies = await getMyFamilies();
      const myFamily = myFamilies[0] ?? null;
      setFamily(myFamily);
      setGuardians(myFamily ? await getGuardians(myFamily.id) : []);

      try {
        const organization = await getMyOrganization();
        setOrganizationSlug(organization.slug);
      } catch {
        // No Organization yet (404) — links fall back to the create form.
        setOrganizationSlug(null);
      }

      // "Zapisane zajęcia" (§R9) — read-only home-screen section. Guarded so
      // a failure here still lets the rest of the home view render.
      try {
        setMyAttendances(await getMyAttendances());
      } catch {
        setMyAttendances([]);
      }

      // "Zadeklarowane rzeczy" + notification bell — same guarded pattern.
      try {
        setMyPledges(await getMyPledges());
      } catch {
        setMyPledges([]);
      }
      try {
        setNotifications(await getMyNotifications());
      } catch {
        setNotifications([]);
      }

      let relevantGroups: GroupResponse[];
      if (activeLeaderships.length > 0) {
        relevantGroups = await Promise.all(activeLeaderships.map((l) => getGroup(l.to_group_id)));
        setMyGroups(relevantGroups);
        setGuestCircles([]);
      } else {
        setMyGroups([]);
        if (myFamily) {
          const memberships = await getMembershipsForFamily(myFamily.id);
          const active = memberships.filter((m) => m.valid_to === null);
          relevantGroups = await Promise.all(active.map((m) => getGroup(m.to_group_id)));
        } else {
          relevantGroups = [];
        }
        setGuestCircles(relevantGroups);
      }

      const termsByGroup = await Promise.all(
        relevantGroups.map(async (group) => {
          const groupTerms = await getTerms(group.id);
          return Promise.all(
            groupTerms.map(async (term) => ({
              term,
              group,
              neededItems: await getNeededItems(term.id),
            })),
          );
        }),
      );
      const flattened = termsByGroup.flat().sort((a, b) => a.term.occurs_on.localeCompare(b.term.occurs_on));
      setTerms(flattened);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nie udało się wczytać panelu");
    } finally {
      if (!options?.silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  function productName(productId: number): string {
    return products.find((p) => p.id === productId)?.name ?? `#${productId}`;
  }

  /* ---------- zadeklarowane rzeczy / powiadomienia ---------- */

  async function withdrawMyPledge(pledgeId: number) {
    setBusy(true);
    try {
      await withdrawPledge(pledgeId);
      showToast("Wycofano zgłoszenie");
      await load({ silent: true });
    } catch {
      showToast("Nie udało się wycofać zgłoszenia");
    } finally {
      setBusy(false);
    }
  }

  const unreadCount = notifications.filter((n) => n.read_at === null).length;

  async function openNotification(n: NotificationResponse) {
    setNotifOpen(false);
    if (n.read_at === null) {
      setNotifications((prev) =>
        prev.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)),
      );
      void markNotificationRead(n.id).catch(() => undefined);
    }
    if (n.link_path) navigate(n.link_path);
  }

  async function markAllRead() {
    setNotifications((prev) =>
      prev.map((n) => (n.read_at === null ? { ...n, read_at: new Date().toISOString() } : n)),
    );
    try {
      await markAllNotificationsRead();
    } catch {
      await load({ silent: true });
    }
  }

  /* ---------- grupy ---------- */

  async function handleAddGroup() {
    if (!groupForm.name.trim()) return;
    setBusy(true);
    try {
      const group = await createMyCircle({ name: groupForm.name.trim() });
      if (groupForm.location.trim() || groupForm.freeSpots.trim()) {
        setGroupExtras((prev) => ({
          ...prev,
          [group.id]: { location: groupForm.location.trim(), freeSpots: Number(groupForm.freeSpots) || 0 },
        }));
      }
      setGroupForm({ name: "", location: "", freeSpots: "" });
      setModal(null);
      showToast("Dodano grupę");
      await load();
    } catch {
      showToast("Nie udało się dodać grupy");
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoveGroup(groupId: number) {
    const leadership = myLeaderships.find((l) => l.to_group_id === groupId);
    if (!leadership) return;
    setBusy(true);
    try {
      await endLeadership(leadership.id);
      showToast("Usunięto grupę");
      await load();
    } catch {
      showToast("Nie udało się usunąć grupy");
    } finally {
      setBusy(false);
    }
  }

  /* ---------- terminy ---------- */

  function addDraftNeededItem() {
    if (!draftNeededItem.name.trim()) return;
    setNeededDraft((prev) => [
      ...prev,
      { ...draftNeededItem, name: draftNeededItem.name.trim(), description: draftNeededItem.description.trim() },
    ]);
    setDraftNeededItem(createEmptyNeededItemQuickAddValue());
  }

  function removeDraftNeededItem(index: number) {
    setNeededDraft((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleAddTerm() {
    if (!termGroupId || !termDate) return;
    setBusy(true);
    try {
      const term = await createTerm({
        circle_group_id: termGroupId,
        occurs_on: termDate,
        description: termDescription || undefined,
      });
      for (const draft of neededDraft) {
        const product = await resolveProduct({ name: draft.name, category: draft.category });
        await createNeededItem({
          term_id: term.id,
          product_id: product.id,
          description: draft.description || undefined,
        });
      }
      setTermGroupId(null);
      setTermDate("");
      setTermDescription("");
      setNeededDraft([]);
      setModal(null);
      showToast("Dodano termin");
      await load();
    } catch {
      showToast("Nie udało się dodać terminu");
    } finally {
      setBusy(false);
    }
  }

  /* ---------- rzeczy ---------- */

  async function handleAddItem() {
    if (inventoryId === null) return;
    if (!itemDraft.name.trim()) return;
    setBusy(true);
    try {
      const product = await resolveProduct({ name: itemDraft.name.trim(), category: itemDraft.category });
      await registerInventoryItem({
        inventory_id: inventoryId,
        product_id: product.id,
        condition: itemDraft.condition,
      });
      setItemDraft(createEmptyItemQuickAddValue());
      setModal(null);
      showToast("Dodano rzecz");
      setItems(await getInventoryItems(inventoryId));
    } catch {
      showToast("Nie udało się dodać rzeczy");
    } finally {
      setBusy(false);
    }
  }

  function setItemMode(itemId: number, mode: ItemMode) {
    setItemModes((prev) => ({ ...prev, [itemId]: prev[itemId] === mode ? null : mode }));
  }

  const itemCounts = useMemo(
    () => ({
      "wypożyczę": items.filter((i) => itemModes[i.id] === "wypożyczę").length,
      "oddam": items.filter((i) => itemModes[i.id] === "oddam").length,
      "zamienię": items.filter((i) => itemModes[i.id] === "zamienię").length,
    }),
    [items, itemModes],
  );

  /* ---------- rodzina ---------- */

  async function handleAddFamilyMember() {
    if (!memberName.trim()) return;
    setBusy(true);
    try {
      await createLightweightMembers([{ name: memberName.trim(), role_type: memberRole }]);
      setMemberName("");
      setMemberRole("GUARDIAN");
      showToast("Dodano członka rodziny");
      await load();
    } catch {
      showToast("Nie udało się dodać członka rodziny");
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoveFamilyMember(g: GuardianResponse) {
    if (!family) return;
    setBusy(true);
    setFamilyMemberError(null);
    try {
      await removeFamilyMember(family.id, g.family_membership_id);
      await load({ silent: true });
    } catch (err) {
      // 409 (last guardian) / 403 carry a server message — surface it;
      // otherwise a generic fallback (mirrors AccountMergeForm).
      if (err instanceof ApiError && err.body && typeof err.body === "object" && "message" in err.body) {
        setFamilyMemberError(
          String((err.body as { message?: unknown }).message ?? "Nie udało się usunąć członka rodziny — spróbuj ponownie"),
        );
      } else {
        setFamilyMemberError("Nie udało się usunąć członka rodziny — spróbuj ponownie");
      }
    } finally {
      setBusy(false);
    }
  }

  function startRenameFamily() {
    if (!family) return;
    setFamilyNameDraft(family.name);
    setRenameError(null);
    setRenamingFamily(true);
  }

  function cancelRenameFamily() {
    setRenamingFamily(false);
    setRenameError(null);
  }

  async function saveRenameFamily() {
    if (!family) return;
    const next = familyNameDraft.trim();
    if (!next || next === family.name) {
      cancelRenameFamily();
      return;
    }
    setBusy(true);
    setRenameError(null);
    try {
      await renameFamily(family.id, next);
      setRenamingFamily(false);
      await load({ silent: true });
    } catch {
      // Restore the previous name (exit the editor) and surface the error inline.
      setRenamingFamily(false);
      setRenameError("Nie udało się zmienić nazwy rodziny — spróbuj ponownie");
    } finally {
      setBusy(false);
    }
  }

  /** Organizer term tile — a read-only compact card. The circle name links to
   * the public per-term page; a copy-link button and an edit pencil (opening
   * `EditTermDialog`) are the only controls. Date, description and needed-items
   * editing all live in that dialog. Guest views keep their own `<Link>` card. */
  function organizerTermCard(
    term: TermResponse,
    group: GroupResponse,
    neededItems: NeededItemResponse[],
  ) {
    const { day, month } = dayMonth(term.occurs_on);
    const time = termTime(term.occurs_on);
    const iconBtnClass =
      "flex h-7 w-7 flex-none items-center justify-center rounded-[8px] text-ink-soft transition-colors hover:bg-paper hover:text-ink";

    return (
      <div className="rounded-2xl border border-line bg-cream p-[15px]">
        <div className="flex items-start gap-3.5">
          <div className="flex h-[46px] w-[46px] flex-none flex-col items-center justify-center rounded-[13px] bg-mint-soft leading-none">
            <b className="font-serif text-base text-ink">{day}</b>
            <small className="text-[9.5px] uppercase tracking-wide text-ink-soft">{month}</small>
          </div>
          <div className="min-w-0 flex-1">
            <Link
              to={termPublicPath(group, term.id)}
              className="text-[15.5px] font-semibold text-ink hover:underline"
            >
              {group.name}
            </Link>
            <p className="mt-0.5 text-[12.5px] text-ink-soft">
              {time && <span className="font-bold text-ink">godz. {time}</span>}
              {time && (term.description ? " · " : "")}
              {term.description || (time ? "" : "Bez opisu")}
            </p>
            {neededItems.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {neededItems.map((ni) => (
                  <span
                    key={ni.id}
                    title={ni.claimed ? "Ktoś zadeklarował, że to przyniesie" : undefined}
                    className={`rounded-full px-2.5 py-0.5 text-[10.5px] font-extrabold ${
                      ni.claimed
                        ? "bg-mint-soft text-[#12604D]"
                        : "bg-lime-soft text-[#56701F]"
                    }`}
                  >
                    {ni.claimed ? "✓ " : ""}
                    {ni.product_name}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="flex flex-none flex-col gap-1">
            <button
              type="button"
              title="Kopiuj link do terminu"
              aria-label="Kopiuj link do terminu"
              onClick={() => {
                void navigator.clipboard.writeText(
                  `${window.location.origin}${termPublicPath(group, term.id)}`,
                );
                showToast("Skopiowano link");
              }}
              className={iconBtnClass}
            >
              <CopyIcon />
            </button>
            <button
              type="button"
              aria-label="Edytuj termin"
              onClick={() => {
                setEditTermId(term.id);
                setModal("edit-termin");
              }}
              className={iconBtnClass}
            >
              <PencilIcon />
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ---------- krąg: zmiana nazwy inline ---------- */

  function startRenameCircle(group: GroupResponse) {
    setRenamingCircle(group.id);
    setCircleNameDraft(group.name);
    setCircleRenameError(null);
  }

  function cancelRenameCircle() {
    setRenamingCircle(null);
    setCircleRenameError(null);
  }

  async function saveRenameCircle(group: GroupResponse) {
    const next = circleNameDraft.trim();
    if (!next || next === group.name) {
      cancelRenameCircle();
      return;
    }
    setBusy(true);
    setCircleRenameError(null);
    try {
      await updateCircle(group.id, { name: next });
      setRenamingCircle(null);
      await load({ silent: true });
    } catch {
      setRenamingCircle(null);
      setCircleRenameError({ groupId: group.id, message: "Nie udało się zmienić nazwy kręgu — spróbuj ponownie" });
    } finally {
      setBusy(false);
    }
  }

  /* ---------- rzeczy: edycja stanu + usuwanie ---------- */

  async function saveItemCondition() {
    if (!editingItemCondition) return;
    setBusy(true);
    setItemError(null);
    try {
      await updateInventoryItem(editingItemCondition.id, { condition: editingItemCondition.condition });
      setEditingItemCondition(null);
      await load({ silent: true });
    } catch {
      setEditingItemCondition(null);
      setItemError("Nie udało się zapisać stanu — spróbuj ponownie");
    } finally {
      setBusy(false);
    }
  }

  function startEditItemMeta(it: InventoryItemResponse) {
    const prod = products.find((p) => p.id === it.product_id);
    setItemMetaError(null);
    setEditingItemMeta({
      id: it.id,
      name: prod?.name ?? "",
      category: prod?.category ?? "OTHER",
    });
  }

  async function saveItemMeta() {
    if (!editingItemMeta) return;
    const draft = editingItemMeta;
    const name = draft.name.trim();
    if (!name) {
      setItemMetaError("Podaj nazwę rzeczy");
      return;
    }
    const item = items.find((i) => i.id === draft.id);
    const current = item ? products.find((p) => p.id === item.product_id) : undefined;
    if (current && current.name === name && current.category === draft.category) {
      setEditingItemMeta(null);
      return;
    }
    setBusy(true);
    setItemMetaError(null);
    try {
      const resolved = await resolveProduct({ name, category: draft.category });
      await updateInventoryItem(draft.id, { product_id: resolved.id });
      await load({ silent: true });
      setEditingItemMeta(null);
    } catch {
      setItemMetaError("Nie udało się zapisać zmian — spróbuj ponownie");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteItem(itemId: number) {
    const index = items.findIndex((i) => i.id === itemId);
    if (index === -1) return;
    const removed = items[index];
    setItemError(null);
    setItems((prev) => prev.filter((i) => i.id !== itemId));
    showToast("Usunięto");
    try {
      await deleteInventoryItem(itemId);
    } catch {
      setItems((prev) => {
        const next = [...prev];
        next.splice(index, 0, removed);
        return next;
      });
      setItemError("Nie udało się usunąć — przywrócono pozycję");
    }
  }

  /* ---------- podarki (lokalne) ---------- */

  const giftCounts = useMemo(
    () => ({
      "pożyczone": gifts.filter((g) => g.source === "pożyczone").length,
      "otrzymane": gifts.filter((g) => g.source === "otrzymane").length,
      "zamienione": gifts.filter((g) => g.source === "zamienione").length,
    }),
    [gifts],
  );
  const removeGift = (id: string) => setGifts((gs) => gs.filter((g) => g.id !== id));

  /* ---------- profil (lokalne) ---------- */

  function saveProfile() {
    setProfileSaved(true);
    showToast("Zapisano dane profilowe");
    setTimeout(() => setProfileSaved(false), 2200);
  }

  const relevantGroupsForForm = isOrganizer ? myGroups : guestCircles;
  // Resolved from live `terms` at render time so the open EditTermDialog keeps
  // getting fresh props after each `load({ silent: true })` refresh.
  const editTermEntry =
    editTermId === null ? null : terms.find((t) => t.term.id === editTermId) ?? null;

  const isTopLevel =
    view === "home" || view === "spotkania" || view === "rzeczy" || view === "podarki";

  return {
    // --- auth ---
    logout,
    // --- state values ---
    loading,
    error,
    profile,
    myLeaderships,
    myGroups,
    guestCircles,
    terms,
    family,
    guardians,
    myAttendances,
    myPledges,
    withdrawMyPledge,
    notifications,
    unreadCount,
    notifOpen,
    setNotifOpen,
    openNotification,
    markAllRead,
    renamingFamily,
    familyNameDraft,
    renameError,
    familyMemberError,
    editTermId,
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
    draftNeededItem,
    inventoryId,
    items,
    products,
    itemDraft,
    // --- setters the render calls directly ---
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
    setDraftNeededItem,
    setEditTermId,
    setEditingItemCondition,
    setEditingItemMeta,
    setMemberName,
    setMemberRole,
    setCircleNameDraft,
    setFamilyNameDraft,
    setItemDraft,
    // --- derived ---
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
    // --- handlers ---
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
  };
}

export function PanelDataProvider({ children }: { children: ReactNode }) {
  const value = usePanelDataValue();
  return <PanelDataContext value={value}>{children}</PanelDataContext>;
}
