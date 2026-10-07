import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { useQueryClient } from "@tanstack/react-query";
import { NOTIFICATIONS_KEY, useNotifications } from "../../hooks/useNotifications";
import { getMyPledges, withdrawPledge, type MyPledgeResponse } from "../../api/pledges";
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
} from "../../api/families";
import {
  approveJoinRequest,
  createAdditionalMyCircle,
  endLeadership,
  getGroup,
  getMyAttendances,
  listMyPendingJoinRequests,
  rejectJoinRequest,
  updateGroupLayoutMode,
  type GroupLayoutMode,
  type GroupResponse,
  type GroupVisibility,
  type LeadershipResponse,
  type MyAttendanceResponse,
  type PendingJoinRequestResponse,
} from "../../api/groups";
import {
  ACTIVE_LOCK_BALANCE_STATUSES,
  deleteInventoryItem,
  getInventories,
  getInventory,
  getInventoryItemBalance,
  getInventoryItems,
  getMyInventoryItems,
  getMyLentOutItems,
  type LentOutItemResponse,
  type MyInventoryItemResponse,
} from "../../api/inventories";
import {
  confirmReservation,
  confirmTransaction,
  createReservation,
  fulfillReservation,
  getReservation,
  type ReservationResponse,
} from "../../api/reservations";
import { getMyTakenTermItemListings, getMyTermItemListings } from "../../api/termItemListings";
import {
  deleteMyAvatar,
  getLeadershipsForPerson,
  getMyProfile,
  getProfileByAccountUserId,
  updateMyProfile,
  uploadMyAvatar,
  type UserProfileResponse,
} from "../../api/people";
import { getMyOrganization } from "../../api/organizations";
import { resolveProduct } from "../../api/products";
import { useCategories } from "../../hooks/useCategories";
import {
  createNeededItem,
  createTerm,
  getNeededItems,
  getTerms,
  type NeededItemResponse,
  type TermResponse,
} from "../../api/terms";
import {
  createEmptyNeededItemQuickAddValue,
  type NeededItemQuickAddValue,
} from "../../utils/neededItemQuickAdd";
import { ApiError } from "../../api/client";
import { serverMessageOr } from "../../api/problem";
import { setItemListingPreference } from "../../api/itemListingPreferences";
import { pluralPl } from "../../utils/plural";
import { CopyIcon, FamilyIcon, PencilIcon } from "./panelIcons";
import {
  dayMonth,
  termTime,
  termPublicPath,
  ITEM_MODE_TO_RESERVATION_TYPE,
  RESERVATION_TYPE_TO_ITEM_MODE,
  type BorrowedItem,
  type ItemMode,
  type ModalKind,
  type TermWithNeeded,
  type View,
  viewPath,
} from "./panelHelpers";
import { PanelDataContext } from "./panelDataStore";
import { ModalSheet } from "./panelComponents";

/* ------------------------------------------------------------------ */
/*  Panel — warstwa stanu (state/effects/handlers/derived) wydzielona  */
/*  z PanelPage.tsx w niezmienionej postaci. Render (widoki/nagłówek/  */
/*  nawigacja/modale) zostaje w PanelPage.tsx i czyta stąd przez       */
/*  usePanelData(). Zero zmian zachowania.                              */
/* ------------------------------------------------------------------ */

export type PanelDataContextValue = ReturnType<typeof usePanelDataValue>;

/** One actionable item surfaced by Group 7's global pending-actions modal
 * (spec.md Requirement 10-11 / the "GLOBALNYM dialogiem" quote) — derived
 * client-side from `notifications`' `kind`/`link_path` rather than a new
 * backend endpoint, per the plan's [RESOLVED] note. Only
 * `TERM_CONFIRMATION_NEEDED` carries a term-shaped `link_path`, and its
 * `termId` is parsed out of it, since that's the only structured data the
 * feed carries. Item-related kinds, `SWAP_PROPOSED` included, link to
 * `/product/<itemId>`, so `PendingSwapAction.linkPath` is not a term link.
 *
 * `SWAP_PROPOSED` carries no `proposalId`/accept-reject affordance here —
 * this modal can only ever surface the FIRST pending notification
 * (`pendingActions[0]`), which would pre-empt the actual choice among
 * possibly several competing offers. It only links to "Moje rzeczy", where
 * `RzeczyView` lists every pending offer against the item together. */
export interface PendingSwapAction {
  kind: "SWAP_PROPOSED";
  notificationId: string;
  message: string;
  linkPath: string | null;
}

/** The post-term-end confirm-race prompt — fully wired to
 * `confirmTransaction`. `reservationId` is `Notification.reservation_id`
 * (set for GIFT/LEND prompts, incl. Pledge-LEND); when it is `null` (SWAP,
 * older notifications) the reservation is resolved client-side from the
 * term's `getMyTermItemListings`/`getMyTakenTermItemListings` (see
 * `resolvePendingReservationId`). */
export interface PendingConfirmAction {
  kind: "TERM_CONFIRMATION_NEEDED";
  notificationId: string;
  message: string;
  linkPath: string | null;
  termId: string | null;
  reservationId: string | null;
}

/** A PENDING request to join a group the caller organizes. Sourced from the
 * server's pending list rather than from notifications, so it stays until
 * decided even when its `GROUP_JOIN_REQUESTED` notification was read. */
export interface PendingJoinRequestAction {
  kind: "GROUP_JOIN_REQUESTED";
  joinRequestId: string;
  groupId: string;
  groupName: string;
  requesterName: string;
  createdAt: string;
}

export type PendingAction = PendingSwapAction | PendingConfirmAction | PendingJoinRequestAction;

export type JoinRequestDecision = "approve" | "reject";

const TERM_LINK_PATH_RE = /\/term\/([^/]+)$/;

function parseTermIdFromLinkPath(linkPath: string | null): string | null {
  if (!linkPath) return null;
  const match = TERM_LINK_PATH_RE.exec(linkPath);
  return match ? match[1] : null;
}

/** Resolves the `Reservation.id` the caller (`myPartyId`) needs to
 * `confirmTransaction` on `termId`, purely from existing term-item-listing
 * endpoints (no new backend surface) — mirrors `TermPage.tsx`'s own
 * `confirmActionFor`, generalized to run without that page's local
 * `reservationsById` cache since the global modal can render on any route.
 *
 * Checks the taker side first, via `getMyTakenTermItemListings` — unlike
 * `getBrowseTermItemListings` (which excludes RESERVED/taken items and
 * short-circuits to `[]` entirely once the Term has occurred, per
 * `list_browsable_term_item_listings`), this endpoint resolves the caller's
 * own active taken reservations independent of availability status, so it
 * still works for the post-term-end `TERM_CONFIRMATION_NEEDED` prompt.
 *
 * Then checks the lister/owner side of the caller's own listings: an
 * accepted SWAP resolves via its paired leg, while GIFT/LEND resolve
 * directly to the caller's own reservation id (symmetric to the SWAP
 * branch — the owner IS the party who must confirm handoff for those
 * types, there's no separate paired reservation to look up).
 *
 * `null` when neither side applies (nothing left to confirm, or it
 * doesn't belong to this caller). */
async function resolvePendingReservationId(
  termId: string,
  myPartyId: string,
): Promise<string | null> {
  const [mine, taken] = await Promise.all([
    getMyTermItemListings(termId),
    getMyTakenTermItemListings(termId),
  ]);
  const takenRow = taken.find(
    (r) => r.taken_by_party_id === myPartyId && r.resolved_reservation_id != null,
  );
  if (takenRow?.resolved_reservation_id != null) {
    const reservation = await getReservation(takenRow.resolved_reservation_id);
    if (reservation.status !== "FULFILLED" && reservation.status !== "CANCELLED") {
      return reservation.id;
    }
  }

  for (const row of mine) {
    if (row.resolved_reservation_id == null) continue;
    const primary = await getReservation(row.resolved_reservation_id);
    if (primary.reservation_type === "SWAP") {
      if (primary.paired_reservation_id == null) continue;
      const paired = await getReservation(primary.paired_reservation_id);
      if (paired.status !== "FULFILLED" && paired.status !== "CANCELLED") {
        return paired.id;
      }
    } else if (
      (primary.reservation_type === "GIFT" || primary.reservation_type === "LEND") &&
      primary.status !== "FULFILLED" &&
      primary.status !== "CANCELLED"
    ) {
      return primary.id;
    }
  }
  return null;
}

/** The item's RETURN left half-done by an earlier "Oddaję" whose confirm or
 * fulfill failed. The item is no longer `LENT` then, so creating a new
 * RETURN would be rejected — the retry has to finish this one instead. */
async function findUnfinishedReturn(itemId: string): Promise<ReservationResponse | null> {
  const balance = await getInventoryItemBalance(itemId);
  if (!ACTIVE_LOCK_BALANCE_STATUSES.includes(balance.status) || balance.reservation_id === null) {
    return null;
  }
  const reservation = await getReservation(balance.reservation_id);
  return reservation.reservation_type === "RETURN" ? reservation : null;
}

const VIEW_VALUES: readonly View[] = [
  "home",
  "spotkania",
  "rzeczy",
  "podarki",
  "profil",
  "ustawienia",
  "rodzina",
];

function isView(value: string | undefined): value is View {
  return value !== undefined && (VIEW_VALUES as readonly string[]).includes(value);
}

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

function usePanelDataValue() {
  const { logout, username } = useAuth();
  const navigate = useNavigate();
  // Single source of truth for the category list — RzeczyView's inline
  // "Typ rzeczy" select and the item/needed-item quick-add defaults below
  // all read from this instead of a compile-time enum.
  const { data: categoriesData } = useCategories();
  // The active section is the `/panel` vs `/panel/:view` route param, not
  // local state — this way a refresh (or a shared/bookmarked link) lands
  // back on the same section instead of always resetting to "home".
  const { view: viewParam } = useParams<{ view?: string }>();

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
  // Shared with the header bell (`NotificationBell`) — pending actions below
  // are derived from the unread entries.
  const queryClient = useQueryClient();
  const { data: notifications, markRead: markNotificationRead } = useNotifications();
  // Group 7's global pending-actions modal (swap accept/reject prompt +
  // post-term-end confirm-race prompt) — `notificationId`s currently mid-
  // confirm, and ones whose confirm attempt came back "already resolved by
  // the other party" (409, `already_resolved: true`) — kept distinct from
  // a generic error toast per spec.md Requirement 3.
  const [pendingActionBusyId, setPendingActionBusyId] = useState<string | null>(null);
  const [alreadyResolvedIds, setAlreadyResolvedIds] = useState<ReadonlySet<string>>(new Set());
  // Organizer join-request actions, keyed by `joinRequestId`. The "Później"
  // hidden set is deliberately never cleared by `load()`: it lasts until the
  // provider remounts.
  const [pendingJoinRequests, setPendingJoinRequests] = useState<PendingJoinRequestResponse[]>([]);
  const [hiddenJoinRequestIds, setHiddenJoinRequestIds] = useState<ReadonlySet<string>>(new Set());
  const [joinRequestBusy, setJoinRequestBusy] = useState<
    { joinRequestId: string; decision: JoinRequestDecision } | null
  >(null);
  const [resolvedJoinRequestIds, setResolvedJoinRequestIds] = useState<ReadonlySet<string>>(new Set());
  const [joinRequestErrorId, setJoinRequestErrorId] = useState<string | null>(null);
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
  // "Edytuj grupę" dialog (name, location, capacity, layout template) next
  // to each led circle in the "Grupy" section — consolidates what used to be
  // an inline pencil-rename plus a separate always-visible layout pill
  // picker into one dialog (`modal === "edit-grupa"`).
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editGroupForm, setEditGroupForm] = useState<{
    name: string;
    location: string;
    freeSpots: string;
    layoutMode: GroupLayoutMode;
    visibility: GroupVisibility;
  }>({ name: "", location: "", freeSpots: "", layoutMode: "CIRCLE", visibility: "PUBLIC" });
  const [editGroupError, setEditGroupError] = useState<string | null>(null);
  // Optimistic item delete in the "Moje rzeczy" view.
  const [itemError, setItemError] = useState<string | null>(null);
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

  const view: View = isView(viewParam) ? viewParam : "home";
  const setView = useCallback(
    (next: View) => navigate(viewPath(next)),
    [navigate],
  );
  const [modal, setModal] = useState<ModalKind>(null);
  // Inline (E2) server errors for the "Dodaj grupę" / "Dodaj termin" modals —
  // cleared whenever the matching modal opens, so the many close paths don't
  // each have to reset them.
  const [addGroupError, setAddGroupError] = useState<string | null>(null);
  const [addTermError, setAddTermError] = useState<string | null>(null);
  useEffect(() => {
    if (modal === "grupa") setAddGroupError(null);
    if (modal === "termin") setAddTermError(null);
  }, [modal]);
  // Which "pierwszy-termin" variant to render, captured at the moment the
  // hamburger item is clicked rather than read live from `isOrganizer` at
  // render time — the GUEST stepper's own step 1 flips `isOrganizer` via a
  // silent `load()` mid-flow (spec.md §2), and re-deriving the branch from
  // the live value on every render would swap the mounted component out
  // from under the user (losing the just-created circle / step-2 progress)
  // the instant that happens. The picking decision itself still lives only
  // in the host, per spec.md §2 — this just freezes *when* it is read.
  const [firstTermForOrganizer, setFirstTermForOrganizer] = useState(false);
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState(false);

  // --- Panel home dismissible hints (spec.md §3) — dismissible-banner
  // `localStorage` convention: read the flag once on mount, write it on
  // dismiss-click. Keys are per account (`hintKey`), so a browser shared by
  // several accounts never hides a new account's hints because another
  // account dismissed them. Independent flags:
  //  - `hint_first_term_dismissed`  — GUEST "add your first term" nudge (!isOrganizer)
  //  - `hint_become_organizer_dismissed` — GUEST "you can become an organizer" nudge (!isOrganizer)
  //  - `hint_org_first_term_dismissed` — ORGANIZER-with-zero-terms nudge; a SEPARATE
  //    key from the guest one so a guest who dismissed the pre-promotion card
  //    still sees this one after creating their circle.
  //  - `hint_org_polish_dismissed`  — ORGANIZER-only "polish your org page" nudge
  const [hintFirstTermDismissed, dismissFirstTermHint] = useDismissibleHint(
    hintKey("hint_first_term_dismissed", username),
  );
  const [hintBecomeOrganizerDismissed, dismissBecomeOrganizerHint] = useDismissibleHint(
    hintKey("hint_become_organizer_dismissed", username),
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
  const [settings, setSettings] = useState({ emailNotifs: true, smsNotifs: false, publicProfile: true });
  const [groupExtras, setGroupExtras] = useState<Record<string, { location: string; freeSpots: number }>>({});
  const [itemModes, setItemModes] = useState<Record<string, ItemMode | null>>({});
  const [borrowedItems, setBorrowedItems] = useState<BorrowedItem[]>([]);
  const [lentOutItems, setLentOutItems] = useState<LentOutItemResponse[]>([]);

  // --- formularz: dodaj członka rodziny ("Rodzina" section, inline form) ---
  const [memberName, setMemberName] = useState("");
  const [memberRole, setMemberRole] = useState<"GUARDIAN" | "CHILD">("GUARDIAN");
  // Raw input value; only sent (as a number) for CHILD members.
  const [memberBirthYear, setMemberBirthYear] = useState("");

  // --- formularz: dodaj grupę ---
  const [groupForm, setGroupForm] = useState<{
    name: string;
    location: string;
    freeSpots: string;
    visibility: GroupVisibility;
  }>({ name: "", location: "", freeSpots: "", visibility: "PUBLIC" });

  // --- formularz: dodaj termin ---
  const [termGroupId, setTermGroupId] = useState<string | null>(null);
  const [termDate, setTermDate] = useState("");
  const [termDescription, setTermDescription] = useState("");
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
    // when a mid-flow modal (e.g. FirstTermStepperGuest's step 1 -> step 2
    // transition) needs `myGroups`/`isOrganizer` refreshed in the background
    // without unmounting the still-open modal underneath it.
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

      // The authenticated user's own profile always has a login-backed
      // `account_user_id` — only lightweight family members (who never
      // log in) can have a null one, so this fail-fast guard should never
      // actually trigger for `me` (`standards/global/error-handling.md`).
      if (me.account_user_id == null) {
        throw new Error("Zalogowany profil nie ma powiązanego konta użytkownika");
      }

      const [leaderships, inventories] = await Promise.all([
        getLeadershipsForPerson(me.id),
        getInventories(me.account_user_id),
      ]);

      const itemsSeq = ++itemsSeqRef.current;
      const [myItems, myLentOutItems] = await Promise.all([
        getMyInventoryItems(),
        getMyLentOutItems(),
      ]);
      if (itemsSeq === itemsSeqRef.current) {
        setItems(myItems);
        setItemModes(itemModesFrom(myItems));
      }
      setLentOutItems(myLentOutItems);

      // "Wypożyczone" — items currently sitting in the caller's own VIRTUAL
      // inventory (borrowed from someone else). Given/swapped-in items are
      // full ownership and already show up in "Moje rzeczy" instead, so no
      // VIRTUAL inventory means nothing is currently on loan.
      const virtualInventory = inventories.find((i) => i.inventory_type === "VIRTUAL") ?? null;
      if (virtualInventory) {
        const virtualItems = await getInventoryItems(virtualInventory.id);
        setBorrowedItems(
          await Promise.all(
            virtualItems.map(async (item) => {
              const [balance, lenderInventory] = await Promise.all([
                getInventoryItemBalance(item.id),
                item.home_inventory_id !== null
                  ? getInventory(item.home_inventory_id)
                  : Promise.resolve(null),
              ]);
              const lenderProfile = lenderInventory
                ? await getProfileByAccountUserId(lenderInventory.owner_user_id)
                : null;
              return {
                itemId: item.id,
                productName: item.product_name,
                lenderName: lenderProfile?.display_name ?? "nieznana osoba",
                dueDate: balance.due_date,
              };
            }),
          ),
        );
      } else {
        setBorrowedItems([]);
      }

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
      await queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
      try {
        const pendingRequests = await listMyPendingJoinRequests();
        setPendingJoinRequests(Array.isArray(pendingRequests) ? pendingRequests : []);
      } catch (err) {
        // Non-blocking: the panel still works, only the pending-request cards are missing.
        console.error("Nie udało się wczytać próśb o dostęp", err);
        setPendingJoinRequests([]);
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
  }, [queryClient]);

  useEffect(() => {
    void load();
  }, [load]);

  // Bug #3 (cache refresh, structural fix): a term-page confirmation
  // (TermPage) doesn't otherwise refresh this provider's data, so the
  // panel can show stale pledges/items/notifications after the user
  // navigates back here. Silently reload whenever the pathname *transitions*
  // onto a /panel/* route from somewhere else (re-entry after navigating
  // away and back — e.g. from TermPage). The very first render at a
  // panel route is deliberately excluded: that case is already covered by
  // the plain mount effect above (non-silent, shows the loading screen),
  // and firing this one too would double every ordinary panel-open network
  // call. `prevPathnameRef` starts `null` (no observed pathname yet) so the
  // first run only records the pathname instead of treating it as a
  // transition; switching between panel sections (e.g. /panel ->
  // /panel/rzeczy) also doesn't re-fire this, since both are /panel/* and
  // `wasPanelRoute` stays true across that change.
  const prevPathnameRef = useRef<string | null>(null);
  const location = useLocation();
  useEffect(() => {
    const isPanelRoute = location.pathname === "/panel" || location.pathname.startsWith("/panel/");
    const prevPathname = prevPathnameRef.current;
    const wasPanelRoute = prevPathname !== null && (prevPathname === "/panel" || prevPathname.startsWith("/panel/"));
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
  // so the card unblocks after approval. Runs only while the tab is visible;
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
    // Long server messages (e.g. the 409 about photos in moderation) need
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

  /* ---------- global pending-actions modal (Group 7) ---------- */

  // Swap/confirm actions are derived from unread notifications; join-request
  // actions come from the server's pending list and follow them, oldest first.
  const pendingActions: PendingAction[] = useMemo(
    () => [
      ...notifications
        .filter((n) => n.read_at === null)
        .flatMap((n): PendingAction[] => {
          if (n.kind === "SWAP_PROPOSED") {
            return [
              {
                kind: "SWAP_PROPOSED",
                notificationId: n.id,
                message: n.message,
                linkPath: n.link_path,
              },
            ];
          }
          if (n.kind === "TERM_CONFIRMATION_NEEDED") {
            return [
              {
                kind: "TERM_CONFIRMATION_NEEDED",
                notificationId: n.id,
                message: n.message,
                linkPath: n.link_path,
                termId: parseTermIdFromLinkPath(n.link_path),
                reservationId: n.reservation_id ?? null,
              },
            ];
          }
          return [];
        }),
      ...pendingJoinRequests
        .filter((r) => !hiddenJoinRequestIds.has(r.id))
        .map(
          (r): PendingJoinRequestAction => ({
            kind: "GROUP_JOIN_REQUESTED",
            joinRequestId: r.id,
            groupId: r.group_id,
            groupName: r.group_name,
            requesterName: r.requester_display_name,
            createdAt: r.created_at,
          }),
        ),
    ],
    [notifications, pendingJoinRequests, hiddenJoinRequestIds],
  );

  /** Marks the underlying notification read (optimistic, same pattern as
   * `openNotification`) — the item then drops out of `pendingActions`
   * (derived from `notifications`) on the next render, without a separate
   * "dismissed" list to keep in sync. */
  function dismissPendingAction(notificationId: string) {
    setAlreadyResolvedIds((prev) => {
      if (!prev.has(notificationId)) return prev;
      const next = new Set(prev);
      next.delete(notificationId);
      return next;
    });
    markNotificationRead(notificationId);
  }

  /** `SWAP_PROPOSED` no longer accepts/rejects from this global, one-at-a-
   * time modal (it can only ever show the FIRST pending proposal, which
   * pre-empts the actual choice — see `RzeczyView`'s per-item list of every
   * competing offer). This just dismisses the notification and sends the
   * caller to "Moje rzeczy", where every pending offer against the item is
   * visible together. */
  function openSwapProposalsOnMyItems(notificationId: string) {
    dismissPendingAction(notificationId);
    navigate("/panel");
    setView("rzeczy");
  }

  async function confirmPendingAction(
    notificationId: string,
    termId: string | null,
    notificationReservationId: string | null,
  ) {
    if (
      notificationReservationId === null &&
      (termId === null || profile?.account_user_id == null)
    ) {
      showToast("Nie udało się potwierdzić — spróbuj ponownie");
      return;
    }
    setPendingActionBusyId(notificationId);
    try {
      const reservationId =
        notificationReservationId ??
        (termId !== null && profile
          ? await resolvePendingReservationId(termId, profile.party_id)
          : null);
      if (reservationId === null) {
        // resolvePendingReservationId only ever omits an ACTIVE reservation
        // (it explicitly skips FULFILLED/CANCELLED ones) — since this party
        // received a TERM_CONFIRMATION_NEEDED notification for an active
        // reservation in the first place, null here means the other party
        // already confirmed/resolved it in the meantime, not "nothing to
        // confirm". Treat it the same as the backend's own already-resolved
        // 409, instead of a generic toast that left the notification stuck
        // (never dismissed) so the modal kept reappearing.
        setAlreadyResolvedIds((prev) => new Set(prev).add(notificationId));
        return;
      }
      await confirmTransaction(reservationId);
      // Bug #3 (cache refresh): matches every sibling mutation handler's
      // convention (e.g. withdrawMyPledge) — without this, the panel's
      // pledges/items/notifications stayed stale until the next unrelated
      // reload.
      await load({ silent: true });
      dismissPendingAction(notificationId);
      showToast("Potwierdzono");
    } catch (err) {
      if (
        err instanceof ApiError &&
        err.status === 409 &&
        err.body &&
        typeof err.body === "object" &&
        (err.body as { already_resolved?: unknown }).already_resolved === true
      ) {
        setAlreadyResolvedIds((prev) => new Set(prev).add(notificationId));
      } else {
        showToast("Nie udało się potwierdzić — spróbuj ponownie");
      }
    } finally {
      setPendingActionBusyId(null);
    }
  }

  /** "Później" / ✕ — session-only; no server call, no notification change. */
  function hideJoinRequest(joinRequestId: string) {
    setHiddenJoinRequestIds((prev) => new Set(prev).add(joinRequestId));
    setResolvedJoinRequestIds((prev) => {
      if (!prev.has(joinRequestId)) return prev;
      const next = new Set(prev);
      next.delete(joinRequestId);
      return next;
    });
    setJoinRequestErrorId((prev) => (prev === joinRequestId ? null : prev));
  }

  function acknowledgeResolvedJoinRequest(joinRequestId: string) {
    hideJoinRequest(joinRequestId);
    void load({ silent: true });
  }

  async function decideJoinRequest(action: PendingJoinRequestAction, decision: JoinRequestDecision) {
    const { joinRequestId, groupId } = action;
    setJoinRequestBusy({ joinRequestId, decision });
    setJoinRequestErrorId(null);
    try {
      if (decision === "approve") await approveJoinRequest(groupId, joinRequestId);
      else await rejectJoinRequest(groupId, joinRequestId);
      const linked = notifications.find(
        (n) => n.kind === "GROUP_JOIN_REQUESTED" && n.join_request_id === joinRequestId && n.read_at === null,
      );
      if (linked) markNotificationRead(linked.id);
      await load({ silent: true });
      showToast(decision === "approve" ? "Prośba zatwierdzona" : "Prośba odrzucona");
    } catch (err) {
      // Any 409 means someone (the requester, another organizer, another tab)
      // already moved the request out of PENDING.
      if (err instanceof ApiError && err.status === 409) {
        setResolvedJoinRequestIds((prev) => new Set(prev).add(joinRequestId));
      } else {
        setJoinRequestErrorId(joinRequestId);
      }
    } finally {
      setJoinRequestBusy(null);
    }
  }

  /* ---------- grupy ---------- */

  async function handleAddGroup() {
    if (!groupForm.name.trim()) return;
    setBusy(true);
    setAddGroupError(null);
    try {
      // Non-idempotent — an organizer who already leads a Circle still gets
      // a genuinely NEW one here (unlike `createMyCircle`, which is reserved
      // for the one-time "become an Organizer" flows).
      const group = await createAdditionalMyCircle({
        name: groupForm.name.trim(),
        visibility: groupForm.visibility,
      });
      if (groupForm.location.trim() || groupForm.freeSpots.trim()) {
        setGroupExtras((prev) => ({
          ...prev,
          [group.id]: { location: groupForm.location.trim(), freeSpots: Number(groupForm.freeSpots) || 0 },
        }));
      }
      setGroupForm({ name: "", location: "", freeSpots: "", visibility: "PUBLIC" });
      setModal(null);
      showToast("Dodano grupę");
      await load();
    } catch (err) {
      setAddGroupError(serverMessageOr(err, "Nie udało się dodać grupy"));
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoveGroup(groupId: string) {
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
    setDraftNeededItem(createEmptyNeededItemQuickAddValue(categoriesData[0]?.id ?? ""));
  }

  function removeDraftNeededItem(index: number) {
    setNeededDraft((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleAddTerm() {
    if (!termGroupId || !termDate) return;
    setBusy(true);
    setAddTermError(null);
    try {
      // Resolve (and so moderate) every product name BEFORE creating the
      // term: a rejected name must not leave a created term behind, or a
      // retry would duplicate it. Products resolved before a rejected term
      // description stay as orphans; a retry reuses them by name.
      const products = [];
      for (const draft of neededDraft) {
        products.push(await resolveProduct({ name: draft.name, category_id: draft.category_id }));
      }
      const term = await createTerm({
        circle_group_id: termGroupId,
        occurs_on: termDate,
        description: termDescription || undefined,
      });
      for (const [i, draft] of neededDraft.entries()) {
        await createNeededItem({
          term_id: term.id,
          product_id: products[i].id,
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
    } catch (err) {
      setAddTermError(serverMessageOr(err, "Nie udało się dodać terminu"));
    } finally {
      setBusy(false);
    }
  }

  /* ---------- rzeczy ---------- */

  async function setItemMode(itemId: string, mode: ItemMode) {
    // Defense-in-depth: `RzeczyView` already disables the toggle buttons
    // while an item is locked (Bug #1 fix), but re-check here too, since
    // the client-side disable is UX, not the sole guard.
    const balance = await getInventoryItemBalance(itemId);
    if (ACTIVE_LOCK_BALANCE_STATUSES.includes(balance.status)) return;
    const next = itemModes[itemId] === mode ? null : mode;
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
      // off-screen on a phone. The refresh flips a card whose photos went
      // into moderation meanwhile to its blocked state.
      showToast(serverMessageOr(err, "Nie udało się zapisać trybu — spróbuj ponownie"));
      void refreshItems();
    }
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

    return (
      <div className="mt-1.5">
        <Link
          to={`/panel/terminy/${term.id}`}
          aria-label={`Zapisani na termin: ${
            hasAttendees ? `${attendeesText}, ${childrenText}` : "brak zapisów"
          }`}
          className="inline-flex items-center gap-1 rounded-full border border-line bg-paper px-2.5 py-0.5 text-[10.5px] font-extrabold text-ink transition-colors hover:border-mint"
        >
          {hasAttendees && (
            <span aria-hidden="true" className="flex [&>svg]:h-3.5 [&>svg]:w-3.5">
              <FamilyIcon />
            </span>
          )}
          {hasAttendees ? `${attendeesText} · ${childrenText}` : "Brak zapisów"}
          <span aria-hidden="true">›</span>
        </Link>
      </div>
    );
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

  /* ---------- krąg: dialog "Edytuj grupę" (nazwa, lokalizacja, miejsca, layout) ---------- */

  function startEditGroup(group: GroupResponse) {
    const extra = groupExtras[group.id];
    setEditingGroupId(group.id);
    setEditGroupForm({
      name: group.name,
      location: extra?.location ?? "",
      freeSpots: extra ? String(extra.freeSpots) : "",
      layoutMode: group.layout_mode,
      visibility: group.visibility,
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
    if (!name) return;
    setBusy(true);
    setEditGroupError(null);
    try {
      // `layout_mode`/`visibility` are always sent alongside `name` —
      // `UpdateGroupRequest.name` is a required field (not partial-apply), so
      // this single PATCH covers the rename, the layout-template change, and
      // the public/private toggle in one request.
      await updateGroupLayoutMode(group.id, name, editGroupForm.layoutMode, editGroupForm.visibility);
      // Location/"ile miejsc" stay client-local only (no backend field yet —
      // same as the "Dodaj grupę" creation form's `groupForm.location`/
      // `freeSpots`), mirroring `handleAddGroup`'s pattern.
      if (editGroupForm.location.trim() || editGroupForm.freeSpots.trim()) {
        setGroupExtras((prev) => ({
          ...prev,
          [group.id]: {
            location: editGroupForm.location.trim(),
            freeSpots: Number(editGroupForm.freeSpots) || 0,
          },
        }));
      } else {
        setGroupExtras((prev) => {
          const rest = { ...prev };
          delete rest[group.id];
          return rest;
        });
      }
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

  /* ---------- wypożyczone (oddawanie pożyczonej rzeczy) ---------- */

  async function returnBorrowedItem(itemId: string) {
    setItemError(null);
    try {
      // The server derives the recipient (the item's home owner) itself. The
      // caller (the borrower) is still the item's current holder, so per the
      // confirm-authorization rule they may confirm and fulfill their own
      // proposal in one go — no separate approval from the lender is
      // needed to hand it back.
      const reservation =
        (await findUnfinishedReturn(itemId)) ??
        (await createReservation({ item_id: itemId, reservation_type: "RETURN" }));
      if (reservation.status === "PENDING") {
        await confirmReservation(reservation.id);
      }
      await fulfillReservation(reservation.id);
      setBorrowedItems((prev) => prev.filter((b) => b.itemId !== itemId));
      showToast("Oddano");
    } catch {
      setItemError("Nie udało się oddać rzeczy — spróbuj ponownie");
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
    pendingActions,
    pendingActionBusyId,
    alreadyResolvedIds,
    dismissPendingAction,
    openSwapProposalsOnMyItems,
    confirmPendingAction,
    joinRequestBusy,
    resolvedJoinRequestIds,
    joinRequestErrorId,
    hideJoinRequest,
    acknowledgeResolvedJoinRequest,
    decideJoinRequest,
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
    hintFirstTermDismissed,
    hintBecomeOrganizerDismissed,
    hintOrgFirstTermDismissed,
    hintOrgPolishDismissed,
    profileName,
    profileBio,
    profileSaved,
    profileError,
    avatarBusy,
    avatarError,
    settings,
    groupExtras,
    itemModes,
    borrowedItems,
    lentOutItems,
    memberName,
    memberRole,
    memberBirthYear,
    groupForm,
    termGroupId,
    termDate,
    termDescription,
    neededDraft,
    draftNeededItem,
    items,
    categories: categoriesData,
    // --- setters the render calls directly ---
    setView,
    setModal,
    setFirstTermForOrganizer,
    setProfileName,
    setProfileBio,
    setSettings,
    setGroupForm,
    setTermGroupId,
    setTermDate,
    setTermDescription,
    setDraftNeededItem,
    setEditTermId,
    setMemberName,
    setMemberRole,
    setMemberBirthYear,
    setEditGroupForm,
    setFamilyNameDraft,
    // --- derived ---
    isOrganizer,
    showToast,
    load,
    itemCounts,
    returnBorrowedItem,
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

/** Group 7's global pending-actions modal — rendered from this same top-
 * level provider (alongside the notification-bell state it's derived
 * from), so it appears on top of whichever `/panel/*` section is mounted,
 * not just the term page. Shows at most one prompt at a time (oldest
 * first, via `pendingActions[0]`); accepting/dismissing one immediately
 * reveals the next on the next render. */
function GlobalPendingActionsModal({ value }: { value: PanelDataContextValue }) {
  const {
    pendingActions,
    pendingActionBusyId,
    alreadyResolvedIds,
    dismissPendingAction,
    openSwapProposalsOnMyItems,
    confirmPendingAction,
  } = value;
  const action = pendingActions[0];
  if (!action) return null;
  if (action.kind === "GROUP_JOIN_REQUESTED") return <JoinRequestActionSheet action={action} value={value} />;

  const busy = pendingActionBusyId === action.notificationId;
  const alreadyResolved = alreadyResolvedIds.has(action.notificationId);
  const title = action.kind === "SWAP_PROPOSED" ? "Propozycja zamiany" : "Potwierdź transakcję";

  return (
    <ModalSheet title={title} onClose={() => dismissPendingAction(action.notificationId)}>
      <p className="text-sm text-ink">{action.message}</p>

      {alreadyResolved ? (
        <>
          <p className="mt-3 text-sm font-semibold text-danger" role="alert">
            Transakcja została już rozstrzygnięta przez drugą stronę.
          </p>
          <button
            type="button"
            className="mt-3 rounded-full border border-line px-4 py-2 text-sm font-semibold text-ink-soft"
            onClick={() => dismissPendingAction(action.notificationId)}
          >
            Rozumiem
          </button>
        </>
      ) : action.kind === "TERM_CONFIRMATION_NEEDED" ? (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            className="rounded-full bg-mint px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
            disabled={busy}
            onClick={() =>
              void confirmPendingAction(action.notificationId, action.termId, action.reservationId)
            }
          >
            Potwierdź
          </button>
          <button
            type="button"
            className="rounded-full border border-line px-4 py-2 text-sm font-semibold text-ink-soft"
            onClick={() => dismissPendingAction(action.notificationId)}
          >
            Później
          </button>
        </div>
      ) : (
        // Info only, no Accept/Reject here — this modal can only ever show
        // the FIRST pending proposal (`pendingActions[0]`), which would
        // pre-empt the actual choice among competing offers. Sends the
        // caller to "Moje rzeczy" instead, where every pending offer
        // against the item is listed together (see `RzeczyView`).
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            className="rounded-full bg-mint px-4 py-2 text-sm font-bold text-white"
            onClick={() => openSwapProposalsOnMyItems(action.notificationId)}
          >
            Zobacz w Moje rzeczy
          </button>
          <button
            type="button"
            className="rounded-full border border-line px-4 py-2 text-sm font-semibold text-ink-soft"
            onClick={() => dismissPendingAction(action.notificationId)}
          >
            Później
          </button>
        </div>
      )}
    </ModalSheet>
  );
}

function JoinRequestActionSheet({
  action,
  value,
}: {
  action: PendingJoinRequestAction;
  value: PanelDataContextValue;
}) {
  const {
    joinRequestBusy,
    resolvedJoinRequestIds,
    joinRequestErrorId,
    hideJoinRequest,
    acknowledgeResolvedJoinRequest,
    decideJoinRequest,
  } = value;
  const { joinRequestId } = action;
  const busyDecision = joinRequestBusy?.joinRequestId === joinRequestId ? joinRequestBusy.decision : null;
  const sentOn = new Date(action.createdAt).toLocaleDateString("pl-PL", { day: "numeric", month: "long" });

  return (
    <ModalSheet title="Prośba o dostęp" onClose={() => hideJoinRequest(joinRequestId)}>
      <p className="text-sm text-ink">
        {action.requesterName} prosi o dostęp do grupy <strong>„{action.groupName}”</strong>.
      </p>
      <p className="mt-1 text-xs text-ink-soft">Wysłano {sentOn}</p>

      {resolvedJoinRequestIds.has(joinRequestId) ? (
        <>
          <p className="mt-3 text-sm font-semibold text-danger" role="alert">
            Prośba została już rozstrzygnięta.
          </p>
          <button
            type="button"
            className="mt-3 rounded-full border border-line px-4 py-2 text-sm font-semibold text-ink-soft"
            onClick={() => acknowledgeResolvedJoinRequest(joinRequestId)}
          >
            Rozumiem
          </button>
        </>
      ) : (
        <>
          {joinRequestErrorId === joinRequestId && (
            <p className="mt-3 text-sm font-semibold text-danger" role="alert">
              Nie udało się zapisać decyzji — spróbuj ponownie
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-full bg-mint px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
              disabled={busyDecision !== null}
              aria-busy={busyDecision !== null}
              onClick={() => void decideJoinRequest(action, "approve")}
            >
              {busyDecision === "approve" ? "Zatwierdzanie…" : "Zatwierdź"}
            </button>
            <button
              type="button"
              className="rounded-full border border-line px-4 py-2 text-sm font-semibold text-ink-soft disabled:opacity-60"
              disabled={busyDecision !== null}
              aria-busy={busyDecision !== null}
              onClick={() => void decideJoinRequest(action, "reject")}
            >
              {busyDecision === "reject" ? "Odrzucanie…" : "Odrzuć"}
            </button>
            <button
              type="button"
              className="rounded-full border border-line px-4 py-2 text-sm font-semibold text-ink-soft"
              onClick={() => hideJoinRequest(joinRequestId)}
            >
              Później
            </button>
          </div>
        </>
      )}
    </ModalSheet>
  );
}

export function PanelDataProvider({ children }: { children: ReactNode }) {
  const value = usePanelDataValue();
  return (
    <PanelDataContext value={value}>
      {children}
      <GlobalPendingActionsModal value={value} />
    </PanelDataContext>
  );
}
