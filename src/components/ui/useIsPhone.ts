import { useSyncExternalStore } from "react";

/**
 * Same breakpoint as Tailwind's `max-md:` variant (below 768 px): phones in
 * portrait only. A phone in landscape is wider than 768 px (e.g. 932 px on an
 * iPhone Pro Max), so it gets the tablet layout; Modal's max-height rule
 * keeps short landscape screens usable. iPad and desktop never match it.
 */
export const PHONE_MEDIA_QUERY = "(max-width: 767.98px)";

const getMediaQueryList = () =>
  typeof window === "undefined" || typeof window.matchMedia !== "function"
    ? null
    : window.matchMedia(PHONE_MEDIA_QUERY);

const subscribe = (onChange: () => void) => {
  const list = getMediaQueryList();
  if (!list) return () => {};
  // Safari before 14 only has the deprecated addListener.
  if (typeof list.addEventListener === "function") {
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }
  list.addListener?.(onChange);
  return () => list.removeListener?.(onChange);
};

const getSnapshot = () => getMediaQueryList()?.matches ?? false;
const getServerSnapshot = () => false;

/**
 * True below 768 px (portrait phones). For layouts that cannot be done with CSS alone (e.g. a
 * table that becomes a list of cards, or a different default view); purely
 * visual tweaks should stay as `max-md:` classes.
 */
export const useIsPhone = () =>
  useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
