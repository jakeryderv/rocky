import { homedir } from "node:os";
import { describe, expect, it } from "vitest";
import { getAgentDir, getSessionsDir } from "../src/config.ts";

// Guards the suite's own hygiene: a regression here silently writes test
// sessions into the developer's real ~/.rocky/agent (see vitest.config.ts).
describe("test environment isolation", () => {
	it("resolves the agent directory outside the developer's home", () => {
		const agentDir = getAgentDir();
		expect(process.env.ROCKY_CODING_AGENT_DIR).toBeTruthy();
		expect(agentDir).toBe(process.env.ROCKY_CODING_AGENT_DIR);
		expect(agentDir.startsWith(homedir())).toBe(false);
		expect(getSessionsDir().startsWith(agentDir)).toBe(true);
	});

	it("runs without inherited provider credentials in the environment", () => {
		const leaked = Object.keys(process.env).filter((name) =>
			/(?:API_KEY|AUTH_TOKEN|ACCESS_KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL)/i.test(name),
		);
		expect(leaked).toEqual([]);
	});

	it("runs offline by default", () => {
		expect(process.env.PI_OFFLINE).toBe("1");
	});
});
