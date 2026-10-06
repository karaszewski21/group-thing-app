/** One page of an admin list endpoint (`?page=&size=`): `items` out of
 * `total` matching rows. Pages are 1-based. */
export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  size: number;
}

export const PAGE_SIZE = 20;

/** `page=&size=` query-string pairs for `URLSearchParams`. */
export function pageParams(page: number, size = PAGE_SIZE): [string, string][] {
  return [
    ["page", String(page)],
    ["size", String(size)],
  ];
}
