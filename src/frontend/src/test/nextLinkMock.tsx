/* `next/link` for Vitest (vitest.config.ts aliases it here): a plain anchor
 * whose plain left click goes through the mocked router. */
import type { AnchorHTMLAttributes, MouseEvent, Ref } from "react";
import { useRouter } from "./navigationMock";

interface MockLinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  href: string;
  replace?: boolean;
  scroll?: boolean;
  ref?: Ref<HTMLAnchorElement>;
}

function isPlainClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  const target = event.currentTarget.getAttribute("target");
  return (
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey &&
    (!target || target === "_self")
  );
}

export default function Link({ href, replace = false, scroll = true, onClick, ...anchorProps }: MockLinkProps) {
  const router = useRouter();
  return (
    <a
      {...anchorProps}
      href={href}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || !isPlainClick(event)) return;
        event.preventDefault();
        if (replace) router.replace(href, { scroll });
        else router.push(href, { scroll });
      }}
    />
  );
}
