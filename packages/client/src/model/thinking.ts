/**
 * The thinking levels, in the order a picker should show them.
 *
 * Declared here rather than imported from the contract, which exports the same
 * list as a value: the client imports the contract type-only so the seam is
 * erased at runtime, and `test/client-isolation.test.ts` enforces that.
 *
 * The record is what keeps the two from drifting. It is keyed by
 * `ThinkingLevel`, so a level added to the contract fails this file's typecheck
 * rather than silently going missing from the picker.
 */
import type { ThinkingLevel } from "@rocky/contract";

const ORDERED: Record<ThinkingLevel, true> = {
  off: true,
  minimal: true,
  low: true,
  medium: true,
  high: true,
  xhigh: true,
  max: true,
};

export const THINKING_LEVELS = Object.keys(ORDERED) as ThinkingLevel[];
