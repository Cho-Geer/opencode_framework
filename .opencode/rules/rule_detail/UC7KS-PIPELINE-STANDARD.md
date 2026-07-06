# UC7KS Knowledge Acquisition Pipeline Standard v1.0

**Version**: v1.0.0 | **Created**: 2026-06-06 | **Author**: @Super-Admin (GAP-M3)
**Applies To**: All 10 agents | **Enforcement**: `uc7ks-enforcer.ts`, `framework-enforcer.ts`, `tool-execute.ts`, `pre-execution-hook.sh`, `framework-self-test.ts` (Checks 17, 22, 28-32)

---

## §1 Overview

### §1.1 Purpose

UC7KS (Unified Context7 Knowledge System) Pipeline is the **mandatory knowledge acquisition protocol**:
1. **Local-first**: No external queries without exhausting `docs/official_docs/`
2. **Curated**: Only @Knowledge-Curator fetches/caches/indexes external docs
3. **No bypasses**: Including @Super-Admin (health-state emergency bypass only)

### §1.2 Design Principles

| Principle | Description |
|-----------|-------------|
| Local-First | Check `docs/official_docs/index.json` before any external query |
| Curated Knowledge | @Knowledge-Curator sole agent for external doc fetching |
| Physical Enforcement | Plugin/TS level enforcement; violations throw errors in strict/locked |
| Audit Trail | All violations/compliance events logged |
| Emergency Safety | @Super-Admin health-state bypass prevents repair deadlock |
| Size Governance | 500KB/file, 50MB total |

### §1.3 UC7KS Rule Index

| Rule ID | Name | Category |
|---------|------|----------|
| **UC7-001** | Local-First Cache Search | Pipeline Entry |
| **UC7-002** | Cache Insufficiency Declaration | Pipeline Flow |
| **UC7-003** | Post-Write Save-or-Fail | Data Integrity |
| **UC7-004** | Direct Context7 Block | Access Control |
| **UC7-005** | Knowledge Cache Size Limits | Resource Governance |
| **UC7-006** | _(Reserved)_ | Future |
| **UC7-007** | Atomic index.json Update | Data Integrity |
| **UC7-008** | @Knowledge-Curator Scope Isolation | Access Control |
| **UC7-009** | Super-Admin UC7KS Compliance | Access Control |

---

## §2 Pipeline Architecture

### §2.1 Flow Summary

Agent needs knowledge -> **UC7-001**: search `index.json` -> Hit? proceed. Miss? -> **UC7-002**: declare insufficiency -> @Orchestrator dispatches @Knowledge-Curator -> fetches docs (UC7-003/005/007/008) -> Agent re-reads cache -> proceed.

**Enforcement**: UC7-004 blocks direct external queries for non-KC. UC7-009 ensures Super-Admin compliance. UC7-001 blocks writes without cache read.

### §2.2 Enforcement Points

| Layer | File | UC7 Rules |
|-------|------|-----------|
| Write-Time | `tool-execute.ts` | UC7-001, 005, 008, 009 |
| Plugin | `uc7ks-enforcer.ts` | UC7-001, 002, 003, 004, 009 |
| Framework Core | `framework-enforcer.ts` | UC7-001, 004, 005, 008, 009 |
| Pre-Execution | `pre-execution-hook.sh` | UC7-001, 009 |
| Pre-Commit | `pre-commit` hook | UC7-003, 007 |
| Self-Test | `framework-self-test.ts` | UC7-002, 004, cache integrity |

---

## §3 UC7 Rule Definitions

**UC7-001: Local-First Cache Search** — P0 HARD CONSTRAINT, ALL agents
Before any external query (webfetch/websearch/context7_*), MUST: (1) search `index.json`, (2) read cached docs, (3) only if insufficient -> UC7-002. `tool-execute.ts` blocks writes if cache not read `[FW-ENFORCE][UC7-001]`. Advisory=Warning | Strict/Locked=BLOCKED.

**UC7-002: Cache Insufficiency Declaration** — P0 HARD CONSTRAINT, ALL agents
When cache insufficient: (1) declare what missing, (2) route @Orchestrator -> @Knowledge-Curator, (3) wait (no training data alone), (4) re-read after completion. `uc7ks-enforcer.ts` intercepts external tools. Advisory=Warning | Strict/Locked=BLOCKED.

**UC7-003: Post-Write Save-or-Fail** — P1 CONSTRAINT, @Knowledge-Curator
After writing to `docs/official_docs/`: (1) verify saved, (2) update `index.json` (sha256, size, source, TTL), (3) on failure: report, do NOT mark complete. `uc7ks-enforcer.ts` write-after hook; Check 22 verifies index matches disk.

**UC7-004: Direct External Query Block** — P0 HARD CONSTRAINT, ALL except @Knowledge-Curator
Non-KC MUST NOT call: `context7_*`, `webfetch`, `websearch`, `github_*`, `playwright_*`. Route through `@Orchestrator -> @Knowledge-Curator`. `framework-enforcer.ts` `checkUC7KS()` blocks `[FW-ENFORCE][UC7-004]`. Check 32 verifies configs. Advisory=Warning | Strict/Locked=BLOCKED.

**UC7-005: Knowledge Cache Size Limits** — P1 CONSTRAINT, @Knowledge-Curator (write)
Max 500KB/file, 50MB total. Oversized MUST split/compress. `tool-execute.ts` + `framework-enforcer.ts` pre-write `[FW-ENFORCE][UC7-005]`. Advisory=Warning | Strict/Locked=BLOCKED.

**UC7-006: _(Reserved)_** — Future use.

**UC7-007: Atomic index.json Update** — P1 CONSTRAINT, @Knowledge-Curator
All `index.json` changes MUST be atomic: write temp -> verify JSON -> atomic rename -> failure: delete temp, keep original. `uc7ks-enforcer.ts` write-after hook.

**UC7-008: @Knowledge-Curator Scope Isolation** — P0 HARD CONSTRAINT, @Knowledge-Curator
KC writes ONLY to: `docs/official_docs/**`, `.metadata/**`. DENIED: `.opencode/agents/**`, `.opencode/rules/**`, `.opencode/state/**`, `.opencode/scripts/**`, `.opencode/skills/**`, business code. `tool-execute.ts` + `framework-enforcer.ts` block `[FW-ENFORCE][UC7-008]`. Advisory=Warning | Strict/Locked=BLOCKED.

**UC7-009: Super-Admin UC7KS Compliance** — P0 HARD CONSTRAINT, @Super-Admin
Super-Admin MUST follow same pipeline: (1) repairs from latest docs, (2) check cache (UC7-001), (3) NOT exempt from Context7 block (UC7-004). **Emergency**: cache unhealthy (missing/corrupt/empty) -> bypass UC7-001 with `uc7ks_super_admin_emergency_bypass` audit. Prevents deadlock. `isKnowledgeCacheHealthy()` resolves.

---

## §4 Agent Compliance Matrix

| Agent | UC7-001 | UC7-002 | UC7-003 | UC7-004 | UC7-005 | UC7-007 | UC7-008 | UC7-009 |
|-------|:-------:|:-------:|:-------:|:-------:|:-------:|:-------:|:-------:|:-------:|
| @Meta-Planner | Must | Must | — | Blocked | — | — | — | — |
| @Orchestrator | Must | Routes | — | Blocked | — | — | — | — |
| @Architect | Must | Must | — | Blocked | — | — | — | — |
| @Coder-BE/FE | Must | Must | — | Blocked | — | — | — | — |
| @Guardian | Must | Must | — | Blocked | — | — | — | — |
| @Arbiter | Must | Must | — | Blocked | — | — | — | — |
| @CI-CD-Agent | Must | Must | — | Blocked | — | — | — | — |
| @Knowledge-Curator | Exec | Exec | Must | Exempt | Must | Must | Restricted | — |
| @Super-Admin | Must* | Must | — | Blocked | — | — | — | Must* |

*Emergency bypass when cache unhealthy

---

## §5 Enforcement Modes

All UC7 rules: Advisory=Warning | Strict=BLOCKED | Locked=BLOCKED. UC7-009 Locked: blocks ALL external queries.

---

## §6 Self-Test Coverage

| Check | UC7 | Description |
|-------|-----|-------------|
| 17 | — | No `UNRESOLVED{...}` |
| 22 | 003/005/007 | index.json matches files |
| 28 | 001 | knowledge_cache_state schema |
| 29 | — | Pipeline tools registered |
| 30 | 002 | semantic_map coverage |
| 31 | 002 | Agents have UC7KS section |
| 32 | 004 | No non-KC has context7_* |

---

## §7 Related Documents

`enforcement-modes-standard.md` | `TEMPLATE_VARIABLE_STANDARD.md` | `legacy/subagent-preamble.md (deprecated → Skills)` | `framework-self-test.ts` | `tool-execute.ts` | `uc7ks-enforcer.ts` | `framework-enforcer.ts` | `pre-execution-hook.sh` | `Knowledge-Curator.md` | `Super-Admin.md` | `docs/official_docs/index.json`

---

## §8 Version History

| Date | Version | Changes | Author |
|------|---------|---------|--------|
| 2026-06-06 | 1.0.0 | Extracted UC7-001 through UC7-009 from 7+ source files (GAP-M3). | @Super-Admin |
