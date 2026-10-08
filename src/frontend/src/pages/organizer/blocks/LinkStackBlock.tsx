import type { BlockProps } from "../layouts/types";
import { ShareButton } from "./ShareButton";

/** LINKS button stack; holds only the share action until terms and exchanges arrive. */
export function LinkStackBlock({ data }: BlockProps) {
  return (
    <div className="flex flex-col gap-3 px-6">
      <ShareButton
        slug={data.organization.slug}
        name={data.organization.name}
        label="Udostępnij stronę"
        className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-primary px-5 text-[15px] font-extrabold text-on-primary"
      />
    </div>
  );
}
