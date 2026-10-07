import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { mockPhoneViewport } from "../../test/viewport";
import { useIsPhone } from "./useIsPhone";

describe("useIsPhone", () => {
  it("is false on iPad and desktop (no media query matches)", () => {
    const { result } = renderHook(() => useIsPhone());
    expect(result.current).toBe(false);
  });

  it("follows a rotation: portrait phone yes, landscape phone no", () => {
    const viewport = mockPhoneViewport("portrait");
    const { result } = renderHook(() => useIsPhone());
    expect(result.current).toBe(true);

    // Landscape is wider than 768 px: the tablet layout.
    act(() => viewport.rotate("landscape"));
    expect(result.current).toBe(false);

    act(() => viewport.rotate("portrait"));
    expect(result.current).toBe(true);
  });
});
