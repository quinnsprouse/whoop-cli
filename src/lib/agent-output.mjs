import fs from "node:fs/promises";

export function splitCsv(value) {
  if (value == null || value === true) return [];
  return String(value)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function getByPath(object, pathValue) {
  if (object && typeof object === "object" && Object.hasOwn(object, pathValue)) {
    return object[pathValue];
  }

  const segments = String(pathValue ?? "")
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean);
  if (segments.length === 0) return undefined;

  let cursor = object;
  for (const segment of segments) {
    if (cursor == null || typeof cursor !== "object") return undefined;
    cursor = cursor[segment];
  }
  return cursor;
}

export function projectRecordFields(record, fields) {
  const output = {};
  for (const field of fields) {
    const value = getByPath(record, field);
    output[field] = value === undefined ? null : value;
  }
  return output;
}

export function isJsonMode(flags) {
  return Boolean(flags?.json || flags?.jsonl || flags?.csv);
}

export function recordsFromPayload(payload) {
  if (Array.isArray(payload?.records)) return payload.records;
  if (Array.isArray(payload)) return payload;
  if (payload?.record && typeof payload.record === "object") return [payload.record];
  if (payload && typeof payload === "object") return [payload];
  return [];
}

function recordsFromJsonlPayload(payload) {
  if (Array.isArray(payload?.records)) return payload.records;
  if (Array.isArray(payload)) return payload;
  return [];
}

export function withTimeZoneMeta(payload, timeZone) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  if (payload.timeZone != null || !timeZone) return payload;
  return { ...payload, timeZone };
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

function formatCsvCell(value) {
  if (value == null) return "";
  if (typeof value === "string") {
    if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, "\"\"")}"`;
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  const json = JSON.stringify(value);
  if (json == null) return "";
  if (/[",\n\r]/.test(json)) return `"${json.replace(/"/g, "\"\"")}"`;
  return json;
}

export function renderCsv(payload, flags = {}) {
  const records = recordsFromPayload(payload);
  const fields = splitCsv(flags.fields);
  const headers =
    fields.length > 0
      ? fields
      : Array.from(
        records.reduce((set, item) => {
          if (item && typeof item === "object" && !Array.isArray(item)) {
            for (const key of Object.keys(item)) set.add(key);
          }
          return set;
        }, new Set()),
      );

  if (headers.length === 0) return "";

  const rows = [headers.map((header) => formatCsvCell(header)).join(",")];
  for (const record of records) {
    rows.push(
      headers
        .map((header) => {
          const value =
            record && typeof record === "object"
              ? fields.length > 0
                ? getByPath(record, header)
                : record[header]
              : undefined;
          return formatCsvCell(value);
        })
        .join(","),
    );
  }
  return rows.join("\n");
}

export function renderJsonl(payload) {
  return recordsFromJsonlPayload(payload).map((item) => JSON.stringify(item)).join("\n");
}

export function renderJson(payload) {
  return typeof payload === "string" ? payload : `${JSON.stringify(payload, null, 2)}\n`;
}

export function renderOutput(payload, flags = {}, textRenderer = null, timeZone = null) {
  const payloadWithTimeZone = withTimeZoneMeta(payload, timeZone);

  if (flags.csv) {
    return {
      format: "csv",
      content: renderCsv(payloadWithTimeZone, flags),
      fileMessage: "Wrote CSV to",
      emitWhenEmpty: false,
      appendFileNewline: true,
    };
  }

  if (flags.jsonl) {
    return {
      format: "jsonl",
      content: renderJsonl(payloadWithTimeZone),
      fileMessage: "Wrote JSONL to",
      emitWhenEmpty: false,
      appendFileNewline: true,
    };
  }

  if (flags.json || typeof payloadWithTimeZone !== "string") {
    return {
      format: "json",
      content: renderJson(payloadWithTimeZone),
      fileMessage: "Wrote JSON to",
      emitWhenEmpty: true,
      rawStdout: true,
      appendFileNewline: false,
    };
  }

  return {
    format: "text",
    content: textRenderer ? textRenderer(payloadWithTimeZone) : String(payloadWithTimeZone),
    fileMessage: "Wrote text to",
    emitWhenEmpty: true,
    appendFileNewline: true,
  };
}

function resolveTimeZone(timeZone) {
  return typeof timeZone === "function" ? timeZone() : timeZone;
}

export function createAgentOutput({
  timeZone = null,
  writeFile = fs.writeFile,
  stdout = process.stdout,
  log = console.log,
} = {}) {
  async function writeOutput(payload, flags = {}, textRenderer = null) {
    const rendered = renderOutput(payload, flags, textRenderer, resolveTimeZone(timeZone));

    if (flags.output) {
      const fileContent =
        rendered.appendFileNewline && rendered.content
          ? `${rendered.content}\n`
          : rendered.content;
      await writeFile(flags.output, fileContent, "utf8");
      log(`${rendered.fileMessage} ${flags.output}`);
      return;
    }

    if (!rendered.content && !rendered.emitWhenEmpty) return;

    if (rendered.rawStdout) {
      stdout.write(rendered.content);
      return;
    }

    log(rendered.content);
  }

  return {
    isJsonMode,
    writeOutput,
  };
}
