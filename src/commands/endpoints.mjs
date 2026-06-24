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
import { shapeEndpointRecord } from "../lib/record-shape.mjs";
import {
  ENDPOINT_COMMAND_CATALOG,
} from "../lib/whoop-endpoint-catalog.mjs";

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
  endpoint,
  endpointKey,
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
    const record = localDateFields ? shapeEndpointRecord(rawRecord, deps.timeZone) : rawRecord;
    await writeEndpointPayload(name, record, outputKey, value, flags, deps);
  }

  return {
    name,
    summary,
    endpoint,
    endpointKey,
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

function withEndpointCommandImplementation(spec) {
  const input = {
    ...spec.input,
    parse: spec.input.parseType === "positive-integer" ? parsePositiveInteger : spec.input.parse,
  };

  const streamTypes = Array.isArray(spec.streamTypes) ? spec.streamTypes : [];
  return {
    ...spec,
    input,
    extraOptions: streamTypes.length > 0
      ? [
        option(
          "--types <csv>",
          `Stream signals to include: ${streamTypes.join(", ")}.`,
        ),
      ]
      : spec.extraOptions,
    directUsageArgs: streamTypes.length > 0 ? ["[--types hr,skin_temp]"] : spec.directUsageArgs,
    stdinUsageArgs: streamTypes.length > 0 ? ["[--types hr]"] : spec.stdinUsageArgs,
    directExampleArgs: streamTypes.length > 0 ? ["--types", "hr,skin_temp"] : spec.directExampleArgs,
    stdinExampleArgs: streamTypes.length > 0 ? ["--types", "hr"] : spec.stdinExampleArgs,
    fetchRecord: ({ client, value, flags }) => {
      if (streamTypes.length > 0) {
        const types = flags.types ? String(flags.types).trim() : null;
        return client[spec.clientMethod](value, { types });
      }
      return client[spec.clientMethod](value);
    },
  };
}

const endpointCommandSpecs = ENDPOINT_COMMAND_CATALOG.map(withEndpointCommandImplementation);

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
