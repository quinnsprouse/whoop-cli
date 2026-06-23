import assert from "node:assert/strict";
import test from "node:test";
import {
  createCommandRegistry,
  defineOption,
} from "../src/lib/command-registry.mjs";

function createSyntheticRegistry(handler = async () => "ok") {
  return createCommandRegistry({
    cliName: "demo-cli",
    projectNotice: "Unofficial demo.",
    globalNotes: ["Use JSON for scripts."],
    commands: [
      {
        name: "workouts",
        summary: "List workouts.",
        agentFilters: true,
        usage: ["demo-cli workouts [--days <n>] [--json]"],
        options: [
          defineOption("--days <n>", "Window length.", { type: "integer", min: 1 }),
          defineOption("--start <ISO>", "Explicit start."),
          "--json",
        ],
        examples: ["demo-cli workouts --days 7 --json"],
        handler,
      },
      {
        name: "whoami",
        summary: "Show identity.",
        usage: ["demo-cli whoami [--json]"],
        options: ["--json"],
        examples: ["demo-cli whoami --json"],
      },
      {
        name: "login-local",
        summary: "Login locally.",
        usage: ["demo-cli login-local [--open true|false]"],
        options: [
          defineOption("--open true|false", "Open browser.", { type: "boolean-string" }),
        ],
        examples: ["demo-cli login-local --open false"],
        handler,
      },
    ],
    agentFilterOptions: [
      defineOption("--from <YYYY-MM-DD>", "Inclusive lower date."),
      defineOption("--sort <value>", "Sort field.", {
        type: "enum",
        values: ["date", "date-desc"],
      }),
    ],
    agentOutputOptions: [
      defineOption("--fields <csv>", "Project selected fields."),
      defineOption("--records-only", "Return only records."),
    ],
    agentPatterns: [
      {
        pattern: "Recent workouts",
        command: "demo-cli workouts --days 7 --json",
      },
    ],
  });
}

test("defineOption normalizes display flags and inferred types", () => {
  assert.deepEqual(
    defineOption("--from <YYYY-MM-DD>", "Inclusive lower date."),
    {
      flag: "--from <YYYY-MM-DD>",
      name: "from",
      valueLabel: "YYYY-MM-DD",
      type: "date",
      takesValue: true,
      description: "Inclusive lower date.",
    },
  );
  assert.equal(defineOption("--days <n>", "Days.").type, "integer");
  assert.equal(defineOption("--fields <csv>", "Fields.").type, "csv");
  assert.equal(defineOption("--json", "JSON.").type, "boolean");
  assert.equal(defineOption("--json", "JSON.").takesValue, false);
  assert.equal(defineOption("--open true|false", "Open.").type, "boolean-string");
  assert.throws(() => defineOption("", "broken"), /Invalid option flag/);
});

test("registry derives command allowlists from command and agent option schema", () => {
  const registry = createSyntheticRegistry();
  assert.deepEqual(registry.names(), ["workouts", "whoami", "login-local"]);
  assert.equal(registry.supportsAgentFilters("workouts"), true);
  assert.equal(registry.supportsAgentFilters("whoami"), false);

  const workoutFlags = registry.allowedFlagsFor("workouts");
  assert.equal(workoutFlags.has("days"), true);
  assert.equal(workoutFlags.has("from"), true);
  assert.equal(workoutFlags.has("records-only"), true);
  assert.equal(workoutFlags.has("fields"), true);
  assert.equal(workoutFlags.has("sort"), true);
  assert.equal(workoutFlags.has("tz"), true);

  const whoamiFlags = registry.allowedFlagsFor("whoami");
  assert.equal(whoamiFlags.has("json"), true);
  assert.equal(whoamiFlags.has("from"), false);
});

test("registry formats help, discovery, and suggestions through one interface", () => {
  const registry = createSyntheticRegistry();
  const help = registry.formatCommandHelp("workouts", { json: true });
  assert.equal(help.ok, true);
  const helpPayload = JSON.parse(help.text);
  assert.equal(helpPayload.command, "workouts");
  assert.equal(helpPayload.supportsAgentFilters, true);
  assert.equal(helpPayload.options[0].name, "days");

  const discovery = registry.buildDiscoveryPayload(3, "workouts");
  assert.equal(discovery.commandCount, 1);
  assert.equal(discovery.commands[0].name, "workouts");
  assert.equal(discovery.commands[0].agentFilters[0].name, "from");
  assert.equal(discovery.agentPatterns[0].pattern, "Recent workouts");

  assert.deepEqual(registry.getCommandSuggestions("workot"), ["workouts"]);
  assert.deepEqual(registry.getFlagSuggestions("dasy", registry.allowedFlagsFor("workouts")), ["days"]);
  assert.match(registry.formatUnknownFlag("workouts", ["dasy"], registry.allowedFlagsFor("workouts")), /Did you mean --days/);
});

test("registry normalizes flag values from shared option schema", () => {
  const registry = createSyntheticRegistry();

  assert.deepEqual(
    registry.normalizeFlags("workouts", {
      days: "7",
      from: "2026-03-01",
      start: "2026-03-20T06:15:30-04:00",
      sort: "DATE-DESC",
      fields: "id,start",
      "records-only": true,
      json: "false",
    }),
    {
      days: 7,
      from: "2026-03-01",
      start: "2026-03-20T10:15:30.000Z",
      sort: "date-desc",
      fields: "id,start",
      "records-only": true,
      json: false,
    },
  );

  assert.equal(registry.normalizeFlagValue("login-local", "open", "false"), false);
  assert.equal(registry.normalizeFlagValue("login-local", "open", true), true);
  assert.throws(() => registry.normalizeFlags("workouts", { days: "nope" }), /Invalid --days/);
  assert.throws(() => registry.normalizeFlags("workouts", { from: "03-01-2026" }), /Invalid --from/);
  assert.throws(() => registry.normalizeFlags("workouts", { start: "2026-03-20T06:15:30" }), /Invalid --start/);
  assert.throws(() => registry.normalizeFlags("workouts", { sort: "strain" }), /Invalid --sort/);
  assert.throws(() => registry.normalizeFlags("workouts", { fields: true }), /Missing value for --fields/);
});

test("registry parses argv with command option schema", () => {
  const registry = createSyntheticRegistry();

  assert.deepEqual(
    registry.parseArgv([
      "node",
      "demo-cli",
      "workouts",
      "--json",
      "extra-target",
      "--days",
      "7",
      "--fields=id,start",
    ]),
    {
      command: "workouts",
      flags: {
        json: true,
        days: "7",
        fields: "id,start",
      },
      positionals: ["extra-target"],
    },
  );

  assert.deepEqual(
    registry.parseArgv([
      "node",
      "demo-cli",
      "login-local",
      "--open",
      "false",
    ]),
    {
      command: "login-local",
      flags: { open: "false" },
      positionals: [],
    },
  );

  const booleanFalse = registry.acceptFlags(
    "workouts",
    registry.parseArgv(["node", "demo-cli", "workouts", "--json", "false"]).flags,
  );
  assert.equal(booleanFalse.json, false);
});

test("registry dispatches handlers and can bind handlers after metadata registration", async () => {
  const calls = [];
  const registry = createSyntheticRegistry(async (flags, deps) => {
    calls.push({ flags, deps });
    return "handled";
  });

  assert.equal(await registry.run("workouts", { flags: { days: "7" }, deps: { source: "test" } }), "handled");
  assert.deepEqual(calls[0], { flags: { days: 7 }, deps: { source: "test" } });
  await assert.rejects(
    () => registry.run("workouts", { flags: { dasy: "7" } }),
    /unknown flag.*--dasy/s,
  );
  assert.equal(calls.length, 1);
  await assert.rejects(
    () => registry.run("workouts", { flags: { days: "nope" } }),
    /Invalid --days/,
  );
  assert.equal(calls.length, 1);

  const parsed = registry.parseArgv([
    "node",
    "demo-cli",
    "workouts",
    "--days",
    "3",
    "--json",
  ]);
  assert.equal(await registry.run(parsed.command, { flags: parsed.flags }), "handled");
  assert.deepEqual(calls[1].flags, { days: 3, json: true });

  assert.equal(
    await registry.run("workouts", {
      flags: { days: "still-raw", dasy: "bypassed" },
      acceptedFlags: true,
    }),
    "handled",
  );
  assert.deepEqual(calls[2].flags, { days: "still-raw", dasy: "bypassed" });

  await assert.rejects(() => registry.run("whoami"), /does not have a registered handler/);

  const rebound = registry.withHandlers({
    whoami: async () => "identity",
  });
  assert.equal(await rebound.run("whoami"), "identity");
});

test("registry rejects duplicate or malformed command and option registrations", () => {
  assert.throws(
    () => createCommandRegistry({
      commands: [
        { name: "same", summary: "", usage: [], options: [] },
        { name: "same", summary: "", usage: [], options: [] },
      ],
    }),
    /Duplicate or missing command registration/,
  );
  assert.throws(
    () => createCommandRegistry({
      commands: [{ name: "bad", summary: "", usage: [], options: [null] }],
    }),
    /Invalid option schema entry/,
  );
});
