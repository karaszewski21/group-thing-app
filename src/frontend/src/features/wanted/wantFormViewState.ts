import type { ExchangeMode } from "../../api/groups";
import type { WantResponse } from "../../api/wants";
import { viewPath, wantPath } from "../../routing/paths";
import { RADII_KM } from "../../utils/appHelpers";

export const NAME_MIN = 3;
export const NAME_MAX = 80;
export const NOTE_MAX = 300;

const LOCALITY_ID = /^\d{7}$/;
const CATEGORY_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type WantFormViewState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "notFound" }
  /** Only an active want can be edited: the page goes to its match list. */
  | { kind: "redirect"; to: string }
  /** `want` is `null` on the create page. */
  | { kind: "ready"; want: WantResponse | null };

/** The form page's screen. `wantId` is `null` on `/add/wanted`; the edit page
 * finds its want on the caller's list, which never holds a withdrawn one. A
 * want already on the list stays editable through a refetch or its error. */
export function resolveWantFormView({
  wantId,
  wants,
  loading,
  error,
}: {
  wantId: string | null;
  wants: WantResponse[];
  loading: boolean;
  error: string | null;
}): WantFormViewState {
  if (wantId === null) return { kind: "ready", want: null };
  const want = wants.find((candidate) => candidate.id === wantId);
  if (want) return want.status === "ACTIVE" ? { kind: "ready", want } : { kind: "redirect", to: wantPath(want.id) };
  if (loading) return { kind: "loading" };
  if (error) return { kind: "error", message: error };
  return { kind: "notFound" };
}

/** What the form opens with. */
export interface WantFormInitial {
  name: string;
  note: string;
  categoryId: string | null;
  offerMode: ExchangeMode | null;
  localityId: string | null;
  radius: number | null;
  /** Whether „Doprecyzuj” opens expanded. */
  refined: boolean;
  /** Opened from the search page's prompt: the back link leads there. */
  fromSearch: boolean;
}

/** The create form's start from the `/add/wanted` query string. The name is
 * taken as typed; the other values only when they are well formed (a UUID
 * category, a 7-digit locality), a radius
 * only with a locality and only from the offered ones. */
export function initialFromPrefill(params: URLSearchParams): WantFormInitial {
  const name = params.get("name") ?? "";
  const category = params.get("category");
  const categoryId = category !== null && CATEGORY_ID.test(category) ? category : null;
  const offerType = params.get("offer_type");
  const offerMode = offerType === "GIFT" || offerType === "SWAP" ? offerType : null;
  const locality = params.get("locality");
  const localityId = locality !== null && LOCALITY_ID.test(locality) ? locality : null;
  const radius = (localityId && RADII_KM.find((km) => String(km) === params.get("radius"))) || null;
  const refined = categoryId !== null || offerMode !== null || localityId !== null;
  return {
    name,
    note: "",
    categoryId,
    offerMode,
    localityId,
    radius,
    refined,
    fromSearch: refined || name !== "",
  };
}

export function initialFromWant(want: WantResponse): WantFormInitial {
  return {
    name: want.name,
    note: want.note ?? "",
    categoryId: want.category_id,
    offerMode: want.offer_mode,
    localityId: want.locality_id,
    radius: want.locality_id ? want.radius_km : null,
    refined: true,
    fromSearch: false,
  };
}

/** The search page with the query and filters the form was opened with. */
export function searchBackPath(initial: WantFormInitial): string {
  const query = new URLSearchParams();
  if (initial.name) query.set("q", initial.name);
  if (initial.categoryId) query.set("category", initial.categoryId);
  if (initial.offerMode) query.set("offer_type", initial.offerMode);
  if (initial.localityId) query.set("locality", initial.localityId);
  if (initial.radius) query.set("radius", String(initial.radius));
  const search = query.toString();
  return search ? `${viewPath("search")}?${search}` : viewPath("search");
}

/** Length as the server counts it: trimmed, in code points. */
export function textLength(text: string): number {
  return Array.from(text.trim()).length;
}
