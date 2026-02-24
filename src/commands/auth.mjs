import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

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

async function maybeOpenUrl(url, shouldOpen) {
  if (!shouldOpen) return { opened: false };
  const openCandidates =
    process.platform === "darwin"
      ? [["open", [url]]]
      : process.platform === "win32"
        ? [["cmd", ["/c", "start", "", url]]]
        : [["xdg-open", [url]], ["open", [url]]];

  for (const [command, args] of openCandidates) {
    try {
      await execFileAsync(command, args);
      return { opened: true };
    } catch {
      // Try next opener.
    }
  }

  return { opened: false, warning: "Could not automatically open browser URL." };
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

function getLocalCallbackConfig(redirectUriValue) {
  let redirectUri;
  try {
    redirectUri = new URL(String(redirectUriValue ?? ""));
  } catch {
    throw new Error("Invalid redirect URI. WHOOP_REDIRECT_URI must be a valid URL.");
  }

  if (redirectUri.protocol !== "http:") {
    throw new Error("login-local requires an http://localhost redirect URI.");
  }

  const host = redirectUri.hostname.toLowerCase();
  if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
    throw new Error("login-local requires redirect URI host localhost, 127.0.0.1, or ::1.");
  }

  const port = redirectUri.port ? Number(redirectUri.port) : 80;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid redirect URI port "${redirectUri.port}".`);
  }

  return {
    redirectUri,
    host,
    port,
    pathname: redirectUri.pathname || "/",
  };
}

function renderCallbackHtml(title, message) {
  return [
    "<!doctype html>",
    "<html><head><meta charset=\"utf-8\"><title>whoop-cli</title></head>",
    "<body style=\"font-family: -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif; padding: 24px;\">",
    `<h2>${title}</h2>`,
    `<p>${message}</p>`,
    "<p>You can close this tab and return to your terminal.</p>",
    "</body></html>",
  ].join("");
}

async function captureAuthorizationCode({ auth, timeoutSeconds }) {
  const callback = getLocalCallbackConfig(auth.redirectUri);
  const timeoutMs = timeoutSeconds * 1000;

  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;

    const finish = (handler) => (value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      server.close(() => handler(value));
    };

    const resolveOnce = finish(resolve);
    const rejectOnce = finish(reject);

    const server = createServer((req, res) => {
      try {
        const requestUrl = new URL(req.url ?? "/", auth.redirectUri);
        if (requestUrl.pathname !== callback.pathname) {
          res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
          res.end("Not Found");
          return;
        }

        const error = requestUrl.searchParams.get("error");
        const errorDescription = requestUrl.searchParams.get("error_description");
        if (error) {
          res.writeHead(400, { "content-type": "text/html; charset=utf-8" });
          res.end(
            renderCallbackHtml(
              "Authorization Failed",
              `WHOOP returned "${error}"${errorDescription ? `: ${errorDescription}` : "."}`,
            ),
          );
          rejectOnce(new Error(`WHOOP authorization failed: ${error}${errorDescription ? ` (${errorDescription})` : ""}.`));
          return;
        }

        const code = requestUrl.searchParams.get("code");
        const state = requestUrl.searchParams.get("state");
        if (!code) {
          res.writeHead(400, { "content-type": "text/html; charset=utf-8" });
          res.end(renderCallbackHtml("Authorization Failed", "Missing code query parameter."));
          rejectOnce(new Error("OAuth callback did not include code."));
          return;
        }

        if (state !== auth.state) {
          res.writeHead(400, { "content-type": "text/html; charset=utf-8" });
          res.end(renderCallbackHtml("Authorization Failed", "State mismatch detected."));
          rejectOnce(new Error("OAuth state mismatch in callback."));
          return;
        }

        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(renderCallbackHtml("Authorization Complete", "Code captured successfully."));
        resolveOnce({
          code,
          state,
          receivedAt: new Date().toISOString(),
          callbackUrl: requestUrl.toString(),
        });
      } catch (error) {
        res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
        res.end("Callback processing error.");
        rejectOnce(error);
      }
    });

    server.on("error", (error) => {
      rejectOnce(new Error(`Failed to start local callback server: ${error.message}`));
    });

    server.listen(callback.port, callback.host, () => {
      timer = setTimeout(() => {
        rejectOnce(
          new Error(
            `Timed out waiting for OAuth callback after ${timeoutSeconds}s on ${auth.redirectUri}.`,
          ),
        );
      }, timeoutMs);
    });
  });
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
      "3) Run: whoop-cli exchange-code --code <authorization_code>",
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

  const auth = client.buildAuthorizationRequest({ scopes: requestedScopes, state: forcedState });
  await client.savePendingAuthorization(auth);

  const openResult = await maybeOpenUrl(auth.authorizationUrl, shouldOpen);
  const callback = await captureAuthorizationCode({ auth, timeoutSeconds });
  const token = await client.exchangeCodeForToken({ code: callback.code, state: callback.state });

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
  const { withClient, writeOutput } = deps;
  const client = await withClient(flags);

  const code = flags.code ? String(flags.code).trim() : "";
  if (!code) {
    throw new Error("Missing required --code for exchange-code.");
  }

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
  const { withClient, writeOutput } = deps;
  const client = await withClient(flags);
  await client.clearSession();
  await writeOutput({ ok: true, message: "Session cleared." }, { ...flags, json: true });
}

export async function commandRevoke(flags, deps) {
  const { withClient, writeOutput } = deps;
  const client = await withClient(flags);
  await client.revokeAccess();
  await client.clearSession();
  await writeOutput(
    { ok: true, revoked: true, message: "OAuth access revoked and local session cleared." },
    { ...flags, json: true },
  );
}
