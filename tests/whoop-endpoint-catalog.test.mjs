import assert from "node:assert/strict";
import test from "node:test";
import {
  COLLECTION_COMMAND_CATALOG,
  ENDPOINT_COMMAND_CATALOG,
  WHOOP_DEFAULT_SCOPES,
  WHOOP_ENDPOINT_CATALOG,
  buildEndpointCoverage,
  buildEndpointPath,
  getCollectionEndpoint,
  getWhoopEndpointsForCommand,
  getWhoopScopeDescriptions,
} from "../src/lib/whoop-endpoint-catalog.mjs";

test("WHOOP endpoint catalog has unique keys and endpoint command mappings", () => {
  const endpointKeys = WHOOP_ENDPOINT_CATALOG.map((endpoint) => endpoint.key);
  assert.equal(new Set(endpointKeys).size, endpointKeys.length);

  assert.deepEqual(
    ENDPOINT_COMMAND_CATALOG.map((entry) => entry.name),
    [
      "cycle-by-id",
      "activity-map",
      "sleep-by-id",
      "sleep-stream",
      "workout-by-id",
      "cycle-recovery",
      "cycle-sleep",
    ],
  );

  const sleepStream = ENDPOINT_COMMAND_CATALOG.find((entry) => entry.name === "sleep-stream");
  assert.equal(sleepStream.clientMethod, "getSleepStream");
  assert.equal(sleepStream.endpoint.path, "/v2/activity/sleep/{sleepId}/stream");
  assert.equal(sleepStream.input.flagName, "sleep-id");
});

test("WHOOP endpoint catalog renders paths and collection lookups", () => {
  assert.equal(buildEndpointPath("profile"), "/v2/user/profile/basic");
  assert.equal(buildEndpointPath("cycleById", { cycleId: 123 }), "/v2/cycle/123");
  assert.equal(
    buildEndpointPath("sleepStream", { sleepId: "sleep uuid/1" }),
    "/v2/activity/sleep/sleep%20uuid%2F1/stream",
  );
  assert.equal(getCollectionEndpoint("workouts"), "workout.collection");
  assert.throws(() => buildEndpointPath("sleepStream"), /Missing WHOOP endpoint path parameter "sleepId"/);
});

test("WHOOP collection command catalog derives command metadata from collection endpoints", () => {
  assert.deepEqual(
    COLLECTION_COMMAND_CATALOG.map((entry) => ({
      name: entry.name,
      summary: entry.summary,
      endpointKey: entry.endpointKey,
      path: entry.endpoint.path,
    })),
    [
      {
        name: "cycles",
        summary: "List cycle records in a date window.",
        endpointKey: "cycle.collection",
        path: "/v2/cycle",
      },
      {
        name: "recoveries",
        summary: "List recovery records in a date window.",
        endpointKey: "recovery.collection",
        path: "/v2/recovery",
      },
      {
        name: "sleep",
        summary: "List sleep records in a date window.",
        endpointKey: "sleep.collection",
        path: "/v2/activity/sleep",
      },
      {
        name: "workouts",
        summary: "List workout records in a date window.",
        endpointKey: "workout.collection",
        path: "/v2/activity/workout",
      },
    ],
  );
});

test("WHOOP scopes and endpoint coverage derive from catalog", () => {
  const scopes = getWhoopScopeDescriptions();
  assert.deepEqual(Object.keys(scopes), WHOOP_DEFAULT_SCOPES);
  assert.equal(scopes["read:workout"], "Read workout activities");

  const coverage = buildEndpointCoverage();
  assert.deepEqual(coverage.profile, [
    "GET /v2/user/profile/basic",
    "GET /v2/user/measurement/body",
  ]);
  assert.ok(coverage.collections.includes("GET /v2/activity/workout"));
  assert.ok(coverage.byId.includes("GET /v1/activity-mapping/{activityV1Id}"));
  assert.deepEqual(getWhoopEndpointsForCommand("day").map((endpoint) => endpoint.key), [
    "cycle.collection",
    "recovery.collection",
    "sleep.collection",
    "workout.collection",
  ]);
});
