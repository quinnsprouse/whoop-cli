import { normalizeTimeZone, toDateOnlyInTimeZone } from "./timezone.mjs";

function normalizeDateOnlyInput(value, fallback) {
  if (value == null || value === "") return fallback;
  const normalized = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new Error(`Invalid date "${value}". Expected YYYY-MM-DD.`);
  }
  return normalized;
}

function requireNumber(value, fallback) {
  if (value == null) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

function requirePositiveInteger(value, fallback) {
  const parsed = requireNumber(value, fallback);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return parsed;
}

function splitCsv(value) {
  if (value == null || value === true) return [];
  return String(value)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function toLowerOrNull(value) {
  if (value == null) return null;
  return String(value).toLowerCase();
}

function getByPath(object, pathValue) {
  if (!pathValue) return undefined;
  const segments = String(pathValue)
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean);
  let cursor = object;
  for (const segment of segments) {
    if (cursor == null || typeof cursor !== "object") return undefined;
    cursor = cursor[segment];
  }
  return cursor;
}

function projectRecordFields(record, fields) {
  const output = {};
  for (const field of fields) {
    const value = getByPath(record, field);
    output[field] = value === undefined ? null : value;
  }
  return output;
}

function resolveRecordDateOnly(record, timeZone) {
  if (!record || typeof record !== "object") return null;

  if (typeof record.dateOnly === "string") return record.dateOnly;
  if (typeof record.localDate === "string") return record.localDate;

  const candidates = [record.start, record.created_at, record.updated_at, record.end, record.date];
  for (const candidate of candidates) {
    const normalized = toDateOnlyInTimeZone(candidate, timeZone, {
      assumeUtcForOffsetlessDateTime: true,
    });
    if (normalized) return normalized;
  }

  return null;
}

function resolveRecordType(record) {
  if (!record || typeof record !== "object") return null;
  if (record.recordType != null) return record.recordType;
  if (record.type != null) return record.type;
  if (record.sport_name != null) return record.sport_name;
  if (record.score_state != null) return record.score_state;
  if (record.nap === true) return "nap";
  if (record.nap === false) return "sleep";
  return null;
}

function resolveRecordStrain(record) {
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

function resolveRecordRecovery(record) {
  if (!record || typeof record !== "object") return null;
  const candidates = [record.recovery_score, record.score?.recovery_score];
  for (const candidate of candidates) {
    const numeric = Number(candidate);
    if (Number.isFinite(numeric)) return numeric;
  }
  return null;
}

function resolveRecordText(record) {
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

function compareNullableNumbers(a, b) {
  const left = Number.isFinite(a) ? a : null;
  const right = Number.isFinite(b) ? b : null;
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  return left - right;
}

function parseAgentFilterConfig(flags, timeZone) {
  const fromDate = flags.from ? normalizeDateOnlyInput(flags.from, null) : null;
  const toDate = flags.to ? normalizeDateOnlyInput(flags.to, null) : null;
  const minStrain =
    flags["min-strain"] != null && flags["min-strain"] !== true
      ? Number(flags["min-strain"])
      : null;
  const maxStrain =
    flags["max-strain"] != null && flags["max-strain"] !== true
      ? Number(flags["max-strain"])
      : null;
  const minRecovery =
    flags["min-recovery"] != null && flags["min-recovery"] !== true
      ? Number(flags["min-recovery"])
      : null;
  const maxRecovery =
    flags["max-recovery"] != null && flags["max-recovery"] !== true
      ? Number(flags["max-recovery"])
      : null;
  const sort = toLowerOrNull(flags.sort);
  const contains = toLowerOrNull(flags.contains);
  const typeFilters = splitCsv(flags.type).map((value) => value.toLowerCase());
  const fields = splitCsv(flags.fields);
  const resultLimit = requirePositiveInteger(flags["result-limit"], null);

  return {
    timeZone,
    fromDate,
    toDate,
    minStrain: Number.isFinite(minStrain) ? minStrain : null,
    maxStrain: Number.isFinite(maxStrain) ? maxStrain : null,
    minRecovery: Number.isFinite(minRecovery) ? minRecovery : null,
    maxRecovery: Number.isFinite(maxRecovery) ? maxRecovery : null,
    sort,
    contains,
    typeFilters,
    fields,
    resultLimit,
  };
}

export function applyAgentRecordFilters(records, flags, timeZone = null) {
  const resolvedTimeZone = normalizeTimeZone(timeZone);
  const config = parseAgentFilterConfig(flags, resolvedTimeZone);
  const input = Array.isArray(records) ? records : [];
  let output = [...input];

  if (config.fromDate || config.toDate) {
    output = output.filter((record) => {
      const dateOnly = resolveRecordDateOnly(record, resolvedTimeZone);
      if (!dateOnly) return false;
      if (config.fromDate && dateOnly < config.fromDate) return false;
      if (config.toDate && dateOnly > config.toDate) return false;
      return true;
    });
  }

  if (config.typeFilters.length > 0) {
    output = output.filter((record) => {
      const recordTypeRaw = resolveRecordType(record);
      if (recordTypeRaw == null) return false;
      const recordType = String(recordTypeRaw).toLowerCase();
      return config.typeFilters.some((candidate) => candidate === recordType);
    });
  }

  if (config.contains) {
    output = output.filter((record) => resolveRecordText(record).includes(config.contains));
  }

  if (config.minStrain != null || config.maxStrain != null) {
    output = output.filter((record) => {
      const strain = resolveRecordStrain(record);
      if (!Number.isFinite(strain)) return false;
      if (config.minStrain != null && strain < config.minStrain) return false;
      if (config.maxStrain != null && strain > config.maxStrain) return false;
      return true;
    });
  }

  if (config.minRecovery != null || config.maxRecovery != null) {
    output = output.filter((record) => {
      const recovery = resolveRecordRecovery(record);
      if (!Number.isFinite(recovery)) return false;
      if (config.minRecovery != null && recovery < config.minRecovery) return false;
      if (config.maxRecovery != null && recovery > config.maxRecovery) return false;
      return true;
    });
  }

  switch (config.sort) {
    case "date":
      output.sort((a, b) => {
        const left = resolveRecordDateOnly(a, resolvedTimeZone) ?? "";
        const right = resolveRecordDateOnly(b, resolvedTimeZone) ?? "";
        return left.localeCompare(right);
      });
      break;
    case "date-desc":
      output.sort((a, b) => {
        const left = resolveRecordDateOnly(a, resolvedTimeZone) ?? "";
        const right = resolveRecordDateOnly(b, resolvedTimeZone) ?? "";
        return right.localeCompare(left);
      });
      break;
    case "strain":
      output.sort((a, b) => compareNullableNumbers(resolveRecordStrain(a), resolveRecordStrain(b)));
      break;
    case "strain-desc":
      output.sort((a, b) => compareNullableNumbers(resolveRecordStrain(b), resolveRecordStrain(a)));
      break;
    case "recovery":
      output.sort((a, b) =>
        compareNullableNumbers(resolveRecordRecovery(a), resolveRecordRecovery(b)),
      );
      break;
    case "recovery-desc":
      output.sort((a, b) =>
        compareNullableNumbers(resolveRecordRecovery(b), resolveRecordRecovery(a)),
      );
      break;
    case "name":
      output.sort((a, b) => resolveRecordText(a).localeCompare(resolveRecordText(b)));
      break;
    case "name-desc":
      output.sort((a, b) => resolveRecordText(b).localeCompare(resolveRecordText(a)));
      break;
    default:
      break;
  }

  if (config.resultLimit != null) {
    output = output.slice(0, config.resultLimit);
  }

  if (config.fields.length > 0) {
    output = output.map((record) => projectRecordFields(record, config.fields));
  }

  const filterSummary = {
    from: config.fromDate,
    to: config.toDate,
    type: config.typeFilters,
    contains: config.contains,
    minStrain: config.minStrain,
    maxStrain: config.maxStrain,
    minRecovery: config.minRecovery,
    maxRecovery: config.maxRecovery,
    sort: config.sort,
    resultLimit: config.resultLimit,
    fields: config.fields,
    inputCount: input.length,
    outputCount: output.length,
  };

  return { records: output, filterSummary };
}

export function hasAgentRecordTransforms(flags) {
  return Boolean(
    flags.from ||
      flags.to ||
      flags.type ||
      flags.contains ||
      flags["min-strain"] ||
      flags["max-strain"] ||
      flags["min-recovery"] ||
      flags["max-recovery"] ||
      flags.sort ||
      flags["result-limit"] ||
      flags.fields,
  );
}

export function toRecordsOnlyPayload(payload) {
  return {
    mode: payload?.mode ?? null,
    generatedAt: payload?.generatedAt ?? new Date().toISOString(),
    command: payload?.command ?? null,
    query: payload?.query ?? null,
    filters: payload?.filters ?? null,
    member: payload?.member ?? null,
    count: Array.isArray(payload?.records) ? payload.records.length : payload?.count ?? 0,
    records: Array.isArray(payload?.records) ? payload.records : [],
    limitations: payload?.limitations ?? undefined,
  };
}
