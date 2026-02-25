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
