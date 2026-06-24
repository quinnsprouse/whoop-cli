import crypto from "node:crypto";
import {
  AuthenticatedRequest,
  delay,
  fetchWithRetries,
  formatHttpError,
  getPayloadErrorText,
  parseRetryAfterHeader,
  tokenIsExpired,
} from "./lib/authenticated-request.mjs";
import { DEFAULT_SESSION_FILE, LocalSession } from "./lib/local-session.mjs";
import {
  WHOOP_BASE_URL,
  WHOOP_DEFAULT_SCOPES,
  buildEndpointPath,
  getCollectionEndpoint,
} from "./lib/whoop-endpoint-catalog.mjs";

const DEFAULT_USER_AGENT = "whoop-query-cli/0.1 (unofficial; personal data export; +https://developer.whoop.com)";
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_BASE_DELAY_MS = 500;
const DEFAULT_MAX_RETRY_DELAY_MS = 8000;

function normalizeBaseUrl(value, fallback = WHOOP_BASE_URL) {
  const raw = String(value ?? fallback ?? "").trim().replace(/\/+$/, "");
  if (!raw) return fallback;
  try {
    return new URL(raw).toString().replace(/\/+$/, "");
  } catch {
    throw new Error(`Invalid WHOOP base URL "${value}". Expected an absolute URL.`);
  }
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
    refreshLockStaleMs,
    refreshLockTimeoutMs,
    refreshLockPollMs,
    baseUrl = process.env.WHOOP_BASE_URL ?? WHOOP_BASE_URL,
  } = {}) {
    if (typeof fetchImpl !== "function") {
      throw new Error("Global fetch is unavailable. Use Node.js 20+ or pass fetchImpl.");
    }

    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.redirectUri = redirectUri;
    this.requestedScopes = splitScopes(scopes);
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
    this.localSession = new LocalSession({
      sessionFile,
      sleepImpl: this.sleep,
      refreshLockStaleMs,
      refreshLockTimeoutMs,
      refreshLockPollMs,
    });
    this.sessionFile = this.localSession.sessionFile;
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.developerBaseUrl = `${this.baseUrl}/developer`;
    this.authorizationUrl = `${this.baseUrl}/oauth/oauth2/auth`;
    this.tokenUrl = `${this.baseUrl}/oauth/oauth2/token`;
    this.refreshLockFile = this.localSession.refreshLockFile;
    this.authenticatedRequest = new AuthenticatedRequest({
      developerBaseUrl: this.developerBaseUrl,
      userAgent: this.userAgent,
      fetchImpl: this.fetch,
      sleepImpl: this.sleep,
      random: this.random,
      maxRetries: this.maxRetries,
      retryBaseDelayMs: this.retryBaseDelayMs,
      maxRetryDelayMs: this.maxRetryDelayMs,
      tokenStore: {
        currentToken: () => this.localSession.getToken(),
        refreshAccessToken: (options) => this.refreshAccessToken(options),
      },
    });
  }

  get session() {
    return this.localSession.snapshot();
  }

  set session(value) {
    this.localSession.replace(value);
  }

  async loadSession() {
    return this.localSession.load();
  }

  async saveSession(extra = {}) {
    await this.localSession.save(extra);
  }

  async clearSession() {
    await this.localSession.clear();
  }

  getSessionStatus() {
    return this.localSession.getSessionStatus();
  }

  #resolveClientId() {
    return this.clientId ?? process.env.WHOOP_CLIENT_ID ?? this.localSession.getOAuth()?.clientId ?? null;
  }

  #resolveClientSecret() {
    return this.clientSecret ?? process.env.WHOOP_CLIENT_SECRET ?? null;
  }

  #resolveRedirectUri() {
    return (
      this.redirectUri ?? process.env.WHOOP_REDIRECT_URI ?? this.localSession.getOAuth()?.redirectUri ?? null
    );
  }

  #resolveScopes(scopesInput = null) {
    const fromArg = splitScopes(scopesInput);
    const fromConstructor = splitScopes(this.requestedScopes);
    const fromEnv = splitScopes(process.env.WHOOP_SCOPE);
    const fromSession = splitScopes(this.localSession.getOAuth()?.scope);
    const merged = unique([
      ...fromArg,
      ...fromConstructor,
      ...fromEnv,
      ...fromSession,
      ...WHOOP_DEFAULT_SCOPES,
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
      authorizationUrl: `${this.authorizationUrl}?${params.toString()}`,
      state: resolvedState,
      scopes: resolvedScopes,
      scopeText,
      clientId,
      redirectUri,
      createdAt: new Date().toISOString(),
    };
  }

  async savePendingAuthorization(authorizationRequest) {
    await this.localSession.savePendingAuthorization(authorizationRequest);
  }

  async #tokenRequest(body) {
    const response = await fetchWithRetries(this.tokenUrl, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
        "user-agent": this.userAgent,
      },
      body: new URLSearchParams(body).toString(),
    }, {
      fetchImpl: this.fetch,
      sleepImpl: this.sleep,
      random: this.random,
      maxRetries: this.maxRetries,
      retryBaseDelayMs: this.retryBaseDelayMs,
      maxRetryDelayMs: this.maxRetryDelayMs,
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

    const pending = this.localSession.getPendingAuthorization();
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
      pending?.scopeText ?? this.localSession.getOAuth()?.scope,
    );

    await this.localSession.saveTokens(normalizedToken, {
      clientId,
      redirectUri,
      scope: normalizedToken.scope,
    });

    return this.#buildTokenSummary(normalizedToken, { refreshed: true });
  }

  async #refreshAccessTokenInternal() {
    const currentToken = this.localSession.getToken();
    const currentOAuth = this.localSession.getOAuth();
    const refreshToken = currentToken?.refresh_token;
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
      scope: currentToken?.scope ?? currentOAuth?.scope ?? undefined,
    });

    const normalizedToken = normalizeTokenPayload(
      tokenPayload,
      currentToken?.scope ?? currentOAuth?.scope,
    );

    await this.localSession.saveTokens(normalizedToken, {
      clientId,
      redirectUri: this.#resolveRedirectUri(),
      scope: normalizedToken.scope,
      clearPendingAuthorization: false,
    });

    return this.#buildTokenSummary(normalizedToken, { refreshed: true });
  }

  async #refreshAccessTokenWithLock({ force = true } = {}) {
    return this.localSession.withRefreshLock(async () => {
      await this.loadSession();

      if (!force) {
        const current = this.localSession.getToken();
        if (current?.access_token && !tokenIsExpired(current)) {
          return this.#buildTokenSummary(current, { refreshed: false });
        }
      }

      return await this.#refreshAccessTokenInternal();
    });
  }

  async refreshAccessToken({ force = true, useLock = true } = {}) {
    if (useLock) {
      return this.#refreshAccessTokenWithLock({ force });
    }
    if (!force) {
      const current = this.localSession.getToken();
      if (current?.access_token && !tokenIsExpired(current)) {
        return this.#buildTokenSummary(current, { refreshed: false });
      }
    }
    return this.#refreshAccessTokenInternal();
  }

  async request(pathname, {
    method = "GET",
    query = null,
    headers = null,
    body = null,
    retryOnUnauthorized = true,
  } = {}) {
    return this.authenticatedRequest.request(pathname, {
      method,
      query,
      headers,
      body,
      retryOnUnauthorized,
    });
  }

  async getBasicProfile() {
    const response = await this.request(buildEndpointPath("profile"));
    return response.data;
  }

  async getBodyMeasurement() {
    const response = await this.request(buildEndpointPath("body"));
    return response.data;
  }

  async getCycleById(cycleId) {
    const id = Number(cycleId);
    if (!Number.isInteger(id) || id < 1) {
      throw new Error("cycleId must be a positive integer.");
    }
    const response = await this.request(buildEndpointPath("cycleById", { cycleId: id }));
    return response.data;
  }

  async getActivityMapping(activityV1Id) {
    const id = Number(activityV1Id);
    if (!Number.isInteger(id) || id < 1) {
      throw new Error("activityV1Id must be a positive integer.");
    }
    const response = await this.request(buildEndpointPath("activityMapping", { activityV1Id: id }));
    return response.data;
  }

  async getSleepById(sleepId) {
    const id = String(sleepId ?? "").trim();
    if (!id) throw new Error("sleepId is required.");
    const response = await this.request(buildEndpointPath("sleepById", { sleepId: id }));
    return response.data;
  }

  async getSleepStream(sleepId, { types = null } = {}) {
    const id = String(sleepId ?? "").trim();
    if (!id) throw new Error("sleepId is required.");

    const normalizedTypes = splitScopes(types);
    const query = normalizedTypes.length > 0 ? { types: normalizedTypes } : null;
    const response = await this.request(buildEndpointPath("sleepStream", { sleepId: id }), {
      query,
    });
    return response.data;
  }

  async getWorkoutById(workoutId) {
    const id = String(workoutId ?? "").trim();
    if (!id) throw new Error("workoutId is required.");
    const response = await this.request(buildEndpointPath("workoutById", { workoutId: id }));
    return response.data;
  }

  async getRecoveryForCycle(cycleId) {
    const id = Number(cycleId);
    if (!Number.isInteger(id) || id < 1) {
      throw new Error("cycleId must be a positive integer.");
    }
    const response = await this.request(buildEndpointPath("cycleRecovery", { cycleId: id }));
    return response.data;
  }

  async getSleepForCycle(cycleId) {
    const id = Number(cycleId);
    if (!Number.isInteger(id) || id < 1) {
      throw new Error("cycleId must be a positive integer.");
    }
    const response = await this.request(buildEndpointPath("cycleSleep", { cycleId: id }));
    return response.data;
  }

  async getCollection(collectionName, { limit = 25, start = null, end = null, nextToken = null, allPages = false } = {}) {
    const endpoint = getCollectionEndpoint(collectionName);
    if (!endpoint) {
      throw new Error(`Unsupported collection "${collectionName}".`);
    }
    const pathname = buildEndpointPath(endpoint);

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
    await this.request(buildEndpointPath("revokeAccess"), { method: "DELETE" });
    return true;
  }
}
