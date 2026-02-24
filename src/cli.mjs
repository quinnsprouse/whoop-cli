#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { WhoopClient } from "./whoop-client.mjs";
import {
  applyAgentRecordFilters,
  hasAgentRecordTransforms,
  toRecordsOnlyPayload,
} from "./lib/agent-filters.mjs";
import {
  AGENT_FILTER_OPTIONS,
  AGENT_OUTPUT_OPTIONS,
  COMMAND_FLAG_ALLOWLIST,
  COMMANDS,
  FILTERABLE_COMMANDS,
  GLOBAL_NOTES,
  PROJECT_NOTICE,
} from "./lib/command-manifest.mjs";
import {
  dateOnlyNowInTimeZone,
  formatDateTimeInTimeZone,
  isoDateShiftInTimeZone,
  normalizeTimeZone,
  parseApiDateTime,
  toDateOnlyInTimeZone,
  toUtcDateTimeForEndExclusive,
  toUtcDateTimeForStartOfDay,
} from "./lib/timezone.mjs";
import {
  commandExchangeCode,
  commandLogin,
  commandLoginLocal,
  commandLoginUrl,
  commandLogout,
  commandRefreshToken,
  commandRevoke,
  commandWhoAmI,
} from "./commands/auth.mjs";
import { commandCapabilities, commandDiscover, buildDiscoveryPayload } from "./commands/discovery.mjs";
import {
  commandCycles,
  commandDay,
  commandRecoveries,
  commandSleep,
  commandWorkouts,
} from "./commands/collections.mjs";
import {
  commandCycleRecovery,
  commandCycleSleep,
  commandSleepById,
  commandWorkoutById,
} from "./commands/endpoints.mjs";
import { commandBody, commandProfile } from "./commands/user.mjs";

let ACTIVE_TIME_ZONE = normalizeTimeZone();

function printGlobalHelp() {
  console.log("whoop-cli (unofficial)");
  console.log("");
  console.log("Commands:");
  for (const [name, def] of Object.entries(COMMANDS)) {
    console.log(`  ${name.padEnd(13)} ${def.summary}`);
  }
  console.log("");
  console.log("Global notes:");
  for (const note of GLOBAL_NOTES) console.log(`  - ${note}`);
  console.log("");
  console.log("Progressive disclosure:");
  console.log("  node src/cli.mjs discover --level 1");
  console.log("  node src/cli.mjs discover --level 2");
  console.log("  node src/cli.mjs discover --command workouts --level 3 --json");
  console.log("");
  console.log("Examples:");
  console.log("  node src/cli.mjs login-local --open");
  console.log("  node src/cli.mjs login --open");
  console.log("  node src/cli.mjs exchange-code --code <authorization_code>");
  console.log("  node src/cli.mjs whoami --json");
  console.log("  node src/cli.mjs workouts --days 30 --min-strain 10 --sort strain-desc --json");
  console.log("  node src/cli.mjs sleep-by-id --sleep-id <uuid> --json");
  console.log("  node src/cli.mjs cycle-recovery --cycle-id 123456 --json");
  console.log("  node src/cli.mjs day --date 2026-02-24 --include-records --json");
}

function levenshteinDistance(left, right) {
  const a = left.toLowerCase();
  const b = right.toLowerCase();
  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix = Array.from({ length: rows }, () => new Array(cols).fill(0));

  for (let i = 0; i < rows; i += 1) matrix[i][0] = i;
  for (let j = 0; j < cols; j += 1) matrix[0][j] = j;

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }

  return matrix[a.length][b.length];
}

function getCommandSuggestions(input, max = 3) {
  const value = String(input ?? "").trim().toLowerCase();
  if (!value) return [];
  const commands = Object.keys(COMMANDS);

  const prefixMatches = commands.filter((name) => name.toLowerCase().startsWith(value));
  if (prefixMatches.length > 0) return prefixMatches.slice(0, max);

  const ranked = commands
    .map((name) => ({ name, distance: levenshteinDistance(value, name) }))
    .sort((a, b) => a.distance - b.distance || a.name.localeCompare(b.name));

  const threshold = Math.max(2, Math.floor(value.length / 3));
  return ranked
    .filter((item) => item.distance <= threshold)
    .slice(0, max)
    .map((item) => item.name);
}

function getFlagSuggestions(input, allowedFlags, max = 3) {
  const value = String(input ?? "").trim().replace(/^--/, "").toLowerCase();
  const candidates = Array.isArray(allowedFlags) ? allowedFlags : Array.from(allowedFlags ?? []);
  if (!value || candidates.length === 0) return [];

  const prefixMatches = candidates.filter((name) => name.startsWith(value));
  if (prefixMatches.length > 0) return prefixMatches.slice(0, max);

  const ranked = candidates
    .map((name) => ({ name, distance: levenshteinDistance(value, name) }))
    .sort((a, b) => a.distance - b.distance || a.name.localeCompare(b.name));

  const threshold = Math.max(2, Math.floor(value.length / 3));
  return ranked
    .filter((item) => item.distance <= threshold)
    .slice(0, max)
    .map((item) => item.name);
}

function formatUnknownCommandMessage(input) {
  const suggestions = getCommandSuggestions(input);
  const lines = [`unknown command "${input}" for "whoop-cli"`];
  if (suggestions.length === 1) {
    lines.push("", "Did you mean this?", `  ${suggestions[0]}`);
  } else if (suggestions.length > 1) {
    lines.push("", "Did you mean one of these?");
    for (const suggestion of suggestions) lines.push(`  ${suggestion}`);
  }
  lines.push("", 'Run "whoop-cli help" for available commands.');
  return lines.join("\n");
}

function formatUnknownFlagMessage(command, unknownFlags, allowedFlags) {
  const flags = Array.isArray(unknownFlags) ? unknownFlags : [unknownFlags];
  const normalizedAllowed = Array.from(new Set((allowedFlags ?? []).map((flag) => String(flag)))).sort();
  const lines = [
    `unknown flag${flags.length > 1 ? "s" : ""} for "whoop-cli ${command}": ${flags.map((flag) => `--${flag}`).join(", ")}`,
  ];

  for (const flag of flags) {
    const suggestions = getFlagSuggestions(flag, normalizedAllowed);
    if (suggestions.length === 1) {
      lines.push("", `Did you mean --${suggestions[0]} for --${flag}?`);
    } else if (suggestions.length > 1) {
      lines.push("", `Suggestions for --${flag}:`);
      for (const suggestion of suggestions) lines.push(`  --${suggestion}`);
    }
  }

  if (normalizedAllowed.length > 0) {
    lines.push("", `Allowed flags: ${normalizedAllowed.map((flag) => `--${flag}`).join(", ")}`);
  } else {
    lines.push("", "Allowed flags: none");
  }

  const helpCommand = command === "help" ? "whoop-cli help" : `whoop-cli help ${command}`;
  lines.push("", `Run "${helpCommand}" for usage.`);
  return lines.join("\n");
}

function validateCommandFlags(command, flags) {
  const allowlist = COMMAND_FLAG_ALLOWLIST[command];
  if (!allowlist) return { unknownFlags: [] };
  const unknownFlags = Object.keys(flags).filter((flag) => !allowlist.has(flag));
  return { unknownFlags, allowlist: Array.from(allowlist) };
}

function printCommandHelp(command, flags = {}) {
  const def = COMMANDS[command];
  if (!def) {
    console.error(formatUnknownCommandMessage(command));
    return 1;
  }

  if (flags.json) {
    const payload = {
      command,
      summary: def.summary,
      usage: def.usage,
      timezoneOption: "--tz <IANA timezone> (defaults to WHOOP_TIMEZONE or system timezone)",
      supportsAgentFilters: FILTERABLE_COMMANDS.has(command),
      agentFilterOptions: FILTERABLE_COMMANDS.has(command) ? AGENT_FILTER_OPTIONS : [],
      agentOutputOptions: FILTERABLE_COMMANDS.has(command) ? AGENT_OUTPUT_OPTIONS : [],
      outputModes: ["text", "json", "jsonl"],
    };
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return 0;
  }

  console.log(`whoop-cli ${command} (unofficial)`);
  console.log("");
  console.log(def.summary);
  console.log(PROJECT_NOTICE);
  console.log("");
  console.log("Usage:");
  for (const line of def.usage) console.log(`  ${line}`);
  console.log("");
  console.log("Timezone:");
  console.log("  --tz <IANA timezone> Override local-day bucketing (defaults: WHOOP_TIMEZONE or system timezone). ");

  if (FILTERABLE_COMMANDS.has(command)) {
    console.log("");
    console.log("Agent filters:");
    for (const option of AGENT_FILTER_OPTIONS) {
      console.log(`  ${option.flag.padEnd(18)} ${option.description}`);
    }
    console.log("Agent output options:");
    for (const option of AGENT_OUTPUT_OPTIONS) {
      console.log(`  ${option.flag.padEnd(18)} ${option.description}`);
    }
  }

  return 0;
}

function parseArgs(argv) {
  const command = argv[2] ?? null;
  const args = argv.slice(3);
  const flags = {};
  const positionals = [];

  for (let i = 0; i < args.length; i += 1) {
    const part = args[i];
    if (!part.startsWith("--")) {
      positionals.push(part);
      continue;
    }

    const key = part.slice(2);
    const next = args[i + 1];
    if (!next || next.startsWith("--")) {
      flags[key] = true;
      continue;
    }

    flags[key] = next;
    i += 1;
  }

  return { command, flags, positionals };
}

function normalizeDateOnlyInput(value, fallback) {
  if (value == null || value === "") return fallback;
  const normalized = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new Error(`Invalid date "${value}". Expected YYYY-MM-DD.`);
  }
  return normalized;
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

function isJsonMode(flags) {
  return Boolean(flags.json || flags.jsonl);
}

function isoDateShift(days) {
  return isoDateShiftInTimeZone(days, ACTIVE_TIME_ZONE);
}

function withTimeZoneMeta(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  if (payload.timeZone != null) return payload;
  return { ...payload, timeZone: ACTIVE_TIME_ZONE };
}

async function writeOutput(payload, flags, textRenderer = null) {
  const payloadWithTimeZone = withTimeZoneMeta(payload);

  if (flags.jsonl) {
    const records = Array.isArray(payloadWithTimeZone?.records)
      ? payloadWithTimeZone.records
      : Array.isArray(payloadWithTimeZone)
        ? payloadWithTimeZone
        : [];
    const content = records.map((item) => JSON.stringify(item)).join("\n");
    if (flags.output) {
      await fs.writeFile(flags.output, `${content}${content ? "\n" : ""}`, "utf8");
      console.log(`Wrote JSONL to ${flags.output}`);
      return;
    }
    if (content) console.log(content);
    return;
  }

  if (flags.json || typeof payloadWithTimeZone !== "string") {
    const content =
      typeof payloadWithTimeZone === "string"
        ? payloadWithTimeZone
        : `${JSON.stringify(payloadWithTimeZone, null, 2)}\n`;
    if (flags.output) {
      await fs.writeFile(flags.output, content, "utf8");
      console.log(`Wrote JSON to ${flags.output}`);
      return;
    }
    process.stdout.write(content);
    return;
  }

  const text = textRenderer ? textRenderer(payloadWithTimeZone) : String(payloadWithTimeZone);
  if (flags.output) {
    await fs.writeFile(flags.output, `${text}\n`, "utf8");
    console.log(`Wrote text to ${flags.output}`);
    return;
  }
  console.log(text);
}

async function withClient(flags) {
  const sessionFile =
    flags["session-file"] ??
    process.env.WHOOP_SESSION_FILE ??
    path.resolve(".whoop", "session.json");

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
  const { command, flags, positionals } = parseArgs(process.argv);

  if (!command) {
    printGlobalHelp();
    process.exit(0);
  }

  if (!COMMANDS[command]) {
    console.error(formatUnknownCommandMessage(command));
    process.exit(1);
  }

  const { unknownFlags, allowlist } = validateCommandFlags(command, flags);
  if (unknownFlags.length > 0) {
    console.error(formatUnknownFlagMessage(command, unknownFlags, allowlist));
    process.exit(1);
  }

  ACTIVE_TIME_ZONE = normalizeTimeZone(flags.tz ?? null);
  process.env.WHOOP_TIMEZONE = ACTIVE_TIME_ZONE;

  if (command === "help") {
    if (positionals[0]) {
      process.exit(printCommandHelp(positionals[0], flags));
    }
    if (flags.json) {
      const payload = buildDiscoveryPayload(2, null);
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
    timeZone: ACTIVE_TIME_ZONE,
    applyAgentRecordFilters,
    toRecordsOnlyPayload,
    hasAgentRecordTransforms,
    isJsonMode,
    writeOutput,
    requirePositiveInteger,
    requireNumber,
    normalizeDateOnlyInput,
    isoDateShift,
    withClient,
    sortByDateAsc,
    sortByDateDesc,
    dateOnlyNowInTimeZone,
    parseApiDateTime,
    toDateOnlyInTimeZone,
    formatDateTimeInTimeZone,
    toUtcDateTimeForStartOfDay,
    toUtcDateTimeForEndExclusive,
  };

  switch (command) {
    case "discover":
      await commandDiscover(flags, commandDeps);
      return;
    case "capabilities":
      await commandCapabilities(flags, commandDeps);
      return;
    case "login-url":
      await commandLoginUrl(flags, commandDeps);
      return;
    case "login":
      await commandLogin(flags, commandDeps);
      return;
    case "login-local":
      await commandLoginLocal(flags, commandDeps);
      return;
    case "exchange-code":
      await commandExchangeCode(flags, commandDeps);
      return;
    case "refresh-token":
      await commandRefreshToken(flags, commandDeps);
      return;
    case "whoami":
      await commandWhoAmI(flags, commandDeps);
      return;
    case "profile":
      await commandProfile(flags, commandDeps);
      return;
    case "body":
      await commandBody(flags, commandDeps);
      return;
    case "cycles":
      await commandCycles(flags, commandDeps);
      return;
    case "recoveries":
      await commandRecoveries(flags, commandDeps);
      return;
    case "sleep":
      await commandSleep(flags, commandDeps);
      return;
    case "workouts":
      await commandWorkouts(flags, commandDeps);
      return;
    case "sleep-by-id":
      await commandSleepById(flags, commandDeps);
      return;
    case "workout-by-id":
      await commandWorkoutById(flags, commandDeps);
      return;
    case "cycle-recovery":
      await commandCycleRecovery(flags, commandDeps);
      return;
    case "cycle-sleep":
      await commandCycleSleep(flags, commandDeps);
      return;
    case "day":
      await commandDay(flags, commandDeps);
      return;
    case "revoke":
      await commandRevoke(flags, commandDeps);
      return;
    case "logout":
      await commandLogout(flags, commandDeps);
      return;
    default:
      throw new Error(`Unhandled command: ${command}`);
  }
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
    console.error("Tip: run whoop-cli login, approve app access, then run whoop-cli exchange-code --code <authorization_code>.");
    console.error("Tip: for one-step local auth, use whoop-cli login-local --open with a localhost redirect URI.");
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
  if (message.includes("Invalid date \"")) {
    console.error("Tip: expected date format is YYYY-MM-DD");
  }
  if (message.includes("Invalid timezone \"")) {
    console.error("Tip: use an IANA timezone like America/New_York.");
  }
  console.error('Run "whoop-cli help" or "whoop-cli help <command>" for usage.');

  if (process.env.WHOOP_CLI_DEBUG === "1" && error?.stack) {
    console.error("");
    console.error(error.stack);
  }

  process.exit(1);
});
