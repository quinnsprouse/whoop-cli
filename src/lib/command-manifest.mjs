export const CLI_NAME = "whoop-query-cli";

function option(flag, description) {
  return { flag, description };
}

const TIMEZONE_OPTION = option(
  "--tz <IANA timezone>",
  "Override local-day bucketing (defaults to WHOOP_TIMEZONE or system timezone).",
);

const OUTPUT_FILE_OPTION = option(
  "--output <path>",
  "Write output to a file instead of stdout.",
);

const STRUCTURED_OUTPUT_OPTIONS = [
  option("--json", "Return structured JSON."),
  option("--jsonl", "Emit one record per line."),
  option("--csv", "Emit CSV rows."),
  OUTPUT_FILE_OPTION,
];

const JSON_OUTPUT_OPTIONS = [option("--json", "Return structured JSON."), OUTPUT_FILE_OPTION];

const AUTH_CLIENT_OPTIONS = [
  option("--client-id <id>", "Override WHOOP_CLIENT_ID."),
  option("--client-secret <secret>", "Override WHOOP_CLIENT_SECRET."),
  option("--redirect-uri <url>", "Override WHOOP_REDIRECT_URI."),
  option("--scopes <csv>", "Override requested scopes."),
  option("--session-file <path>", "Override session file path."),
];

const COLLECTION_WINDOW_OPTIONS = [
  option("--days <n>", "Number of local days to include when --from/--to are omitted (default: 30)."),
  option("--from <YYYY-MM-DD>", "Inclusive local-date lower bound."),
  option("--to <YYYY-MM-DD>", "Inclusive local-date upper bound."),
  option("--start <ISO>", "Explicit UTC/ISO start date-time. Requires --end."),
  option("--end <ISO>", "Explicit UTC/ISO end date-time. Requires --start."),
  option("--limit <n>", "Page size per WHOOP API request (max: 25)."),
  option("--next-token <token>", "Resume pagination from a previous response."),
  option("--all-pages", "Follow WHOOP next_token values until exhausted."),
];

const STDIN_OPTION = option(
  "--stdin",
  "Read the primary input value from stdin instead of the required flag.",
);

const DRY_RUN_OPTION = option(
  "--dry-run",
  "Preview the effect of the command without changing remote or local state.",
);

const YES_OPTION = option(
  "--yes",
  "Confirm the destructive action without prompting.",
);

const FORCE_OPTION = option(
  "--force",
  "Alias for --yes.",
);

export const COMMANDS = {
  help: {
    summary: "Show global help or command help.",
    usage: [
      `${CLI_NAME} help`,
      `${CLI_NAME} help <command>`,
      `${CLI_NAME} <command> --help`,
    ],
    options: [option("--json", "Return structured command metadata.")],
    examples: [
      `${CLI_NAME} help workouts`,
      `${CLI_NAME} help login-local`,
      `${CLI_NAME} help workouts --json`,
    ],
  },
  discover: {
    summary: "Agent-oriented command discovery with progressive disclosure levels.",
    usage: [
      `${CLI_NAME} discover`,
      `${CLI_NAME} discover --level 1|2|3 [--json]`,
      `${CLI_NAME} discover --command workouts --level 3 --json`,
    ],
    options: [
      option("--level <n>", "Discovery depth: 1 (command list), 2 (usage), 3 (filters + patterns)."),
      option("--command <name>", "Limit the payload to one command."),
      ...JSON_OUTPUT_OPTIONS,
    ],
    examples: [
      `${CLI_NAME} discover --level 1`,
      `${CLI_NAME} discover --level 3 --json`,
      `${CLI_NAME} discover --command workouts --level 3 --json`,
    ],
  },
  capabilities: {
    summary: "Show auth, scope, endpoint, and rate-limit capabilities.",
    usage: [`${CLI_NAME} capabilities [--json]`],
    options: [...JSON_OUTPUT_OPTIONS],
    examples: [`${CLI_NAME} capabilities`, `${CLI_NAME} capabilities --json`],
  },
  "login-url": {
    summary: "Build OAuth authorization URL and persist pending auth metadata.",
    usage: [
      `${CLI_NAME} login-url [--scopes read:profile,read:workout,offline] [--state <8chars>] [--open]`,
    ],
    options: [
      ...AUTH_CLIENT_OPTIONS,
      option("--state <8chars>", "Set a WHOOP-compliant 8-character OAuth state value."),
      option("--open", "Open the authorization URL in your default browser."),
      ...JSON_OUTPUT_OPTIONS,
    ],
    examples: [
      `${CLI_NAME} login-url --open`,
      `${CLI_NAME} login-url --scopes read:profile,read:workout,offline --json`,
      `${CLI_NAME} login-url --state ABCD1234`,
    ],
  },
  login: {
    summary: "Alias for login-url with setup guidance for code exchange.",
    usage: [
      `${CLI_NAME} login [--scopes read:profile,read:workout,offline] [--state <8chars>] [--open]`,
    ],
    options: [
      ...AUTH_CLIENT_OPTIONS,
      option("--state <8chars>", "Set a WHOOP-compliant 8-character OAuth state value."),
      option("--open", "Open the authorization URL in your default browser."),
      ...JSON_OUTPUT_OPTIONS,
    ],
    examples: [
      `${CLI_NAME} login --open`,
      `${CLI_NAME} login --scopes read:profile,read:body_measurement,offline --json`,
      `${CLI_NAME} exchange-code --code <authorization_code> --json`,
    ],
  },
  "login-local": {
    summary: "Run local callback server, capture code automatically, and exchange tokens.",
    usage: [
      `${CLI_NAME} login-local [--scopes read:profile,read:workout,offline] [--state <8chars>] [--timeout-seconds <n>] [--open true|false]`,
    ],
    options: [
      ...AUTH_CLIENT_OPTIONS,
      option("--state <8chars>", "Set a WHOOP-compliant 8-character OAuth state value."),
      option("--timeout-seconds <n>", "Abort if the localhost OAuth callback does not arrive in time."),
      option("--open true|false", "Control whether the browser opens automatically (default: true)."),
      ...JSON_OUTPUT_OPTIONS,
    ],
    examples: [
      `${CLI_NAME} login-local --open`,
      `${CLI_NAME} login-local --timeout-seconds 300 --json`,
      `${CLI_NAME} login-local --scopes read:profile,read:sleep,offline`,
    ],
  },
  "exchange-code": {
    summary: "Exchange OAuth authorization code for access and refresh tokens.",
    usage: [
      `${CLI_NAME} exchange-code --code <authorization_code> [--state <8chars>]`,
      `${CLI_NAME} exchange-code --stdin [--state <8chars>]`,
    ],
    options: [
      ...AUTH_CLIENT_OPTIONS,
      option("--code <authorization_code>", "Authorization code returned by WHOOP."),
      option("--state <8chars>", "Optional state override when validating pending auth."),
      STDIN_OPTION,
      ...JSON_OUTPUT_OPTIONS,
    ],
    examples: [
      `${CLI_NAME} exchange-code --code <authorization_code> --json`,
      `printf '%s\\n' "$WHOOP_AUTH_CODE" | ${CLI_NAME} exchange-code --stdin --json`,
    ],
    stdin: {
      description: "Pipe the authorization code as plain text.",
      examples: [`printf '%s\\n' "$WHOOP_AUTH_CODE" | ${CLI_NAME} exchange-code --stdin --json`],
    },
  },
  "refresh-token": {
    summary: "Refresh current access token using refresh token and persist session.",
    usage: [`${CLI_NAME} refresh-token [--json]`],
    options: [...AUTH_CLIENT_OPTIONS, ...JSON_OUTPUT_OPTIONS],
    examples: [`${CLI_NAME} refresh-token`, `${CLI_NAME} refresh-token --json`],
  },
  whoami: {
    summary: "Fetch authenticated WHOOP basic profile from /v2/user/profile/basic.",
    usage: [`${CLI_NAME} whoami [--json|--csv]`],
    options: [...AUTH_CLIENT_OPTIONS, ...STRUCTURED_OUTPUT_OPTIONS],
    examples: [`${CLI_NAME} whoami --json`, `${CLI_NAME} whoami --csv`],
  },
  profile: {
    summary: "Fetch authenticated WHOOP basic profile.",
    usage: [`${CLI_NAME} profile [--json|--csv]`],
    options: [...AUTH_CLIENT_OPTIONS, ...STRUCTURED_OUTPUT_OPTIONS],
    examples: [`${CLI_NAME} profile --json`, `${CLI_NAME} profile --csv`],
  },
  body: {
    summary: "Fetch authenticated WHOOP body measurements.",
    usage: [`${CLI_NAME} body [--json|--csv]`],
    options: [...AUTH_CLIENT_OPTIONS, ...STRUCTURED_OUTPUT_OPTIONS],
    examples: [`${CLI_NAME} body --json`, `${CLI_NAME} body --csv`],
  },
  cycles: {
    summary: "List cycle records in a date window.",
    usage: [
      `${CLI_NAME} cycles [--days <n>] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--limit <n>] [--all-pages] [--json|--jsonl|--csv]`,
    ],
    options: [
      ...AUTH_CLIENT_OPTIONS,
      ...COLLECTION_WINDOW_OPTIONS,
      ...STRUCTURED_OUTPUT_OPTIONS,
      TIMEZONE_OPTION,
    ],
    examples: [
      `${CLI_NAME} cycles --days 14 --json`,
      `${CLI_NAME} cycles --from 2026-03-01 --to 2026-03-25 --all-pages --jsonl`,
      `${CLI_NAME} cycles --days 30 --min-strain 10 --sort strain-desc --json`,
    ],
  },
  recoveries: {
    summary: "List recovery records in a date window.",
    usage: [
      `${CLI_NAME} recoveries [--days <n>] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--limit <n>] [--all-pages] [--json|--jsonl|--csv]`,
    ],
    options: [
      ...AUTH_CLIENT_OPTIONS,
      ...COLLECTION_WINDOW_OPTIONS,
      ...STRUCTURED_OUTPUT_OPTIONS,
      TIMEZONE_OPTION,
    ],
    examples: [
      `${CLI_NAME} recoveries --days 30 --json`,
      `${CLI_NAME} recoveries --days 60 --max-recovery 40 --sort recovery --jsonl`,
      `${CLI_NAME} recoveries --from 2026-03-01 --to 2026-03-25 --fields cycle_id,score.recovery_score --csv`,
    ],
  },
  sleep: {
    summary: "List sleep records in a date window.",
    usage: [
      `${CLI_NAME} sleep [--days <n>] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--limit <n>] [--all-pages] [--json|--jsonl|--csv]`,
    ],
    options: [
      ...AUTH_CLIENT_OPTIONS,
      ...COLLECTION_WINDOW_OPTIONS,
      ...STRUCTURED_OUTPUT_OPTIONS,
      TIMEZONE_OPTION,
    ],
    examples: [
      `${CLI_NAME} sleep --days 14 --json`,
      `${CLI_NAME} sleep --from 2026-03-01 --to 2026-03-25 --fields id,start,end,score.sleep_performance_percentage --json`,
      `${CLI_NAME} sleep --days 30 --type nap --jsonl`,
    ],
  },
  workouts: {
    summary: "List workout records in a date window.",
    usage: [
      `${CLI_NAME} workouts [--days <n>] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--limit <n>] [--all-pages] [--json|--jsonl|--csv]`,
    ],
    options: [
      ...AUTH_CLIENT_OPTIONS,
      ...COLLECTION_WINDOW_OPTIONS,
      ...STRUCTURED_OUTPUT_OPTIONS,
      TIMEZONE_OPTION,
    ],
    examples: [
      `${CLI_NAME} workouts --days 14 --json`,
      `${CLI_NAME} workouts --days 30 --min-strain 12 --sort strain-desc --result-limit 20 --json`,
      `${CLI_NAME} workouts --from 2026-03-01 --to 2026-03-25 --fields id,start,sport_name,score.strain --csv`,
    ],
  },
  "cycle-by-id": {
    summary: "Fetch a cycle activity by WHOOP cycle ID.",
    usage: [
      `${CLI_NAME} cycle-by-id --cycle-id <int> [--json|--csv]`,
      `${CLI_NAME} cycle-by-id --stdin [--json|--csv]`,
    ],
    options: [
      ...AUTH_CLIENT_OPTIONS,
      option("--cycle-id <int>", "WHOOP cycle identifier."),
      STDIN_OPTION,
      ...STRUCTURED_OUTPUT_OPTIONS,
      TIMEZONE_OPTION,
    ],
    examples: [
      `${CLI_NAME} cycle-by-id --cycle-id 123456 --json`,
      `printf '%s\\n' "123456" | ${CLI_NAME} cycle-by-id --stdin --json`,
    ],
    stdin: {
      description: "Pipe a cycle ID as plain text.",
      examples: [`printf '%s\\n' "123456" | ${CLI_NAME} cycle-by-id --stdin --json`],
    },
  },
  "activity-map": {
    summary: "Map legacy v1 activity ID to v2 UUID via WHOOP mapping endpoint.",
    usage: [
      `${CLI_NAME} activity-map --activity-v1-id <int> [--json|--csv]`,
      `${CLI_NAME} activity-map --stdin [--json|--csv]`,
    ],
    options: [
      ...AUTH_CLIENT_OPTIONS,
      option("--activity-v1-id <int>", "Legacy WHOOP v1 activity ID."),
      STDIN_OPTION,
      ...STRUCTURED_OUTPUT_OPTIONS,
    ],
    examples: [
      `${CLI_NAME} activity-map --activity-v1-id 12345 --json`,
      `printf '%s\\n' "12345" | ${CLI_NAME} activity-map --stdin --json`,
    ],
    stdin: {
      description: "Pipe a legacy v1 activity ID as plain text.",
      examples: [`printf '%s\\n' "12345" | ${CLI_NAME} activity-map --stdin --json`],
    },
  },
  "sleep-by-id": {
    summary: "Fetch a sleep activity by WHOOP sleep UUID.",
    usage: [
      `${CLI_NAME} sleep-by-id --sleep-id <uuid> [--json|--csv]`,
      `${CLI_NAME} sleep-by-id --stdin [--json|--csv]`,
    ],
    options: [
      ...AUTH_CLIENT_OPTIONS,
      option("--sleep-id <uuid>", "WHOOP sleep UUID."),
      STDIN_OPTION,
      ...STRUCTURED_OUTPUT_OPTIONS,
      TIMEZONE_OPTION,
    ],
    examples: [
      `${CLI_NAME} sleep-by-id --sleep-id <uuid> --json`,
      `printf '%s\\n' "<uuid>" | ${CLI_NAME} sleep-by-id --stdin --json`,
    ],
    stdin: {
      description: "Pipe a sleep UUID as plain text.",
      examples: [`printf '%s\\n' "<uuid>" | ${CLI_NAME} sleep-by-id --stdin --json`],
    },
  },
  "workout-by-id": {
    summary: "Fetch a workout activity by WHOOP workout UUID.",
    usage: [
      `${CLI_NAME} workout-by-id --workout-id <uuid> [--json|--csv]`,
      `${CLI_NAME} workout-by-id --stdin [--json|--csv]`,
    ],
    options: [
      ...AUTH_CLIENT_OPTIONS,
      option("--workout-id <uuid>", "WHOOP workout UUID."),
      STDIN_OPTION,
      ...STRUCTURED_OUTPUT_OPTIONS,
      TIMEZONE_OPTION,
    ],
    examples: [
      `${CLI_NAME} workout-by-id --workout-id <uuid> --json`,
      `printf '%s\\n' "<uuid>" | ${CLI_NAME} workout-by-id --stdin --json`,
    ],
    stdin: {
      description: "Pipe a workout UUID as plain text.",
      examples: [`printf '%s\\n' "<uuid>" | ${CLI_NAME} workout-by-id --stdin --json`],
    },
  },
  "cycle-recovery": {
    summary: "Fetch recovery record for a specific cycle ID.",
    usage: [
      `${CLI_NAME} cycle-recovery --cycle-id <int> [--json|--csv]`,
      `${CLI_NAME} cycle-recovery --stdin [--json|--csv]`,
    ],
    options: [
      ...AUTH_CLIENT_OPTIONS,
      option("--cycle-id <int>", "WHOOP cycle identifier."),
      STDIN_OPTION,
      ...STRUCTURED_OUTPUT_OPTIONS,
      TIMEZONE_OPTION,
    ],
    examples: [
      `${CLI_NAME} cycle-recovery --cycle-id 123456 --json`,
      `printf '%s\\n' "123456" | ${CLI_NAME} cycle-recovery --stdin --json`,
    ],
    stdin: {
      description: "Pipe a cycle ID as plain text.",
      examples: [`printf '%s\\n' "123456" | ${CLI_NAME} cycle-recovery --stdin --json`],
    },
  },
  "cycle-sleep": {
    summary: "Fetch sleep record for a specific cycle ID.",
    usage: [
      `${CLI_NAME} cycle-sleep --cycle-id <int> [--json|--csv]`,
      `${CLI_NAME} cycle-sleep --stdin [--json|--csv]`,
    ],
    options: [
      ...AUTH_CLIENT_OPTIONS,
      option("--cycle-id <int>", "WHOOP cycle identifier."),
      STDIN_OPTION,
      ...STRUCTURED_OUTPUT_OPTIONS,
      TIMEZONE_OPTION,
    ],
    examples: [
      `${CLI_NAME} cycle-sleep --cycle-id 123456 --json`,
      `printf '%s\\n' "123456" | ${CLI_NAME} cycle-sleep --stdin --json`,
    ],
    stdin: {
      description: "Pipe a cycle ID as plain text.",
      examples: [`printf '%s\\n' "123456" | ${CLI_NAME} cycle-sleep --stdin --json`],
    },
  },
  day: {
    summary: "Fetch one local-day snapshot across cycles, recoveries, sleep, and workouts.",
    usage: [`${CLI_NAME} day [--date YYYY-MM-DD] [--include-records] [--json|--csv]`],
    options: [
      ...AUTH_CLIENT_OPTIONS,
      option("--date <YYYY-MM-DD>", "Local day to summarize (default: today in the active timezone)."),
      option("--include-records", "Include raw collection payloads in the day snapshot."),
      ...STRUCTURED_OUTPUT_OPTIONS,
      TIMEZONE_OPTION,
    ],
    examples: [
      `${CLI_NAME} day --json`,
      `${CLI_NAME} day --date 2026-03-25 --include-records --json`,
      `${CLI_NAME} day --date 2026-03-25 --csv`,
    ],
  },
  revoke: {
    summary: "Revoke OAuth access for current token and clear local session.",
    usage: [`${CLI_NAME} revoke [--dry-run] [--yes|--force] [--json]`],
    options: [...AUTH_CLIENT_OPTIONS, DRY_RUN_OPTION, YES_OPTION, FORCE_OPTION, ...JSON_OUTPUT_OPTIONS],
    examples: [
      `${CLI_NAME} revoke --dry-run --json`,
      `${CLI_NAME} revoke --yes --json`,
    ],
  },
  logout: {
    summary: "Clear local persisted session.",
    usage: [`${CLI_NAME} logout [--dry-run] [--yes|--force] [--json]`],
    options: [
      option("--session-file <path>", "Override session file path."),
      DRY_RUN_OPTION,
      YES_OPTION,
      FORCE_OPTION,
      ...JSON_OUTPUT_OPTIONS,
    ],
    examples: [
      `${CLI_NAME} logout --dry-run --json`,
      `${CLI_NAME} logout --yes --json`,
    ],
  },
};

export const PROJECT_NOTICE = "Unofficial tool. Not affiliated with or endorsed by WHOOP.";

export const GLOBAL_NOTES = [
  "Run `whoop-query-cli help <command>` for command-specific flags and examples.",
  "Use `whoop-query-cli discover --level 1|2|3` for progressive disclosure.",
  "Environment: WHOOP_CLIENT_ID, WHOOP_CLIENT_SECRET, WHOOP_REDIRECT_URI, WHOOP_SCOPE, WHOOP_SESSION_FILE, WHOOP_TIMEZONE",
];

export const AGENT_FILTER_OPTIONS = [
  { flag: "--from", type: "YYYY-MM-DD", description: "Inclusive lower local-date bound." },
  { flag: "--to", type: "YYYY-MM-DD", description: "Inclusive upper local-date bound." },
  { flag: "--type", type: "csv", description: "Record type filter (e.g. SCORED,running,nap)." },
  { flag: "--contains", type: "string", description: "Case-insensitive text match across core fields." },
  { flag: "--min-strain", type: "number", description: "Minimum strain threshold." },
  { flag: "--max-strain", type: "number", description: "Maximum strain threshold." },
  { flag: "--min-recovery", type: "number", description: "Minimum recovery score threshold." },
  { flag: "--max-recovery", type: "number", description: "Maximum recovery score threshold." },
  {
    flag: "--sort",
    type: "enum",
    description: "date|date-desc|strain|strain-desc|recovery|recovery-desc|name|name-desc",
  },
  { flag: "--result-limit", type: "number", description: "Post-filter record cap." },
  { flag: "--fields", type: "csv", description: "Project records to selected field paths." },
];

export const AGENT_OUTPUT_OPTIONS = [
  {
    flag: "--records-only",
    type: "boolean",
    description: "Return only envelope + records (drops heavy side payload fields).",
  },
];

export const FILTERABLE_COMMANDS = new Set(["cycles", "recoveries", "sleep", "workouts"]);

function trimFlagPrefix(flag) {
  return String(flag ?? "").replace(/^--/, "").trim();
}

function mergeFlagGroups(...groups) {
  return new Set(
    [...groups.flat(), "tz"]
      .map((flag) => trimFlagPrefix(flag))
      .filter(Boolean),
  );
}

const SHARED_FLAGS = {
  help: ["help"],
  output: ["output"],
  session: ["session-file"],
  client: ["client-id", "client-secret", "redirect-uri", "scopes"],
  json: ["json"],
  structured: ["json", "jsonl", "csv"],
  stdin: ["stdin"],
  dryRun: ["dry-run"],
  confirm: ["yes", "force"],
  agentFilters: AGENT_FILTER_OPTIONS.map((option) => trimFlagPrefix(option.flag)),
  agentOutput: AGENT_OUTPUT_OPTIONS.map((option) => trimFlagPrefix(option.flag)),
};

export const COMMAND_FLAG_ALLOWLIST = {
  help: mergeFlagGroups(SHARED_FLAGS.help, SHARED_FLAGS.json),
  discover: mergeFlagGroups(
    SHARED_FLAGS.help,
    SHARED_FLAGS.output,
    SHARED_FLAGS.json,
    ["level", "command"],
  ),
  capabilities: mergeFlagGroups(SHARED_FLAGS.help, SHARED_FLAGS.output, SHARED_FLAGS.json),
  "login-url": mergeFlagGroups(
    SHARED_FLAGS.help,
    SHARED_FLAGS.output,
    SHARED_FLAGS.json,
    SHARED_FLAGS.session,
    SHARED_FLAGS.client,
    ["state", "open"],
  ),
  login: mergeFlagGroups(
    SHARED_FLAGS.help,
    SHARED_FLAGS.output,
    SHARED_FLAGS.json,
    SHARED_FLAGS.session,
    SHARED_FLAGS.client,
    ["state", "open"],
  ),
  "login-local": mergeFlagGroups(
    SHARED_FLAGS.help,
    SHARED_FLAGS.output,
    SHARED_FLAGS.json,
    SHARED_FLAGS.session,
    SHARED_FLAGS.client,
    ["state", "open", "timeout-seconds"],
  ),
  "exchange-code": mergeFlagGroups(
    SHARED_FLAGS.help,
    SHARED_FLAGS.output,
    SHARED_FLAGS.json,
    SHARED_FLAGS.session,
    SHARED_FLAGS.client,
    SHARED_FLAGS.stdin,
    ["code", "state"],
  ),
  "refresh-token": mergeFlagGroups(
    SHARED_FLAGS.help,
    SHARED_FLAGS.output,
    SHARED_FLAGS.json,
    SHARED_FLAGS.session,
    SHARED_FLAGS.client,
  ),
  whoami: mergeFlagGroups(
    SHARED_FLAGS.help,
    SHARED_FLAGS.output,
    SHARED_FLAGS.structured,
    SHARED_FLAGS.session,
    SHARED_FLAGS.client,
  ),
  profile: mergeFlagGroups(
    SHARED_FLAGS.help,
    SHARED_FLAGS.output,
    SHARED_FLAGS.structured,
    SHARED_FLAGS.session,
    SHARED_FLAGS.client,
  ),
  body: mergeFlagGroups(
    SHARED_FLAGS.help,
    SHARED_FLAGS.output,
    SHARED_FLAGS.structured,
    SHARED_FLAGS.session,
    SHARED_FLAGS.client,
  ),
  cycles: mergeFlagGroups(
    SHARED_FLAGS.help,
    SHARED_FLAGS.output,
    SHARED_FLAGS.structured,
    SHARED_FLAGS.session,
    SHARED_FLAGS.client,
    SHARED_FLAGS.agentFilters,
    SHARED_FLAGS.agentOutput,
    ["days", "from", "to", "limit", "all-pages", "start", "end", "next-token"],
  ),
  recoveries: mergeFlagGroups(
    SHARED_FLAGS.help,
    SHARED_FLAGS.output,
    SHARED_FLAGS.structured,
    SHARED_FLAGS.session,
    SHARED_FLAGS.client,
    SHARED_FLAGS.agentFilters,
    SHARED_FLAGS.agentOutput,
    ["days", "from", "to", "limit", "all-pages", "start", "end", "next-token"],
  ),
  sleep: mergeFlagGroups(
    SHARED_FLAGS.help,
    SHARED_FLAGS.output,
    SHARED_FLAGS.structured,
    SHARED_FLAGS.session,
    SHARED_FLAGS.client,
    SHARED_FLAGS.agentFilters,
    SHARED_FLAGS.agentOutput,
    ["days", "from", "to", "limit", "all-pages", "start", "end", "next-token"],
  ),
  workouts: mergeFlagGroups(
    SHARED_FLAGS.help,
    SHARED_FLAGS.output,
    SHARED_FLAGS.structured,
    SHARED_FLAGS.session,
    SHARED_FLAGS.client,
    SHARED_FLAGS.agentFilters,
    SHARED_FLAGS.agentOutput,
    ["days", "from", "to", "limit", "all-pages", "start", "end", "next-token"],
  ),
  "cycle-by-id": mergeFlagGroups(
    SHARED_FLAGS.help,
    SHARED_FLAGS.output,
    SHARED_FLAGS.structured,
    SHARED_FLAGS.session,
    SHARED_FLAGS.client,
    SHARED_FLAGS.stdin,
    ["cycle-id"],
  ),
  "activity-map": mergeFlagGroups(
    SHARED_FLAGS.help,
    SHARED_FLAGS.output,
    SHARED_FLAGS.structured,
    SHARED_FLAGS.session,
    SHARED_FLAGS.client,
    SHARED_FLAGS.stdin,
    ["activity-v1-id"],
  ),
  "sleep-by-id": mergeFlagGroups(
    SHARED_FLAGS.help,
    SHARED_FLAGS.output,
    SHARED_FLAGS.structured,
    SHARED_FLAGS.session,
    SHARED_FLAGS.client,
    SHARED_FLAGS.stdin,
    ["sleep-id"],
  ),
  "workout-by-id": mergeFlagGroups(
    SHARED_FLAGS.help,
    SHARED_FLAGS.output,
    SHARED_FLAGS.structured,
    SHARED_FLAGS.session,
    SHARED_FLAGS.client,
    SHARED_FLAGS.stdin,
    ["workout-id"],
  ),
  "cycle-recovery": mergeFlagGroups(
    SHARED_FLAGS.help,
    SHARED_FLAGS.output,
    SHARED_FLAGS.structured,
    SHARED_FLAGS.session,
    SHARED_FLAGS.client,
    SHARED_FLAGS.stdin,
    ["cycle-id"],
  ),
  "cycle-sleep": mergeFlagGroups(
    SHARED_FLAGS.help,
    SHARED_FLAGS.output,
    SHARED_FLAGS.structured,
    SHARED_FLAGS.session,
    SHARED_FLAGS.client,
    SHARED_FLAGS.stdin,
    ["cycle-id"],
  ),
  day: mergeFlagGroups(
    SHARED_FLAGS.help,
    SHARED_FLAGS.output,
    SHARED_FLAGS.structured,
    SHARED_FLAGS.session,
    SHARED_FLAGS.client,
    ["date", "include-records"],
  ),
  revoke: mergeFlagGroups(
    SHARED_FLAGS.help,
    SHARED_FLAGS.output,
    SHARED_FLAGS.json,
    SHARED_FLAGS.session,
    SHARED_FLAGS.client,
    SHARED_FLAGS.dryRun,
    SHARED_FLAGS.confirm,
  ),
  logout: mergeFlagGroups(
    SHARED_FLAGS.help,
    SHARED_FLAGS.output,
    SHARED_FLAGS.json,
    SHARED_FLAGS.session,
    SHARED_FLAGS.dryRun,
    SHARED_FLAGS.confirm,
  ),
};
