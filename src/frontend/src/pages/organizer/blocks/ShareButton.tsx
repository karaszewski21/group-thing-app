import { ArrowUpRight } from "lucide-react";
import { useToast } from "../../krag/hooks/useToast";

interface ShareButtonProps {
  slug: string;
  name: string;
  label: string;
  className: string;
  /** Shows only the icon; `label` stays the accessible name and tooltip. */
  iconOnly?: boolean;
}

/** Shares the public page address. The URL is built from the origin and slug,
 * never from `location.href`, so the owner's `?edit=1` never leaks. */
export function ShareButton({ slug, name, label, className, iconOnly = false }: ShareButtonProps) {
  const { toast, showToast } = useToast();

  async function share() {
    const url = `${window.location.origin}/${slug}`;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: name, url });
        return;
      } catch (err) {
        // The user closed the share sheet; any other failure falls back to the clipboard.
        if (err instanceof DOMException && err.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      showToast("Skopiowano link");
    } catch {
      showToast("Nie udało się skopiować linku");
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void share()}
        className={className}
        aria-label={iconOnly ? label : undefined}
        title={iconOnly ? label : undefined}
      >
        <ArrowUpRight aria-hidden="true" className={iconOnly ? "h-5 w-5" : "h-4 w-4"} />
        {!iconOnly && label}
      </button>
      <div role="status" className="fixed bottom-[90px] left-1/2 z-[120] -translate-x-1/2">
        {toast && (
          <span className="block rounded-full bg-ink px-5 py-[11px] text-sm font-semibold text-on-ink shadow-[0_14px_30px_-14px_var(--color-scrim)]">
            {toast}
          </span>
        )}
      </div>
    </>
  );
}
