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
] as const;

const SENSITIVE_NAME =
  /(?:API_KEY|AUTH_TOKEN|ACCESS_KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL|_PROFILE$|_CONFIG_FILE$|_CONFIG_DIR$|_PROXY$)/i;
const SENSITIVE_EXACT = new Set([
  "AWS_PROFILE",
  "DOCKER_CONFIG",
  "GIT_ASKPASS",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "HF_HOME",
  "HOME",
  "KUBECONFIG",
  "NETRC",
  "NODE_AUTH_TOKEN",
  "NPM_CONFIG_USERCONFIG",
  "SSH_AUTH_SOCK",
  "USERPROFILE",
]);

export function removeInheritedCredentials(): void {
  for (const name of Object.keys(process.env)) {
    if (SENSITIVE_EXACT.has(name) || SENSITIVE_NAME.test(name)) {
      delete process.env[name];
    }
  }
  process.env["PI_OFFLINE"] = "1";
  process.env["PI_SKIP_VERSION_CHECK"] = "1";
  process.env["PI_TELEMETRY"] = "0";
  process.env["ROCKY_OFFLINE"] = "1";
  process.env["ROCKY_TELEMETRY"] = "0";
}

export function credentialFreeEnvironment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
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
