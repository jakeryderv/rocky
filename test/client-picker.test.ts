/**
 * Model picker filtering.
 */
import { describe, expect, it } from "vitest";
import { filterModels, isActiveModel, modelLabel } from "../packages/client/src/model/picker.js";
import type { ModelRef } from "../src/contract/index.js";

const MODELS: ModelRef[] = [
  { provider: "openai-codex", id: "gpt-5.5", displayName: "GPT-5.5" },
  { provider: "openai-codex", id: "gpt-5.5-mini" },
  { provider: "anthropic", id: "claude-opus-5", displayName: "Claude Opus 5" },
];

describe("filterModels", () => {
  it("lists everything for an empty query", () => {
    expect(filterModels(MODELS, "")).toHaveLength(3);
    expect(filterModels(MODELS, "   ")).toHaveLength(3);
  });

  it("matches across the provider/id label", () => {
    expect(filterModels(MODELS, "openai-codex/gpt-5.5-m").map(modelLabel)).toEqual([
      "openai-codex/gpt-5.5-mini",
    ]);
  });

  // Every term must match, so ordering never has to be guessed.
  it("takes whitespace-separated terms in any order", () => {
    expect(filterModels(MODELS, "codex mini").map(modelLabel)).toEqual(["openai-codex/gpt-5.5-mini"]);
    expect(filterModels(MODELS, "mini codex").map(modelLabel)).toEqual(["openai-codex/gpt-5.5-mini"]);
  });

  it("searches the display name too", () => {
    expect(filterModels(MODELS, "opus").map(modelLabel)).toEqual(["anthropic/claude-opus-5"]);
  });
});

describe("isActiveModel", () => {
  it("matches on provider and id together", () => {
    const active: ModelRef = { provider: "openai-codex", id: "gpt-5.5" };
    expect(isActiveModel(MODELS[0] as ModelRef, active)).toBe(true);
    expect(isActiveModel(MODELS[1] as ModelRef, active)).toBe(false);
    expect(isActiveModel(MODELS[0] as ModelRef, undefined)).toBe(false);
  });
});
