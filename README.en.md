# opencode_framework

> OpenCode framework implementation (work-one) — Agent governance for autonomous software development

This repository holds the **implementation and governance of the OpenCode framework** —
a personal project that defines the Plugin / Skill / Tool / MCP / DB-canonical layers
needed for AI agents to operate autonomously, with automated CI/flow via GitHub Actions.

---

## 📌 What is this?

This is the **live operating state** of work-one (the framework's code name).
`AGENTS.md` is the **single authoritative spec** that auto-loads when an agent session starts.
It is distinct from the design blueprints in `blueprints/` and `docs/design/`.

| Item | Count / Location |
| --- | --- |
| **Agents** | 5 (Orchestrator + 4 native: build/general/plan/explore) |
| **Plugin entrypoints** | 5 (before/after/system-dispatcher + session + tool-def-trimmer) |
| **Plugin handlers** | 43 files; active chain: before 11 / after 7 / system 2 = 20 |
| **Custom tools** | 37 (`.opencode/tools/*.ts`) |
| **MCP servers** | 12 (in `opencode.json`) |
| **Skills** | 18 (auto-discovered from `.opencode/skills/{name}/SKILL.md`) |
| **Codebase** | CodeGraph 421 files; active `.opencode` TS 369 files / 75,218 lines (`rg`, respecting gitignore) |
| **Database** | SQLite single source of truth `framework-state.db` (schema v37, 49 business / 50 total), authoritative path `.opencode/state/framework-state.db` |

> ℹ️ **Design blueprint ≠ live state.** The historical "3-tier 9-role" architecture
> (Meta-Planner / Architect / Coder-BE / Coder-FE / Guardian / Arbiter / CI-CD-Agent / Super-Admin / Knowledge-Curator)
> is a **design blueprint**, no longer registered. It is preserved in `blueprints/` for reference.

---

## 🏗 Layout

| Path | Role |
| --- | --- |
| `.opencode/agents/` | Agent definitions (currently Orchestrator.md only) |
| `.opencode/plugins/` | Plugin entrypoints (5 files) |
| `.opencode/plugin-handlers/` | 43 handler files; 20 active |
| `.opencode/tools/` | 37 custom tools (safe_* series + Read Attestation) |
| `.opencode/skills/` | 18 skills (auto-discovered) |
| `.opencode/state/` | SQLite + machine state files |
| `.opencode/context/` | Design context (detailed design / coding standards / requirements) |
| `.opencode/commands/` | Auxiliary commands (dispatch / compliance-gate / search-knowledge) |
| `docs/infrastructure/` | Deep framework docs (10 files, ~6,000 lines) |
| `docs/design/` | UI / interaction design specs |
| `docs/official_docs/` | Mirror of OpenCode official docs |
| `blueprints/` | Historical design blueprints (reference only) |
| `contracts/` | API contract definitions (e.g. contract.yaml) |
| `.github/workflows/` | 11 GitHub Actions (auto-pr / cascade-close / ci / framework-ci / state-sync etc.) |
| `AGENTS.md` / `RULES.md` / `MEMORY.md` | Session-wide rules |

---

## 🔁 Typical workflow

```
1. Agent boot
   → AGENTS.md / RULES.md / MEMORY.md auto-loaded
   → Orchestrator is default

2. Task arrives
   → preflight-lite minimal precheck (risk grading)
   → high-risk escalates to compliance_gate_check

3. Tool call
   → before-dispatcher → Handler Chain (11 stages) → Tool executes
   → after-dispatcher → Handler Chain (7 stages) → result returned

4. CI / governance
   → GitHub Actions: ci / framework-ci / auto-pr / state-sync
   → state hash (keystone) for integrity check
```

---

## ⚙️ Stack

- TypeScript 6.0+
- Bun 1.3.14 (package manager + runtime)
- SQLite (framework state, schema v37)
- MCP SDK 1.29+
- GitHub Actions (11 workflows)

---

## 🔗 Related repos

- [qoderwork](https://github.com/Cho-Geer/qoderwork) — Personal workspace operating this framework
- [booking_system_refactor](https://github.com/Cho-Geer/booking_system_refactor) — Reference booking-system implementation built on this framework

---

## ⚠️ Notes

- Personal / experimental project.
- Some Windows tests fail due to `.opencode/.trash-*` residue; clean clone recommended.
- Design blueprints (`blueprints/`, `docs/design/`) and live state (this README + AGENTS.md) are **different artifacts**.
- Not intended for production use.

---

## 📄 License

No LICENSE file. Read-only access; redistribution or modification requires prior notice (Issue).

---

## 🇯🇵 日本語 | 🇨🇳 中文

- [日本語版](./README.md)
- [中文版本](./README.zh.md)
