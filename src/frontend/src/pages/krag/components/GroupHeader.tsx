import { Link } from "react-router-dom";
import type { ReactNode } from "react";

/**
 * `.kg-head` sticky header — shared shape between `PrivateTermView` and
 * `PublicTermView`'s non-`PRIVATE` branch: back button, optional "Mój
 * panel →" link, eyebrow/title/subtitle, and an optional `actions` slot
 * below the subtitle (the private view's withdraw/sign-up buttons; the
 * public view passes none). Data and capabilities come entirely through
 * props — this component makes no auth or membership decisions itself.
 */
export function GroupHeader({
  eyebrow,
  title,
  subtitle,
  onBack,
  showPanelLink = false,
  actions,
}: {
  eyebrow: string;
  title: string;
  subtitle: ReactNode;
  onBack: () => void;
  showPanelLink?: boolean;
  actions?: ReactNode;
}) {
  return (
    <header className="kg-head">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <button className="kg-back" onClick={onBack}>
          ← Wróć
        </button>
        {showPanelLink && (
          <Link className="kg-back" to="/panel" style={{ paddingBottom: 8 }}>
            Mój panel →
          </Link>
        )}
      </div>
      <div className="kg-head-row">
        <div>
          <div className="kg-eyebrow">{eyebrow}</div>
          <h1>{title}</h1>
          <div className="kg-head-sub">{subtitle}</div>
          {actions}
        </div>
      </div>
    </header>
  );
}
