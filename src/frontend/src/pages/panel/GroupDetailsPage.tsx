import type { ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import type { GroupMemberResponse, GroupResponse } from "../../api/groups";
import { JoinCodeCard } from "../../components/panel/JoinCodeCard";
import { PhoneFrame } from "../../components/shared/PhoneFrame";
import { useGroupDetails } from "../../hooks/useGroupDetails";
import { useGroupTerms } from "../../hooks/useGroupTerms";
import { useJoinCode } from "../../hooks/useJoinCode";
import dayjs from "../../utils/dayjs";
import { pluralPl } from "../../utils/plural";
import { PanelNavBar } from "./PanelNav";
import { BackIcon } from "./panelIcons";

const LAYOUT_LABEL = { CIRCLE: "Krąg", PITCH: "Boisko", TABLE: "Stół" } as const;
const VISIBILITY_LABEL = { PUBLIC: "Publiczna", PRIVATE: "Prywatna (dostęp z kodem)" } as const;

/** Group details plus everyone who signed up for its terms (`/panel/grupy/:groupId`).
 * A standalone route outside PanelDataProvider, like TermAttendeesPage, but
 * with the panel's bottom tab bar (no tab highlighted, like the item pages:
 * this page is not one of the panel's views). The backend lets the group's organizer and its members in. */
export function GroupDetailsPage() {
  const { groupId = "" } = useParams();
  const { group, members, denied, notFound, error, loading, refetch } = useGroupDetails(groupId);
  const isPrivate = group?.visibility === "PRIVATE";
  const joinCode = useJoinCode(groupId, { enabled: isPrivate });
  // Only the organizer (code loaded) needs a term to link to.
  const { data: terms } = useGroupTerms(groupId, { enabled: joinCode.status === "ready" });
  const today = dayjs().startOf("day");
  const nearestTerm = terms
    .filter((t) => !dayjs(t.occurs_on).isBefore(today))
    .sort((a, b) => a.occurs_on.localeCompare(b.occurs_on))[0];

  return (
    <PhoneFrame>
      <div className="flex-1 overflow-y-auto px-[18px] pb-6 pt-[18px]">
        <Link
          to="/panel/spotkania"
          className="mb-4 inline-flex items-center gap-1.5 text-xs font-bold text-ink-soft"
        >
          <BackIcon /> Wróć
        </Link>
        <h2 className="text-[19px] font-semibold text-ink">{group?.name ?? "Grupa"}</h2>
        <GroupDetailsBody
          group={group}
          members={members}
          denied={denied}
          notFound={notFound}
          error={error}
          loading={loading}
          onRetry={() => void refetch()}
          joinCodeCard={
            group &&
            isPrivate && (
              <JoinCodeCard
                group={group}
                code={joinCode.code}
                status={joinCode.status}
                onRetry={joinCode.refetch}
                regenerate={joinCode.regenerate}
                termId={nearestTerm?.id ?? null}
              />
            )
          }
        />
      </div>
      <PanelNavBar />
    </PhoneFrame>
  );
}

interface GroupDetailsBodyProps {
  group: GroupResponse | null;
  members: GroupMemberResponse[];
  denied: boolean;
  notFound: boolean;
  error: string | null;
  loading: boolean;
  onRetry: () => void;
  /** Shown under the details card (PRIVATE groups only). */
  joinCodeCard: ReactNode;
}

function GroupDetailsBody({
  group,
  members,
  denied,
  notFound,
  error,
  loading,
  onRetry,
  joinCodeCard,
}: GroupDetailsBodyProps) {
  if (denied) {
    return <p className="mt-3 text-[12.5px] text-ink-soft">Nie masz dostępu do tej grupy.</p>;
  }
  if (notFound) {
    return <p className="mt-3 text-[12.5px] text-ink-soft">Nie znaleziono tej grupy.</p>;
  }
  if (error) {
    return (
      <div className="mt-3">
        <p className="text-[12.5px] font-semibold text-danger">
          Nie udało się wczytać grupy — spróbuj ponownie
        </p>
        <p className="mt-0.5 text-[11.5px] text-ink-soft">{error}</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 rounded-xl border border-line bg-paper px-4 py-2 text-[13px] font-semibold text-ink transition-colors hover:bg-cream"
        >
          Spróbuj ponownie
        </button>
      </div>
    );
  }
  if (loading || !group) {
    return <p className="mt-4 text-[12.5px] text-ink-soft">Wczytywanie grupy…</p>;
  }

  return (
    <>
      <p className="mt-0.5 text-[12.5px] text-ink-soft">
        {members.length === 0
          ? "Brak uczestników"
          : `${members.length} ${pluralPl(members.length, "uczestnik", "uczestników", "uczestników")}`}
      </p>
      <GroupDetailsCard group={group} />
      {joinCodeCard}
      <h3 className="mt-6 font-serif text-[17px] font-bold text-ink">Uczestnicy terminów</h3>
      {members.length === 0 ? (
        <p className="mt-2.5 rounded-2xl border border-dashed border-line p-[15px] text-[12.5px] text-ink-soft">
          Nikt jeszcze nie zapisał się na żaden termin tej grupy.
        </p>
      ) : (
        <div className="mt-2.5 rounded-[22px] border border-line bg-paper p-5">
          <ul>
            {members.map((m) => (
              <GroupMemberRow key={m.party_id} member={m} />
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

function GroupDetailsCard({ group }: { group: GroupResponse }) {
  const rows: { label: string; value: string }[] = [
    { label: "Widoczność", value: VISIBILITY_LABEL[group.visibility] },
    { label: "Układ", value: LAYOUT_LABEL[group.layout_mode] },
    {
      label: "Domyślne miejsce",
      value: group.default_location
        ? `${group.default_location.name} · ${group.default_location.formatted_address}`
        : "Nie ustawiono",
    },
    {
      label: "Domyślny limit miejsc",
      value: group.default_capacity != null ? String(group.default_capacity) : "Bez limitu",
    },
    { label: "Utworzono", value: dayjs(group.created_at).format("D MMMM YYYY") },
  ];

  return (
    <div className="mt-4 rounded-2xl border border-line bg-cream p-[15px]">
      <dl>
        {rows.map((row) => (
          <div key={row.label} className="flex items-baseline justify-between gap-3 py-1">
            <dt className="flex-none text-[12.5px] text-ink-soft">{row.label}</dt>
            <dd className="min-w-0 text-right text-[13px] font-semibold text-ink">{row.value}</dd>
          </div>
        ))}
      </dl>
      {group.organizer_slug && (
        <Link
          to={`/${group.organizer_slug}`}
          className="mt-2 inline-block text-[12.5px] font-bold text-mint hover:underline"
        >
          Zobacz stronę organizatora ›
        </Link>
      )}
    </div>
  );
}

function GroupMemberRow({ member }: { member: GroupMemberResponse }) {
  const n = member.terms_attended;
  return (
    <li className="mt-2.5 rounded-2xl border border-line bg-cream p-[15px] first:mt-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[15.5px] font-semibold text-ink">{member.display_name || "Bez nazwy"}</p>
          {member.family_name && <p className="text-[12.5px] text-ink-soft">{member.family_name}</p>}
        </div>
        <span className="flex-none rounded-full bg-mint-soft px-2.5 py-0.5 text-[10.5px] font-extrabold text-[#12604D]">
          {n} {pluralPl(n, "termin", "terminy", "terminów")}
        </span>
      </div>
      <p className="mt-1.5 text-[12.5px] text-ink-soft">
        ostatnio: {dayjs(member.last_term_on).format("D MMMM YYYY")}
      </p>
    </li>
  );
}
