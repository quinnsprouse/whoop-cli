const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME_WITH_OFFSET_PATTERN = /(Z|[+\-]\d{2}:\d{2})$/i;

function isFiniteDate(date) {
  return date instanceof Date && Number.isFinite(date.getTime());
}

function pickPart(parts, type) {
  const found = parts.find((part) => part.type === type);
  return found ? found.value : null;
}

function toDateTimeParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZoneName: "shortOffset",
  });
  return formatter.formatToParts(date);
}

function toDateOnlyParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.formatToParts(date);
}

function parseDateOnlyParts(value) {
  const text = String(value ?? "").trim();
  if (!DATE_ONLY_PATTERN.test(text)) return null;
  const [year, month, day] = text.split("-").map((part) => Number(part));
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }
  return { year, month, day };
}

function getTimeZoneOffsetMs(date, timeZone) {
  const parts = toDateTimeParts(date, timeZone);
  const year = Number(pickPart(parts, "year"));
  const month = Number(pickPart(parts, "month"));
  const day = Number(pickPart(parts, "day"));
  const hour = Number(pickPart(parts, "hour"));
  const minute = Number(pickPart(parts, "minute"));
  const second = Number(pickPart(parts, "second"));
  if (![year, month, day, hour, minute, second].every(Number.isFinite)) return 0;

  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  return localAsUtc - date.getTime();
}

function toUtcDateTimeForLocalDateTime({
  dateOnly,
  timeZone,
  hour = 0,
  minute = 0,
  second = 0,
  millisecond = 0,
}) {
  const parts = parseDateOnlyParts(dateOnly);
  if (!parts) return null;

  const normalizedTimeZone = normalizeTimeZone(timeZone, "UTC");
  const localAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    hour,
    minute,
    second,
    millisecond,
  );

  let candidate = new Date(localAsUtc);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const offsetMs = getTimeZoneOffsetMs(candidate, normalizedTimeZone);
    const next = new Date(localAsUtc - offsetMs);
    if (next.getTime() === candidate.getTime()) break;
    candidate = next;
  }

  return candidate.toISOString();
}

export function normalizeTimeZone(value = null, fallback = null) {
  const fromArg = typeof value === "string" ? value.trim() : "";
  const fromEnv =
    typeof process.env.WHOOP_TIMEZONE === "string" ? process.env.WHOOP_TIMEZONE.trim() : "";
  const fromIntl = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const candidate = fromArg || fromEnv || fallback || fromIntl || "UTC";

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate });
    return candidate;
  } catch {
    throw new Error(`Invalid timezone "${candidate}". Use an IANA timezone like "America/New_York".`);
  }
}

export function parseApiDateTime(value, { assumeUtcForOffsetlessDateTime = true } = {}) {
  if (value == null) return null;

  if (value instanceof Date) {
    return isFiniteDate(value) ? new Date(value.getTime()) : null;
  }

  if (typeof value === "number") {
    const parsed = new Date(value);
    return isFiniteDate(parsed) ? parsed : null;
  }

  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;

  if (DATE_ONLY_PATTERN.test(raw)) {
    const parsedDateOnly = new Date(`${raw}T00:00:00Z`);
    return isFiniteDate(parsedDateOnly) ? parsedDateOnly : null;
  }

  let normalized = raw;
  if (
    assumeUtcForOffsetlessDateTime &&
    /^\d{4}-\d{2}-\d{2}T/.test(raw) &&
    !DATE_TIME_WITH_OFFSET_PATTERN.test(raw)
  ) {
    normalized = `${raw}Z`;
  }

  const parsed = new Date(normalized);
  return isFiniteDate(parsed) ? parsed : null;
}

export function toDateOnlyInTimeZone(
  value,
  timeZone,
  { assumeUtcForOffsetlessDateTime = true } = {},
) {
  if (typeof value === "string" && DATE_ONLY_PATTERN.test(value.trim())) {
    return value.trim();
  }

  const parsed = parseApiDateTime(value, { assumeUtcForOffsetlessDateTime });
  if (!parsed) return null;

  const parts = toDateOnlyParts(parsed, normalizeTimeZone(timeZone));
  const year = pickPart(parts, "year");
  const month = pickPart(parts, "month");
  const day = pickPart(parts, "day");
  if (!year || !month || !day) return null;
  return `${year}-${month}-${day}`;
}

export function formatDateTimeInTimeZone(
  value,
  timeZone,
  { assumeUtcForOffsetlessDateTime = true } = {},
) {
  const parsed = parseApiDateTime(value, { assumeUtcForOffsetlessDateTime });
  if (!parsed) return null;

  const parts = toDateTimeParts(parsed, normalizeTimeZone(timeZone));
  const year = pickPart(parts, "year");
  const month = pickPart(parts, "month");
  const day = pickPart(parts, "day");
  const hour = pickPart(parts, "hour");
  const minute = pickPart(parts, "minute");
  const second = pickPart(parts, "second");
  const timeZoneName = pickPart(parts, "timeZoneName");
  if (!year || !month || !day || !hour || !minute || !second) return null;

  const suffix = timeZoneName ? ` ${timeZoneName}` : "";
  return `${year}-${month}-${day}T${hour}:${minute}:${second}${suffix}`;
}

export function shiftDateOnly(dateOnly, days) {
  const parsed = parseApiDateTime(dateOnly, { assumeUtcForOffsetlessDateTime: false });
  if (!parsed) return null;
  parsed.setUTCDate(parsed.getUTCDate() + Number(days));
  return parsed.toISOString().slice(0, 10);
}

export function dateOnlyNowInTimeZone(timeZone, now = new Date()) {
  return toDateOnlyInTimeZone(now, normalizeTimeZone(timeZone), {
    assumeUtcForOffsetlessDateTime: false,
  });
}

export function isoDateShiftInTimeZone(days, timeZone, now = new Date()) {
  const today = dateOnlyNowInTimeZone(timeZone, now);
  return shiftDateOnly(today, days);
}

export function toUtcDateTimeForStartOfDay(dateOnly, timeZone = "UTC") {
  return toUtcDateTimeForLocalDateTime({ dateOnly, timeZone });
}

export function toUtcDateTimeForEndExclusive(dateOnly, timeZone = "UTC") {
  if (!DATE_ONLY_PATTERN.test(String(dateOnly ?? ""))) return null;
  const next = shiftDateOnly(dateOnly, 1);
  return toUtcDateTimeForStartOfDay(next, timeZone);
}
