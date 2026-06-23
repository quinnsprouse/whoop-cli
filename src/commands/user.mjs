import {
  AUTH_CLIENT_OPTIONS,
  STRUCTURED_OUTPUT_OPTIONS,
} from "../lib/command-options.mjs";
import { CLI_NAME } from "../lib/project-info.mjs";

export async function commandProfile(flags, deps) {
  const { withClient, writeOutput } = deps;
  const client = await withClient(flags);
  const profile = await client.getBasicProfile();
  await writeOutput(profile, { ...flags, json: true });
}

export async function commandBody(flags, deps) {
  const { withClient, writeOutput } = deps;
  const client = await withClient(flags);
  const body = await client.getBodyMeasurement();
  await writeOutput(body, { ...flags, json: true });
}

export const userCommandRegistrations = {
  profile: {
    name: "profile",
    summary: "Fetch authenticated WHOOP basic profile.",
    usage: [`${CLI_NAME} profile [--json|--csv]`],
    options: [...AUTH_CLIENT_OPTIONS, ...STRUCTURED_OUTPUT_OPTIONS],
    examples: [`${CLI_NAME} profile --json`, `${CLI_NAME} profile --csv`],
    handler: commandProfile,
  },
  body: {
    name: "body",
    summary: "Fetch authenticated WHOOP body measurements.",
    usage: [`${CLI_NAME} body [--json|--csv]`],
    options: [...AUTH_CLIENT_OPTIONS, ...STRUCTURED_OUTPUT_OPTIONS],
    examples: [`${CLI_NAME} body --json`, `${CLI_NAME} body --csv`],
    handler: commandBody,
  },
};
