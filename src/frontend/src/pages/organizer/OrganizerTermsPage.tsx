import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useOrganizerPage } from "../../hooks/useOrganizerPage";
import { useOrganizerTerms } from "../../hooks/useOrganizerTerms";
import { usePublicOrganization } from "../../hooks/usePublicOrganization";
import { OrganizerThemeScope } from "../../theme/OrganizerThemeScope";
import { pluralPl } from "../../utils/plural";
import { AgendaList } from "./blocks/AgendaList";
import { BlockSkeleton } from "./blocks/BlockSkeleton";
import { CircleFilterChips } from "./blocks/CircleFilterChips";
import { FooterBlock } from "./blocks/FooterBlock";
import { NotFoundFrame, PageFrame } from "./PageFrame";

const GROUP_PARAM = "group_id";

const SECONDARY_BUTTON =
  "flex min-h-11 items-center justify-center rounded-2xl border border-line bg-paper px-5 text-[14px] font-bold text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:opacity-60";
const RETRY_BUTTON =
  "min-h-[44px] font-bold text-primary-fg underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

function Heading() {
  return <h1 className="font-serif text-2xl font-semibold text-ink">Wszystkie terminy</h1>;
}

/**
 * `/:slug/terminy`: the organizer's full forward agenda, filterable by circle.
 * The `group_id` search parameter is honored only when it names one of the
 * directory's circles, so the terms request never carries an unvalidated id.
 */
export function OrganizerTermsPage() {
  const { organizationSlug = "" } = useParams<{ organizationSlug: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const organization = usePublicOrganization(organizationSlug);
  const directory = useOrganizerPage(organizationSlug);
  const circles = directory.data?.circles ?? [];

  const requestedGroupId = searchParams.get(GROUP_PARAM);
  const groupId =
    requestedGroupId !== null && circles.some((circle) => circle.id === requestedGroupId)
      ? requestedGroupId
      : undefined;
  const awaitingDirectory = requestedGroupId !== null && directory.loading;
  const terms = useOrganizerTerms(organizationSlug, groupId, {
    enabled: !awaitingDirectory,
  });
  /** Terms shown before the last "Pokaż więcej", to announce how many arrived. */
  const [countBeforeMore, setCountBeforeMore] = useState<number | null>(null);

  const rejectedGroupId = requestedGroupId !== null && !directory.loading && groupId === undefined;
  useEffect(() => {
    if (!rejectedGroupId) return;
    setSearchParams(
      (params) => {
        params.delete(GROUP_PARAM);
        return params;
      },
      { replace: true },
    );
  }, [rejectedGroupId, setSearchParams]);

  function selectCircle(id: string | undefined) {
    setCountBeforeMore(null);
    setSearchParams(
      (params) => {
        if (id === undefined) params.delete(GROUP_PARAM);
        else params.set(GROUP_PARAM, id);
        return params;
      },
      { replace: true },
    );
  }

  function showMore() {
    setCountBeforeMore(terms.terms.length);
    void terms.fetchNextPage();
  }

  if (organization.loading) {
    return (
      <PageFrame>
        <div className="px-6 pt-4">
          <Heading />
        </div>
        <BlockSkeleton shape="rows" />
      </PageFrame>
    );
  }

  if (!organization.data || directory.notFound || terms.notFound) return <NotFoundFrame />;

  const loaded = countBeforeMore === null ? 0 : terms.terms.length - countBeforeMore;
  const announcement =
    loaded > 0
      ? `Wczytano ${loaded} ${pluralPl(loaded, "kolejny termin", "kolejne terminy", "kolejnych terminów")}`
      : "";
  const slug = organization.data.slug;

  return (
    <OrganizerThemeScope theme={organization.data}>
      <PageFrame>
        <div className="flex flex-col gap-3 px-6 pt-4">
          <Link
            to={`/${slug}`}
            className="inline-flex min-h-[44px] items-center gap-1.5 self-start text-[14px] font-bold text-primary-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            <span aria-hidden="true">‹</span>
            {organization.data.name}
          </Link>
          <div>
            <Heading />
            {!terms.loading && !terms.error && terms.total > 0 && (
              <p className="mt-1 text-[14px] text-ink-soft">
                {terms.total} {pluralPl(terms.total, "zaplanowany", "zaplanowane", "zaplanowanych")}
              </p>
            )}
          </div>
          <CircleFilterChips circles={circles} selected={groupId} onSelect={selectCircle} />
        </div>
        {terms.loading ? (
          <BlockSkeleton shape="rows" />
        ) : (
          <div className="flex flex-col gap-3 px-6 pt-3">
            {terms.error ? (
              <p className="text-[13px] text-ink-soft">
                Nie udało się wczytać terminów.{" "}
                <button type="button" onClick={() => void terms.refetch()} className={RETRY_BUTTON}>
                  Spróbuj ponownie
                </button>
              </p>
            ) : terms.terms.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-2xl border border-line bg-paper px-6 py-8 text-center">
                <p className="font-serif text-[16px] font-semibold text-ink">Brak zaplanowanych zajęć</p>
                {groupId !== undefined && (
                  <button type="button" onClick={() => selectCircle(undefined)} className={RETRY_BUTTON}>
                    Pokaż wszystkie grupy
                  </button>
                )}
              </div>
            ) : (
              <>
                <AgendaList slug={slug} terms={terms.terms} />
                {terms.nextPageError ? (
                  <p className="text-[13px] text-ink-soft">
                    Nie udało się wczytać kolejnych terminów.{" "}
                    <button type="button" onClick={showMore} className={RETRY_BUTTON}>
                      Spróbuj ponownie
                    </button>
                  </p>
                ) : (
                  terms.hasNextPage && (
                    <button
                      type="button"
                      onClick={showMore}
                      disabled={terms.fetchingNextPage}
                      className={`self-center ${SECONDARY_BUTTON}`}
                    >
                      {terms.fetchingNextPage ? "Wczytywanie…" : "Pokaż więcej"}
                    </button>
                  )
                )}
              </>
            )}
          </div>
        )}
        <p aria-live="polite" className="sr-only">
          {announcement}
        </p>
        <div className="flex-1" />
        <FooterBlock />
      </PageFrame>
    </OrganizerThemeScope>
  );
}
