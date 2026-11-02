import { SECTION_LABEL } from "./ColorsTab";

const MAX_DESCRIPTION_LENGTH = 1000;

interface AboutTabProps {
  value: string;
  onChange: (description: string) => void;
}

/** The organization's description, shown in the page's "O nas" section. */
export function AboutTab({ value, onChange }: AboutTabProps) {
  return (
    <div className="flex flex-col gap-1.5 font-sans">
      <label htmlFor="editor-description" className={SECTION_LABEL}>
        O nas
      </label>
      <textarea
        id="editor-description"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        maxLength={MAX_DESCRIPTION_LENGTH}
        rows={6}
        placeholder="Kim jesteście, dla kogo są zajęcia, czego można się spodziewać?"
        aria-describedby="editor-description-count"
        className="w-full resize-y rounded-xl border-[1.5px] border-line bg-paper px-3 py-2.5 text-sm text-ink outline-none focus-visible:border-focus-ring disabled:opacity-50"
      />
      <p id="editor-description-count" className="text-right text-[12px] text-ink-soft">
        {value.length}/{MAX_DESCRIPTION_LENGTH}
      </p>
    </div>
  );
}
