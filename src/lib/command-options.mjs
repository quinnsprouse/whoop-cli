import { defineOption } from "./command-registry.mjs";
import { CLI_NAME } from "./project-info.mjs";

export function option(flag, description, schema = {}) {
  return defineOption(flag, description, schema);
}

export const TIMEZONE_OPTION = option(
  "--tz <IANA timezone>",
  "Override local-day bucketing (defaults to WHOOP_TIMEZONE or system timezone).",
);

export const OUTPUT_FILE_OPTION = option(
  "--output <path>",
  "Write output to a file instead of stdout.",
);

export const STRUCTURED_OUTPUT_OPTIONS = [
  option("--json", "Return structured JSON."),
  option("--jsonl", "Emit one record per line."),
  option("--csv", "Emit CSV rows."),
  OUTPUT_FILE_OPTION,
];

export const JSON_OUTPUT_OPTIONS = [
  option("--json", "Return structured JSON."),
  OUTPUT_FILE_OPTION,
];

export const AUTH_CLIENT_OPTIONS = [
  option("--client-id <id>", "Override WHOOP_CLIENT_ID."),
  option("--client-secret <secret>", "Override WHOOP_CLIENT_SECRET."),
  option("--redirect-uri <url>", "Override WHOOP_REDIRECT_URI."),
  option("--scopes <csv>", "Override requested scopes."),
  option("--session-file <path>", "Override session file path."),
];

export const COLLECTION_WINDOW_OPTIONS = [
  option(
    "--days <n>",
    "Number of local days to include when --from/--to are omitted (default: 30).",
    { type: "integer", min: 1 },
  ),
  option("--from <YYYY-MM-DD>", "Inclusive local-date lower bound."),
  option("--to <YYYY-MM-DD>", "Inclusive local-date upper bound."),
  option("--start <ISO>", "Explicit UTC/ISO start date-time. Requires --end."),
  option("--end <ISO>", "Explicit UTC/ISO end date-time. Requires --start."),
  option("--limit <n>", "Page size per WHOOP API request (max: 25).", {
    type: "integer",
    min: 1,
  }),
  option("--next-token <token>", "Resume pagination from a previous response."),
  option("--all-pages", "Follow WHOOP next_token values until exhausted."),
];

export const STDIN_OPTION = option(
  "--stdin",
  "Read the primary input value from stdin instead of the required flag.",
);

export const DRY_RUN_OPTION = option(
  "--dry-run",
  "Preview the effect of the command without changing remote or local state.",
);

export const YES_OPTION = option(
  "--yes",
  "Confirm the destructive action without prompting.",
);

export const FORCE_OPTION = option(
  "--force",
  "Alias for --yes.",
);

export const AGENT_FILTER_OPTIONS = [
  option("--from <YYYY-MM-DD>", "Inclusive lower local-date bound."),
  option("--to <YYYY-MM-DD>", "Inclusive upper local-date bound."),
  option("--type <csv>", "Record type filter (e.g. SCORED,running,nap)."),
  option("--contains <string>", "Case-insensitive text match across core fields."),
  option("--min-strain <n>", "Minimum strain threshold.", { type: "number" }),
  option("--max-strain <n>", "Maximum strain threshold.", { type: "number" }),
  option("--min-recovery <n>", "Minimum recovery score threshold.", { type: "number" }),
  option("--max-recovery <n>", "Maximum recovery score threshold.", { type: "number" }),
  option(
    "--sort <value>",
    "date|date-desc|strain|strain-desc|recovery|recovery-desc|name|name-desc",
    {
      type: "enum",
      values: [
        "date",
        "date-desc",
        "strain",
        "strain-desc",
        "recovery",
        "recovery-desc",
        "name",
        "name-desc",
      ],
    },
  ),
  option("--result-limit <n>", "Post-filter record cap.", { type: "integer", min: 1 }),
  option("--fields <csv>", "Project records to selected field paths."),
];

export const AGENT_OUTPUT_OPTIONS = [
  option(
    "--records-only",
    "Return only envelope + records (drops heavy side payload fields).",
  ),
];

export const AGENT_PATTERNS = [
  {
    pattern: "Find highest-strain workouts over last 30 days",
    command:
      `${CLI_NAME} workouts --days 30 --min-strain 12 --sort strain-desc --result-limit 20 --fields id,start,sport_name,score.strain --json`,
  },
  {
    pattern: "Inspect poor recovery days",
    command:
      `${CLI_NAME} recoveries --days 60 --max-recovery 40 --sort recovery --fields cycle_id,created_at,score.recovery_score,score.resting_heart_rate --jsonl`,
  },
  {
    pattern: "Summarize sleep window",
    command:
      `${CLI_NAME} sleep --from 2026-02-01 --to 2026-02-24 --fields id,start,end,score.sleep_performance_percentage,score.stage_summary.total_in_bed_time_milli --json`,
  },
];
