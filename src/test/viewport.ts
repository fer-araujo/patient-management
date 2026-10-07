import { vi } from "vitest";
import { PHONE_MEDIA_QUERY } from "../components/ui/useIsPhone";

export type Orientation = "portrait" | "landscape";

/** iPhone 16 Pro Max, in CSS px. */
const SIZES: Record<Orientation, { width: number; height: number }> = {
  portrait: { width: 440, height: 956 },
  landscape: { width: 956, height: 440 },
};

/**
 * Makes `window.matchMedia` answer like an iPhone 16 Pro Max (touch only).
 * In portrait (440 x 956 CSS px) the phone breakpoint and the coarse pointer
 * match; in landscape (956 x 440) only the coarse pointer does, so the page
 * gets the tablet layout. jsdom lays nothing out, so this only drives the
 * code paths that read media queries (e.g. DataGrid cards).
 *
 * `rotate` switches orientation and fires `change` on every list that asked,
 * like a real rotation. Call it inside `act()`.
 */
export const mockPhoneViewport = (initial: Orientation = "portrait") => {
  let orientation = initial;
  const listeners = new Map<string, Set<(event: MediaQueryListEvent) => void>>();

  const matches = (query: string) =>
    query === "(pointer: coarse)" ||
    (query === PHONE_MEDIA_QUERY && orientation === "portrait");

  vi.spyOn(window, "innerWidth", "get").mockImplementation(
    () => SIZES[orientation].width,
  );
  vi.spyOn(window, "innerHeight", "get").mockImplementation(
    () => SIZES[orientation].height,
  );
  vi.spyOn(window, "matchMedia").mockImplementation((query: string) => {
    const set = listeners.get(query) ?? new Set();
    listeners.set(query, set);
    const add = (listener: (event: MediaQueryListEvent) => void) =>
      set.add(listener);
    const remove = (listener: (event: MediaQueryListEvent) => void) =>
      set.delete(listener);
    return {
      get matches() {
        return matches(query);
      },
      media: query,
      onchange: null,
      addListener: add,
      removeListener: remove,
      addEventListener: (_type: string, listener: EventListener) =>
        add(listener as (event: MediaQueryListEvent) => void),
      removeEventListener: (_type: string, listener: EventListener) =>
        remove(listener as (event: MediaQueryListEvent) => void),
      dispatchEvent: () => false,
    } as unknown as MediaQueryList;
  });

  return {
    rotate: (to: Orientation) => {
      orientation = to;
      for (const [query, set] of listeners) {
        const event = { matches: matches(query), media: query };
        for (const listener of [...set]) {
          listener(event as MediaQueryListEvent);
        }
      }
    },
  };
};
