import {
  dateOnlyNowInTimeZone,
  normalizeTimeZone,
  shiftDateOnly,
  toUtcDateTimeForEndExclusive,
  toUtcDateTimeForStartOfDay,
} from "./timezone.mjs";

const DATE_TIME_WITH_OFFSET_PATTERN = /(Z|[+\-]\d{2}:\d{2})$/i;

function normalizeDateOnlyInput(value, fallback, label = "date") {
  if (value == null || value === "") return fallback;
  const normalized = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new Error(`Invalid ${label} "${value}". Expected YYYY-MM-DD.`);
  }
  return normalized;
}

function normalizeDateTimeInput(value, label) {
  if (value == null || value === "") return null;
  const normalized = String(value).trim();
  if (!DATE_TIME_WITH_OFFSET_PATTERN.test(normalized)) {
    throw new Error(`Invalid ${label} "${value}". Expected ISO date-time with timezone offset.`);
  }
  const parsed = new Date(normalized);
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error(`Invalid ${label} "${value}". Expected ISO date-time with timezone offset.`);
  }
  return parsed.toISOString();
}

function requirePositiveInteger(value, fallback, flagName) {
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Invalid --${flagName} value "${value}". Expected a positive integer.`);
  }
  return parsed;
}

function resolveToday(timeZone, now) {
  return dateOnlyNowInTimeZone(timeZone, now);
}

export function buildLocalDayQueryWindow({
  flags = {},
  timeZone = null,
  defaultDays = 30,
  now = new Date(),
} = {}) {
  const normalizedTimeZone = normalizeTimeZone(timeZone);
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
      timeZone: normalizedTimeZone,
    };
  }

  const days = requirePositiveInteger(flags.days, defaultDays, "days");
  const today = resolveToday(normalizedTimeZone, now);
  const fromDate = normalizeDateOnlyInput(flags.from, shiftDateOnly(today, -days), "--from");
  const toDate = normalizeDateOnlyInput(flags.to, today, "--to");
  if (toDate < fromDate) {
    throw new Error(`Invalid range: --to (${toDate}) is before --from (${fromDate}).`);
  }

  return {
    days,
    fromDate,
    toDate,
    start: toUtcDateTimeForStartOfDay(fromDate, normalizedTimeZone),
    end: toUtcDateTimeForEndExclusive(toDate, normalizedTimeZone),
    source: "local-date-window",
    timeZone: normalizedTimeZone,
  };
}

export function buildSingleLocalDayQueryWindow({
  date = null,
  timeZone = null,
  now = new Date(),
} = {}) {
  const normalizedTimeZone = normalizeTimeZone(timeZone);
  const today = resolveToday(normalizedTimeZone, now);
  const dateOnly = normalizeDateOnlyInput(date, today, "--date");

  return {
    date: dateOnly,
    start: toUtcDateTimeForStartOfDay(dateOnly, normalizedTimeZone),
    end: toUtcDateTimeForEndExclusive(dateOnly, normalizedTimeZone),
    source: "single-local-day",
    timeZone: normalizedTimeZone,
  };
}
