import assert from "node:assert/strict";
import test from "node:test";
import { COMMANDS, COMMAND_FLAG_ALLOWLIST } from "../src/lib/command-manifest.mjs";

test("new endpoint commands are present in manifest", () => {
  assert.ok(COMMANDS["cycle-by-id"]);
  assert.ok(COMMANDS["activity-map"]);
  assert.ok(COMMAND_FLAG_ALLOWLIST["cycle-by-id"].has("cycle-id"));
  assert.ok(COMMAND_FLAG_ALLOWLIST["activity-map"].has("activity-v1-id"));
});

test("csv mode is allowlisted for data and endpoint commands", () => {
  const commands = [
    "cycles",
    "recoveries",
    "sleep",
    "workouts",
    "cycle-by-id",
    "activity-map",
    "sleep-by-id",
    "workout-by-id",
    "cycle-recovery",
    "cycle-sleep",
    "day",
  ];

  for (const command of commands) {
    assert.ok(COMMAND_FLAG_ALLOWLIST[command].has("csv"), `${command} should allow --csv`);
  }
});

test("agent-oriented commands advertise examples and stdin support where relevant", () => {
  assert.ok(COMMANDS.workouts.examples.length > 0);
  assert.ok(COMMANDS["exchange-code"].stdin);
  assert.ok(COMMAND_FLAG_ALLOWLIST["exchange-code"].has("stdin"));
  assert.ok(COMMAND_FLAG_ALLOWLIST["cycle-by-id"].has("stdin"));
  assert.ok(COMMAND_FLAG_ALLOWLIST.revoke.has("dry-run"));
  assert.ok(COMMAND_FLAG_ALLOWLIST.revoke.has("yes"));
  assert.ok(COMMAND_FLAG_ALLOWLIST.revoke.has("force"));
  assert.ok(COMMAND_FLAG_ALLOWLIST.logout.has("dry-run"));
  assert.ok(COMMAND_FLAG_ALLOWLIST.logout.has("yes"));
  assert.ok(COMMAND_FLAG_ALLOWLIST.logout.has("force"));
});
