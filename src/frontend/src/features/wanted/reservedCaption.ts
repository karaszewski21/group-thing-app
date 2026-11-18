import type { WantMatchResponse } from "../../api/wants";

type ReservableCard = Pick<WantMatchResponse, "reserved_by_me" | "proposed_by_me" | "meta">;

/** The reservation caption of a want's item card: the viewer's own
 * reservation or proposal first, then anyone's reservation. */
export function reservedCaption(item: ReservableCard): string | undefined {
  if (item.reserved_by_me) return "Zarezerwowane przez Ciebie";
  if (item.proposed_by_me) return "Twoja propozycja";
  return item.meta.reserved ? "Zarezerwowane" : undefined;
}
