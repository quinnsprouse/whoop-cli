import {
  formatDateTimeInTimeZone,
  normalizeTimeZone,
  toDateOnlyInTimeZone,
} from "./timezone.mjs";

const ASSUME_UTC = { assumeUtcForOffsetlessDateTime: true };

function firstRecordValue(record, fields) {
  for (const field of fields) {
    if (record?.[field] != null) return record[field];
  }
  return null;
}

export function toDurationSeconds(start, end) {
  if (start == null || end == null) return null;
  const left = new Date(start).getTime();
  const right = new Date(end).getTime();
  if (!Number.isFinite(left) || !Number.isFinite(right) || right < left) return null;
  return Math.round((right - left) / 1000);
}

export function addLocalDateFields(record, timeZone = null, {
  dateFields = ["start", "created_at", "updated_at", "end", "date"],
  localStartFields = ["start", "created_at"],
  includeLocalEnd = true,
} = {}) {
  if (!record || typeof record !== "object") return record;
  const resolvedTimeZone = normalizeTimeZone(timeZone);
  const baseDate = firstRecordValue(record, dateFields);
  const localStart = firstRecordValue(record, localStartFields);
  const shaped = {
    ...record,
    localDate: toDateOnlyInTimeZone(baseDate, resolvedTimeZone, ASSUME_UTC),
    localStart: localStart
      ? formatDateTimeInTimeZone(localStart, resolvedTimeZone, ASSUME_UTC)
      : null,
  };

  if (includeLocalEnd) {
    shaped.localEnd = record.end
      ? formatDateTimeInTimeZone(record.end, resolvedTimeZone, ASSUME_UTC)
      : null;
  }

  return shaped;
}

export function shapeCycleRecord(record, timeZone = null) {
  const normalized = addLocalDateFields(record, timeZone);
  return {
    ...normalized,
    recordType: "cycle",
    strain: resolveRecordStrain(record),
  };
}

export function shapeRecoveryRecord(record, timeZone = null) {
  const normalized = addLocalDateFields(record, timeZone);
  return {
    ...normalized,
    recordType: "recovery",
    recovery_score: resolveRecordRecovery(record),
  };
}

export function shapeSleepRecord(record, timeZone = null) {
  const normalized = addLocalDateFields(record, timeZone);
  return {
    ...normalized,
    recordType: record?.nap ? "nap" : "sleep",
    durationInSeconds: toDurationSeconds(record?.start, record?.end),
  };
}

export function shapeWorkoutRecord(record, timeZone = null) {
  const normalized = addLocalDateFields(record, timeZone);
  return {
    ...normalized,
    recordType: "workout",
    durationInSeconds: toDurationSeconds(record?.start, record?.end),
    strain: resolveRecordStrain(record),
  };
}

export function shapeRecords(records, shaper, timeZone = null) {
  return (Array.isArray(records) ? records : []).map((record) => shaper(record, timeZone));
}

export function shapeEndpointRecord(record, timeZone = null) {
  return addLocalDateFields(record, timeZone, {
    dateFields: ["start", "created_at", "updated_at"],
    localStartFields: ["start"],
    includeLocalEnd: true,
  });
}

export function resolveRecordDateOnly(record, timeZone = null) {
  if (!record || typeof record !== "object") return null;
  if (typeof record.dateOnly === "string") return record.dateOnly;
  if (typeof record.localDate === "string") return record.localDate;

  const resolvedTimeZone = normalizeTimeZone(timeZone);
  const candidates = [record.start, record.created_at, record.updated_at, record.end, record.date];
  for (const candidate of candidates) {
    const normalized = toDateOnlyInTimeZone(candidate, resolvedTimeZone, ASSUME_UTC);
    if (normalized) return normalized;
  }

  return null;
}

export function resolveRecordType(record) {
  if (!record || typeof record !== "object") return null;
  if (record.recordType != null) return record.recordType;
  if (record.type != null) return record.type;
  if (record.sport_name != null) return record.sport_name;
  if (record.score_state != null) return record.score_state;
  if (record.nap === true) return "nap";
  if (record.nap === false) return "sleep";
  return null;
}

export function resolveRecordStrain(record) {
  if (!record || typeof record !== "object") return null;
  const candidates = [
    record.strain,
    record.score?.strain,
    record.cycle_score?.strain,
    record.workout_score?.strain,
  ];
  for (const candidate of candidates) {
    const numeric = Number(candidate);
    if (Number.isFinite(numeric)) return numeric;
  }
  return null;
}

export function resolveRecordRecovery(record) {
  if (!record || typeof record !== "object") return null;
  const candidates = [record.recovery_score, record.score?.recovery_score];
  for (const candidate of candidates) {
    const numeric = Number(candidate);
    if (Number.isFinite(numeric)) return numeric;
  }
  return null;
}

export function resolveRecordText(record) {
  if (!record || typeof record !== "object") return "";
  const textParts = [
    record.id,
    record.user_id,
    record.cycle_id,
    record.sleep_id,
    record.sport_name,
    record.score_state,
    record.recordType,
    record.type,
    record.nap === true ? "nap" : record.nap === false ? "sleep" : null,
  ]
    .filter((value) => value != null)
    .map((value) => String(value));
  return textParts.join(" ").toLowerCase();
}
