import assert from "node:assert/strict";
import test from "node:test";
import { hasAgentRecordTransforms } from "../src/lib/agent-filters.mjs";

test("agent record transform detection follows shared filter option schema", () => {
  assert.equal(hasAgentRecordTransforms({}), false);
  assert.equal(hasAgentRecordTransforms({ "records-only": true }), false);
  assert.equal(hasAgentRecordTransforms({ "min-strain": 0 }), true);
  assert.equal(hasAgentRecordTransforms({ sort: "strain-desc" }), true);
  assert.equal(hasAgentRecordTransforms({ fields: "id,start" }), true);
});
