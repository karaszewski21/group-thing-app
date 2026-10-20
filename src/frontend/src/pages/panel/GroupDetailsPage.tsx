import { Link, useParams } from "react-router-dom";
import type { GroupMemberResponse, GroupResponse } from "../../api/groups";
import { PhoneFrame } from "../../components/shared/PhoneFrame";
import { useGroupDetails } from "../../hooks/useGroupDetails";
import dayjs from "../../utils/dayjs";
import { pluralPl } from "../../utils/plural";
import { BackIcon } from "./panelIcons";

const LAYOUT_LABEL = { CIRCLE: "Krąg", PITCH: "Boisko", TABLE: "Stół" } as const;
const VISIBILITY_LABEL = { PUBLIC: "Publiczna", PRIVATE: "Prywatna (dostęp na prośbę)" } as const;

/** Group details plus its standing member list (`/panel/grupy/:groupId`).
 * A standalone route outside PanelDataProvider, like TermAttendeesPage; the
 * backend lets the group's organizer and its members in. */
export function GroupDetailsPage() {
  const { groupId = "" } = useParams();
  const { group, members, denied, notFound, error, loading, refetch } = useGroupDetails(groupId);

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
        />
      </div>
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
}

function GroupDetailsBody({
  group,
  members,
  denied,
  notFound,
  error,
  loading,
  onRetry,
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
          ? "Brak członków"
          : `${members.length} ${pluralPl(members.length, "członek", "członków", "członków")}`}
      </p>
      <GroupDetailsCard group={group} />
      <h3 className="mt-6 font-serif text-[17px] font-bold text-ink">Członkowie</h3>
      {members.length === 0 ? (
        <p className="mt-2.5 rounded-2xl border border-dashed border-line p-[15px] text-[12.5px] text-ink-soft">
          Nikt jeszcze nie dołączył do tej grupy na stałe.
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
  return (
    <li className="mt-2.5 rounded-2xl border border-line bg-cream p-[15px] first:mt-0">
      <p className="text-[15.5px] font-semibold text-ink">{member.display_name || "Bez nazwy"}</p>
      {member.family_name && <p className="text-[12.5px] text-ink-soft">{member.family_name}</p>}
      <p className="mt-1.5 text-[12.5px] text-ink-soft">
        w grupie od {dayjs(member.member_since).format("D MMMM YYYY")}
      </p>
    </li>
  );
}
