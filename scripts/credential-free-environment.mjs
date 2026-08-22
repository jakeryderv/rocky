const PASSTHROUGH_KEYS = [
  "PATH",
  "SystemRoot",
  "WINDIR",
  "ComSpec",
  "PATHEXT",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "COLORTERM",
  "TMPDIR",
  "TMP",
  "TEMP",
];

/** Build a child environment without provider, cloud, proxy, or credential-helper state. */
export function credentialFreeEnvironment(overrides = {}) {
  const environment = {};
  for (const key of PASSTHROUGH_KEYS) {
    if (process.env[key] !== undefined) {
      environment[key] = process.env[key];
    }
  }

  return {
    ...environment,
    PI_OFFLINE: "1",
    PI_SKIP_VERSION_CHECK: "1",
    PI_TELEMETRY: "0",
    ROCKY_OFFLINE: "1",
    ROCKY_TELEMETRY: "0",
    ...overrides,
  };
}
