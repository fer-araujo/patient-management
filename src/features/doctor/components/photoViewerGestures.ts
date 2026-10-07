/**
 * Pointer bookkeeping for the photo viewer: one pointer pans, two pinch-zoom.
 * Pure functions over an immutable state, so the gesture rules can be tested
 * without a DOM.
 */

export interface Point {
  x: number;
  y: number;
}

export interface GestureState {
  /** Pointers currently on the photo, in the order they went down. */
  pointers: ReadonlyMap<number, Point>;
  /** Distance and zoom when the current pinch started (or was re-based). */
  pinch: { distance: number; zoom: number } | null;
}

export const EMPTY_GESTURE: GestureState = { pointers: new Map(), pinch: null };

/** What the viewer should do after a pointer goes down or up. */
export type PanChange =
  | { type: "start"; from: Point }
  | { type: "stop" }
  | { type: "keep" };

const distanceBetween = (a: Point, b: Point) =>
  Math.hypot(a.x - b.x, a.y - b.y);

/** A new pinch measured from the first two pointers. */
const pinchFrom = (pointers: ReadonlyMap<number, Point>, zoom: number) => {
  const [a, b] = [...pointers.values()];
  return { distance: distanceBetween(a, b), zoom };
};

/** Only the main mouse button pans; right or middle clicks are ignored. */
export const isIgnoredPointer = (e: { pointerType: string; button: number }) =>
  e.pointerType === "mouse" && e.button !== 0;

export const pointerDown = (
  state: GestureState,
  id: number,
  point: Point,
  zoom: number,
): { state: GestureState; pan: PanChange } => {
  const pointers = new Map(state.pointers).set(id, point);
  if (pointers.size === 1) {
    return {
      state: { pointers, pinch: null },
      pan: { type: "start", from: point },
    };
  }
  // A second finger turns the pan into a pinch; more fingers keep the pinch.
  const pinch = pointers.size === 2 ? pinchFrom(pointers, zoom) : state.pinch;
  return { state: { pointers, pinch }, pan: { type: "stop" } };
};

/**
 * Releases a pointer (up, cancel or lost capture). Safe to call for a pointer
 * that is already gone.
 */
export const pointerUp = (
  state: GestureState,
  id: number,
  zoom: number,
): { state: GestureState; pan: PanChange } => {
  if (!state.pointers.has(id)) return { state, pan: { type: "keep" } };
  const pointers = new Map(state.pointers);
  pointers.delete(id);

  if (pointers.size >= 2) {
    // Back to exactly two fingers: measure the pinch from those two, so the
    // photo does not jump to a distance taken from a lifted finger.
    const pinch = pointers.size === 2 ? pinchFrom(pointers, zoom) : state.pinch;
    return { state: { pointers, pinch }, pan: { type: "keep" } };
  }
  // Lifting one finger of a pinch keeps panning with the other one.
  const [remaining] = [...pointers.values()];
  return {
    state: { pointers, pinch: null },
    pan: remaining ? { type: "start", from: remaining } : { type: "stop" },
  };
};

/** Result of moving a pointer: what the viewer should do with it. */
export type MoveResult =
  | { type: "ignore" } // not a pointer on the photo
  | { type: "pan" }
  | { type: "pinch"; zoom: number | null }; // null: zero start distance

/** Moves a tracked pointer: pans with one, pinch-zooms with two or more. */
export const pointerMove = (
  state: GestureState,
  id: number,
  point: Point,
  limits: { min: number; max: number },
): { state: GestureState; result: MoveResult } => {
  if (!state.pointers.has(id)) return { state, result: { type: "ignore" } };
  const pointers = new Map(state.pointers).set(id, point);
  const next = { pointers, pinch: state.pinch };
  if (!state.pinch || pointers.size < 2) {
    return { state: next, result: { type: "pan" } };
  }
  if (state.pinch.distance <= 0) {
    return { state: next, result: { type: "pinch", zoom: null } };
  }
  const [a, b] = [...pointers.values()];
  const scaled =
    (state.pinch.zoom * distanceBetween(a, b)) / state.pinch.distance;
  const zoom = Math.round(Math.min(limits.max, Math.max(limits.min, scaled)));
  return { state: next, result: { type: "pinch", zoom } };
};
