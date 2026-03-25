import {
  formatInvalidFlagValueMessage,
  resolveRequiredFlagValue,
} from "../lib/command-input.mjs";

function requireCycleId(command, value) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 1) {
    throw new Error(formatInvalidFlagValueMessage(command, "cycle-id", value, "a positive integer"));
  }
  return numeric;
}

function requireActivityV1Id(value) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 1) {
    throw new Error(
      formatInvalidFlagValueMessage("activity-map", "activity-v1-id", value, "a positive integer"),
    );
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
  const { withClient, readStdinText } = deps;
  const sleepId = await resolveRequiredFlagValue({
    command: "sleep-by-id",
    flagName: "sleep-id",
    flags,
    readStdinText,
  });
  const client = await withClient(flags);
  const record = attachLocalDateFields(await client.getSleepById(sleepId), deps);
  await writeEndpointPayload("sleep-by-id", record, "sleepId", sleepId, flags, deps);
}

export async function commandCycleById(flags, deps) {
  const { withClient, readStdinText } = deps;
  const cycleId = requireCycleId(
    "cycle-by-id",
    await resolveRequiredFlagValue({
      command: "cycle-by-id",
      flagName: "cycle-id",
      flags,
      readStdinText,
    }),
  );
  const client = await withClient(flags);
  const record = attachLocalDateFields(await client.getCycleById(cycleId), deps);
  await writeEndpointPayload("cycle-by-id", record, "cycleId", cycleId, flags, deps);
}

export async function commandActivityMap(flags, deps) {
  const { withClient, readStdinText } = deps;
  const activityV1Id = requireActivityV1Id(
    await resolveRequiredFlagValue({
      command: "activity-map",
      flagName: "activity-v1-id",
      flags,
      readStdinText,
    }),
  );
  const client = await withClient(flags);
  const record = await client.getActivityMapping(activityV1Id);
  await writeEndpointPayload("activity-map", record, "activityV1Id", activityV1Id, flags, deps);
}

export async function commandWorkoutById(flags, deps) {
  const { withClient, readStdinText } = deps;
  const workoutId = await resolveRequiredFlagValue({
    command: "workout-by-id",
    flagName: "workout-id",
    flags,
    readStdinText,
  });
  const client = await withClient(flags);
  const record = attachLocalDateFields(await client.getWorkoutById(workoutId), deps);
  await writeEndpointPayload("workout-by-id", record, "workoutId", workoutId, flags, deps);
}

export async function commandCycleRecovery(flags, deps) {
  const { withClient, readStdinText } = deps;
  const cycleId = requireCycleId(
    "cycle-recovery",
    await resolveRequiredFlagValue({
      command: "cycle-recovery",
      flagName: "cycle-id",
      flags,
      readStdinText,
    }),
  );
  const client = await withClient(flags);
  const record = attachLocalDateFields(await client.getRecoveryForCycle(cycleId), deps);
  await writeEndpointPayload("cycle-recovery", record, "cycleId", cycleId, flags, deps);
}

export async function commandCycleSleep(flags, deps) {
  const { withClient, readStdinText } = deps;
  const cycleId = requireCycleId(
    "cycle-sleep",
    await resolveRequiredFlagValue({
      command: "cycle-sleep",
      flagName: "cycle-id",
      flags,
      readStdinText,
    }),
  );
  const client = await withClient(flags);
  const record = attachLocalDateFields(await client.getSleepForCycle(cycleId), deps);
  await writeEndpointPayload("cycle-sleep", record, "cycleId", cycleId, flags, deps);
}
