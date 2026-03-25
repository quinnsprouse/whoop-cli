import { CLI_NAME, COMMANDS } from "./command-manifest.mjs";

function appendCommandGuidance(lines, command) {
  const def = COMMANDS[command];
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

export function formatMissingRequiredFlagMessage(command, flagName) {
  const lines = [`Missing required --${flagName} for "${CLI_NAME} ${command}".`];
  appendCommandGuidance(lines, command);
  return lines.join("\n");
}

export function formatInvalidFlagValueMessage(command, flagName, value, expectation) {
  const lines = [
    `Invalid --${flagName} value "${value}". Expected ${expectation}.`,
  ];
  appendCommandGuidance(lines, command);
  return lines.join("\n");
}

export function formatConfirmationRequiredMessage(command, summary) {
  const lines = [
    `${summary} Re-run with --yes to continue, or use --dry-run to preview the change.`,
  ];
  appendCommandGuidance(lines, command);
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
}) {
  const directValue = flags?.[flagName];
  if (directValue != null && directValue !== true) {
    const normalized = String(directValue).trim();
    if (normalized) return normalized;
  }

  if (!flags?.stdin) {
    throw new Error(formatMissingRequiredFlagMessage(command, flagName));
  }

  const stdinText = await readStdinText();
  const normalizedStdin = String(stdinText ?? "").trim();
  if (!normalizedStdin) {
    throw new Error(
      `${formatMissingRequiredFlagMessage(command, flagName)}\n\nStdin was empty.`,
    );
  }

  return normalizedStdin;
}
