import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const WHOOP_BASE_URL = "https://api.prod.whoop.com";
const WHOOP_DEVELOPER_BASE_URL = `${WHOOP_BASE_URL}/developer`;
const WHOOP_AUTHORIZATION_URL = `${WHOOP_BASE_URL}/oauth/oauth2/auth`;
const WHOOP_TOKEN_URL = `${WHOOP_BASE_URL}/oauth/oauth2/token`;
const DEFAULT_USER_AGENT = "whoop-query-cli/0.1 (unofficial; personal data export; +https://developer.whoop.com)";
const DEFAULT_SCOPES = [
  "read:profile",
  "read:body_measurement",
  "read:workout",
  "read:sleep",
  "read:recovery",
  "read:cycles",
  "offline",
];
const TOKEN_EXPIRY_SKEW_SECONDS = 60;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_BASE_DELAY_MS = 500;
const DEFAULT_MAX_RETRY_DELAY_MS = 8000;
const DEFAULT_REFRESH_LOCK_STALE_MS = 60000;
const DEFAULT_REFRESH_LOCK_TIMEOUT_MS = 90000;
const DEFAULT_REFRESH_LOCK_POLL_MS = 150;
const DEFAULT_SESSION_FILE = path.resolve(os.homedir(), ".whoop", "session.json");

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function parseRetryAfterHeader(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;

  const asSeconds = Number(trimmed);
  if (Number.isFinite(asSeconds) && asSeconds >= 0) {
    return Math.floor(asSeconds * 1000);
  }

  const asDateMs = Date.parse(trimmed);
  if (!Number.isFinite(asDateMs)) return null;
  const delta = asDateMs - Date.now();
  if (delta <= 0) return 0;
  return Math.floor(delta);
}

function computeRetryDelayMs({
  attemptIndex,
  retryAfterMs = null,
  baseDelayMs = DEFAULT_RETRY_BASE_DELAY_MS,
  maxDelayMs = DEFAULT_MAX_RETRY_DELAY_MS,
  random = Math.random,
}) {
  if (Number.isFinite(retryAfterMs) && retryAfterMs >= 0) {
    return Math.min(Math.max(0, retryAfterMs), maxDelayMs);
  }

  const exponent = Math.max(0, Number(attemptIndex) || 0);
  const backoff = Math.min(maxDelayMs, baseDelayMs * 2 ** exponent);
  const jitter = (Math.max(0, Math.min(1, Number(random?.()) || 0)) * 0.3 + 0.85) * backoff;
  return Math.max(baseDelayMs, Math.floor(jitter));
}

function maskSecret(value) {
  if (!value) return null;
  const text = String(value);
  if (text.length <= 8) return "*".repeat(text.length);
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

function splitScopes(value) {
  if (Array.isArray(value)) {
    return value
      .map((scope) => String(scope).trim())
      .filter(Boolean);
  }
  if (!value || value === true) return [];
  return String(value)
    .split(/[\s,]+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
}

function unique(values) {
  return [...new Set(values)];
}

function clampPageLimit(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return 10;
  return Math.max(1, Math.min(parsed, 25));
}

function extractRateLimit(headers) {
  if (!headers) return null;
  return {
    limit: headers.get("x-ratelimit-limit"),
    remaining: headers.get("x-ratelimit-remaining"),
    reset: headers.get("x-ratelimit-reset"),
  };
}

function tokenIsExpired(token) {
  if (!token?.expires_at) return false;
  const expiresAt = Date.parse(token.expires_at);
  if (!Number.isFinite(expiresAt)) return false;
  return Date.now() >= expiresAt - TOKEN_EXPIRY_SKEW_SECONDS * 1000;
}

function normalizeTokenPayload(payload, fallbackScope) {
  const now = new Date();
  const expiresIn = Number(payload?.expires_in);
  const expiresInSeconds = Number.isFinite(expiresIn) ? expiresIn : null;
  const expiresAt =
    expiresInSeconds != null
      ? new Date(now.getTime() + expiresInSeconds * 1000).toISOString()
      : null;

  return {
    access_token: payload?.access_token ?? null,
    refresh_token: payload?.refresh_token ?? null,
    token_type: payload?.token_type ?? "bearer",
    scope: payload?.scope ?? fallbackScope ?? null,
    expires_in: expiresInSeconds,
    obtained_at: now.toISOString(),
    expires_at: expiresAt,
  };
}

function randomState() {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.randomBytes(16);
  let value = "";
  for (const byte of bytes) {
    value += alphabet[byte % alphabet.length];
    if (value.length === 8) break;
  }
  return value;
}

function ensureStateFormat(state) {
  const value = String(state ?? "").trim();
  if (!/^[A-Za-z0-9]{8}$/.test(value)) {
    throw new Error("Invalid OAuth state. WHOOP requires an 8-character alphanumeric state.");
  }
  return value;
}

function formatHttpError(response, payload) {
  const detail =
    typeof payload === "string"
      ? payload
      : payload && typeof payload === "object"
        ? JSON.stringify(payload)
        : "(no payload)";
  return `Request failed: ${response.status} ${response.statusText} -> ${detail}`;
}

function getPayloadErrorText(payload) {
  if (payload == null) return "";
  if (typeof payload === "string") return payload;
  if (typeof payload !== "object") return "";
  return [
    payload.error,
    payload.error_description,
    payload.message,
    payload.detail,
    payload.title,
  ]
    .filter((value) => value != null && value !== "")
    .map((value) => String(value))
    .join(" ");
}

function isLikelyAuthFailure(status, payload) {
  if (status === 401) return true;
  if (status !== 400) return false;

  const text = getPayloadErrorText(payload).toLowerCase();
  if (!text) return false;

  const signals = [
    "invalid_token",
    "expired token",
    "token expired",
    "access token",
    "bearer token",
    "unauthorized",
    "authorization",
    "invalid credentials",
    "authentication",
  ];
  return signals.some((signal) => text.includes(signal));
}

export class WhoopClient {
  constructor({
    clientId = null,
    clientSecret = null,
    redirectUri = null,
    scopes = null,
    sessionFile = DEFAULT_SESSION_FILE,
    userAgent = DEFAULT_USER_AGENT,
    fetchImpl = globalThis.fetch?.bind(globalThis),
    sleepImpl = delay,
    random = Math.random,
    maxRetries = DEFAULT_MAX_RETRIES,
    retryBaseDelayMs = DEFAULT_RETRY_BASE_DELAY_MS,
    maxRetryDelayMs = DEFAULT_MAX_RETRY_DELAY_MS,
    refreshLockStaleMs = DEFAULT_REFRESH_LOCK_STALE_MS,
    refreshLockTimeoutMs = DEFAULT_REFRESH_LOCK_TIMEOUT_MS,
    refreshLockPollMs = DEFAULT_REFRESH_LOCK_POLL_MS,
  } = {}) {
    if (typeof fetchImpl !== "function") {
      throw new Error("Global fetch is unavailable. Use Node.js 20+ or pass fetchImpl.");
    }

    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.redirectUri = redirectUri;
    this.requestedScopes = splitScopes(scopes);
    this.sessionFile = sessionFile;
    this.userAgent = userAgent;
    this.fetch = fetchImpl;
    this.sleep = typeof sleepImpl === "function" ? sleepImpl : delay;
    this.random = typeof random === "function" ? random : Math.random;
    this.maxRetries = Number.isInteger(maxRetries) && maxRetries >= 0 ? maxRetries : DEFAULT_MAX_RETRIES;
    this.retryBaseDelayMs =
      Number.isFinite(retryBaseDelayMs) && retryBaseDelayMs > 0
        ? Math.floor(retryBaseDelayMs)
        : DEFAULT_RETRY_BASE_DELAY_MS;
    this.maxRetryDelayMs =
      Number.isFinite(maxRetryDelayMs) && maxRetryDelayMs > 0
        ? Math.floor(maxRetryDelayMs)
        : DEFAULT_MAX_RETRY_DELAY_MS;
    this.refreshLockStaleMs =
      Number.isFinite(refreshLockStaleMs) && refreshLockStaleMs > 0
        ? Math.floor(refreshLockStaleMs)
        : DEFAULT_REFRESH_LOCK_STALE_MS;
    this.refreshLockTimeoutMs =
      Number.isFinite(refreshLockTimeoutMs) && refreshLockTimeoutMs > 0
        ? Math.floor(refreshLockTimeoutMs)
        : DEFAULT_REFRESH_LOCK_TIMEOUT_MS;
    this.refreshLockPollMs =
      Number.isFinite(refreshLockPollMs) && refreshLockPollMs > 0
        ? Math.floor(refreshLockPollMs)
        : DEFAULT_REFRESH_LOCK_POLL_MS;
    this.refreshLockFile = `${this.sessionFile}.refresh.lock`;
    this.session = {
      tokens: null,
      pendingAuthorization: null,
      oauth: null,
      updatedAt: null,
    };
  }

  async loadSession() {
    try {
      const raw = await fs.readFile(this.sessionFile, "utf8");
      const parsed = JSON.parse(raw);
      this.session = {
        tokens: parsed.tokens ?? null,
        pendingAuthorization: parsed.pendingAuthorization ?? null,
        oauth: parsed.oauth ?? null,
        updatedAt: parsed.updatedAt ?? null,
      };
      return true;
    } catch {
      return false;
    }
  }

  async saveSession(extra = {}) {
    const dir = path.dirname(this.sessionFile);
    await fs.mkdir(dir, { recursive: true });

    const payload = {
      tokens: this.session.tokens ?? null,
      pendingAuthorization: this.session.pendingAuthorization ?? null,
      oauth: this.session.oauth ?? null,
      updatedAt: new Date().toISOString(),
      ...extra,
    };

    await fs.writeFile(this.sessionFile, `${JSON.stringify(payload, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
  }

  async clearSession() {
    this.session = {
      tokens: null,
      pendingAuthorization: null,
      oauth: null,
      updatedAt: null,
    };

    try {
      await fs.unlink(this.sessionFile);
    } catch {
      // Ignore if file does not exist.
    }
  }

  #resolveClientId() {
    return this.clientId ?? process.env.WHOOP_CLIENT_ID ?? this.session.oauth?.clientId ?? null;
  }

  #resolveClientSecret() {
    return this.clientSecret ?? process.env.WHOOP_CLIENT_SECRET ?? null;
  }

  #resolveRedirectUri() {
    return (
      this.redirectUri ?? process.env.WHOOP_REDIRECT_URI ?? this.session.oauth?.redirectUri ?? null
    );
  }

  #resolveScopes(scopesInput = null) {
    const fromArg = splitScopes(scopesInput);
    const fromConstructor = splitScopes(this.requestedScopes);
    const fromEnv = splitScopes(process.env.WHOOP_SCOPE);
    const fromSession = splitScopes(this.session.oauth?.scope);
    const merged = unique([
      ...fromArg,
      ...fromConstructor,
      ...fromEnv,
      ...fromSession,
      ...DEFAULT_SCOPES,
    ]);
    return merged;
  }

  #requireClientCredentials() {
    const clientId = this.#resolveClientId();
    const clientSecret = this.#resolveClientSecret();

    if (!clientId) {
      throw new Error("Missing WHOOP client ID. Set WHOOP_CLIENT_ID or pass --client-id.");
    }

    if (!clientSecret) {
      throw new Error(
        "Missing WHOOP client secret. Set WHOOP_CLIENT_SECRET or pass --client-secret.",
      );
    }

    return { clientId, clientSecret };
  }

  #requireRedirectUri() {
    const redirectUri = this.#resolveRedirectUri();
    if (!redirectUri) {
      throw new Error(
        "Missing WHOOP redirect URI. Set WHOOP_REDIRECT_URI or pass --redirect-uri.",
      );
    }
    return redirectUri;
  }

  #buildTokenSummary(token, extra = {}) {
    return {
      ok: true,
      tokenType: token?.token_type ?? null,
      scope: token?.scope ?? null,
      expiresIn: token?.expires_in ?? null,
      expiresAt: token?.expires_at ?? null,
      hasRefreshToken: Boolean(token?.refresh_token),
      accessTokenPreview: maskSecret(token?.access_token),
      refreshTokenPreview: maskSecret(token?.refresh_token),
      ...extra,
    };
  }

  #isRetryableStatus(status) {
    return status === 429 || status === 408 || status === 502 || status === 503 || status === 504;
  }

  #isRetryableFetchError(error) {
    if (!error) return false;
    if (error?.name === "AbortError") return false;
    if (error?.name === "TypeError") return true;

    const code = String(error?.code ?? "").toUpperCase();
    return (
      code === "ECONNRESET" ||
      code === "ECONNREFUSED" ||
      code === "ETIMEDOUT" ||
      code === "ENOTFOUND" ||
      code === "EAI_AGAIN"
    );
  }

  async #fetchWithRetries(url, options = {}) {
    let attemptIndex = 0;

    while (true) {
      try {
        const response = await this.fetch(url, options);

        if (!this.#isRetryableStatus(response.status) || attemptIndex >= this.maxRetries) {
          return response;
        }

        const retryAfterMs = parseRetryAfterHeader(response.headers?.get("retry-after"));
        const waitMs = computeRetryDelayMs({
          attemptIndex,
          retryAfterMs,
          baseDelayMs: this.retryBaseDelayMs,
          maxDelayMs: this.maxRetryDelayMs,
          random: this.random,
        });

        await this.sleep(waitMs);
        attemptIndex += 1;
      } catch (error) {
        if (!this.#isRetryableFetchError(error) || attemptIndex >= this.maxRetries) {
          throw error;
        }

        const waitMs = computeRetryDelayMs({
          attemptIndex,
          baseDelayMs: this.retryBaseDelayMs,
          maxDelayMs: this.maxRetryDelayMs,
          random: this.random,
        });

        await this.sleep(waitMs);
        attemptIndex += 1;
      }
    }
  }

  async #clearStaleRefreshLock() {
    try {
      const stats = await fs.stat(this.refreshLockFile);
      const ageMs = Date.now() - stats.mtimeMs;
      if (ageMs >= this.refreshLockStaleMs) {
        await fs.unlink(this.refreshLockFile);
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }

  async #acquireRefreshLock() {
    const startedAt = Date.now();

    while (true) {
      let handle = null;
      try {
        handle = await fs.open(this.refreshLockFile, "wx", 0o600);
        await handle.writeFile(
          JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }),
          "utf8",
        );

        let released = false;
        return async () => {
          if (released) return;
          released = true;
          try {
            await handle.close();
          } catch {
            // Ignore close errors while releasing lock.
          }
          try {
            await fs.unlink(this.refreshLockFile);
          } catch (error) {
            if (error?.code !== "ENOENT") throw error;
          }
        };
      } catch (error) {
        if (handle) {
          try {
            await handle.close();
          } catch {
            // Ignore close errors during failed lock acquisition.
          }
        }

        if (error?.code !== "EEXIST") throw error;
        await this.#clearStaleRefreshLock();

        if (Date.now() - startedAt >= this.refreshLockTimeoutMs) {
          throw new Error(
            `Timed out waiting for refresh lock at ${this.refreshLockFile}.`,
          );
        }

        await this.sleep(this.refreshLockPollMs);
      }
    }
  }

  buildAuthorizationRequest({ scopes = null, state = null } = {}) {
    const clientId = this.#resolveClientId();
    if (!clientId) {
      throw new Error("Missing WHOOP client ID. Set WHOOP_CLIENT_ID or pass --client-id.");
    }

    const redirectUri = this.#requireRedirectUri();
    const resolvedScopes = this.#resolveScopes(scopes);
    const scopeText = resolvedScopes.join(" ");
    const resolvedState = ensureStateFormat(state ?? randomState());

    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: scopeText,
      state: resolvedState,
    });

    return {
      authorizationUrl: `${WHOOP_AUTHORIZATION_URL}?${params.toString()}`,
      state: resolvedState,
      scopes: resolvedScopes,
      scopeText,
      clientId,
      redirectUri,
      createdAt: new Date().toISOString(),
    };
  }

  async savePendingAuthorization(authorizationRequest) {
    this.session.pendingAuthorization = {
      ...authorizationRequest,
      createdAt: new Date().toISOString(),
    };

    this.session.oauth = {
      clientId: authorizationRequest.clientId,
      redirectUri: authorizationRequest.redirectUri,
      scope: authorizationRequest.scopeText,
    };

    await this.saveSession();
  }

  async #tokenRequest(body) {
    const response = await this.#fetchWithRetries(WHOOP_TOKEN_URL, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
        "user-agent": this.userAgent,
      },
      body: new URLSearchParams(body).toString(),
    });

    const raw = await response.text();
    let payload = raw;
    try {
      payload = JSON.parse(raw);
    } catch {
      // Keep text payload.
    }

    if (!response.ok) {
      const errorText = getPayloadErrorText(payload).toLowerCase();
      if (body?.grant_type === "refresh_token" && response.status === 400) {
        if (errorText.includes("invalid_grant") || errorText.includes("refresh token")) {
          throw new Error(
            "Refresh token is invalid or expired. Re-run whoop-query-cli login-local --open to re-authenticate.",
          );
        }
      }

      const retryAfterMs = parseRetryAfterHeader(response.headers?.get("retry-after"));
      const retryAfterSuffix =
        retryAfterMs != null ? ` | retryAfterMs=${retryAfterMs}` : "";
      throw new Error(`${formatHttpError(response, payload)}${retryAfterSuffix}`);
    }

    return payload;
  }

  async exchangeCodeForToken({ code, state = null }) {
    const normalizedCode = String(code ?? "").trim();
    if (!normalizedCode) throw new Error("Authorization code is required.");

    const pending = this.session.pendingAuthorization;
    if (pending?.state && state && ensureStateFormat(state) !== pending.state) {
      throw new Error("Provided --state does not match pending authorization state.");
    }

    if (pending?.state && !state) {
      // Validate stored format and use it for traceability.
      ensureStateFormat(pending.state);
    }

    const { clientId, clientSecret } = this.#requireClientCredentials();
    const redirectUri = this.#requireRedirectUri();

    const tokenPayload = await this.#tokenRequest({
      grant_type: "authorization_code",
      code: normalizedCode,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
    });

    const normalizedToken = normalizeTokenPayload(
      tokenPayload,
      pending?.scopeText ?? this.session.oauth?.scope,
    );

    this.session.tokens = normalizedToken;
    this.session.pendingAuthorization = null;
    this.session.oauth = {
      clientId,
      redirectUri,
      scope: normalizedToken.scope,
    };
    await this.saveSession();

    return this.#buildTokenSummary(normalizedToken, { refreshed: true });
  }

  async #refreshAccessTokenInternal() {
    const refreshToken = this.session.tokens?.refresh_token;
    if (!refreshToken) {
      throw new Error(
        "No refresh token in session. Re-run login and request offline scope before refreshing.",
      );
    }

    const { clientId, clientSecret } = this.#requireClientCredentials();

    const tokenPayload = await this.#tokenRequest({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      scope: this.session.tokens?.scope ?? this.session.oauth?.scope ?? undefined,
    });

    const normalizedToken = normalizeTokenPayload(
      tokenPayload,
      this.session.tokens?.scope ?? this.session.oauth?.scope,
    );

    this.session.tokens = normalizedToken;
    this.session.oauth = {
      clientId,
      redirectUri: this.#resolveRedirectUri(),
      scope: normalizedToken.scope,
    };
    await this.saveSession();

    return this.#buildTokenSummary(normalizedToken, { refreshed: true });
  }

  async #refreshAccessTokenWithLock({ force = true } = {}) {
    const releaseLock = await this.#acquireRefreshLock();
    try {
      await this.loadSession();

      if (!force) {
        const current = this.session.tokens;
        if (current?.access_token && !tokenIsExpired(current)) {
          return this.#buildTokenSummary(current, { refreshed: false });
        }
      }

      return await this.#refreshAccessTokenInternal();
    } finally {
      await releaseLock();
    }
  }

  async refreshAccessToken({ force = true, useLock = true } = {}) {
    if (useLock) {
      return this.#refreshAccessTokenWithLock({ force });
    }
    if (!force) {
      const current = this.session.tokens;
      if (current?.access_token && !tokenIsExpired(current)) {
        return this.#buildTokenSummary(current, { refreshed: false });
      }
    }
    return this.#refreshAccessTokenInternal();
  }

  async #ensureAccessToken() {
    const token = this.session.tokens;
    if (!token?.access_token) {
      throw new Error(
        "No access token found. Run whoop-query-cli login and whoop-query-cli exchange-code to authenticate.",
      );
    }

    if (tokenIsExpired(token)) {
      await this.refreshAccessToken({ force: false, useLock: true });
    }

    return this.session.tokens.access_token;
  }

  async request(pathname, {
    method = "GET",
    query = null,
    headers = null,
    body = null,
    retryOnUnauthorized = true,
  } = {}) {
    const accessToken = await this.#ensureAccessToken();
    const url = new URL(`${WHOOP_DEVELOPER_BASE_URL}${pathname}`);

    if (query && typeof query === "object") {
      for (const [key, value] of Object.entries(query)) {
        if (value == null || value === "") continue;
        url.searchParams.set(key, String(value));
      }
    }

    const requestHeaders = new Headers(headers ?? {});
    requestHeaders.set("authorization", `Bearer ${accessToken}`);
    requestHeaders.set("accept", "application/json");
    requestHeaders.set("user-agent", this.userAgent);

    let requestBody = null;
    if (body != null) {
      if (typeof body === "string") {
        requestBody = body;
      } else {
        requestBody = JSON.stringify(body);
        if (!requestHeaders.has("content-type")) {
          requestHeaders.set("content-type", "application/json");
        }
      }
    }

    const response = await this.#fetchWithRetries(url, {
      method,
      headers: requestHeaders,
      body: requestBody,
    });

    const raw = await response.text();
    let payload = raw;
    try {
      payload = raw ? JSON.parse(raw) : null;
    } catch {
      // Keep text payload.
    }

    if (
      isLikelyAuthFailure(response.status, payload) &&
      retryOnUnauthorized &&
      this.session.tokens?.refresh_token
    ) {
      await this.refreshAccessToken({ force: true, useLock: true });
      return this.request(pathname, { method, query, headers, body, retryOnUnauthorized: false });
    }

    if (!response.ok) {
      const rate = extractRateLimit(response.headers);
      const message = formatHttpError(response, payload);
      const suffix =
        rate?.remaining != null
          ? ` | rateLimit remaining=${rate.remaining} reset=${rate.reset}`
          : "";
      throw new Error(`${message}${suffix}`);
    }

    return {
      data: payload,
      status: response.status,
      headers: response.headers,
      rateLimit: extractRateLimit(response.headers),
    };
  }

  async getBasicProfile() {
    const response = await this.request("/v2/user/profile/basic");
    return response.data;
  }

  async getBodyMeasurement() {
    const response = await this.request("/v2/user/measurement/body");
    return response.data;
  }

  async getCycleById(cycleId) {
    const id = Number(cycleId);
    if (!Number.isInteger(id) || id < 1) {
      throw new Error("cycleId must be a positive integer.");
    }
    const response = await this.request(`/v2/cycle/${id}`);
    return response.data;
  }

  async getActivityMapping(activityV1Id) {
    const id = Number(activityV1Id);
    if (!Number.isInteger(id) || id < 1) {
      throw new Error("activityV1Id must be a positive integer.");
    }
    const response = await this.request(`/v1/activity-mapping/${id}`);
    return response.data;
  }

  async getSleepById(sleepId) {
    const id = String(sleepId ?? "").trim();
    if (!id) throw new Error("sleepId is required.");
    const response = await this.request(`/v2/activity/sleep/${encodeURIComponent(id)}`);
    return response.data;
  }

  async getWorkoutById(workoutId) {
    const id = String(workoutId ?? "").trim();
    if (!id) throw new Error("workoutId is required.");
    const response = await this.request(`/v2/activity/workout/${encodeURIComponent(id)}`);
    return response.data;
  }

  async getRecoveryForCycle(cycleId) {
    const id = Number(cycleId);
    if (!Number.isInteger(id) || id < 1) {
      throw new Error("cycleId must be a positive integer.");
    }
    const response = await this.request(`/v2/cycle/${id}/recovery`);
    return response.data;
  }

  async getSleepForCycle(cycleId) {
    const id = Number(cycleId);
    if (!Number.isInteger(id) || id < 1) {
      throw new Error("cycleId must be a positive integer.");
    }
    const response = await this.request(`/v2/cycle/${id}/sleep`);
    return response.data;
  }

  async getCollection(collectionName, { limit = 25, start = null, end = null, nextToken = null, allPages = false } = {}) {
    const pathByCollection = {
      cycles: "/v2/cycle",
      recoveries: "/v2/recovery",
      sleep: "/v2/activity/sleep",
      workouts: "/v2/activity/workout",
    };

    const pathname = pathByCollection[collectionName];
    if (!pathname) {
      throw new Error(`Unsupported collection "${collectionName}".`);
    }

    const records = [];
    let currentToken = nextToken ?? null;
    let pagesFetched = 0;
    let lastRateLimit = null;

    while (true) {
      const query = {
        limit: clampPageLimit(limit),
        start,
        end,
        nextToken: currentToken,
      };

      const response = await this.request(pathname, { query });
      const payload = response.data ?? {};
      const pageRecords = Array.isArray(payload.records) ? payload.records : [];
      records.push(...pageRecords);
      pagesFetched += 1;
      lastRateLimit = response.rateLimit;

      currentToken = payload.next_token ?? null;
      if (!allPages || !currentToken) break;
    }

    let member = null;
    const firstRecord = records[0];
    if (firstRecord?.user_id != null) {
      member = { user_id: firstRecord.user_id };
    }

    return {
      records,
      nextToken: currentToken,
      pagesFetched,
      rateLimit: lastRateLimit,
      member,
    };
  }

  async revokeAccess() {
    await this.request("/v2/user/access", { method: "DELETE" });
    return true;
  }
}
