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
    <header className="kg-head">
      <button className="kg-back" onClick={onBack}>
        ← Wróć
      </button>
      {eyebrow && <div className="kg-eyebrow">{eyebrow}</div>}
      <h1>{title}</h1>
      {subtitle != null && <div className="kg-head-sub">{subtitle}</div>}
    </header>
  );
}
