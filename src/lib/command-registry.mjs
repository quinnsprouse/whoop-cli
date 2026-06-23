import { parseCommandInputArgv } from "./command-input.mjs";

const DEFAULT_OUTPUT_MODES = ["text", "json", "jsonl", "csv"];
const DATE_TIME_WITH_OFFSET_PATTERN = /(Z|[+\-]\d{2}:\d{2})$/i;
const GLOBAL_OPTIONS = [
  {
    flag: "--help",
    name: "help",
    valueLabel: null,
    type: "boolean",
    takesValue: false,
    description: "Show command help.",
  },
  {
    flag: "--tz <IANA timezone>",
    name: "tz",
    valueLabel: "IANA timezone",
    type: "timezone",
    takesValue: true,
    description: "Override local-day bucketing.",
  },
];

function trimFlagPrefix(value) {
  return String(value ?? "").replace(/^--/, "").trim();
}

function splitDisplayFlag(flag) {
  const raw = String(flag ?? "").trim();
  const [namePart = "", valuePart = ""] = raw.split(/\s+/, 2);
  const valueMatch = raw.match(/<([^>]+)>/);
  return {
    displayFlag: raw,
    name: trimFlagPrefix(namePart),
    valueLabel: valueMatch ? valueMatch[1] : valuePart || null,
  };
}

function inferOptionType(valueLabel) {
  if (!valueLabel) return "boolean";
  const normalized = String(valueLabel).toLowerCase();
  if (normalized.includes("csv")) return "csv";
  if (normalized.includes("json")) return "json";
  if (normalized.includes("yyyy-mm-dd")) return "date";
  if (normalized.includes("iso")) return "datetime";
  if (normalized.includes("iana")) return "timezone";
  if (normalized.includes("path")) return "path";
  if (normalized === "n" || normalized === "int" || normalized.includes("seconds")) return "integer";
  if (normalized.includes("true|false")) return "boolean-string";
  return "string";
}

export function defineOption(flag, description, schema = {}) {
  const parsed = splitDisplayFlag(flag);
  if (!parsed.name) {
    throw new Error(`Invalid option flag "${flag}".`);
  }

  const valueLabel = schema.valueLabel ?? parsed.valueLabel;
  const type = schema.type ?? inferOptionType(valueLabel);

  return {
    flag: parsed.displayFlag,
    name: schema.name ?? parsed.name,
    valueLabel,
    type,
    takesValue: schema.takesValue ?? type !== "boolean",
    description,
    ...schema,
  };
}

function normalizeOption(option) {
  if (typeof option === "string") {
    return defineOption(option.startsWith("--") ? option : `--${option}`, "");
  }

  if (!option || typeof option !== "object") {
    throw new Error("Invalid option schema entry.");
  }

  const parsed = splitDisplayFlag(option.flag ?? option.name);
  const name = option.name ?? parsed.name;
  if (!name) {
    throw new Error(`Invalid option schema entry: ${JSON.stringify(option)}`);
  }

  const valueLabel = option.valueLabel ?? parsed.valueLabel;
  const type = option.type ?? inferOptionType(valueLabel);

  return {
    ...option,
    flag: option.flag ?? `--${name}`,
    name,
    valueLabel,
    type,
    takesValue: option.takesValue ?? type !== "boolean",
    description: option.description ?? "",
  };
}

function normalizeOptions(options) {
  return (Array.isArray(options) ? options : []).map((entry) => normalizeOption(entry));
}

function normalizeCommands(commands) {
  const entries = Array.isArray(commands) ? commands.map((def) => [def.name, def]) : Object.entries(commands ?? {});
  const seen = new Set();
  return entries.map(([name, def]) => {
    if (!name || seen.has(name)) {
      throw new Error(`Duplicate or missing command registration for "${name}".`);
    }
    seen.add(name);
    return {
      ...def,
      name,
      options: normalizeOptions(def.options),
      agentFilters: Boolean(def.agentFilters),
    };
  });
}

function levenshteinDistance(left, right) {
  const a = left.toLowerCase();
  const b = right.toLowerCase();
  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix = Array.from({ length: rows }, () => new Array(cols).fill(0));

  for (let i = 0; i < rows; i += 1) matrix[i][0] = i;
  for (let j = 0; j < cols; j += 1) matrix[0][j] = j;

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }

  return matrix[a.length][b.length];
}

function formatList(values, prefix = "") {
  return values.map((value) => `${prefix}${value}`).join(", ");
}

function formatExpectation(option) {
  if (option.expectation) return option.expectation;
  switch (option.type) {
    case "boolean":
      return "no value, true, or false";
    case "boolean-string":
      return "true or false";
    case "csv":
      return "a comma-separated list";
    case "date":
      return "YYYY-MM-DD";
    case "datetime":
      return "an ISO date-time with timezone offset";
    case "enum":
      return option.values?.length > 0 ? option.values.join("|") : "a supported value";
    case "integer":
      return option.min === 1 ? "a positive integer" : "an integer";
    case "number":
      return "a number";
    case "path":
      return "a file path";
    case "timezone":
      return "an IANA timezone";
    default:
      return option.valueLabel ? `<${option.valueLabel}>` : "a value";
  }
}

function parseBooleanValue(value) {
  if (typeof value === "boolean") return value;
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return null;
}

function formatInvalidFlagValue(commandName, option, value, detail = null) {
  const quotedValue = value === true ? "" : ` value "${value}"`;
  const expectation = detail ?? formatExpectation(option);
  return `Invalid --${option.name}${quotedValue} for "${commandName}". Expected ${expectation}.`;
}

function normalizeOptionValue(commandName, option, value) {
  if (option.type === "boolean" || option.type === "boolean-string") {
    if (value === true) return true;
    const parsed = parseBooleanValue(value);
    if (parsed != null) return parsed;
    throw new Error(formatInvalidFlagValue(commandName, option, value));
  }

  if (!option.takesValue) {
    if (value === true) return true;
    throw new Error(formatInvalidFlagValue(commandName, option, value));
  }

  if (value == null || value === true || String(value).trim() === "") {
    throw new Error(`Missing value for --${option.name} in "${commandName}". Expected ${formatExpectation(option)}.`);
  }

  const text = String(value).trim();
  switch (option.type) {
    case "csv":
    case "path":
    case "string":
    case "timezone":
      return text;
    case "date":
      if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
        throw new Error(formatInvalidFlagValue(commandName, option, value));
      }
      return text;
    case "datetime": {
      if (!DATE_TIME_WITH_OFFSET_PATTERN.test(text)) {
        throw new Error(formatInvalidFlagValue(commandName, option, value));
      }
      const parsed = new Date(text);
      if (!Number.isFinite(parsed.getTime())) {
        throw new Error(formatInvalidFlagValue(commandName, option, value));
      }
      return parsed.toISOString();
    }
    case "enum": {
      const values = Array.isArray(option.values) ? option.values : [];
      const normalizedText = option.caseSensitive ? text : text.toLowerCase();
      const index = values.findIndex((candidate) =>
        (option.caseSensitive ? String(candidate) : String(candidate).toLowerCase()) === normalizedText,
      );
      if (index === -1) {
        throw new Error(formatInvalidFlagValue(commandName, option, value));
      }
      return values[index];
    }
    case "integer": {
      const parsed = Number(text);
      if (!Number.isInteger(parsed)) {
        throw new Error(formatInvalidFlagValue(commandName, option, value));
      }
      if (option.min != null && parsed < option.min) {
        throw new Error(formatInvalidFlagValue(commandName, option, value));
      }
      if (option.max != null && parsed > option.max) {
        throw new Error(formatInvalidFlagValue(commandName, option, value));
      }
      return parsed;
    }
    case "number": {
      const parsed = Number(text);
      if (!Number.isFinite(parsed)) {
        throw new Error(formatInvalidFlagValue(commandName, option, value));
      }
      if (option.min != null && parsed < option.min) {
        throw new Error(formatInvalidFlagValue(commandName, option, value));
      }
      if (option.max != null && parsed > option.max) {
        throw new Error(formatInvalidFlagValue(commandName, option, value));
      }
      return parsed;
    }
    default:
      return text;
  }
}

export function createCommandRegistry({
  commands,
  cliName,
  projectNotice,
  globalNotes = [],
  agentFilterOptions = [],
  agentOutputOptions = [],
  agentPatterns = [],
  outputModes = DEFAULT_OUTPUT_MODES,
} = {}) {
  const commandList = normalizeCommands(commands);
  const commandMap = new Map(commandList.map((command) => [command.name, command]));
  const normalizedAgentFilterOptions = normalizeOptions(agentFilterOptions);
  const normalizedAgentOutputOptions = normalizeOptions(agentOutputOptions);

  function names() {
    return commandList.map((command) => command.name);
  }

  function get(name) {
    return commandMap.get(name) ?? null;
  }

  function has(name) {
    return commandMap.has(name);
  }

  function supportsAgentFilters(name) {
    return Boolean(get(name)?.agentFilters);
  }

  function optionsFor(name) {
    const command = get(name);
    if (!command) return [];

    const options = [...GLOBAL_OPTIONS, ...command.options];
    if (command.agentFilters) {
      options.push(...normalizedAgentFilterOptions, ...normalizedAgentOutputOptions);
    }
    return options;
  }

  function optionMapFor(name) {
    const optionMap = new Map();
    for (const option of optionsFor(name)) optionMap.set(option.name, option);
    return optionMap;
  }

  function optionFor(name, flagName) {
    return optionMapFor(name).get(flagName) ?? null;
  }

  function allowedFlagsFor(name) {
    const flags = new Set();
    for (const option of optionsFor(name)) flags.add(option.name);
    return flags;
  }

  function validateFlags(name, flags) {
    const allowlist = allowedFlagsFor(name);
    if (allowlist.size === 0) return { unknownFlags: [], allowlist: [] };
    const unknownFlags = Object.keys(flags ?? {}).filter((flag) => !allowlist.has(flag));
    return { unknownFlags, allowlist: Array.from(allowlist) };
  }

  function createUnknownFlagError(name, unknownFlags, allowlist) {
    const error = new Error(formatUnknownFlag(name, unknownFlags, allowlist));
    error.code = "WHOOP_CLI_UNKNOWN_FLAGS";
    error.command = name;
    error.unknownFlags = unknownFlags;
    error.allowlist = allowlist;
    return error;
  }

  function normalizeFlagValue(name, flagName, value) {
    const option = optionMapFor(name).get(flagName);
    if (!option) {
      throw new Error(`Unknown flag --${flagName} for "${name}".`);
    }
    return normalizeOptionValue(name, option, value);
  }

  function normalizeFlags(name, flags = {}) {
    const optionMap = optionMapFor(name);
    const normalized = {};

    for (const [flagName, value] of Object.entries(flags ?? {})) {
      const option = optionMap.get(flagName);
      if (!option) {
        normalized[flagName] = value;
        continue;
      }
      normalized[flagName] = normalizeOptionValue(name, option, value);
    }
    return normalized;
  }

  function acceptFlags(name, flags = {}) {
    const { unknownFlags, allowlist } = validateFlags(name, flags);
    if (unknownFlags.length > 0) {
      throw createUnknownFlagError(name, unknownFlags, allowlist);
    }
    return normalizeFlags(name, flags);
  }

  function parseArgv(argv = []) {
    return parseCommandInputArgv(argv, { optionFor });
  }

  function getCommandSuggestions(input, max = 3) {
    const value = String(input ?? "").trim().toLowerCase();
    if (!value) return [];
    const commandNames = names();

    const prefixMatches = commandNames.filter((name) => name.toLowerCase().startsWith(value));
    if (prefixMatches.length > 0) return prefixMatches.slice(0, max);

    const ranked = commandNames
      .map((name) => ({ name, distance: levenshteinDistance(value, name) }))
      .sort((a, b) => a.distance - b.distance || a.name.localeCompare(b.name));

    const threshold = Math.max(2, Math.floor(value.length / 3));
    return ranked
      .filter((item) => item.distance <= threshold)
      .slice(0, max)
      .map((item) => item.name);
  }

  function getFlagSuggestions(input, allowedFlags, max = 3) {
    const value = String(input ?? "").trim().replace(/^--/, "").toLowerCase();
    const candidates = Array.isArray(allowedFlags) ? allowedFlags : Array.from(allowedFlags ?? []);
    if (!value || candidates.length === 0) return [];

    const prefixMatches = candidates.filter((name) => name.startsWith(value));
    if (prefixMatches.length > 0) return prefixMatches.slice(0, max);

    const ranked = candidates
      .map((name) => ({ name, distance: levenshteinDistance(value, name) }))
      .sort((a, b) => a.distance - b.distance || a.name.localeCompare(b.name));

    const threshold = Math.max(2, Math.floor(value.length / 3));
    return ranked
      .filter((item) => item.distance <= threshold)
      .slice(0, max)
      .map((item) => item.name);
  }

  function formatUnknownCommand(input) {
    const suggestions = getCommandSuggestions(input);
    const lines = [`unknown command "${input}" for "${cliName}"`];
    if (suggestions.length === 1) {
      lines.push("", "Did you mean this?", `  ${suggestions[0]}`);
    } else if (suggestions.length > 1) {
      lines.push("", "Did you mean one of these?");
      for (const suggestion of suggestions) lines.push(`  ${suggestion}`);
    }
    lines.push("", `Run "${cliName} help" for available commands.`);
    return lines.join("\n");
  }

  function formatUnknownFlag(commandName, unknownFlags, allowedFlags) {
    const flags = Array.isArray(unknownFlags) ? unknownFlags : [unknownFlags];
    const allowedList = Array.isArray(allowedFlags) ? allowedFlags : Array.from(allowedFlags ?? []);
    const normalizedAllowed = Array.from(new Set(allowedList.map((flag) => String(flag)))).sort();
    const lines = [
      `unknown flag${flags.length > 1 ? "s" : ""} for "${cliName} ${commandName}": ${flags.map((flag) => `--${flag}`).join(", ")}`,
    ];

    for (const flag of flags) {
      const suggestions = getFlagSuggestions(flag, normalizedAllowed);
      if (suggestions.length === 1) {
        lines.push("", `Did you mean --${suggestions[0]} for --${flag}?`);
      } else if (suggestions.length > 1) {
        lines.push("", `Suggestions for --${flag}:`);
        for (const suggestion of suggestions) lines.push(`  --${suggestion}`);
      }
    }

    if (normalizedAllowed.length > 0) {
      lines.push("", `Allowed flags: ${formatList(normalizedAllowed, "--")}`);
    } else {
      lines.push("", "Allowed flags: none");
    }

    const helpCommand = commandName === "help" ? `${cliName} help` : `${cliName} help ${commandName}`;
    lines.push("", `Run "${helpCommand}" for usage.`);
    return lines.join("\n");
  }

  function buildCommandHelpPayload(name) {
    const command = get(name);
    if (!command) return null;
    return {
      command: name,
      summary: command.summary,
      usage: command.usage,
      options: command.options ?? [],
      examples: command.examples ?? [],
      stdin: command.stdin ?? null,
      timezoneOption: "--tz <IANA timezone> (defaults to WHOOP_TIMEZONE or system timezone)",
      supportsAgentFilters: supportsAgentFilters(name),
      agentFilterOptions: supportsAgentFilters(name) ? normalizedAgentFilterOptions : [],
      agentOutputOptions: supportsAgentFilters(name) ? normalizedAgentOutputOptions : [],
      outputModes,
    };
  }

  function formatCommandHelp(name, flags = {}) {
    const command = get(name);
    if (!command) return { ok: false, text: formatUnknownCommand(name) };

    if (flags.json) {
      return {
        ok: true,
        text: JSON.stringify(buildCommandHelpPayload(name), null, 2),
      };
    }

    const lines = [
      `${cliName} ${name} (unofficial)`,
      "",
      command.summary,
      projectNotice,
      "",
      "Usage:",
      ...command.usage.map((line) => `  ${line}`),
      "",
    ];

    if (Array.isArray(command.options) && command.options.length > 0) {
      lines.push("Options:");
      for (const option of command.options) {
        lines.push(`  ${option.flag.padEnd(24)} ${option.description}`);
      }
      lines.push("");
    }

    if (supportsAgentFilters(name)) {
      lines.push("Agent filters:");
      for (const option of normalizedAgentFilterOptions) {
        lines.push(`  ${option.flag.padEnd(18)} ${option.description}`);
      }
      lines.push("Agent output options:");
      for (const option of normalizedAgentOutputOptions) {
        lines.push(`  ${option.flag.padEnd(18)} ${option.description}`);
      }
      lines.push("");
    }

    if (command.stdin?.description) {
      lines.push("Stdin:", `  ${command.stdin.description}`, "");
    }

    if (Array.isArray(command.examples) && command.examples.length > 0) {
      lines.push("Examples:");
      for (const example of command.examples) lines.push(`  ${example}`);
    }

    return { ok: true, text: lines.join("\n") };
  }

  function formatGlobalHelp() {
    const lines = [
      `${cliName} (unofficial)`,
      "",
      "Usage:",
      `  ${cliName} <command> [flags]`,
      `  ${cliName} help <command>`,
      "",
      "Commands:",
    ];
    for (const command of commandList) {
      lines.push(`  ${command.name.padEnd(13)} ${command.summary}`);
    }
    lines.push(
      "",
      "Notes:",
      `  - ${projectNotice}`,
      ...globalNotes.map((note) => `  - ${note}`),
      "",
      "Next steps:",
      `  ${cliName} help workouts`,
      `  ${cliName} discover --level 2`,
      `  ${cliName} workouts --days 14 --json`,
      "",
      "Examples:",
      `  ${cliName} login-local --open`,
      `  ${cliName} exchange-code --code <authorization_code> --json`,
      `  ${cliName} whoami --json`,
      `  ${cliName} workouts --days 30 --min-strain 10 --sort strain-desc --json`,
    );
    return lines.join("\n");
  }

  function buildDiscoveryPayload(level = 1, commandFilter = null) {
    const commandEntries = commandList
      .filter((command) => !commandFilter || command.name === commandFilter)
      .map((command) => ({
        name: command.name,
        summary: command.summary,
        usage: level >= 2 ? command.usage : undefined,
        supportsAgentFilters: supportsAgentFilters(command.name),
        agentFilters:
          level >= 3 && supportsAgentFilters(command.name) ? normalizedAgentFilterOptions : undefined,
        agentOutputOptions:
          level >= 3 && supportsAgentFilters(command.name) ? normalizedAgentOutputOptions : undefined,
      }));

    const payload = {
      generatedAt: new Date().toISOString(),
      progressiveDisclosureLevel: level,
      discoveryFlow: {
        level1: "Choose auth command and required scopes.",
        level2: "Run data commands with --json for machine output.",
        level3:
          "Apply --from/--to/--type/--contains/--min-strain/--max-strain/--min-recovery/--max-recovery/--sort/--result-limit/--fields.",
      },
      firstSteps: [
        `${cliName} capabilities --json`,
        `${cliName} login-local --open --json`,
        `${cliName} login --json`,
        `${cliName} whoami --json`,
        `${cliName} workouts --days 14 --json`,
        `${cliName} help workouts --json`,
      ],
      commandCount: commandEntries.length,
      commands: commandEntries,
    };

    if (level >= 3) {
      payload.agentPatterns = agentPatterns;
    }

    return payload;
  }

  async function run(name, { flags = {}, deps = {}, acceptedFlags = false } = {}) {
    const command = get(name);
    if (!command) throw new Error(`Unknown command: ${name}`);
    if (typeof command.handler !== "function") {
      throw new Error(`Command "${name}" does not have a registered handler.`);
    }
    const commandFlags = acceptedFlags ? flags : acceptFlags(name, flags);
    return command.handler(commandFlags, deps);
  }

  function withHandlers(handlers = {}) {
    const commandsWithHandlers = commandList.map((command) => ({
      ...command,
      handler: handlers[command.name] ?? command.handler,
    }));
    return createCommandRegistry({
      commands: commandsWithHandlers,
      cliName,
      projectNotice,
      globalNotes,
      agentFilterOptions: normalizedAgentFilterOptions,
      agentOutputOptions: normalizedAgentOutputOptions,
      agentPatterns,
      outputModes,
    });
  }

  return {
    cliName,
    projectNotice,
    globalNotes,
    agentFilterOptions: normalizedAgentFilterOptions,
    agentOutputOptions: normalizedAgentOutputOptions,
    outputModes,
    commandFlagAllowlist: Object.fromEntries(
      commandList.map((command) => [command.name, allowedFlagsFor(command.name)]),
    ),
    filterableCommands: new Set(commandList.filter((command) => command.agentFilters).map((command) => command.name)),
    names,
    get,
    has,
    supportsAgentFilters,
    allowedFlagsFor,
    validateFlags,
    normalizeFlagValue,
    normalizeFlags,
    acceptFlags,
    parseArgv,
    getCommandSuggestions,
    getFlagSuggestions,
    formatUnknownCommand,
    formatUnknownFlag,
    buildCommandHelpPayload,
    formatCommandHelp,
    formatGlobalHelp,
    buildDiscoveryPayload,
    run,
    withHandlers,
  };
}
