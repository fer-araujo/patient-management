/**
 * Shared classes for row action buttons on touch screens (iPad, iPhone).
 *
 * Mouse users keep the compact icon buttons and their hover tooltips
 * (`title`). A finger has no hover, so on coarse pointers the buttons grow to
 * 44 px and the destructive or easily confused ones also show their name.
 *
 * On phones (below 768 px, `max-md:`) the rows become DataGrid cards with room
 * for words, so every action button shows its name there, whatever the pointer.
 */

/** Icon-only button: at least 44 x 44 px on touch. */
export const TOUCH_ICON_BUTTON = "pointer-coarse:w-11 pointer-coarse:h-11";

/** Icon button that shows a short text label on touch and on phones. */
export const TOUCH_LABELED_BUTTON =
  "pointer-coarse:w-auto pointer-coarse:h-11 pointer-coarse:px-3 pointer-coarse:gap-1.5 max-md:w-auto max-md:h-11 max-md:px-3 max-md:gap-1.5";

/** The text label itself: hidden for mouse users, shown on touch and phones. */
export const TOUCH_ONLY_LABEL =
  "hidden pointer-coarse:inline max-md:inline text-sm font-bold whitespace-nowrap";

/**
 * Icon button that stays icon-only on iPad and desktop but shows its label on
 * phones (combine with `TOUCH_ICON_BUTTON` for the 44 px touch size).
 */
// `!` because `TOUCH_ICON_BUTTON`'s `pointer-coarse:w-11` also matches there.
export const PHONE_LABELED_BUTTON =
  "max-md:w-auto! max-md:h-11 max-md:px-3 max-md:gap-1.5";

/** The label for `PHONE_LABELED_BUTTON`: only rendered visible below 768 px. */
export const PHONE_ONLY_LABEL =
  "hidden max-md:inline text-sm font-bold whitespace-nowrap";
