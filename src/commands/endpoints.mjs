import {
  formatInvalidFlagValueMessage,
  resolveRequiredFlagValue,
} from "../lib/command-input.mjs";
import {
  AUTH_CLIENT_OPTIONS,
  STDIN_OPTION,
  STRUCTURED_OUTPUT_OPTIONS,
  TIMEZONE_OPTION,
  option,
} from "../lib/command-options.mjs";
import { CLI_NAME } from "../lib/project-info.mjs";

function requirePositiveIntegerFlag(value, {
  command,
  flagName,
  commandRegistry = null,
}) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 1) {
    throw new Error(
      formatInvalidFlagValueMessage(
        command,
        flagName,
        value,
        "a positive integer",
        commandRegistry,
      ),
    );
  }
  return numeric;
}

function identity(value) {
  return value;
}

function attachLocalDateFields(record, deps) {
  if (!record || typeof record !== "object") return record;
  const { toDateOnlyInTimeZone, formatDateTimeInTimeZone, timeZone } = deps;
  const baseDate = record.start ?? record.created_at ?? record.updated_at ?? null;
  return {
    ...record,
    localDate: toDateOnlyInTimeZone(baseDate, timeZone, {
      assumeUtcForOffsetlessDateTime: true,
    }),
    localStart: record.start
      ? formatDateTimeInTimeZone(record.start, timeZone, {
        assumeUtcForOffsetlessDateTime: true,
      })
      : null,
    localEnd: record.end
      ? formatDateTimeInTimeZone(record.end, timeZone, {
        assumeUtcForOffsetlessDateTime: true,
      })
      : null,
  };
}

async function writeEndpointPayload(command, record, key, value, flags, deps) {
  const { isJsonMode, writeOutput } = deps;
  const payload = {
    mode: "private",
    generatedAt: new Date().toISOString(),
    command,
    [key]: value,
    record,
  };

  if (!isJsonMode(flags)) {
    await writeOutput(payload, flags, (response) => {
      const rec = response.record ?? {};
      const lines = [
        `${response.command} result`,
        `${key}: ${response[key]}`,
        `id: ${rec.id ?? rec.cycle_id ?? "n/a"}`,
      ];
      if (rec.localStart) lines.push(`start: ${rec.localStart}`);
      if (rec.localEnd) lines.push(`end: ${rec.localEnd}`);
      if (rec.sport_name) lines.push(`sport: ${rec.sport_name}`);
      if (rec.score?.strain != null) lines.push(`strain: ${rec.score.strain}`);
      if (rec.score?.recovery_score != null) lines.push(`recovery: ${rec.score.recovery_score}`);
      return lines.join("\n");
    });
    return;
  }

  await writeOutput(payload, { ...flags, json: !flags.jsonl });
}

function commandInvocation(command, args) {
  return [CLI_NAME, command, ...args].filter(Boolean).join(" ");
}

function stdinExample(command, value, args) {
  return `printf '%s\\n' "${value}" | ${commandInvocation(command, ["--stdin", ...args])}`;
}

function buildEndpointOptions({
  flagName,
  valueLabel,
  description,
  schema = {},
  extraOptions = [],
  localDateFields = false,
}) {
  const options = [
    ...AUTH_CLIENT_OPTIONS,
    option(`--${flagName} <${valueLabel}>`, description, schema),
    ...extraOptions,
    STDIN_OPTION,
    ...STRUCTURED_OUTPUT_OPTIONS,
  ];

  if (localDateFields) options.push(TIMEZONE_OPTION);
  return options;
}

function createEndpointCommandRegistration({
  name,
  summary,
  input,
  outputKey,
  fetchRecord,
  localDateFields = false,
  extraOptions = [],
  directUsageArgs = [],
  stdinUsageArgs = [],
  directExampleArgs = [],
  stdinExampleArgs = [],
}) {
  const directJsonExampleArgs = [
    `--${input.flagName}`,
    input.example,
    ...directExampleArgs,
    "--json",
  ];
  const stdinJsonExampleArgs = [...stdinExampleArgs, "--json"];

  async function handler(flags, deps) {
    const { withClient, readStdinText, commandRegistry } = deps;
    const rawValue = await resolveRequiredFlagValue({
      command: name,
      flagName: input.flagName,
      flags,
      readStdinText,
      commandRegistry,
    });
    const value = (input.parse ?? identity)(rawValue, {
      command: name,
      flagName: input.flagName,
      commandRegistry,
    });
    const client = await withClient(flags);
    const rawRecord = await fetchRecord({ client, value, flags, deps });
    const record = localDateFields ? attachLocalDateFields(rawRecord, deps) : rawRecord;
    await writeEndpointPayload(name, record, outputKey, value, flags, deps);
  }

  return {
    name,
    summary,
    usage: [
      commandInvocation(name, [
        `--${input.flagName}`,
        `<${input.valueLabel}>`,
        ...directUsageArgs,
        "[--json|--csv]",
      ]),
      commandInvocation(name, ["--stdin", ...stdinUsageArgs, "[--json|--csv]"]),
    ],
    options: buildEndpointOptions({
      flagName: input.flagName,
      valueLabel: input.valueLabel,
      description: input.description,
      schema: input.schema,
      extraOptions,
      localDateFields,
    }),
    examples: [
      commandInvocation(name, directJsonExampleArgs),
      stdinExample(name, input.example, stdinJsonExampleArgs),
    ],
    stdin: {
      description: input.stdinDescription,
      examples: [stdinExample(name, input.example, stdinJsonExampleArgs)],
    },
    handler,
  };
}

const parsePositiveInteger = (value, context) => requirePositiveIntegerFlag(value, context);

const endpointCommandSpecs = [
  {
    name: "cycle-by-id",
    summary: "Fetch a cycle activity by WHOOP cycle ID.",
    input: {
      flagName: "cycle-id",
      valueLabel: "int",
      description: "WHOOP cycle identifier.",
      example: "123456",
      stdinDescription: "Pipe a cycle ID as plain text.",
      schema: { type: "integer", min: 1 },
      parse: parsePositiveInteger,
    },
    outputKey: "cycleId",
    fetchRecord: ({ client, value }) => client.getCycleById(value),
    localDateFields: true,
  },
  {
    name: "activity-map",
    summary: "Map legacy v1 activity ID to v2 UUID via WHOOP mapping endpoint.",
    input: {
      flagName: "activity-v1-id",
      valueLabel: "int",
      description: "Legacy WHOOP v1 activity ID.",
      example: "12345",
      stdinDescription: "Pipe a legacy v1 activity ID as plain text.",
      schema: { type: "integer", min: 1 },
      parse: parsePositiveInteger,
    },
    outputKey: "activityV1Id",
    fetchRecord: ({ client, value }) => client.getActivityMapping(value),
  },
  {
    name: "sleep-by-id",
    summary: "Fetch a sleep activity by WHOOP sleep UUID.",
    input: {
      flagName: "sleep-id",
      valueLabel: "uuid",
      description: "WHOOP sleep UUID.",
      example: "<uuid>",
      stdinDescription: "Pipe a sleep UUID as plain text.",
    },
    outputKey: "sleepId",
    fetchRecord: ({ client, value }) => client.getSleepById(value),
    localDateFields: true,
  },
  {
    name: "sleep-stream",
    summary: "Fetch raw sleep signal stream data by WHOOP sleep UUID.",
    input: {
      flagName: "sleep-id",
      valueLabel: "uuid",
      description: "WHOOP sleep UUID.",
      example: "<uuid>",
      stdinDescription: "Pipe a sleep UUID as plain text.",
    },
    outputKey: "sleepId",
    extraOptions: [
      option(
        "--types <csv>",
        "Stream signals to include: hr, skin_temp, board_temp, battery_temp, sleep_classification, charging_status.",
      ),
    ],
    directUsageArgs: ["[--types hr,skin_temp]"],
    stdinUsageArgs: ["[--types hr]"],
    directExampleArgs: ["--types", "hr,skin_temp"],
    stdinExampleArgs: ["--types", "hr"],
    fetchRecord: ({ client, value, flags }) => {
      const types = flags.types ? String(flags.types).trim() : null;
      return client.getSleepStream(value, { types });
    },
  },
  {
    name: "workout-by-id",
    summary: "Fetch a workout activity by WHOOP workout UUID.",
    input: {
      flagName: "workout-id",
      valueLabel: "uuid",
      description: "WHOOP workout UUID.",
      example: "<uuid>",
      stdinDescription: "Pipe a workout UUID as plain text.",
    },
    outputKey: "workoutId",
    fetchRecord: ({ client, value }) => client.getWorkoutById(value),
    localDateFields: true,
  },
  {
    name: "cycle-recovery",
    summary: "Fetch recovery record for a specific cycle ID.",
    input: {
      flagName: "cycle-id",
      valueLabel: "int",
      description: "WHOOP cycle identifier.",
      example: "123456",
      stdinDescription: "Pipe a cycle ID as plain text.",
      schema: { type: "integer", min: 1 },
      parse: parsePositiveInteger,
    },
    outputKey: "cycleId",
    fetchRecord: ({ client, value }) => client.getRecoveryForCycle(value),
    localDateFields: true,
  },
  {
    name: "cycle-sleep",
    summary: "Fetch sleep record for a specific cycle ID.",
    input: {
      flagName: "cycle-id",
      valueLabel: "int",
      description: "WHOOP cycle identifier.",
      example: "123456",
      stdinDescription: "Pipe a cycle ID as plain text.",
      schema: { type: "integer", min: 1 },
      parse: parsePositiveInteger,
    },
    outputKey: "cycleId",
    fetchRecord: ({ client, value }) => client.getSleepForCycle(value),
    localDateFields: true,
  },
];

export const endpointCommandRegistrationList = endpointCommandSpecs.map(
  (spec) => createEndpointCommandRegistration(spec),
);

export const endpointCommandRegistrations = Object.fromEntries(
  endpointCommandRegistrationList.map((registration) => [registration.name, registration]),
);

export const commandCycleById = endpointCommandRegistrations["cycle-by-id"].handler;
export const commandActivityMap = endpointCommandRegistrations["activity-map"].handler;
export const commandSleepById = endpointCommandRegistrations["sleep-by-id"].handler;
export const commandSleepStream = endpointCommandRegistrations["sleep-stream"].handler;
export const commandWorkoutById = endpointCommandRegistrations["workout-by-id"].handler;
export const commandCycleRecovery = endpointCommandRegistrations["cycle-recovery"].handler;
export const commandCycleSleep = endpointCommandRegistrations["cycle-sleep"].handler;
