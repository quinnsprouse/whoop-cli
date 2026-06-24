const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_BASE_DELAY_MS = 500;
const DEFAULT_MAX_RETRY_DELAY_MS = 8000;
const TOKEN_EXPIRY_SKEW_SECONDS = 60;

export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

export function tokenIsExpired(token) {
  if (!token?.expires_at) return false;
  const expiresAt = Date.parse(token.expires_at);
  if (!Number.isFinite(expiresAt)) return false;
  return Date.now() >= expiresAt - TOKEN_EXPIRY_SKEW_SECONDS * 1000;
}

export function parseRetryAfterHeader(value) {
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

export function computeRetryDelayMs({
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

export function extractRateLimit(headers) {
  if (!headers) return null;
  return {
    limit: headers.get("x-ratelimit-limit"),
    remaining: headers.get("x-ratelimit-remaining"),
    reset: headers.get("x-ratelimit-reset"),
  };
}

export function formatHttpError(response, payload) {
  const detail =
    typeof payload === "string"
      ? payload
      : payload && typeof payload === "object"
        ? JSON.stringify(payload)
        : "(no payload)";
  return `Request failed: ${response.status} ${response.statusText} -> ${detail}`;
}

export function getPayloadErrorText(payload) {
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

export function isLikelyAuthFailure(status, payload) {
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

export async function fetchWithRetries(url, options = {}, {
  fetchImpl,
  sleepImpl = delay,
  random = Math.random,
  maxRetries = DEFAULT_MAX_RETRIES,
  retryBaseDelayMs = DEFAULT_RETRY_BASE_DELAY_MS,
  maxRetryDelayMs = DEFAULT_MAX_RETRY_DELAY_MS,
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("fetchImpl is required.");
  }

  let attemptIndex = 0;

  while (true) {
    try {
      const response = await fetchImpl(url, options);

      if (!isRetryableStatus(response.status) || attemptIndex >= maxRetries) {
        return response;
      }

      const retryAfterMs = parseRetryAfterHeader(response.headers?.get("retry-after"));
      const waitMs = computeRetryDelayMs({
        attemptIndex,
        retryAfterMs,
        baseDelayMs: retryBaseDelayMs,
        maxDelayMs: maxRetryDelayMs,
        random,
      });

      await sleepImpl(waitMs);
      attemptIndex += 1;
    } catch (error) {
      if (!isRetryableFetchError(error) || attemptIndex >= maxRetries) {
        throw error;
      }

      const waitMs = computeRetryDelayMs({
        attemptIndex,
        baseDelayMs: retryBaseDelayMs,
        maxDelayMs: maxRetryDelayMs,
        random,
      });

      await sleepImpl(waitMs);
      attemptIndex += 1;
    }
  }
}

function isRetryableStatus(status) {
  return status === 429 || status === 408 || status === 502 || status === 503 || status === 504;
}

function isRetryableFetchError(error) {
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

export class AuthenticatedRequest {
  constructor({
    developerBaseUrl,
    userAgent,
    fetchImpl,
    sleepImpl = delay,
    random = Math.random,
    maxRetries = DEFAULT_MAX_RETRIES,
    retryBaseDelayMs = DEFAULT_RETRY_BASE_DELAY_MS,
    maxRetryDelayMs = DEFAULT_MAX_RETRY_DELAY_MS,
    getAccessToken = null,
    refreshAccessToken = null,
    hasRefreshToken = null,
    tokenStore = null,
  } = {}) {
    if (typeof fetchImpl !== "function") {
      throw new Error("Global fetch is unavailable. Use Node.js 20+ or pass fetchImpl.");
    }
    this.developerBaseUrl = developerBaseUrl;
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
    this.getAccessToken = getAccessToken;
    this.refreshAccessToken = refreshAccessToken;
    this.hasRefreshToken = hasRefreshToken;
    this.tokenStore = tokenStore;
  }

  async fetchWithRetries(url, options = {}) {
    return fetchWithRetries(url, options, {
      fetchImpl: this.fetch,
      sleepImpl: this.sleep,
      random: this.random,
      maxRetries: this.maxRetries,
      retryBaseDelayMs: this.retryBaseDelayMs,
      maxRetryDelayMs: this.maxRetryDelayMs,
    });
  }

  async request(pathname, {
    method = "GET",
    query = null,
    headers = null,
    body = null,
    retryOnUnauthorized = true,
  } = {}) {
    const accessToken = await this.#ensureAccessToken();
    const url = new URL(`${this.developerBaseUrl}${pathname}`);

    if (query && typeof query === "object") {
      for (const [key, value] of Object.entries(query)) {
        if (value == null || value === "") continue;
        if (Array.isArray(value)) {
          for (const item of value) {
            if (item == null || item === "") continue;
            url.searchParams.append(key, String(item));
          }
          continue;
        }
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

    const response = await this.fetchWithRetries(url, {
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
      this.#hasRefreshToken()
    ) {
      await this.#refreshAccessToken({ force: true, useLock: true });
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

  async #ensureAccessToken() {
    if (typeof this.getAccessToken === "function") {
      return this.getAccessToken();
    }

    const token = this.tokenStore?.currentToken?.();
    if (!token?.access_token) {
      throw new Error(
        "No access token found. Run whoop-query-cli login and whoop-query-cli exchange-code to authenticate.",
      );
    }

    if (tokenIsExpired(token)) {
      await this.#refreshAccessToken({ force: false, useLock: true });
      const refreshedToken = this.tokenStore?.currentToken?.();
      if (!refreshedToken?.access_token) {
        throw new Error(
          "No access token found. Run whoop-query-cli login and whoop-query-cli exchange-code to authenticate.",
        );
      }
      return refreshedToken.access_token;
    }

    return token.access_token;
  }

  #hasRefreshToken() {
    if (typeof this.hasRefreshToken === "function") return this.hasRefreshToken();
    return Boolean(this.tokenStore?.currentToken?.()?.refresh_token);
  }

  async #refreshAccessToken(options) {
    if (typeof this.refreshAccessToken === "function") {
      return this.refreshAccessToken(options);
    }
    return this.tokenStore?.refreshAccessToken?.(options);
  }
}
