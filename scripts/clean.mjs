import { rm } from "node:fs/promises";

const generatedPaths = [
  "dist",
  "pi-package/dist",
  "pi-package/docs",
  "pi-package/examples",
  "pi-package/README.md",
  "pi-package/CHANGELOG.md",
  "pi-package/asset-manifest.json",
  "pi-package/.pi-version",
];

await Promise.all(generatedPaths.map((path) => rm(path, { force: true, recursive: true })));
