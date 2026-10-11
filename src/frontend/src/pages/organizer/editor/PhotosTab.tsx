import { ChevronDown, ChevronUp } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { MediaKind, OwnerMedia } from "../../../api/organizations";
import { familyInitials } from "../../../components/shared/Avatar";
import { useMyOrganization } from "../../../hooks/useMyOrganization";
import { useOrganizationMedia } from "../../../hooks/useOrganizationMedia";
import { TrashIcon } from "../../panel/panelIcons";
import { SafeImage } from "../../product/ItemGallery";
import { ModerationBadge, PhotoFileField, type ModerationLabels } from "../../product/ItemGalleryEditor";
import { photoFileError } from "../../product/itemPageShared";
import { SECTION_LABEL } from "./ColorsTab";

const MAX_ORGANIZATION_GALLERY = 3;
const NO_MEDIA: OwnerMedia[] = [];

const MEDIA_LABELS: ModerationLabels = {
  PENDING: "W weryfikacji",
  NEEDS_REVIEW: "W weryfikacji",
  REJECTED: "Odrzucone",
};

const REJECTED_NOTE = "Odrzucone przez moderację — dodaj inne zdjęcie.";
const HINT = "text-[12px] text-ink-soft";
const PICKER = "min-h-11";
const TEXT_BUTTON =
  "mt-2 inline-flex min-h-11 items-center rounded-[9px] border border-line px-3 text-[11.5px] font-extrabold text-ink-soft hover:text-ink disabled:opacity-40";
const ICON_BUTTON =
  "flex h-11 w-11 flex-none items-center justify-center rounded-[10px] text-ink-soft hover:bg-paper hover:text-ink disabled:opacity-40";

type SlotKind = Exclude<MediaKind, "GALLERY">;

const SLOT_COPY: Record<SlotKind, { title: string; empty: string; add: string; change: string }> = {
  LOGO: {
    title: "Logo",
    empty: "Brak logo — na stronie widać inicjały.",
    add: "+ Dodaj logo",
    change: "Zmień logo",
  },
  COVER: {
    title: "Okładka",
    empty: "Brak okładki — na stronie widać kolorowe tło.",
    add: "+ Dodaj okładkę",
    change: "Zmień okładkę",
  },
};

interface PhotosTabProps {
  organizationId: string;
}

/** Logo, cover and gallery. Every action saves at once, outside the draft. */
export function PhotosTab({ organizationId }: PhotosTabProps) {
  const { data } = useMyOrganization({ pollPendingMedia: true });
  const media = data?.media ?? NO_MEDIA;
  const actions = useOrganizationMedia(organizationId);
  const initials = familyInitials(data?.name ?? "");

  return (
    <div className="flex flex-col gap-5 font-sans">
      <p className={HINT}>Zdjęcia zapisują się od razu.</p>
      <PhotoSlot kind="LOGO" media={media} initials={initials} actions={actions} />
      <PhotoSlot
        kind="COVER"
        media={media}
        initials={initials}
        actions={actions}
        note={<p className={HINT}>Widoczna u góry strony w każdym układzie.</p>}
      />
      <GallerySection media={media} actions={actions} />
    </div>
  );
}

type MediaActions = ReturnType<typeof useOrganizationMedia>;

/** One section's busy flag and error line; `uploading` drives the shimmer row. */
function useSectionAction() {
  const [pending, setPending] = useState<"upload" | "other" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(kind: "upload" | "other", action: () => Promise<void>) {
    setError(null);
    setPending(kind);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(null);
    }
  }

  function upload(file: File, send: (file: File) => Promise<void>) {
    const invalid = photoFileError(file);
    if (invalid) {
      setError(invalid);
      return;
    }
    void run("upload", () => send(file));
  }

  return { busy: pending !== null, uploading: pending === "upload", error, run, upload };
}

function Section({
  title,
  busy,
  error,
  aside,
  children,
}: {
  title: string;
  busy: boolean;
  error: string | null;
  aside?: ReactNode;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} aria-busy={busy} className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <h3 id={headingId} className={SECTION_LABEL}>
          {title}
        </h3>
        {aside}
      </div>
      {children}
      {error && (
        <p role="alert" className="text-[12.5px] font-semibold text-danger">
          {error}
        </p>
      )}
    </section>
  );
}

function Shimmer({ className }: { className: string }) {
  return <span aria-hidden="true" className={`flex-none bg-line motion-safe:animate-pulse ${className}`} />;
}

interface PhotoSlotProps {
  kind: SlotKind;
  media: OwnerMedia[];
  initials: string;
  actions: MediaActions;
  note?: ReactNode;
}

/** Logo or cover: the live (APPROVED) row, the one awaiting moderation and
 * every REJECTED row newest first (mockup states S1-S7). */
function PhotoSlot({ kind, media, initials, actions, note }: PhotoSlotProps) {
  const copy = SLOT_COPY[kind];
  const { busy, uploading, error, run, upload } = useSectionAction();
  const pickerRef = useRef<HTMLInputElement>(null);
  const focusPicker = useRef(false);
  const rows = media.filter((m) => m.kind === kind);
  const approved = rows.find((m) => m.status === "APPROVED");
  const pending = rows.find((m) => m.status === "PENDING" || m.status === "NEEDS_REVIEW");
  const rejected = rows.filter((m) => m.status === "REJECTED").reverse();
  const thumbClass = kind === "LOGO" ? "h-12 w-12 rounded-full" : "aspect-video w-20 rounded-xl";

  useEffect(() => {
    if (busy || !focusPicker.current) return;
    focusPicker.current = false;
    pickerRef.current?.focus();
  }, [busy]);

  function remove(id: string) {
    void run("other", async () => {
      focusPicker.current = true;
      await actions.remove(id);
    });
  }

  function picker(label: string) {
    return (
      <PhotoFileField
        inputRef={pickerRef}
        label={label}
        multiple={false}
        disabled={busy}
        className={PICKER}
        onFiles={([file]) => upload(file, (f) => actions.upload(kind, f))}
      />
    );
  }

  function removeButton(id: string, label: string) {
    return (
      <button type="button" disabled={busy} onClick={() => remove(id)} className={`${TEXT_BUTTON} ml-2`}>
        {label}
      </button>
    );
  }

  function thumb(m: OwnerMedia, faded = false) {
    return (
      <SafeImage
        src={m.thumb_url}
        alt=""
        className={`flex-none ${thumbClass} ${faded ? "opacity-60" : ""}`}
        placeholderSize={20}
      />
    );
  }

  let content: ReactNode;
  if (uploading) {
    content = (
      <SlotRow thumb={<Shimmer className={thumbClass} />}>
        <p className="text-[12.5px] text-ink">Wysyłanie…</p>
        {picker(copy.add)}
      </SlotRow>
    );
  } else if (rows.length === 0) {
    content = (
      <SlotRow
        thumb={
          <span
            className={`flex flex-none items-center justify-center border-2 border-dashed border-line text-[12px] font-extrabold text-ink-soft ${thumbClass}`}
          >
            {kind === "LOGO" ? initials : null}
          </span>
        }
      >
        <p className={HINT}>{copy.empty}</p>
        {picker(copy.add)}
      </SlotRow>
    );
  } else {
    const alone = !pending && rejected.length === 0;
    content = (
      <>
        {approved && (
          <SlotRow thumb={thumb(approved)}>
            <p className="text-[12.5px] font-semibold text-ink">{alone ? "Na stronie" : "Na stronie teraz"}</p>
            {alone && picker(copy.change)}
            {removeButton(approved.id, alone ? "Usuń" : "Usuń ze strony")}
          </SlotRow>
        )}
        {approved && !alone && <hr className="border-line" />}
        {pending && (
          <SlotRow thumb={thumb(pending)}>
            <p className="flex items-center gap-2 text-[12.5px] font-semibold text-ink">
              {approved && "Nowe"}
              <ModerationBadge status={pending.status} labels={MEDIA_LABELS} />
            </p>
            <p className={HINT}>
              {approved ? "Zastąpi obecne po sprawdzeniu." : "Odwiedzający zobaczą je po sprawdzeniu."}
            </p>
            {picker(approved ? "Zmień" : copy.change)}
            {removeButton(pending.id, "Anuluj")}
          </SlotRow>
        )}
        {rejected.map((m, i) => (
          <SlotRow key={m.id} thumb={thumb(m, true)}>
            <ModerationBadge status={m.status} labels={MEDIA_LABELS} />
            <p className={HINT}>{REJECTED_NOTE}</p>
            {!pending && i === 0 && picker(copy.add)}
            {removeButton(m.id, "Usuń")}
          </SlotRow>
        ))}
      </>
    );
  }

  return (
    <Section title={copy.title} busy={busy} error={error}>
      {note}
      <div className="flex flex-col gap-2 rounded-2xl border border-line bg-cream p-2">{content}</div>
    </Section>
  );
}

function SlotRow({ thumb, children }: { thumb: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      {thumb}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** Up to three ordered photos (APPROVED and awaiting moderation keep their
 * place), then REJECTED ones below a divider (mockup states G1-G6). The row
 * markup follows `ItemGalleryEditor`, with 44px buttons. */
function GallerySection({ media, actions }: { media: OwnerMedia[]; actions: MediaActions }) {
  const { busy, uploading, error, run, upload } = useSectionAction();
  const focusAfterMove = useRef<{ id: string; dir: "up" | "down" } | null>(null);
  const moveButtons = useRef(new Map<string, HTMLButtonElement>());
  const pickerRef = useRef<HTMLInputElement>(null);
  const focusPicker = useRef(false);
  const rows = media.filter((m) => m.kind === "GALLERY");
  const ordered = rows.filter((m) => m.status !== "REJECTED");
  const rejected = rows.filter((m) => m.status === "REJECTED");
  const atLimit = ordered.length >= MAX_ORGANIZATION_GALLERY;

  useEffect(() => {
    if (busy) return;
    if (focusPicker.current) {
      focusPicker.current = false;
      pickerRef.current?.focus();
    }
    if (!focusAfterMove.current) return;
    const { id, dir } = focusAfterMove.current;
    const other = dir === "up" ? "down" : "up";
    const target = moveButtons.current.get(`${id}-${dir}`);
    const fallback = moveButtons.current.get(`${id}-${other}`);
    (target && !target.disabled ? target : fallback)?.focus();
    focusAfterMove.current = null;
  }, [busy, media]);

  function move(index: number, dir: "up" | "down") {
    const ids = ordered.map((m) => m.id);
    const swap = dir === "up" ? index - 1 : index + 1;
    [ids[index], ids[swap]] = [ids[swap], ids[index]];
    focusAfterMove.current = { id: ordered[index].id, dir };
    void run("other", () => actions.reorder(ids));
  }

  function remove(id: string) {
    void run("other", async () => {
      focusPicker.current = true;
      await actions.remove(id);
    });
  }

  function moveButtonRef(key: string) {
    return (el: HTMLButtonElement | null) => {
      if (el) moveButtons.current.set(key, el);
      else moveButtons.current.delete(key);
    };
  }

  return (
    <Section
      title="Galeria"
      busy={busy}
      error={error}
      aside={
        <span className="text-[12px] font-extrabold text-ink-soft">
          {ordered.length}/{MAX_ORGANIZATION_GALLERY}
        </span>
      }
    >
      {rows.length === 0 && !uploading && <p className={HINT}>Brak zdjęć.</p>}
      {(ordered.length > 0 || uploading) && (
        <ul className="space-y-2">
          {ordered.map((m, i) => {
            const n = i + 1;
            return (
              <li key={m.id} className="flex items-center gap-2 rounded-2xl border border-line bg-cream p-2">
                <SafeImage src={m.thumb_url} alt="" className="h-12 w-12 flex-none rounded-xl" placeholderSize={20} />
                <span className="flex min-w-0 flex-1 items-center gap-2 text-[12.5px] text-ink">
                  Zdjęcie {n}
                  <ModerationBadge status={m.status} labels={MEDIA_LABELS} />
                </span>
                <button
                  type="button"
                  ref={moveButtonRef(`${m.id}-up`)}
                  aria-label={`Przesuń zdjęcie ${n} w górę`}
                  disabled={busy || i === 0}
                  onClick={() => move(i, "up")}
                  className={ICON_BUTTON}
                >
                  <ChevronUp size={16} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  ref={moveButtonRef(`${m.id}-down`)}
                  aria-label={`Przesuń zdjęcie ${n} w dół`}
                  disabled={busy || i === ordered.length - 1}
                  onClick={() => move(i, "down")}
                  className={ICON_BUTTON}
                >
                  <ChevronDown size={16} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label={`Usuń zdjęcie ${n}`}
                  disabled={busy}
                  onClick={() => remove(m.id)}
                  className={`${ICON_BUTTON} hover:text-danger`}
                >
                  <TrashIcon />
                </button>
              </li>
            );
          })}
          {uploading && (
            <li className="flex items-center gap-2 rounded-2xl border border-line bg-cream p-2">
              <Shimmer className="h-12 w-12 rounded-xl" />
              <span className="text-[12.5px] text-ink">Wysyłanie…</span>
            </li>
          )}
        </ul>
      )}
      {rejected.length > 0 && (
        <>
          <hr className="border-line" />
          <ul className="space-y-2">
            {rejected.map((m) => (
              <li key={m.id} className="flex items-start gap-2 rounded-2xl border border-line bg-cream p-2">
                <SafeImage
                  src={m.thumb_url}
                  alt=""
                  className="h-12 w-12 flex-none rounded-xl opacity-60"
                  placeholderSize={20}
                />
                <span className="flex min-w-0 flex-1 flex-col items-start gap-1">
                  <ModerationBadge status={m.status} labels={MEDIA_LABELS} />
                  <span className={HINT}>{REJECTED_NOTE}</span>
                </span>
                <button
                  type="button"
                  aria-label="Usuń odrzucone zdjęcie"
                  disabled={busy}
                  onClick={() => remove(m.id)}
                  className={`${ICON_BUTTON} hover:text-danger`}
                >
                  <TrashIcon />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <div>
        <PhotoFileField
          inputRef={pickerRef}
          label="+ Dodaj zdjęcie"
          multiple={false}
          disabled={busy || atLimit}
          className={PICKER}
          onFiles={([file]) => upload(file, (f) => actions.upload("GALLERY", f))}
        />
        {atLimit && (
          <p className="mt-1.5 text-[12.5px] text-ink-soft">Osiągnięto limit {MAX_ORGANIZATION_GALLERY} zdjęć.</p>
        )}
        <p className="mt-1.5 text-[11.5px] text-ink-soft">JPG, PNG lub WebP, do 15 MB.</p>
        <p className="text-[11.5px] text-ink-soft">Odwiedzający zobaczą zdjęcia po sprawdzeniu.</p>
      </div>
    </Section>
  );
}
