import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = path.resolve(import.meta.dirname, "..");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    ...options,
  });

  if (result.status !== 0) {
    throw new Error(
      [
        `Command failed: ${command} ${args.join(" ")}`,
        result.stdout?.trim() ? `stdout:\n${result.stdout.trim()}` : null,
        result.stderr?.trim() ? `stderr:\n${result.stderr.trim()}` : null,
      ]
        .filter(Boolean)
        .join("\n\n"),
    );
  }

  return result;
}

function binPath(prefix, name) {
  const suffix = process.platform === "win32" ? ".cmd" : "";
  return path.join(prefix, "bin", `${name}${suffix}`);
}

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "whoop-cli-package-smoke-"));
let tarballPath = null;

try {
  const packResult = run("npm", ["pack", "--silent"]);
  const tarballName = packResult.stdout.trim().split("\n").filter(Boolean).at(-1);
  tarballPath = path.join(repoRoot, tarballName);

  const prefix = path.join(tmpDir, "prefix");
  run("npm", ["install", "--global", "--prefix", prefix, tarballPath]);

  const helpOutput = run(binPath(prefix, "whoop-query-cli"), ["help"]).stdout;
  assert.match(helpOutput, /whoop-query-cli \(unofficial\)/);
  assert.match(helpOutput, /Commands:/);

  const aliasOutput = run(binPath(prefix, "wqcli"), ["help", "workouts"]).stdout;
  assert.match(aliasOutput, /Examples:/);
  assert.match(aliasOutput, /--days <n>/);

  console.log("Package smoke test passed.");
} finally {
  if (tarballPath) {
    await fs.rm(tarballPath, { force: true });
  }
  await fs.rm(tmpDir, { recursive: true, force: true });
}
