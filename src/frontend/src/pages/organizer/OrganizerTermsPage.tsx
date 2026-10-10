import { useEffect } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useOrganizerPage } from "../../hooks/useOrganizerPage";
import { useOrganizerTerms } from "../../hooks/useOrganizerTerms";
import { usePublicOrganization } from "../../hooks/usePublicOrganization";
import { OrganizerThemeScope } from "../../theme/OrganizerThemeScope";
import { pluralPl } from "../../utils/plural";
import { AgendaResults } from "./blocks/AgendaResults";
import { BlockSkeleton } from "./blocks/BlockSkeleton";
import { CircleFilterChips } from "./blocks/CircleFilterChips";
import { FooterBlock } from "./blocks/FooterBlock";
import { NotFoundFrame, PageFrame } from "./PageFrame";

const GROUP_PARAM = "group_id";

function Heading() {
  return <h1 className="font-serif text-2xl font-semibold text-ink">Wszystkie terminy</h1>;
}

/**
 * `/:slug/terminy`: the organizer's full forward agenda, filterable by circle.
 * The `group_id` search parameter is honored only when it names one of the
 * directory's circles, so the terms request never carries an unvalidated id;
 * it is dropped from the URL only once the directory has loaded without it.
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

  const rejectedGroupId = requestedGroupId !== null && directory.data !== null && groupId === undefined;
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
    setSearchParams(
      (params) => {
        if (id === undefined) params.delete(GROUP_PARAM);
        else params.set(GROUP_PARAM, id);
        return params;
      },
      { replace: true },
    );
  }

  if (organization.loading) {
    return (
      <PageFrame>
        <div className="mx-auto w-full max-w-[430px]">
          <div className="px-6 pt-4">
            <Heading />
          </div>
          <BlockSkeleton shape="rows" />
        </div>
      </PageFrame>
    );
  }

  if (!organization.data || directory.notFound || terms.notFound) return <NotFoundFrame />;

  const slug = organization.data.slug;

  return (
    <OrganizerThemeScope theme={organization.data}>
      <title>{`Wszystkie terminy · ${organization.data.name}`}</title>
      <PageFrame>
        <div className="mx-auto flex w-full max-w-[430px] flex-1 flex-col">
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
          <AgendaResults
            key={groupId ?? ""}
            slug={slug}
            agenda={terms}
            moreLabel="Pokaż więcej"
            dayHeadingLevel={2}
            onShowAll={groupId === undefined ? undefined : () => selectCircle(undefined)}
          />
          <div className="flex-1" />
          <FooterBlock />
        </div>
      </PageFrame>
    </OrganizerThemeScope>
  );
}
