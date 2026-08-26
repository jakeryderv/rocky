/**
 * Login presentation: which provider/method rows to offer, and what a login is
 * currently asking for.
 *
 * A login is a conversation rather than a call — an OAuth flow shows a URL or a
 * device code and then waits — so the client has to hold the open request and
 * the notices around it. Keeping that state pure is what makes it testable
 * without a provider.
 */
import type { AuthSelectOption, ProviderAuth, SessionEvent } from "@rocky/contract";

/** One row in the login picker: a provider paired with one way in. */
export interface LoginOption {
  provider: string;
  name: string;
  method: "oauth" | "api_key";
  label: string;
  authenticated: boolean;
}

/**
 * Flatten providers into one row per way in.
 *
 * A provider with no methods is omitted: its credentials come from the
 * environment, so it can be authenticated but never logged into, and offering
 * a row that cannot work is worse than offering none.
 */
export function loginOptions(providers: readonly ProviderAuth[]): LoginOption[] {
  const options: LoginOption[] = [];
  for (const provider of providers) {
    for (const method of provider.methods) {
      const suffix =
        method === "oauth"
          ? (provider.loginLabel ?? (provider.subscription ? "subscription" : "oauth"))
          : "api key";
      options.push({
        provider: provider.id,
        name: provider.name,
        method,
        label: `${provider.name} — ${suffix}`,
        authenticated: provider.authenticated,
      });
    }
  }
  return options;
}

/** Providers there is something to log out of. */
export function logoutOptions(providers: readonly ProviderAuth[]): ProviderAuth[] {
  // Only a stored or runtime credential can be removed; an environment
  // variable is not the client's to unset.
  return providers.filter(
    (provider) => provider.authenticated && (provider.source === "stored" || provider.source === "runtime"),
  );
}

export interface AuthRequest {
  requestId: string;
  kind: "text" | "secret" | "select" | "manual_code";
  message: string;
  placeholder?: string;
  options?: AuthSelectOption[];
}

export interface AuthState {
  /** A login is in progress. */
  active: boolean;
  provider?: string;
  /** What the core is waiting for, when it is waiting. */
  request?: AuthRequest;
  /** Lines to show: URLs, device codes, progress. */
  notices: string[];
  error?: string;
}

export function idleAuth(): AuthState {
  return { active: false, notices: [] };
}

export function beginAuth(provider: string): AuthState {
  return { active: true, provider, notices: [] };
}

/** One notice, as a line. */
function noticeLine(event: Extract<SessionEvent, { type: "auth_notice" }>): string {
  if (event.kind === "auth_url") {
    return `open: ${event.url}${event.instructions ? ` — ${event.instructions}` : ""}`;
  }
  if (event.kind === "device_code") {
    return `open ${event.verificationUri} and enter ${event.userCode}`;
  }
  return event.message ?? "";
}

/**
 * Fold one event into the login's state.
 *
 * Notices accumulate rather than replace: a device-code flow shows the code and
 * then reports progress, and losing the code the moment progress arrives would
 * strand the user.
 */
export function applyAuthEvent(state: AuthState, event: SessionEvent): AuthState {
  if (event.type === "auth_notice") {
    const line = noticeLine(event);
    return line.length > 0 ? { ...state, notices: [...state.notices, line] } : state;
  }
  if (event.type === "auth_request") {
    return {
      ...state,
      active: true,
      request: {
        requestId: event.requestId,
        kind: event.kind,
        message: event.message,
        ...(event.placeholder !== undefined ? { placeholder: event.placeholder } : {}),
        ...(event.options !== undefined ? { options: event.options } : {}),
      },
    };
  }
  if (event.type === "auth_request_cancelled") {
    // Only if it is the one on screen: a withdrawn request that was already
    // superseded must not clear the one that replaced it.
    if (state.request?.requestId !== event.requestId) {
      return state;
    }
    const { request: _withdrawn, ...rest } = state;
    return { ...rest, notices: state.notices };
  }
  if (event.type === "auth_end") {
    return {
      active: false,
      notices: [...state.notices, event.ok ? "signed in" : `login failed: ${event.error ?? "unknown error"}`],
      ...(event.ok ? {} : { error: event.error ?? "login failed" }),
    };
  }
  return state;
}
