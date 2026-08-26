import { rmSync } from "node:fs";

/** Remove the per-run agent directory created in vitest.config.ts. */
export function teardown(): void {
	const dir = process.env.ROCKY_HARNESS_TEST_AGENT_DIR;
	if (dir) {
		rmSync(dir, { recursive: true, force: true });
	}
}
