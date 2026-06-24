import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function maybeOpenUrl(url, shouldOpen) {
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

  const host = redirectUri.hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1");
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

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderCallbackHtml(title, message) {
  return [
    "<!doctype html>",
    "<html><head><meta charset=\"utf-8\"><title>whoop-query-cli</title></head>",
    "<body style=\"font-family: -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif; padding: 24px;\">",
    `<h2>${escapeHtml(title)}</h2>`,
    `<p>${escapeHtml(message)}</p>`,
    "<p>You can close this tab and return to your terminal.</p>",
    "</body></html>",
  ].join("");
}

export async function captureAuthorizationCode({ auth, timeoutSeconds }) {
  const callback = getLocalCallbackConfig(auth.redirectUri);
  const timeoutMs = timeoutSeconds * 1000;

  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;

    const finish = (handler) => (value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);

      const complete = () => handler(value);
      if (!server.listening) {
        complete();
        return;
      }
      server.close(complete);
    };

    const resolveOnce = finish(resolve);
    const rejectOnce = finish(reject);

    const server = createServer((req, res) => {
      res.setHeader("connection", "close");
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

export async function runLocalOAuthLogin({
  client,
  scopes = null,
  state = null,
  timeoutSeconds = 180,
  shouldOpen = true,
  open = null,
} = {}) {
  const auth = client.buildAuthorizationRequest({ scopes, state });
  await client.savePendingAuthorization(auth);
  const openResult = await maybeOpenUrl(auth.authorizationUrl, open ?? shouldOpen);
  const callback = await captureAuthorizationCode({ auth, timeoutSeconds });
  const token = await client.exchangeCodeForToken({ code: callback.code, state: callback.state });

  return {
    auth,
    callback,
    token,
    openResult,
  };
}
