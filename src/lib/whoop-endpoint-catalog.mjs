export const WHOOP_API_BASE_URL = "https://api.prod.whoop.com";
export const WHOOP_BASE_URL = WHOOP_API_BASE_URL;
export const WHOOP_AUTHORIZATION_URL = `${WHOOP_API_BASE_URL}/oauth/oauth2/auth`;
export const WHOOP_TOKEN_URL = `${WHOOP_API_BASE_URL}/oauth/oauth2/token`;

export const WHOOP_SCOPE_CATALOG = Object.freeze([
  {
    name: "read:profile",
    description: "Read basic profile (name/email/user_id)",
    default: true,
  },
  {
    name: "read:body_measurement",
    description: "Read body measurements (height/weight/max HR)",
    default: true,
  },
  {
    name: "read:workout",
    description: "Read workout activities",
    default: true,
  },
  {
    name: "read:sleep",
    description: "Read sleep activities",
    default: true,
  },
  {
    name: "read:recovery",
    description: "Read recovery activities",
    default: true,
  },
  {
    name: "read:cycles",
    description: "Read cycle activities",
    default: true,
  },
  {
    name: "offline",
    description: "Request refresh_token for long-running access",
    default: true,
  },
]);

export const WHOOP_DEFAULT_SCOPES = Object.freeze(
  WHOOP_SCOPE_CATALOG.filter((scope) => scope.default).map((scope) => scope.name),
);

export const WHOOP_SCOPES = Object.freeze(
  Object.fromEntries(WHOOP_SCOPE_CATALOG.map((scope) => [scope.name, scope.description])),
);

export const WHOOP_ENDPOINT_CATALOG = Object.freeze([
  {
    key: "profile.basic",
    method: "GET",
    path: "/v2/user/profile/basic",
    scope: "read:profile",
    coverageGroup: "profile",
    commandNames: ["profile", "whoami"],
    description: "Fetch authenticated WHOOP basic profile.",
  },
  {
    key: "body.measurement",
    method: "GET",
    path: "/v2/user/measurement/body",
    scope: "read:body_measurement",
    coverageGroup: "profile",
    commandNames: ["body"],
    description: "Fetch authenticated WHOOP body measurements.",
  },
  {
    key: "cycle.collection",
    method: "GET",
    path: "/v2/cycle",
    scope: "read:cycles",
    coverageGroup: "collections",
    commandNames: ["cycles", "day"],
    collectionName: "cycles",
    description: "List cycle records in a date window.",
  },
  {
    key: "recovery.collection",
    method: "GET",
    path: "/v2/recovery",
    scope: "read:recovery",
    coverageGroup: "collections",
    commandNames: ["recoveries", "day"],
    collectionName: "recoveries",
    description: "List recovery records in a date window.",
  },
  {
    key: "sleep.collection",
    method: "GET",
    path: "/v2/activity/sleep",
    scope: "read:sleep",
    coverageGroup: "collections",
    commandNames: ["sleep", "day"],
    collectionName: "sleep",
    description: "List sleep records in a date window.",
  },
  {
    key: "workout.collection",
    method: "GET",
    path: "/v2/activity/workout",
    scope: "read:workout",
    coverageGroup: "collections",
    commandNames: ["workouts", "day"],
    collectionName: "workouts",
    description: "List workout records in a date window.",
  },
  {
    key: "cycle.byId",
    method: "GET",
    path: "/v2/cycle/{cycleId}",
    scope: "read:cycles",
    coverageGroup: "byId",
    description: "Fetch a cycle activity by WHOOP cycle ID.",
    command: {
      name: "cycle-by-id",
      input: {
        flagName: "cycle-id",
        paramName: "cycleId",
        valueLabel: "int",
        description: "WHOOP cycle identifier.",
        example: "123456",
        stdinDescription: "Pipe a cycle ID as plain text.",
        schema: { type: "integer", min: 1 },
        validation: "positiveInteger",
      },
      outputKey: "cycleId",
      localDateFields: true,
    },
  },
  {
    key: "activity.mapping",
    method: "GET",
    path: "/v1/activity-mapping/{activityV1Id}",
    scope: "read:workout",
    coverageGroup: "byId",
    description: "Map legacy v1 activity ID to v2 UUID via WHOOP mapping endpoint.",
    command: {
      name: "activity-map",
      input: {
        flagName: "activity-v1-id",
        paramName: "activityV1Id",
        valueLabel: "int",
        description: "Legacy WHOOP v1 activity ID.",
        example: "12345",
        stdinDescription: "Pipe a legacy v1 activity ID as plain text.",
        schema: { type: "integer", min: 1 },
        validation: "positiveInteger",
      },
      outputKey: "activityV1Id",
    },
  },
  {
    key: "sleep.byId",
    method: "GET",
    path: "/v2/activity/sleep/{sleepId}",
    scope: "read:sleep",
    coverageGroup: "byId",
    description: "Fetch a sleep activity by WHOOP sleep UUID.",
    command: {
      name: "sleep-by-id",
      input: {
        flagName: "sleep-id",
        paramName: "sleepId",
        valueLabel: "uuid",
        description: "WHOOP sleep UUID.",
        example: "<uuid>",
        stdinDescription: "Pipe a sleep UUID as plain text.",
      },
      outputKey: "sleepId",
      localDateFields: true,
    },
  },
  {
    key: "sleep.stream",
    method: "GET",
    path: "/v2/activity/sleep/{sleepId}/stream",
    scope: "read:sleep",
    coverageGroup: "byId",
    description: "Fetch raw sleep signal stream data by WHOOP sleep UUID.",
    command: {
      name: "sleep-stream",
      input: {
        flagName: "sleep-id",
        paramName: "sleepId",
        valueLabel: "uuid",
        description: "WHOOP sleep UUID.",
        example: "<uuid>",
        stdinDescription: "Pipe a sleep UUID as plain text.",
      },
      outputKey: "sleepId",
      extraOptions: [
        {
          flag: "--types <csv>",
          description:
            "Stream signals to include: hr, skin_temp, board_temp, battery_temp, sleep_classification, charging_status.",
          schema: { type: "csv" },
        },
      ],
      directUsageArgs: ["[--types hr,skin_temp]"],
      stdinUsageArgs: ["[--types hr]"],
      directExampleArgs: ["--types", "hr,skin_temp"],
      stdinExampleArgs: ["--types", "hr"],
    },
  },
  {
    key: "workout.byId",
    method: "GET",
    path: "/v2/activity/workout/{workoutId}",
    scope: "read:workout",
    coverageGroup: "byId",
    description: "Fetch a workout activity by WHOOP workout UUID.",
    command: {
      name: "workout-by-id",
      input: {
        flagName: "workout-id",
        paramName: "workoutId",
        valueLabel: "uuid",
        description: "WHOOP workout UUID.",
        example: "<uuid>",
        stdinDescription: "Pipe a workout UUID as plain text.",
      },
      outputKey: "workoutId",
      localDateFields: true,
    },
  },
  {
    key: "cycle.recovery",
    method: "GET",
    path: "/v2/cycle/{cycleId}/recovery",
    scope: "read:recovery",
    coverageGroup: "byId",
    description: "Fetch recovery record for a specific cycle ID.",
    command: {
      name: "cycle-recovery",
      input: {
        flagName: "cycle-id",
        paramName: "cycleId",
        valueLabel: "int",
        description: "WHOOP cycle identifier.",
        example: "123456",
        stdinDescription: "Pipe a cycle ID as plain text.",
        schema: { type: "integer", min: 1 },
        validation: "positiveInteger",
      },
      outputKey: "cycleId",
      localDateFields: true,
    },
  },
  {
    key: "cycle.sleep",
    method: "GET",
    path: "/v2/cycle/{cycleId}/sleep",
    scope: "read:sleep",
    coverageGroup: "byId",
    description: "Fetch sleep record for a specific cycle ID.",
    command: {
      name: "cycle-sleep",
      input: {
        flagName: "cycle-id",
        paramName: "cycleId",
        valueLabel: "int",
        description: "WHOOP cycle identifier.",
        example: "123456",
        stdinDescription: "Pipe a cycle ID as plain text.",
        schema: { type: "integer", min: 1 },
        validation: "positiveInteger",
      },
      outputKey: "cycleId",
      localDateFields: true,
    },
  },
  {
    key: "user.access",
    method: "DELETE",
    path: "/v2/user/access",
    scope: null,
    coverageGroup: "accountControl",
    commandNames: ["revoke"],
    description: "Revoke OAuth access for current token.",
  },
]);

const ENDPOINT_KEY_ALIASES = Object.freeze({
  profile: "profile.basic",
  body: "body.measurement",
  cycles: "cycle.collection",
  recoveries: "recovery.collection",
  sleep: "sleep.collection",
  workouts: "workout.collection",
  cycleById: "cycle.byId",
  activityMapping: "activity.mapping",
  sleepById: "sleep.byId",
  sleepStream: "sleep.stream",
  workoutById: "workout.byId",
  cycleRecovery: "cycle.recovery",
  cycleSleep: "cycle.sleep",
  revokeAccess: "user.access",
});

const CLIENT_METHOD_BY_ENDPOINT_KEY = Object.freeze({
  "cycle.byId": "getCycleById",
  "activity.mapping": "getActivityMapping",
  "sleep.byId": "getSleepById",
  "sleep.stream": "getSleepStream",
  "workout.byId": "getWorkoutById",
  "cycle.recovery": "getRecoveryForCycle",
  "cycle.sleep": "getSleepForCycle",
});

export const USER_ENDPOINTS = Object.freeze({
  profile: "profile.basic",
  body: "body.measurement",
  whoami: "profile.basic",
  revoke: "user.access",
});

export const COLLECTION_ENDPOINTS = Object.freeze({
  cycles: "cycle.collection",
  recoveries: "recovery.collection",
  sleep: "sleep.collection",
  workouts: "workout.collection",
});

function endpointMetadata(endpoint) {
  return {
    key: endpoint.key,
    method: endpoint.method,
    path: endpoint.path,
    scope: endpoint.scope,
    coverageGroup: endpoint.coverageGroup,
    description: endpoint.description,
  };
}

function endpointDisplay(endpoint) {
  return `${endpoint.method} ${endpoint.path}`;
}

function endpointByKey(key) {
  const catalogKey = typeof key === "object" && key !== null ? key.key : key;
  const resolvedKey = ENDPOINT_KEY_ALIASES[catalogKey] ?? catalogKey;
  return WHOOP_ENDPOINT_CATALOG.find((endpoint) => endpoint.key === resolvedKey) ?? null;
}

export function getWhoopScopeDescriptions() {
  return { ...WHOOP_SCOPES };
}

export function getWhoopEndpoint(key) {
  const endpoint = endpointByKey(key);
  if (!endpoint) throw new Error(`Unknown WHOOP endpoint catalog key "${key}".`);
  return endpointMetadata(endpoint);
}

export function getWhoopEndpointCoverage() {
  const coverage = {};
  for (const endpoint of WHOOP_ENDPOINT_CATALOG) {
    if (!endpoint.coverageGroup) continue;
    coverage[endpoint.coverageGroup] ??= [];
    coverage[endpoint.coverageGroup].push(endpointDisplay(endpoint));
  }
  return coverage;
}

export const buildEndpointCoverage = getWhoopEndpointCoverage;

export function getWhoopCollectionEndpoint(collectionName) {
  const endpoint =
    WHOOP_ENDPOINT_CATALOG.find((entry) => entry.collectionName === collectionName) ?? null;
  return endpoint ? endpointMetadata(endpoint) : null;
}

export function listWhoopCollectionCommands() {
  return WHOOP_ENDPOINT_CATALOG
    .filter((endpoint) => endpoint.collectionName)
    .map((endpoint) => ({
      name: endpoint.collectionName,
      summary: endpoint.description,
      endpoint: endpointMetadata(endpoint),
      endpointKey: endpoint.key,
    }));
}

export const COLLECTION_COMMAND_CATALOG = Object.freeze(listWhoopCollectionCommands());

export function getCollectionEndpoint(collectionName) {
  return COLLECTION_ENDPOINTS[collectionName] ?? null;
}

export function getWhoopEndpointsForCommand(commandName) {
  return WHOOP_ENDPOINT_CATALOG
    .filter((endpoint) => {
      if (endpoint.command?.name === commandName) return true;
      return endpoint.commandNames?.includes(commandName);
    })
    .map((endpoint) => endpointMetadata(endpoint));
}

export function listWhoopEndpointCommands() {
  return WHOOP_ENDPOINT_CATALOG
    .filter((endpoint) => endpoint.command)
    .map((endpoint) => ({
      ...endpoint.command,
      endpoint: endpointMetadata(endpoint),
      endpointKey: endpoint.key,
      summary: endpoint.command.summary ?? endpoint.description,
    }));
}

export const ENDPOINT_COMMAND_CATALOG = Object.freeze(
  listWhoopEndpointCommands().map((spec) => ({
    ...spec,
    input: {
      ...spec.input,
      parseType:
        spec.input.validation === "positiveInteger" ? "positive-integer" : spec.input.parseType,
    },
    clientMethod: CLIENT_METHOD_BY_ENDPOINT_KEY[spec.endpointKey],
    streamTypes:
      spec.endpointKey === "sleep.stream"
        ? [
          "hr",
          "skin_temp",
          "board_temp",
          "battery_temp",
          "sleep_classification",
          "charging_status",
        ]
        : undefined,
  })),
);

export function renderWhoopEndpointPath(key, params = {}) {
  const endpoint = endpointByKey(key);
  if (!endpoint) throw new Error(`Unknown WHOOP endpoint catalog key "${key}".`);

  return endpoint.path.replace(/\{([^}]+)\}/g, (_match, paramName) => {
    const value = params[paramName];
    if (value == null || String(value).trim() === "") {
      throw new Error(`Missing WHOOP endpoint path parameter "${paramName}" for "${key}".`);
    }
    return encodeURIComponent(String(value));
  });
}

export const buildEndpointPath = renderWhoopEndpointPath;
