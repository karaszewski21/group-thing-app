import { Link } from "../../routing/navigation";
import type { MyReservationResponse } from "../../api/reservations";
import { useMyReservations } from "../../hooks/useMyReservations";
import { BoxIcon } from "../../components/shared/appIcons";
import dayjs from "../../utils/dayjs";
import { SafeImage } from "../product/ItemGallery";

const MODE_LABEL: Record<MyReservationResponse["mode"], string> = {
  GIFT: "Za darmo",
  SWAP: "Zamiana",
};

const MODE_TONE: Record<MyReservationResponse["mode"], string> = {
  GIFT: "bg-primary-soft text-primary-fg",
  SWAP: "bg-accent-soft text-accent-fg",
};

const STATUS_LABEL: Record<MyReservationResponse["status"], string> = {
  PROPOSED: "Propozycja zamiany czeka na odpowiedź",
  PENDING: "Czeka na potwierdzenie",
  CONFIRMED: "Potwierdzone",
};

/** Where and when the item changes hands: the term's circle or the event,
 * with its date, or a pickup arranged with the owner. */
function pickupLine(reservation: MyReservationResponse): string {
  if (reservation.context_kind === "PERSONAL") return "Odbiór osobisty";
  const when = reservation.occurs_at ? dayjs(reservation.occurs_at).format("ddd D MMM, HH:mm") : null;
  return [reservation.context_name, when].filter(Boolean).join(" · ");
}

/** "Zarezerwowane" (/items/reserved): the items the user is about to
 * receive — their takes, accepted swaps and swap offers still awaiting the
 * owner. Each row opens the item page, which holds the actions. The `{" "}`
 * between the card's lines keeps the link's accessible name readable. */
export function ReservedItemsView() {
  const { data: reservations, loading, error } = useMyReservations();

  if (loading) return <p className="text-[13px] text-ink-soft">Ładowanie rezerwacji…</p>;
  if (error) {
    return (
      <p role="alert" className="rounded-2xl bg-danger-soft px-3 py-2.5 text-sm text-danger">
        {error}
      </p>
    );
  }
  if (reservations.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2.5 rounded-[28px] border-[1.5px] border-dashed border-line-strong bg-paper px-5 py-7 text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-3xl bg-accent-soft text-accent-fg">
          <BoxIcon c="currentColor" />
        </span>
        <p className="font-serif text-[22px] font-extrabold text-ink">Nic nie rezerwujesz</p>
        <p className="max-w-70 text-[15px] leading-snug text-ink-soft">
          Gdy weźmiesz albo zaproponujesz zamianę za czyjąś rzecz, pojawi się tutaj.
        </p>
      </div>
    );
  }

  return (
    <ul aria-label="Zarezerwowane rzeczy" className="flex flex-col gap-3">
      {reservations.map((reservation) => (
        <li key={`${reservation.item_id}:${reservation.reservation_id ?? "proposal"}`}>
          <Link
            to={reservation.item_path}
            className="flex items-start gap-3 rounded-[22px] border border-line bg-paper p-3.5 transition-colors hover:bg-cream focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            <SafeImage
              src={reservation.thumb_url ?? ""}
              alt=""
              className="h-16 w-16 flex-none rounded-2xl object-cover"
              placeholderSize={28}
            />
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-base font-bold wrap-break-word text-ink">{reservation.product_name}</span>{" "}
              <span className="text-sm text-ink-soft">od {reservation.owner_name}</span>{" "}
              <span className="text-sm text-ink">{pickupLine(reservation)}</span>{" "}
              <span className="flex flex-wrap items-center gap-1.5 pt-0.5">
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-extrabold ${MODE_TONE[reservation.mode]}`}>
                  {MODE_LABEL[reservation.mode]}
                </span>{" "}
                <span className="rounded-full bg-cream px-2.5 py-0.5 text-xs font-extrabold text-ink-soft">
                  {STATUS_LABEL[reservation.status]}
                </span>
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
