import { AGENT_FILTER_OPTIONS } from "./command-options.mjs";
import {
  buildLocalDateFilterWindow,
  filterRecordsToLocalDayQueryWindow,
  getLocalDayRecordFilterBounds,
} from "./local-day-query-window.mjs";
import {
  splitCsv,
} from "./agent-output.mjs";
import {
  resolveRecordDateOnly,
  resolveRecordRecovery,
  resolveRecordStrain,
  resolveRecordText,
  resolveRecordType,
} from "./record-shape.mjs";
import { normalizeTimeZone } from "./timezone.mjs";

const AGENT_FILTER_OPTION_NAMES = AGENT_FILTER_OPTIONS.map((option) => option.name);

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

function toLowerOrNull(value) {
  if (value == null) return null;
  return String(value).toLowerCase();
}

function compareNullableNumbers(a, b) {
  const left = Number.isFinite(a) ? a : null;
  const right = Number.isFinite(b) ? b : null;
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  return left - right;
}

function resolveDateWindow(flags, timeZone, queryWindow) {
  if (
    queryWindow?.source === "local-date-window" ||
    queryWindow?.source === "local-date-filter" ||
    queryWindow?.source === "single-local-day"
  ) {
    return queryWindow;
  }

  return buildLocalDateFilterWindow({ flags, timeZone });
}

function parseAgentFilterConfig(flags, timeZone, { queryWindow = null } = {}) {
  const dateWindow = resolveDateWindow(flags, timeZone, queryWindow);
  const dateFilter = getLocalDayRecordFilterBounds(dateWindow);
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
    dateWindow,
    fromDate: dateFilter.fromDate,
    toDate: dateFilter.toDate,
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

export function applyAgentRecordFilters(records, flags, timeZone = null, options = {}) {
  const resolvedTimeZone = normalizeTimeZone(timeZone);
  const config = parseAgentFilterConfig(flags, resolvedTimeZone, options);
  const input = Array.isArray(records) ? records : [];
  let output = [...input];

  if (config.fromDate || config.toDate) {
    output = filterRecordsToLocalDayQueryWindow(output, config.dateWindow);
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
  return AGENT_FILTER_OPTION_NAMES.some((name) => flags?.[name] != null && flags[name] !== false);
}
