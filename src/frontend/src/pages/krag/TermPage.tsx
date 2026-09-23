import { useCallback, useEffect, useMemo, useState } from "react";
import { gateAction } from "../../utils/actionGate";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useKragGrupy } from "../../hooks/useKragGrupy";
import { usePublicKragGrupy } from "../../hooks/usePublicKragGrupy";
import { PrivateGroupAccessDenied } from "./PrivateGroupAccessDenied";
import {
  getInventories,
  getInventoryItemBalance,
  getInventoryItems,
  type ItemCondition,
} from "../../api/inventories";
import { createPledge, type FulfillPledgeRequest } from "../../api/pledges";
import { getMyItemListingPreferences } from "../../api/itemListingPreferences";
import { getMyProfile } from "../../api/people";
import { getProducts } from "../../api/products";
import { ApiError } from "../../api/client";
import { CONDITION_LABELS } from "../../utils/productCategory";
import { familyColor, familyInitials } from "../../components/shared/Avatar";
import { GroupVisualization } from "./GroupVisualization";
import { RsvpDialog } from "../../components/krag/RsvpDialog";
import { RsvpDialogLoggedIn } from "../../components/krag/RsvpDialogLoggedIn";
import { JoinPrivateGroupDialog } from "../../components/krag/JoinPrivateGroupDialog";
import { RsvpGateDialog } from "../../components/krag/RsvpGateDialog";
import { PledgeGateDialog } from "../../components/krag/PledgeGateDialog";
import { AccountMergeForm } from "../../components/krag/AccountMergeForm";
import { useAuth } from "../../auth/AuthContext";
import {
  getGroupAccess,
  guestProfileIdKey,
  readValidGuestProfile,
  type GroupAccessResponse,
  type RsvpResponse,
} from "../../api/groups";
import { getReservation, type ReservationResponse, type ReservationType } from "../../api/reservations";
import {
  getMyTakenTermItemListings,
  proposeSwap as proposeSwapApi,
  takeTermItemListing,
  type BrowseTermItemListingResponse,
  type TakeTermItemListingRequest,
} from "../../api/termItemListings";
import type { AvailableItem } from "../../hooks/useKragGrupy";
import { GroupHeader } from "./components/GroupHeader";
import { TermCard } from "./components/TermCard";
import { FamilyCard } from "./components/FamilyCard";
import { NeededItemsSection } from "./components/NeededItemsSection";
import { ListingsSection } from "./components/ListingsSection";
import { SwapProposeDialog } from "./components/SwapProposeDialog";
import { LISTABLE_RESERVATION_TYPES, OFFERED_TYPE_LABELS, TAKE_ACTION_LABELS } from "./components/termLabels";
import type {
  ListingRowVM,
  NeededItemRowVM,
  TermActionVM,
  TermSectionVM,
} from "./components/termSectionTypes";

/** Class date + wall-clock start time for display. `occurs_on` is an ISO
 * datetime; a bare-date fallback (no time part) shows just the date. */
function formatTermWhen(iso: string): { date: string; time: string } {
  const date = new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString("pl-PL", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const t = iso.slice(11, 16);
  const time = /^\d{2}:\d{2}$/.test(t) && t !== "00:00" ? t : "";
  return { date, time };
}

/* ------------------------------------------------------------------ */
/*  Krąg grupy — zajęcia + prośby o rzeczy (dane z API, nie mock)       */
/*  Scalenie KragGrupy.tsx + KragGrupyStart.tsx z pages/ (SPEC.md #3): */
/*  jeden komponent, liczba rodzin wynika z realnych Membership.        */
/*  Term/NeededItem/Pledge ("kto co przynosi") plus the lending exchange   */
/*  ("pożycz/zamień/weź na stałe"), sourced from each item's standing      */
/*  ItemListingPreference (set in Moje rzeczy — no per-Term listing form   */
/*  here anymore) and gated on the caller's own TermAttendance for the     */
/*  current Term, OR being the Term's Circle organizer.                    */
/* ------------------------------------------------------------------ */

export const CSS = `
:root{
  --cream:#F4F8F0;--paper:#FFFFFF;--ink:#1E2E27;--ink-soft:#5C7069;
  --mint:#1B8168;--mint-soft:#D8F0E6;--sage:#5D8A63;--sage-soft:#DFEBDC;
  --teal:#6FB6B8;--teal-soft:#D9ECEC;--lime:#A9C24F;--line:#E2EADF;
  --danger:#B4443A;
}
*,*::before,*::after{box-sizing:border-box;}
.kg-stage{background:#EDF1EA;min-height:100vh;display:flex;justify-content:center;
  font-family:Karla,"Segoe UI",system-ui,sans-serif;color:var(--ink);-webkit-font-smoothing:antialiased;}
.kg-app{width:100%;max-width:430px;background:var(--cream);display:flex;flex-direction:column;min-height:100vh;}
.kg-app h1,.kg-app h2,.kg-app h3{font-family:Fraunces,Georgia,serif;font-weight:600;letter-spacing:-.02em;line-height:1.12;margin:0;}
.kg-app p{margin:0;line-height:1.6;}
.kg-app button{font-family:inherit;cursor:pointer;}
.kg-head{background:var(--paper);border-bottom:1px solid var(--line);padding:18px 18px 16px;position:sticky;top:0;z-index:20;}
.kg-head-row{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;}
.kg-eyebrow{font-size:11px;letter-spacing:.15em;text-transform:uppercase;font-weight:800;color:var(--sage);}
.kg-head h1{font-size:23px;margin-top:5px;}
.kg-head-sub{font-size:13.5px;color:var(--ink-soft);margin-top:4px;}
.kg-back{border:none;background:none;color:var(--mint);font-weight:700;font-size:13px;padding:0 0 8px;}
.kg-circle-wrap{padding:26px 18px 6px;}
.kg-stagebox{position:relative;width:100%;max-width:360px;margin:0 auto;}
.kg-square{position:relative;width:100%;padding-top:100%;}
.kg-inner{position:absolute;inset:0;}
.kg-svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible;}
.kg-fam{position:absolute;transform:translate(-50%,-50%);background:none;border:none;padding:0;transition:opacity .25s ease;}
.kg-av{position:relative;width:52px;height:52px;border-radius:50%;display:flex;align-items:center;justify-content:center;
  color:#fff;font-weight:800;font-size:14.5px;border:3px solid var(--cream);box-shadow:0 8px 18px -10px rgba(30,46,39,.7);
  transition:transform .22s cubic-bezier(.2,.8,.2,1);}
.kg-fam:hover .kg-av{transform:scale(1.09);}
.kg-fam.is-on .kg-av{transform:scale(1.1);box-shadow:0 0 0 4px var(--mint-soft),0 8px 18px -10px rgba(30,46,39,.7);}
.kg-mark{position:absolute;right:-5px;bottom:-5px;width:20px;height:20px;border-radius:50%;
  display:flex;align-items:center;justify-content:center;border:2.5px solid var(--cream);font-size:11px;color:#fff;}
.kg-mark-left{position:absolute;left:-5px;bottom:-5px;width:20px;height:20px;border-radius:50%;
  display:flex;align-items:center;justify-content:center;border:2.5px solid var(--cream);font-size:11px;color:#fff;}
.kg-mark-shares{background:var(--mint);}
.kg-mark-brings{background:var(--teal);}
.kg-center{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);text-align:center;width:48%;}
.kg-center-av{width:74px;height:74px;border-radius:50%;background:var(--ink);margin:0 auto;display:flex;align-items:center;justify-content:center;
  color:#fff;font-family:Fraunces,Georgia,serif;font-size:22px;box-shadow:0 14px 28px -14px rgba(30,46,39,.85);}
.kg-center strong{display:block;margin-top:10px;font-family:Fraunces,Georgia,serif;font-size:15px;}
.kg-center span{display:block;font-size:12px;color:var(--ink-soft);}
.kg-bring{margin:18px 18px 0;background:var(--paper);border:1px solid var(--line);border-radius:22px;padding:17px;}
.kg-bring h2{font-size:17px;}
.kg-bring-sub{font-size:12.5px;color:var(--ink-soft);margin-top:3px;}
.kg-bring-list{margin-top:12px;}
.kg-bring-item{padding:10px 0;}
.kg-bring-item + .kg-bring-item{border-top:1px solid var(--line);}
.kg-bring-row{display:flex;align-items:center;gap:11px;}
.kg-bring-av{width:36px;height:36px;border-radius:50%;flex:none;color:#fff;font-weight:800;font-size:12px;display:flex;align-items:center;justify-content:center;}
.kg-bring-av-empty{background:none;border:2px dashed var(--line);color:var(--ink-soft);}
.kg-bring-body{flex:1;min-width:0;}
.kg-bring-body strong{display:block;font-size:14px;}
.kg-bring-body small{display:block;color:var(--ink-soft);font-size:12px;margin-top:1px;}
.kg-bring-btn{flex:none;border:1.5px solid var(--mint);background:var(--paper);color:var(--mint);border-radius:999px;padding:7px 13px;font-size:12px;font-weight:800;}
.kg-bring-btn.is-on{background:var(--mint);color:#fff;}
.kg-bring-empty{font-size:13px;color:var(--ink-soft);text-align:center;padding:16px 0;}
.kg-fulfill{margin-top:10px;padding-top:10px;border-top:1px dashed var(--line);}
.kg-fulfill-row{display:flex;gap:8px;margin-bottom:8px;}
.kg-select,.kg-input{flex:1;min-width:0;border:1.5px solid var(--line);border-radius:12px;padding:8px 10px;font-size:13px;font-family:inherit;background:var(--cream);color:var(--ink);}
.kg-select:focus,.kg-input:focus{outline:none;border-color:var(--mint);box-shadow:0 0 0 3px var(--mint-soft);}
.kg-fulfill-actions{display:flex;gap:8px;}
.kg-btn-primary{border:none;background:var(--mint);color:#fff;border-radius:999px;padding:7px 14px;font-size:12px;font-weight:800;}
.kg-btn-primary:disabled{opacity:.6;}
.kg-btn-ghost{border:1.5px solid var(--line);background:none;color:var(--ink-soft);border-radius:999px;padding:7px 14px;font-size:12px;font-weight:700;}
.kg-status-line{font-size:12px;color:var(--sage);font-weight:700;margin-top:8px;}
.kg-error{color:var(--danger);font-size:12px;margin-bottom:10px;}
.kg-card{margin:18px 18px 24px;background:var(--paper);border:1px solid var(--line);border-radius:22px;padding:17px;}
.kg-card-top{display:flex;align-items:center;gap:12px;}
.kg-card-av{width:44px;height:44px;border-radius:50%;flex:none;color:#fff;font-weight:800;font-size:13.5px;display:flex;align-items:center;justify-content:center;}
.kg-card-top h3{font-size:17px;}
.kg-card-top small{font-size:13px;color:var(--ink-soft);}
.kg-hint{text-align:center;font-size:13px;color:var(--ink-soft);padding:4px 24px 26px;}
.kg-toast{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:120;background:var(--ink);color:#EAF2E9;
  border-radius:999px;padding:11px 20px;font-size:14px;font-weight:600;box-shadow:0 14px 30px -14px rgba(30,46,39,.9);}
.kg-state{text-align:center;padding:60px 24px;color:var(--ink-soft);}
.kg-term{margin:18px 18px 0;background:linear-gradient(135deg,var(--mint-soft),var(--paper));
  border:1px solid var(--line);border-radius:22px;padding:18px;}
.kg-term-eyebrow{font-size:11px;letter-spacing:.14em;text-transform:uppercase;font-weight:800;color:var(--mint);}
.kg-term-date{font-family:Fraunces,Georgia,serif;font-size:20px;font-weight:600;color:var(--ink);
  margin-top:6px;text-transform:capitalize;line-height:1.15;}
.kg-term-time{display:inline-flex;align-items:center;gap:6px;margin-top:10px;background:var(--paper);
  border:1px solid var(--line);border-radius:999px;padding:5px 12px;font-size:13px;font-weight:800;color:var(--ink);}
.kg-term-desc{font-size:13px;color:var(--ink-soft);margin-top:10px;}
.kg-term-empty{font-size:13.5px;color:var(--ink-soft);}
@media (min-width:520px){
  .kg-stage{padding:26px 16px;background:#E7EDE4;}
  .kg-app{min-height:0;border-radius:34px;overflow:hidden;box-shadow:0 40px 80px -40px rgba(30,46,39,.6),0 0 0 9px #1E2E27;margin:8px 0;}
}
`;

/** Shared presentational tree for the needed-items and listings sections —
 * the parts of the term page that are structurally identical whether the
 * data came from `useKragGrupy` (private) or `usePublicKragGrupy` (public).
 * Both callers build `*RowVM`s from their own hook's data and their own
 * gate-wrapped (`gateAction`) handlers; a not-logged-in viewer is fed the
 * exact same rows/buttons as a logged-in one — only the wrapped handlers
 * behave differently on click. `myListingsSection` is private-only (the
 * public view never has "your own" listings for a term it hasn't joined). */
export interface TermPageViewProps {
  isLoggedIn: boolean;
  neededItemsSection?: TermSectionVM<NeededItemRowVM>;
  myListingsSection?: TermSectionVM<ListingRowVM>;
  browseListingsSection?: TermSectionVM<ListingRowVM>;
}

export function TermPageView({ neededItemsSection, myListingsSection, browseListingsSection }: TermPageViewProps) {
  return (
    <>
      {neededItemsSection && <NeededItemsSection section={neededItemsSection} />}

      {(myListingsSection || browseListingsSection) && (
        <div className="kg-bring">
          {myListingsSection && <ListingsSection section={myListingsSection} />}
          {browseListingsSection && <ListingsSection section={browseListingsSection} />}
        </div>
      )}
    </>
  );
}

/** Route element for `/:organizationSlug/grupa/:groupId/term/:termId` — the
 * SOLE URL for a group/circle screen (the former separate `/krag/:groupId`
 * private route and `/krag` entry-resolver route were removed; this route
 * now serves both audiences from one address). Branches purely on auth
 * presence (`token`), matching the coarse-READ authorization this app has
 * always used for the private view (any logged-in principal, not just this
 * circle's own members, per `AUTHORIZATION_MATRIX`'s blanket `GET
 * /api/groups(/.*)?` row) — a logged-in visitor gets the full member
 * experience (family orbit, exchange cards, layout switcher-free read of
 * `group.layout_mode`); everyone else gets the anonymous-safe public view. */
/** Route element for `/:organizationSlug/grupa/:groupId/term/:termId`.
 * Owns exactly one decision — can this caller see this Circle's content —
 * resolved server-side via `getGroupAccess` (`GroupAccessResponse`), not by
 * raw auth-token presence. Delegates the decision itself to
 * `TermAccessBoundary`, and renders `PrivateTermView`/`PublicTermView`
 * (unchanged internally) or `PrivateGroupAccessDenied` accordingly. */
export function TermPage() {
  return <TermAccessBoundary />;
}

/**
 * Replaces the previous `token ? <PrivateTermView /> : <PublicTermView />`
 * heuristic, which treated ANY logged-in principal as belonging to every
 * Circle — both a real bug (a `PRIVATE` group's content was reachable by an
 * unrelated logged-in visitor, since `PrivateTermView`'s own data hook
 * relies on the backend's blanket authenticated-READ row, not a
 * membership check) and the root cause of a related one already patched
 * ad hoc (a logged-in non-member had no way to RSVP to a `PUBLIC` group's
 * term, since `PrivateTermView` only ever supported withdrawing from a term
 * already joined). `getGroupAccess` fixes both at the source: `is_member`/
 * `is_organizer` are `False` for a non-member even while authenticated.
 *
 * - `is_member || is_organizer` → `PrivateTermView` (today's full member
 *   dashboard: family orbit, exchange, layout switching, promote-members,
 *   sign-up/withdraw — unchanged).
 * - else, `PUBLIC` group → `PublicTermView` (today's anonymous-safe public
 *   page — unchanged; still separately handles its own logged-in/out RSVP
 *   gating for a non-member visitor of a `PUBLIC` group).
 * - else (`PRIVATE`, not a member) → `PrivateGroupAccessDenied` — never
 *   fetches or renders any Term/family/exchange content.
 */
function TermAccessBoundary() {
  const params = useParams<{ groupId: string; termId: string }>();
  const { token } = useAuth();
  const groupId = Number(params.groupId);
  const termId = params.termId ? Number(params.termId) : undefined;

  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error" }
    | { status: "loaded"; response: GroupAccessResponse }
  >({ status: "loading" });

  const fetchAccess = useCallback(() => {
    setState({ status: "loading" });
    getGroupAccess(groupId, termId)
      .then((response) => setState({ status: "loaded", response }))
      .catch(() => setState({ status: "error" }));
  }, [groupId, termId]);

  useEffect(() => {
    fetchAccess();
  }, [fetchAccess]);

  if (state.status === "loading") {
    return (
      <div className="kg-stage">
        <style>{CSS}</style>
        <div className="kg-app">
          <div className="kg-state">Wczytywanie...</div>
        </div>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="kg-stage">
        <style>{CSS}</style>
        <div className="kg-app">
          <div className="kg-state">Nie znaleziono grupy</div>
        </div>
      </div>
    );
  }

  const { group, access } = state.response;

  if (access.is_member || access.is_organizer) {
    return <PrivateTermView />;
  }
  if (group.visibility === "PUBLIC") {
    return <PublicTermView />;
  }
  return (
    <PrivateGroupAccessDenied
      groupId={groupId}
      group={group}
      canJoin={access.can_join}
      isLoggedIn={Boolean(token)}
      onJoined={fetchAccess}
    />
  );
}

function PrivateTermView() {
  const params = useParams<{ groupId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { displayName } = useAuth();
  const groupId = Number(params.groupId);
  const {
    loading,
    error,
    group,
    organizer,
    families,
    myPartyId,
    currentTerm,
    neededItems,
    myAvailableItems,
    mySwapAvailableItems,
    myAttendanceForCurrentTerm,
    myItemListings,
    browseListings,
    pledgeFamilyName,
    pledge,
    withdraw,
    fulfillPledgeItem,
    confirmPledgeReceipt,
    withdrawMyAttendance,
    confirmListingReceipt,
    activeFamilyExchangeOffers,
    loadingExchangeOffers,
    exchangeOffersError,
    loadExchangeOffersForFamily,
    takeOrProposeExchange,
    termAttendeesForFormalization,
    formalizeStandingMembers,
    refetch,
  } = useKragGrupy(groupId);

  // `TermPage` (the route element) only mounts this view when `token`
  // is truthy, so this view is only ever reached while logged in —
  // `isLoggedIn` is always true here. Routing every action through the same
  // `gateAction` wrapper as the public view (which computes `isLoggedIn`
  // from real auth state) keeps the two views' action-handling identical
  // and gives Group 7's actions (propose swap / accept / reject /
  // confirm-race) one place to register the check on either view.
  const isLoggedIn = true;
  const [showActionGate, setShowActionGate] = useState(false);
  const openActionGate = () => setShowActionGate(true);

  const [activeFamilyId, setActiveFamilyId] = useState<number | null>(null);
  const [toast, setToast] = useState("");
  // Only meaningful for a PRIVATE group's `InviteSlot` — a PUBLIC group has
  // no direct join link, so this stays unused/hidden there.
  const [showJoinDialog, setShowJoinDialog] = useState(false);
  const [busyItemId, setBusyItemId] = useState<number | null>(null);
  const [busyPledgeId, setBusyPledgeId] = useState<number | null>(null);
  const [fulfillingItemId, setFulfillingItemId] = useState<number | null>(null);
  const [fulfillMode, setFulfillMode] = useState<"new" | "mine">("new");
  const [fulfillCondition, setFulfillCondition] = useState<ItemCondition>("GOOD");
  const [fulfillItemId, setFulfillItemId] = useState<number | null>(null);

  // ---- "Twoje wystawione rzeczy" / "Rzeczy od innych" (exchange card) ----
  const [takeListingId, setTakeListingId] = useState<number | null>(null);
  const [takeOfferedItemId, setTakeOfferedItemId] = useState<number | null>(null);
  // Same item id can legitimately appear in both "Rzeczy od innych" and the
  // active family's "Do wymiany w grupie" card at once — this disambiguates
  // which section actually opened the swap picker, so the dialog never
  // renders in both places for the same listing.
  const [takeSection, setTakeSection] = useState<"browse" | "card" | null>(null);
  const [busyTakeListingId, setBusyTakeListingId] = useState<number | null>(null);
  const [busyConfirmListingReservationId, setBusyConfirmListingReservationId] = useState<number | null>(null);
  const [busyWithdrawAttendance, setBusyWithdrawAttendance] = useState(false);
  // Any logged-in visitor (not just this circle's own organizer/members)
  // lands on this view per `TermPage`'s auth-presence routing — so a
  // PUBLIC group's not-yet-attending logged-in visitor needs its own
  // sign-up affordance here too, mirroring `PublicTermView`'s
  // "Zapisz się na zajęcia" button/dialog (bug: previously this view had
  // no way to RSVP to a new term at all, only to withdraw from one already
  // joined).
  const [showRsvpDialog, setShowRsvpDialog] = useState(false);

  // ---- "Dodaj stałych członków z tego terminu" card (Group 5) ----
  const [selectedStandingMemberPartyIds, setSelectedStandingMemberPartyIds] = useState<Set<number>>(
    new Set(),
  );
  const [busyFormalizingStandingMembers, setBusyFormalizingStandingMembers] = useState(false);
  const [formalizeStandingMembersError, setFormalizeStandingMembersError] = useState<string | null>(null);
  const [standingMembersPromotedCount, setStandingMembersPromotedCount] = useState<number | null>(null);

  // Pre-selects every attendee not yet a member whenever a fresh attendee
  // list arrives (initial fetch, or a re-fetch after `formalizeStandingMembers`
  // updates `already_member` flags) — mirrors `EditTermDialog.tsx`'s
  // selection-reset effect, minus the `family_id !== null` condition
  // (Decision 4.2 — family is no longer an eligibility signal).
  useEffect(() => {
    if (!termAttendeesForFormalization) return;
    setSelectedStandingMemberPartyIds(
      new Set(
        termAttendeesForFormalization.filter((a) => !a.already_member).map((a) => a.party_id),
      ),
    );
  }, [termAttendeesForFormalization]);

  function toggleStandingMemberSelection(partyId: number) {
    setSelectedStandingMemberPartyIds((prev) => {
      const next = new Set(prev);
      if (next.has(partyId)) next.delete(partyId);
      else next.add(partyId);
      return next;
    });
  }
  // Reservation.status for every resolved_reservation_id encountered across
  // myItemListings/browseListings, keyed by reservation id — resolved client
  // side (no listing-owned status field, per the backend's minimal-
  // implementation stance) so the status line + "Potwierdź odbiór" gating
  // below can read it without a per-row fetch during render.
  const [reservationsById, setReservationsById] = useState<Record<number, ReservationResponse>>({});
  // The caller's own active taken reservations on `currentTerm` (Group 4,
  // Root Cause B) — unlike `browseListings`, this is availability-
  // independent and still resolves once the term has occurred, which is
  // exactly when the confirm-receipt button needs to keep working. Fetched
  // separately from `useKragGrupy` and merged (not substituted) into
  // `effectiveBrowseListings` below so the taker's own row keeps rendering
  // with a working "Potwierdź odbiór" even after `browseListings` (the
  // hook's own AVAILABLE-filtered fetch) goes empty post-term-end.
  const [takenListings, setTakenListings] = useState<BrowseTermItemListingResponse[]>([]);

  useEffect(() => {
    if (!currentTerm) {
      setTakenListings([]);
      return;
    }
    let cancelled = false;
    void getMyTakenTermItemListings(currentTerm.id).then((rows) => {
      if (!cancelled) setTakenListings(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [currentTerm]);

  const effectiveBrowseListings = useMemo(() => {
    if (takenListings.length === 0) return browseListings;
    const byId = new Map(browseListings.map((row) => [row.id, row]));
    for (const row of takenListings) {
      if (!byId.has(row.id)) byId.set(row.id, row);
    }
    return Array.from(byId.values());
  }, [browseListings, takenListings]);

  useEffect(() => {
    const l = document.createElement("link");
    l.rel = "stylesheet";
    l.href =
      "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Karla:wght@400;500;600;700;800&display=swap";
    document.head.appendChild(l);
    return () => {
      l.parentNode?.removeChild(l);
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  const activeFamily = useMemo(
    () => families.find((f) => f.familyId === activeFamilyId) ?? families[0] ?? null,
    [families, activeFamilyId],
  );

  const isOrganizerViewer =
    myPartyId !== null && organizer !== null && myPartyId === organizer.party_id;

  const currentTermWhen = currentTerm
    ? (() => {
        const { date, time } = formatTermWhen(currentTerm.occurs_on);
        return time ? `${date}, godz. ${time}` : date;
      })()
    : "";

  /** Own family, resolved from `myPartyId` against `activeFamily.guardians`
   * — gates the family card's "DO WYMIANY W GRUPIE" section (spec.md Core
   * Requirement 9: never shown for the viewer's own family). */
  const isOwnActiveFamily =
    activeFamily !== null && activeFamily.guardians.some((g) => g.party_id === myPartyId);

  function handleSelectFamily(familyId: number) {
    setActiveFamilyId(familyId);
    void loadExchangeOffersForFamily(familyId);
  }

  async function handlePledgeToggle(neededItemId: number, myPledgeId: number | null) {
    setBusyItemId(neededItemId);
    try {
      if (myPledgeId !== null) {
        await withdraw(myPledgeId);
      } else {
        await pledge(neededItemId);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setToast("Ktoś już zadeklarował przyniesienie tej rzeczy");
        await refetch();
      } else {
        setToast("Nie udało się zapisać zgłoszenia");
      }
    } finally {
      setBusyItemId(null);
    }
  }

  function openFulfillForm(itemId: number) {
    setFulfillingItemId(itemId);
    setFulfillMode(myAvailableItems.length > 0 ? "mine" : "new");
    setFulfillCondition("GOOD");
    setFulfillItemId(myAvailableItems[0]?.id ?? null);
  }

  async function handleFulfillSubmit(pledgeId: number) {
    setBusyPledgeId(pledgeId);
    try {
      let request: FulfillPledgeRequest;
      if (fulfillMode === "mine") {
        if (fulfillItemId === null) {
          setToast("Wybierz rzecz z Twoich zbiorów");
          return;
        }
        request = { inventory_item_id: fulfillItemId };
      } else {
        // product_id omitted -> backend uses the product the NeededItem names.
        request = { condition: fulfillCondition };
      }
      await fulfillPledgeItem(pledgeId, request);
      setFulfillingItemId(null);
    } catch {
      setToast("Nie udało się zarejestrować przedmiotu");
    } finally {
      setBusyPledgeId(null);
    }
  }

  async function handleConfirmReceipt(pledgeId: number, reservationId: number) {
    setBusyPledgeId(pledgeId);
    try {
      await confirmPledgeReceipt(pledgeId, reservationId);
    } catch {
      setToast("Nie udało się potwierdzić odbioru");
    } finally {
      setBusyPledgeId(null);
    }
  }

  // Fetches every resolved_reservation_id present across myItemListings/
  // browseListings that isn't already cached, then — once a lister's own
  // SWAP reservation is known — also fetches its paired leg (the lister is
  // the receiving party for THAT reservation). Re-runs as reservationsById
  // grows, which is what drives the second (paired) fetch pass.
  useEffect(() => {
    const idsToFetch = new Set<number>();
    for (const row of [...myItemListings, ...effectiveBrowseListings]) {
      if (row.resolved_reservation_id != null && !(row.resolved_reservation_id in reservationsById)) {
        idsToFetch.add(row.resolved_reservation_id);
      }
    }
    for (const row of myItemListings) {
      if (row.resolved_reservation_id == null) continue;
      const primary = reservationsById[row.resolved_reservation_id];
      if (primary?.paired_reservation_id != null && !(primary.paired_reservation_id in reservationsById)) {
        idsToFetch.add(primary.paired_reservation_id);
      }
    }
    if (idsToFetch.size === 0) return;
    let cancelled = false;
    void Promise.all(Array.from(idsToFetch, (id) => getReservation(id))).then((fetched) => {
      if (cancelled) return;
      setReservationsById((prev) => {
        const next = { ...prev };
        for (const r of fetched) next[r.id] = r;
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [myItemListings, effectiveBrowseListings, reservationsById]);

  function primaryReservationFor(row: BrowseTermItemListingResponse): ReservationResponse | null {
    return row.resolved_reservation_id != null ? (reservationsById[row.resolved_reservation_id] ?? null) : null;
  }

  /** "Twoje wystawione rzeczy" status line — mirrors the pledge section's
   * "Zrealizowane ✓" / "czeka na potwierdzenie odbioru" wording+styling,
   * derived here from the fetched Reservation.status instead of a stored
   * Pledge.status field (listings don't have one). */
  function listingStatusLine(row: BrowseTermItemListingResponse): string | null {
    const reservation = primaryReservationFor(row);
    if (!reservation || reservation.status === "CANCELLED") return null;
    if (reservation.status === "FULFILLED") return "Zrealizowane ✓";
    return "czeka na potwierdzenie odbioru";
  }

  /** Where the viewer is the RECEIVING party of a still-open reservation
   * tied to this listing: the taker for the primary reservation, or the
   * lister for a SWAP's paired leg (spec.md's Frontend section). The
   * backend auto-confirms both legs on behalf of their respective holders
   * right at creation (`take_item_listing`), so by the time this renders
   * the reservation is already `CONFIRMED` — this button drives only the
   * receiving party's later `fulfill` (physical-receipt) step. Gated on
   * "not yet FULFILLED/CANCELLED" rather than literally `CONFIRMED` so a
   * still-`PENDING` row (a request not yet auto-confirmed, e.g. a stale
   * client) doesn't hide the button either. */
  function confirmActionFor(row: BrowseTermItemListingResponse): number | null {
    const reservation = primaryReservationFor(row);
    if (!reservation || reservation.status === "FULFILLED" || reservation.status === "CANCELLED") return null;
    if (row.taken_by_party_id === myPartyId) return reservation.id;
    if (row.lister_party_id === myPartyId && reservation.reservation_type === "SWAP" && reservation.paired_reservation_id != null) {
      const paired = reservationsById[reservation.paired_reservation_id];
      if (paired && paired.status !== "FULFILLED" && paired.status !== "CANCELLED") return paired.id;
    }
    return null;
  }

  /** Whether `currentTerm` has actually occurred yet — the confirm-receipt
   * button below is gated on this (not just reservation status) so a
   * premature confirm can't race the physical hand-off, per Root Cause A. */
  function currentTermHasOccurred(): boolean {
    if (!currentTerm) return false;
    return new Date(currentTerm.occurs_on).getTime() <= Date.now();
  }

  const TERM_GATE_STATUS_LINE = "dostępne po zakończeniu zajęć";

  async function handleConfirmListing(reservationId: number) {
    if (!currentTerm) return;
    setBusyConfirmListingReservationId(reservationId);
    try {
      await confirmListingReceipt(reservationId, currentTerm.id);
    } catch {
      setToast("Nie udało się potwierdzić odbioru");
    } finally {
      setBusyConfirmListingReservationId(null);
    }
  }

  function openSwapSelect(listingId: number, section: "browse" | "card") {
    setTakeListingId(listingId);
    setTakeSection(section);
    setTakeOfferedItemId(mySwapAvailableItems[0]?.id ?? null);
  }

  function closeSwapSelect() {
    setTakeListingId(null);
    setTakeSection(null);
    setTakeOfferedItemId(null);
  }

  // Shared "Biorę" dispatch for both "Rzeczy od innych" (browseListingsSection)
  // and the family-card "DO WYMIANY W GRUPIE" section (Group 8) — both call
  // sites route through this one function (wrapping the hook's
  // `takeOrProposeExchange`, Group 7) instead of each keeping its own
  // take/proposeSwap copy, per spec.md Core Requirement 10.
  async function handleExchangeTake(
    listingId: number,
    reservationType: ReservationType,
    offeredItemId?: number,
  ) {
    setBusyTakeListingId(listingId);
    try {
      await takeOrProposeExchange(listingId, reservationType, offeredItemId);
      if (reservationType === "SWAP") {
        closeSwapSelect();
        setToast("Zaproponowano zamianę");
      }
    } catch {
      setToast(
        reservationType === "SWAP" ? "Nie udało się zaproponować zamiany" : "Nie udało się wziąć tej rzeczy",
      );
    } finally {
      setBusyTakeListingId(null);
    }
  }

  async function handleProposeSwap(listingId: number) {
    if (takeOfferedItemId === null) {
      setToast("Wybierz rzecz do zamiany");
      return;
    }
    await handleExchangeTake(listingId, "SWAP", takeOfferedItemId);
  }

  function handleTakeButtonClick(
    listingId: number,
    reservationType: ReservationType,
    section: "browse" | "card",
  ) {
    if (reservationType === "SWAP") {
      openSwapSelect(listingId, section);
      return;
    }
    void handleExchangeTake(listingId, reservationType);
  }

  async function handleWithdrawAttendance() {
    setBusyWithdrawAttendance(true);
    try {
      await withdrawMyAttendance();
      setToast("Wypisano z zajęć");
    } catch {
      setToast("Nie udało się wypisać z zajęć");
    } finally {
      setBusyWithdrawAttendance(false);
    }
  }

  function handleRsvpSubmitted() {
    setShowRsvpDialog(false);
    setToast("Zapisano na zajęcia");
    void refetch();
  }

  async function handlePromoteStandingMembers() {
    if (selectedStandingMemberPartyIds.size === 0) return;
    const count = selectedStandingMemberPartyIds.size;
    setBusyFormalizingStandingMembers(true);
    setFormalizeStandingMembersError(null);
    try {
      await formalizeStandingMembers(Array.from(selectedStandingMemberPartyIds));
      setStandingMembersPromotedCount(count);
    } catch {
      setFormalizeStandingMembersError("Nie udało się dodać stałych członków — spróbuj ponownie");
    } finally {
      setBusyFormalizingStandingMembers(false);
    }
  }

  if (loading) {
    return (
      <div className="kg-stage">
        <style>{CSS}</style>
        <div className="kg-app">
          <div className="kg-state">Wczytywanie...</div>
        </div>
      </div>
    );
  }

  if (error || !group) {
    return (
      <div className="kg-stage">
        <style>{CSS}</style>
        <div className="kg-app">
          <div className="kg-state">{error ?? "Nie znaleziono grupy"}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="kg-stage">
      <style>{CSS}</style>
      <div className="kg-app">
        <GroupHeader
          eyebrow="Grupa"
          title={group.name}
          onBack={() => navigate(-1)}
          showPanelLink
          subtitle={
            <>
              {currentTerm ? `Najbliższe zajęcia: ${currentTermWhen}` : "Brak zaplanowanych zajęć"}{" "}
              · {families.length} {families.length === 1 ? "rodzina" : "rodzin"}
            </>
          }
          actions={
            <>
              {currentTerm && myAttendanceForCurrentTerm && (
                <button
                  type="button"
                  className="kg-bring-btn"
                  style={{ marginTop: 8 }}
                  disabled={busyWithdrawAttendance}
                  onClick={() => void handleWithdrawAttendance()}
                >
                  Wycofaj się z zajęć
                </button>
              )}
              {currentTerm && !myAttendanceForCurrentTerm && group.visibility === "PUBLIC" && (
                <button
                  type="button"
                  className="kg-bring-btn"
                  style={{ marginTop: 8 }}
                  onClick={() => setShowRsvpDialog(true)}
                >
                  ＋ Zapisz się na zajęcia
                </button>
              )}
            </>
          }
        />

        {isOrganizerViewer && currentTerm && (
          <div className="kg-card">
            <h3 style={{ fontSize: 15 }}>Dodaj stałych członków z tego terminu</h3>
            {standingMembersPromotedCount !== null ? (
              <p className="kg-status-line">
                Dodano {standingMembersPromotedCount}{" "}
                {standingMembersPromotedCount === 1 ? "osobę" : "osób"} jako stałych członków grupy.
              </p>
            ) : termAttendeesForFormalization === null ? (
              <p className="kg-bring-sub">Wczytywanie zapisanych…</p>
            ) : termAttendeesForFormalization.length === 0 ||
              termAttendeesForFormalization.every((a) => a.already_member) ? (
              <p className="kg-bring-sub">
                Wszyscy zapisani na ten termin są już stałymi członkami grupy.
              </p>
            ) : (
              <>
                <p className="kg-bring-sub">
                  {termAttendeesForFormalization.filter((a) => !a.already_member).length} osób z
                  listy obecności na «{formatTermWhen(currentTerm.occurs_on).date}» nie są jeszcze
                  stałymi członkami grupy.
                </p>
                <ul className="flex flex-col">
                  {termAttendeesForFormalization.map((a) => (
                    <li
                      key={a.party_id}
                      style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0" }}
                    >
                      <input
                        type="checkbox"
                        aria-label={`Ustal ${a.display_name} jako stałego członka`}
                        checked={selectedStandingMemberPartyIds.has(a.party_id)}
                        disabled={a.already_member}
                        onChange={() => toggleStandingMemberSelection(a.party_id)}
                      />
                      <span>
                        {a.display_name}
                        {a.already_member ? " — już jest stałym członkiem" : ""}
                      </span>
                    </li>
                  ))}
                </ul>
                {formalizeStandingMembersError && (
                  <p className="kg-error">{formalizeStandingMembersError}</p>
                )}
                <button
                  type="button"
                  className="kg-btn-primary"
                  disabled={busyFormalizingStandingMembers || selectedStandingMemberPartyIds.size === 0}
                  onClick={() => void handlePromoteStandingMembers()}
                >
                  Dodaj stałych członków
                </button>
              </>
            )}
          </div>
        )}

        <GroupVisualization
          layoutMode={group.layout_mode}
          organizerName={organizer ? organizer.display_name : ""}
          families={families}
          activeFamilyId={activeFamilyId}
          onSelectFamily={handleSelectFamily}
          onInviteSlotClick={
            group.visibility === "PRIVATE"
              ? () => setShowJoinDialog(true)
              : () => setToast("Zaproszenie do grupy — wkrótce")
          }
          groupId={groupId}
        />

        {showJoinDialog && (
          <JoinPrivateGroupDialog
            groupId={groupId}
            onClose={() => setShowJoinDialog(false)}
            onSubmitted={() => {
              setShowJoinDialog(false);
              setToast("Dołączono do grupy!");
              void refetch();
            }}
          />
        )}

        {showRsvpDialog && currentTerm && displayName && (
          <RsvpDialogLoggedIn
            groupId={groupId}
            termId={currentTerm.id}
            displayName={displayName}
            onClose={() => setShowRsvpDialog(false)}
            onSubmitted={handleRsvpSubmitted}
          />
        )}

        <TermPageView
          isLoggedIn={isLoggedIn}
          neededItemsSection={{
            heading: "Kto co przynosi",
            subtitleText: currentTerm
              ? "Te rzeczy są potrzebne na najbliższe zajęcia — zgłoś się, jeśli możesz coś przynieść."
              : "Organizator nie dodał jeszcze żadnych zajęć z prośbą o rzeczy.",
            emptyNode:
              neededItems.length === 0 && currentTerm ? (
                <div className="kg-bring-empty">Brak listy potrzebnych rzeczy na te zajęcia.</div>
              ) : undefined,
            rows: neededItems.map(({ item, pledges }): NeededItemRowVM => {
              const activePledges = pledges.filter((p) => p.status !== "WITHDRAWN");
              const myPledge = activePledges.find((p) => p.pledged_by_party_id === myPartyId) ?? null;
              const shown = myPledge ?? activePledges[0] ?? null;
              const registered = shown?.resolved_reservation_id != null;
              const showWithdrawToggle = (!shown || myPledge) && !registered;
              const showFulfillAction = myPledge !== null && myPledge.status === "CLAIMED" && !registered;
              const showConfirmAction =
                isOrganizerViewer && shown !== null && shown.status === "CLAIMED" && registered;

              const inlineActions: TermActionVM[] = [];
              if (showWithdrawToggle) {
                inlineActions.push({
                  key: "withdraw-toggle",
                  label: myPledge ? "Rezygnuję" : "Ja to przyniosę",
                  ariaLabel: myPledge
                    ? `Rezygnuję z przyniesienia: ${item.product_name}`
                    : `Ja to przyniosę: ${item.product_name}`,
                  active: Boolean(myPledge),
                  disabled: busyItemId === item.id,
                  onClick: gateAction(isLoggedIn, openActionGate, () =>
                    void handlePledgeToggle(item.id, myPledge?.id ?? null),
                  ),
                });
              }
              if (showFulfillAction && fulfillingItemId !== item.id) {
                inlineActions.push({
                  key: "open-fulfill",
                  label: "Zarejestruj przedmiot",
                  onClick: () => openFulfillForm(item.id),
                });
              }

              const extra =
                showFulfillAction && fulfillingItemId === item.id && myPledge ? (
                  <div className="kg-fulfill">
                    <div className="kg-fulfill-row" role="radiogroup" aria-label="Sposób">
                      <button
                        type="button"
                        className={`kg-bring-btn ${fulfillMode === "new" ? "is-on" : ""}`}
                        aria-pressed={fulfillMode === "new"}
                        onClick={() => setFulfillMode("new")}
                      >
                        Nowa rzecz
                      </button>
                      <button
                        type="button"
                        className={`kg-bring-btn ${fulfillMode === "mine" ? "is-on" : ""}`}
                        aria-pressed={fulfillMode === "mine"}
                        disabled={myAvailableItems.length === 0}
                        onClick={() => setFulfillMode("mine")}
                      >
                        Z moich rzeczy
                      </button>
                    </div>

                    {fulfillMode === "new" ? (
                      <div className="kg-fulfill-row">
                        <span>Przedmiot: {item.product_name}</span>
                        <select
                          className="kg-select"
                          aria-label="Stan"
                          value={fulfillCondition}
                          onChange={(e) => setFulfillCondition(e.target.value as ItemCondition)}
                        >
                          {(Object.keys(CONDITION_LABELS) as ItemCondition[]).map((c) => (
                            <option key={c} value={c}>
                              {CONDITION_LABELS[c]}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : (
                      <div className="kg-fulfill-row">
                        <select
                          className="kg-select"
                          aria-label="Rzecz z moich zbiorów"
                          value={fulfillItemId ?? ""}
                          onChange={(e) => setFulfillItemId(Number(e.target.value))}
                        >
                          {myAvailableItems.map((mi) => (
                            <option key={mi.id} value={mi.id}>
                              {mi.productName}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    <div className="kg-fulfill-actions">
                      <button
                        className="kg-btn-primary"
                        disabled={busyPledgeId === myPledge.id}
                        onClick={() => void handleFulfillSubmit(myPledge.id)}
                      >
                        Zapisz
                      </button>
                      <button className="kg-btn-ghost" onClick={() => setFulfillingItemId(null)}>
                        Anuluj
                      </button>
                    </div>
                  </div>
                ) : null;

              let statusLine: string | null = null;
              if (myPledge && registered && myPledge.status === "CLAIMED") {
                statusLine = "Przedmiot zarejestrowany — czeka na potwierdzenie odbioru";
              } else if (shown && shown.status === "FULFILLED") {
                statusLine = "Zrealizowane ✓";
              }

              const confirmAction: TermActionVM | null =
                showConfirmAction && shown
                  ? {
                      key: "confirm",
                      label: "Potwierdź odbiór",
                      disabled: busyPledgeId === shown.id,
                      onClick: gateAction(isLoggedIn, openActionGate, () =>
                        void handleConfirmReceipt(shown.id, shown.resolved_reservation_id as number),
                      ),
                    }
                  : null;

              return {
                key: item.id,
                avatar: shown
                  ? { initials: familyInitials(pledgeFamilyName(shown)), color: familyColor(pledgeFamilyName(shown)) }
                  : null,
                title: (
                  <strong>
                    {item.product_name}
                    {item.description ? ` — ${item.description}` : ""}
                  </strong>
                ),
                subtitle: shown
                  ? `Przynosi: ${myPledge ? "Ty" : pledgeFamilyName(shown)}`
                  : "Jeszcze nikt się nie zgłosił",
                inlineActions,
                extra,
                statusLine,
                confirmAction,
              };
            }),
          }}
          myListingsSection={
            myAttendanceForCurrentTerm !== null || isOrganizerViewer
              ? {
                  heading: "Twoje wystawione rzeczy",
                  subtitleText: "Rzeczy, które oferujesz na te zajęcia — do pożyczenia, zamiany lub oddania.",
                  emptyNode: (
                    <div className="kg-bring-empty">
                      Nie wystawiłeś jeszcze żadnej rzeczy. Ustaw tryb rzeczy w{" "}
                      <Link to="/panel/rzeczy">Moje rzeczy</Link>, żeby pojawiła się tutaj.
                    </div>
                  ),
                  rows: myItemListings.map((row): ListingRowVM => {
                    const confirmReservationId = confirmActionFor(row);
                    const termGated = confirmReservationId !== null && !currentTermHasOccurred();
                    const statusLine = termGated ? TERM_GATE_STATUS_LINE : listingStatusLine(row);
                    return {
                      key: row.id,
                      title: <strong>{row.product_name}</strong>,
                      subtitle: row.offered_types
                        .map((t) => OFFERED_TYPE_LABELS[t as ReservationType] ?? t)
                        .join(" · "),
                      actions: [],
                      statusLine,
                      confirmAction:
                        confirmReservationId !== null
                          ? {
                              key: "confirm",
                              label: "Potwierdź odbiór",
                              disabled: termGated || busyConfirmListingReservationId === confirmReservationId,
                              onClick: gateAction(isLoggedIn, openActionGate, () =>
                                void handleConfirmListing(confirmReservationId),
                              ),
                            }
                          : null,
                    };
                  }),
                }
              : undefined
          }
          browseListingsSection={
            myAttendanceForCurrentTerm !== null || isOrganizerViewer
              ? {
                  heading: "Rzeczy od innych",
                  subtitleText: "Rzeczy wystawione przez innych uczestników tych zajęć.",
                  headingStyle: { marginTop: 20 },
                  emptyNode: <div className="kg-bring-empty">Nikt jeszcze nie wystawił żadnej rzeczy.</div>,
                  rows: effectiveBrowseListings.map((row): ListingRowVM => {
                    const offeredTypes = row.offered_types.filter((t): t is ReservationType =>
                      LISTABLE_RESERVATION_TYPES.includes(t as ReservationType),
                    );
                    const isTakingThis = takeListingId === row.id && takeSection === "browse";
                    const confirmReservationId = confirmActionFor(row);
                    const termGated = confirmReservationId !== null && !currentTermHasOccurred();
                    const extra = isTakingThis ? (
                      <SwapProposeDialog
                        availableItems={mySwapAvailableItems}
                        offeredItemId={takeOfferedItemId}
                        onOfferedItemChange={setTakeOfferedItemId}
                        listingProductName={row.product_name}
                        busy={busyTakeListingId === row.id}
                        onConfirm={() => void handleProposeSwap(row.id)}
                        onCancel={closeSwapSelect}
                      />
                    ) : null;
                    return {
                      key: row.id,
                      title: <strong>{row.product_name}</strong>,
                      subtitle: `Wystawia: ${row.lister_display_name}`,
                      actions: offeredTypes.map((t) => ({
                        key: t,
                        label: TAKE_ACTION_LABELS[t],
                        ariaLabel: `${TAKE_ACTION_LABELS[t]}: ${row.product_name}`,
                        disabled: busyTakeListingId === row.id,
                        onClick: gateAction(isLoggedIn, openActionGate, () =>
                          handleTakeButtonClick(row.id, t, "browse"),
                        ),
                      })),
                      extra,
                      statusLine: termGated ? TERM_GATE_STATUS_LINE : null,
                      confirmAction:
                        confirmReservationId !== null
                          ? {
                              key: "confirm",
                              label: "Potwierdź odbiór",
                              disabled: termGated || busyConfirmListingReservationId === confirmReservationId,
                              onClick: gateAction(isLoggedIn, openActionGate, () =>
                                void handleConfirmListing(confirmReservationId),
                              ),
                            }
                          : null,
                    };
                  }),
                }
              : undefined
          }
        />

        {showActionGate && (
          <PledgeGateDialog
            loginHref={`/login?returnTo=${encodeURIComponent(location.pathname)}`}
            registerHref="/register"
            onClose={() => setShowActionGate(false)}
          />
        )}

        {activeFamily && (
          <FamilyCard
            family={activeFamily}
            isOwnFamily={isOwnActiveFamily}
            loadingOffers={loadingExchangeOffers}
            offersError={exchangeOffersError}
            onRetryLoadOffers={() => void loadExchangeOffersForFamily(activeFamily.familyId)}
            offers={activeFamilyExchangeOffers}
            activeSwapOfferId={takeSection === "card" ? takeListingId : null}
            busyTakeListingId={busyTakeListingId}
            swapAvailableItems={mySwapAvailableItems}
            swapOfferedItemId={takeOfferedItemId}
            onSwapOfferedItemChange={setTakeOfferedItemId}
            onTakeButtonClick={(offerId, type) =>
              gateAction(isLoggedIn, openActionGate, () => handleTakeButtonClick(offerId, type, "card"))()
            }
            onConfirmSwap={(offerId) => void handleProposeSwap(offerId)}
            onCancelSwap={closeSwapSelect}
          />
        )}

        <p className="kg-hint">Dotknij rodziny, żeby zobaczyć jej kartę.</p>
      </div>

      {toast && (
        <div className="kg-toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Public, unauthenticated view — Core Requirement 5/6 (spec §3):       */
/*  organizer-only center (no family orbit — no child data fetched),     */
/*  read-only needed items, guardian display-name list, RSVP CTA.        */
/* ------------------------------------------------------------------ */

export function PublicTermView() {
  const params = useParams<{ groupId: string; termId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const groupId = Number(params.groupId);
  // Term id comes straight from the `:termId` route param (same as `:groupId`
  // above); absent when mounted by the term-less resolver's zero-term branch.
  const termId = params.termId !== undefined ? Number(params.termId) : undefined;
  const { loading, error, circle, refetch } = usePublicKragGrupy(groupId, termId);
  // Auth is read here (not in `usePublicKragGrupy`, which stays anonymous-safe):
  // a token switches the RSVP CTA to the logged-in dialog variant (R7) and the
  // "already signed up" state becomes server-derived, never localStorage (D5).
  const { token, displayName } = useAuth();
  const isLoggedIn = Boolean(token);

  const [showRsvpDialog, setShowRsvpDialog] = useState(false);
  // Anonymous visitors first see a choice: log in / register (attendance on a
  // real account) or continue as a guest. Logged-in users skip straight to the
  // logged-in dialog.
  const [showRsvpGate, setShowRsvpGate] = useState(false);
  const [rsvped, setRsvped] = useState(false);
  // The RSVP just submitted this session — drives the R8 post-anonymous
  // account suggestion (only when `attached_to_account === false`).
  const [lastRsvp, setLastRsvp] = useState<RsvpResponse | null>(null);
  const [suggestionDismissed, setSuggestionDismissed] = useState(false);
  // Core Requirement 7 / §3a: which needed item's "Zgłoś się" pledge-trigger
  // is currently showing the inline account-merge mini-form, replacing that
  // row's action (not a modal) — at most one at a time.
  const [mergingItemId, setMergingItemId] = useState<number | null>(null);
  // Same inline account-merge mini-form, extended (per the approved plan's
  // Frontend section 5) to the "Rzeczy do wymiany" take/swap rows — an
  // anonymous visitor with a valid stored guest profile who clicks
  // "Pożycz"/"Zamień"/"Weź na stałe" gets this instead of `PledgeGateDialog`.
  const [mergingTakeItemId, setMergingTakeItemId] = useState<number | null>(null);
  // "Ja to przyniosę" on a needed item: a logged-in visitor pledges straight
  // away; an anonymous one gets `PledgeGateDialog` (a pledge needs a real
  // account — no guest path). Pledged ids are tracked locally just to swap
  // the button to a confirmation for the rest of the session.
  const [showPledgeGate, setShowPledgeGate] = useState(false);
  const [pledgedItemIds, setPledgedItemIds] = useState<number[]>([]);
  const [pledgingItemId, setPledgingItemId] = useState<number | null>(null);
  const [toast, setToast] = useState("");

  // ---- "Rzeczy do wymiany/oddania/wypożyczenia" (public exchange list) ----
  // Visible to everyone, unauthenticated included (per product decision:
  // seeing what's on offer needs no account, only taking one does) — unlike
  // `usePublicKragGrupy`'s own fetch, these lazily-loaded pieces (available
  // items for a SWAP counter-offer) only ever run once the visitor is
  // logged in and actually attempts a take.
  const [showTakeGate, setShowTakeGate] = useState(false);
  const [takingItemId, setTakingItemId] = useState<number | null>(null);
  const [takeOfferedItemId, setTakeOfferedItemId] = useState<number | null>(null);
  const [busyTakeItemId, setBusyTakeItemId] = useState<number | null>(null);
  const [myAvailableItems, setMyAvailableItems] = useState<AvailableItem[] | null>(null);

  // A PRIVATE group's reduced public response (no `next_term`/`guardians`) —
  // this drives the "Dołącz na stałe" CTA instead of the normal RSVP flow.
  const [showJoinDialog, setShowJoinDialog] = useState(false);
  const [joined, setJoined] = useState(false);

  // Public view has no pledge-fulfil "Z moich rzeczy" picker sharing this
  // state — it's used solely to seed the SWAP counter-offer picker
  // (`SwapProposeDialog` via `performPublicProposeSwap` below), so unlike
  // the private hook's `myAvailableItems`/`mySwapAvailableItems` split, this
  // one list can be filtered to "zamienię"-tagged items directly.
  async function loadMyAvailableItems(): Promise<AvailableItem[]> {
    if (myAvailableItems !== null) return myAvailableItems;
    const [profile, products, preferences] = await Promise.all([
      getMyProfile(),
      getProducts(),
      getMyItemListingPreferences(),
    ]);
    if (profile.account_user_id == null) return [];
    const inventories = await getInventories(profile.account_user_id);
    const personal = inventories.find((inv) => inv.inventory_type === "PERSONAL") ?? null;
    if (!personal) return [];
    const swapTaggedItemIds = new Set(
      preferences.filter((p) => p.mode === "SWAP").map((p) => p.item_id),
    );
    const items = (await getInventoryItems(personal.id)).filter((it) =>
      swapTaggedItemIds.has(it.id),
    );
    const withStatus = await Promise.all(
      items.map(async (it) => ({ it, balance: await getInventoryItemBalance(it.id) })),
    );
    const available = withStatus
      .filter(({ balance }) => balance.status === "AVAILABLE")
      .map(({ it }) => ({
        id: it.id,
        productName: products.find((p) => p.id === it.product_id)?.name ?? `Rzecz #${it.id}`,
      }));
    setMyAvailableItems(available);
    return available;
  }

  // Group 7: SWAP no longer goes through `takeTermItemListing` (the backend
  // rejects it there) — it is always a proposal via `proposeSwap`, which
  // the target listing's owner must separately accept/reject. First call
  // (not yet showing the picker) just opens `SwapProposeDialog`; the second
  // (from the dialog's "Zaproponuj zamianę") actually submits it.
  async function performPublicProposeSwap(itemId: number) {
    if (!circle?.next_term) return;
    if (takingItemId !== itemId) {
      const available = await loadMyAvailableItems();
      setTakingItemId(itemId);
      setTakeOfferedItemId(available[0]?.id ?? null);
      return;
    }
    if (takeOfferedItemId === null) {
      setToast("Wybierz rzecz do zamiany");
      return;
    }
    setBusyTakeItemId(itemId);
    try {
      await proposeSwapApi(itemId, {
        term_id: circle.next_term.id,
        offered_item_id: takeOfferedItemId,
      });
      setTakingItemId(null);
      setTakeOfferedItemId(null);
      setToast("Zaproponowano zamianę! Szczegóły w Twoim panelu");
      await refetch();
    } catch {
      setToast("Nie udało się zaproponować zamiany");
    } finally {
      setBusyTakeItemId(null);
    }
  }

  // The real "take" action — no login check inside; `gateAction` (below)
  // wraps it so every caller goes through the same generalized gate.
  async function performPublicTake(itemId: number, reservationType: ReservationType) {
    if (!circle?.next_term) return;
    if (reservationType === "SWAP") {
      await performPublicProposeSwap(itemId);
      return;
    }
    setBusyTakeItemId(itemId);
    try {
      const request: TakeTermItemListingRequest = {
        term_id: circle.next_term.id,
        reservation_type: reservationType,
      };
      await takeTermItemListing(itemId, request);
      setTakingItemId(null);
      setTakeOfferedItemId(null);
      setToast("Wzięto! Szczegóły w Twoim panelu");
      await refetch();
    } catch {
      setToast("Nie udało się wziąć tej rzeczy");
    } finally {
      setBusyTakeItemId(null);
    }
  }

  // Every caller (needed-items "Ja to przyniosę", item-listing take buttons)
  // routes the actual take through this one gate-wrapped handler — the same
  // `gateAction` mechanism the private view uses.
  const handlePublicTake = gateAction(isLoggedIn, () => setShowTakeGate(true), performPublicTake);

  async function performPublicPledge(neededItemId: number) {
    setPledgingItemId(neededItemId);
    try {
      await createPledge(neededItemId);
      setPledgedItemIds((prev) => [...prev, neededItemId]);
      setToast("Zgłoszono — szczegóły w Twoim panelu");
      await refetch();
    } catch (err) {
      setToast(
        err instanceof ApiError && err.status === 409
          ? "Ktoś już zadeklarował przyniesienie tej rzeczy"
          : "Nie udało się zapisać zgłoszenia",
      );
      if (err instanceof ApiError && err.status === 409) await refetch();
    } finally {
      setPledgingItemId(null);
    }
  }

  const handlePublicPledge = gateAction(isLoggedIn, () => setShowPledgeGate(true), performPublicPledge);

  useEffect(() => {
    document.head.appendChild(
      Object.assign(document.createElement("link"), {
        rel: "stylesheet",
        href:
          "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Karla:wght@400;500;600;700;800&display=swap",
      }),
    );
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  // Per §3a/Mockup 9: for an ANONYMOUS visitor an existing
  // `guest_profile_id:<groupId>:<termId>` in localStorage means they already
  // RSVP'd for THIS circle+term — show the confirmation immediately, surviving
  // a full reload. Scoped per circle+term (not a flat global key) so a visitor
  // who RSVP'd on a different Circle's public page doesn't incorrectly see
  // "already RSVP'd" here. Derived on render (not an effect) — no setState.
  const nextTermId = circle?.next_term?.id;
  const storedGuestRsvp =
    !isLoggedIn &&
    nextTermId !== undefined &&
    readValidGuestProfile(guestProfileIdKey(groupId, nextTermId)) !== null;

  // Server-derived "already signed up" for a logged-in user (A6 / D5): the
  // public GET already returns guardian display names — a match means the
  // caller has an attendance on this circle. Never the localStorage key.
  const serverDerivedRsvp =
    isLoggedIn &&
    displayName !== null &&
    (circle?.guardians.some((g) => g.display_name === displayName) ?? false);

  const hasGuestProfile = rsvped || storedGuestRsvp || serverDerivedRsvp;

  function handleRsvpSubmitted(rsvp: RsvpResponse) {
    // The anonymous `RsvpDialog` writes its own scoped guest_profile_id key;
    // `RsvpDialogLoggedIn` writes none. Nothing to touch here — just branch on
    // `attached_to_account` for whether to offer the account suggestion (R8).
    setShowRsvpDialog(false);
    setRsvped(true);
    setLastRsvp(rsvp);
    void refetch();
  }

  if (loading) {
    return (
      <div className="kg-stage">
        <style>{CSS}</style>
        <div className="kg-app">
          <div className="kg-state">Wczytywanie...</div>
        </div>
      </div>
    );
  }

  if (error || !circle) {
    // A missing circle and a mismatched / deleted term both surface as the
    // same 404 here, so the wording stays generic (never "grupa").
    return (
      <div className="kg-stage">
        <style>{CSS}</style>
        <div className="kg-app">
          <div className="kg-state">Nie znaleziono</div>
        </div>
      </div>
    );
  }

  if (circle.visibility === "PRIVATE") {
    return (
      <div className="kg-stage">
        <style>{CSS}</style>
        <div className="kg-app">
          <GroupHeader
            eyebrow="Krąg"
            title={circle.name}
            onBack={() => navigate(-1)}
            subtitle={
              circle.organizer_display_name
                ? `Prowadzi: ${circle.organizer_display_name}`
                : "Brak organizatora"
            }
          />

          <div className="kg-card" role="status">
            {joined ? (
              <div className="kg-status-line" style={{ fontSize: 15 }}>
                ✓ Dołączono! Do zobaczenia na zajęciach.
              </div>
            ) : (
              <>
                <p>Ta grupa jest prywatna — mogą się do niej zapisać tylko stali członkowie.</p>
                {isLoggedIn ? (
                  <button
                    className="kg-btn-primary"
                    style={{ marginTop: 12, padding: "10px 18px", fontSize: 13 }}
                    onClick={() => setShowJoinDialog(true)}
                  >
                    Dołącz na stałe
                  </button>
                ) : (
                  // Logged-out visitor: no guest path for a standing membership
                  // (unlike the term-scoped RSVP gate), so this reuses
                  // `RsvpGateDialog`'s login/register `<Link>` markup inline in
                  // the existing card instead of opening a modal.
                  <div style={{ marginTop: 12 }}>
                    <Link
                      to={`/login?returnTo=${encodeURIComponent(location.pathname)}`}
                      className="kg-btn-primary"
                      style={{
                        display: "block",
                        textAlign: "center",
                        width: "100%",
                        padding: "11px 14px",
                        fontSize: 13,
                        marginBottom: 10,
                      }}
                    >
                      Zaloguj się
                    </Link>
                    <p style={{ fontSize: 12, color: "var(--ink-soft)", textAlign: "center" }}>
                      Nie masz konta?{" "}
                      <Link to="/register" style={{ fontWeight: 700, color: "var(--mint, #1b8168)" }}>
                        Zarejestruj się
                      </Link>
                    </p>
                  </div>
                )}
              </>
            )}
          </div>

          {isLoggedIn && showJoinDialog && (
            <JoinPrivateGroupDialog
              groupId={groupId}
              onClose={() => setShowJoinDialog(false)}
              onSubmitted={() => {
                setShowJoinDialog(false);
                setJoined(true);
                void refetch();
              }}
            />
          )}
        </div>
      </div>
    );
  }

  const term = circle.next_term;

  return (
    <div className="kg-stage">
      <style>{CSS}</style>
      <div className="kg-app">
        <GroupHeader
          eyebrow="Krąg"
          title={circle.name}
          onBack={() => navigate(-1)}
          showPanelLink={isLoggedIn}
          subtitle={
            circle.organizer_display_name ? `Prowadzi: ${circle.organizer_display_name}` : "Brak organizatora"
          }
        />

        <div className="kg-circle-wrap">
          <div className="kg-stagebox">
            <div className="kg-square">
              <div className="kg-inner">
                <div className="kg-center">
                  <div className="kg-center-av">
                    {circle.organizer_display_name ? circle.organizer_display_name.slice(0, 1) : "?"}
                  </div>
                  <strong>{circle.organizer_display_name ?? "Brak organizatora"}</strong>
                  <span>prowadzi zajęcia</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <TermCard
          date={term ? formatTermWhen(term.occurs_on).date : null}
          time={term ? formatTermWhen(term.occurs_on).time : undefined}
          description={term?.description}
        />

        <TermPageView
          isLoggedIn={isLoggedIn}
          neededItemsSection={
            term && term.needed_items.length > 0
              ? {
                  heading: "Potrzebne rzeczy",
                  subtitleText: "Zgłoś się, jeśli możesz coś przynieść na te zajęcia.",
                  rows: term.needed_items.map((item): NeededItemRowVM => {
                    const guestProfileId = readValidGuestProfile(
                      guestProfileIdKey(groupId, term.id),
                    );
                    const canMerge = hasGuestProfile && guestProfileId !== null;
                    const isMerging = mergingItemId === item.id;
                    const pledgedHere = pledgedItemIds.includes(item.id);
                    const claimed = item.claimed || pledgedHere;
                    const claimedByMe =
                      pledgedHere || (displayName !== null && item.claimed_by_name === displayName);
                    // The pledge action always routes through `handlePublicPledge`,
                    // which is itself `gateAction`-wrapped — except the one
                    // product-decision branch where an anonymous visitor with a
                    // stored guest profile gets the inline account-merge form
                    // instead of the gate dialog.
                    const onPledgeClick =
                      !isLoggedIn && canMerge
                        ? () => setMergingItemId(item.id)
                        : () => void handlePublicPledge(item.id);
                    return {
                      key: item.id,
                      title: (
                        <strong>
                          {item.product_name}
                          {item.description ? ` — ${item.description}` : ""}
                        </strong>
                      ),
                      subtitle: claimed
                        ? `Przynosi: ${claimedByMe ? "Ty" : (item.claimed_by_name ?? "inna rodzina")}`
                        : null,
                      inlineActions:
                        !claimed && !isMerging
                          ? [
                              {
                                key: "pledge",
                                label: "Ja to przyniosę",
                                ariaLabel: `Ja to przyniosę: ${item.product_name}`,
                                disabled: pledgingItemId === item.id,
                                onClick: onPledgeClick,
                              },
                            ]
                          : [],
                      extra:
                        !isLoggedIn && canMerge && isMerging ? (
                          <AccountMergeForm userProfileId={guestProfileId} />
                        ) : null,
                    };
                  }),
                }
              : undefined
          }
          browseListingsSection={
            term && term.item_listings.length > 0
              ? {
                  heading: "Rzeczy do wymiany",
                  subtitleText: "Uczestnicy tych zajęć oferują te rzeczy — do pożyczenia, zamiany lub oddania.",
                  rows: term.item_listings.map((row): ListingRowVM => {
                    const offeredTypes = row.offered_types.filter((t): t is ReservationType =>
                      LISTABLE_RESERVATION_TYPES.includes(t as ReservationType),
                    );
                    const guestProfileId = readValidGuestProfile(
                      guestProfileIdKey(groupId, term.id),
                    );
                    const canMerge = hasGuestProfile && guestProfileId !== null;
                    const isMergingThis = mergingTakeItemId === row.item_id;
                    const isTakingThis = takingItemId === row.item_id;
                    const extra = isMergingThis ? (
                      <AccountMergeForm userProfileId={guestProfileId as number} />
                    ) : isTakingThis ? (
                      <SwapProposeDialog
                        availableItems={myAvailableItems ?? []}
                        offeredItemId={takeOfferedItemId}
                        onOfferedItemChange={setTakeOfferedItemId}
                        listingProductName={row.product_name}
                        busy={busyTakeItemId === row.item_id}
                        onConfirm={() => void performPublicProposeSwap(row.item_id)}
                        onCancel={() => {
                          setTakingItemId(null);
                          setTakeOfferedItemId(null);
                        }}
                      />
                    ) : null;
                    return {
                      key: row.item_id,
                      title: <strong>{row.product_name}</strong>,
                      subtitle: `Wystawia: ${row.lister_display_name}`,
                      actions: isMergingThis
                        ? []
                        : offeredTypes.map((t) => ({
                            key: t,
                            label: TAKE_ACTION_LABELS[t],
                            ariaLabel: `${TAKE_ACTION_LABELS[t]}: ${row.product_name}`,
                            disabled: busyTakeItemId === row.item_id,
                            onClick:
                              !isLoggedIn && canMerge
                                ? () => setMergingTakeItemId(row.item_id)
                                : () => void handlePublicTake(row.item_id, t),
                          })),
                      extra,
                    };
                  }),
                }
              : undefined
          }
        />

        <div className="kg-card">
          <h3>Zapisani opiekunowie</h3>
          {circle.guardians.length === 0 ? (
            <p className="kg-bring-empty">Nikt jeszcze się nie zapisał.</p>
          ) : (
            <ul style={{ marginTop: 10, listStyle: "none", padding: 0 }}>
              {circle.guardians.map((g, i) => (
                <li key={`${g.display_name}-${i}`} style={{ padding: "6px 0", fontSize: 14 }}>
                  {g.display_name}
                </li>
              ))}
            </ul>
          )}
        </div>

        {hasGuestProfile ? (
          <div className="kg-card" role="status">
            <div className="kg-status-line" style={{ fontSize: 15 }}>
              ✓ Zapisano! Do zobaczenia na zajęciach.
            </div>
            {isLoggedIn && displayName && (
              <p style={{ fontSize: 13, color: "var(--ink-soft)", marginTop: 6 }}>
                Zapisano jako {displayName}.
              </p>
            )}
            {lastRsvp && !lastRsvp.attached_to_account && !suggestionDismissed && (
              <div style={{ marginTop: 12 }}>
                <h3 style={{ fontSize: 15 }}>Załóż konto, aby zachować dostęp</h3>
                <AccountMergeForm userProfileId={lastRsvp.user_profile_id} />
                <button
                  className="kg-btn-ghost"
                  style={{ marginTop: 8 }}
                  onClick={() => setSuggestionDismissed(true)}
                >
                  Może później
                </button>
              </div>
            )}
          </div>
        ) : (
          term && (
            <div style={{ textAlign: "center", padding: "8px 18px 26px" }}>
              <button
                className="kg-btn-primary"
                style={{ padding: "12px 22px", fontSize: 14 }}
                onClick={() => (isLoggedIn ? setShowRsvpDialog(true) : setShowRsvpGate(true))}
              >
                ＋ Zapisz się na zajęcia
              </button>
            </div>
          )
        )}
      </div>

      {showRsvpGate && term && !isLoggedIn && (
        <RsvpGateDialog
          loginHref={`/login?returnTo=${encodeURIComponent(location.pathname)}`}
          registerHref="/register"
          onGuest={() => {
            setShowRsvpGate(false);
            setShowRsvpDialog(true);
          }}
          onClose={() => setShowRsvpGate(false)}
        />
      )}

      {showRsvpDialog && term && (
        isLoggedIn && displayName ? (
          <RsvpDialogLoggedIn
            groupId={groupId}
            termId={term.id}
            displayName={displayName}
            onClose={() => setShowRsvpDialog(false)}
            onSubmitted={handleRsvpSubmitted}
          />
        ) : (
          <RsvpDialog
            groupId={groupId}
            termId={term.id}
            onClose={() => setShowRsvpDialog(false)}
            onSubmitted={handleRsvpSubmitted}
          />
        )
      )}

      {showPledgeGate && !isLoggedIn && (
        <PledgeGateDialog
          loginHref={`/login?returnTo=${encodeURIComponent(location.pathname)}`}
          registerHref="/register"
          onClose={() => setShowPledgeGate(false)}
        />
      )}

      {showTakeGate && !isLoggedIn && (
        <PledgeGateDialog
          loginHref={`/login?returnTo=${encodeURIComponent(location.pathname)}`}
          registerHref="/register"
          onClose={() => setShowTakeGate(false)}
          ariaLabel="Załóż konto, aby wziąć rzecz"
          message="Żeby wziąć, pożyczyć albo zamienić się rzeczą, musisz mieć konto — dzięki temu wiadomo, kto co bierze, a rzecz trafia do Twoich zbiorów."
        />
      )}

      {toast && (
        <div className="kg-toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
