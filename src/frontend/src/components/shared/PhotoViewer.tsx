import { useEffect, useRef, useState, type KeyboardEvent, type TouchEvent } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { SafeImage } from "../../pages/product/ItemGallery";
import { trapFocus } from "../krag/trapFocus";
import { useRegisterOpenSheet } from "./openSheets";

const SWIPE_THRESHOLD_PX = 40;

const CONTROL =
  "flex h-11 w-11 items-center justify-center rounded-full bg-paper/15 text-on-ink hover:bg-paper/25 focus-visible:outline-2 focus-visible:outline-on-ink aria-disabled:opacity-30";

/**
 * Fullscreen photo viewer opened from a gallery tile. Shows one photo at a
 * time, contained in the screen, with a "2 / 5" counter. ←/→ keys, the arrow
 * buttons and a horizontal swipe move between photos (no wrap-around); Esc,
 * the ✕ button or a tap on the backdrop closes it. Tab stays inside, and
 * focus returns to the opener on close.
 */
export function PhotoViewer({
  name,
  urls,
  startIndex,
  onClose,
}: {
  name: string;
  urls: string[];
  startIndex: number;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [opener] = useState(() => document.activeElement);
  const [index, setIndex] = useState(() => Math.min(Math.max(startIndex, 0), urls.length - 1));
  const touchStartX = useRef<number | null>(null);
  useRegisterOpenSheet(true);

  useEffect(() => {
    dialogRef.current?.focus();
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected && opener !== document.body) {
        opener.focus();
      } else {
        document.querySelector<HTMLElement>("main")?.focus();
      }
    };
  }, [opener]);

  const hasPrev = index > 0;
  const hasNext = index < urls.length - 1;
  const show = (next: number) => setIndex(Math.min(Math.max(next, 0), urls.length - 1));

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Tab") {
      trapFocus(event, dialogRef.current);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      show(index - 1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      show(index + 1);
    } else if (event.key === "Escape" && !event.defaultPrevented) {
      event.preventDefault();
      onClose();
    }
  }

  function handleTouchEnd(event: TouchEvent<HTMLDivElement>) {
    const startX = touchStartX.current;
    touchStartX.current = null;
    if (startX === null) return;
    const deltaX = event.changedTouches[0].clientX - startX;
    if (deltaX <= -SWIPE_THRESHOLD_PX) show(index + 1);
    else if (deltaX >= SWIPE_THRESHOLD_PX) show(index - 1);
  }

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={`${name} — galeria`}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      onClick={onClose}
      onTouchStart={(e) => (touchStartX.current = e.touches[0].clientX)}
      onTouchEnd={handleTouchEnd}
      className="fixed inset-0 z-70 flex flex-col bg-ink text-on-ink outline-none"
    >
      <div className="flex items-center justify-between px-4 pt-4" onClick={(e) => e.stopPropagation()}>
        <span aria-live="polite" className="text-sm font-bold tabular-nums">
          {`${index + 1} / ${urls.length}`}
        </span>
        <button type="button" onClick={onClose} aria-label="Zamknij galerię" className={CONTROL}>
          <X size={22} aria-hidden="true" />
        </button>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 py-4">
        <span onClick={(e) => e.stopPropagation()} className="flex max-h-full max-w-full">
          <SafeImage
            key={urls[index]}
            src={urls[index]}
            alt={`${name} — zdjęcie ${index + 1} z ${urls.length}`}
            className="max-h-[calc(100dvh-7rem)] max-w-full"
            fit="contain"
            placeholderSize={64}
          />
        </span>
      </div>

      {urls.length >= 2 && (
        <div className="flex justify-center gap-6 pb-6" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={() => show(index - 1)}
            aria-disabled={!hasPrev}
            aria-label="Poprzednie zdjęcie"
            className={CONTROL}
          >
            <ChevronLeft size={24} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => show(index + 1)}
            aria-disabled={!hasNext}
            aria-label="Następne zdjęcie"
            className={CONTROL}
          >
            <ChevronRight size={24} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}
