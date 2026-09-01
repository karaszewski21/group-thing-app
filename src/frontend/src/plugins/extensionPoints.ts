export const MENU_MAIN = "menu.main" as const;
export const PRODUCT_DETAIL_TABS = "product.detail.tabs" as const;
export const PRODUCT_LIST_FILTERS = "product.list.filters" as const;
export const PRODUCT_DETAIL_INFO = "product.detail.info" as const;

export type ExtensionPointType =
  | typeof MENU_MAIN
  | typeof PRODUCT_DETAIL_TABS
  | typeof PRODUCT_LIST_FILTERS
  | typeof PRODUCT_DETAIL_INFO;
