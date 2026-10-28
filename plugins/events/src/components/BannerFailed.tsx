import { useEffect, useRef } from "react";
import { MESSAGES, type EventResponse } from "../domain";
import { SavedCard } from "./SavedCard";

interface BannerFailedProps {
  event: EventResponse;
  /** Extra line from `bannerError`, or null. */
  detail: string | null;
  onRetry: () => void;
  onSkip: () => void;
}

/** screen:event-banner-failed — the event exists, only the banner upload failed. */
export function BannerFailed({ event, detail, onRetry, onSkip }: BannerFailedProps) {
  const retryRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    retryRef.current?.focus();
  }, []);

  return (
    <main>
      <SavedCard event={event} bannerUrl={null} />
      <div className="alertbox spaced" role="alert">
        <p>{MESSAGES.bannerFailed}</p>
        {detail && <p>{detail}</p>}
      </div>
      <div className="actions">
        <button ref={retryRef} type="button" className="btn" onClick={onRetry}>
          Spróbuj ponownie
        </button>
        <button type="button" className="ghost" onClick={onSkip}>
          Pomiń baner
        </button>
      </div>
    </main>
  );
}
