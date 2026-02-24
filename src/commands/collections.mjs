function normalizeDateTimeInput(value, label) {
  if (value == null || value === "") return null;
  const normalized = String(value).trim();
  const parsed = new Date(normalized);
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error(`Invalid ${label} "${value}". Expected ISO date-time.`);
  }
  return parsed.toISOString();
}

function toBoolean(value, fallback = false) {
  if (value == null) return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return fallback;
}

function toDurationSeconds(start, end) {
  const left = new Date(start).getTime();
  const right = new Date(end).getTime();
  if (!Number.isFinite(left) || !Number.isFinite(right) || right < left) return null;
  return Math.round((right - left) / 1000);
}

function withCommonRecordShape(record, recordType, deps) {
  const { toDateOnlyInTimeZone, formatDateTimeInTimeZone, timeZone } = deps;
  const localDate = toDateOnlyInTimeZone(record.start ?? record.created_at, timeZone, {
    assumeUtcForOffsetlessDateTime: true,
  });

  return {
    ...record,
    recordType,
    localDate,
    localStart: formatDateTimeInTimeZone(record.start ?? record.created_at, timeZone, {
      assumeUtcForOffsetlessDateTime: true,
    }),
  };
}

function normalizeCycleRecords(records, deps) {
  return (Array.isArray(records) ? records : []).map((record) => {
    const normalized = withCommonRecordShape(record, "cycle", deps);
    return {
      ...normalized,
      strain: Number.isFinite(Number(record?.score?.strain)) ? Number(record.score.strain) : null,
    };
  });
}

function normalizeRecoveryRecords(records, deps) {
  return (Array.isArray(records) ? records : []).map((record) => {
    const normalized = withCommonRecordShape(record, "recovery", deps);
    return {
      ...normalized,
      recovery_score: Number.isFinite(Number(record?.score?.recovery_score))
        ? Number(record.score.recovery_score)
        : null,
    };
  });
}

function normalizeSleepRecords(records, deps) {
  return (Array.isArray(records) ? records : []).map((record) => {
    const normalized = withCommonRecordShape(record, record?.nap ? "nap" : "sleep", deps);
    return {
      ...normalized,
      durationInSeconds: toDurationSeconds(record.start, record.end),
    };
  });
}

function normalizeWorkoutRecords(records, deps) {
  return (Array.isArray(records) ? records : []).map((record) => {
    const normalized = withCommonRecordShape(record, "workout", deps);
    return {
      ...normalized,
      durationInSeconds: toDurationSeconds(record.start, record.end),
      strain: Number.isFinite(Number(record?.score?.strain)) ? Number(record.score.strain) : null,
    };
  });
}

function buildWindow(flags, deps, defaultDays = 30) {
  const {
    requirePositiveInteger,
    normalizeDateOnlyInput,
    isoDateShift,
    toUtcDateTimeForStartOfDay,
    toUtcDateTimeForEndExclusive,
  } = deps;

  const explicitStart = normalizeDateTimeInput(flags.start, "--start");
  const explicitEnd = normalizeDateTimeInput(flags.end, "--end");

  if (explicitStart || explicitEnd) {
    if (!explicitStart || !explicitEnd) {
      throw new Error("--start and --end must be provided together.");
    }
    if (explicitEnd <= explicitStart) {
      throw new Error(`Invalid range: --end (${explicitEnd}) must be after --start (${explicitStart}).`);
    }
    return {
      days: null,
      fromDate: null,
      toDate: null,
      start: explicitStart,
      end: explicitEnd,
      source: "explicit-datetime",
    };
  }

  const days = requirePositiveInteger(flags.days, defaultDays);
  const fromDate = normalizeDateOnlyInput(flags.from, isoDateShift(-days));
  const toDate = normalizeDateOnlyInput(flags.to, isoDateShift(0));
  if (toDate < fromDate) {
    throw new Error(`Invalid range: --to (${toDate}) is before --from (${fromDate}).`);
  }

  return {
    days,
    fromDate,
    toDate,
    start: toUtcDateTimeForStartOfDay(fromDate),
    end: toUtcDateTimeForEndExclusive(toDate),
    source: "local-date-window",
  };
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
    requirePositiveInteger,
    applyAgentRecordFilters,
    toRecordsOnlyPayload,
    isJsonMode,
    writeOutput,
    hasAgentRecordTransforms,
  } = deps;

  const client = await withClient(flags);
  const queryWindow = buildWindow(flags, deps, 30);
  const limitRaw = requirePositiveInteger(flags.limit, 25);
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

  const outputPayload = flags["records-only"] ? toRecordsOnlyPayload(payload) : payload;
  const hasTransforms = hasAgentRecordTransforms(flags);

  if (!isJsonMode(flags)) {
    await writeOutput(outputPayload, flags, (value) =>
      formatCollectionText({ ...value, command }, { hasAgentRecordTransforms, hasTransforms }),
    );
    return;
  }

  await writeOutput(outputPayload, { ...flags, json: !flags.jsonl });
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
    normalizeDateOnlyInput,
    isoDateShift,
    toUtcDateTimeForStartOfDay,
    toUtcDateTimeForEndExclusive,
    isJsonMode,
    writeOutput,
  } = deps;

  const client = await withClient(flags);
  const date = normalizeDateOnlyInput(flags.date, isoDateShift(0));
  const start = toUtcDateTimeForStartOfDay(date);
  const end = toUtcDateTimeForEndExclusive(date);

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
    query: { start, end },
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
