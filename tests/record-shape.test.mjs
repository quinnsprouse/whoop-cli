import assert from "node:assert/strict";
import test from "node:test";
import {
  shapeEndpointRecord,
  shapeRecords,
  shapeRecoveryRecord,
  shapeWorkoutRecord,
  toDurationSeconds,
} from "../src/lib/record-shape.mjs";

test("record shape normalizes collection records with local fields and metrics", () => {
  const [workout] = shapeRecords(
    [
      {
        id: "workout-1",
        start: "2026-03-08T15:00:00Z",
        end: "2026-03-08T16:30:00Z",
        score: { strain: "9.25" },
      },
    ],
    shapeWorkoutRecord,
    "America/New_York",
  );

  assert.equal(workout.recordType, "workout");
  assert.equal(workout.localDate, "2026-03-08");
  assert.match(workout.localStart, /^2026-03-08T11:00:00/);
  assert.match(workout.localEnd, /^2026-03-08T12:30:00/);
  assert.equal(workout.durationInSeconds, 5400);
  assert.equal(workout.strain, 9.25);

  const [recovery] = shapeRecords(
    [{ cycle_id: 1, created_at: "2026-03-08T06:00:00Z", score: { recovery_score: "70" } }],
    shapeRecoveryRecord,
    "America/New_York",
  );
  assert.equal(recovery.recordType, "recovery");
  assert.equal(recovery.localStart, "2026-03-08T01:00:00 GMT-5");
  assert.equal(recovery.recovery_score, 70);
});

test("record shape preserves endpoint local-start behavior", () => {
  const record = shapeEndpointRecord(
    {
      cycle_id: 123456,
      created_at: "2026-03-20T12:05:00Z",
      score: { recovery_score: 78 },
    },
    "America/New_York",
  );

  assert.equal(record.localDate, "2026-03-20");
  assert.equal(record.localStart, null);
  assert.equal(record.localEnd, null);
});

test("record shape returns null duration for invalid ranges", () => {
  assert.equal(toDurationSeconds("2026-03-08T16:30:00Z", "2026-03-08T15:00:00Z"), null);
  assert.equal(toDurationSeconds(null, "2026-03-08T15:00:00Z"), null);
});
