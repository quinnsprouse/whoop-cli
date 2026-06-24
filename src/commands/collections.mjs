import {
  AUTH_CLIENT_OPTIONS,
  COLLECTION_WINDOW_OPTIONS,
  STRUCTURED_OUTPUT_OPTIONS,
  TIMEZONE_OPTION,
  option,
} from "../lib/command-options.mjs";
import {
  buildLocalDayQueryWindow,
  buildSingleLocalDayQueryWindow,
} from "../lib/local-day-query-window.mjs";
import { CLI_NAME } from "../lib/project-info.mjs";
import {
  shapeCycleRecord,
  shapeRecords,
  shapeRecoveryRecord,
  shapeSleepRecord,
  shapeWorkoutRecord,
} from "../lib/record-shape.mjs";
import {
  COLLECTION_COMMAND_CATALOG,
} from "../lib/whoop-endpoint-catalog.mjs";

function toBoolean(value, fallback = false) {
  if (value == null) return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return fallback;
}

function normalizeCycleRecords(records, deps) {
  return shapeRecords(records, shapeCycleRecord, deps.timeZone);
}

function normalizeRecoveryRecords(records, deps) {
  return shapeRecords(records, shapeRecoveryRecord, deps.timeZone);
}

function normalizeSleepRecords(records, deps) {
  return shapeRecords(records, shapeSleepRecord, deps.timeZone);
}

function normalizeWorkoutRecords(records, deps) {
  return shapeRecords(records, shapeWorkoutRecord, deps.timeZone);
}

function formatCollectionText(value, deps) {
  const { hasAgentRecordTransforms, hasTransforms } = deps;
  const lines = [
    `${value.command} (${value.count}) ${value.query.start} -> ${value.query.end}${
      value.query.allPages ? " [all-pages]" : ""
    }`,
  ];

  if (hasTransforms || hasAgentRecordTransforms(value.flags ?? {})) {
    for (const item of value.records) lines.push(`- ${JSON.stringify(item)}`);
    lines.push(`Filter output: ${value.filters.outputCount}/${value.filters.inputCount}`);
    return lines.join("\n");
  }

  for (const item of value.records) {
    const metricParts = [];
    if (Number.isFinite(item.strain)) metricParts.push(`strain=${item.strain}`);
    if (Number.isFinite(item.recovery_score)) metricParts.push(`recovery=${item.recovery_score}`);
    if (item.sport_name) metricParts.push(`sport=${item.sport_name}`);
    if (item.nap != null) metricParts.push(`nap=${item.nap}`);
    lines.push(
      `- ${item.localStart ?? item.start ?? item.created_at} id=${item.id ?? item.cycle_id} ${metricParts.join(" ")}`,
    );
  }

  if (value.pagination.nextToken) {
    lines.push(`nextToken: ${value.pagination.nextToken}`);
  }

  return lines.join("\n");
}

async function runCollectionCommand(command, endpointName, normalizeRecords, flags, deps) {
  const {
    withClient,
    applyAgentRecordFilters,
    isJsonMode,
    writeOutput,
    hasAgentRecordTransforms,
  } = deps;

  const client = await withClient(flags);
  const queryWindow = buildLocalDayQueryWindow({
    flags,
    timeZone: deps.timeZone,
    defaultDays: 30,
  });
  const limitRaw = flags.limit ?? 25;
  const limit = Math.max(1, Math.min(limitRaw, 25));
  const allPages = toBoolean(flags["all-pages"], false);
  const nextToken = flags["next-token"] ? String(flags["next-token"]).trim() : null;

  const response = await client.getCollection(endpointName, {
    limit,
    start: queryWindow.start,
    end: queryWindow.end,
    nextToken,
    allPages,
  });

  const normalizedRecords = normalizeRecords(response.records, deps);
  const { records: filteredRecords, filterSummary } = applyAgentRecordFilters(
    normalizedRecords,
    flags,
    deps.timeZone,
    { queryWindow },
  );

  const payload = {
    mode: "private",
    generatedAt: new Date().toISOString(),
    command,
    query: {
      source: queryWindow.source,
      days: queryWindow.days,
      fromDate: queryWindow.fromDate,
      toDate: queryWindow.toDate,
      start: queryWindow.start,
      end: queryWindow.end,
      timeZone: queryWindow.timeZone,
      limit,
      allPages,
      nextToken,
    },
    filters: filterSummary,
    member: response.member ?? null,
    count: filteredRecords.length,
    records: filteredRecords,
    pagination: {
      pagesFetched: response.pagesFetched,
      nextToken: response.nextToken,
      rateLimit: response.rateLimit,
    },
  };

  const hasTransforms = hasAgentRecordTransforms(flags);

  if (!isJsonMode(flags)) {
    await writeOutput(payload, flags, (value) =>
      formatCollectionText({ ...value, command }, { hasAgentRecordTransforms, hasTransforms }),
    );
    return;
  }

  await writeOutput(payload, { ...flags, json: !flags.jsonl });
}

export async function commandCycles(flags, deps) {
  await runCollectionCommand("cycles", "cycles", normalizeCycleRecords, flags, deps);
}

export async function commandRecoveries(flags, deps) {
  await runCollectionCommand("recoveries", "recoveries", normalizeRecoveryRecords, flags, deps);
}

export async function commandSleep(flags, deps) {
  await runCollectionCommand("sleep", "sleep", normalizeSleepRecords, flags, deps);
}

export async function commandWorkouts(flags, deps) {
  await runCollectionCommand("workouts", "workouts", normalizeWorkoutRecords, flags, deps);
}

function average(values) {
  const numbers = values.filter((value) => Number.isFinite(value));
  if (numbers.length === 0) return null;
  const total = numbers.reduce((sum, value) => sum + value, 0);
  return Number((total / numbers.length).toFixed(2));
}

export async function commandDay(flags, deps) {
  const {
    withClient,
    isJsonMode,
    writeOutput,
  } = deps;

  const client = await withClient(flags);
  const queryWindow = buildSingleLocalDayQueryWindow({
    date: flags.date,
    timeZone: deps.timeZone,
  });
  const { date, start, end } = queryWindow;

  const [cycles, recoveries, sleep, workouts] = await Promise.all([
    client.getCollection("cycles", { start, end, limit: 25, allPages: true }),
    client.getCollection("recoveries", { start, end, limit: 25, allPages: true }),
    client.getCollection("sleep", { start, end, limit: 25, allPages: true }),
    client.getCollection("workouts", { start, end, limit: 25, allPages: true }),
  ]);

  const cycleRecords = normalizeCycleRecords(cycles.records, deps);
  const recoveryRecords = normalizeRecoveryRecords(recoveries.records, deps);
  const sleepRecords = normalizeSleepRecords(sleep.records, deps);
  const workoutRecords = normalizeWorkoutRecords(workouts.records, deps);

  const payload = {
    mode: "private",
    generatedAt: new Date().toISOString(),
    command: "day",
    date,
    query: {
      source: queryWindow.source,
      start,
      end,
      timeZone: queryWindow.timeZone,
    },
    summary: {
      cycleCount: cycleRecords.length,
      recoveryCount: recoveryRecords.length,
      sleepCount: sleepRecords.length,
      napCount: sleepRecords.filter((record) => record.nap === true).length,
      workoutCount: workoutRecords.length,
      totalWorkoutStrain: Number(
        workoutRecords
          .map((record) => record.strain)
          .filter((value) => Number.isFinite(value))
          .reduce((sum, value) => sum + value, 0)
          .toFixed(2),
      ),
      avgRecoveryScore: average(recoveryRecords.map((record) => record.recovery_score)),
      avgCycleStrain: average(cycleRecords.map((record) => record.strain)),
    },
    records:
      flags["include-records"] || flags["records-only"]
        ? {
          cycles: cycleRecords,
          recoveries: recoveryRecords,
          sleep: sleepRecords,
          workouts: workoutRecords,
        }
        : undefined,
  };

  if (!isJsonMode(flags)) {
    await writeOutput(payload, flags, (value) => {
      const lines = [
        `WHOOP day snapshot: ${value.date}`,
        `Cycles: ${value.summary.cycleCount}`,
        `Recoveries: ${value.summary.recoveryCount} (avg=${value.summary.avgRecoveryScore ?? "n/a"})`,
        `Sleep: ${value.summary.sleepCount} (naps=${value.summary.napCount})`,
        `Workouts: ${value.summary.workoutCount} (total strain=${value.summary.totalWorkoutStrain})`,
      ];
      if (!value.records) {
        lines.push("Tip: add --include-records --json for raw day records.");
      }
      return lines.join("\n");
    });
    return;
  }

  await writeOutput(payload, { ...flags, json: !flags.jsonl });
}

function collectionCommandOptions() {
  return [
    ...AUTH_CLIENT_OPTIONS,
    ...COLLECTION_WINDOW_OPTIONS,
    ...STRUCTURED_OUTPUT_OPTIONS,
    TIMEZONE_OPTION,
  ];
}

function collectionUsage(commandName) {
  return [
    `${CLI_NAME} ${commandName} [--days <n>] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--limit <n>] [--all-pages] [--json|--jsonl|--csv]`,
  ];
}

const localCollectionCommandMetadata = {
  cycles: {
    examples: [
      `${CLI_NAME} cycles --days 14 --json`,
      `${CLI_NAME} cycles --from 2026-03-01 --to 2026-03-25 --all-pages --jsonl`,
      `${CLI_NAME} cycles --days 30 --min-strain 10 --sort strain-desc --json`,
    ],
    handler: commandCycles,
  },
  recoveries: {
    examples: [
      `${CLI_NAME} recoveries --days 30 --json`,
      `${CLI_NAME} recoveries --days 60 --max-recovery 40 --sort recovery --jsonl`,
      `${CLI_NAME} recoveries --from 2026-03-01 --to 2026-03-25 --fields cycle_id,score.recovery_score --csv`,
    ],
    handler: commandRecoveries,
  },
  sleep: {
    examples: [
      `${CLI_NAME} sleep --days 14 --json`,
      `${CLI_NAME} sleep --from 2026-03-01 --to 2026-03-25 --fields id,start,end,score.sleep_performance_percentage --json`,
      `${CLI_NAME} sleep --days 30 --type nap --jsonl`,
    ],
    handler: commandSleep,
  },
  workouts: {
    examples: [
      `${CLI_NAME} workouts --days 14 --json`,
      `${CLI_NAME} workouts --days 30 --min-strain 12 --sort strain-desc --result-limit 20 --json`,
      `${CLI_NAME} workouts --from 2026-03-01 --to 2026-03-25 --fields id,start,sport_name,score.strain --csv`,
    ],
    handler: commandWorkouts,
  },
};

function createCollectionCommandRegistration(catalogEntry) {
  const localMetadata = localCollectionCommandMetadata[catalogEntry.name];
  if (!localMetadata) {
    throw new Error(`Missing local collection command metadata for "${catalogEntry.name}".`);
  }

  return {
    name: catalogEntry.name,
    summary: catalogEntry.summary,
    endpoint: catalogEntry.endpoint,
    endpointKey: catalogEntry.endpointKey,
    agentFilters: true,
    usage: collectionUsage(catalogEntry.name),
    options: collectionCommandOptions(),
    ...localMetadata,
  };
}

export const collectionCommandRegistrationList = COLLECTION_COMMAND_CATALOG.map(
  createCollectionCommandRegistration,
);

export const collectionCommandRegistrations = {
  ...Object.fromEntries(
    collectionCommandRegistrationList.map((registration) => [registration.name, registration]),
  ),
  day: {
    name: "day",
    summary: "Fetch one local-day snapshot across cycles, recoveries, sleep, and workouts.",
    usage: [`${CLI_NAME} day [--date YYYY-MM-DD] [--include-records] [--json|--csv]`],
    options: [
      ...AUTH_CLIENT_OPTIONS,
      option("--date <YYYY-MM-DD>", "Local day to summarize (default: today in the active timezone)."),
      option("--include-records", "Include raw collection payloads in the day snapshot."),
      ...STRUCTURED_OUTPUT_OPTIONS,
      TIMEZONE_OPTION,
    ],
    examples: [
      `${CLI_NAME} day --json`,
      `${CLI_NAME} day --date 2026-03-25 --include-records --json`,
      `${CLI_NAME} day --date 2026-03-25 --csv`,
    ],
    handler: commandDay,
  },
};
