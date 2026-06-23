import {
  JSON_OUTPUT_OPTIONS,
  option,
} from "../lib/command-options.mjs";
import { CLI_NAME } from "../lib/project-info.mjs";

const WHOOP_AUTHORIZATION_URL = "https://api.prod.whoop.com/oauth/oauth2/auth";
const WHOOP_TOKEN_URL = "https://api.prod.whoop.com/oauth/oauth2/token";

function requireCommandRegistry(commandRegistry) {
  if (!commandRegistry) {
    throw new Error("Command registry is required for discovery commands.");
  }
  return commandRegistry;
}

export function buildDiscoveryPayload(level = 1, commandFilter = null, commandRegistry = null) {
  return requireCommandRegistry(commandRegistry).buildDiscoveryPayload(level, commandFilter);
}

export async function commandDiscover(flags, deps) {
  const {
    commandRegistry,
    requirePositiveInteger,
    isJsonMode,
    writeOutput,
  } = deps;
  const registry = requireCommandRegistry(commandRegistry);
  const level = requirePositiveInteger(flags.level, 1);
  const boundedLevel = Math.min(Math.max(level, 1), 3);
  const commandFilter = flags.command ? String(flags.command).trim() : null;
  if (commandFilter && !registry.has(commandFilter)) {
    throw new Error(`Unknown command for --command: ${commandFilter}`);
  }

  const payload = buildDiscoveryPayload(boundedLevel, commandFilter, registry);
  if (!isJsonMode(flags)) {
    await writeOutput(payload, flags, (value) => {
      const lines = [
        `Discovery level: ${value.progressiveDisclosureLevel}`,
        "Flow:",
        `- L1: ${value.discoveryFlow.level1}`,
        `- L2: ${value.discoveryFlow.level2}`,
        `- L3: ${value.discoveryFlow.level3}`,
        `Commands returned: ${value.commandCount}`,
      ];
      for (const command of value.commands) {
        lines.push(`- ${command.name}: ${command.summary}`);
      }
      lines.push("Tip: add --json for structured discovery payload.");
      return lines.join("\n");
    });
    return;
  }

  await writeOutput(payload, { ...flags, json: !flags.jsonl });
}

export async function commandCapabilities(flags, deps) {
  const { commandRegistry, writeOutput } = deps;
  const registry = requireCommandRegistry(commandRegistry);
  const payload = {
    generatedAt: new Date().toISOString(),
    authMode: {
      method: "OAuth2 Authorization Code",
      authorizationUrl: WHOOP_AUTHORIZATION_URL,
      tokenUrl: WHOOP_TOKEN_URL,
      refreshNotes: [
        "Request offline scope to receive refresh_token",
        "Refreshing invalidates previous access and refresh tokens",
      ],
    },
    scopes: {
      "read:profile": "Read basic profile (name/email/user_id)",
      "read:body_measurement": "Read body measurements (height/weight/max HR)",
      "read:workout": "Read workout activities",
      "read:sleep": "Read sleep activities",
      "read:recovery": "Read recovery activities",
      "read:cycles": "Read cycle activities",
      offline: "Request refresh_token for long-running access",
    },
    endpointCoverage: {
      profile: ["GET /v2/user/profile/basic", "GET /v2/user/measurement/body"],
      collections: [
        "GET /v2/cycle",
        "GET /v2/recovery",
        "GET /v2/activity/sleep",
        "GET /v2/activity/workout",
      ],
      byId: [
        "GET /v2/cycle/{cycleId}",
        "GET /v2/cycle/{cycleId}/recovery",
        "GET /v2/cycle/{cycleId}/sleep",
        "GET /v2/activity/sleep/{sleepId}",
        "GET /v2/activity/sleep/{sleepId}/stream",
        "GET /v2/activity/workout/{workoutId}",
      ],
      accountControl: ["DELETE /v2/user/access"],
    },
    pagination: {
      query: ["limit", "start", "end", "nextToken"],
      responseField: "next_token",
      maxPageSize: 25,
    },
    rateLimits: {
      default: ["100 requests/minute", "10,000 requests/day"],
      headers: ["X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset"],
      limitResponse: "429 Too Many Requests",
    },
    commands: registry.names(),
    agentFeatures: {
      progressiveDisclosure: [
        "discover --level 1",
        "discover --level 2",
        "discover --level 3 --json",
        "help <command> --json",
      ],
      filterableCommands: Array.from(registry.filterableCommands),
      filterOptions: registry.agentFilterOptions,
      outputOptions: registry.agentOutputOptions,
    },
    outputModes: registry.outputModes,
    timezone: {
      flag: "--tz <IANA timezone>",
      environment: "WHOOP_TIMEZONE",
      example: "America/New_York",
    },
  };

  await writeOutput(payload, flags, () => {
    return [
      "Capabilities:",
      "- OAuth2 authorization-code auth with refresh token support.",
      "- login-local provides automatic code capture with localhost redirect URIs.",
      "- WHOOP v2 endpoints for profile, body, cycles, recoveries, sleep, sleep streams, and workouts.",
      "- Pagination via next_token and query nextToken (max page size 25).",
      "- Agent-oriented filtering/projection with --fields and --records-only.",
    ].join("\n");
  });
}

export const discoveryCommandRegistrations = {
  discover: {
    name: "discover",
    summary: "Agent-oriented command discovery with progressive disclosure levels.",
    usage: [
      `${CLI_NAME} discover`,
      `${CLI_NAME} discover --level 1|2|3 [--json]`,
      `${CLI_NAME} discover --command workouts --level 3 --json`,
    ],
    options: [
      option(
        "--level <n>",
        "Discovery depth: 1 (command list), 2 (usage), 3 (filters + patterns).",
        { type: "integer", min: 1 },
      ),
      option("--command <name>", "Limit the payload to one command."),
      ...JSON_OUTPUT_OPTIONS,
    ],
    examples: [
      `${CLI_NAME} discover --level 1`,
      `${CLI_NAME} discover --level 3 --json`,
      `${CLI_NAME} discover --command workouts --level 3 --json`,
    ],
    handler: commandDiscover,
  },
  capabilities: {
    name: "capabilities",
    summary: "Show auth, scope, endpoint, and rate-limit capabilities.",
    usage: [`${CLI_NAME} capabilities [--json]`],
    options: [...JSON_OUTPUT_OPTIONS],
    examples: [`${CLI_NAME} capabilities`, `${CLI_NAME} capabilities --json`],
    handler: commandCapabilities,
  },
};
