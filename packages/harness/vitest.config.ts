import { defaultExclude, defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		testTimeout: 30000,
		// Tests run offline by default; opt in with allowNetwork() from test/test-network-env.ts.
		env: { PI_OFFLINE: "1" },
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
