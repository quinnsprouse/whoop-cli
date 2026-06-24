import assert from "node:assert/strict";
import test from "node:test";
import {
  applyAgentRecordFilters,
  hasAgentRecordTransforms,
} from "../src/lib/agent-filters.mjs";
import { buildLocalDayQueryWindow } from "../src/lib/local-day-query-window.mjs";

test("agent record transform detection follows shared filter option schema", () => {
  assert.equal(hasAgentRecordTransforms({}), false);
  assert.equal(hasAgentRecordTransforms({ "records-only": true }), false);
  assert.equal(hasAgentRecordTransforms({ "min-strain": 0 }), true);
  assert.equal(hasAgentRecordTransforms({ sort: "strain-desc" }), true);
  assert.equal(hasAgentRecordTransforms({ fields: "id,start" }), true);
});

test("agent record filters apply local-day query window post-fetch filtering", () => {
  const queryWindow = buildLocalDayQueryWindow({
    flags: { from: "2026-03-08", to: "2026-03-08" },
    timeZone: "America/New_York",
  });
  const records = [
    { id: "inside", start: "2026-03-08T05:30:00Z" },
    { id: "outside", start: "2026-03-09T04:30:00Z" },
  ];

  const { records: filtered, filterSummary } = applyAgentRecordFilters(
    records,
    {},
    "America/New_York",
    { queryWindow },
  );

  assert.deepEqual(filtered.map((record) => record.id), ["inside"]);
  assert.equal(filterSummary.from, "2026-03-08");
  assert.equal(filterSummary.to, "2026-03-08");
});

test("agent record date filters use local-day date parsing for explicit flags", () => {
  const records = [
    { id: "inside", start: "2026-03-08T05:30:00Z" },
    { id: "outside", start: "2026-03-09T04:30:00Z" },
  ];

  assert.deepEqual(
    applyAgentRecordFilters(
      records,
      { from: "2026-03-08", to: "2026-03-08" },
      "America/New_York",
    ).records.map((record) => record.id),
    ["inside"],
  );
  assert.throws(
    () =>
      applyAgentRecordFilters(
        records,
        { from: "2026-03-09", to: "2026-03-08" },
        "America/New_York",
      ),
    /--to .* is before --from/,
  );
});

test("agent record filters leave field projection to agent output", () => {
  const { records, filterSummary } = applyAgentRecordFilters(
    [{ id: "workout-1", score: { strain: 9.2 } }],
    { fields: "id,score.strain" },
    "America/New_York",
  );

  assert.deepEqual(records, [{ id: "workout-1", score: { strain: 9.2 } }]);
  assert.deepEqual(filterSummary.fields, ["id", "score.strain"]);
});
