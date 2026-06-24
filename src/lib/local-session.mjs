import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const DEFAULT_SESSION_FILE = path.resolve(os.homedir(), ".whoop", "session.json");
export const DEFAULT_REFRESH_LOCK_STALE_MS = 60000;
export const DEFAULT_REFRESH_LOCK_TIMEOUT_MS = 90000;
export const DEFAULT_REFRESH_LOCK_POLL_MS = 150;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function normalizePositiveMs(value, fallback) {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

export function createEmptySession() {
  return {
    tokens: null,
    pendingAuthorization: null,
    oauth: null,
    updatedAt: null,
  };
}

export function normalizeSessionPayload(payload = {}) {
  return {
    tokens: payload?.tokens ?? null,
    pendingAuthorization: payload?.pendingAuthorization ?? null,
    oauth: payload?.oauth ?? null,
    updatedAt: payload?.updatedAt ?? null,
  };
}

export function summarizeSession(session = {}) {
  const hasAccessToken = Boolean(session?.tokens?.access_token);
  const hasTokens = Boolean(session?.tokens);
  const hasPendingAuthorization = Boolean(session?.pendingAuthorization);
  const hasOauth = Boolean(session?.oauth);
  return {
    hasAccessToken,
    hasTokens,
    hasPendingAuthorization,
    hasOauth,
    hasSession: hasTokens || hasPendingAuthorization || hasOauth,
  };
}

export class FileSessionStore {
  constructor(sessionFile = DEFAULT_SESSION_FILE) {
    this.sessionFile = sessionFile;
    this.refreshLockFile = `${this.sessionFile}.refresh.lock`;
  }

  async load() {
    try {
      const raw = await fs.readFile(this.sessionFile, "utf8");
      return { found: true, session: normalizeSessionPayload(JSON.parse(raw)) };
    } catch {
      return { found: false, session: createEmptySession() };
    }
  }

  async save(session, extra = {}) {
    const dir = path.dirname(this.sessionFile);
    await fs.mkdir(dir, { recursive: true });

    const payload = {
      ...normalizeSessionPayload(session),
      updatedAt: new Date().toISOString(),
      ...extra,
    };

    await fs.writeFile(this.sessionFile, `${JSON.stringify(payload, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    return normalizeSessionPayload(payload);
  }

  async clear() {
    try {
      await fs.unlink(this.sessionFile);
    } catch {
      // Ignore if file does not exist.
    }
  }
}

export class LocalSession {
  constructor({
    sessionFile = DEFAULT_SESSION_FILE,
    store = null,
    sleepImpl = delay,
    refreshLockStaleMs = DEFAULT_REFRESH_LOCK_STALE_MS,
    refreshLockTimeoutMs = DEFAULT_REFRESH_LOCK_TIMEOUT_MS,
    refreshLockPollMs = DEFAULT_REFRESH_LOCK_POLL_MS,
  } = {}) {
    this.store = store ?? new FileSessionStore(sessionFile);
    this.sleep = typeof sleepImpl === "function" ? sleepImpl : delay;
    this.refreshLockStaleMs = normalizePositiveMs(
      refreshLockStaleMs,
      DEFAULT_REFRESH_LOCK_STALE_MS,
    );
    this.refreshLockTimeoutMs = normalizePositiveMs(
      refreshLockTimeoutMs,
      DEFAULT_REFRESH_LOCK_TIMEOUT_MS,
    );
    this.refreshLockPollMs = normalizePositiveMs(
      refreshLockPollMs,
      DEFAULT_REFRESH_LOCK_POLL_MS,
    );
    this.session = createEmptySession();
  }

  get sessionFile() {
    return this.store.sessionFile;
  }

  get refreshLockFile() {
    return this.store.refreshLockFile;
  }

  snapshot() {
    return normalizeSessionPayload(JSON.parse(JSON.stringify(this.session)));
  }

  replace(value) {
    this.session = normalizeSessionPayload(value);
  }

  getToken() {
    return this.session.tokens ?? null;
  }

  getOAuth() {
    return this.session.oauth ?? null;
  }

  getPendingAuthorization() {
    return this.session.pendingAuthorization ?? null;
  }

  getSessionStatus() {
    return {
      sessionFile: this.sessionFile,
      ...summarizeSession(this.session),
    };
  }

  async load() {
    const { found, session } = await this.store.load();
    this.session = session;
    return found;
  }

  async save(extra = {}) {
    this.session = await this.store.save(this.session, extra);
  }

  async clear() {
    this.session = createEmptySession();
    await this.store.clear();
  }

  async clearStaleRefreshLock() {
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

  async acquireRefreshLock() {
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
        await this.clearStaleRefreshLock();

        if (Date.now() - startedAt >= this.refreshLockTimeoutMs) {
          throw new Error(
            `Timed out waiting for refresh lock at ${this.refreshLockFile}.`,
          );
        }

        await this.sleep(this.refreshLockPollMs);
      }
    }
  }

  async withRefreshLock(run) {
    const releaseLock = await this.acquireRefreshLock();
    try {
      return await run();
    } finally {
      await releaseLock();
    }
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
    await this.save();
  }

  async saveTokens(token, {
    clientId,
    redirectUri,
    scope = token?.scope ?? null,
    clearPendingAuthorization = true,
  } = {}) {
    this.session.tokens = token;
    if (clearPendingAuthorization) this.session.pendingAuthorization = null;
    this.session.oauth = {
      clientId,
      redirectUri,
      scope,
    };
    await this.save();
  }
}
