import { useState } from "react";
import type { ExchangeMode } from "../../api/groups";
import type { Locality } from "../../api/locations";
import type { WantCreateRequest, WantResponse, WantUpdateRequest } from "../../api/wants";
import { CategoryTreePicker } from "../../components/shared/CategoryTreePicker";
import { FOCUS_CLASS } from "../../components/shared/chipStyles";
import { LocalityCombobox } from "../../components/shared/LocalityCombobox";
import { RadiusChips } from "../../components/shared/RadiusChips";
import { useLocality } from "../../hooks/useLocality";
import { useWants, WantWriteError } from "../../hooks/useWants";
import { Link, Navigate, useAppNavigate, useAppParams, useAppSearchParams } from "../../routing/navigation";
import { viewPath, wantPath } from "../../routing/paths";
import { OfferModeChips } from "./OfferModeChips";
import { WantDisclosure } from "./WantDisclosure";
import {
  NAME_MAX,
  NAME_MIN,
  NOTE_MAX,
  initialFromPrefill,
  initialFromWant,
  resolveWantFormView,
  searchBackPath,
  textLength,
} from "./wantFormViewState";
import { WantNotFound } from "./WantNotFound";

const NAME_ID = "want-name";
const NAME_COUNT_ID = "want-name-count";
const NAME_ERROR_ID = "want-name-error";
const NAME_HINT_ID = "want-missing";
const NOTE_ID = "want-note";
const NOTE_HINT_ID = "want-note-hint";
const NOTE_ERROR_ID = "want-note-error";
const CATEGORY_LABEL_ID = "want-category-label";
const MODE_LABEL_ID = "want-mode-label";
const TITLE_ID = "want-form-title";

const ANY_CATEGORY = "Dowolna kategoria";
const NAME_ERROR = `Nazwa musi mieć od ${NAME_MIN} do ${NAME_MAX} znaków.`;
const NAME_HINT = `Wpisz, czego szukasz (${NAME_MIN}–${NAME_MAX} znaków).`;
const NOTE_ERROR = `Notatka może mieć najwyżej ${NOTE_MAX} znaków.`;

const LABEL_CLASS = "text-sm font-bold text-ink";
const HINT_CLASS = "text-xs text-ink-soft";
const ERROR_CLASS = "text-[13px] font-bold text-danger";
const INPUT_CLASS = `w-full rounded-2xl border-[1.5px] border-line bg-paper px-4 text-base text-ink placeholder:text-ink-soft aria-[invalid=true]:border-danger ${FOCUS_CLASS}`;
const BACK_CLASS = `self-start rounded-md text-sm font-bold text-primary-fg ${FOCUS_CLASS}`;
const ACTION_CLASS = `flex min-h-12 w-full items-center justify-center rounded-full px-5 text-[15px] font-extrabold ${FOCUS_CLASS}`;
const TITLE_CLASS = "font-serif text-[26px] leading-tight font-extrabold tracking-tight text-ink";

/** `/add/wanted` (create, optionally prefilled from the query string) and
 * `/wanted/:id/edit` (the route param `id`): one form for a want. A saved
 * want replaces the form with its match list. */
export function WantFormView() {
  const { id: wantId = null } = useAppParams();
  const { data: wants, loading, error, refetch, create, update } = useWants();
  const view = resolveWantFormView({ wantId, wants, loading, error });

  switch (view.kind) {
    case "loading":
      return <p className="text-sm text-ink-soft">Ładowanie poszukiwania…</p>;
    case "error":
      return (
        <div className="flex flex-col items-start gap-3">
          <p role="alert" className="rounded-2xl bg-danger-soft px-3 py-2.5 text-sm font-bold text-danger">
            {view.message}
          </p>
          <button
            type="button"
            onClick={() => void refetch()}
            className={`${ACTION_CLASS} w-auto border-[1.5px] border-line bg-paper text-ink`}
          >
            Spróbuj ponownie
          </button>
        </div>
      );
    case "notFound":
      return <WantNotFound />;
    case "redirect":
      return <Navigate to={view.to} replace />;
    case "ready":
      return <WantForm key={view.want?.id ?? "new"} want={view.want} create={create} update={update} />;
  }
}

function WantForm({
  want,
  create,
  update,
}: {
  want: WantResponse | null;
  create: (request: WantCreateRequest) => Promise<WantResponse>;
  update: (id: string, request: WantUpdateRequest) => Promise<WantResponse>;
}) {
  const navigate = useAppNavigate();
  const [params] = useAppSearchParams();
  const [initial] = useState(() => (want ? initialFromWant(want) : initialFromPrefill(params)));
  const [name, setName] = useState(initial.name);
  // A name the form opened with is judged at once; a typed one after leaving the field.
  const [nameTouched, setNameTouched] = useState(initial.name !== "");
  const [note, setNote] = useState(initial.note);
  const [categoryId, setCategoryId] = useState(initial.categoryId);
  const [offerMode, setOfferMode] = useState<ExchangeMode | null>(initial.offerMode);
  // `undefined` until the user picks or clears: the locality the form opened with applies.
  const [pickedLocality, setPickedLocality] = useState<Locality | null | undefined>(undefined);
  const [radius, setRadius] = useState(initial.radius);
  const [refining, setRefining] = useState(initial.refined);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  // A create refused with 409 is the active-wants cap: the error offers the way to the list.
  const [capReached, setCapReached] = useState(false);

  const openedLocality = useLocality(pickedLocality === undefined ? initial.localityId : null).data;
  const locality = pickedLocality === undefined ? openedLocality : pickedLocality;
  // The locality the form opened with is kept even before (or without) its details loading.
  const localityId = locality?.id ?? (pickedLocality === undefined ? initial.localityId : null);

  const nameLength = textLength(name);
  const noteLength = textLength(note);
  const nameInvalid = nameLength < NAME_MIN || nameLength > NAME_MAX;
  const showNameError = nameInvalid && nameLength > 0 && (nameTouched || nameLength > NAME_MAX);
  const showNameHint = nameInvalid && !showNameError;
  const noteInvalid = noteLength > NOTE_MAX;
  const blocked = nameInvalid || noteInvalid;
  const blockedBy = [
    showNameHint && NAME_HINT_ID,
    showNameError && NAME_ERROR_ID,
    noteInvalid && refining && NOTE_ERROR_ID,
  ].filter(Boolean);

  const back = want
    ? { to: wantPath(want.id), label: want.name }
    : initial.fromSearch
      ? { to: searchBackPath(initial), label: "Szukaj" }
      : { to: viewPath("add"), label: "Dodaj" };

  function changeLocality(next: Locality | null) {
    setPickedLocality(next);
    setRadius(null);
  }

  async function submit() {
    if (busy) return;
    if (blocked) {
      setNameTouched(true);
      if (noteInvalid) setRefining(true);
      return;
    }
    setBusy(true);
    setServerError(null);
    const request = {
      name: name.trim(),
      note: note.trim() || null,
      category_id: categoryId,
      offer_mode: offerMode,
      locality_id: localityId,
      radius_km: localityId ? radius : null,
    };
    try {
      const saved = want ? await update(want.id, request) : await create(request);
      navigate(wantPath(saved.id), { replace: true });
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Nie udało się zapisać poszukiwania.");
      setCapReached(!want && err instanceof WantWriteError && err.status === 409);
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby={TITLE_ID} className="flex flex-col">
      <Link to={back.to} className={`${BACK_CLASS} max-w-full truncate`}>
        ‹ {back.label}
      </Link>
      <h1 id={TITLE_ID} className={`${TITLE_CLASS} mt-3.5`}>
        {want ? "Edytuj poszukiwanie" : "Szukam rzeczy"}
      </h1>
      {!want && (
        <p className="mt-2 text-[15px] leading-snug text-ink-soft">
          Napisz, czego szukasz — damy znać, gdy ktoś doda pasującą rzecz.
        </p>
      )}
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        className="mt-3.5 flex flex-col gap-3.5"
      >
        {serverError && (
          <p role="alert" className="rounded-2xl bg-danger-soft px-3 py-2.5 text-sm font-bold text-danger">
            {serverError}
            {capReached && (
              <>
                {" "}
                <Link to={viewPath("wanted")} className={`rounded-sm underline ${FOCUS_CLASS}`}>
                  Zobacz listę
                </Link>
              </>
            )}
          </p>
        )}

        <div className="flex flex-col gap-1.5">
          <label htmlFor={NAME_ID} className={LABEL_CLASS}>
            Czego szukasz?
          </label>
          <input
            id={NAME_ID}
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onBlur={() => setNameTouched(true)}
            placeholder="Np. kask rowerowy dla dziecka"
            autoComplete="off"
            aria-required="true"
            aria-invalid={showNameError || undefined}
            aria-describedby={showNameError ? `${NAME_ERROR_ID} ${NAME_COUNT_ID}` : NAME_COUNT_ID}
            className={`${INPUT_CLASS} min-h-12`}
          />
          {showNameError && (
            <p id={NAME_ERROR_ID} role="alert" className={ERROR_CLASS}>
              {NAME_ERROR}
            </p>
          )}
          <p id={NAME_COUNT_ID} className={HINT_CLASS}>
            {nameLength}/{NAME_MAX} znaków
          </p>
        </div>

        <div>
          <WantDisclosure open={refining} onToggle={() => setRefining((open) => !open)}>
            <div className="flex flex-col gap-1.5">
              <span id={CATEGORY_LABEL_ID} className={LABEL_CLASS}>
                Kategoria
              </span>
              <CategoryTreePicker
                labelledBy={CATEGORY_LABEL_ID}
                value={categoryId}
                onChange={setCategoryId}
                mode="any"
                allowRoot
                clearLabel={ANY_CATEGORY}
                placeholder={ANY_CATEGORY}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <span id={MODE_LABEL_ID} className={LABEL_CLASS}>
                Jak chcesz dostać rzecz?
              </span>
              <OfferModeChips value={offerMode} onChange={setOfferMode} labelledBy={MODE_LABEL_ID} />
            </div>
            <div className="flex flex-col gap-2">
              <LocalityCombobox
                idPrefix="want"
                value={locality}
                onChange={changeLocality}
                required={false}
                placeholder="Cała Polska — wpisz, aby zawęzić"
                labelClassName={LABEL_CLASS}
              />
              {locality && <RadiusChips value={radius} onChange={setRadius} />}
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={NOTE_ID} className={LABEL_CLASS}>
                Notatka dla siebie
              </label>
              <textarea
                id={NOTE_ID}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Rozmiar, kolor, do kiedy potrzebujesz"
                rows={3}
                aria-invalid={noteInvalid || undefined}
                aria-describedby={noteInvalid ? `${NOTE_ERROR_ID} ${NOTE_HINT_ID}` : NOTE_HINT_ID}
                className={`${INPUT_CLASS} py-3`}
              />
              {noteInvalid && (
                <p id={NOTE_ERROR_ID} role="alert" className={ERROR_CLASS}>
                  {NOTE_ERROR}
                </p>
              )}
              <p id={NOTE_HINT_ID} className={HINT_CLASS}>
                Widzisz ją tylko Ty. {noteLength}/{NOTE_MAX} znaków
              </p>
            </div>
          </WantDisclosure>
        </div>

        <div className="flex flex-col gap-2.5">
          {want && (
            <p className={HINT_CLASS}>Zmiana nazwy, kategorii, sposobu lub miejsca wyszuka dopasowania od nowa.</p>
          )}
          {showNameHint && (
            <p id={NAME_HINT_ID} className={HINT_CLASS}>
              {NAME_HINT}
            </p>
          )}
          {/* Blocked by input it stays focusable, so the reason reaches keyboard and
              screen-reader users; only a running save disables it. */}
          <button
            type="submit"
            disabled={busy}
            aria-disabled={!busy && blocked ? true : undefined}
            aria-describedby={blockedBy.length > 0 ? blockedBy.join(" ") : undefined}
            className={`${ACTION_CLASS} bg-primary text-on-primary disabled:opacity-60 aria-disabled:cursor-not-allowed aria-disabled:opacity-55`}
          >
            {want ? "Zapisz zmiany" : "Zapisz poszukiwanie"}
          </button>
          {want && (
            <Link to={wantPath(want.id)} className={`${ACTION_CLASS} border-[1.5px] border-line bg-paper text-ink`}>
              Anuluj
            </Link>
          )}
        </div>
      </form>
    </section>
  );
}
