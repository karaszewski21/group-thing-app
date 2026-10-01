import type { ReactNode } from "react";

/** `.kg-head` sticky header: back button, optional eyebrow, the group name,
 * and an optional subtitle line (omitted entirely when `subtitle` is null). */
export function GroupHeader({
  title,
  subtitle,
  eyebrow,
  onBack,
}: {
  title: string;
  subtitle?: ReactNode;
  eyebrow?: string;
  onBack: () => void;
}) {
  return (
    <header className="sticky top-0 bg-transparent px-4.5 pb-4 pt-4.5 ">
      <h1 className="text-xl">{title}</h1>
      {/* {subtitle != null && <div className="px-4.5 pb-4 pt-4.5 bg-white">{subtitle}</div>} */}
    </header>
  );
}
