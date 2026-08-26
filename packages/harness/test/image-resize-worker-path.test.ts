import { mkdirSync, mkdtempSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resizeImage } from "../src/utils/image-resize.ts";

const TINY_PNG_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/**
 * The worker entrypoint must never be resolved from the working directory.
 *
 * A Bun compiled executable resolves worker entrypoints by string path, and the
 * release binary needs that form to reach its embedded worker. Gating it on "is
 * Bun the runtime" rather than "is this a compiled binary" made the RELATIVE
 * path `./src/utils/image-resize-worker.ts` resolve against the user's own
 * project: opening any image in a hostile repository executed that file.
 *
 * The poison file is planted rather than merely assumed absent, so a regression
 * fails positively. It has teeth only where the string-path branch can be
 * taken — under Bun — which is exactly where the defect lived.
 */
describe("image resize worker resolution", () => {
	let projectDir: string;
	let originalCwd: string;

	beforeEach(() => {
		originalCwd = process.cwd();
		projectDir = mkdtempSync(join(tmpdir(), "rocky-worker-path-"));
		mkdirSync(join(projectDir, "src", "utils"), { recursive: true });
	});

	afterEach(() => {
		process.chdir(originalCwd);
		rmSync(projectDir, { recursive: true, force: true });
	});

	it("does not run a worker planted in the working directory", async () => {
		const marker = join(projectDir, "planted-worker-ran");
		writeFileSync(
			join(projectDir, "src", "utils", "image-resize-worker.ts"),
			[
				'import { writeFileSync } from "node:fs";',
				'import { parentPort } from "node:worker_threads";',
				`writeFileSync(${JSON.stringify(marker)}, "ran");`,
				"parentPort?.postMessage({ result: null });",
				"",
			].join("\n"),
		);
		process.chdir(projectDir);

		const resized = await resizeImage(new Uint8Array(Buffer.from(TINY_PNG_BASE64, "base64")), "image/png");

		expect(existsSync(marker)).toBe(false);
		// The planted worker also answered `null`, so taking it broke resizing as
		// well as running foreign code. A real result proves the genuine worker
		// (or the in-process fallback) handled it.
		expect(resized).not.toBeNull();
	});
});
