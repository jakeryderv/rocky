/**
 * Test-environment hygiene for the harness suite.
 *
 * The suite must never reach a real provider, and must never read or write the
 * developer's own agent state. Agent-directory isolation is configured in
 * `vitest.config.ts` (ROCKY_CODING_AGENT_DIR); this file removes inherited
 * credential, cloud, and proxy state from the worker environment.
 *
 * HOME is deliberately left alone: much of the suite resolves paths through it,
 * and Bun's os.homedir() ignores runtime mutation anyway.
 */

const SENSITIVE_NAME =
	/(?:API_KEY|AUTH_TOKEN|ACCESS_KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL|_PROFILE$|_CONFIG_FILE$|_PROXY$)/i;

const SENSITIVE_EXACT = new Set([
	"AWS_PROFILE",
	"DOCKER_CONFIG",
	"GIT_ASKPASS",
	"GOOGLE_APPLICATION_CREDENTIALS",
	"HF_HOME",
	"KUBECONFIG",
	"NETRC",
	"NODE_AUTH_TOKEN",
	"NPM_CONFIG_USERCONFIG",
	"NO_PROXY",
	"SSH_AUTH_SOCK",
]);

export function removeInheritedCredentials(): void {
	for (const name of Object.keys(process.env)) {
		if (SENSITIVE_EXACT.has(name) || SENSITIVE_NAME.test(name)) {
			delete process.env[name];
		}
	}
}

removeInheritedCredentials();
