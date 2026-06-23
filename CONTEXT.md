# WHOOP Query CLI Context

This context names the project-specific language around the WHOOP Query CLI. These terms keep command, option, and agent-discovery work consistent as the CLI grows.

## Language

**Command Registration**:
The source of truth that connects a command name to its command metadata, option schema, and command handler. It owns the command-facing interface used by help, discovery, validation, and dispatch.
_Avoid_: Dispatch switch, manifest row

**Command Metadata**:
The human and machine description of a command: summary, usage, examples, stdin notes, and agent-discovery traits.
_Avoid_: Help text, docs snippet

**Option Schema**:
The canonical description of a command flag, including its name, display flag, type, value label, description, and whether agent discovery should expose it.
_Avoid_: Allowlist entry, flag string

**Command Handler**:
The function that performs a command after command registration has resolved the command and accepted its flags. Existing handlers use the `(flags, deps)` shape.
_Avoid_: Command case, switch arm

**Agent Discovery**:
The structured command inventory and usage guidance intended for AI agents and scripts.
_Avoid_: Help output, capabilities prose

**Agent Output**:
The canonical rendering path for agent-facing and human-facing command payloads. It owns output mode selection, record extraction, field projection, timezone metadata, and stdout/file writing for Command Handlers.
_Avoid_: print helper, output switch

**Local-Day Query Window**:
The canonical request window for a local calendar day or date range in a specific WHOOP timezone. It owns the conversion from local dates to UTC request timestamps for collection Command Handlers.
_Avoid_: UTC midnight range, date helper bundle

## Example Dialogue

Developer: "I added a WHOOP sleep endpoint. Where should the new flag go?"

Domain expert: "Add it to the command's Option Schema in Command Registration. Agent Discovery and flag validation should derive from that."

Developer: "What calls the actual WHOOP method?"

Domain expert: "The Command Handler. Command Registration should only select and describe it."

Developer: "Where do `--from`, `--to`, and `--tz` become WHOOP request timestamps?"

Domain expert: "Use the Local-Day Query Window. Command Handlers should not build UTC start and end timestamps themselves."

Developer: "Where do `--jsonl`, `--csv`, `--fields`, and `--output` get applied?"

Domain expert: "Use Agent Output. Command Handlers should build payloads and let Agent Output render them."
