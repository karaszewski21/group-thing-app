import type { WantResponse } from "../../api/wants";

/** The one screen of `/wanted` under the header. */
export type WantedListViewState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "empty" }
  | {
      kind: "list";
      wants: WantResponse[];
      /** A refetch failed; the wants shown are the last loaded ones. */
      refreshError: string | null;
    };

export interface WantedListViewInput {
  loading: boolean;
  error: string | null;
  wants: WantResponse[];
}

/** A failed first load is an error, never "nothing saved yet"; loaded wants
 * stay on screen when a later refresh fails. */
export function resolveWantedListView({ loading, error, wants }: WantedListViewInput): WantedListViewState {
  if (loading) return { kind: "loading" };
  if (wants.length > 0) return { kind: "list", wants, refreshError: error };
  if (error) return { kind: "error", message: error };
  return { kind: "empty" };
}
