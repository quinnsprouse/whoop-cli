import { CLI_NAME } from "./project-info.mjs";

const BOOLEAN_LITERAL_VALUES = new Set([
  "1",
  "0",
  "true",
  "false",
  "yes",
  "no",
  "y",
  "n",
  "on",
  "off",
]);

function isFlagToken(value) {
  return typeof value === "string" && value.startsWith("--") && value.length > 2;
}

function isBooleanLiteral(value) {
  return BOOLEAN_LITERAL_VALUES.has(String(value ?? "").trim().toLowerCase());
}

function parseFlagToken(token) {
  if (!isFlagToken(token)) return null;
  const withoutPrefix = token.slice(2);
  const equalsIndex = withoutPrefix.indexOf("=");
  if (equalsIndex >= 0) {
    return {
      name: withoutPrefix.slice(0, equalsIndex),
      value: withoutPrefix.slice(equalsIndex + 1),
      hasInlineValue: true,
    };
  }
  return {
    name: withoutPrefix,
    value: null,
    hasInlineValue: false,
  };
}

export function parseCommandInputArgv(argv, { optionFor = null } = {}) {
  const parts = Array.from(argv ?? [], (part) => String(part));
  const command = parts[2] ?? null;
  const args = parts.slice(3);
  const flags = {};
  const positionals = [];

  const getOption = (flagName) =>
    typeof optionFor === "function" ? optionFor(command, flagName) : null;

  for (let i = 0; i < args.length; i += 1) {
    const part = args[i];
    const parsedFlag = parseFlagToken(part);
    if (!parsedFlag) {
      positionals.push(part);
      continue;
    }

    if (!parsedFlag.name) {
      positionals.push(part);
      continue;
    }

    if (parsedFlag.hasInlineValue) {
      flags[parsedFlag.name] = parsedFlag.value === "" ? true : parsedFlag.value;
      continue;
    }

    const option = getOption(parsedFlag.name);
    const next = args[i + 1];
    if (option?.takesValue) {
      if (next == null || isFlagToken(next)) {
        flags[parsedFlag.name] = true;
        continue;
      }
      flags[parsedFlag.name] = next;
      i += 1;
      continue;
    }

    if (option?.type === "boolean" && next != null && !isFlagToken(next) && isBooleanLiteral(next)) {
      flags[parsedFlag.name] = next;
      i += 1;
      continue;
    }

    flags[parsedFlag.name] = true;
  }

  return { command, flags, positionals };
}

function getCommandDefinition(commandRegistry, command) {
  if (!commandRegistry) return null;
  if (typeof commandRegistry.buildCommandHelpPayload === "function") {
    return commandRegistry.buildCommandHelpPayload(command);
  }
  if (typeof commandRegistry.get === "function") {
    return commandRegistry.get(command);
  }
  return null;
}

function appendCommandGuidance(lines, command, commandRegistry = null) {
  const def = getCommandDefinition(commandRegistry, command);
  if (!def) return lines;

  if (Array.isArray(def.usage) && def.usage.length > 0) {
    lines.push("", "Usage:");
    for (const entry of def.usage) lines.push(`  ${entry}`);
  }

  if (Array.isArray(def.examples) && def.examples.length > 0) {
    lines.push("", "Examples:");
    for (const example of def.examples) lines.push(`  ${example}`);
  }

  if (def.stdin?.description) {
    lines.push("", `Stdin: ${def.stdin.description}`);
    for (const example of def.stdin.examples ?? []) lines.push(`  ${example}`);
  }

  return lines;
}

export function formatMissingRequiredFlagMessage(command, flagName, commandRegistry = null) {
  const lines = [`Missing required --${flagName} for "${CLI_NAME} ${command}".`];
  appendCommandGuidance(lines, command, commandRegistry);
  return lines.join("\n");
}

export function formatInvalidFlagValueMessage(command, flagName, value, expectation, commandRegistry = null) {
  const lines = [
    `Invalid --${flagName} value "${value}". Expected ${expectation}.`,
  ];
  appendCommandGuidance(lines, command, commandRegistry);
  return lines.join("\n");
}

export function formatConfirmationRequiredMessage(command, summary, commandRegistry = null) {
  const lines = [
    `${summary} Re-run with --yes to continue, or use --dry-run to preview the change.`,
  ];
  appendCommandGuidance(lines, command, commandRegistry);
  return lines.join("\n");
}

export function hasConfirmationBypass(flags) {
  return Boolean(flags?.yes || flags?.force);
}

export async function resolveRequiredFlagValue({
  command,
  flagName,
  flags,
  readStdinText,
  commandRegistry = null,
}) {
  const directValue = flags?.[flagName];
  if (directValue != null && directValue !== true) {
    const normalized = String(directValue).trim();
    if (normalized) return normalized;
  }

  if (!flags?.stdin) {
    throw new Error(formatMissingRequiredFlagMessage(command, flagName, commandRegistry));
  }

  const stdinText = await readStdinText();
  const normalizedStdin = String(stdinText ?? "").trim();
  if (!normalizedStdin) {
    throw new Error(
      `${formatMissingRequiredFlagMessage(command, flagName, commandRegistry)}\n\nStdin was empty.`,
    );
  }

  return normalizedStdin;
}
