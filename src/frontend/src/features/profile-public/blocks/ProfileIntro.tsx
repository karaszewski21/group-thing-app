"use client";

import { familyInitials, familyTone } from "../../../components/shared/Avatar";
import { pluralPl } from "../../../utils/plural";
import { usePartyProfilePage } from "../PartyProfileContext";

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

/** Avatar, name, the listed-items count and the bio. */
export function ProfileIntro() {
  const { profile } = usePartyProfilePage();
  const { owner } = profile;
  const total = profile.counts.GIFT + profile.counts.SWAP;
  return (
    <div className="flex flex-col items-center gap-3 pt-2 text-center">
      <title>{owner.display_name}</title>
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
  );
}
