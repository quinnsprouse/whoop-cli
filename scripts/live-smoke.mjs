import path from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = path.resolve(import.meta.dirname, "..");
const cliPath = path.join(repoRoot, "src", "cli.mjs");

function runCli(args, options = {}) {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, ...options.env },
    input: options.input,
  });

  if (result.status !== 0) {
    const detail = [
      `Command failed: whoop-query-cli ${args.join(" ")}`,
      result.stdout?.trim() ? `stdout:\n${result.stdout.trim()}` : null,
      result.stderr?.trim() ? `stderr:\n${result.stderr.trim()}` : null,
    ]
      .filter(Boolean)
      .join("\n\n");
    throw new Error(detail);
  }

  return result;
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name}.`);
  }
  return value;
}

for (const name of ["WHOOP_CLIENT_ID", "WHOOP_CLIENT_SECRET", "WHOOP_REDIRECT_URI"]) {
  requireEnv(name);
}

console.log("1. capabilities");
runCli(["capabilities", "--json"]);

console.log("2. login-url");
runCli(["login-url", "--json"]);

if (process.env.WHOOP_AUTH_CODE) {
  console.log("3. exchange-code via stdin");
  runCli(["exchange-code", "--stdin", "--json"], {
    input: `${process.env.WHOOP_AUTH_CODE}\n`,
  });
} else {
  console.log("3. skipping exchange-code (set WHOOP_AUTH_CODE to exercise it)");
}

console.log("4. whoami");
runCli(["whoami", "--json"]);

console.log("5. workouts");
runCli(["workouts", "--days", "1", "--json"]);

console.log("6. day");
runCli(["day", "--json"]);

if (process.env.WHOOP_CYCLE_ID) {
  console.log("7. cycle-by-id via stdin");
  runCli(["cycle-by-id", "--stdin", "--json"], {
    input: `${process.env.WHOOP_CYCLE_ID}\n`,
  });
}

if (process.env.WHOOP_SLEEP_ID) {
  console.log("8. sleep-by-id via stdin");
  runCli(["sleep-by-id", "--stdin", "--json"], {
    input: `${process.env.WHOOP_SLEEP_ID}\n`,
  });
}

console.log("Live smoke test passed.");
