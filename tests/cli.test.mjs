import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildEndpointCoverage,
  getWhoopScopeDescriptions,
} from "../src/lib/whoop-endpoint-catalog.mjs";
import { LocalSession } from "../src/lib/local-session.mjs";
import { runLocalOAuthLogin } from "../src/lib/local-oauth-flow.mjs";

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

async function getFreePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return port;
}

async function fetchWithRetry(url, { attempts = 20, delayMs = 25 } = {}) {
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fetch(url);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
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
    const requestUrl = new URL(req.url, "http://127.0.0.1");

    requests.push({
      method: req.method,
      path: requestUrl.pathname,
      query: requestUrl.searchParams.toString(),
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

    const collectionRecordsByPath = {
      "/developer/v2/cycle": [
        {
          id: 1,
          user_id: 99,
          start: "2026-03-08T05:30:00Z",
          score: { strain: 3.2 },
        },
      ],
      "/developer/v2/recovery": [
        {
          cycle_id: 1,
          user_id: 99,
          created_at: "2026-03-08T06:00:00Z",
          score: { recovery_score: 70 },
        },
      ],
      "/developer/v2/activity/sleep": [
        {
          id: "sleep-window",
          user_id: 99,
          start: "2026-03-08T06:30:00Z",
          end: "2026-03-08T11:30:00Z",
        },
      ],
      "/developer/v2/activity/workout": [
        {
          id: "workout-window",
          user_id: 99,
          start: "2026-03-08T15:00:00Z",
          end: "2026-03-08T16:00:00Z",
          sport_name: "cycling",
          score: { strain: 9.1 },
        },
      ],
    };

    if (req.method === "GET" && collectionRecordsByPath[requestUrl.pathname]) {
      return json(200, {
        records: collectionRecordsByPath[requestUrl.pathname],
        next_token: null,
      });
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

    if (req.method === "GET" && req.url.startsWith("/developer/v2/activity/sleep/sleep-uuid-1/stream")) {
      return json(200, {
        algorithm_version: "v1",
        stream: [
          {
            timestamp: "2026-03-20T01:00:00Z",
            hr: 55,
            skin_temp: 34.1,
          },
        ],
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
  const session = new LocalSession({ sessionFile });
  await session.saveTokens(
    {
      access_token: "valid-token",
      refresh_token: "refresh-token",
      token_type: "bearer",
      scope: "read:profile offline",
      expires_in: 3600,
      obtained_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    },
    {
      clientId: "client-id",
      redirectUri: "http://localhost:8787/callback",
      scope: "read:profile offline",
    },
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

function requestParams(request) {
  return new URLSearchParams(request.query);
}

function findRequest(requests, path) {
  return requests.find((request) => request.method === "GET" && request.path === path);
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

  const positionalAfterStdin = runCli(["exchange-code", "--stdin", "auth-code"], { input: "" });
  assert.equal(positionalAfterStdin.status, 1);
  assert.match(positionalAfterStdin.stderr, /Stdin was empty/);
  assert.doesNotMatch(positionalAfterStdin.stderr, /Invalid --stdin value/);
});

test("equals-sign flags parse correctly", () => {
  const result = runCli(["discover", "--level=2", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.progressiveDisclosureLevel, 2);
});

test("cli command deps omit retired date and output adapters", async () => {
  const source = await fs.readFile(cliPath, "utf8");

  for (const adapter of [
    "sortByDateAsc",
    "sortByDateDesc",
    "parseApiDateTime",
    "toDateOnlyInTimeZone",
    "formatDateTimeInTimeZone",
    "toRecordsOnlyPayload",
  ]) {
    assert.doesNotMatch(source, new RegExp(`\\b${adapter}\\b`));
  }
});

test("schema-aware argv parsing keeps boolean flags from swallowing positionals", () => {
  const help = runCli(["help", "--json", "workouts"]);
  assert.equal(help.status, 0, help.stderr);
  assert.equal(JSON.parse(help.stdout).command, "workouts");

  const helpWithTrailing = runCli(["help", "workouts", "--json", "extra"]);
  assert.equal(helpWithTrailing.status, 0, helpWithTrailing.stderr);
  assert.equal(JSON.parse(helpWithTrailing.stdout).command, "workouts");

  const commandHelp = runCli(["workouts", "--records-only", "extra", "--help", "--json"]);
  assert.equal(commandHelp.status, 0, commandHelp.stderr);
  assert.equal(JSON.parse(commandHelp.stdout).command, "workouts");

  const textHelp = runCli(["help", "workouts", "--json", "false"]);
  assert.equal(textHelp.status, 0, textHelp.stderr);
  assert.match(textHelp.stdout, /whoop-query-cli workouts \(unofficial\)/);

  const globalHelpJson = runCli(["help", "--json"]);
  assert.equal(globalHelpJson.status, 0, globalHelpJson.stderr);
  assert.equal(JSON.parse(globalHelpJson.stdout).progressiveDisclosureLevel, 2);

  const repeatedLevel = runCli(["discover", "--level", "1", "--level", "3", "--json"]);
  assert.equal(repeatedLevel.status, 0, repeatedLevel.stderr);
  assert.equal(JSON.parse(repeatedLevel.stdout).progressiveDisclosureLevel, 3);
});

test("option schema rejects invalid values before command execution", () => {
  const invalidDays = runCli(["workouts", "--days", "nope", "--json"]);
  assert.equal(invalidDays.status, 1);
  assert.match(invalidDays.stderr, /Invalid --days value "nope"/);
  assert.match(invalidDays.stderr, /Expected a positive integer/);

  const missingDays = runCli(["workouts", "--days", "--json"]);
  assert.equal(missingDays.status, 1);
  assert.match(missingDays.stderr, /Missing value for --days/);

  const emptyDays = runCli(["workouts", "--days=", "--json"]);
  assert.equal(emptyDays.status, 1);
  assert.match(emptyDays.stderr, /Missing value for --days/);

  const invalidDate = runCli(["workouts", "--from", "03-01-2026", "--json"]);
  assert.equal(invalidDate.status, 1);
  assert.match(invalidDate.stderr, /Invalid --from value "03-01-2026"/);
  assert.match(invalidDate.stderr, /Expected YYYY-MM-DD/);

  const invalidSort = runCli(["workouts", "--sort", "strainy", "--json"]);
  assert.equal(invalidSort.status, 1);
  assert.match(invalidSort.stderr, /Invalid --sort value "strainy"/);
  assert.match(invalidSort.stderr, /date\|date-desc\|strain/);

  const offsetlessDateTime = runCli([
    "workouts",
    "--start",
    "2026-03-20T10:15:30",
    "--end",
    "2026-03-20T11:15:30Z",
    "--json",
  ]);
  assert.equal(offsetlessDateTime.status, 1);
  assert.match(offsetlessDateTime.stderr, /Invalid --start value "2026-03-20T10:15:30"/);
  assert.match(offsetlessDateTime.stderr, /Expected an ISO date-time with timezone offset/);
});

test("option schema normalizes boolean-string and numeric CLI values", () => {
  const help = runCli(["login-local", "--open", "false", "--timeout-seconds", "300", "--help", "--json"]);
  assert.equal(help.status, 0, help.stderr);
  const payload = JSON.parse(help.stdout);
  assert.equal(payload.command, "login-local");
  assert.ok(payload.options.some((option) => option.name === "open" && option.type === "boolean-string"));
  assert.ok(payload.options.some((option) => option.name === "timeout-seconds" && option.type === "integer"));
});

test("json command help exposes normalized option schema", () => {
  const result = runCli(["help", "workouts", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.command, "workouts");
  assert.equal(payload.supportsAgentFilters, true);
  assert.ok(payload.options.some((option) => option.name === "days" && option.type === "integer"));
  assert.ok(payload.agentOutputOptions.some((option) => option.name === "records-only"));
  assert.ok(payload.outputModes.includes("csv"));
  assert.deepEqual(payload.endpoints, [
    {
      key: "workout.collection",
      method: "GET",
      path: "/v2/activity/workout",
      scope: "read:workout",
      coverageGroup: "collections",
      description: "List workout records in a date window.",
    },
  ]);
});

test("discover command filter returns level 3 agent schema", () => {
  const result = runCli(["discover", "--command", "workouts", "--level", "3", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.commandCount, 1);
  assert.equal(payload.commands[0].name, "workouts");
  assert.deepEqual(payload.commands[0].endpoints, [
    {
      key: "workout.collection",
      method: "GET",
      path: "/v2/activity/workout",
      scope: "read:workout",
      coverageGroup: "collections",
      description: "List workout records in a date window.",
    },
  ]);
  assert.ok(payload.commands[0].agentFilters.some((option) => option.name === "min-strain"));
  assert.ok(payload.commands[0].agentOutputOptions.some((option) => option.name === "records-only"));
});

test("capabilities derives agent-facing output modes from command registration", () => {
  const result = runCli(["capabilities", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.ok(payload.commands.includes("sleep-stream"));
  assert.deepEqual(payload.outputModes, ["text", "json", "jsonl", "csv"]);
  assert.ok(payload.agentFeatures.filterableCommands.includes("workouts"));
  assert.deepEqual(payload.scopes, getWhoopScopeDescriptions());
  assert.deepEqual(payload.endpointCoverage, buildEndpointCoverage());
});

test("unknown commands and flags return registry suggestions", () => {
  const unknownCommand = runCli(["workots"]);
  assert.equal(unknownCommand.status, 1);
  assert.match(unknownCommand.stderr, /Did you mean this\?/);
  assert.match(unknownCommand.stderr, /workouts/);

  const unknownFlag = runCli(["workouts", "--dasy", "7"]);
  assert.equal(unknownFlag.status, 1);
  assert.match(unknownFlag.stderr, /Did you mean --days/);

  const unknownEndpointFlag = runCli(["sleep-stream", "--slep-id", "sleep-uuid-1"]);
  assert.equal(unknownEndpointFlag.status, 1);
  assert.match(unknownEndpointFlag.stderr, /Did you mean --sleep-id/);

  const unknownAgentFlag = runCli(["workouts", "--min-strian", "10"]);
  assert.equal(unknownAgentFlag.status, 1);
  assert.match(unknownAgentFlag.stderr, /Did you mean --min-strain/);

  const multipleUnknownFlags = runCli(["workouts", "--dasy", "7", "--srot", "date"]);
  assert.equal(multipleUnknownFlags.status, 1);
  assert.match(multipleUnknownFlags.stderr, /--dasy/);
  assert.match(multipleUnknownFlags.stderr, /--srot/);
});

test("discover command and flag typos keep registry suggestions", () => {
  const unknownFilteredCommand = runCli(["discover", "--command", "workots", "--level", "3", "--json"]);
  assert.equal(unknownFilteredCommand.status, 1);
  assert.match(unknownFilteredCommand.stderr, /Unknown command for --command: workots/);
  assert.match(unknownFilteredCommand.stderr, /workouts/);

  const unknownDiscoverFlag = runCli(["discover", "--comand", "workouts", "--level", "3", "--json"]);
  assert.equal(unknownDiscoverFlag.status, 1);
  assert.match(unknownDiscoverFlag.stderr, /Did you mean --command/);
});

test("agent output writes json files with a single trailing newline", async () => {
  await withTempDir(async (tmpDir) => {
    const outputPath = path.join(tmpDir, "discover.json");
    const result = runCli(["discover", "--json", "--output", outputPath]);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, `Wrote JSON to ${outputPath}\n`);

    const content = await fs.readFile(outputPath, "utf8");
    assert.equal(content.endsWith("\n"), true);
    assert.equal(content.endsWith("\n\n"), false);
    const payload = JSON.parse(content);
    assert.equal(payload.progressiveDisclosureLevel, 1);
  });
});

test("endpoint required-flag guidance uses localized command registration", () => {
  const cycleById = runCli(["cycle-by-id", "--json"]);
  assert.equal(cycleById.status, 1);
  assert.match(cycleById.stderr, /Missing required --cycle-id/);
  assert.match(cycleById.stderr, /whoop-query-cli cycle-by-id --cycle-id <int>/);
  assert.match(cycleById.stderr, /Stdin: Pipe a cycle ID/);

  const sleepStream = runCli(["sleep-stream", "--json"]);
  assert.equal(sleepStream.status, 1);
  assert.match(sleepStream.stderr, /Missing required --sleep-id/);
  assert.match(sleepStream.stderr, /whoop-query-cli sleep-stream --sleep-id <uuid>/);
  assert.match(sleepStream.stderr, /Stdin: Pipe a sleep UUID/);
});

test("workouts sends timezone-correct local-day query window across DST start", async () => {
  await withTempDir(async (tmpDir) => {
    const sessionFile = path.join(tmpDir, "session.json");
    await writeSession(sessionFile);
    const server = await startMockWhoopServer();

    try {
      const result = await runCliAsync(
        [
          "workouts",
          "--from",
          "2026-03-07",
          "--to",
          "2026-03-08",
          "--tz",
          "America/New_York",
          "--json",
        ],
        { env: buildEnv(server.baseUrl, sessionFile) },
      );

      assert.equal(result.status, 0, result.stderr);
      const payload = JSON.parse(result.stdout);
      assert.equal(payload.command, "workouts");
      assert.equal(payload.query.source, "local-date-window");
      assert.equal(payload.query.fromDate, "2026-03-07");
      assert.equal(payload.query.toDate, "2026-03-08");
      assert.equal(payload.query.start, "2026-03-07T05:00:00.000Z");
      assert.equal(payload.query.end, "2026-03-09T04:00:00.000Z");
      assert.equal(payload.query.timeZone, "America/New_York");

      const request = findRequest(server.requests, "/developer/v2/activity/workout");
      assert.ok(request, "expected workouts collection request");
      const params = requestParams(request);
      assert.equal(params.get("limit"), "25");
      assert.equal(params.get("start"), "2026-03-07T05:00:00.000Z");
      assert.equal(params.get("end"), "2026-03-09T04:00:00.000Z");
    } finally {
      await server.close();
    }
  });
});

test("day sends timezone-correct single-day query window across DST end", async () => {
  await withTempDir(async (tmpDir) => {
    const sessionFile = path.join(tmpDir, "session.json");
    await writeSession(sessionFile);
    const server = await startMockWhoopServer();

    try {
      const result = await runCliAsync(
        [
          "day",
          "--date",
          "2026-11-01",
          "--tz",
          "America/New_York",
          "--json",
        ],
        { env: buildEnv(server.baseUrl, sessionFile) },
      );

      assert.equal(result.status, 0, result.stderr);
      const payload = JSON.parse(result.stdout);
      assert.equal(payload.command, "day");
      assert.equal(payload.query.source, "single-local-day");
      assert.equal(payload.query.start, "2026-11-01T04:00:00.000Z");
      assert.equal(payload.query.end, "2026-11-02T05:00:00.000Z");
      assert.equal(payload.query.timeZone, "America/New_York");

      for (const requestPath of [
        "/developer/v2/cycle",
        "/developer/v2/recovery",
        "/developer/v2/activity/sleep",
        "/developer/v2/activity/workout",
      ]) {
        const request = findRequest(server.requests, requestPath);
        assert.ok(request, `expected collection request for ${requestPath}`);
        const params = requestParams(request);
        assert.equal(params.get("limit"), "25");
        assert.equal(params.get("start"), "2026-11-01T04:00:00.000Z");
        assert.equal(params.get("end"), "2026-11-02T05:00:00.000Z");
      }
    } finally {
      await server.close();
    }
  });
});

test("agent output projects records-only json with dotted fields", async () => {
  await withTempDir(async (tmpDir) => {
    const sessionFile = path.join(tmpDir, "session.json");
    await writeSession(sessionFile);
    const server = await startMockWhoopServer();

    try {
      const result = await runCliAsync(
        [
          "workouts",
          "--from",
          "2026-03-08",
          "--to",
          "2026-03-08",
          "--fields",
          "id,score.strain,missing.path",
          "--records-only",
          "--json",
        ],
        { env: buildEnv(server.baseUrl, sessionFile) },
      );

      assert.equal(result.status, 0, result.stderr);
      const payload = JSON.parse(result.stdout);
      assert.equal(payload.command, "workouts");
      assert.equal(payload.pagination, undefined);
      assert.deepEqual(payload.filters.fields, ["id", "score.strain", "missing.path"]);
      assert.deepEqual(payload.records, [
        {
          id: "workout-window",
          "score.strain": 9.1,
          "missing.path": null,
        },
      ]);
    } finally {
      await server.close();
    }
  });
});

test("agent output keeps projected dotted fields for jsonl and csv", async () => {
  await withTempDir(async (tmpDir) => {
    const sessionFile = path.join(tmpDir, "session.json");
    await writeSession(sessionFile);
    const server = await startMockWhoopServer();

    try {
      const env = buildEnv(server.baseUrl, sessionFile);
      const args = [
        "workouts",
        "--from",
        "2026-03-08",
        "--to",
        "2026-03-08",
        "--fields",
        "id,score.strain",
      ];

      const jsonl = await runCliAsync([...args, "--jsonl"], { env });
      assert.equal(jsonl.status, 0, jsonl.stderr);
      assert.deepEqual(JSON.parse(jsonl.stdout.trim()), {
        id: "workout-window",
        "score.strain": 9.1,
      });

      const csv = await runCliAsync([...args, "--csv"], { env });
      assert.equal(csv.status, 0, csv.stderr);
      assert.equal(csv.stdout, "id,score.strain\nworkout-window,9.1\n");
    } finally {
      await server.close();
    }
  });
});

test("agent output renders singleton endpoint records as csv", async () => {
  await withTempDir(async (tmpDir) => {
    const sessionFile = path.join(tmpDir, "session.json");
    await writeSession(sessionFile);
    const server = await startMockWhoopServer();

    try {
      const result = await runCliAsync(
        ["activity-map", "--activity-v1-id", "12345", "--csv"],
        { env: buildEnv(server.baseUrl, sessionFile) },
      );

      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout, "v1_activity_id,id\n12345,workout-uuid-12345\n");
    } finally {
      await server.close();
    }
  });
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

test("local OAuth flow captures callback and exchanges the authorization code", async () => {
  const port = await getFreePort();
  const redirectUri = `http://127.0.0.1:${port}/callback`;
  let savedAuth = null;
  let exchangeArgs = null;

  const client = {
    buildAuthorizationRequest({ scopes, state }) {
      const scopeText = scopes.join(" ");
      return {
        authorizationUrl: "https://api.prod.whoop.com/oauth/oauth2/auth?state=ABCD1234",
        clientId: "client-id",
        redirectUri,
        state,
        scopes,
        scopeText,
        createdAt: new Date().toISOString(),
      };
    },
    savePendingAuthorization: async (auth) => {
      savedAuth = auth;
    },
    exchangeCodeForToken: async (args) => {
      exchangeArgs = args;
      return {
        ok: true,
        expiresAt: "2026-06-24T17:00:00.000Z",
      };
    },
  };

  const flow = runLocalOAuthLogin({
    client,
    scopes: ["read:profile", "offline"],
    state: "ABCD1234",
    timeoutSeconds: 5,
    open: false,
  });

  const response = await fetchWithRetry(`${redirectUri}?code=local-code&state=ABCD1234`);
  assert.equal(response.status, 200);

  const result = await flow;
  assert.equal(result.auth, savedAuth);
  assert.equal(result.callback.code, "local-code");
  assert.deepEqual(exchangeArgs, { code: "local-code", state: "ABCD1234" });
  assert.deepEqual(result.openResult, { opened: false });
  assert.equal(result.token.ok, true);
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
    name: "sleep-stream",
    command: "sleep-stream",
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

test("sleep-stream sends selected stream types", async () => {
  await withTempDir(async (tmpDir) => {
    const sessionFile = path.join(tmpDir, "session.json");
    await writeSession(sessionFile);
    const server = await startMockWhoopServer();

    try {
      const result = await runCliAsync(
        ["sleep-stream", "--sleep-id", "sleep-uuid-1", "--types", "hr,skin_temp", "--json"],
        { env: buildEnv(server.baseUrl, sessionFile) },
      );

      assert.equal(result.status, 0, result.stderr);
      const payload = JSON.parse(result.stdout);
      assert.equal(payload.command, "sleep-stream");
      assert.equal(payload.record.stream[0].hr, 55);
      assert.ok(
        server.requests.some(
          (request) =>
            request.path === "/developer/v2/activity/sleep/sleep-uuid-1/stream" &&
            request.query === "types=hr&types=skin_temp",
        ),
      );
    } finally {
      await server.close();
    }
  });
});

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
