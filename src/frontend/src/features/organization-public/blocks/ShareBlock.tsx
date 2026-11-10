import type { BlockProps } from "../layouts/types";
import { ShareButton } from "./ShareButton";

/** CLASSIC share pill. */
export function ShareBlock({ data }: BlockProps) {
  return (
    <div className="px-6 pt-5">
      <ShareButton
        slug={data.organization.slug}
        name={data.organization.name}
        label="Udostępnij"
        className="inline-flex min-h-11 items-center gap-2 rounded-full bg-primary-soft px-5 text-sm font-extrabold text-primary-fg"
      />
    </div>
  );
}
