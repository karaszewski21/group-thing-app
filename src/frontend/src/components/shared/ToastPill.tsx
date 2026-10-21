/** The floating status pill for `useToast`'s message; renders nothing when empty. */
export function ToastPill({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div
      className="fixed bottom-[90px] left-1/2 z-[120] -translate-x-1/2 rounded-full bg-ink px-5 py-[11px] text-sm font-semibold text-on-ink shadow-[0_14px_30px_-14px_rgba(30,46,39,.9)]"
      role="status"
    >
      {message}
    </div>
  );
}
