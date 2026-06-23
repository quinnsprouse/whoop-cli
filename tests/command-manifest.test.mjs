import assert from "node:assert/strict";
import test from "node:test";
import {
  COMMANDS,
  COMMAND_FLAG_ALLOWLIST,
  COMMAND_REGISTRY,
} from "../src/lib/command-manifest.mjs";
import {
  COMMAND_REGISTRATIONS,
  commandRegistry,
} from "../src/commands/registry.mjs";
import {
  endpointCommandRegistrationList,
  endpointCommandRegistrations,
} from "../src/commands/endpoints.mjs";

const EXPECTED_ENDPOINT_COMMAND_NAMES = [
  "cycle-by-id",
  "activity-map",
  "sleep-by-id",
  "sleep-stream",
  "workout-by-id",
  "cycle-recovery",
  "cycle-sleep",
];

const EXPECTED_COMMAND_NAMES = [
  "help",
  "discover",
  "capabilities",
  "login-url",
  "login",
  "login-local",
  "exchange-code",
  "refresh-token",
  "whoami",
  "profile",
  "body",
  "cycles",
  "recoveries",
  "sleep",
  "workouts",
  ...EXPECTED_ENDPOINT_COMMAND_NAMES,
  "day",
  "revoke",
  "logout",
];

test("runtime command registrations preserve expected command order", () => {
  assert.deepEqual(commandRegistry.names(), EXPECTED_COMMAND_NAMES);
  assert.deepEqual(COMMAND_REGISTRY.names(), EXPECTED_COMMAND_NAMES);
  assert.deepEqual(Object.keys(COMMANDS), EXPECTED_COMMAND_NAMES);
});

test("new endpoint commands are present in manifest", () => {
  assert.ok(COMMANDS["cycle-by-id"]);
  assert.ok(COMMANDS["activity-map"]);
  assert.ok(COMMAND_REGISTRY.has("sleep-stream"));
  assert.ok(COMMAND_FLAG_ALLOWLIST["cycle-by-id"].has("cycle-id"));
  assert.ok(COMMAND_FLAG_ALLOWLIST["activity-map"].has("activity-v1-id"));
  assert.ok(COMMAND_FLAG_ALLOWLIST["sleep-stream"].has("types"));
});

test("endpoint command registrations stay localized to endpoint module", () => {
  assert.deepEqual(
    endpointCommandRegistrationList.map((registration) => registration.name),
    EXPECTED_ENDPOINT_COMMAND_NAMES,
  );
  assert.deepEqual(Object.keys(endpointCommandRegistrations), EXPECTED_ENDPOINT_COMMAND_NAMES);

  const firstEndpointIndex = COMMAND_REGISTRATIONS.findIndex(
    (registration) => registration.name === EXPECTED_ENDPOINT_COMMAND_NAMES[0],
  );
  assert.notEqual(firstEndpointIndex, -1);
  assert.deepEqual(
    COMMAND_REGISTRATIONS.slice(
      firstEndpointIndex,
      firstEndpointIndex + endpointCommandRegistrationList.length,
    ),
    endpointCommandRegistrationList,
  );

  for (const registration of endpointCommandRegistrationList) {
    assert.equal(endpointCommandRegistrations[registration.name], registration);
    assert.equal(typeof registration.handler, "function");
    assert.ok(
      registration.options.some((option) => option.name === "stdin"),
      `${registration.name} should expose shared stdin input`,
    );
    assert.ok(
      registration.usage.some((entry) => entry.includes(`${registration.name} --stdin`)),
      `${registration.name} should document stdin usage`,
    );
    assert.ok(
      registration.stdin?.examples?.some((entry) => entry.includes(`${registration.name} --stdin`)),
      `${registration.name} should document stdin examples`,
    );
  }
});

test("csv mode is allowlisted for data and endpoint commands", () => {
  const commands = [
    "cycles",
    "recoveries",
    "sleep",
    "workouts",
    "cycle-by-id",
    "activity-map",
    "sleep-by-id",
    "sleep-stream",
    "workout-by-id",
    "cycle-recovery",
    "cycle-sleep",
    "day",
  ];

  for (const command of commands) {
    assert.ok(COMMAND_FLAG_ALLOWLIST[command].has("csv"), `${command} should allow --csv`);
  }
});

test("agent-oriented commands advertise examples and stdin support where relevant", () => {
  assert.ok(COMMANDS.workouts.examples.length > 0);
  assert.equal(COMMANDS.workouts.options[0].name, "client-id");
  assert.equal(COMMANDS.workouts.options[0].type, "string");
  assert.ok(COMMANDS["exchange-code"].stdin);
  assert.ok(COMMAND_FLAG_ALLOWLIST["exchange-code"].has("stdin"));
  assert.ok(COMMAND_FLAG_ALLOWLIST["cycle-by-id"].has("stdin"));
  assert.ok(COMMAND_FLAG_ALLOWLIST.revoke.has("dry-run"));
  assert.ok(COMMAND_FLAG_ALLOWLIST.revoke.has("yes"));
  assert.ok(COMMAND_FLAG_ALLOWLIST.revoke.has("force"));
  assert.ok(COMMAND_FLAG_ALLOWLIST.logout.has("dry-run"));
  assert.ok(COMMAND_FLAG_ALLOWLIST.logout.has("yes"));
  assert.ok(COMMAND_FLAG_ALLOWLIST.logout.has("force"));
});

test("registry derives agent filter flags from command option schema", () => {
  assert.ok(COMMAND_REGISTRY.filterableCommands.has("workouts"));
  assert.ok(COMMAND_REGISTRY.allowedFlagsFor("workouts").has("min-strain"));
  assert.ok(COMMAND_REGISTRY.allowedFlagsFor("workouts").has("records-only"));
  assert.equal(COMMAND_REGISTRY.allowedFlagsFor("whoami").has("min-strain"), false);
});

test("all command metadata entries have normalized unique option schema", () => {
  for (const commandName of COMMAND_REGISTRY.names()) {
    const command = COMMAND_REGISTRY.get(commandName);
    assert.equal(typeof command.summary, "string", `${commandName} missing summary`);
    assert.ok(command.summary.length > 0, `${commandName} has empty summary`);
    assert.ok(Array.isArray(command.usage), `${commandName} missing usage`);
    assert.ok(command.usage.length > 0, `${commandName} has empty usage`);
    assert.ok(Array.isArray(command.examples), `${commandName} missing examples`);
    assert.ok(command.examples.length > 0, `${commandName} has empty examples`);

    const optionNames = new Set();
    for (const option of command.options) {
      assert.equal(typeof option.name, "string", `${commandName} has unnamed option`);
      assert.ok(option.name.length > 0, `${commandName} has empty option name`);
      assert.equal(typeof option.flag, "string", `${commandName} option ${option.name} missing display flag`);
      assert.equal(typeof option.type, "string", `${commandName} option ${option.name} missing type`);
      assert.equal(optionNames.has(option.name), false, `${commandName} duplicates --${option.name}`);
      optionNames.add(option.name);
    }
  }
});

test("runtime command registration binds handlers for dispatchable commands", () => {
  for (const registration of COMMAND_REGISTRATIONS) {
    const command = commandRegistry.get(registration.name);
    assert.equal(command?.summary, registration.summary, `${registration.name} metadata should come from runtime registration`);
    if (registration.name === "help") {
      assert.equal(typeof command.handler, "undefined");
      continue;
    }
    assert.equal(typeof registration.handler, "function", `${registration.name} missing localized command handler`);
    assert.equal(command.handler, registration.handler, `${registration.name} handler should come from localized registration`);
  }
});
