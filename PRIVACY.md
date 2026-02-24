# Privacy Policy for whoop-query-cli

Last Updated: 2026-02-24

This Privacy Policy describes how `whoop-query-cli` handles information when you use the CLI with the WHOOP API.

`whoop-query-cli` is an unofficial open-source tool and is not affiliated with WHOOP.

## Scope

This policy applies to the `whoop-query-cli` project in this repository and any public releases of it.

## Data Processed

When you authorize `whoop-query-cli` with WHOOP OAuth scopes, the CLI may access WHOOP data available through the scopes you approve, including:

- Basic profile data (for example name/email/user_id)
- Body measurements
- Cycle, recovery, sleep, and workout data

The CLI may also process OAuth credentials:

- Access token
- Refresh token (if `offline` scope is granted)
- Token metadata (expiry, scopes)

## How Data Is Used

`whoop-query-cli` uses data only to:

- Authenticate to WHOOP on your behalf
- Retrieve WHOOP API records you explicitly request
- Display results in terminal output or files you explicitly request (`--output`)

`whoop-query-cli` does not sell personal data.

## Data Storage and Retention

By default, `whoop-query-cli` stores session/token data locally on your machine at:

- `.whoop/session.json` (or path set via `WHOOP_SESSION_FILE`)

By default, `whoop-query-cli` does not send your WHOOP API data to a project-owned backend server.

Retention is controlled by you:

- Delete local session files to remove stored tokens
- Delete exported output files you generated
- Revoke OAuth access in WHOOP and/or run `whoop-query-cli revoke`

## Data Sharing

`whoop-query-cli` does not intentionally share your WHOOP data with third parties.

Data may be disclosed only if required by law or legal process.

## Security

Reasonable steps are taken to reduce exposure of credentials and sensitive data, including local file storage and avoiding token display in normal output.

No method of transmission or storage is perfectly secure. You are responsible for securing your local environment and any files you export.

## Your Choices and Rights

You can:

- Revoke app access from WHOOP
- Run `whoop-query-cli revoke` to revoke OAuth access and clear local session data
- Run `whoop-query-cli logout` to clear local session data only
- Contact WHOOP for account-level data rights provided by WHOOP

## Changes to This Policy

This policy may be updated from time to time. Changes are effective when posted at this URL.

## Contact

For questions about this policy for `whoop-query-cli`, contact:

- Name: `REPLACE_WITH_YOUR_NAME`
- Email: `REPLACE_WITH_PUBLIC_CONTACT_EMAIL`
- Repository: `https://github.com/quinnsprouse/whoop-cli`
