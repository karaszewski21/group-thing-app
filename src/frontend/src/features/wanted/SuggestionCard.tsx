import { Fragment } from "react";
import type { WantSuggestionResponse } from "../../api/wants";
import { ItemCard } from "../../components/shared/ItemCard";
import { reservedCaption } from "./reservedCaption";

/** An item missing one word of the want's name: the MatchCard tile with a
 * dashed border and the missing words, never marked "nowe". `onOpen` reports
 * an opened tile, as on MatchCard. */
export function SuggestionCard({ suggestion, onOpen }: { suggestion: WantSuggestionResponse; onOpen: () => void }) {
  return (
    <li>
      <ItemCard
        href={suggestion.href}
        name={suggestion.title}
        condition={suggestion.meta.condition}
        thumbUrl={suggestion.meta.thumb_url}
        mode={suggestion.meta.mode}
        reservation={null}
        reservedCaption={reservedCaption(suggestion)}
        onOpen={onOpen}
        dashed
        footnote={
          <>
            brakuje:{" "}
            {suggestion.missing_words.map((word, index) => (
              <Fragment key={`${index}-${word}`}>
                {index > 0 && ", "}
                <b className="font-bold text-ink">„{word}”</b>
              </Fragment>
            ))}
          </>
        }
      />
    </li>
  );
}
