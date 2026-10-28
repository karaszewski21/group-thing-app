import type { Category } from "../api/categories";

export const CATEGORY_PATH_SEPARATOR = " › ";

export interface CategoryIndex {
  byId: ReadonlyMap<string, Category>;
  /** Children of `parentId` (`null` for the roots), ordered by `sort_order`. */
  childrenOf: (parentId: string | null) => readonly Category[];
  /** `foldCategoryText(name)` per id, computed once so search does not re-fold per keystroke. */
  foldedNames: ReadonlyMap<string, string>;
}

export interface CategorySearchResult {
  category: Category;
  /** Ancestor names from the root down, excluding the category itself. */
  path: string[];
}

export interface CategorySearch {
  results: CategorySearchResult[];
  total: number;
}

const NO_CHILDREN: readonly Category[] = [];

export function buildCategoryIndex(categories: readonly Category[]): CategoryIndex {
  const byId = new Map<string, Category>();
  const children = new Map<string | null, Category[]>();
  const foldedNames = new Map<string, string>();
  for (const category of categories) {
    byId.set(category.id, category);
    foldedNames.set(category.id, foldCategoryText(category.name));
    const siblings = children.get(category.parent_id);
    if (siblings) siblings.push(category);
    else children.set(category.parent_id, [category]);
  }
  for (const siblings of children.values()) {
    siblings.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, "pl"));
  }
  return { byId, childrenOf: (parentId) => children.get(parentId) ?? NO_CHILDREN, foldedNames };
}

export function isLeaf(index: CategoryIndex, id: string): boolean {
  return index.childrenOf(id).length === 0;
}

/** Names from the root down to `id`, inclusive. */
export function categoryPathNames(index: CategoryIndex, id: string): string[] {
  const names: string[] = [];
  let current = index.byId.get(id);
  while (current) {
    names.unshift(current.name);
    current = current.parent_id === null ? undefined : index.byId.get(current.parent_id);
  }
  return names;
}

export function formatCategoryPath(index: CategoryIndex, id: string): string {
  return categoryPathNames(index, id).join(CATEGORY_PATH_SEPARATOR);
}

/** Lowercases and strips diacritics; `ł` has no NFD decomposition, so it is mapped by hand. */
export function foldCategoryText(text: string): string {
  return text
    .toLocaleLowerCase("pl")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/ł/g, "l");
}

/** Substring match on the folded name, in tree order. Returns every match; callers cap the list. */
export function searchCategories(index: CategoryIndex, query: string): CategorySearch {
  const needle = foldCategoryText(query.trim());
  const results: CategorySearchResult[] = [];
  if (needle === "") return { results, total: 0 };

  const visit = (parentId: string | null, path: string[]) => {
    for (const category of index.childrenOf(parentId)) {
      if (index.foldedNames.get(category.id)?.includes(needle)) {
        results.push({ category, path });
      }
      visit(category.id, [...path, category.name]);
    }
  };
  visit(null, []);
  return { results, total: results.length };
}
