/** "A pending action was resolved" signal from the app-wide host, so pages
 * holding their own copy of the affected data (the panel) can reload it. */
const listeners = new Set<() => void>();

export function subscribePendingActionResolved(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitPendingActionResolved() {
  listeners.forEach((listener) => listener());
}
