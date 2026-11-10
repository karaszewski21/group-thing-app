"use client";

import { useId } from "react";
import { Link } from "../../../routing/navigation";
import { viewPath } from "../../../routing/paths";

interface ProfileEmptyBoxProps {
  title: string;
  /** The owner's own box: a large "+" to `/add`, named by `addLabel`. */
  addLabel?: string;
}

/** A dashed box for a profile section with nothing in it yet. */
export function ProfileEmptyBox({ title, addLabel }: ProfileEmptyBoxProps) {
  const titleId = useId();
  return (
    <section
      aria-labelledby={titleId}
      className="mx-6 flex items-center gap-4 rounded-2xl border-[1.5px] border-dashed border-line bg-paper/85 px-4 py-5"
    >
      <p id={titleId} className="min-w-0 flex-1 text-[14px] font-bold text-ink">
        {title}
      </p>
      {addLabel && (
        <Link
          to={viewPath("add")}
          aria-label={addLabel}
          title={addLabel}
          className="flex size-14 flex-none items-center justify-center rounded-full bg-primary text-[32px] leading-none font-light text-on-primary shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          <span aria-hidden="true">+</span>
        </Link>
      )}
    </section>
  );
}
