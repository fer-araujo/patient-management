/** Same look as the compact inputs of the catalog and charge modals. */
export const supplyQuantityClasses =
  "w-20 px-3 py-2.5 border-2 border-brand-light rounded-lg text-sm text-brand-dark bg-white focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20 outline-none transition-all";

/**
 * DOM id of a supply row's quantity input, so picking an item that is
 * already listed can focus that row instead of adding it twice.
 * `listId` is the id of the list's title, unique per modal.
 */
export const supplyQuantityInputId = (listId: string, itemId: string) =>
  `${listId}-qty-${itemId}`;
