/** The "Co dodajesz?" layout shared by the tiles and their loading skeleton:
 * a column on a phone, then the item tile over 2/3 of a two-row grid. The row
 * and tile heights follow the screen height, so the "Szukam rzeczy" row fits
 * above the bottom bar. */
export const ADD_PAGE = "@container mx-auto w-full max-w-240";
export const ADD_GRID =
  "flex flex-col gap-3.5 @2xl:grid @2xl:grid-cols-3 @2xl:grid-rows-[repeat(2,clamp(8rem,calc((100svh_-_28.25rem)/2),11.25rem))] @2xl:gap-4";
export const PRODUCT_TILE_BOX =
  "min-h-[clamp(12rem,calc(100svh_-_34rem),18rem)] rounded-[28px] @2xl:col-span-2 @2xl:row-span-2 @2xl:min-h-0 @2xl:rounded-4xl";
export const GROUP_TILES = "grid grid-cols-2 gap-2.5 @2xl:contents";
export const GROUP_TILE_BOX = "rounded-[22px] @2xl:rounded-[26px]";
export const WANTED_ROW_BOX = "mt-3.5 min-h-16 rounded-[20px] @2xl:mt-4 @2xl:min-h-18 @2xl:rounded-[22px]";
