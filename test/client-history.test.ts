import { describe, expect, it } from "vitest";
import { emptyHistory, newer, older, remember } from "../packages/client/src/model/history.js";

describe("prompt history", () => {
  const seeded = () =>
    ["third", "second", "first"].reduce((state, text) => remember(state, text), emptyHistory());

  it("records newest first and ignores blank submissions", () => {
    let state = remember(emptyHistory(), "hello");
    state = remember(state, "   ");
    expect(state.entries).toEqual(["hello"]);
  });

  it("collapses an immediate repeat", () => {
    let state = remember(emptyHistory(), "same");
    state = remember(state, "same");
    expect(state.entries).toEqual(["same"]);
  });

  it("walks backwards through history", () => {
    const state = seeded();
    const first = older(state, "");
    expect(first.text).toBe("first");
    const second = older(first.state, "");
    expect(second.text).toBe("second");
  });

  it("stops at the oldest entry", () => {
    let move = older(seeded(), "");
    move = older(move.state, "");
    move = older(move.state, "");
    expect(move.text).toBe("third");
    const past = older(move.state, "");
    expect(past.text).toBeUndefined();
  });

  it("restores the draft when walking back past the newest entry", () => {
    const move = older(seeded(), "half-typed thought");
    expect(move.text).toBe("first");
    const back = newer(move.state, "first");
    expect(back.text).toBe("half-typed thought");
    expect(back.state.index).toBe(-1);
  });

  it("does nothing when not browsing and asked for something newer", () => {
    expect(newer(seeded(), "typing").text).toBeUndefined();
  });

  it("does nothing with empty history", () => {
    expect(older(emptyHistory(), "typing").text).toBeUndefined();
  });

  it("leaves history mode after submitting", () => {
    const move = older(seeded(), "");
    const after = remember(move.state, "brand new");
    expect(after.index).toBe(-1);
    expect(after.entries[0]).toBe("brand new");
  });
});
