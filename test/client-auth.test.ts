/**
 * Login presentation.
 *
 * A login is a conversation rather than a call — an OAuth flow shows a URL or a
 * device code and then waits — so the interesting logic is in how the client
 * holds an open request and the notices around it.
 */
import { describe, expect, it } from "vitest";
import {
  applyAuthEvent,
  beginAuth,
  type idleAuth,
  loginOptions,
  logoutOptions,
} from "../packages/client/src/model/auth.js";
import type { ProviderAuth, SessionEvent } from "../src/contract/index.js";

const PROVIDERS: ProviderAuth[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    methods: ["oauth", "api_key"],
    authenticated: true,
    source: "stored",
    subscription: true,
  },
  { id: "openai-codex", name: "OpenAI Codex", methods: ["oauth"], authenticated: false },
  { id: "groq", name: "Groq", methods: [], authenticated: true, source: "environment" },
];

describe("loginOptions", () => {
  it("offers one row per way in", () => {
    expect(loginOptions(PROVIDERS).map((option) => `${option.provider}:${option.method}`)).toEqual([
      "anthropic:oauth",
      "anthropic:api_key",
      "openai-codex:oauth",
    ]);
  });

  // Its credentials come from the environment: it can be authenticated but
  // never logged into, and a row that cannot work is worse than no row.
  it("omits a provider with no way in", () => {
    expect(loginOptions(PROVIDERS).some((option) => option.provider === "groq")).toBe(false);
  });

  it("uses the provider's own words for its flow when it has them", () => {
    const [option] = loginOptions([
      { id: "xai", name: "xAI", methods: ["oauth"], authenticated: false, loginLabel: "Sign in with X" },
    ]);
    expect(option?.label).toBe("xAI — Sign in with X");
  });

  it("says subscription when a provider's oauth is one", () => {
    expect(loginOptions(PROVIDERS)[0]?.label).toBe("Anthropic — subscription");
  });
});

describe("logoutOptions", () => {
  // An environment variable is not the client's to unset.
  it("offers only credentials the core can actually remove", () => {
    expect(logoutOptions(PROVIDERS).map((provider) => provider.id)).toEqual(["anthropic"]);
  });
});

describe("applyAuthEvent", () => {
  const start = beginAuth("anthropic");

  it("accumulates notices rather than replacing them", () => {
    const state = [
      {
        type: "auth_notice",
        kind: "device_code",
        userCode: "WXYZ-1234",
        verificationUri: "https://example.test/device",
      },
      { type: "auth_notice", kind: "progress", message: "Enabling models…" },
    ].reduce<ReturnType<typeof idleAuth>>((current, event) => applyAuthEvent(current, event as never), start);

    // Losing the code the moment progress arrives would strand the user.
    expect(state.notices).toEqual([
      "open https://example.test/device and enter WXYZ-1234",
      "Enabling models…",
    ]);
  });

  it("renders a URL notice with its instructions", () => {
    const state = applyAuthEvent(start, {
      type: "auth_notice",
      kind: "auth_url",
      url: "https://example.test/authorize",
      instructions: "paste the redirect back",
    });
    expect(state.notices).toEqual(["open: https://example.test/authorize — paste the redirect back"]);
  });

  it("holds the open request", () => {
    const state = applyAuthEvent(start, {
      type: "auth_request",
      requestId: "auth-1",
      kind: "secret",
      message: "Enter Anthropic API key",
    });
    expect(state.request).toEqual({
      requestId: "auth-1",
      kind: "secret",
      message: "Enter Anthropic API key",
    });
    expect(state.active).toBe(true);
  });

  // Several OAuth flows race a pasted redirect against a local callback
  // server; when the server wins, the paste prompt has to disappear.
  it("clears a withdrawn request", () => {
    const asked = applyAuthEvent(start, {
      type: "auth_request",
      requestId: "auth-1",
      kind: "manual_code",
      message: "Paste the redirect URL",
    });
    expect(
      applyAuthEvent(asked, { type: "auth_request_cancelled", requestId: "auth-1" }).request,
    ).toBeUndefined();
  });

  it("ignores a withdrawal for a request that was already superseded", () => {
    const asked = applyAuthEvent(start, {
      type: "auth_request",
      requestId: "auth-2",
      kind: "text",
      message: "second",
    });
    expect(
      applyAuthEvent(asked, { type: "auth_request_cancelled", requestId: "auth-1" }).request?.requestId,
    ).toBe("auth-2");
  });

  it("ends the login, reporting success or the failure", () => {
    const ok = applyAuthEvent(start, { type: "auth_end", provider: "anthropic", ok: true });
    expect(ok.active).toBe(false);
    expect(ok.error).toBeUndefined();
    expect(ok.notices).toEqual(["signed in"]);

    const failed = applyAuthEvent(start, {
      type: "auth_end",
      provider: "anthropic",
      ok: false,
      error: "device code expired",
    });
    expect(failed.error).toBe("device code expired");
    expect(failed.notices).toEqual(["login failed: device code expired"]);
  });

  it("ignores events that are not part of a login", () => {
    const event: SessionEvent = { type: "turn_start" };
    expect(applyAuthEvent(start, event)).toBe(start);
  });
});
