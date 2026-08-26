/**
 * The client's palette, derived from whatever the core's theme defines.
 *
 * The core owns the colour vocabulary — themes are shared with the CLI — so the
 * keys are read rather than renamed. Every one is optional: a user-authored
 * theme need not define them all, and a missing key must not blank the UI. The
 * fallbacks are the colours the client used before it had a theme at all.
 */
import type { ThemeSnapshot } from "@rocky/contract";

export interface Palette {
  text: string;
  muted: string;
  accent: string;
  error: string;
  success: string;
}

export const DEFAULT_PALETTE: Palette = {
  text: "#ffffff",
  muted: "#888888",
  accent: "#ffffff",
  error: "#ff5555",
  success: "#888888",
};

/** A colour value the terminal can actually use. */
function usable(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed !== undefined && trimmed.length > 0 ? trimmed : undefined;
}

/** First key the theme actually defines, else the fallback. */
function pick(colors: Record<string, string>, keys: readonly string[], fallback: string): string {
  for (const key of keys) {
    const value = usable(colors[key]);
    if (value !== undefined) {
      return value;
    }
  }
  return fallback;
}

export function paletteFrom(theme: ThemeSnapshot | undefined): Palette {
  const colors = theme?.colors;
  if (!colors) {
    return DEFAULT_PALETTE;
  }
  return {
    text: pick(colors, ["text"], DEFAULT_PALETTE.text),
    muted: pick(colors, ["muted", "dim"], DEFAULT_PALETTE.muted),
    accent: pick(colors, ["accent", "text"], DEFAULT_PALETTE.accent),
    error: pick(colors, ["error"], DEFAULT_PALETTE.error),
    success: pick(colors, ["success", "muted"], DEFAULT_PALETTE.success),
  };
}
