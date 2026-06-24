import {
  AGENT_FILTER_OPTIONS,
  AGENT_OUTPUT_OPTIONS,
  AGENT_PATTERNS,
} from "../lib/command-options.mjs";
import { createCommandRegistry } from "../lib/command-registry.mjs";
import {
  CLI_NAME,
  GLOBAL_NOTES,
  PROJECT_NOTICE,
} from "../lib/project-info.mjs";
import { getWhoopEndpointsForCommand } from "../lib/whoop-endpoint-catalog.mjs";
import { authCommandRegistrations } from "./auth.mjs";
import {
  collectionCommandRegistrationList,
  collectionCommandRegistrations,
} from "./collections.mjs";
import { discoveryCommandRegistrations } from "./discovery.mjs";
import { endpointCommandRegistrationList } from "./endpoints.mjs";
import { helpCommandRegistration } from "./help.mjs";
import { userCommandRegistrations } from "./user.mjs";

function commandMetadataOnly(registration) {
  const { handler, ...metadata } = registration;
  return metadata;
}

function withEndpointCatalogMetadata(registration) {
  if (registration.endpoint || registration.endpoints) return registration;

  const endpoints = getWhoopEndpointsForCommand(registration.name);
  if (endpoints.length === 0) return registration;

  return {
    ...registration,
    endpoints,
  };
}

const RAW_COMMAND_REGISTRATIONS = [
  helpCommandRegistration,
  discoveryCommandRegistrations.discover,
  discoveryCommandRegistrations.capabilities,
  authCommandRegistrations["login-url"],
  authCommandRegistrations.login,
  authCommandRegistrations["login-local"],
  authCommandRegistrations["exchange-code"],
  authCommandRegistrations["refresh-token"],
  authCommandRegistrations.whoami,
  userCommandRegistrations.profile,
  userCommandRegistrations.body,
  ...collectionCommandRegistrationList,
  ...endpointCommandRegistrationList,
  collectionCommandRegistrations.day,
  authCommandRegistrations.revoke,
  authCommandRegistrations.logout,
];

export const COMMAND_REGISTRATIONS = RAW_COMMAND_REGISTRATIONS.map(withEndpointCatalogMetadata);

export const COMMANDS = Object.fromEntries(
  COMMAND_REGISTRATIONS.map((registration) => [
    registration.name,
    commandMetadataOnly(registration),
  ]),
);

export const commandRegistry = createCommandRegistry({
  commands: COMMAND_REGISTRATIONS,
  cliName: CLI_NAME,
  projectNotice: PROJECT_NOTICE,
  globalNotes: GLOBAL_NOTES,
  agentFilterOptions: AGENT_FILTER_OPTIONS,
  agentOutputOptions: AGENT_OUTPUT_OPTIONS,
  agentPatterns: AGENT_PATTERNS,
});

export const FILTERABLE_COMMANDS = commandRegistry.filterableCommands;
export const COMMAND_FLAG_ALLOWLIST = commandRegistry.commandFlagAllowlist;
