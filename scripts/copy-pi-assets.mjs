import { createHash } from "node:crypto";
import { chmod, cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const runtimePackageDir = join(root, "pi-package");
const dependencyEntry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));

async function findPackageRoot(start) {
  let current = dirname(start);
  while (current !== dirname(current)) {
    try {
      const packageJson = JSON.parse(await readFile(join(current, "package.json"), "utf8"));
      if (packageJson.name === "@earendil-works/pi-coding-agent") {
        return { directory: current, packageJson };
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    current = dirname(current);
  }
  throw new Error("Could not locate @earendil-works/pi-coding-agent package root");
}

const [{ directory: piRoot, packageJson: piPackage }, rockyPackage, runtimePackage] = await Promise.all([
  findPackageRoot(dependencyEntry),
  readFile(join(root, "package.json"), "utf8").then(JSON.parse),
  readFile(join(runtimePackageDir, "package.json"), "utf8").then(JSON.parse),
]);

if (piPackage.version !== "0.84.2") {
  throw new Error(`Expected Pi 0.84.2, found ${piPackage.version}`);
}
for (const field of ["name", "version"]) {
  if (runtimePackage[field] !== rockyPackage[field]) {
    throw new Error(`pi-package/package.json ${field} must match package.json`);
  }
}
if (
  runtimePackage.piConfig?.name !== rockyPackage.piConfig?.name ||
  runtimePackage.piConfig?.configDir !== rockyPackage.piConfig?.configDir
) {
  throw new Error("pi-package/package.json piConfig must match package.json");
}

async function copyDirectory(source, destination) {
  await mkdir(dirname(destination), { recursive: true });
  await cp(source, destination, { recursive: true });
}

async function copyFile(source, destination) {
  await mkdir(dirname(destination), { recursive: true });
  await cp(source, destination);
}

const themeSource = join(piRoot, "dist/modes/interactive/theme");
const themeDestination = join(runtimePackageDir, "dist/modes/interactive/theme");
await mkdir(themeDestination, { recursive: true });
for (const entry of await readdir(themeSource, { withFileTypes: true })) {
  if (entry.isFile() && entry.name.endsWith(".json")) {
    await copyFile(join(themeSource, entry.name), join(themeDestination, entry.name));
  }
}

await Promise.all([
  copyDirectory(
    join(piRoot, "dist/modes/interactive/assets"),
    join(runtimePackageDir, "dist/modes/interactive/assets"),
  ),
  copyFile(join(root, "README.md"), join(runtimePackageDir, "README.md")),
  copyFile(join(root, "CHANGELOG.md"), join(runtimePackageDir, "CHANGELOG.md")),
]);

const exportSource = join(piRoot, "dist/core/export-html");
const exportDestination = join(runtimePackageDir, "dist/core/export-html");
for (const name of ["template.html", "template.css", "template.js"]) {
  await copyFile(join(exportSource, name), join(exportDestination, name));
}
await copyDirectory(join(exportSource, "vendor"), join(exportDestination, "vendor"));

// Keep upstream API material available, but segregate it from Rocky operational docs.
const runtimeDocs = join(runtimePackageDir, "docs");
await copyDirectory(join(piRoot, "docs"), join(runtimeDocs, "upstream"));
await mkdir(join(runtimeDocs, "rocky"), { recursive: true });
await Promise.all([
  copyFile(join(root, "README.md"), join(runtimeDocs, "rocky", "quickstart.md")),
  copyFile(join(root, "docs/configuration.md"), join(runtimeDocs, "rocky", "configuration.md")),
  copyFile(join(root, "docs/architecture.md"), join(runtimeDocs, "rocky", "architecture.md")),
  copyFile(join(root, "SECURITY.md"), join(runtimeDocs, "rocky", "security.md")),
]);
for (const entry of await readdir(join(piRoot, "docs"), { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
  const title = entry.name
    .replace(/\.md$/, "")
    .split("-")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
  const wrapper =
    `# ${title}: Rocky runtime guide\n\n` +
    `Rocky uses Pi 0.84.2 APIs, but Rocky installation, commands, configuration paths, updates, and security ` +
    `policy differ from the upstream distribution. Follow [Rocky's quickstart](rocky/quickstart.md) and ` +
    `[configuration reference](rocky/configuration.md) for operational instructions.\n\n` +
    `The full API reference is preserved at [upstream/${entry.name}](upstream/${entry.name}). Treat it as API ` +
    `reference only: do not follow its distribution install/update commands or configuration-path examples. ` +
    `Use the \`rocky\` executable and Rocky runtime paths instead.\n`;
  await writeFile(join(runtimeDocs, entry.name), wrapper, "utf8");
}

const runtimeExamples = join(runtimePackageDir, "examples");
await copyDirectory(join(piRoot, "examples"), join(runtimeExamples, "upstream"));
const examplesNotice =
  `# Rocky examples\n\n` +
  `These examples target Pi's APIs, which Rocky exposes unchanged for extension compatibility. Upstream examples ` +
  `are segregated under [upstream/](upstream/). Treat distribution commands and configuration paths in those ` +
  `references as upstream-only; use the \`rocky\` executable and Rocky's configuration guide.\n`;
await writeFile(join(runtimeExamples, "README.md"), examplesNotice, "utf8");
for (const directory of ["extensions", "sdk"]) {
  await mkdir(join(runtimeExamples, directory), { recursive: true });
  await writeFile(
    join(runtimeExamples, directory, "README.md"),
    `${examplesNotice}\nBrowse [../upstream/${directory}/](../upstream/${directory}/) for the complete examples.\n`,
    "utf8",
  );
}

await chmod(join(root, "dist/cli.js"), 0o755);
await writeFile(join(runtimePackageDir, ".pi-version"), `${piPackage.version}\n`, "utf8");

async function collectFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(path)));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}

const manifest = {};
for (const path of await collectFiles(runtimePackageDir)) {
  const name = relative(runtimePackageDir, path).split("\\").join("/");
  if (name === "asset-manifest.json") continue;
  manifest[name] = createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}
await writeFile(
  join(runtimePackageDir, "asset-manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8",
);
