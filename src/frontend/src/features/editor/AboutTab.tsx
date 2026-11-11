import { SECTION_LABEL } from "./ColorsTab";

const MAX_ABOUT_LENGTH = 1000;

interface AboutTabProps {
  /** The section's name on the page, e.g. "O nas" or "O mnie". */
  label: string;
  placeholder: string;
  value: string;
  onChange: (about: string) => void;
}

/** The page's description, shown in its "O nas" / "O mnie" section. */
export function AboutTab({ label, placeholder, value, onChange }: AboutTabProps) {
  return (
    <div className="flex flex-col gap-1.5 font-sans">
      <label htmlFor="editor-description" className={SECTION_LABEL}>
        {label}
      </label>
      <textarea
        id="editor-description"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        maxLength={MAX_ABOUT_LENGTH}
        rows={6}
        placeholder={placeholder}
        aria-describedby="editor-description-count"
        className="w-full resize-y rounded-xl border-[1.5px] border-line bg-paper px-3 py-2.5 text-sm text-ink outline-none focus-visible:border-focus-ring disabled:opacity-50"
      />
      <p id="editor-description-count" className="text-right text-[12px] text-ink-soft">
        {value.length}/{MAX_ABOUT_LENGTH}
      </p>
    </div>
  );
}
