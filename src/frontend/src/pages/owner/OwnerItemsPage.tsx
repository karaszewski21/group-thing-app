import { useEffect, useId, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import type { OwnerNearestDate } from "../../api/ownerItems";
import { useOwnerItems, type OwnerRef } from "../../hooks/useOwnerItems";
import { usePublicOrganization } from "../../hooks/usePublicOrganization";
import { OrganizerThemeScope } from "../../theme/OrganizerThemeScope";
import { isPartyId } from "../../utils/appHelpers";
import { pluralPl } from "../../utils/plural";
import { BlockSkeleton } from "../organizer/blocks/BlockSkeleton";
import { ExchangeModeTabs, type ExchangeFilter } from "../organizer/blocks/ExchangeBoardBlock";
import { ItemCard } from "../organizer/blocks/ExchangeItemCard";
import { FooterBlock } from "../organizer/blocks/FooterBlock";
import { NearestDateCard } from "../organizer/blocks/NearestDateCard";
import { NotFoundFrame, PageFrame } from "../organizer/PageFrame";
import { organizerItemPath } from "../product/useItemRoutes";

const FOCUS_RING = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";
const BACK_LINK = `inline-flex min-h-[44px] items-center gap-1.5 self-start text-[14px] font-bold text-primary-fg ${FOCUS_RING}`;
const RETRY_BUTTON = `min-h-[44px] font-bold text-primary-fg underline ${FOCUS_RING}`;
const MORE_BUTTON = `flex min-h-11 w-full items-center justify-center rounded-full border border-line bg-paper px-5 text-[14px] font-bold text-ink disabled:opacity-60 ${FOCUS_RING}`;


const ALL_MEETINGS_LINK = `inline-flex min-h-11 items-center self-start text-[14px] font-extrabold text-primary-fg no-underline ${FOCUS_RING}`;

/** The owner's nearest date (or a chat-only notice) and, with one, a link to
 * all their meetings at `meetingsHref`. */
export function NearestSection({
  nearest,
  name,
  meetingsHref,
}: {
  nearest: OwnerNearestDate | null;
  name: string;
  meetingsHref: string;
}) {
  if (!nearest) {
    return (
      <div className="rounded-3xl border border-line bg-paper p-4">
        <p className="text-[14px] font-bold text-ink">{name} nie ma teraz zaplanowanych spotkań</p>
        <p className="mt-2 text-[13px] text-ink-soft">Napisz w sprawie konkretnej rzeczy — umówicie się na czacie.</p>
      </div>
    );
  }
  const attendees = `${nearest.attendee_count} ${pluralPl(nearest.attendee_count, "zapisany", "zapisanych", "zapisanych")}`;
  return (
    <div className="flex flex-col gap-1">
      <NearestDateCard
        variant="card"
        kicker="Najbliższa okazja do odbioru"
        name={nearest.name}
        startsAt={nearest.starts_at}
        details={nearest.location_name ? `${nearest.location_name} · ${attendees}` : attendees}
        ctaHref={nearest.path}
        ctaLabel={nearest.kind === "EVENT" ? "Zobacz wydarzenie i zapisz się" : "Zobacz termin i zapisz się"}
      />
      <Link to={meetingsHref} className={ALL_MEETINGS_LINK}>
        Wszystkie spotkania
        <span aria-hidden="true">{" ›"}</span>
      </Link>
    </div>
  );
}

/** The owner header, nearest date (or chat-only notice), mode tabs and the
 * paged card grid. A party URL of an Organization owner is replaced by its
 * slug URL, keeping the query. */
function OwnerItemsContent({ ownerRef, back }: { ownerRef: OwnerRef; back: ReactNode }) {
  const [filter, setFilter] = useState<Exclude<ExchangeFilter, "RESERVED">>("ALL");
  const result = useOwnerItems(ownerRef, filter === "ALL" ? undefined : filter);
  const navigate = useNavigate();
  const { search } = useLocation();
  const baseId = useId();

  const redirectSlug = ownerRef.kind === "party" ? (result.owner?.slug ?? null) : null;
  useEffect(() => {
    if (redirectSlug) navigate(`/${redirectSlug}/items${search}`, { replace: true });
  }, [redirectSlug, search, navigate]);

  if (redirectSlug) return null;

  if (result.loading) {
    return (
      <>
        <div className="px-6 pt-4">{back}</div>
        <BlockSkeleton shape="grid" />
      </>
    );
  }

  if (result.notFound) {
    return (
      <div className="px-6 pt-10 text-center">
        <h1 className="mb-2 font-serif text-2xl font-semibold text-ink">Nie znaleziono strony</h1>
        <p className="text-sm text-ink-soft">Nie ma tu żadnych rzeczy.</p>
      </div>
    );
  }

  const { owner, counts } = result;
  if (result.error || !owner || !counts) {
    return (
      <div className="flex flex-col gap-3 px-6 pt-4">
        {back}
        <p className="text-[13px] text-ink-soft">
          Nie udało się wczytać rzeczy.{" "}
          <button type="button" onClick={() => void result.refetch()} className={RETRY_BUTTON}>
            Spróbuj ponownie
          </button>
        </p>
      </div>
    );
  }

  const total = counts.GIFT + counts.SWAP;
  const nearest = result.nearest;
  const tabId = (id: ExchangeFilter) => `${baseId}-tab-${id}`;
  const panelId = `${baseId}-items`;

  return (
    <>
      <title>{`Rzeczy · ${owner.display_name}`}</title>
      <div className="flex flex-col gap-4 px-6 pt-4">
        {back}
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary-soft text-[18px] font-extrabold text-primary-fg"
          >
            {owner.display_name.charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0">
            <h1 className="font-serif text-[26px] font-semibold leading-tight text-ink">Rzeczy: {owner.display_name}</h1>
            <p className="text-[13px] text-ink-soft">
              {total} {pluralPl(total, "rzecz", "rzeczy", "rzeczy")} do oddania lub zamiany
            </p>
          </div>
        </div>
        <NearestSection
          nearest={nearest}
          name={owner.display_name}
          meetingsHref={`/${owner.slug ?? owner.party_id}/meetings`}
        />
        {total > 0 && (
          <ExchangeModeTabs
            counts={counts}
            selected={filter}
            onSelect={(next) => {
              if (next !== "RESERVED") setFilter(next);
            }}
            allLabel="Wszystkie"
            ariaLabel="Rodzaj wymiany"
            tabId={tabId}
            panelId={panelId}
          />
        )}
      </div>
      <div
        role={total > 0 ? "tabpanel" : undefined}
        id={panelId}
        aria-labelledby={total > 0 ? tabId(filter) : undefined}
        className="flex flex-col gap-3 px-6 pt-3"
      >
        {result.items.length === 0 ? (
          <p className="text-[13px] text-ink-soft">Nie ma teraz rzeczy do oddania ani zamiany.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-2.5">
            {result.items.map((item) => (
              <li key={item.item_id}>
                <ItemCard
                  href={organizerItemPath(owner.slug, item.item_id)}
                  name={item.product_name}
                  condition={item.condition}
                  thumbUrl={item.thumb_url}
                  mode={item.mode}
                  reservation={item.reservation}
                />
              </li>
            ))}
          </ul>
        )}
        {result.nextPageError ? (
          <p className="text-[13px] text-ink-soft">
            Nie udało się wczytać kolejnych rzeczy.{" "}
            <button type="button" onClick={() => void result.fetchNextPage()} className={RETRY_BUTTON}>
              Spróbuj ponownie
            </button>
          </p>
        ) : (
          result.hasNextPage && (
            <button
              type="button"
              onClick={() => void result.fetchNextPage()}
              disabled={result.fetchingNextPage}
              className={MORE_BUTTON}
            >
              {result.fetchingNextPage ? "Wczytywanie…" : "Pokaż więcej"}
            </button>
          )
        )}
      </div>
    </>
  );
}

function OrganizationOwnerItems({ slug }: { slug: string }) {
  const organization = usePublicOrganization(slug);

  if (organization.loading) {
    return (
      <PageFrame>
        <div className="mx-auto w-full max-w-[430px]">
          <BlockSkeleton shape="grid" />
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
          <OwnerItemsContent ownerRef={{ kind: "organization", slug }} back={back} />
          <div className="flex-1" />
          <FooterBlock />
        </div>
      </PageFrame>
    </OrganizerThemeScope>
  );
}

function PartyOwnerItems({ partyId }: { partyId: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  const back = (
    <button
      type="button"
      onClick={() => (location.key !== "default" ? navigate(-1) : navigate("/"))}
      className={BACK_LINK}
    >
      <span aria-hidden="true">‹</span>
      Wróć
    </button>
  );
  return (
    <PageFrame>
      <div className="mx-auto flex w-full max-w-[430px] flex-1 flex-col">
        <OwnerItemsContent ownerRef={{ kind: "party", partyId }} back={back} />
        <div className="flex-1" />
        <FooterBlock />
      </div>
    </PageFrame>
  );
}

/** `/:slug/items` (an Organization, in its theme) or `/:partyId/items` (any
 * person): the owner's listed items, each tile linking to its product page. */
export function OwnerItemsPage() {
  const { organizationSlug = "" } = useParams<{ organizationSlug: string }>();
  return isPartyId(organizationSlug) ? (
    <PartyOwnerItems key={organizationSlug} partyId={organizationSlug} />
  ) : (
    <OrganizationOwnerItems key={organizationSlug} slug={organizationSlug} />
  );
}
