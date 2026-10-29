export function DescriptionText({ description }: { description: string | null }) {
  return description ? (
    <p className="mt-1.5 whitespace-pre-line break-words text-[13.5px] text-ink">{description}</p>
  ) : (
    <p className="mt-1.5 text-[13.5px] italic text-ink-soft">Właściciel nie dodał opisu.</p>
  );
}
