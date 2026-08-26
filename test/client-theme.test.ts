/**
 * Palette derivation.
 *
 * The core owns the colour vocabulary, so the keys are read rather than
 * renamed — and every one is optional. A user-authored theme that defines half
 * of them must not blank the UI.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_PALETTE, paletteFrom } from "../packages/client/src/model/theme.js";

describe("paletteFrom", () => {
  it("falls back entirely when there is no theme yet", () => {
    expect(paletteFrom(undefined)).toEqual(DEFAULT_PALETTE);
  });

  it("reads the core's own colour names", () => {
    const palette = paletteFrom({
      name: "dark",
      colors: { text: "#e5e5e7", muted: "#7a7a7a", accent: "#7aa2f7", error: "#f7768e", success: "#9ece6a" },
    });
    expect(palette).toEqual({
      text: "#e5e5e7",
      muted: "#7a7a7a",
      accent: "#7aa2f7",
      error: "#f7768e",
      success: "#9ece6a",
    });
  });

  it("keeps the fallback for a key the theme does not define", () => {
    expect(paletteFrom({ name: "sparse", colors: { text: "#ffffff" } }).error).toBe(DEFAULT_PALETTE.error);
  });

  // An empty value means "the terminal's default", which is not a colour a
  // renderable can be given.
  it("treats an empty value as undefined", () => {
    expect(paletteFrom({ name: "x", colors: { muted: "   " } }).muted).toBe(DEFAULT_PALETTE.muted);
  });

  it("substitutes a near neighbour before giving up", () => {
    expect(paletteFrom({ name: "x", colors: { dim: "#555555" } }).muted).toBe("#555555");
    expect(paletteFrom({ name: "x", colors: { text: "#abcdef" } }).accent).toBe("#abcdef");
  });
});
