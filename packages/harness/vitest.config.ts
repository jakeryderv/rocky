import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultExclude, defineConfig } from "vitest/config";

// The suite must not read or write the developer's real ~/.rocky/agent. Point the
// agent directory at a per-run temporary directory; test/global-setup.ts removes it.
const testAgentDir = mkdtempSync(join(tmpdir(), "rocky-harness-agent-"));
process.env.ROCKY_HARNESS_TEST_AGENT_DIR = testAgentDir;

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		testTimeout: 30000,
		// Tests run offline by default; opt in with allowNetwork() from test/test-network-env.ts.
		env: { PI_OFFLINE: "1", ROCKY_CODING_AGENT_DIR: testAgentDir },
		globalSetup: ["test/global-setup.ts"],
		setupFiles: ["test/credential-free-environment.ts"],
		unstubEnvs: true,
		reporters: process.env.GITHUB_ACTIONS ? ["dot", "github-actions"] : ["dot"],
		silent: "passed-only",
		server: {
			deps: {
				external: [/@silvia-odwyer\/photon-node/],
				// pi-ai is a vendored npm dependency (upstream aliased it to workspace
				// sources); inline it so vi.mock("openai") applies inside it.
				inline: [/@earendil-works\/pi-ai/],
			},
		},
		exclude: [
			...defaultExclude,
			// These tests import test helpers from sibling workspace packages
			// that have not been vendored yet.
			"test/custom-editor-history-keybindings.test.ts",
			"test/interactive-tui.test.ts",
			"test/interactive-mode-status.test.ts",
		],
	},
});
