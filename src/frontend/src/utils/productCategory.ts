import type { ProductCategory } from "../api/products";

export const PRODUCT_CATEGORIES: ProductCategory[] = ["TOY", "BOOK", "GAME", "CLOTHING", "OTHER"];

export const CATEGORY_LABELS: Record<ProductCategory, string> = {
  TOY: "Toy",
  BOOK: "Book",
  GAME: "Game",
  CLOTHING: "Clothing",
  OTHER: "Other",
};

export const CATEGORY_COLORS: Record<ProductCategory, string> = {
  TOY: "#059669",
  BOOK: "#2563EB",
  GAME: "#D97706",
  CLOTHING: "#7C3AED",
  OTHER: "#334155",
};
