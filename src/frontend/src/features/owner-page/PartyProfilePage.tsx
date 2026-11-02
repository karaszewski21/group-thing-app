import { Link, Navigate, useAppNavigate, useAppParams, useHasInAppHistory } from "../../routing/navigation";
import type { PartyProfileResponse } from "../../api/ownerItems";
import { familyInitials, familyTone } from "../../components/shared/Avatar";
import { CARD } from "../../components/shared/uiStyles";
import { usePartyProfile } from "../../hooks/usePartyProfile";
import { pluralPl } from "../../utils/plural";
import { BlockSkeleton } from "./blocks/BlockSkeleton";
import { ItemCard } from "./blocks/ExchangeItemCard";
import { FooterBlock } from "./blocks/FooterBlock";
import { NotFoundFrame, PageFrame } from "./PageFrame";
import { organizerItemPath } from "../items/product/useItemRoutes";
import { NearestSection } from "./OwnerItemsPage";

const FOCUS_RING = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";
const BACK_BUTTON = `inline-flex min-h-[44px] items-center gap-1.5 self-start text-[14px] font-bold text-primary-fg ${FOCUS_RING}`;
const RETRY_BUTTON = `min-h-[44px] font-bold text-primary-fg underline ${FOCUS_RING}`;
const SECTION_HEADING = "text-xs font-extrabold tracking-[.12em] text-ink-soft uppercase";
const ALL_ITEMS_LINK = `inline-flex min-h-11 items-center text-[14px] font-extrabold text-primary-fg no-underline ${FOCUS_RING}`;
const CTA_LINK = `mt-3 flex min-h-11 items-center justify-center rounded-full bg-primary px-5 text-[14px] font-extrabold text-on-primary no-underline ${FOCUS_RING}`;

function BackButton() {
  const navigate = useAppNavigate();
  const hasInAppHistory = useHasInAppHistory();
  return (
    <button
      type="button"
      onClick={() => (hasInAppHistory ? navigate(-1) : navigate("/"))}
      className={BACK_BUTTON}
    >
      <span aria-hidden="true">‹</span>
      Wróć
    </button>
  );
}

function ProfileAvatar({ name, url }: { name: string; url: string | null }) {
  return url ? (
    <img src={url} alt="" className="size-20 shrink-0 rounded-full border-[3px] border-paper object-cover" />
  ) : (
    <span
      aria-hidden="true"
      className={`flex size-20 shrink-0 items-center justify-center rounded-full border-[3px] border-paper text-[24px] font-extrabold text-ink ${familyTone(name)}`}
    >
      {familyInitials(name)}
    </span>
  );
}

function ItemsSection({ profile }: { profile: PartyProfileResponse }) {
  const total = profile.counts.GIFT + profile.counts.SWAP;
  const { owner } = profile;
  return (
    <section aria-labelledby="profile-items-heading" className="flex flex-col gap-3">
      <h2 id="profile-items-heading" className={SECTION_HEADING}>
        Rzeczy do oddania lub zamiany
      </h2>
      {total === 0 ? (
        <p className="text-[13px] text-ink-soft">Nie ma teraz rzeczy do oddania ani zamiany.</p>
      ) : (
        <>
          <ul className="grid grid-cols-2 gap-2.5">
            {profile.recent_items.map((item) => (
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
          {total > profile.recent_items.length && (
            <Link to={`/${owner.party_id}/items`} className={ALL_ITEMS_LINK}>
              {`Zobacz wszystkie (${total})`}
              <span aria-hidden="true">{" ›"}</span>
            </Link>
          )}
        </>
      )}
    </section>
  );
}

function ProfileContent({ profile }: { profile: PartyProfileResponse }) {
  const { owner } = profile;
  const total = profile.counts.GIFT + profile.counts.SWAP;
  return (
    <>
      <title>{owner.display_name}</title>
      <div className="flex flex-col items-center gap-3 pt-2 text-center">
        <ProfileAvatar name={owner.display_name} url={profile.avatar_url} />
        <div>
          <h1 className="font-serif text-[28px] leading-tight font-semibold text-ink">{owner.display_name}</h1>
          <p className="mt-1 text-[13px] text-ink-soft">
            {total} {pluralPl(total, "rzecz", "rzeczy", "rzeczy")} do oddania lub zamiany
          </p>
        </div>
        {profile.bio && (
          <p className="text-[14px] leading-relaxed whitespace-pre-line wrap-break-word text-ink">{profile.bio}</p>
        )}
      </div>
      <NearestSection
        nearest={profile.nearest}
        name={owner.display_name}
        meetingsHref={`/${owner.party_id}/meetings`}
      />
      <ItemsSection profile={profile} />
      {profile.is_me && (
        <section aria-labelledby="profile-organizer-heading" className={CARD}>
          <h2 id="profile-organizer-heading" className="text-[15px] font-extrabold text-ink">
            To Twój publiczny profil
          </h2>
          <p className="mt-1.5 text-[13px] text-ink-soft">
            Organizujesz zajęcia albo wymianki? Załóż stronę organizatora — z własną nazwą, kolorami i układem.
          </p>
          <Link to="/organization" className={CTA_LINK}>
            Załóż stronę organizatora
          </Link>
        </section>
      )}
    </>
  );
}

/** `/:partyId`: a person's public profile with a fixed layout — avatar,
 * name and bio, their nearest public date, their newest listed items, and
 * for the person themself an invite to set up an organizer page. A person
 * who owns an Organization is redirected to its page. */
export function PartyProfilePage() {
  const { organizationSlug: partyId = "" } = useAppParams<{ organizationSlug: string }>();
  const profile = usePartyProfile(partyId);

  if (profile.notFound) return <NotFoundFrame message="Ten profil nie istnieje albo nie jest publiczny." />;
  const slug = profile.data?.owner.slug;
  if (slug) return <Navigate to={`/${slug}`} replace />;

  const body = (() => {
    if (profile.loading) return <BlockSkeleton shape="grid" />;
    if (!profile.data) {
      return (
        <p className="text-[13px] text-ink-soft">
          Nie udało się wczytać profilu.{" "}
          <button type="button" onClick={() => void profile.refetch()} className={RETRY_BUTTON}>
            Spróbuj ponownie
          </button>
        </p>
      );
    }
    return <ProfileContent profile={profile.data} />;
  })();

  return (
    <PageFrame>
      <div className="mx-auto flex w-full max-w-[430px] flex-1 flex-col">
        <div className="flex flex-col gap-5 px-6 pt-4">
          <BackButton />
          {body}
        </div>
        <div className="flex-1" />
        <FooterBlock />
      </div>
    </PageFrame>
  );
}
