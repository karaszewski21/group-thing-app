import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
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
import { CONDITION_LABELS } from "../../utils/productPicker";
import { getLeadershipsForPerson, getMyProfile, type UserProfileResponse } from "../../api/people";
import { getMyOrganization } from "../../api/organizations";
import {
  getProducts,
  resolveProduct,
  type ProductCategory,
  type ProductResponse,
} from "../../api/products";
import { CATEGORY_LABELS, PRODUCT_CATEGORIES } from "../../utils/productCategory";
import {
  createNeededItem,
  createTerm,
  getNeededItems,
  getTerms,
  type NeededItemCategory,
  type NeededItemResponse,
  type TermResponse,
} from "../../api/terms";
import { PhoneFrame } from "../../components/shared/PhoneFrame";
import { ItemQuickAddForm } from "../../components/shared/ItemQuickAddForm";
import { createEmptyItemQuickAddValue, type ItemQuickAddValue } from "../../utils/itemQuickAdd";
import { ApiError } from "../../api/client";
import { CreateFamilyDialog } from "../../components/panel/CreateFamilyDialog";
import { EditTermDialog } from "../../components/panel/EditTermDialog";
import { FirstTermStepperGuest } from "../../components/panel/FirstTermStepperGuest";
import { FirstTermStepperOrganizer } from "../../components/panel/FirstTermStepperOrganizer";

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
/* ------------------------------------------------------------------ */

type View = "home" | "spotkania" | "rzeczy" | "podarki" | "profil" | "ustawienia" | "rodzina";
type ModalKind =
  | "grupa"
  | "termin"
  | "rzecz"
  | "pierwszy-termin"
  | "rodzina-nowa"
  | "edit-termin"
  | null;
type ItemMode = "wypożyczę" | "oddam" | "zamienię";
type GiftSource = "pożyczone" | "otrzymane" | "zamienione";

interface LocalGift {
  id: string;
  name: string;
  from: string;
  source: GiftSource;
}

interface DraftNeededItem {
  category: NeededItemCategory;
  description: string;
}

interface TermWithNeeded {
  term: TermResponse;
  group: GroupResponse;
  neededItems: NeededItemResponse[];
}

const NEEDED_ITEM_LABELS: Record<NeededItemCategory, string> = {
  INSTRUMENT: "Instrument",
  MAT_BLANKET: "Mata/koc",
  ART_SUPPLIES: "Materiały plastyczne",
  OTHER: "Inne",
};

const ITEM_MODES: ItemMode[] = ["wypożyczę", "oddam", "zamienię"];
const ITEM_MODE_STYLE: Record<ItemMode, { bg: string; c: string }> = {
  "wypożyczę": { bg: "var(--color-teal-soft)", c: "#245F61" },
  "oddam": { bg: "var(--color-mint-soft)", c: "#12604D" },
  "zamienię": { bg: "var(--color-lime-soft)", c: "#56701F" },
};
const GIFT_SOURCE_STYLE: Record<GiftSource, { bg: string; c: string }> = {
  "pożyczone": { bg: "var(--color-teal-soft)", c: "#245F61" },
  "otrzymane": { bg: "var(--color-mint-soft)", c: "#12604D" },
  "zamienione": { bg: "var(--color-lime-soft)", c: "#56701F" },
};
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function dayMonth(isoDate: string): { day: string; month: string } {
  const d = new Date(`${isoDate}T00:00:00`);
  const day = String(d.getDate());
  const month = d.toLocaleDateString("pl-PL", { month: "short" }).replace(".", "");
  return { day, month };
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return (words[0]?.[0] ?? "?").toUpperCase() + (words[1]?.[0] ?? "").toUpperCase();
}

/** Public per-term URL. `group.organizer_slug` is always set by the backend
 * (the organizer's Organization slug, or a stable `k-<hash>` when they have
 * no Organization) — the `?? "krag"` only guards the `GET /api/groups` list
 * response, which the Panel never uses to build these links. */
function termPublicPath(group: GroupResponse, termId: number): string {
  return `/${group.organizer_slug ?? "krag"}/grupa/${group.id}/term/${termId}`;
}

/* ---------------- ikony ---------------- */

const HomeIcon = ({ c = "#1E2E27" }: { c?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-[22px] w-[22px]">
    <path d="M4 11.5 12 4l8 7.5" stroke={c} strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
    <path
      d="M6 10v9a1 1 0 0 0 1 1h3v-5a2 2 0 0 1 2-2 2 2 0 0 1 2 2v5h3a1 1 0 0 0 1-1v-9"
      stroke={c} strokeWidth="2.1" strokeLinejoin="round"
    />
  </svg>
);
const CalendarIcon = ({ c = "#1E2E27" }: { c?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-[22px] w-[22px]">
    <rect x="3.5" y="5" width="17" height="15" rx="3" stroke={c} strokeWidth="2.1" />
    <path d="M3.5 9.5h17M8 3v4M16 3v4" stroke={c} strokeWidth="2.1" strokeLinecap="round" />
  </svg>
);
const BoxIcon = ({ c = "#1E2E27" }: { c?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-[22px] w-[22px]">
    <path d="M3.5 8.3 12 4l8.5 4.3-8.5 4.3-8.5-4.3Z" stroke={c} strokeWidth="2" strokeLinejoin="round" />
    <path d="M3.5 8.3V16l8.5 4 8.5-4V8.3M12 12.6V20" stroke={c} strokeWidth="2" strokeLinejoin="round" />
  </svg>
);
const GiftIcon = ({ c = "#1E2E27" }: { c?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-[22px] w-[22px]">
    <rect x="3.5" y="9.5" width="17" height="11" rx="2" stroke={c} strokeWidth="2" strokeLinejoin="round" />
    <path d="M3.5 9.5h17M12 9.5v11" stroke={c} strokeWidth="2" strokeLinecap="round" />
    <path
      d="M12 9.5c-2.5 0-4-1.4-4-3a2 2 0 0 1 4 0 2 2 0 0 1 4 0c0 1.6-1.5 3-4 3Z"
      stroke={c} strokeWidth="2" strokeLinejoin="round"
    />
  </svg>
);
const SettingsIcon = ({ c = "#1E2E27" }: { c?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-[18px] w-[18px]">
    <circle cx="12" cy="12" r="3.2" stroke={c} strokeWidth="2" />
    <path
      d="M19.4 13.5c.1-.5.1-1 0-1.5l1.9-1.4-1.5-2.6-2.2.7c-.4-.3-.8-.6-1.3-.8l-.3-2.3H11l-.3 2.3c-.5.2-.9.5-1.3.8l-2.2-.7-1.5 2.6L7.6 12c-.1.5-.1 1 0 1.5l-1.9 1.4 1.5 2.6 2.2-.7c.4.3.8.6 1.3.8l.3 2.3h3l.3-2.3c.5-.2.9-.5 1.3-.8l2.2.7 1.5-2.6-1.9-1.4Z"
      stroke={c} strokeWidth="1.7" strokeLinejoin="round"
    />
  </svg>
);
const CalendarPlusIcon = ({ c = "#1E2E27" }: { c?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-[18px] w-[18px]">
    <rect x="3.5" y="5" width="17" height="15" rx="3" stroke={c} strokeWidth="2" />
    <path d="M3.5 9.5h17M8 3v4M16 3v4" stroke={c} strokeWidth="2" strokeLinecap="round" />
    <path d="M12 12.5v5M9.5 15h5" stroke={c} strokeWidth="2" strokeLinecap="round" />
  </svg>
);
const BuildingIcon = ({ c = "#1E2E27" }: { c?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-[18px] w-[18px]">
    <rect x="4" y="3" width="16" height="18" rx="1.5" stroke={c} strokeWidth="2" />
    <path d="M8 7h1.5M14.5 7H16M8 11h1.5M14.5 11H16M8 15h1.5M14.5 15H16" stroke={c} strokeWidth="2" strokeLinecap="round" />
  </svg>
);
const UserIcon = ({ c = "#1E2E27" }: { c?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-[18px] w-[18px]">
    <circle cx="12" cy="8" r="3.6" stroke={c} strokeWidth="2" />
    <path d="M4.5 20c.8-4 3.7-6 7.5-6s6.7 2 7.5 6" stroke={c} strokeWidth="2" strokeLinecap="round" />
  </svg>
);
const MenuIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-[22px] w-[22px]">
    <path d="M4 7h16M4 12h16M4 17h16" stroke="#1E2E27" strokeWidth="2.1" strokeLinecap="round" />
  </svg>
);
const BackIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M14.5 5 8 12l6.5 7" stroke="#1E2E27" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const CloseIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-4 w-4">
    <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
  </svg>
);
const TrashIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M4 7h16M9.5 7V4.8c0-.7.6-1.3 1.3-1.3h2.4c.7 0 1.3.6 1.3 1.3V7M6.5 7l1 12.4c.1 1 .9 1.8 1.9 1.8h5.2c1 0 1.8-.8 1.9-1.8L17.5 7"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    />
  </svg>
);
const FamilyIcon = ({ c = "#1E2E27" }: { c?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-[22px] w-[22px]">
    <circle cx="8" cy="8" r="2.6" stroke={c} strokeWidth="2" />
    <circle cx="17" cy="9" r="2.1" stroke={c} strokeWidth="2" />
    <path d="M3 20c.7-3.4 2.6-5.2 5-5.2s4.3 1.8 5 5.2" stroke={c} strokeWidth="2" strokeLinecap="round" />
    <path d="M14.2 15.4c1.9.2 3.2 1.7 3.8 4.6" stroke={c} strokeWidth="2" strokeLinecap="round" />
  </svg>
);
const PencilIcon = ({ c = "#5C7069" }: { c?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-4 w-4">
    <path
      d="M4 20h4L18.5 9.5a2 2 0 0 0 0-2.8l-1.2-1.2a2 2 0 0 0-2.8 0L4 16v4Z"
      stroke={c} strokeWidth="2" strokeLinejoin="round"
    />
  </svg>
);
const CopyIcon = ({ c = "#5C7069" }: { c?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-4 w-4">
    <rect x="9" y="9" width="11" height="11" rx="2" stroke={c} strokeWidth="2" />
    <path
      d="M15 5.5A2.5 2.5 0 0 0 12.5 3h-7A2.5 2.5 0 0 0 3 5.5v7A2.5 2.5 0 0 0 5.5 15"
      stroke={c} strokeWidth="2" strokeLinecap="round"
    />
  </svg>
);
const LogoutIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-[18px] w-[18px]">
    <path
      d="M15 4h3.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H15M14 12H4m0 0 4-4m-4 4 4 4"
      stroke="#B23B3B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    />
  </svg>
);

const NAV_ITEMS: { key: View; label: string; Icon: typeof HomeIcon }[] = [
  { key: "home", label: "Home", Icon: HomeIcon },
  { key: "spotkania", label: "Spotkania", Icon: CalendarIcon },
  { key: "rzeczy", label: "Moje rzeczy", Icon: BoxIcon },
  { key: "podarki", label: "Podarki", Icon: GiftIcon },
];

export function PanelPage() {
  const { logout } = useAuth();

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
  const [neededDraft, setNeededDraft] = useState<DraftNeededItem[]>([]);
  const [draftCategory, setDraftCategory] = useState<NeededItemCategory>("OTHER");
  const [draftDescription, setDraftDescription] = useState("");

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
    setNeededDraft((prev) => [...prev, { category: draftCategory, description: draftDescription.trim() }]);
    setDraftDescription("");
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
      for (const item of neededDraft) {
        await createNeededItem({ term_id: term.id, category: item.category, description: item.description || undefined });
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
            <p className="mt-0.5 text-[12.5px] text-ink-soft">{term.description || "Bez opisu"}</p>
            {neededItems.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {neededItems.map((ni) => (
                  <span
                    key={ni.id}
                    className="rounded-full bg-lime-soft px-2.5 py-0.5 text-[10.5px] font-extrabold text-[#56701F]"
                  >
                    {NEEDED_ITEM_LABELS[ni.category]}
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

  const isTopLevel =
    view === "home" || view === "spotkania" || view === "rzeczy" || view === "podarki";

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

/* ---------------- małe komponenty pomocnicze ---------------- */

function ToggleRow({
  label, hint, checked, onChange,
}: { label: string; hint: string; checked: boolean; onChange: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-line py-3.5 first:border-t-0">
      <div>
        <strong className="block text-sm text-ink">{label}</strong>
        <small className="mt-0.5 block text-xs text-ink-soft">{hint}</small>
      </div>
      <button
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={onChange}
        className={`relative h-[26px] w-11 flex-none rounded-full transition-colors ${checked ? "bg-mint" : "bg-line"}`}
      >
        <span
          className="absolute top-[3px] left-[3px] h-5 w-5 rounded-full bg-white shadow transition-transform"
          style={checked ? { transform: "translateX(18px)" } : undefined}
        />
      </button>
    </div>
  );
}

/** Dismissible Panel-home nudge card (spec.md §3, Mockups 4/5). Same card
 * shell/spacing rhythm as "Najbliższe terminy"/"Twoje rzeczy", with a mint
 * accent to read as actionable/new. CTA is either a `Link` (org-polish, to
 * "/organization") or a plain button (both first-term variants, opens the
 * "pierwszy-termin" modal) — never both, so exactly one of `ctaTo`/
 * `onCtaClick` is expected per instance. */
function HintCard({
  icon, title, description, ctaLabel, ctaTo, onCtaClick, onDismiss,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  ctaLabel: string;
  ctaTo?: string;
  onCtaClick?: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="mb-3.5 rounded-[22px] border border-mint bg-mint-soft p-5">
      <div className="mb-1.5 flex items-start justify-between gap-2.5">
        <div className="flex items-center gap-2">
          {icon}
          <h3 className="text-base font-semibold text-ink">{title}</h3>
        </div>
        <button
          onClick={onDismiss}
          aria-label={`Zamknij: ${title}`}
          className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-full bg-cream text-ink-soft hover:bg-danger-soft hover:text-danger"
        >
          <CloseIcon />
        </button>
      </div>
      <p className="text-[13.5px] text-ink-soft">{description}</p>
      {ctaTo ? (
        <Link to={ctaTo} className="mt-3 inline-block text-[13px] font-extrabold text-mint hover:underline">
          {ctaLabel}
        </Link>
      ) : (
        <button onClick={onCtaClick} className="mt-3 text-[13px] font-extrabold text-mint hover:underline">
          {ctaLabel}
        </button>
      )}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-extrabold tracking-wide text-ink-soft">{label}</label>
      {children}
    </div>
  );
}

export function ModalSheet({
  title, onClose, children,
}: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-[rgba(20,28,24,0.55)] min-[520px]:items-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[88vh] w-full max-w-[430px] overflow-y-auto rounded-t-[24px] bg-paper p-5 min-[520px]:max-h-[80vh] min-[520px]:rounded-[24px]"
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-ink">{title}</h3>
          <button
            onClick={onClose}
            aria-label="Zamknij"
            className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-cream text-ink-soft hover:bg-danger-soft hover:text-danger"
          >
            <CloseIcon />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
