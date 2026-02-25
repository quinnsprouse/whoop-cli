# Unofficial WHOOP Query CLI

> Unofficial tool. Not affiliated with or endorsed by WHOOP.

CLI to authenticate with the official WHOOP API and query your account data, including:

- OAuth login URL generation + authorization-code exchange
- one-step local OAuth callback capture (`login-local`)
- profile and body measurements
- cycles, recoveries, sleep, and workouts collections
- endpoint lookups: `cycle-by-id`, `activity-map`, `sleep-by-id`, `workout-by-id`, `cycle-recovery`, `cycle-sleep`
- day snapshot across core WHOOP datasets
- agent-friendly filtering, field projection, and JSON/JSONL/CSV output
- automatic token refresh with cross-process lock protection and retry/backoff for rate limits

## Install

### Run without install (npx)

```bash
npx --yes whoop-query-cli help
```

### Global install

```bash
npm install -g whoop-query-cli
whoop-query-cli help
```

### Local development (from source)

```bash
git clone https://github.com/quinnsprouse/whoop-cli.git
cd whoop-cli
npm install
npm run help
```

### Run from local source

```bash
node src/cli.mjs help
```

## WHOOP App Setup (Developer Dashboard)

1. Create a WHOOP app in the dashboard.
2. Set Privacy Policy URL:
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
- `WHOOP_SESSION_FILE` (default: `~/.whoop/session.json`)
- `WHOOP_TIMEZONE` (default: system timezone)

## Quickstart

1. Authenticate (recommended)

```bash
whoop-query-cli login-local --open
```

2. Query data

```bash
whoop-query-cli whoami --json
whoop-query-cli workouts --days 14 --json
whoop-query-cli recoveries --days 30 --max-recovery 50 --json
whoop-query-cli sleep --days 14 --json
whoop-query-cli day --date 2026-02-24 --include-records --json
```

3. Query endpoint-specific records

```bash
whoop-query-cli sleep-by-id --sleep-id <uuid> --json
whoop-query-cli workout-by-id --workout-id <uuid> --json
whoop-query-cli cycle-by-id --cycle-id <int> --json
whoop-query-cli activity-map --activity-v1-id <int> --json
whoop-query-cli cycle-recovery --cycle-id <int> --json
whoop-query-cli cycle-sleep --cycle-id <int> --json
```

4. Discover commands progressively

```bash
whoop-query-cli help
whoop-query-cli help workouts --json
whoop-query-cli discover --level 3 --json
whoop-query-cli capabilities --json
```

## Auth Modes

- `login-local`: starts local callback server, captures `code`, exchanges token automatically.
- `login` + `exchange-code`: manual OAuth flow if you do not want local callback capture.
- Access tokens are auto-refreshed using the stored refresh token (`offline` scope required).

## Output

- default: pretty JSON
- `--json`: structured JSON
- `--jsonl`: one record per line
- `--csv`: comma-separated rows (supports `--fields` projection)
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

- Session/token data is stored at `~/.whoop/session.json` by default.
- Treat session files, exported JSON, and terminal logs as sensitive.
- Do not commit secrets or session files.
- Use `whoop-query-cli revoke` to revoke OAuth access and clear local session data.
- Use `whoop-query-cli logout` to clear local session data only.

## Troubleshooting

- Redirect mismatch:
  - Ensure WHOOP dashboard Redirect URL exactly matches `WHOOP_REDIRECT_URI`.
- `login-local requires an http://localhost redirect URI`:
  - Set `WHOOP_REDIRECT_URI` to `http://localhost:8787/callback`.
- `No access token found`:
  - Re-run `whoop-query-cli login-local --open`.
- Cron/auth drift:
  - Ensure `WHOOP_CLIENT_ID`, `WHOOP_CLIENT_SECRET`, and `WHOOP_REDIRECT_URI` are available in the cron environment.
  - Use a stable session file path (recommended: `WHOOP_SESSION_FILE="$HOME/.whoop/session.json"`).
  - If refresh token is revoked/expired, re-authenticate with `whoop-query-cli login-local --open`.
