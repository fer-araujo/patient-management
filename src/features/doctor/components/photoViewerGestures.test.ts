import { describe, expect, it } from "vitest";
import {
  EMPTY_GESTURE,
  isIgnoredPointer,
  pointerDown,
  pointerMove,
  pointerUp,
  type GestureState,
} from "./photoViewerGestures";

const LIMITS = { min: 50, max: 300 };

/** Two fingers 100 px apart, pinch started at `zoom`. */
const twoFingers = (zoom = 100): GestureState => {
  const first = pointerDown(EMPTY_GESTURE, 1, { x: 0, y: 0 }, zoom).state;
  return pointerDown(first, 2, { x: 100, y: 0 }, zoom).state;
};

describe("photo viewer gestures", () => {
  it("pans with one pointer", () => {
    const { state, pan } = pointerDown(EMPTY_GESTURE, 1, { x: 5, y: 6 }, 100);
    expect(pan).toEqual({ type: "start", from: { x: 5, y: 6 } });
    expect(pointerMove(state, 1, { x: 9, y: 9 }, LIMITS).result).toEqual({
      type: "pan",
    });
  });

  it("stops panning and starts a pinch when a second pointer goes down", () => {
    const first = pointerDown(EMPTY_GESTURE, 1, { x: 0, y: 0 }, 120).state;
    const { state, pan } = pointerDown(first, 2, { x: 100, y: 0 }, 120);
    expect(pan).toEqual({ type: "stop" });
    expect(state.pinch).toEqual({ distance: 100, zoom: 120 });
  });

  it("scales the zoom with the finger distance, within the limits", () => {
    const state = twoFingers(100);
    expect(pointerMove(state, 2, { x: 150, y: 0 }, LIMITS).result).toEqual({
      type: "pinch",
      zoom: 150,
    });
    expect(pointerMove(state, 2, { x: 1000, y: 0 }, LIMITS).result).toEqual({
      type: "pinch",
      zoom: 300,
    });
    expect(pointerMove(state, 2, { x: 10, y: 0 }, LIMITS).result).toEqual({
      type: "pinch",
      zoom: 50,
    });
  });

  it("re-bases the pinch when a third finger lifts and two remain", () => {
    const three = pointerDown(twoFingers(100), 3, { x: 0, y: 300 }, 100);
    expect(three.state.pinch).toEqual({ distance: 100, zoom: 100 });

    // Finger 2 lifts at zoom 180: the pinch is now fingers 1 and 3.
    const { state, pan } = pointerUp(three.state, 2, 180);
    expect(pan).toEqual({ type: "keep" });
    expect(state.pinch).toEqual({ distance: 300, zoom: 180 });
    expect(pointerMove(state, 3, { x: 0, y: 600 }, LIMITS).result).toEqual({
      type: "pinch",
      zoom: 300,
    });
  });

  it("keeps panning with the finger left after a pinch", () => {
    const { state, pan } = pointerUp(twoFingers(), 1, 150);
    expect(pan).toEqual({ type: "start", from: { x: 100, y: 0 } });
    expect(state.pinch).toBeNull();
    expect(pointerMove(state, 2, { x: 90, y: 0 }, LIMITS).result).toEqual({
      type: "pan",
    });
  });

  it("re-bases a new pinch when a finger goes back down", () => {
    const one = pointerUp(twoFingers(100), 2, 200).state;
    const { state } = pointerDown(one, 4, { x: 0, y: 50 }, 200);
    expect(state.pinch).toEqual({ distance: 50, zoom: 200 });
  });

  it("stops panning when the last pointer lifts", () => {
    const one = pointerDown(EMPTY_GESTURE, 1, { x: 0, y: 0 }, 100).state;
    const { state, pan } = pointerUp(one, 1, 100);
    expect(pan).toEqual({ type: "stop" });
    expect(state.pointers.size).toBe(0);
  });

  it("treats a second release of the same pointer (lost capture) as a no-op", () => {
    const afterUp = pointerUp(twoFingers(), 1, 100).state;
    const again = pointerUp(afterUp, 1, 100);
    expect(again.pan).toEqual({ type: "keep" });
    expect(again.state).toBe(afterUp);
  });

  it("ignores moves from pointers that are not on the photo", () => {
    expect(
      pointerMove(EMPTY_GESTURE, 7, { x: 0, y: 0 }, LIMITS).result,
    ).toEqual({ type: "ignore" });
  });

  it("does not zoom when both fingers started on the same spot", () => {
    const first = pointerDown(EMPTY_GESTURE, 1, { x: 0, y: 0 }, 100).state;
    const state = pointerDown(first, 2, { x: 0, y: 0 }, 100).state;
    expect(pointerMove(state, 2, { x: 50, y: 0 }, LIMITS).result).toEqual({
      type: "pinch",
      zoom: null,
    });
  });

  it("ignores right and middle mouse buttons, not touch or pen", () => {
    expect(isIgnoredPointer({ pointerType: "mouse", button: 0 })).toBe(false);
    expect(isIgnoredPointer({ pointerType: "mouse", button: 2 })).toBe(true);
    expect(isIgnoredPointer({ pointerType: "mouse", button: 1 })).toBe(true);
    expect(isIgnoredPointer({ pointerType: "touch", button: 0 })).toBe(false);
    expect(isIgnoredPointer({ pointerType: "pen", button: 0 })).toBe(false);
  });
});
