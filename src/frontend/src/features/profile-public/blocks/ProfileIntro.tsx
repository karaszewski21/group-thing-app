"use client";

import { pluralPl } from "../../../utils/plural";
import { usePartyProfilePage } from "../PartyProfileContext";

/** Name, the listed-items count and the bio, under the avatar. */
export function ProfileIntro() {
  const { profile } = usePartyProfilePage();
  const { owner } = profile;
  const total = profile.counts.GIFT + profile.counts.SWAP;
  return (
    <div className="flex flex-col items-center gap-3 px-6 pt-3 text-center">
      <title>{owner.display_name}</title>
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
