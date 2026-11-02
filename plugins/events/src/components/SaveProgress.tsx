import { useEffect, useRef } from "react";

interface SaveProgressProps {
  name: string;
  /** `creating` while POST /api/events runs, `uploading` once the event exists and the banner is being sent. */
  phase: "creating" | "uploading";
  withBanner: boolean;
}

/** screen:event-saving — replaces the form while a save runs. */
export function SaveProgress({ name, phase, withBanner }: SaveProgressProps) {
  const leadRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    leadRef.current?.focus();
  }, []);

  const created = phase === "uploading";

  return (
    <main>
      <p ref={leadRef} className="lead" tabIndex={-1}>
        Zapisujemy „{name}”…
      </p>
      <div className="steps" role="status">
        <p className="step">
          {created ? (
            <span className="dot ok" aria-hidden="true">
              ✓
            </span>
          ) : (
            <span className="dot run" aria-hidden="true" />
          )}
          {created ? "Wydarzenie zapisane" : "Zapisywanie wydarzenia…"}
        </p>
        {withBanner && (
          <p className="step">
            <span className={created ? "dot run" : "dot wait"} aria-hidden="true" />
            {created ? "Wysyłanie banera…" : "Wysyłanie banera"}
          </p>
        )}
        <p className="hint">Nie zamykaj tej strony.</p>
      </div>
      <div className="actions">
        <button type="button" className="btn" disabled>
          Zapisywanie…
        </button>
      </div>
    </main>
  );
}
