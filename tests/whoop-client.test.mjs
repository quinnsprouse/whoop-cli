import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WhoopClient } from "../src/whoop-client.mjs";

const TOKEN_URL = "https://api.prod.whoop.com/oauth/oauth2/token";
const PROFILE_URL = "https://api.prod.whoop.com/developer/v2/user/profile/basic";

function jsonResponse(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

async function withTempDir(run) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "whoop-query-cli-test-"));
  try {
    return await run(tmpDir);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

function buildToken({
  accessToken = "access-token",
  refreshToken = "refresh-token",
  expiresAt,
} = {}) {
  const now = new Date().toISOString();
  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: "bearer",
    scope: "read:profile offline",
    expires_in: 3600,
    obtained_at: now,
    expires_at: expiresAt,
  };
}

async function writeSession(sessionFile, token) {
  await fs.mkdir(path.dirname(sessionFile), { recursive: true });
  const payload = {
    tokens: token,
    pendingAuthorization: null,
    oauth: {
      clientId: "client-id",
      redirectUri: "http://localhost:8787/callback",
      scope: token.scope,
    },
    updatedAt: new Date().toISOString(),
  };
  await fs.writeFile(sessionFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function expiredIso() {
  return new Date(Date.now() - 5 * 60 * 1000).toISOString();
}

function futureIso() {
  return new Date(Date.now() + 60 * 60 * 1000).toISOString();
}

function makeClient(sessionFile, fetchImpl, sleepImpl = async () => {}) {
  return new WhoopClient({
    clientId: "client-id",
    clientSecret: "client-secret",
    redirectUri: "http://localhost:8787/callback",
    sessionFile,
    fetchImpl,
    sleepImpl,
    maxRetries: 2,
    retryBaseDelayMs: 1,
    maxRetryDelayMs: 25,
    refreshLockPollMs: 5,
    refreshLockTimeoutMs: 2000,
    refreshLockStaleMs: 2000,
  });
}

test("refresh lock prevents duplicate token refresh across clients", async () => {
  await withTempDir(async (tmpDir) => {
    const sessionFile = path.join(tmpDir, "session.json");
    await writeSession(
      sessionFile,
      buildToken({ accessToken: "expired-token", refreshToken: "refresh-token", expiresAt: expiredIso() }),
    );

    let tokenCalls = 0;
    let profileCalls = 0;
    const fetchImpl = async (url) => {
      const href = String(url);
      if (href === TOKEN_URL) {
        tokenCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return jsonResponse({
          access_token: "fresh-token",
          refresh_token: "refresh-token",
          token_type: "bearer",
          scope: "read:profile offline",
          expires_in: 3600,
        });
      }
      if (href === PROFILE_URL) {
        profileCalls += 1;
        return jsonResponse({ user_id: 123 });
      }
      throw new Error(`Unexpected URL: ${href}`);
    };

    const clientA = makeClient(sessionFile, fetchImpl);
    const clientB = makeClient(sessionFile, fetchImpl);

    await Promise.all([clientA.loadSession(), clientB.loadSession()]);
    await Promise.all([clientA.getBasicProfile(), clientB.getBasicProfile()]);

    assert.equal(tokenCalls, 1);
    assert.equal(profileCalls, 2);

    const stored = JSON.parse(await fs.readFile(sessionFile, "utf8"));
    assert.equal(stored.tokens.access_token, "fresh-token");
  });
});

test("request retries once on 429 using retry-after", async () => {
  await withTempDir(async (tmpDir) => {
    const sessionFile = path.join(tmpDir, "session.json");
    await writeSession(
      sessionFile,
      buildToken({ accessToken: "valid-token", refreshToken: "refresh-token", expiresAt: futureIso() }),
    );

    let attempts = 0;
    const sleepDurations = [];
    const fetchImpl = async (url) => {
      const href = String(url);
      if (href !== PROFILE_URL) throw new Error(`Unexpected URL: ${href}`);
      attempts += 1;
      if (attempts === 1) {
        return jsonResponse({ error: "rate_limited" }, 429, { "retry-after": "0" });
      }
      return jsonResponse({ user_id: 456 });
    };

    const sleepImpl = async (ms) => {
      sleepDurations.push(ms);
    };

    const client = makeClient(sessionFile, fetchImpl, sleepImpl);
    await client.loadSession();

    const payload = await client.getBasicProfile();
    assert.deepEqual(payload, { user_id: 456 });
    assert.equal(attempts, 2);
    assert.deepEqual(sleepDurations, [0]);
  });
});

test("request refreshes token when WHOOP returns 400 invalid_token", async () => {
  await withTempDir(async (tmpDir) => {
    const sessionFile = path.join(tmpDir, "session.json");
    await writeSession(
      sessionFile,
      buildToken({ accessToken: "stale-token", refreshToken: "refresh-token", expiresAt: futureIso() }),
    );

    let profileAttempts = 0;
    let tokenCalls = 0;
    const fetchImpl = async (url) => {
      const href = String(url);
      if (href === PROFILE_URL) {
        profileAttempts += 1;
        if (profileAttempts === 1) {
          return jsonResponse(
            { error: "invalid_token", error_description: "The access token expired" },
            400,
          );
        }
        return jsonResponse({ user_id: 777 });
      }
      if (href === TOKEN_URL) {
        tokenCalls += 1;
        return jsonResponse({
          access_token: "fresh-token",
          refresh_token: "refresh-token",
          token_type: "bearer",
          scope: "read:profile offline",
          expires_in: 3600,
        });
      }
      throw new Error(`Unexpected URL: ${href}`);
    };

    const client = makeClient(sessionFile, fetchImpl);
    await client.loadSession();

    const payload = await client.getBasicProfile();
    assert.deepEqual(payload, { user_id: 777 });
    assert.equal(profileAttempts, 2);
    assert.equal(tokenCalls, 1);
  });
});

test("default session file resolves to user home directory", () => {
  const client = new WhoopClient({
    fetchImpl: async () => jsonResponse({ ok: true }),
  });
  const expected = path.resolve(os.homedir(), ".whoop", "session.json");
  assert.equal(client.sessionFile, expected);
});

test("cycle-by-id and activity-map methods call expected endpoints", async () => {
  await withTempDir(async (tmpDir) => {
    const sessionFile = path.join(tmpDir, "session.json");
    await writeSession(
      sessionFile,
      buildToken({ accessToken: "valid-token", refreshToken: "refresh-token", expiresAt: futureIso() }),
    );

    const fetchImpl = async (url) => {
      const href = String(url);
      if (href.endsWith("/developer/v2/cycle/42")) {
        return jsonResponse({ id: 42, kind: "cycle" });
      }
      if (href.endsWith("/developer/v1/activity-mapping/1001")) {
        return jsonResponse({ v1_activity_id: 1001, id: "uuid-1001" });
      }
      throw new Error(`Unexpected URL: ${href}`);
    };

    const client = makeClient(sessionFile, fetchImpl);
    await client.loadSession();

    const cycle = await client.getCycleById(42);
    const mapping = await client.getActivityMapping(1001);

    assert.equal(cycle.id, 42);
    assert.equal(mapping.v1_activity_id, 1001);
    await assert.rejects(() => client.getCycleById("abc"), /positive integer/i);
    await assert.rejects(() => client.getActivityMapping(0), /positive integer/i);
  });
});

test("sleep stream method calls stream endpoint with selected types", async () => {
  await withTempDir(async (tmpDir) => {
    const sessionFile = path.join(tmpDir, "session.json");
    await writeSession(
      sessionFile,
      buildToken({ accessToken: "valid-token", refreshToken: "refresh-token", expiresAt: futureIso() }),
    );

    const seenUrls = [];
    const fetchImpl = async (url) => {
      const href = String(url);
      seenUrls.push(href);
      if (href.endsWith("/developer/v2/activity/sleep/sleep-1/stream?types=hr&types=skin_temp")) {
        return jsonResponse({ algorithm_version: "v1", stream: [{ timestamp: "2026-03-20T01:00:00Z", hr: 54 }] });
      }
      throw new Error(`Unexpected URL: ${href}`);
    };

    const client = makeClient(sessionFile, fetchImpl);
    await client.loadSession();

    const stream = await client.getSleepStream("sleep-1", { types: "hr,skin_temp" });

    assert.equal(stream.algorithm_version, "v1");
    assert.equal(stream.stream[0].hr, 54);
    assert.equal(seenUrls.length, 1);
    await assert.rejects(() => client.getSleepStream(""), /sleepId is required/i);
  });
});
