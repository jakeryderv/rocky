#!/usr/bin/env node

import { runRocky } from "./runtime/pi-runtime.js";

try {
  await runRocky(process.argv.slice(2));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`rocky: ${message}`);
  process.exitCode = 1;
}
