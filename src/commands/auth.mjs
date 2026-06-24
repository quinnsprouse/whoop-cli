import {
  formatConfirmationRequiredMessage,
  hasConfirmationBypass,
  resolveRequiredFlagValue,
} from "../lib/command-input.mjs";
import {
  maybeOpenUrl,
  runLocalOAuthLogin,
} from "../lib/local-oauth-flow.mjs";
import {
  AUTH_CLIENT_OPTIONS,
  DRY_RUN_OPTION,
  FORCE_OPTION,
  JSON_OUTPUT_OPTIONS,
  STDIN_OPTION,
  STRUCTURED_OUTPUT_OPTIONS,
  YES_OPTION,
  option,
} from "../lib/command-options.mjs";
import { CLI_NAME } from "../lib/project-info.mjs";

function normalizeScopes(flags) {
  if (!flags.scopes || flags.scopes === true) return null;
  return String(flags.scopes)
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean);
}

function validateState(state) {
  const value = String(state ?? "").trim();
  if (!value) return null;
  if (!/^[A-Za-z0-9]{8}$/.test(value)) {
    throw new Error('Invalid --state. WHOOP requires an 8-character alphanumeric state value.');
  }
  return value;
}

function toBoolean(value, fallback = false) {
  if (value == null) return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return fallback;
}

function requirePositiveInteger(value, fallback) {
  if (value == null) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return parsed;
}

export async function commandLoginUrl(flags, deps) {
  const { withClient, writeOutput, isJsonMode } = deps;
  const client = await withClient(flags);
  const requestedScopes = normalizeScopes(flags);
  const forcedState = validateState(flags.state);
  const shouldOpen = toBoolean(flags.open, false);

  const auth = client.buildAuthorizationRequest({ scopes: requestedScopes, state: forcedState });
  await client.savePendingAuthorization(auth);
  const openResult = await maybeOpenUrl(auth.authorizationUrl, shouldOpen);

  const payload = {
    ok: true,
    generatedAt: new Date().toISOString(),
    authorizationUrl: auth.authorizationUrl,
    clientId: auth.clientId,
    redirectUri: auth.redirectUri,
    state: auth.state,
    scopes: auth.scopes,
    instructions: [
      "1) Open authorizationUrl in your browser and approve access.",
      "2) Copy the code query parameter from your redirect URL.",
      "3) Run: whoop-query-cli exchange-code --code <authorization_code>",
    ],
    ...openResult,
  };

  if (!isJsonMode(flags)) {
    await writeOutput(payload, flags, (value) => {
      const lines = [
        `Auth URL ready${value.opened ? " (opened in browser)" : ""}.`,
        `State: ${value.state}`,
        `Scopes: ${value.scopes.join(", ")}`,
        `Authorization URL: ${value.authorizationUrl}`,
        "Next:",
        ...value.instructions.map((line) => `- ${line}`),
      ];
      if (value.warning) lines.push(`Warning: ${value.warning}`);
      return lines.join("\n");
    });
    return;
  }

  await writeOutput(payload, { ...flags, json: !flags.jsonl });
}

export async function commandLogin(flags, deps) {
  await commandLoginUrl(flags, deps);
}

export async function commandLoginLocal(flags, deps) {
  const { withClient, writeOutput, isJsonMode } = deps;
  const client = await withClient(flags);
  const requestedScopes = normalizeScopes(flags);
  const forcedState = validateState(flags.state);
  const timeoutSeconds = requirePositiveInteger(flags["timeout-seconds"], 180);
  const shouldOpen = toBoolean(flags.open, true);

  const { auth, callback, token, openResult } = await runLocalOAuthLogin({
    client,
    scopes: requestedScopes,
    state: forcedState,
    timeoutSeconds,
    open: shouldOpen,
  });

  const payload = {
    ok: true,
    generatedAt: new Date().toISOString(),
    command: "login-local",
    authorizationUrl: auth.authorizationUrl,
    redirectUri: auth.redirectUri,
    state: auth.state,
    scopes: auth.scopes,
    callback,
    token,
    ...openResult,
  };

  if (!isJsonMode(flags)) {
    await writeOutput(payload, flags, (value) => {
      const lines = [
        `Local OAuth login complete${value.opened ? " (browser opened)" : ""}.`,
        `Redirect URI: ${value.redirectUri}`,
        `State: ${value.state}`,
        `Code captured at: ${value.callback.receivedAt}`,
        `Access token expires at: ${value.token.expiresAt ?? "unknown"}`,
      ];
      if (value.warning) lines.push(`Warning: ${value.warning}`);
      return lines.join("\n");
    });
    return;
  }

  await writeOutput(payload, { ...flags, json: !flags.jsonl });
}

export async function commandExchangeCode(flags, deps) {
  const { withClient, writeOutput, readStdinText, commandRegistry } = deps;
  const code = await resolveRequiredFlagValue({
    command: "exchange-code",
    flagName: "code",
    flags,
    readStdinText,
    commandRegistry,
  });
  const client = await withClient(flags);

  const state = validateState(flags.state);
  const result = await client.exchangeCodeForToken({ code, state });
  await writeOutput(result, { ...flags, json: true });
}

export async function commandRefreshToken(flags, deps) {
  const { withClient, writeOutput } = deps;
  const client = await withClient(flags);
  const result = await client.refreshAccessToken();
  await writeOutput(result, { ...flags, json: true });
}

export async function commandWhoAmI(flags, deps) {
  const { withClient, writeOutput } = deps;
  const client = await withClient(flags);
  const profile = await client.getBasicProfile();
  await writeOutput(profile, { ...flags, json: true });
}

export async function commandLogout(flags, deps) {
  const { withClient, writeOutput, commandRegistry } = deps;
  const client = await withClient(flags);
  const sessionStatus = client.getSessionStatus();
  const hadSession = sessionStatus.hasSession;
  const confirmed = hasConfirmationBypass(flags);

  if (flags["dry-run"]) {
    await writeOutput(
      {
        ok: true,
        command: "logout",
        dryRun: true,
        wouldClearSession: hadSession,
        alreadyLoggedOut: !hadSession,
        sessionFile: sessionStatus.sessionFile,
        message: hadSession
          ? "Would clear the local WHOOP session file."
          : "No local WHOOP session found; logout would be a no-op.",
      },
      { ...flags, json: true },
    );
    return;
  }

  if (hadSession && !confirmed) {
    throw new Error(
      formatConfirmationRequiredMessage(
        "logout",
        "logout clears the local WHOOP session file.",
        commandRegistry,
      ),
    );
  }

  await client.clearSession();
  await writeOutput(
    {
      ok: true,
      command: "logout",
      clearedSession: hadSession,
      alreadyLoggedOut: !hadSession,
      sessionFile: sessionStatus.sessionFile,
      message: hadSession ? "Session cleared." : "No local session found; nothing to clear.",
    },
    { ...flags, json: true },
  );
}

export async function commandRevoke(flags, deps) {
  const { withClient, writeOutput, commandRegistry } = deps;
  const client = await withClient(flags);
  const sessionStatus = client.getSessionStatus();
  const hadAccessToken = sessionStatus.hasAccessToken;
  const hadSession = sessionStatus.hasSession;
  const confirmed = hasConfirmationBypass(flags);

  if (flags["dry-run"]) {
    await writeOutput(
      {
        ok: true,
        command: "revoke",
        dryRun: true,
        wouldRevokeAccess: hadAccessToken,
        wouldClearSession: hadSession,
        sessionFile: sessionStatus.sessionFile,
        message: hadAccessToken
          ? "Would revoke WHOOP access and clear the local session."
          : "No access token found; revoke would only clear local session state if present.",
      },
      { ...flags, json: true },
    );
    return;
  }

  if ((hadAccessToken || hadSession) && !confirmed) {
    throw new Error(
      formatConfirmationRequiredMessage(
        "revoke",
        "revoke will invalidate WHOOP access and clear local session state.",
        commandRegistry,
      ),
    );
  }

  if (!hadAccessToken) {
    await client.clearSession();
    await writeOutput(
      {
        ok: true,
        command: "revoke",
        revoked: false,
        alreadyRevoked: true,
        clearedSession: hadSession,
        sessionFile: sessionStatus.sessionFile,
        message: hadSession
          ? "No access token found; cleared local session only."
          : "No access token found; revoke was a no-op.",
      },
      { ...flags, json: true },
    );
    return;
  }

  await client.revokeAccess();
  await client.clearSession();
  await writeOutput(
    {
      ok: true,
      command: "revoke",
      revoked: true,
      clearedSession: true,
      sessionFile: sessionStatus.sessionFile,
      message: "OAuth access revoked and local session cleared.",
    },
    { ...flags, json: true },
  );
}

export const authCommandRegistrations = {
  "login-url": {
    name: "login-url",
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
    handler: commandLoginUrl,
  },
  login: {
    name: "login",
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
    handler: commandLogin,
  },
  "login-local": {
    name: "login-local",
    summary: "Run local callback server, capture code automatically, and exchange tokens.",
    usage: [
      `${CLI_NAME} login-local [--scopes read:profile,read:workout,offline] [--state <8chars>] [--timeout-seconds <n>] [--open true|false]`,
    ],
    options: [
      ...AUTH_CLIENT_OPTIONS,
      option("--state <8chars>", "Set a WHOOP-compliant 8-character OAuth state value."),
      option(
        "--timeout-seconds <n>",
        "Abort if the localhost OAuth callback does not arrive in time.",
        { type: "integer", min: 1 },
      ),
      option(
        "--open true|false",
        "Control whether the browser opens automatically (default: true).",
        { type: "boolean-string" },
      ),
      ...JSON_OUTPUT_OPTIONS,
    ],
    examples: [
      `${CLI_NAME} login-local --open`,
      `${CLI_NAME} login-local --timeout-seconds 300 --json`,
      `${CLI_NAME} login-local --scopes read:profile,read:sleep,offline`,
    ],
    handler: commandLoginLocal,
  },
  "exchange-code": {
    name: "exchange-code",
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
    handler: commandExchangeCode,
  },
  "refresh-token": {
    name: "refresh-token",
    summary: "Refresh current access token using refresh token and persist session.",
    usage: [`${CLI_NAME} refresh-token [--json]`],
    options: [...AUTH_CLIENT_OPTIONS, ...JSON_OUTPUT_OPTIONS],
    examples: [`${CLI_NAME} refresh-token`, `${CLI_NAME} refresh-token --json`],
    handler: commandRefreshToken,
  },
  whoami: {
    name: "whoami",
    summary: "Fetch authenticated WHOOP basic profile from /v2/user/profile/basic.",
    usage: [`${CLI_NAME} whoami [--json|--csv]`],
    options: [...AUTH_CLIENT_OPTIONS, ...STRUCTURED_OUTPUT_OPTIONS],
    examples: [`${CLI_NAME} whoami --json`, `${CLI_NAME} whoami --csv`],
    handler: commandWhoAmI,
  },
  revoke: {
    name: "revoke",
    summary: "Revoke OAuth access for current token and clear local session.",
    usage: [`${CLI_NAME} revoke [--dry-run] [--yes|--force] [--json]`],
    options: [...AUTH_CLIENT_OPTIONS, DRY_RUN_OPTION, YES_OPTION, FORCE_OPTION, ...JSON_OUTPUT_OPTIONS],
    examples: [
      `${CLI_NAME} revoke --dry-run --json`,
      `${CLI_NAME} revoke --yes --json`,
    ],
    handler: commandRevoke,
  },
  logout: {
    name: "logout",
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
    handler: commandLogout,
  },
};
