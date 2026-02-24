# Unofficial WHOOP CLI

> Unofficial tool. Not affiliated with or endorsed by WHOOP.

CLI to authenticate with the official WHOOP API and query your account data, including:

- OAuth login URL generation + authorization-code exchange
- one-step local OAuth callback capture (`login-local`)
- profile and body measurements
- cycles, recoveries, sleep, and workouts collections
- endpoint lookups: `sleep-by-id`, `workout-by-id`, `cycle-recovery`, `cycle-sleep`
- day snapshot across core WHOOP datasets
- agent-friendly filtering, field projection, and JSON/JSONL output

## Install

### Local development (from source)

```bash
git clone https://github.com/quinnsprouse/whoop-cli.git
cd whoop-cli
npm install
npm run help
```

### Run without global install

```bash
node src/cli.mjs help
```

### Optional global command (from local source)

```bash
npm link
whoop-cli help
```

## WHOOP App Setup (Developer Dashboard)

1. Create a WHOOP app in the dashboard.
2. Set Privacy Policy URL (for this repo):
   - `https://github.com/quinnsprouse/whoop-cli/blob/main/PRIVACY.md`
3. Add Redirect URL(s):
   - `http://localhost:8787/callback` (recommended for `login-local`)
4. Request scopes your CLI needs (recommended):
   - `read:profile`
   - `read:body_measurement`
   - `read:workout`
   - `read:sleep`
   - `read:recovery`
   - `read:cycles`
   - `offline` (required if you want refresh tokens)

## Local Environment

```bash
export WHOOP_CLIENT_ID="..."
export WHOOP_CLIENT_SECRET="..."
export WHOOP_REDIRECT_URI="http://localhost:8787/callback"
```

Optional:

- `WHOOP_SCOPE` (space/comma-separated scopes)
- `WHOOP_SESSION_FILE` (default: `.whoop/session.json`)
- `WHOOP_TIMEZONE` (default: system timezone)

## Quickstart

1. Authenticate (recommended)

```bash
whoop-cli login-local --open
```

2. Query data

```bash
whoop-cli whoami --json
whoop-cli workouts --days 14 --json
whoop-cli recoveries --days 30 --max-recovery 50 --json
whoop-cli sleep --days 14 --json
whoop-cli day --date 2026-02-24 --include-records --json
```

3. Query endpoint-specific records

```bash
whoop-cli sleep-by-id --sleep-id <uuid> --json
whoop-cli workout-by-id --workout-id <uuid> --json
whoop-cli cycle-recovery --cycle-id <int> --json
whoop-cli cycle-sleep --cycle-id <int> --json
```

4. Discover commands progressively

```bash
whoop-cli help
whoop-cli help workouts --json
whoop-cli discover --level 3 --json
whoop-cli capabilities --json
```

## Auth Modes

- `login-local`: starts local callback server, captures `code`, exchanges token automatically.
- `login` + `exchange-code`: manual OAuth flow if you do not want local callback capture.

## Output

- default: pretty JSON
- `--json`: structured JSON
- `--jsonl`: one record per line
- `--fields a,b,c`: project record fields
- `--records-only`: lighter record payloads
- `--tz <IANA timezone>`: localize day boundaries/timestamps (defaults to `WHOOP_TIMEZONE` or system timezone)

## Agent Filters

Available on collection commands (`cycles`, `recoveries`, `sleep`, `workouts`):

- `--from YYYY-MM-DD`
- `--to YYYY-MM-DD`
- `--type a,b,c`
- `--contains <text>`
- `--min-strain <n>` / `--max-strain <n>`
- `--min-recovery <n>` / `--max-recovery <n>`
- `--sort date|date-desc|strain|strain-desc|recovery|recovery-desc|name|name-desc`
- `--result-limit <n>`
- `--fields a,b,c`

## Security

- Session/token data is stored at `.whoop/session.json` by default.
- Treat session files, exported JSON, and terminal logs as sensitive.
- Do not commit secrets or session files.
- Use `whoop-cli revoke` to revoke OAuth access and clear local session data.
- Use `whoop-cli logout` to clear local session data only.

## Troubleshooting

- Redirect mismatch:
  - Ensure WHOOP dashboard Redirect URL exactly matches `WHOOP_REDIRECT_URI`.
- `login-local requires an http://localhost redirect URI`:
  - Set `WHOOP_REDIRECT_URI` to `http://localhost:8787/callback`.
- `No access token found`:
  - Re-run `whoop-cli login-local --open`.
