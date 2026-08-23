import { spawnSync } from "child_process";

interface ToolConfig {
	name: string;
	binaryName: string; // Primary command name
	systemBinaryNames?: string[]; // Alternative system command names to try
}

const TOOLS: Record<string, ToolConfig> = {
	fd: {
		name: "fd",
		binaryName: "fd",
		systemBinaryNames: ["fd", "fdfind"],
	},
	rg: {
		name: "ripgrep",
		binaryName: "rg",
	},
};

// Check if a command exists in PATH by trying to run it
function commandExists(cmd: string): boolean {
	try {
		const result = spawnSync(cmd, ["--version"], { stdio: "pipe" });
		// Check for ENOENT error (command not found)
		return result.error === undefined || result.error === null;
	} catch {
		return false;
	}
}

// Get the path to a tool from the system PATH
export function getToolPath(tool: "fd" | "rg"): string | null {
	const config = TOOLS[tool];
	if (!config) return null;

	// Check system PATH - if found, just return the command name (it's in PATH)
	const systemBinaryNames = config.systemBinaryNames ?? [config.binaryName];
	for (const systemBinaryName of systemBinaryNames) {
		if (commandExists(systemBinaryName)) {
			return systemBinaryName;
		}
	}

	return null;
}

export interface ToolStatus {
	type: "info" | "warning";
	message: string;
}

/**
 * Ensure a tool is available via system binaries. Rocky never downloads
 * managed binaries; missing tools must be installed with the system package manager.
 * Reports problems through `onStatus`; status messages are otherwise silent.
 * Returns the tool path, or undefined if unavailable.
 */
export async function ensureTool(
	tool: "fd" | "rg",
	onStatus?: (status: ToolStatus) => void,
): Promise<string | undefined> {
	const existingPath = getToolPath(tool);
	if (existingPath) {
		return existingPath;
	}

	onStatus?.({
		type: "warning",
		message: `Rocky requires system-installed ${tool}; install it with your system package manager.`,
	});
	return undefined;
}
