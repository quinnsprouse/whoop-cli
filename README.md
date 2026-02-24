# Unofficial WHOOP CLI

> Unofficial tool. Not affiliated with or endorsed by WHOOP.

Agent-friendly CLI for WHOOP official API (OAuth2 + v2 endpoints), including:

- OAuth login URL generation + code exchange
- one-step local OAuth callback capture (`login-local`)
- token refresh + local session persistence
- profile + body measurements
- cycles, recoveries, sleep, workouts collections
- endpoint-specific fetches (`sleep-by-id`, `workout-by-id`, `cycle-recovery`, `cycle-sleep`)
- local-day snapshot command (`day`)
- machine-friendly filtering/projection for agents

## Install

### Local development (from source)

```bash
git clone <your-repo-url>
cd whoop-cli
npm install
npm run help
```

### Run without install

```bash
node src/cli.mjs help
```

## OAuth Setup (WHOOP Developer Dashboard)

You need:

- `WHOOP_CLIENT_ID`
- `WHOOP_CLIENT_SECRET`
- `WHOOP_REDIRECT_URI` (must match your app settings)

Optional:

- `WHOOP_SCOPE` (defaults include all read scopes + `offline`)
- `WHOOP_SESSION_FILE` (defaults to `.whoop/session.json`)
- `WHOOP_TIMEZONE` (for local-day bucketing)

Example:

```bash
export WHOOP_CLIENT_ID="..."
export WHOOP_CLIENT_SECRET="..."
export WHOOP_REDIRECT_URI="http://localhost:8787/callback"
```

## WHOOP Dashboard Privacy Policy URL

If this repo is public, you can use the policy in this repo:

- `PRIVACY.md` (edit contact fields before publishing)

After pushing to GitHub, use one of these URLs in the WHOOP Developer Dashboard:

- `https://github.com/<your-user>/<your-repo>/blob/main/PRIVACY.md`
- `https://raw.githubusercontent.com/<your-user>/<your-repo>/main/PRIVACY.md`

The GitHub `blob` URL is usually the most user-friendly in browser.

## Quickstart

1. One-step local OAuth (recommended if redirect URI is localhost)

```bash
whoop-cli login-local --open
```

2. Manual fallback (if you are not using localhost redirect)

```bash
whoop-cli login --open
whoop-cli exchange-code --code <authorization_code>
```

3. Query data

```bash
whoop-cli whoami --json
whoop-cli workouts --days 14 --json
whoop-cli recoveries --days 30 --max-recovery 50 --json
whoop-cli sleep --from 2026-02-01 --to 2026-02-24 --json
whoop-cli sleep-by-id --sleep-id <uuid> --json
whoop-cli workout-by-id --workout-id <uuid> --json
whoop-cli cycle-recovery --cycle-id 123456 --json
whoop-cli cycle-sleep --cycle-id 123456 --json
whoop-cli day --date 2026-02-24 --include-records --json
```

## Agent Features

- `discover --level 1|2|3 --json`
- `help <command> --json`
- filters: `--from --to --type --contains --min-strain --max-strain --min-recovery --max-recovery --sort --result-limit --fields`
- output: `--json`, `--jsonl`, `--records-only`, `--output <path>`
- direct endpoint commands: `sleep-by-id`, `workout-by-id`, `cycle-recovery`, `cycle-sleep`

## Security

- Session/token data is stored in `.whoop/session.json` by default.
- Treat this file as sensitive and do not commit it.
