#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

execFileSync(process.execPath, [fileURLToPath(new URL("./gen-rotoscope-player.mjs", import.meta.url)), "--check"], { stdio: "inherit" });
console.log("✓ player local media bundles match their sources");
