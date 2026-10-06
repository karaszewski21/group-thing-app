import { PAGE_SIZE, type Page } from "../api/pagination";

/** A paged-endpoint response holding `items`, for API mocks. */
export function pageOf<T>(items: T[], total = items.length, page = 1): Page<T> {
  return { items, total, page, size: PAGE_SIZE };
}
