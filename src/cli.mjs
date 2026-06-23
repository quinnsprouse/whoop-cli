#!/usr/bin/env node

import os from "node:os";
import path from "node:path";
import process from "node:process";
import { WhoopClient } from "./whoop-client.mjs";
import {
  applyAgentRecordFilters,
  hasAgentRecordTransforms,
} from "./lib/agent-filters.mjs";
import {
  createAgentOutput,
  toRecordsOnlyPayload,
} from "./lib/agent-output.mjs";
import {
  CLI_NAME,
} from "./lib/project-info.mjs";
import {
  formatDateTimeInTimeZone,
  normalizeTimeZone,
  parseApiDateTime,
  toDateOnlyInTimeZone,
} from "./lib/timezone.mjs";
import { commandRegistry } from "./commands/registry.mjs";

let ACTIVE_TIME_ZONE = normalizeTimeZone();

function printGlobalHelp() {
  console.log(commandRegistry.formatGlobalHelp());
}

function getCommandSuggestions(input, max = 3) {
  return commandRegistry.getCommandSuggestions(input, max);
}

function formatUnknownCommandMessage(input) {
  return commandRegistry.formatUnknownCommand(input);
}

function printCommandHelp(command, flags = {}) {
  const result = commandRegistry.formatCommandHelp(command, flags);
  if (!result.ok) {
    console.error(result.text);
    return 1;
  }
  process.stdout.write(`${result.text}\n`);
  return 0;
}

function requireNumber(value, fallback) {
  if (value == null) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

function requirePositiveInteger(value, fallback) {
  const parsed = requireNumber(value, fallback);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return parsed;
}

async function withClient(flags) {
  const sessionFile =
    flags["session-file"] ??
    process.env.WHOOP_SESSION_FILE ??
    path.resolve(os.homedir(), ".whoop", "session.json");

  const client = new WhoopClient({
    clientId: flags["client-id"] ?? process.env.WHOOP_CLIENT_ID ?? null,
    clientSecret: flags["client-secret"] ?? process.env.WHOOP_CLIENT_SECRET ?? null,
    redirectUri: flags["redirect-uri"] ?? process.env.WHOOP_REDIRECT_URI ?? null,
    scopes: flags.scopes ?? process.env.WHOOP_SCOPE ?? null,
    sessionFile,
  });

  await client.loadSession();
  return client;
}

function sortByDateAsc(records) {
  return [...(Array.isArray(records) ? records : [])].sort((a, b) => {
    const left = String(a?.localDate ?? a?.dateOnly ?? a?.start ?? a?.created_at ?? "");
    const right = String(b?.localDate ?? b?.dateOnly ?? b?.start ?? b?.created_at ?? "");
    return left.localeCompare(right);
  });
}

function sortByDateDesc(records) {
  return [...(Array.isArray(records) ? records : [])].sort((a, b) => {
    const left = String(a?.localDate ?? a?.dateOnly ?? a?.start ?? a?.created_at ?? "");
    const right = String(b?.localDate ?? b?.dateOnly ?? b?.start ?? b?.created_at ?? "");
    return right.localeCompare(left);
  });
}

async function main() {
  const parsedArgs = commandRegistry.parseArgv(process.argv);
  const { command, positionals } = parsedArgs;
  let { flags } = parsedArgs;
  let stdinTextPromise = null;

  const readStdinText = async () => {
    if (stdinTextPromise) return stdinTextPromise;
    if (process.stdin.isTTY) {
      throw new Error("--stdin was provided, but no piped stdin data was detected.");
    }

    stdinTextPromise = new Promise((resolve, reject) => {
      const chunks = [];
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (chunk) => chunks.push(chunk));
      process.stdin.on("end", () => resolve(chunks.join("")));
      process.stdin.on("error", reject);
    });

    return stdinTextPromise;
  };

  if (!command) {
    printGlobalHelp();
    process.exit(0);
  }

  if (!commandRegistry.has(command)) {
    console.error(formatUnknownCommandMessage(command));
    process.exit(1);
  }

  try {
    flags = commandRegistry.acceptFlags(command, flags);
  } catch (error) {
    if (error?.code === "WHOOP_CLI_UNKNOWN_FLAGS") {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }

  ACTIVE_TIME_ZONE = normalizeTimeZone(flags.tz ?? null);
  process.env.WHOOP_TIMEZONE = ACTIVE_TIME_ZONE;

  if (command === "help") {
    if (positionals[0]) {
      process.exit(printCommandHelp(positionals[0], flags));
    }
    if (flags.json) {
      const payload = commandRegistry.buildDiscoveryPayload(2, null);
      process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
      process.exit(0);
    }
    printGlobalHelp();
    process.exit(0);
  }

  if (flags.help) {
    process.exit(printCommandHelp(command, flags));
  }

  const commandDeps = {
    agentOutput: createAgentOutput({ timeZone: () => ACTIVE_TIME_ZONE }),
    commandRegistry,
    timeZone: ACTIVE_TIME_ZONE,
    applyAgentRecordFilters,
    toRecordsOnlyPayload,
    hasAgentRecordTransforms,
    readStdinText,
    requirePositiveInteger,
    withClient,
    sortByDateAsc,
    sortByDateDesc,
    parseApiDateTime,
    toDateOnlyInTimeZone,
    formatDateTimeInTimeZone,
  };
  commandDeps.isJsonMode = commandDeps.agentOutput.isJsonMode;
  commandDeps.writeOutput = commandDeps.agentOutput.writeOutput;

  await commandRegistry.run(command, { flags, deps: commandDeps, acceptedFlags: true });
}

main().catch((error) => {
  const message = String(error?.message ?? error ?? "Unknown error");
  console.error(`Error: ${message}`);

  const unknownDiscoverCommandMatch = message.match(/^Unknown command for --command:\s*(.+)$/);
  if (unknownDiscoverCommandMatch) {
    const bad = unknownDiscoverCommandMatch[1].trim();
    const suggestions = getCommandSuggestions(bad);
    if (suggestions.length > 0) {
      console.error("Did you mean:");
      for (const suggestion of suggestions) console.error(`  ${suggestion}`);
    }
  }

  if (message.includes("No access token found")) {
    console.error(`Tip: run ${CLI_NAME} login, approve app access, then run ${CLI_NAME} exchange-code --code <authorization_code>.`);
    console.error(`Tip: for one-step local auth, use ${CLI_NAME} login-local --open with a localhost redirect URI.`);
  }
  if (message.includes("Missing WHOOP client ID")) {
    console.error("Tip: set WHOOP_CLIENT_ID or pass --client-id.");
  }
  if (message.includes("Missing WHOOP client secret")) {
    console.error("Tip: set WHOOP_CLIENT_SECRET or pass --client-secret.");
  }
  if (message.includes("Missing WHOOP redirect URI")) {
    console.error("Tip: set WHOOP_REDIRECT_URI or pass --redirect-uri.");
  }
  if (message.includes("login-local requires")) {
    console.error("Tip: set WHOOP_REDIRECT_URI to something like http://localhost:8787/callback");
  }
  if (message.includes("--stdin was provided")) {
    console.error(`Tip: pipe a value, for example: printf '%s\\n' \"value\" | ${CLI_NAME} <command> --stdin`);
  }
  if (message.includes("Re-run with --yes to continue")) {
    console.error(`Tip: use --dry-run to preview destructive commands and --yes or --force to execute them.`);
  }
  if (message.includes("Invalid date \"")) {
    console.error("Tip: expected date format is YYYY-MM-DD");
  }
  if (message.includes("Invalid timezone \"")) {
    console.error("Tip: use an IANA timezone like America/New_York.");
  }
  if (message.includes("Invalid WHOOP base URL")) {
    console.error("Tip: WHOOP_BASE_URL must be an absolute URL such as https://api.prod.whoop.com");
  }
  console.error(`Run "${CLI_NAME} help" or "${CLI_NAME} help <command>" for usage.`);

  if (process.env.WHOOP_CLI_DEBUG === "1" && error?.stack) {
    console.error("");
    console.error(error.stack);
  }

  process.exit(1);
});
