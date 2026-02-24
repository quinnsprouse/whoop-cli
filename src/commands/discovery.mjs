import {
  AGENT_FILTER_OPTIONS,
  AGENT_OUTPUT_OPTIONS,
  COMMANDS,
  FILTERABLE_COMMANDS,
} from "../lib/command-manifest.mjs";

const WHOOP_AUTHORIZATION_URL = "https://api.prod.whoop.com/oauth/oauth2/auth";
const WHOOP_TOKEN_URL = "https://api.prod.whoop.com/oauth/oauth2/token";

export function buildDiscoveryPayload(level = 1, commandFilter = null) {
  const commandEntries = Object.entries(COMMANDS)
    .filter(([name]) => !commandFilter || name === commandFilter)
    .map(([name, def]) => ({
      name,
      summary: def.summary,
      usage: level >= 2 ? def.usage : undefined,
      supportsAgentFilters: FILTERABLE_COMMANDS.has(name),
      agentFilters: level >= 3 && FILTERABLE_COMMANDS.has(name) ? AGENT_FILTER_OPTIONS : undefined,
      agentOutputOptions:
        level >= 3 && FILTERABLE_COMMANDS.has(name) ? AGENT_OUTPUT_OPTIONS : undefined,
    }));

  const payload = {
    generatedAt: new Date().toISOString(),
    progressiveDisclosureLevel: level,
    discoveryFlow: {
      level1: "Choose auth command and required scopes.",
      level2: "Run data commands with --json for machine output.",
      level3:
        "Apply --from/--to/--type/--contains/--min-strain/--max-strain/--min-recovery/--max-recovery/--sort/--result-limit/--fields.",
    },
    firstSteps: [
      "node src/cli.mjs capabilities --json",
      "node src/cli.mjs login-local --open --json",
      "node src/cli.mjs login --json",
      "node src/cli.mjs whoami --json",
      "node src/cli.mjs workouts --days 14 --json",
      "node src/cli.mjs help workouts --json",
    ],
    commandCount: commandEntries.length,
    commands: commandEntries,
  };

  if (level >= 3) {
    payload.agentPatterns = [
      {
        pattern: "Find highest-strain workouts over last 30 days",
        command:
          "node src/cli.mjs workouts --days 30 --min-strain 12 --sort strain-desc --result-limit 20 --fields id,start,sport_name,score.strain --json",
      },
      {
        pattern: "Inspect poor recovery days",
        command:
          "node src/cli.mjs recoveries --days 60 --max-recovery 40 --sort recovery --fields cycle_id,created_at,score.recovery_score,score.resting_heart_rate --jsonl",
      },
      {
        pattern: "Summarize sleep window",
        command:
          "node src/cli.mjs sleep --from 2026-02-01 --to 2026-02-24 --fields id,start,end,score.sleep_performance_percentage,score.stage_summary.total_in_bed_time_milli --json",
      },
    ];
  }

  return payload;
}

export async function commandDiscover(flags, deps) {
  const { requirePositiveInteger, isJsonMode, writeOutput } = deps;
  const level = requirePositiveInteger(flags.level, 1);
  const boundedLevel = Math.min(Math.max(level, 1), 3);
  const commandFilter = flags.command ? String(flags.command).trim() : null;
  if (commandFilter && !COMMANDS[commandFilter]) {
    throw new Error(`Unknown command for --command: ${commandFilter}`);
  }

  const payload = buildDiscoveryPayload(boundedLevel, commandFilter);
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
  const { writeOutput } = deps;
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
    commands: Object.keys(COMMANDS),
    agentFeatures: {
      progressiveDisclosure: [
        "discover --level 1",
        "discover --level 2",
        "discover --level 3 --json",
        "help <command> --json",
      ],
      filterableCommands: Array.from(FILTERABLE_COMMANDS),
      filterOptions: AGENT_FILTER_OPTIONS,
      outputOptions: AGENT_OUTPUT_OPTIONS,
    },
    outputModes: ["text", "json", "jsonl"],
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
      "- WHOOP v2 endpoints for profile, body, cycles, recoveries, sleep, and workouts.",
      "- Pagination via next_token and query nextToken (max page size 25).",
      "- Agent-oriented filtering/projection with --fields and --records-only.",
    ].join("\n");
  });
}
