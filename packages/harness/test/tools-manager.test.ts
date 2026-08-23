import type * as ChildProcess from "node:child_process";
import type * as Fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { ensureTool, type ToolStatus } from "../src/utils/tools-manager.ts";

vi.mock("fs", async (importOriginal) => {
	const actual = await importOriginal<typeof Fs>();
	return {
		...actual,
		existsSync: vi.fn(() => false),
	};
});

vi.mock("child_process", async (importOriginal) => {
	const actual = await importOriginal<typeof ChildProcess>();
	return {
		...actual,
		spawnSync: vi.fn(() => ({ error: new Error("not found") })),
	};
});

describe("ensureTool", () => {
	it("reports status through a callback without writing to the console", async () => {
		const statuses: ToolStatus[] = [];
		const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});

		const result = await ensureTool("fd", (status) => statuses.push(status));

		expect(result).toBeUndefined();
		expect(statuses).toEqual([
			{
				type: "warning",
				message: "Rocky requires system-installed fd; install it with your system package manager.",
			},
		]);
		expect(consoleLog).not.toHaveBeenCalled();
		consoleLog.mockRestore();
	});
});
