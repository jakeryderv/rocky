import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  accessSync,
  constants,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { credentialFreeEnvironment } from "./credential-free-environment.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const temporaryRoot = mkdtempSync(join(tmpdir(), "rocky-pack-check-"));
const npmCache = process.env["npm_config_cache"] ?? join(homedir(), ".npm");
const npmEnvironment = credentialFreeEnvironment({
  HOME: join(temporaryRoot, "npm-home"),
  npm_config_cache: npmCache,
  npm_config_loglevel: "silent",
});

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    encoding: "utf8",
    env: options.env ?? npmEnvironment,
    timeout: options.timeout ?? 120_000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed (${result.status})\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  }
  return result;
}

function collectDependencyVersions(tree, versions = new Map()) {
  for (const [name, dependency] of Object.entries(tree.dependencies ?? {})) {
    if (name.startsWith("@earendil-works/pi-")) {
      const values = versions.get(name) ?? new Set();
      values.add(dependency.version);
      versions.set(name, values);
    }
    collectDependencyVersions(dependency, versions);
  }
  return versions;
}

function collectFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

try {
  const packResult = run("npm", ["pack", "--json", "--pack-destination", temporaryRoot]);
  const [pack] = JSON.parse(packResult.stdout);
  const tarball = join(temporaryRoot, pack.filename);
  const files = new Set(pack.files.map(({ path }) => path));
  const required = [
    "dist/cli.js",
    "dist/runtime/pi-runtime.js",
    "npm-shrinkwrap.json",
    "pi-package/package.json",
    "pi-package/asset-manifest.json",
    "pi-package/dist/modes/interactive/theme/dark.json",
    "pi-package/dist/modes/interactive/theme/light.json",
    "pi-package/dist/modes/interactive/assets/clankolas.png",
    "pi-package/dist/core/export-html/template.html",
    "pi-package/dist/core/export-html/template.css",
    "pi-package/dist/core/export-html/template.js",
    "pi-package/dist/core/export-html/vendor/highlight.min.js",
    "pi-package/dist/core/export-html/vendor/marked.min.js",
    "pi-package/docs/sdk.md",
    "pi-package/docs/upstream/sdk.md",
    "pi-package/examples/README.md",
    "pi-package/examples/upstream/sdk/01-minimal.ts",
    "pi-package/README.md",
    "pi-package/CHANGELOG.md",
    "README.md",
    "LICENSE",
    "THIRD_PARTY_NOTICES.md",
  ];
  for (const path of required) {
    if (!files.has(path)) throw new Error(`Packed artifact is missing ${path}`);
  }
  const cliEntry = pack.files.find(({ path }) => path === "dist/cli.js");
  if ((cliEntry.mode & 0o111) === 0) throw new Error("Packed dist/cli.js is not executable");
  for (const path of files) {
    if (path.startsWith("src/") || path.startsWith("test/") || path.startsWith("coverage/")) {
      throw new Error(`Packed artifact unexpectedly includes ${path}`);
    }
  }

  const consumer = join(temporaryRoot, "consumer");
  mkdirSync(consumer, { recursive: true });
  writeFileSync(join(consumer, "package.json"), '{"name":"rocky-consumer","private":true}\n', "utf8");
  run("npm", ["install", "--offline", "--ignore-scripts", "--no-package-lock", tarball], { cwd: consumer });

  const installedPackage = join(consumer, "node_modules", "@jakeryderv", "rocky");
  const installedManifest = JSON.parse(
    readFileSync(join(installedPackage, "pi-package/asset-manifest.json"), "utf8"),
  );
  for (const [path, expectedHash] of Object.entries(installedManifest)) {
    const asset = join(installedPackage, "pi-package", path);
    const actualHash = createHash("sha256").update(readFileSync(asset)).digest("hex");
    if (actualHash !== expectedHash) throw new Error(`Packed asset hash mismatch: ${path}`);
  }

  const dependencyTree = JSON.parse(run("npm", ["ls", "--all", "--json"], { cwd: consumer }).stdout);
  const versions = collectDependencyVersions(dependencyTree);
  const expectedPiPackages = [
    "@earendil-works/pi-coding-agent",
    "@earendil-works/pi-agent-core",
    "@earendil-works/pi-ai",
    "@earendil-works/pi-client",
    "@earendil-works/pi-protocol",
    "@earendil-works/pi-telemetry",
    "@earendil-works/pi-tui",
  ];
  for (const name of expectedPiPackages) {
    const found = [...(versions.get(name) ?? [])];
    if (found.length !== 1 || found[0] !== "0.84.2") {
      throw new Error(
        `Installed ${name} versions are ${found.join(", ") || "missing"}; expected only 0.84.2`,
      );
    }
  }

  const bin = join(consumer, "node_modules", ".bin", process.platform === "win32" ? "rocky.cmd" : "rocky");
  accessSync(bin, process.platform === "win32" ? constants.F_OK : constants.X_OK);
  if (process.platform !== "win32") {
    if (!lstatSync(bin).isSymbolicLink()) throw new Error("Installed rocky bin is not an npm symlink");
    if (!readFileSync(realpathSync(bin), "utf8").startsWith("#!/usr/bin/env node")) {
      throw new Error("Installed rocky executable has no Node shebang");
    }
  }

  const cliHome = join(temporaryRoot, "cli-home");
  const cliProject = join(temporaryRoot, "cli-project");
  mkdirSync(join(cliHome, ".pi", "agent"), { recursive: true });
  mkdirSync(cliProject, { recursive: true });
  writeFileSync(join(cliHome, ".pi", "agent", "settings.json"), "{invalid pi poison", "utf8");
  const cliEnvironment = credentialFreeEnvironment({
    HOME: cliHome,
    ROCKY_CODING_AGENT_DIR: join(temporaryRoot, "cli-agent"),
  });
  const version = run(bin, ["--offline", "--version"], { cwd: cliProject, env: cliEnvironment });
  if (version.stdout.trim() !== "0.1.0") throw new Error(`Installed version output was ${version.stdout}`);
  const help = run(bin, ["--offline", "--help"], { cwd: cliProject, env: cliEnvironment }).stdout;
  for (const text of [
    "rocky [options]",
    "~/.rocky/agent",
    "PI_PACKAGE_DIR",
    "Reserved internally by Rocky",
  ]) {
    if (!help.includes(text)) throw new Error(`Installed help is missing ${text}`);
  }
  if (help.includes("update [source|self|pi]")) throw new Error("Installed help advertises self-update");
  run(bin, ["--offline", "--list-models"], { cwd: cliProject, env: cliEnvironment });
  const updateHelp = run(bin, ["update", "--help"], { cwd: cliProject, env: cliEnvironment }).stdout;
  if (
    updateHelp.includes("Update pi only") ||
    updateHelp.includes("source|self|pi") ||
    !updateHelp.includes("Unsupported by Rocky")
  ) {
    throw new Error("Installed update help advertises unsupported Pi self-update behavior");
  }

  mkdirSync(join(cliProject, ".rocky", "prompts"), { recursive: true });
  mkdirSync(join(cliProject, ".pi", "prompts"), { recursive: true });
  writeFileSync(join(cliProject, ".rocky", "settings.json"), '{"theme":"rocky-sentinel"}\n', "utf8");
  writeFileSync(join(cliProject, ".pi", "settings.json"), '{"theme":"pi-poison"}\n', "utf8");
  writeFileSync(join(cliProject, ".rocky", "prompts", "rocky-only.md"), "Rocky prompt\n", "utf8");
  writeFileSync(join(cliProject, ".pi", "prompts", "pi-poison.md"), "Pi poison\n", "utf8");
  writeFileSync(join(cliProject, ".rocky", "SYSTEM.md"), "Rocky system\n", "utf8");
  writeFileSync(join(cliProject, ".pi", "SYSTEM.md"), "Pi poison system\n", "utf8");

  const probe = join(consumer, "isolation-probe.mjs");
  const runtimeUrl = pathToFileURL(join(installedPackage, "dist/runtime/pi-runtime.js")).href;
  writeFileSync(
    probe,
    `const rocky = await import(${JSON.stringify(runtimeUrl)});\n` +
      `const pi = await rocky.loadPiRuntime();\n` +
      `const cwd = process.cwd();\n` +
      `if (pi.CONFIG_DIR_NAME !== ".rocky") throw new Error("wrong config dir");\n` +
      `const settings = pi.SettingsManager.create(cwd, pi.getAgentDir(), { projectTrusted: true });\n` +
      `if (settings.getTheme() !== "rocky-sentinel") throw new Error("wrong settings source");\n` +
      `const loader = new pi.DefaultResourceLoader({ cwd, agentDir: pi.getAgentDir(), settingsManager: settings });\n` +
      `await loader.reload();\n` +
      `const prompts = loader.getPrompts().prompts.map((prompt) => prompt.name);\n` +
      `if (!prompts.includes("rocky-only") || prompts.includes("pi-poison")) throw new Error("prompt isolation failed");\n` +
      `if (loader.getSystemPrompt() !== "Rocky system\\n") throw new Error("system prompt isolation failed");\n`,
    "utf8",
  );
  run(process.execPath, [probe], { cwd: cliProject, env: cliEnvironment });

  const operationalDocs = [
    join(installedPackage, "pi-package", "README.md"),
    ...collectFiles(join(installedPackage, "pi-package", "docs")).filter(
      (path) => !path.includes(`${join("docs", "upstream")}`),
    ),
    ...collectFiles(join(installedPackage, "pi-package", "examples")).filter(
      (path) => !path.includes(`${join("examples", "upstream")}`),
    ),
  ].filter((path) => path.endsWith(".md"));
  for (const path of operationalDocs) {
    const content = readFileSync(path, "utf8");
    if (/~\/\.pi\/agent|npm install[^\n]*@earendil-works\/pi-coding-agent|^\s*pi(?:\s|$)/m.test(content)) {
      throw new Error(`Packed Rocky operational documentation contains an upstream instruction: ${path}`);
    }
  }

  console.log(
    `pack/install check passed (${pack.entryCount} files, ${Object.keys(installedManifest).length} verified assets, ` +
      `${expectedPiPackages.length} pinned Pi packages)`,
  );
} finally {
  rmSync(temporaryRoot, { force: true, recursive: true });
}
