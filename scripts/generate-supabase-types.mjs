import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const outputPath = fileURLToPath(new URL("../src/types/database.ts", import.meta.url));
const supabaseArgs = [
  "supabase@latest",
  "gen",
  "types",
  "typescript",
  "--linked",
  "--schema",
  "public",
];
const windowsNpxCli = join(dirname(process.execPath), "node_modules", "npm", "bin", "npx-cli.js");
const command =
  process.platform === "win32" && existsSync(windowsNpxCli) ? process.execPath : "npx";
const args = command === process.execPath ? [windowsNpxCli, ...supabaseArgs] : supabaseArgs;
const result = spawnSync(command, args, { encoding: "utf8" });

if (result.error) {
  throw result.error;
}

if (result.status !== 0) {
  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  process.exit(result.status ?? 1);
}

writeFileSync(outputPath, result.stdout.endsWith("\n") ? result.stdout : `${result.stdout}\n`, {
  encoding: "utf8",
});
