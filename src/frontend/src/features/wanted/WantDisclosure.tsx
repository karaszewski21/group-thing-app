import { useId, type ReactNode } from "react";
import { FOCUS_CLASS } from "../../components/shared/chipStyles";

/** „Doprecyzuj (opcjonalnie)”: the want form's optional filters behind a
 * disclosure button. The host owns `open`; the fields are mounted only while
 * it is open. */
export function WantDisclosure({
  open,
  onToggle,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const panelId = useId();
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
        className={`flex min-h-12 w-full items-center justify-between rounded-2xl border-[1.5px] border-line bg-paper px-4 text-left text-[15px] font-extrabold text-ink ${FOCUS_CLASS}`}
      >
        <span>
          Doprecyzuj <span className="text-[13px] font-normal text-ink-soft">(opcjonalnie)</span>
        </span>
        <span aria-hidden="true">{open ? "▾" : "▸"}</span>
      </button>
      <div
        id={panelId}
        hidden={!open}
        className="mt-2 flex flex-col gap-3.5 rounded-[18px] border-[1.5px] border-line bg-paper p-3.5"
      >
        {open && children}
      </div>
    </>
  );
}
