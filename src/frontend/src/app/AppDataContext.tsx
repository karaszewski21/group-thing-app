import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useQueryClient } from "@tanstack/react-query";
import { NOTIFICATIONS_KEY } from "../hooks/useNotifications";
import { subscribePendingActionResolved } from "../components/pending/pendingActionResolved";
import { getMyPledges, withdrawPledge, type MyPledgeResponse } from "../api/pledges";
import {
  createLightweightMembers,
  getGuardians,
  getMembershipsForFamily,
  getMyFamilies,
  removeFamilyMember,
  renameFamily,
  updateChildBirthYear,
  type FamilyOut,
  type GuardianResponse,
} from "../api/families";
import {
  createAdditionalMyCircle,
  deleteGroup,
  getGroup,
  getMyAttendances,
  updateGroup,
  type GroupResponse,
  type LeadershipResponse,
  type MyAttendanceResponse,
} from "../api/groups";
import {
  ACTIVE_LOCK_BALANCE_STATUSES,
  deleteInventoryItem,
  getInventoryItemBalance,
  getMyInventoryItems,
  type MyInventoryItemResponse,
} from "../api/inventories";
import {
  deleteMyAvatar,
  getLeadershipsForPerson,
  getMyProfile,
  updateMyProfile,
  uploadMyAvatar,
  type UserProfileResponse,
} from "../api/people";
import { getMyOrganization } from "../api/organizations";
import {
  createNeededItem,
  createTerm,
  getNeededItems,
  getTerms,
  type NeededItemResponse,
  type TermResponse,
} from "../api/terms";
import {
  createEmptyNeededItemQuickAddValue,
  type NeededItemQuickAddValue,
} from "../utils/neededItemQuickAdd";
import { hasStatus, serverMessageOr } from "../api/problem";
import { setItemListingPreference } from "../api/itemListingPreferences";
import { pluralPl } from "../utils/plural";
import type { GroupFormValue } from "../components/panel/GroupFormFields";
import { TermPlaceLine } from "../components/shared/TermPlaceLine";
import { CopyIcon, FamilyIcon, PencilIcon } from "../components/shared/appIcons";
import {
  dayMonth,
  defaultVisibility,
  termTime,
  termPublicPath,
  GIFT_LIMIT_MESSAGE,
  ITEM_MODE_TO_RESERVATION_TYPE,
  MAX_GIFT_ITEMS,
  RESERVATION_TYPE_TO_ITEM_MODE,
  type GuestTermCard,
  type ItemMode,
  type ModalKind,
  type TermWithNeeded,
  type View,
  capacityText,
  parseCapacity,
  viewFromPath,
  viewPath,
} from "../utils/appHelpers";
import { AppDataContext } from "./appDataStore";

/* ------------------------------------------------------------------ */
/*  Panel — warstwa stanu (state/effects/handlers/derived) wydzielona  */
/*  z AppPage.tsx w niezmienionej postaci. Render (widoki/nagłówek/  */
/*  nawigacja/modale) zostaje w AppPage.tsx i czyta stąd przez       */
/*  useAppData(). Zero zmian zachowania.                              */
/* ------------------------------------------------------------------ */

export type AppDataContextValue = ReturnType<typeof useAppDataValue>;

/** The `localStorage` key of a home hint's "dismissed" flag for one account. */
function hintKey(flag: string, username: string | null): string {
  return `${flag}:${username ?? ""}`;
}

function useDismissibleHint(storageKey: string): [boolean, () => void] {
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(storageKey) === "1");
  function dismiss() {
    localStorage.setItem(storageKey, "1");
    setDismissed(true);
  }
  return [dismissed, dismiss];
}

/** Each item's standing mode keyed by item id, seeded from `listing_mode`
 * (items without a mode are left out). */
function itemModesFrom(items: MyInventoryItemResponse[]): Record<string, ItemMode> {
  return Object.fromEntries(
    items
      .map(
        (it) => [it.id, it.listing_mode && RESERVATION_TYPE_TO_ITEM_MODE[it.listing_mode]] as const,
      )
      .filter((entry): entry is [string, ItemMode] => entry[1] != null),
  );
}

/** How often "Moje rzeczy" re-reads the items while some photos are still in
 * moderation (same cadence as the item page's photo poll). */
const PENDING_PHOTO_POLL_MS = 10_000;

function useAppDataValue() {
  const { logout, username } = useAuth();
  const navigate = useNavigate();
  // The active section is the pathname (`/`, `/items`, `/account`, …), not
  // local state — this way a refresh (or a shared/bookmarked link) lands
  // back on the same section instead of always resetting to "home".
  const location = useLocation();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<UserProfileResponse | null>(null);
  const [myLeaderships, setMyLeaderships] = useState<LeadershipResponse[]>([]);
  const [myGroups, setMyGroups] = useState<GroupResponse[]>([]);
  const [guestCircles, setGuestCircles] = useState<GroupResponse[]>([]);
  // Terms of the groups I lead (`terms`) and of my family's member circles (`guestTerms`), kept apart.
  const [terms, setTerms] = useState<TermWithNeeded[]>([]);
  const [guestTerms, setGuestTerms] = useState<TermWithNeeded[]>([]);
  const [family, setFamily] = useState<FamilyOut | null>(null);
  const [guardians, setGuardians] = useState<GuardianResponse[]>([]);
  const [myAttendances, setMyAttendances] = useState<MyAttendanceResponse[]>([]);
  // "Zadeklarowane rzeczy" (HomeView) — the caller's own non-withdrawn pledges.
  const [myPledges, setMyPledges] = useState<MyPledgeResponse[]>([]);
  const queryClient = useQueryClient();
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
  const [editTermId, setEditTermId] = useState<string | null>(null);
  // "Edytuj grupę" dialog (name, layout template, visibility, default place
  // and capacity) next to each led group (`modal === "edit-grupa"`).
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editGroupForm, setEditGroupForm] = useState<GroupFormValue>({
    name: "",
    layoutMode: "CIRCLE",
    visibility: "PUBLIC",
    defaultLocationId: null,
    defaultCapacity: "",
  });
  const [editGroupError, setEditGroupError] = useState<string | null>(null);
  // Optimistic item delete in the "Moje rzeczy" view.
  const [itemError, setItemError] = useState<string | null>(null);
  // `null` = no Organization created yet (404) — "Moja organizacja"/the
  // org-polish hint then link to the /organization create form; once an
  // Organization exists, both link straight to its public page instead.
  const [organizationSlug, setOrganizationSlug] = useState<string | null>(null);

  const view: View = viewFromPath(location.pathname) ?? "home";
  const setView = useCallback(
    (next: View) => navigate(viewPath(next)),
    [navigate],
  );
  const [modal, setModal] = useState<ModalKind>(null);
  // Inline (E2) server errors for the "Dodaj grupę" modal / "Dodaj termin"
  // page — cleared whenever the modal opens or the page is entered, so the
  // many close paths don't each have to reset them.
  const [addGroupError, setAddGroupError] = useState<string | null>(null);
  const [addTermError, setAddTermError] = useState<string | null>(null);
  useEffect(() => {
    if (modal === "grupa") {
      setAddGroupError(null);
      setGroupForm((form) => ({ ...form, visibility: defaultVisibility(organizationSlug) }));
    }
  }, [modal, organizationSlug]);
  useEffect(() => {
    if (view === "add/term") setAddTermError(null);
  }, [view]);
  // Which "pierwszy-termin" variant to render, captured when its hint is
  // clicked rather than derived live from `myGroups` — the "Załóż grupę"
  // stepper's own step 1 grows `myGroups` via a silent `load()` mid-flow,
  // and re-deriving the branch on every render would swap the mounted
  // stepper out from under the user (losing the step-2 progress).
  const [firstTermForOrganizer, setFirstTermForOrganizer] = useState(false);
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState(false);

  // --- Panel home dismissible hints (spec.md §3) — dismissible-banner
  // `localStorage` convention: read the flag once on mount, write it on
  // dismiss-click. Keys are per account (`hintKey`), so a browser shared by
  // several accounts never hides a new account's hints because another
  // account dismissed them. Independent flags:
  //  - `hint_create_group_dismissed` — "Załóż grupę", no led group yet
  //  - `hint_create_org_dismissed` — "Stwórz wizytówkę", groups but no Organization
  //  - `hint_org_polish_dismissed` — "Dopracuj stronę organizacji", groups and an Organization
  //  - `hint_org_first_term_dismissed` — "Dodaj swój pierwszy termin", groups but no term
  const [hintCreateGroupDismissed, dismissCreateGroupHint] = useDismissibleHint(
    hintKey("hint_create_group_dismissed", username),
  );
  const [hintCreateOrgDismissed, dismissCreateOrgHint] = useDismissibleHint(
    hintKey("hint_create_org_dismissed", username),
  );
  const [hintOrgFirstTermDismissed, dismissOrgFirstTermHint] = useDismissibleHint(
    hintKey("hint_org_first_term_dismissed", username),
  );
  const [hintOrgPolishDismissed, dismissOrgPolishHint] = useDismissibleHint(
    hintKey("hint_org_polish_dismissed", username),
  );

  // --- profil: formularz "Dane profilowe" i avatar ---
  const [profileName, setProfileName] = useState("");
  const [profileBio, setProfileBio] = useState("");
  const [profileSaved, setProfileSaved] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  // --- lokalne, niepersystentne pola (patrz komentarz na górze pliku) ---
  const [settings, setSettings] = useState({ publicProfile: true });
  const [itemModes, setItemModes] = useState<Record<string, ItemMode | null>>({});

  // --- formularz: dodaj członka rodziny ("Rodzina" section, inline form) ---
  const [memberName, setMemberName] = useState("");
  const [memberRole, setMemberRole] = useState<"GUARDIAN" | "CHILD">("GUARDIAN");
  // Raw input value; only sent (as a number) for CHILD members.
  const [memberBirthYear, setMemberBirthYear] = useState("");

  // --- formularz: dodaj grupę ---
  const emptyGroupForm = (): GroupFormValue => ({
    name: "",
    visibility: defaultVisibility(organizationSlug),
    defaultLocationId: null,
    defaultCapacity: "",
  });
  const [groupForm, setGroupForm] = useState<GroupFormValue>(emptyGroupForm);

  // --- formularz: dodaj termin ---
  const [termGroupId, setTermGroupId] = useState<string | null>(null);
  const [termDate, setTermDate] = useState("");
  const [termDescription, setTermDescription] = useState("");
  const [termLocationId, setTermLocationId] = useState<string | null>(null);
  // Raw input text; `parseCapacity` turns it into the request value.
  const [termCapacity, setTermCapacity] = useState("");
  const [neededDraft, setNeededDraft] = useState<NeededItemQuickAddValue[]>([]);
  const [draftNeededItem, setDraftNeededItem] = useState<NeededItemQuickAddValue>(
    createEmptyNeededItemQuickAddValue(),
  );

  // --- Moje rzeczy (realny Inventory/InventoryItem/Product) ---
  const [items, setItems] = useState<MyInventoryItemResponse[]>([]);

  const showToast = useCallback((msg: string) => setToast(msg), []);

  // Sequences writes to `items`/`itemModes`: bumped by each items read
  // (`load`, `refreshItems`) when it starts and by each mode save when it
  // lands. A read applies its response only if nothing bumped it since it
  // started, so a slow poll cannot flip a just-saved toggle back.
  const itemsSeqRef = useRef(0);

  const load = useCallback(async (options?: { silent?: boolean }) => {
    // `silent` skips the full-page "Wczytywanie…" early-return branch — used
    // when a mid-flow modal (e.g. CreateGroupStepper's step 1 -> step 2
    // transition) needs `myGroups` refreshed in the background without
    // unmounting the still-open modal underneath it.
    if (!options?.silent) setLoading(true);
    setError(null);
    try {
      const me = await getMyProfile();
      setProfile(me);
      // A silent refresh must not overwrite edits still being typed.
      if (!options?.silent) {
        setProfileName(me.display_name);
        setProfileBio(me.bio ?? "");
      }

      const leaderships = await getLeadershipsForPerson(me.id);

      const itemsSeq = ++itemsSeqRef.current;
      const myItems = await getMyInventoryItems();
      if (itemsSeq === itemsSeqRef.current) {
        setItems(myItems);
        setItemModes(itemModesFrom(myItems));
      }

      const activeLeaderships = leaderships.filter((l) => l.valid_to === null);
      setMyLeaderships(activeLeaderships);

      // "Rodzina" section (§7): fetched once here and reused below for the
      // family's member circles instead of a second `getMyFamilies()` round trip.
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
      await queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });

      // A group deleted between the leadership/membership read and these
      // fetches answers 404; skip it instead of failing the whole panel.
      async function unlessGone<T>(request: Promise<T>): Promise<T | null> {
        try {
          return await request;
        } catch (err) {
          if (hasStatus(err, 404)) return null;
          throw err;
        }
      }
      const getGroups = async (groupIds: string[]) =>
        (await Promise.all(groupIds.map((id) => unlessGone(getGroup(id))))).filter(
          (group): group is GroupResponse => group !== null,
        );

      // Led groups and the family's member circles load independently:
      // leading a group never hides the circles the family belongs to.
      const ledGroups = await getGroups(activeLeaderships.map((l) => l.to_group_id));
      setMyGroups(ledGroups);
      let memberGroups: GroupResponse[] = [];
      if (myFamily) {
        const ledIds = new Set(ledGroups.map((g) => g.id));
        const memberships = await getMembershipsForFamily(myFamily.id);
        const active = memberships.filter((m) => m.valid_to === null && !ledIds.has(m.to_group_id));
        memberGroups = await getGroups(active.map((m) => m.to_group_id));
      }
      setGuestCircles(memberGroups);

      async function getGroupTerms(group: GroupResponse) {
        const list = await getTerms(group.id);
        return Promise.all(
          list.map(async (term) => ({ term, group, neededItems: await getNeededItems(term.id) })),
        );
      }
      async function getTermsOf(groups: GroupResponse[]) {
        const termsByGroup = await Promise.all(
          groups.map(async (group) => (await unlessGone(getGroupTerms(group))) ?? []),
        );
        return termsByGroup.flat().sort((a, b) => a.term.occurs_on.localeCompare(b.term.occurs_on));
      }
      const [ledTerms, memberTerms] = await Promise.all([getTermsOf(ledGroups), getTermsOf(memberGroups)]);
      setTerms(ledTerms);
      setGuestTerms(memberTerms);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nie udało się wczytać panelu");
    } finally {
      if (!options?.silent) setLoading(false);
    }
  }, [queryClient]);

  useEffect(() => {
    void load();
  }, [load]);

  // The app-wide pending-actions host resolved something this panel shows.
  useEffect(() => subscribePendingActionResolved(() => void load({ silent: true })), [load]);

  // Bug #3 (cache refresh, structural fix): a term-page confirmation
  // (TermPage) doesn't otherwise refresh this provider's data, so the
  // panel can show stale pledges/items/notifications after the user
  // navigates back here. Silently reload whenever the pathname *transitions*
  // onto a panel section from somewhere else (re-entry after navigating
  // away and back — e.g. from TermPage). The very first render at a
  // panel route is deliberately excluded: that case is already covered by
  // the plain mount effect above (non-silent, shows the loading screen),
  // and firing this one too would double every ordinary panel-open network
  // call. `prevPathnameRef` starts `null` (no observed pathname yet) so the
  // first run only records the pathname instead of treating it as a
  // transition; switching between panel sections (e.g. / -> /items) also
  // doesn't re-fire this, since both are sections and `wasPanelRoute` stays
  // true across that change.
  const prevPathnameRef = useRef<string | null>(null);
  useEffect(() => {
    const isPanelRoute = viewFromPath(location.pathname) !== null;
    const prevPathname = prevPathnameRef.current;
    const wasPanelRoute = prevPathname !== null && viewFromPath(prevPathname) !== null;
    prevPathnameRef.current = location.pathname;
    if (isPanelRoute && !wasPanelRoute && prevPathname !== null) {
      void load({ silent: true });
    }
  }, [location.pathname, load]);

  // Items-only re-read (not the full `load()`, which would also re-fetch
  // groups, terms and notifications). A failure keeps the current list; the
  // next poll tick or reload retries. A response overtaken by a newer read or
  // a mode save (`itemsSeqRef`) is dropped; the next tick re-syncs.
  const refreshItems = useCallback(async () => {
    const seq = ++itemsSeqRef.current;
    try {
      const myItems = await getMyInventoryItems();
      if (seq !== itemsSeqRef.current) return;
      setItems(myItems);
      setItemModes(itemModesFrom(myItems));
    } catch {
      // Stale data stays on screen until the next refresh.
    }
  }, []);

  // While any item's photos are in moderation, re-read the items every 10 s
  // so the "Zdjęcia w moderacji" pill and thumbnail update after approval. Runs only while the tab is visible;
  // `visibilitychange` re-arms or pauses it.
  const anyPhotosPending = items.some((it) => it.photos_moderation_pending);
  useEffect(() => {
    if (!anyPhotosPending) return;
    let interval: ReturnType<typeof setInterval> | null = null;
    const stop = () => {
      if (interval !== null) clearInterval(interval);
      interval = null;
    };
    const sync = () => {
      if (document.visibilityState === "visible") {
        if (interval === null) {
          interval = setInterval(() => void refreshItems(), PENDING_PHOTO_POLL_MS);
        }
      } else {
        stop();
      }
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => {
      document.removeEventListener("visibilitychange", sync);
      stop();
    };
  }, [anyPhotosPending, refreshItems]);

  useEffect(() => {
    if (!toast) return;
    // Long server messages (e.g. the 409 about the gift limit) need
    // more reading time than the short confirmations.
    const t = setTimeout(() => setToast(""), Math.max(2200, toast.length * 45));
    return () => clearTimeout(t);
  }, [toast]);

  /* ---------- zadeklarowane rzeczy / powiadomienia ---------- */

  async function withdrawMyPledge(pledgeId: string) {
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

  /* ---------- grupy ---------- */

  async function handleAddGroup() {
    const defaultCapacity = parseCapacity(groupForm.defaultCapacity);
    if (!groupForm.name.trim() || defaultCapacity === undefined) return;
    setBusy(true);
    setAddGroupError(null);
    try {
      // Non-idempotent — an organizer who already leads a Circle still gets
      // a genuinely NEW one here (unlike `createMyCircle`, which is reserved
      // for the one-time "become an Organizer" flows).
      await createAdditionalMyCircle({
        name: groupForm.name.trim(),
        visibility: groupForm.visibility,
        default_location_id: groupForm.defaultLocationId,
        default_capacity: defaultCapacity,
      });
      setGroupForm(emptyGroupForm());
      setModal(null);
      showToast("Dodano grupę");
      await load();
    } catch (err) {
      setAddGroupError(serverMessageOr(err, "Nie udało się dodać grupy"));
    } finally {
      setBusy(false);
    }
  }

  /** Rejects with the message `DeleteGroupDialog` shows inline. */
  async function handleRemoveGroup(groupId: string): Promise<void> {
    try {
      await deleteGroup(groupId);
    } catch (err) {
      throw new Error(serverMessageOr(err, "Nie udało się usunąć grupy. Spróbuj ponownie."));
    }
    showToast("Usunięto grupę");
    await load({ silent: true });
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

  /** Picks the group of the "Dodaj termin" form and prefills its default place and capacity. */
  function selectTermGroup(groupId: string | null) {
    const group = myGroups.find((g) => g.id === groupId);
    setTermGroupId(groupId);
    setTermLocationId(group?.default_location?.id ?? null);
    setTermCapacity(capacityText(group?.default_capacity));
  }

  function removeDraftNeededItem(index: number) {
    setNeededDraft((prev) => prev.filter((_, i) => i !== index));
  }

  /** Creates the term and its needed items, then leaves the "Dodaj termin"
   * page for "Spotkania". */
  async function handleAddTerm() {
    const capacity = parseCapacity(termCapacity);
    if (!termGroupId || !termDate || capacity === undefined) return;
    setBusy(true);
    setAddTermError(null);
    try {
      let term: TermResponse;
      try {
        term = await createTerm({
          circle_group_id: termGroupId,
          occurs_on: termDate,
          description: termDescription || undefined,
          location_id: termLocationId,
          capacity,
        });
      } catch (err) {
        setAddTermError(serverMessageOr(err, "Nie udało się dodać terminu"));
        return;
      }
      // Needed-item names are moderated only after the term exists, so a
      // rejected name cannot roll the term back: keep going, then report
      // every rejected name in one toast (re-added via "Edytuj termin").
      const rejected: string[] = [];
      let firstMessage: string | null = null;
      for (const draft of neededDraft) {
        try {
          await createNeededItem({
            term_id: term.id,
            name: draft.name,
            description: draft.description || undefined,
          });
        } catch (err) {
          rejected.push(draft.name);
          firstMessage ??= serverMessageOr(err, "Nie udało się dodać rzeczy");
        }
      }
      selectTermGroup(null);
      setTermDate("");
      setTermDescription("");
      setNeededDraft([]);
      navigate(viewPath("meetings"));
      showToast(
        rejected.length > 0
          ? `Termin dodany, ale nie dodano rzeczy: ${rejected.join(", ")} — ${firstMessage}`
          : "Dodano termin",
      );
      await load();
    } finally {
      setBusy(false);
    }
  }

  /* ---------- rzeczy ---------- */

  async function setItemMode(itemId: string, mode: ItemMode) {
    // Defense-in-depth: `MyItemsView` already disables the toggle buttons
    // while an item is locked (Bug #1 fix), but re-check here too, since
    // the client-side disable is UX, not the sole guard.
    const balance = await getInventoryItemBalance(itemId);
    if (ACTIVE_LOCK_BALANCE_STATUSES.includes(balance.status)) return;
    const next = itemModes[itemId] === mode ? null : mode;
    if (next === "oddam" && items.filter((i) => itemModes[i.id] === "oddam").length >= MAX_GIFT_ITEMS) {
      showToast(GIFT_LIMIT_MESSAGE);
      return;
    }
    setItemError(null);
    try {
      await setItemListingPreference(
        itemId,
        next ? ITEM_MODE_TO_RESERVATION_TYPE[next] : null,
      );
      // Reads started before this save may carry the old mode — drop them.
      itemsSeqRef.current++;
      setItemModes((prev) => ({ ...prev, [itemId]: next }));
    } catch (err) {
      // A toast, not `itemError`: that one renders below the whole list,
      // off-screen on a phone. The refresh resyncs the card with the server
      // (e.g. after a gift-limit 409).
      showToast(serverMessageOr(err, "Nie udało się zapisać trybu — spróbuj ponownie"));
      void refreshItems();
    }
  }

  const itemCounts = useMemo(
    () => ({
      "oddam": items.filter((i) => itemModes[i.id] === "oddam").length,
      "zamienię": items.filter((i) => itemModes[i.id] === "zamienię").length,
    }),
    [items, itemModes],
  );

  /* ---------- rodzina ---------- */

  async function handleAddFamilyMember() {
    if (!memberName.trim()) return;
    const birthYear = memberRole === "CHILD" && memberBirthYear.trim() ? Number(memberBirthYear) : null;
    setBusy(true);
    try {
      await createLightweightMembers([
        {
          name: memberName.trim(),
          role_type: memberRole,
          ...(birthYear !== null && { birth_year: birthYear }),
        },
      ]);
      setMemberName("");
      setMemberRole("GUARDIAN");
      setMemberBirthYear("");
      showToast("Dodano członka rodziny");
      await load();
    } catch (err) {
      showToast(serverMessageOr(err, "Nie udało się dodać członka rodziny"));
    } finally {
      setBusy(false);
    }
  }

  /** Resolves to the inline error message, or `null` once saved. */
  async function saveChildBirthYear(member: GuardianResponse, birthYear: number | null): Promise<string | null> {
    if (!family) return null;
    setBusy(true);
    try {
      await updateChildBirthYear(family.id, member.family_membership_id, birthYear);
      await load({ silent: true });
      showToast("Zapisano rok urodzenia");
      return null;
    } catch (err) {
      return serverMessageOr(err, "Nie udało się zapisać roku urodzenia — spróbuj ponownie");
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
      setFamilyMemberError(serverMessageOr(err, "Nie udało się usunąć członka rodziny — spróbuj ponownie"));
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

  /** Sign-up summary pill linking to the organizer attendees page. Counts come
   * from the terms payload and are `null` for non-organizers — no chip then. */
  function signupSummaryChip(term: TermResponse) {
    const attendees = term.attendee_count;
    if (attendees === null) return null;
    const children = term.child_count ?? 0;
    const hasAttendees = attendees > 0;
    const attendeesText = `${attendees} ${pluralPl(attendees, "zapis", "zapisy", "zapisów")}`;
    const childrenText = `${children} ${pluralPl(children, "dziecko", "dzieci", "dzieci")}`;
    const capacity = term.capacity ?? null;
    const capacityLabel = capacity === null ? "" : `${attendees}/${capacity} miejsc`;

    return (
      <div className="mt-2">
        <Link
          to={`/terms/${term.id}`}
          aria-label={`Zapisani na termin: ${
            hasAttendees ? `${attendeesText}, ${childrenText}` : "brak zapisów"
          }${capacityLabel && `, ${capacityLabel}`}`}
          className="inline-flex min-h-8 items-center gap-1 rounded-full bg-cream px-3 text-[13px] font-bold text-ink transition-colors hover:bg-line"
        >
          {hasAttendees && (
            <span aria-hidden="true" className="flex [&>svg]:h-3.5 [&>svg]:w-3.5">
              <FamilyIcon />
            </span>
          )}
          {hasAttendees ? `${attendeesText} · ${childrenText}` : "Brak zapisów"}
          {capacityLabel && ` · ${capacityLabel}`}
          <span aria-hidden="true">›</span>
        </Link>
      </div>
    );
  }

  /** Organizer term tile — a read-only compact card. The circle name links to
   * the public per-term page; a copy-link button and an edit pencil (opening
   * `EditTermDialog`) are the only controls. Date, description and needed-items
   * editing all live in that dialog. Guest terms use `guestTermCard`. */
  function organizerTermCard(
    term: TermResponse,
    group: GroupResponse,
    neededItems: NeededItemResponse[],
  ) {
    const { day, month } = dayMonth(term.occurs_on);
    const time = termTime(term.occurs_on);
    const iconBtnClass =
      "flex h-10 w-10 flex-none items-center justify-center rounded-full border-[1.5px] border-line bg-paper text-ink transition-colors hover:border-line-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

    return (
      <div className="rounded-[22px] border border-line bg-paper p-3.5">
        <div className="flex items-start gap-3">
          <div className="flex h-14.5 w-13 flex-none flex-col items-center justify-center rounded-2xl bg-primary-soft leading-none">
            <b className="font-serif text-[22px] font-extrabold text-ink">{day}</b>
            <small className="mt-0.5 text-[10px] font-extrabold tracking-wide text-primary-fg uppercase">{month}</small>
          </div>
          <div className="min-w-0 flex-1">
            <Link
              to={termPublicPath(group, term.id)}
              className="text-base font-bold text-ink hover:underline"
            >
              {group.name}
            </Link>
            <p className="mt-0.5 text-sm text-ink-soft">
              {time && <span className="font-bold text-ink">godz. {time}</span>}
              {time && (term.description ? " · " : "")}
              {term.description || (time ? "" : "Bez opisu")}
            </p>
            <TermPlaceLine location={term.location ?? null} capacity={null} withMapLink className="mt-1.5" />
            {neededItems.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {neededItems.map((ni) => (
                  <span
                    key={ni.id}
                    title={ni.claimed ? "Ktoś zadeklarował, że to przyniesie" : undefined}
                    className={`rounded-full px-2.5 py-0.5 text-xs font-extrabold ${
                      ni.claimed
                        ? "bg-primary-soft text-primary-fg"
                        : "border-[1.5px] border-dashed border-accent text-accent-fg"
                    }`}
                  >
                    {ni.claimed ? "✓ " : ""}
                    {ni.name}
                  </span>
                ))}
              </div>
            )}
            {signupSummaryChip(term)}
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

  /* ---------- dialog "Edytuj grupę" (nazwa, layout, widoczność, stałe miejsce, ile miejsc) ---------- */

  function startEditGroup(group: GroupResponse) {
    setEditingGroupId(group.id);
    setEditGroupForm({
      name: group.name,
      layoutMode: group.layout_mode,
      visibility: group.visibility,
      defaultLocationId: group.default_location?.id ?? null,
      defaultCapacity: capacityText(group.default_capacity),
    });
    setEditGroupError(null);
    setModal("edit-grupa");
  }

  function cancelEditGroup() {
    setEditingGroupId(null);
    setEditGroupError(null);
    setModal(null);
  }

  async function saveEditGroup() {
    const group = myGroups.find((g) => g.id === editingGroupId);
    if (!group) return;
    const name = editGroupForm.name.trim();
    const defaultCapacity = parseCapacity(editGroupForm.defaultCapacity);
    if (!name || defaultCapacity === undefined) return;
    setBusy(true);
    setEditGroupError(null);
    try {
      // One PATCH with every field: `name` is required, and a `null` place or capacity clears it.
      await updateGroup(group.id, {
        name,
        layout_mode: editGroupForm.layoutMode,
        visibility: editGroupForm.visibility,
        default_location_id: editGroupForm.defaultLocationId,
        default_capacity: defaultCapacity,
      });
      setEditingGroupId(null);
      setModal(null);
      showToast("Zapisano zmiany grupy");
      await load({ silent: true });
    } catch (err) {
      setEditGroupError(serverMessageOr(err, "Nie udało się zapisać zmian — spróbuj ponownie"));
    } finally {
      setBusy(false);
    }
  }

  /* ---------- rzeczy: usuwanie ---------- */

  async function handleDeleteItem(itemId: string) {
    const index = items.findIndex((i) => i.id === itemId);
    if (index === -1) return;
    const removed = items[index];
    setItemError(null);
    // Drop any in-flight items refresh so it can't resurrect the removed item.
    itemsSeqRef.current++;
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

  /* ---------- profil ---------- */

  async function saveProfile() {
    setProfileError(null);
    try {
      const updated = await updateMyProfile({
        display_name: profileName,
        bio: profileBio.trim() || null,
      });
      setProfile(updated);
      setProfileName(updated.display_name);
      setProfileBio(updated.bio ?? "");
      setProfileSaved(true);
      showToast("Zapisano dane profilowe");
      setTimeout(() => setProfileSaved(false), 2200);
    } catch (err) {
      setProfileError(serverMessageOr(err, "Nie udało się zapisać profilu — spróbuj ponownie"));
    }
  }

  async function changeAvatar(file: File) {
    setAvatarBusy(true);
    setAvatarError(null);
    try {
      const avatar = await uploadMyAvatar(file);
      setProfile((current) => (current ? { ...current, avatar } : current));
      showToast(avatar.status === "APPROVED" ? "Zapisano zdjęcie profilowe" : "Zdjęcie czeka na moderację");
    } catch (err) {
      setAvatarError(serverMessageOr(err, "Nie udało się wgrać zdjęcia — spróbuj ponownie"));
    } finally {
      setAvatarBusy(false);
    }
  }

  async function removeAvatar() {
    setAvatarBusy(true);
    setAvatarError(null);
    try {
      await deleteMyAvatar();
      setProfile((current) => (current ? { ...current, avatar: null } : current));
      showToast("Usunięto zdjęcie profilowe");
    } catch (err) {
      setAvatarError(serverMessageOr(err, "Nie udało się usunąć zdjęcia — spróbuj ponownie"));
    } finally {
      setAvatarBusy(false);
    }
  }

  // The "Zapisane" cards: my RSVPs, then my family circles' other terms. A
  // term shows once (led > attended > membership-only), sorted by date.
  const ledTermIds = new Set(terms.map((t) => t.term.id));
  const guestTermById = new Map(guestTerms.map((t) => [t.term.id, t]));
  const attendedCards: GuestTermCard[] = myAttendances
    .filter((a) => !ledTermIds.has(a.term_id))
    .map((a) => ({
      termId: a.term_id,
      occursOn: a.occurs_on,
      groupName: a.group_name,
      description: guestTermById.get(a.term_id)?.term.description ?? null,
      href: `/${a.organizer_slug}/group/${a.group_id}/term/${a.term_id}`,
      location: a.location,
      capacity: a.capacity,
      attendeeCount: a.attendee_count,
      neededItems: guestTermById.get(a.term_id)?.neededItems ?? [],
    }));
  const attendedIds = new Set(attendedCards.map((c) => c.termId));
  const memberCards: GuestTermCard[] = guestTerms
    .filter(({ term }) => !ledTermIds.has(term.id) && !attendedIds.has(term.id))
    .map(({ term, group, neededItems }) => ({
      termId: term.id,
      occursOn: term.occurs_on,
      groupName: group.name,
      description: term.description,
      href: termPublicPath(group, term.id),
      location: term.location ?? null,
      capacity: term.capacity ?? null,
      attendeeCount: null,
      neededItems,
    }));
  const savedCards = [...attendedCards, ...memberCards].sort((a, b) => a.occursOn.localeCompare(b.occursOn));

  /** Guest term card — the whole card links to the public term page, so the
   * place line carries no Maps link of its own (no nested anchors). */
  function guestTermCard(card: GuestTermCard) {
    const { day, month } = dayMonth(card.occursOn);
    const time = termTime(card.occursOn);
    return (
      <Link
        to={card.href}
        className="flex items-start gap-3 rounded-[22px] border border-line bg-paper p-3.5 transition-colors hover:border-line-strong"
      >
        <div className="flex h-14.5 w-13 flex-none flex-col items-center justify-center rounded-2xl bg-primary-soft leading-none">
          <b className="font-serif text-[22px] font-extrabold text-ink">{day}</b>
          <small className="mt-0.5 text-[10px] font-extrabold tracking-wide text-primary-fg uppercase">{month}</small>
        </div>
        <div className="min-w-0 flex-1">
          <h4 className="text-base font-bold text-ink">{card.groupName}</h4>
          <small className="mt-0.5 block text-sm text-ink-soft">
            {time && <span className="font-bold text-ink">godz. {time}</span>}
            {time && (card.description ? " · " : "")}
            {card.description || (time ? "" : "Bez opisu")}
          </small>
          <TermPlaceLine
            location={card.location}
            capacity={card.capacity}
            attendeeCount={card.attendeeCount}
            withMapLink={false}
            className="mt-1.5"
          />
          {card.neededItems.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {card.neededItems.map((ni) => (
                <span
                  key={ni.id}
                  className="rounded-full border-[1.5px] border-dashed border-accent px-2.5 py-0.5 text-xs font-extrabold text-accent-fg"
                >
                  {ni.name}
                </span>
              ))}
            </div>
          )}
        </div>
      </Link>
    );
  }

  // Resolved from live `terms` at render time so the open EditTermDialog keeps
  // getting fresh props after each `load({ silent: true })` refresh.
  const editTermEntry =
    editTermId === null ? null : terms.find((t) => t.term.id === editTermId) ?? null;

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
    guestTerms,
    savedCards,
    family,
    guardians,
    myAttendances,
    myPledges,
    withdrawMyPledge,
    renamingFamily,
    familyNameDraft,
    renameError,
    familyMemberError,
    editTermId,
    editingGroupId,
    editGroupForm,
    editGroupError,
    addGroupError,
    addTermError,
    itemError,
    organizationSlug,
    view,
    modal,
    firstTermForOrganizer,
    toast,
    busy,
    hintCreateGroupDismissed,
    hintCreateOrgDismissed,
    hintOrgFirstTermDismissed,
    hintOrgPolishDismissed,
    profileName,
    profileBio,
    profileSaved,
    profileError,
    avatarBusy,
    avatarError,
    settings,
    itemModes,
    memberName,
    memberRole,
    memberBirthYear,
    groupForm,
    termGroupId,
    termDate,
    termDescription,
    termLocationId,
    termCapacity,
    neededDraft,
    draftNeededItem,
    items,
    // --- setters the render calls directly ---
    setView,
    setModal,
    setFirstTermForOrganizer,
    setProfileName,
    setProfileBio,
    setSettings,
    setGroupForm,
    selectTermGroup,
    setTermDate,
    setTermDescription,
    setTermLocationId,
    setTermCapacity,
    setDraftNeededItem,
    setEditTermId,
    setMemberName,
    setMemberRole,
    setMemberBirthYear,
    setEditGroupForm,
    setFamilyNameDraft,
    // --- derived ---
    showToast,
    load,
    itemCounts,
    editTermEntry,
    organizerTermCard,
    guestTermCard,
    // --- handlers ---
    dismissCreateGroupHint,
    dismissCreateOrgHint,
    dismissOrgFirstTermHint,
    dismissOrgPolishHint,
    handleAddGroup,
    handleRemoveGroup,
    addDraftNeededItem,
    removeDraftNeededItem,
    handleAddTerm,
    setItemMode,
    handleAddFamilyMember,
    handleRemoveFamilyMember,
    saveChildBirthYear,
    startRenameFamily,
    cancelRenameFamily,
    saveRenameFamily,
    startEditGroup,
    cancelEditGroup,
    saveEditGroup,
    handleDeleteItem,
    saveProfile,
    changeAvatar,
    removeAvatar,
  };
}

export function AppDataProvider({ children }: { children: ReactNode }) {
  const value = useAppDataValue();
  return (
    <AppDataContext value={value}>
      {children}
    </AppDataContext>
  );
}
