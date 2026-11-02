import { useEffect, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { OwnerNearestDate } from "../../api/ownerItems";
import type { OwnerRef } from "../../hooks/useOwnerItems";
import { useOwnerMeetings } from "../../hooks/useOwnerMeetings";
import { usePublicOrganization } from "../../hooks/usePublicOrganization";
import { OrganizerThemeScope } from "../../theme/OrganizerThemeScope";
import { isPartyId } from "../../utils/appHelpers";
import dayjs from "../../utils/dayjs";
import { pluralPl } from "../../utils/plural";
import { BlockSkeleton } from "./blocks/BlockSkeleton";
import { FooterBlock } from "./blocks/FooterBlock";
import { DateTile } from "./blocks/NearestDateCard";
import { NotFoundFrame, PageFrame } from "./PageFrame";

const FOCUS_RING = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";
const BACK_LINK = `inline-flex min-h-[44px] items-center gap-1.5 self-start text-[14px] font-bold text-primary-fg ${FOCUS_RING}`;
const RETRY_BUTTON = `min-h-[44px] font-bold text-primary-fg underline ${FOCUS_RING}`;

function MeetingCard({ meeting }: { meeting: OwnerNearestDate }) {
  const attendees = `${meeting.attendee_count} ${pluralPl(meeting.attendee_count, "zapisany", "zapisanych", "zapisanych")}`;
  return (
    <Link
      to={meeting.path}
      className={`flex items-center gap-3 rounded-3xl border border-line bg-paper p-3 no-underline ${FOCUS_RING}`}
    >
      <DateTile occursOn={meeting.starts_at} className="bg-primary text-on-primary" weekday />
      <span className="flex min-w-0 flex-col">
        <span className="text-[11px] font-extrabold tracking-wide text-accent-fg uppercase">
          {meeting.kind === "EVENT" ? "Wydarzenie" : "Termin"}
        </span>
        <span className="truncate text-[15px] font-bold text-ink">{meeting.name}</span>
        <span className="text-[12.5px] text-ink">{dayjs(meeting.starts_at).format("dddd, D MMMM · HH:mm")}</span>
        <span className="text-[12.5px] text-ink-soft">
          {meeting.location_name ? `${meeting.location_name} · ${attendees}` : attendees}
        </span>
      </span>
    </Link>
  );
}

/** The header and the list of upcoming terms and events, each linking to
 * its page. A party URL of an Organization owner is replaced by its slug URL. */
function OwnerMeetingsContent({ ownerRef, back }: { ownerRef: OwnerRef; back: ReactNode }) {
  const result = useOwnerMeetings(ownerRef);
  const navigate = useNavigate();

  const redirectSlug = ownerRef.kind === "party" ? (result.owner?.slug ?? null) : null;
  useEffect(() => {
    if (redirectSlug) navigate(`/${redirectSlug}/meetings`, { replace: true });
  }, [redirectSlug, navigate]);

  if (redirectSlug) return null;

  if (result.loading) {
    return (
      <>
        <div className="px-6 pt-4">{back}</div>
        <BlockSkeleton shape="rows" />
      </>
    );
  }

  if (result.notFound) {
    return (
      <div className="px-6 pt-10 text-center">
        <h1 className="mb-2 font-serif text-2xl font-semibold text-ink">Nie znaleziono strony</h1>
        <p className="text-sm text-ink-soft">Ten profil nie istnieje albo nie jest publiczny.</p>
      </div>
    );
  }

  const { owner, meetings } = result;
  if (result.error || !owner) {
    return (
      <div className="flex flex-col gap-3 px-6 pt-4">
        {back}
        <p className="text-[13px] text-ink-soft">
          Nie udało się wczytać spotkań.{" "}
          <button type="button" onClick={() => void result.refetch()} className={RETRY_BUTTON}>
            Spróbuj ponownie
          </button>
        </p>
      </div>
    );
  }

  return (
    <>
      <title>{`Spotkania · ${owner.display_name}`}</title>
      <div className="flex flex-col gap-4 px-6 pt-4">
        {back}
        <div>
          <h1 className="font-serif text-[26px] leading-tight font-semibold text-ink">
            Spotkania: {owner.display_name}
          </h1>
          {meetings.length > 0 && (
            <p className="mt-1 text-[13px] text-ink-soft">
              {meetings.length}{" "}
              {pluralPl(meetings.length, "zaplanowane spotkanie", "zaplanowane spotkania", "zaplanowanych spotkań")}
            </p>
          )}
        </div>
        {meetings.length === 0 ? (
          <div className="rounded-3xl border border-line bg-paper p-4">
            <p className="text-[14px] font-bold text-ink">{owner.display_name} nie ma teraz zaplanowanych spotkań</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {meetings.map((meeting) => (
              <li key={`${meeting.kind}-${meeting.id}`}>
                <MeetingCard meeting={meeting} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

function OrganizationOwnerMeetings({ slug }: { slug: string }) {
  const organization = usePublicOrganization(slug);

  if (organization.loading) {
    return (
      <PageFrame>
        <div className="mx-auto w-full max-w-[430px]">
          <BlockSkeleton shape="rows" />
        </div>
      </PageFrame>
    );
  }
  if (!organization.data) return <NotFoundFrame />;

  const back = (
    <Link to={`/${organization.data.slug}`} className={BACK_LINK}>
      <span aria-hidden="true">‹</span>
      {organization.data.name}
    </Link>
  );
  return (
    <OrganizerThemeScope theme={organization.data}>
      <PageFrame>
        <div className="mx-auto flex w-full max-w-[430px] flex-1 flex-col">
          <OwnerMeetingsContent ownerRef={{ kind: "organization", slug }} back={back} />
          <div className="flex-1" />
          <FooterBlock />
        </div>
      </PageFrame>
    </OrganizerThemeScope>
  );
}

function PartyOwnerMeetings({ partyId }: { partyId: string }) {
  const back = (
    <Link to={`/${partyId}`} className={BACK_LINK}>
      <span aria-hidden="true">‹</span>
      Profil
    </Link>
  );
  return (
    <PageFrame>
      <div className="mx-auto flex w-full max-w-[430px] flex-1 flex-col">
        <OwnerMeetingsContent ownerRef={{ kind: "party", partyId }} back={back} />
        <div className="flex-1" />
        <FooterBlock />
      </div>
    </PageFrame>
  );
}

/** `/:slug/meetings` (an Organization, in its theme) or `/:partyId/meetings`
 * (any person with a public footprint): the owner's upcoming public terms
 * and events, earliest first. */
export function OwnerMeetingsPage() {
  const { organizationSlug = "" } = useParams<{ organizationSlug: string }>();
  return isPartyId(organizationSlug) ? (
    <PartyOwnerMeetings key={organizationSlug} partyId={organizationSlug} />
  ) : (
    <OrganizationOwnerMeetings key={organizationSlug} slug={organizationSlug} />
  );
}
