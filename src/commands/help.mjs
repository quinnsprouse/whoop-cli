import { option } from "../lib/command-options.mjs";
import { CLI_NAME } from "../lib/project-info.mjs";

export const helpCommandRegistration = {
  name: "help",
  summary: "Show global help or command help.",
  usage: [
    `${CLI_NAME} help`,
    `${CLI_NAME} help <command>`,
    `${CLI_NAME} <command> --help`,
  ],
  options: [option("--json", "Return structured command metadata.")],
  examples: [
    `${CLI_NAME} help workouts`,
    `${CLI_NAME} help login-local`,
    `${CLI_NAME} help workouts --json`,
  ],
};
