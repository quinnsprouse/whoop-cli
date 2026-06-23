import assert from "node:assert/strict";
import test from "node:test";
import {
  createAgentOutput,
  isJsonMode,
  projectRecordFields,
  renderCsv,
  renderJsonl,
  toRecordsOnlyPayload,
} from "../src/lib/agent-output.mjs";

function createOutputHarness(timeZone = "America/New_York") {
  const writes = [];
  const logs = [];
  let stdout = "";
  const agentOutput = createAgentOutput({
    timeZone,
    writeFile: async (filePath, content, encoding) => {
      writes.push({ filePath, content, encoding });
    },
    stdout: {
      write: (content) => {
        stdout += content;
      },
    },
    log: (message) => {
      logs.push(message);
    },
  });

  return {
    agentOutput,
    writes,
    logs,
    get stdout() {
      return stdout;
    },
  };
}

test("agent output exposes structured output mode detection", () => {
  assert.equal(isJsonMode({}), false);
  assert.equal(isJsonMode({ json: true }), true);
  assert.equal(isJsonMode({ jsonl: true }), true);
  assert.equal(isJsonMode({ csv: true }), true);
});

test("agent output adds timezone metadata when rendering json", async () => {
  const harness = createOutputHarness();

  await harness.agentOutput.writeOutput({ command: "whoami" }, { json: true });

  assert.deepEqual(JSON.parse(harness.stdout), {
    command: "whoami",
    timeZone: "America/New_York",
  });
  assert.deepEqual(harness.logs, []);
});

test("agent output renders projected csv rows with escaping", () => {
  const content = renderCsv(
    {
      records: [
        {
          id: "workout-1",
          score: { strain: 9.2 },
          note: "hard, windy",
        },
      ],
    },
    { fields: "id,score.strain,note,missing", csv: true },
  );

  assert.equal(
    content,
    'id,score.strain,note,missing\nworkout-1,9.2,"hard, windy",',
  );

  assert.equal(
    renderCsv(
      { records: [{ id: "workout-1", "score.strain": 9.2 }] },
      { fields: "id,score.strain", csv: true },
    ),
    "id,score.strain\nworkout-1,9.2",
  );
});

test("agent output writes jsonl files through the file adapter", async () => {
  const harness = createOutputHarness();

  await harness.agentOutput.writeOutput(
    { records: [{ id: 1 }, { id: 2 }] },
    { jsonl: true, output: "/tmp/whoop-output.jsonl" },
  );

  assert.deepEqual(harness.writes, [
    {
      filePath: "/tmp/whoop-output.jsonl",
      content: '{"id":1}\n{"id":2}\n',
      encoding: "utf8",
    },
  ]);
  assert.deepEqual(harness.logs, ["Wrote JSONL to /tmp/whoop-output.jsonl"]);
});

test("agent output writes json files without adding an extra newline", async () => {
  const harness = createOutputHarness();

  await harness.agentOutput.writeOutput(
    { command: "discover" },
    { json: true, output: "/tmp/whoop-output.json" },
  );

  assert.deepEqual(harness.writes, [
    {
      filePath: "/tmp/whoop-output.json",
      content: '{\n  "command": "discover",\n  "timeZone": "America/New_York"\n}\n',
      encoding: "utf8",
    },
  ]);
  assert.deepEqual(harness.logs, ["Wrote JSON to /tmp/whoop-output.json"]);
});

test("agent output text renderer is used only for text payloads", async () => {
  const harness = createOutputHarness("America/Los_Angeles");

  await harness.agentOutput.writeOutput("capabilities", {}, (payload) => `text=${payload}`);

  assert.deepEqual(harness.logs, ["text=capabilities"]);
});

test("agent output projection and records-only helpers are reusable", () => {
  assert.deepEqual(
    projectRecordFields({ id: "a", score: { strain: 12.5 } }, ["id", "score.strain", "missing"]),
    {
      id: "a",
      "score.strain": 12.5,
      missing: null,
    },
  );

  assert.deepEqual(
    toRecordsOnlyPayload({
      mode: "private",
      generatedAt: "2026-03-20T10:00:00.000Z",
      command: "workouts",
      query: { limit: 25 },
      filters: { fields: [] },
      member: { user_id: 1 },
      records: [{ id: "workout-1" }],
      limitations: ["example"],
    }),
    {
      mode: "private",
      generatedAt: "2026-03-20T10:00:00.000Z",
      command: "workouts",
      query: { limit: 25 },
      filters: { fields: [] },
      member: { user_id: 1 },
      count: 1,
      records: [{ id: "workout-1" }],
      limitations: ["example"],
    },
  );

  assert.equal(renderJsonl({ records: [{ id: 1 }, { id: 2 }] }), '{"id":1}\n{"id":2}');
  assert.equal(renderJsonl({ record: { id: 1 } }), "");
});
