/**
 * framework-enforcer.ts — OpenCode Framework Enforcer Plugin v2.3.2
 *
 * Hooks into the OpenCode runtime to enforce framework governance rules:
 *  - tool.execute.before:  Pre-validates DAG coverage, gate state, enforcement mode,
 *    agent write scopes, TDD ordering, plugin integrity, enforcement mode guard,
 *    contract hash verification, and skill gate validation.
 *  - tool.execute.after:   Post-execution audit logging, stale session detection,
 *    code quality checks (ESLint/Prettier/tsc), auto-repair trigger,
 *    and scope violation post-hoc logging.
 *  - shell.env:            Injects enforcement context into shell commands.
 *  - file.edited:          Tamper detection for critical framework files.
 *  - session.created:      Logs session creation, injects enforcement context.
 *  - session.error:        Logs session errors, triggers auto-recovery on critical.
 *  - session.idle:         Auto-drains stale gate sessions on idle.
 *  - session.compacted:    Logs compaction events, verifies enforcement state preserved.
 *  - message.updated:      Logs message changes for audit.
 *  - todo.updated:         Logs todo list changes for audit.
 *  - permission.asked:     Logs permission requests, detects escalation patterns.
 *  - permission.replied:   Audits permission grants/denials.
 *  - command.executed:     Validates commands against agent permissions, logs execution.
 *  - tui.command.execute:  Validates slash commands, logs dangerous command execution.
 *
 * Reads framework state from files (NOT a second state model):
 *  - Task.DAG.json        — task status
 *  - .opencode/state/gate-state.json — armed sessions
 *  - .opencode/state/machine.json    — enforcement mode (via project.config.json)
 *  - .opencode/project.config.json   — enforcement_config, agent_write_scopes
 *
 * Modes:
 *  - advisory:  Log warnings but allow execution
 *  - strict:    Block on DAG/gate/scope/TDD/integrity violations
 *  - locked:    Block on all violations; no waivers accepted; tamper auto-restore
 *
 * @author  @Architect, @Coder-BE
 * @version 2.3.2
 * @phase   FW-HARNESS-P3 + BOOTSTRAP-DEADLOCK-FIX
 */
import type { Plugin } from "@opencode-ai/plugin";
declare const plugin: Plugin;
export default plugin;
