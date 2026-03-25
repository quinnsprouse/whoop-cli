import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "..");
const cliPath = path.join(repoRoot, "src", "cli.mjs");

function runCli(args, options = {}) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, ...options.env },
    input: options.input,
  });
}

function runCliAsync(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd: repoRoot,
      env: { ...process.env, ...options.env },
      stdio: "pipe",
    });

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", reject);
    child.on("close", (status, signal) => {
      resolve({ status, signal, stdout, stderr });
    });

    if (options.input != null) {
      child.stdin.write(options.input);
    }
    child.stdin.end();
  });
}

async function withTempDir(run) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "whoop-cli-cli-test-"));
  try {
    return await run(tmpDir);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

async function startMockWhoopServer() {
  const requests = [];

  const server = createServer(async (req, res) => {
    const body = await new Promise((resolve) => {
      const chunks = [];
      req.setEncoding("utf8");
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => resolve(chunks.join("")));
    });

    requests.push({
      method: req.method,
      path: req.url,
      headers: req.headers,
      body,
    });

    const json = (status, payload) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
    };

    if (req.method === "POST" && req.url === "/oauth/oauth2/token") {
      return json(200, {
        access_token: "fresh-token",
        refresh_token: "fresh-refresh-token",
        token_type: "bearer",
        scope: "read:profile offline",
        expires_in: 3600,
      });
    }

    if (req.method === "DELETE" && req.url === "/developer/v2/user/access") {
      return json(200, { ok: true });
    }

    if (req.method === "GET" && req.url === "/developer/v2/cycle/123456") {
      return json(200, {
        id: 123456,
        start: "2026-03-20T10:00:00Z",
        end: "2026-03-20T12:00:00Z",
        score: { strain: 12.5 },
      });
    }

    if (req.method === "GET" && req.url === "/developer/v1/activity-mapping/12345") {
      return json(200, {
        v1_activity_id: 12345,
        id: "workout-uuid-12345",
      });
    }

    if (req.method === "GET" && req.url === "/developer/v2/activity/sleep/sleep-uuid-1") {
      return json(200, {
        id: "sleep-uuid-1",
        start: "2026-03-20T01:00:00Z",
        end: "2026-03-20T08:00:00Z",
      });
    }

    if (req.method === "GET" && req.url === "/developer/v2/activity/workout/workout-uuid-1") {
      return json(200, {
        id: "workout-uuid-1",
        start: "2026-03-20T14:00:00Z",
        end: "2026-03-20T15:00:00Z",
        sport_name: "running",
        score: { strain: 13.2 },
      });
    }

    if (req.method === "GET" && req.url === "/developer/v2/cycle/123456/recovery") {
      return json(200, {
        cycle_id: 123456,
        created_at: "2026-03-20T12:05:00Z",
        score: { recovery_score: 78 },
      });
    }

    if (req.method === "GET" && req.url === "/developer/v2/cycle/123456/sleep") {
      return json(200, {
        id: "sleep-uuid-2",
        start: "2026-03-20T01:30:00Z",
        end: "2026-03-20T08:10:00Z",
      });
    }

    return json(404, { error: "not_found", path: req.url });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    baseUrl,
    requests,
    close: async () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

async function writeSession(sessionFile) {
  await fs.mkdir(path.dirname(sessionFile), { recursive: true });
  await fs.writeFile(
    sessionFile,
    `${JSON.stringify(
      {
        tokens: {
          access_token: "valid-token",
          refresh_token: "refresh-token",
          token_type: "bearer",
          scope: "read:profile offline",
          expires_in: 3600,
          obtained_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        },
        pendingAuthorization: null,
        oauth: {
          clientId: "client-id",
          redirectUri: "http://localhost:8787/callback",
          scope: "read:profile offline",
        },
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

function buildEnv(baseUrl, sessionFile) {
  return {
    WHOOP_BASE_URL: baseUrl,
    WHOOP_CLIENT_ID: "client-id",
    WHOOP_CLIENT_SECRET: "client-secret",
    WHOOP_REDIRECT_URI: "http://localhost:8787/callback",
    WHOOP_SESSION_FILE: sessionFile,
  };
}

test("command help includes options and examples", () => {
  const result = runCli(["help", "workouts"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Options:/);
  assert.match(result.stdout, /Examples:/);
  assert.match(result.stdout, /--days <n>/);
});

test("missing required flag errors include actionable command guidance", () => {
  const result = runCli(["exchange-code"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Missing required --code/);
  assert.match(result.stderr, /whoop-query-cli exchange-code --code <authorization_code>/);
  assert.match(result.stderr, /Examples:/);
});

test("empty stdin is rejected with a concrete hint", () => {
  const result = runCli(["exchange-code", "--stdin"], { input: "" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Stdin was empty/);
  assert.match(result.stderr, /printf '%s\\n'/);
});

test("equals-sign flags parse correctly", () => {
  const result = runCli(["discover", "--level=2", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.progressiveDisclosureLevel, 2);
});

test("exchange-code accepts stdin and persists the returned token", async () => {
  await withTempDir(async (tmpDir) => {
    const sessionFile = path.join(tmpDir, "session.json");
    const server = await startMockWhoopServer();

    try {
      const result = await runCliAsync(["exchange-code", "--stdin", "--json"], {
        env: buildEnv(server.baseUrl, sessionFile),
        input: "auth-code-123\n",
      });

      assert.equal(result.status, 0, result.stderr);
      const payload = JSON.parse(result.stdout);
      assert.equal(payload.ok, true);
      assert.equal(payload.hasRefreshToken, true);

      const session = JSON.parse(await fs.readFile(sessionFile, "utf8"));
      assert.equal(session.tokens.access_token, "fresh-token");
      assert.match(server.requests[0].body, /code=auth-code-123/);
    } finally {
      await server.close();
    }
  });
});

for (const scenario of [
  {
    name: "cycle-by-id",
    command: "cycle-by-id",
    input: "123456\n",
    recordKey: "cycleId",
    expectedValue: 123456,
  },
  {
    name: "activity-map",
    command: "activity-map",
    input: "12345\n",
    recordKey: "activityV1Id",
    expectedValue: 12345,
  },
  {
    name: "sleep-by-id",
    command: "sleep-by-id",
    input: "sleep-uuid-1\n",
    recordKey: "sleepId",
    expectedValue: "sleep-uuid-1",
  },
  {
    name: "workout-by-id",
    command: "workout-by-id",
    input: "workout-uuid-1\n",
    recordKey: "workoutId",
    expectedValue: "workout-uuid-1",
  },
  {
    name: "cycle-recovery",
    command: "cycle-recovery",
    input: "123456\n",
    recordKey: "cycleId",
    expectedValue: 123456,
  },
  {
    name: "cycle-sleep",
    command: "cycle-sleep",
    input: "123456\n",
    recordKey: "cycleId",
    expectedValue: 123456,
  },
]) {
  test(`${scenario.name} accepts stdin and returns JSON`, async () => {
    await withTempDir(async (tmpDir) => {
      const sessionFile = path.join(tmpDir, "session.json");
      await writeSession(sessionFile);
      const server = await startMockWhoopServer();

      try {
        const result = await runCliAsync([scenario.command, "--stdin", "--json"], {
          env: buildEnv(server.baseUrl, sessionFile),
          input: scenario.input,
        });

        assert.equal(result.status, 0, result.stderr);
        const payload = JSON.parse(result.stdout);
        assert.equal(payload.command, scenario.command);
        assert.equal(payload[scenario.recordKey], scenario.expectedValue);
      } finally {
        await server.close();
      }
    });
  });
}

test("logout dry-run returns structured no-op details", () => {
  const sessionFile = path.join(os.tmpdir(), `whoop-query-cli-test-${Date.now()}.json`);
  const result = runCli(["logout", "--dry-run", "--json", "--session-file", sessionFile]);
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.command, "logout");
  assert.equal(payload.dryRun, true);
  assert.equal(payload.alreadyLoggedOut, true);
});

test("logout requires explicit confirmation when a session exists", async () => {
  await withTempDir(async (tmpDir) => {
    const sessionFile = path.join(tmpDir, "session.json");
    await writeSession(sessionFile);
    const result = runCli(["logout", "--json", "--session-file", sessionFile]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Re-run with --yes to continue/);
  });
});

test("logout clears session when confirmed", async () => {
  await withTempDir(async (tmpDir) => {
    const sessionFile = path.join(tmpDir, "session.json");
    await writeSession(sessionFile);
    const result = runCli(["logout", "--yes", "--json", "--session-file", sessionFile]);
    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.clearedSession, true);
    await assert.rejects(() => fs.readFile(sessionFile, "utf8"), /ENOENT/);
  });
});

test("revoke dry-run reports the pending destructive action", async () => {
  await withTempDir(async (tmpDir) => {
    const sessionFile = path.join(tmpDir, "session.json");
    await writeSession(sessionFile);
    const result = runCli(["revoke", "--dry-run", "--json", "--session-file", sessionFile]);
    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.command, "revoke");
    assert.equal(payload.dryRun, true);
    assert.equal(payload.wouldRevokeAccess, true);
  });
});

test("revoke requires explicit confirmation when session state exists", async () => {
  await withTempDir(async (tmpDir) => {
    const sessionFile = path.join(tmpDir, "session.json");
    await writeSession(sessionFile);
    const result = runCli(["revoke", "--json", "--session-file", sessionFile]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Re-run with --yes to continue/);
  });
});

test("revoke calls WHOOP and clears session when confirmed", async () => {
  await withTempDir(async (tmpDir) => {
    const sessionFile = path.join(tmpDir, "session.json");
    await writeSession(sessionFile);
    const server = await startMockWhoopServer();

    try {
      const result = await runCliAsync(["revoke", "--yes", "--json", "--session-file", sessionFile], {
        env: buildEnv(server.baseUrl, sessionFile),
      });

      assert.equal(result.status, 0, result.stderr);
      const payload = JSON.parse(result.stdout);
      assert.equal(payload.revoked, true);
      assert.ok(server.requests.some((request) => request.method === "DELETE" && request.path === "/developer/v2/user/access"));
      await assert.rejects(() => fs.readFile(sessionFile, "utf8"), /ENOENT/);
    } finally {
      await server.close();
    }
  });
});
