interface ItemLoadStatesProps {
  notFound: boolean;
  error: string | null;
  loading: boolean;
  /** Retry button in the error state; omitted where no read can fail. */
  onRetry?: () => void;
}

/** The heading and the states before content: notFound → error → loading. */
export function ItemLoadStates(props: ItemLoadStatesProps) {
  return (
    <>
      <h2 className="text-[19px] font-semibold text-ink">Rzecz</h2>
      <ItemLoadStateBody {...props} />
    </>
  );
}

function ItemLoadStateBody({ notFound, error, loading, onRetry }: ItemLoadStatesProps) {
  if (notFound) {
    return <p className="mt-3 text-[12.5px] text-ink-soft">Nie znaleziono tej rzeczy.</p>;
  }
  if (error) {
    return (
      <div className="mt-3">
        <p className="text-[12.5px] font-semibold text-danger">
          Nie udało się wczytać rzeczy — spróbuj ponownie
        </p>
        <p className="mt-0.5 text-[11.5px] text-ink-soft">{error}</p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-3 rounded-xl border border-line bg-paper px-4 py-2 text-[13px] font-semibold text-ink transition-colors hover:bg-cream"
          >
            Spróbuj ponownie
          </button>
        )}
      </div>
    );
  }
  if (loading) {
    return (
      <>
        <div className="mt-3 aspect-[4/3] w-full animate-pulse rounded-[22px] bg-line" aria-hidden="true" />
        <p className="mt-3 text-[12.5px] text-ink-soft">Wczytywanie rzeczy…</p>
      </>
    );
  }
  return null;
}
