function requireId(flagName, value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw new Error(`Missing required --${flagName}.`);
  }
  return normalized;
}

function requireCycleId(value) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 1) {
    throw new Error(`Invalid cycle id "${value}". Expected a positive integer.`);
  }
  return numeric;
}

function requireActivityV1Id(value) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 1) {
    throw new Error(`Invalid activity v1 id "${value}". Expected a positive integer.`);
  }
  return numeric;
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

export async function commandSleepById(flags, deps) {
  const { withClient } = deps;
  const client = await withClient(flags);
  const sleepId = requireId("sleep-id", flags["sleep-id"]);
  const record = attachLocalDateFields(await client.getSleepById(sleepId), deps);
  await writeEndpointPayload("sleep-by-id", record, "sleepId", sleepId, flags, deps);
}

export async function commandCycleById(flags, deps) {
  const { withClient } = deps;
  const client = await withClient(flags);
  const cycleId = requireCycleId(flags["cycle-id"]);
  const record = attachLocalDateFields(await client.getCycleById(cycleId), deps);
  await writeEndpointPayload("cycle-by-id", record, "cycleId", cycleId, flags, deps);
}

export async function commandActivityMap(flags, deps) {
  const { withClient } = deps;
  const client = await withClient(flags);
  const activityV1Id = requireActivityV1Id(flags["activity-v1-id"]);
  const record = await client.getActivityMapping(activityV1Id);
  await writeEndpointPayload("activity-map", record, "activityV1Id", activityV1Id, flags, deps);
}

export async function commandWorkoutById(flags, deps) {
  const { withClient } = deps;
  const client = await withClient(flags);
  const workoutId = requireId("workout-id", flags["workout-id"]);
  const record = attachLocalDateFields(await client.getWorkoutById(workoutId), deps);
  await writeEndpointPayload("workout-by-id", record, "workoutId", workoutId, flags, deps);
}

export async function commandCycleRecovery(flags, deps) {
  const { withClient } = deps;
  const client = await withClient(flags);
  const cycleId = requireCycleId(flags["cycle-id"]);
  const record = attachLocalDateFields(await client.getRecoveryForCycle(cycleId), deps);
  await writeEndpointPayload("cycle-recovery", record, "cycleId", cycleId, flags, deps);
}

export async function commandCycleSleep(flags, deps) {
  const { withClient } = deps;
  const client = await withClient(flags);
  const cycleId = requireCycleId(flags["cycle-id"]);
  const record = attachLocalDateFields(await client.getSleepForCycle(cycleId), deps);
  await writeEndpointPayload("cycle-sleep", record, "cycleId", cycleId, flags, deps);
}
