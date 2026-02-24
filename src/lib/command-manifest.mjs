export const COMMANDS = {
  help: {
    summary: "Show global help or command help.",
    usage: [
      "node src/cli.mjs help",
      "node src/cli.mjs help <command>",
      "node src/cli.mjs <command> --help",
    ],
  },
  discover: {
    summary: "Agent-oriented command discovery with progressive disclosure levels.",
    usage: [
      "node src/cli.mjs discover",
      "node src/cli.mjs discover --level 1|2|3 [--json]",
      "node src/cli.mjs discover --command workouts --level 3 --json",
    ],
  },
  capabilities: {
    summary: "Show auth, scope, endpoint, and rate-limit capabilities.",
    usage: ["node src/cli.mjs capabilities [--json]"],
  },
  "login-url": {
    summary: "Build OAuth authorization URL and persist pending auth metadata.",
    usage: [
      "node src/cli.mjs login-url [--scopes read:profile,read:workout,offline] [--state <8chars>] [--open]",
    ],
  },
  login: {
    summary: "Alias for login-url with setup guidance for code exchange.",
    usage: [
      "node src/cli.mjs login [--scopes read:profile,read:workout,offline] [--state <8chars>] [--open]",
    ],
  },
  "login-local": {
    summary: "Run local callback server, capture code automatically, and exchange tokens.",
    usage: [
      "node src/cli.mjs login-local [--scopes read:profile,read:workout,offline] [--state <8chars>] [--timeout-seconds <n>] [--open true|false]",
    ],
  },
  "exchange-code": {
    summary: "Exchange OAuth authorization code for access and refresh tokens.",
    usage: [
      "node src/cli.mjs exchange-code --code <authorization_code> [--state <8chars>]",
    ],
  },
  "refresh-token": {
    summary: "Refresh current access token using refresh token and persist session.",
    usage: ["node src/cli.mjs refresh-token [--json]"],
  },
  whoami: {
    summary: "Fetch authenticated WHOOP basic profile from /v2/user/profile/basic.",
    usage: ["node src/cli.mjs whoami [--json]"],
  },
  profile: {
    summary: "Fetch authenticated WHOOP basic profile.",
    usage: ["node src/cli.mjs profile [--json]"],
  },
  body: {
    summary: "Fetch authenticated WHOOP body measurements.",
    usage: ["node src/cli.mjs body [--json]"],
  },
  cycles: {
    summary: "List cycle records in a date window.",
    usage: [
      "node src/cli.mjs cycles [--days <n>] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--limit <n>] [--all-pages] [--json|--jsonl]",
    ],
  },
  recoveries: {
    summary: "List recovery records in a date window.",
    usage: [
      "node src/cli.mjs recoveries [--days <n>] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--limit <n>] [--all-pages] [--json|--jsonl]",
    ],
  },
  sleep: {
    summary: "List sleep records in a date window.",
    usage: [
      "node src/cli.mjs sleep [--days <n>] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--limit <n>] [--all-pages] [--json|--jsonl]",
    ],
  },
  workouts: {
    summary: "List workout records in a date window.",
    usage: [
      "node src/cli.mjs workouts [--days <n>] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--limit <n>] [--all-pages] [--json|--jsonl]",
    ],
  },
  "sleep-by-id": {
    summary: "Fetch a sleep activity by WHOOP sleep UUID.",
    usage: ["node src/cli.mjs sleep-by-id --sleep-id <uuid> [--json]"],
  },
  "workout-by-id": {
    summary: "Fetch a workout activity by WHOOP workout UUID.",
    usage: ["node src/cli.mjs workout-by-id --workout-id <uuid> [--json]"],
  },
  "cycle-recovery": {
    summary: "Fetch recovery record for a specific cycle ID.",
    usage: ["node src/cli.mjs cycle-recovery --cycle-id <int> [--json]"],
  },
  "cycle-sleep": {
    summary: "Fetch sleep record for a specific cycle ID.",
    usage: ["node src/cli.mjs cycle-sleep --cycle-id <int> [--json]"],
  },
  day: {
    summary: "Fetch one local-day snapshot across cycles, recoveries, sleep, and workouts.",
    usage: [
      "node src/cli.mjs day [--date YYYY-MM-DD] [--include-records] [--json]",
    ],
  },
  revoke: {
    summary: "Revoke OAuth access for current token and clear local session.",
    usage: ["node src/cli.mjs revoke [--json]"],
  },
  logout: {
    summary: "Clear local persisted session.",
    usage: ["node src/cli.mjs logout"],
  },
};

export const PROJECT_NOTICE = "Unofficial tool. Not affiliated with or endorsed by WHOOP.";

export const GLOBAL_NOTES = [
  PROJECT_NOTICE,
  "Environment: WHOOP_CLIENT_ID, WHOOP_CLIENT_SECRET, WHOOP_REDIRECT_URI, WHOOP_SCOPE, WHOOP_SESSION_FILE, WHOOP_TIMEZONE",
  "OAuth endpoints: https://api.prod.whoop.com/oauth/oauth2/auth and /oauth/oauth2/token",
  "Fast auth: use login-local with an http://localhost redirect URI to auto-capture code.",
  "Timezone: --tz <IANA timezone> (for example America/New_York).",
  "Output modes: default JSON, --json, --jsonl, --output <path>",
  "Session file default: .whoop/session.json",
  "Collection page size max: 25 records/request (WHOOP API)",
  "Agent filters: --from --to --type --contains --min-strain --max-strain --min-recovery --max-recovery --sort --result-limit --fields",
  "Agent output: --records-only",
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
  jsonAndJsonl: ["json", "jsonl"],
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
    SHARED_FLAGS.json,
    SHARED_FLAGS.session,
    SHARED_FLAGS.client,
  ),
  profile: mergeFlagGroups(
    SHARED_FLAGS.help,
    SHARED_FLAGS.output,
    SHARED_FLAGS.json,
    SHARED_FLAGS.session,
    SHARED_FLAGS.client,
  ),
  body: mergeFlagGroups(
    SHARED_FLAGS.help,
    SHARED_FLAGS.output,
    SHARED_FLAGS.json,
    SHARED_FLAGS.session,
    SHARED_FLAGS.client,
  ),
  cycles: mergeFlagGroups(
    SHARED_FLAGS.help,
    SHARED_FLAGS.output,
    SHARED_FLAGS.jsonAndJsonl,
    SHARED_FLAGS.session,
    SHARED_FLAGS.client,
    SHARED_FLAGS.agentFilters,
    SHARED_FLAGS.agentOutput,
    ["days", "from", "to", "limit", "all-pages", "start", "end", "next-token"],
  ),
  recoveries: mergeFlagGroups(
    SHARED_FLAGS.help,
    SHARED_FLAGS.output,
    SHARED_FLAGS.jsonAndJsonl,
    SHARED_FLAGS.session,
    SHARED_FLAGS.client,
    SHARED_FLAGS.agentFilters,
    SHARED_FLAGS.agentOutput,
    ["days", "from", "to", "limit", "all-pages", "start", "end", "next-token"],
  ),
  sleep: mergeFlagGroups(
    SHARED_FLAGS.help,
    SHARED_FLAGS.output,
    SHARED_FLAGS.jsonAndJsonl,
    SHARED_FLAGS.session,
    SHARED_FLAGS.client,
    SHARED_FLAGS.agentFilters,
    SHARED_FLAGS.agentOutput,
    ["days", "from", "to", "limit", "all-pages", "start", "end", "next-token"],
  ),
  workouts: mergeFlagGroups(
    SHARED_FLAGS.help,
    SHARED_FLAGS.output,
    SHARED_FLAGS.jsonAndJsonl,
    SHARED_FLAGS.session,
    SHARED_FLAGS.client,
    SHARED_FLAGS.agentFilters,
    SHARED_FLAGS.agentOutput,
    ["days", "from", "to", "limit", "all-pages", "start", "end", "next-token"],
  ),
  "sleep-by-id": mergeFlagGroups(
    SHARED_FLAGS.help,
    SHARED_FLAGS.output,
    SHARED_FLAGS.json,
    SHARED_FLAGS.session,
    SHARED_FLAGS.client,
    ["sleep-id"],
  ),
  "workout-by-id": mergeFlagGroups(
    SHARED_FLAGS.help,
    SHARED_FLAGS.output,
    SHARED_FLAGS.json,
    SHARED_FLAGS.session,
    SHARED_FLAGS.client,
    ["workout-id"],
  ),
  "cycle-recovery": mergeFlagGroups(
    SHARED_FLAGS.help,
    SHARED_FLAGS.output,
    SHARED_FLAGS.json,
    SHARED_FLAGS.session,
    SHARED_FLAGS.client,
    ["cycle-id"],
  ),
  "cycle-sleep": mergeFlagGroups(
    SHARED_FLAGS.help,
    SHARED_FLAGS.output,
    SHARED_FLAGS.json,
    SHARED_FLAGS.session,
    SHARED_FLAGS.client,
    ["cycle-id"],
  ),
  day: mergeFlagGroups(
    SHARED_FLAGS.help,
    SHARED_FLAGS.output,
    SHARED_FLAGS.json,
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
  ),
  logout: mergeFlagGroups(SHARED_FLAGS.help, SHARED_FLAGS.output, SHARED_FLAGS.session),
};
