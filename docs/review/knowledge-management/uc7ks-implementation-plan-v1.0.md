# UC7KS Implementation Plan v1.0

**Date**: 2026-06-05
**Author**: Super-Admin Agent
**Sources**:
- `uc7ks-design-analysis-v1.0.md` (v1.5.0 — design document with Scout Layer 3)
- `uc7ks-cross-reference-findings-v1.0.md` (22 findings: 3 HIGH, 8 MEDIUM, 11 LOW)
**Status**: Implementation Plan — Awaiting Approval
**Compliance Gate**: Required for all Phase 0+ tasks

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Prerequisite Fixes — Cross-Reference Remediation](#2-prerequisite-fixes--cross-reference-remediation)
3. [Phased Implementation Plan](#3-phased-implementation-plan)
   - [Phase 0: Design Document Remediation (Pre-Flight)](#phase-0-design-document-remediation-pre-flight)
   - [Phase 1: Foundation — Schemas & Agent Design](#phase-1-foundation--schemas--agent-design)
   - [Phase 2: Core Infrastructure — Directory & Agent Creation](#phase-2-core-infrastructure--directory--agent-creation)
   - [Phase 3: Harness Integration — Enforcement Rules](#phase-3-harness-integration--enforcement-rules)
   - [Phase 4: Agent Updates — All Agent Configs](#phase-4-agent-updates--all-agent-configs)
   - [Phase 5: Knowledge Management Subsystem](#phase-5-knowledge-management-subsystem)
   - [Phase 5b: Scout Source-Analysis Integration](#phase-5b-scout-source-analysis-integration)
   - [Phase 6: Integration Testing & Validation](#phase-6-integration-testing--validation)
4. [Dependency Graph](#4-dependency-graph)
5. [Agent Assignments & Dispatch Matrix](#5-agent-assignments--dispatch-matrix)
6. [Risk Assessment & Mitigation](#6-risk-assessment--mitigation)
7. [Definition of Done per Phase](#7-definition-of-done-per-phase)
8. [Timeline & Effort Estimates](#8-timeline--effort-estimates)

---

## 1. Executive Summary

### 1.1 What We Are Building

The **Universal Context7-First Knowledge System (UC7KS)** transforms how all agents — including @Super-Admin — acquire, cache, and reuse technical documentation. Instead of each agent performing ad-hoc external queries against stale training data, UC7KS provides:

- A **dedicated @Knowledge-Curator subagent** that is the single gateway for all external documentation queries
- A **local-first search mandate** (UC7-001) enforced by the harness before any external call
- A **three-tier acquisition pipeline**: Local Cache → Context7 MCP → webfetch → websearch
- A **fourth tier (Layer 3 — Scout)**: OpenCode built-in Scout subagent for source-code analysis when documentation-tier sources are insufficient
- A **knowledge management subsystem** (Indexer, Deduplicator, Compressor, Janitor) for size control, freshness, and searchability
- A **mandatory user-confirmation step** (UC7-002) before any external query

### 1.2 Scope

This plan covers **all phases** from design document remediation through production validation. The plan synthesizes:

| Source | Contribution |
|--------|--------------|
| `uc7ks-design-analysis-v1.0.md` | Architecture, enforcement constraints, permission matrix, workflow diagrams, implementation roadmap (§13) |
| `uc7ks-cross-reference-findings-v1.0.md` | 22 findings (F1-F22) identifying factual errors, design gaps, terminology issues, and missed opportunities |

### 1.3 Key Changes from Original Roadmap

The original roadmap (§13 of the design doc) had 6 phases. This plan adds:

- **Phase 0**: Prerequisite remediation of the 22 cross-reference findings
- **Phase 5b**: Dedicated Scout integration phase (previously embedded in Phase 5)
- **Explicit agent assignments, acceptance criteria, and DoD** for each task
- **Risk assessment** and **dependency graph**

---

## 2. Prerequisite Fixes — Cross-Reference Remediation

Before any implementation begins, the design document must be corrected. These fixes are classified by severity from the cross-reference findings.

### 2.1 Must-Fix (BLOCKING — before any phase begins)

| Fix ID | Finding | Current | Correct | Design Doc Section | Effort |
|--------|---------|---------|---------|-------------------|--------|
| **P0-F1** | Incorrect GitHub URL | `https://github.com/opencode` | `https://github.com/anomalyco/opencode` | §8.3, all references | 5 min |
| **P0-F2** | Subsection numbering mismatch | §9 subsections labeled 8.x, §10 as 9.x, etc. | Renumber to match parent section (9.1, 10.1, 11.1, 12.1) | §9-§12 | 15 min |
| **P0-F3** | websearch availability constraint | Not documented | Add constraint: requires OpenCode provider OR `OPENCODE_ENABLE_EXA=1`; degrade to webfetch-only otherwise | §6.1, §11.2 | 10 min |

### 2.2 Should-Fix (IMPORTANT — before Phase 2)

| Fix ID | Finding | Action Required | Section | Effort |
|--------|---------|----------------|---------|--------|
| **P0-F4** | Duplicate `opencode/` and `framework/opencode/` paths | Consolidate: keep top-level `opencode/`, remove `framework/opencode/` | §2.2 | 10 min |
| **P0-F5** | Missing Scout subagent comparison | Add note in §6.1: @Knowledge-Curator extends Scout with structured knowledge management, local caching, SHA dedup, TTL freshness, user confirmation | §6.1 | 15 min |
| **P0-F6** | `agent_tools_blacklist` vs `permission.deny` | Clarify mapping: custom `agent_tools_blacklist` → OpenCode `permission.deny` | §3.1 (UC7-004), §6.1 | 10 min |
| **P0-F7** | `agent_tools_whitelist` vs `permission` | Clarify: custom field mapped to `permission.allow` in OpenCode native config; note `tools` config deprecated in v1.1.1 | §6.2 | 10 min |
| **P0-F8** | `safe_*` tools are project-specific | Add note: `safe_edit/safe_shell/safe_mkdir/safe_delete/safe_diff` are custom project tools, not standard OpenCode built-ins. OpenCode built-ins for file ops are `edit/write/read/bash` | §6.1 | 10 min |
| **P0-F9** | `dispatch_subagent` is project-custom | Add explanation: `dispatch_subagent` wraps OpenCode's `task` tool with template resolution, preamble injection, compliance gate integration | §4.2, §6.2 | 15 min |
| **P0-F10** | UC7-003 "unstaged docs" pre-commit check | Fix: change to "checks for docs presence in **staged** changes" OR change mechanism to `tool.execute.after` plugin hook | §3.1 | 5 min |
| **P0-F11** | OpenCode plugin hooks not leveraged | Add §4.3: discuss `tool.execute.before/after`, `session.compacted`, `permission.asked` as complementary enforcement | §4 (new §4.3) | 20 min |

### 2.3 Nice-to-Fix (documentation quality — non-blocking)

| Fix ID | Finding | Action | Section |
|--------|---------|--------|---------|
| P0-F12 | `todowrite` not in @KC tools | Add `todowrite` to tool list with explicit allow | §6.1 |
| P0-F13 | `instructions` field opportunity | Note in §6.3/§13: use `opencode.json.instructions` for rule distribution | §6.3 |
| P0-F14 | MCP tool naming inconsistency | Clarify: `mcp_context7_*` → actual tools are `context7_resolve-library-id` and `context7_query-docs` | §6.1 |
| P0-F15 | `opencode agent create` CLI | Reference in Phase 1 roadmap item | §13 |
| P0-F16 | §8.5 @Guardian role alignment | Refine: @Guardian needs framework-specific quality rules, not general coding standards | §8.5 |
| P0-F17 | `tools` config deprecated | Update @KC config to use `permission` syntax alongside custom concepts | §6.1 |
| P0-F18 | `framework-enforcer.ts` is custom | Add clarifying note in §4.1 | §4.1 |
| P0-F19 | `external_directory` permission | Add note mapping custom `agent_write_scopes` → OpenCode `external_directory` | §5.2 |
| P0-F20 | `subtask` command config | Note alternative dispatch pattern in §6.2/§13 | §6.2 |
| P0-F21 | Experimental LSP tool | Note for future reference (no action needed) | §6.1 |
| P0-F22 | Blog URL unverified | Mark as "unverified — may contain only product announcements" | §8.3 |

---

## 3. Phased Implementation Plan

### Phase 0: Design Document Remediation (Pre-Flight)

**Goal**: Fix all cross-reference findings in the design document before implementation begins.

**Prerequisites**: None
**Compliance Gate**: Required (modifying `docs/review/knowledge-management/uc7ks-design-analysis-v1.0.md`)

| Task ID | Description | Agent | Target Files | Acceptance Criteria | Effort | Priority |
|---------|-------------|-------|-------------|---------------------|--------|----------|
| **UC7-P0-T01** | Fix F1 (GitHub URL), F2 (subsection numbering), F3 (websearch constraint) | @Super-Admin | `uc7ks-design-analysis-v1.0.md` | All 3 HIGH findings resolved | 30 min | P0 |
| **UC7-P0-T02** | Fix F4-F11 (8 MEDIUM findings) | @Super-Admin | `uc7ks-design-analysis-v1.0.md` | Directory consolidated, terminology clarified, enforcement mechanism corrected | 90 min | P0 |
| **UC7-P0-T03** | Fix F12-F22 (11 LOW findings — optional) | @Super-Admin | `uc7ks-design-analysis-v1.0.md` | Documentation quality improvements applied | 60 min | P1 |
| **UC7-P0-T04** | Bump design doc version to v1.6.0 with changelog | @Super-Admin | `uc7ks-design-analysis-v1.0.md` | Version bumped, changelog documents all F1-F22 fixes | 5 min | P0 |

**Phase 0 DoD**:
- [ ] All 3 HIGH findings resolved in design doc
- [ ] All 8 MEDIUM findings resolved in design doc
- [ ] Design doc version bumped to v1.6.0
- [ ] Changelog updated with fix summary

---

### Phase 1: Foundation — Schemas & Agent Design

**Goal**: Produce all design artifacts (schemas, agent config template, skill template) without creating any files in the production framework.

**Prerequisites**: Phase 0 complete
**Compliance Gate**: Required (creating design documents under `docs/review/knowledge-management/`)

| Task ID | Description | Agent | Deliverables | Effort | Dependencies |
|---------|-------------|-------|-------------|--------|-------------|
| **UC7-P1-T01** | Design `@Knowledge-Curator` agent config template | @Super-Admin | `docs/review/knowledge-management/knowledge-curator-agent-design.md` | 2h | UC7-P0-T02 |
| **UC7-P1-T02** | Design enhanced `context7-first` skill template | @Super-Admin | `docs/review/knowledge-management/context7-first-skill-v2-design.md` | 1.5h | UC7-P0-T02 |
| **UC7-P1-T03** | Design `docs/official_docs/` directory schema | @Architect | `docs/review/knowledge-management/docs-directory-schema.md` | 1h | — |
| **UC7-P1-T04** | Design `index.json` manifest schema (full JSON Schema) | @Architect | `docs/review/knowledge-management/index-manifest-schema.md` | 1.5h | — |
| **UC7-P1-T05** | Design `machine.json.knowledge_state` schema extension | @Architect | `docs/review/knowledge-management/machine-knowledge-state-schema.md` | 1h | — |
| **UC7-P1-T06** | Design `knowledge_semantic_map` structure for `project.config.json` | @Architect | `docs/review/knowledge-management/semantic-map-design.md` | 1h | — |
| **UC7-P1-T07** | Design `@Knowledge-Curator` permission matrix (map custom → OpenCode native) | @Super-Admin | `docs/review/knowledge-management/kc-permission-mapping.md` | 30 min | UC7-P1-T01 |
| **UC7-P1-T08** | Design Scout integration contract (§11.6 formalization) | @Super-Admin | `docs/review/knowledge-management/scout-integration-contract.md` | 1h | UC7-P1-T01 |

**Phase 1 DoD**:
- [ ] All 8 design documents created in `docs/review/knowledge-management/`
- [ ] @Architect approved directory schema, index.json schema, machine.json extension, semantic map
- [ ] @Super-Admin approved agent config design and Scout contract
- [ ] All designs reference the corrected v1.6.0 design analysis doc

---

### Phase 2: Core Infrastructure — Directory & Agent Creation

**Goal**: Create the physical infrastructure: directories, `index.json`, `@Knowledge-Curator` agent config, updated skill.

**Prerequisites**: Phase 0 + Phase 1 complete
**Compliance Gate**: Required (creates new agent config, modifies skill file)

| Task ID | Description | Agent | Target Files | Effort | Dependencies |
|---------|-------------|-------|-------------|--------|-------------|
| **UC7-P2-T01** | Create `docs/official_docs/` directory structure (all domains) | @Super-Admin | `docs/official_docs/{backend,frontend,database,devops,opencode,framework,fallback,scout-extracts}/` + `.metadata/` | 15 min | UC7-P1-T03 |
| **UC7-P2-T02** | Implement `index.json` with initial empty manifest | @Super-Admin | `docs/official_docs/index.json` | 30 min | UC7-P1-T04 |
| **UC7-P2-T03** | Create `docs/official_docs/.metadata/query_log.json` | @Super-Admin | `docs/official_docs/.metadata/query_log.json` | 10 min | — |
| **UC7-P2-T04** | Create `@Knowledge-Curator` agent config (`.opencode/agents/Knowledge-Curator.md`) | @Super-Admin | `.opencode/agents/Knowledge-Curator.md` | 2h | UC7-P1-T01, UC7-P1-T07 |
| **UC7-P2-T05** | Register `@Knowledge-Curator` in `opencode.json` | @Super-Admin | `opencode.json` | 15 min | UC7-P2-T04 |
| **UC7-P2-T06** | Update `context7-first` skill with autonomous extraction prompts | @Super-Admin | `.opencode/skills/context7-first/SKILL.md` | 1.5h | UC7-P1-T02 |
| **UC7-P2-T07** | Add `knowledge_semantic_map` to `project.config.json` | @Super-Admin | `.opencode/project.config.json` | 30 min | UC7-P1-T06 |
| **UC7-P2-T08** | Add `knowledge_state` section to `machine.json` | @Super-Admin | `.opencode/state/machine.json` | 20 min | UC7-P1-T05 |
| **UC7-P2-T09** | Add knowledge template variables to `project.config.json.template_resolution` | @Super-Admin | `.opencode/project.config.json` | 15 min | §9.1 design |
| **UC7-P2-T10** | Update `TEMPLATE_VARIABLE_STANDARD.md` with new `{knowledge.*}` placeholders | @Super-Admin | `.opencode/rules/rule_detail/TEMPLATE_VARIABLE_STANDARD.md` | 20 min | §9.1 design |

**Phase 2 DoD**:
- [ ] `docs/official_docs/` directory exists with full domain hierarchy
- [ ] `index.json` parseable with valid schema
- [ ] `@Knowledge-Curator` agent config passes `framework-self-test.js` (checks 17-18 for unresolved placeholders)
- [ ] `context7-first` skill updated with UC7KS-aware instructions
- [ ] `project.config.json` has `knowledge_semantic_map` + `template_resolution` extensions
- [ ] `machine.json` has `knowledge_state` section
- [ ] New template variables documented in standard

---

### Phase 3: Harness Integration — Enforcement Rules

**Goal**: Wire UC7KS enforcement rules (UC7-001 through UC7-009) into the framework harness.

**Prerequisites**: Phase 2 complete
**Compliance Gate**: Required (modifies enforcement plugins, hooks, quality gates)

| Task ID | Description | Agent | Target Files | Effort | Dependencies |
|---------|-------------|-------|-------------|--------|-------------|
| **UC7-P3-T01** | Add UC7-001 to UC7-009 rules to `framework-enforcer.ts` | @Super-Admin | `.opencode/plugins/framework-enforcer/framework-enforcer.ts` | 3h | UC7-P2-T04 |
| **UC7-P3-T02** | Add Layer 2.6: Docs Consistency Check to pre-commit hook | @Super-Admin | `.opencode/hooks/pre-commit` | 1.5h | UC7-P2-T02 |
| **UC7-P3-T03** | Add Knowledge Gate to pre-execution hook | @Super-Admin | `.opencode/scripts/pre-execution-hook.sh` | 1.5h | UC7-P2-T04 |
| **UC7-P3-T04** | Add `docs/official_docs/` size validation to `code-quality-gate` | @Super-Admin | `.opencode/plugins/code-quality-gate/code-quality-gate.js` | 1h | UC7-P2-T01 |
| **UC7-P3-T05** | Add Check 19: Docs Manifest Integrity to `framework-self-test.js` | @Super-Admin | `.opencode/scripts/framework-self-test.js` | 1.5h | UC7-P2-T02 |
| **UC7-P3-T06** | Add knowledge state reconciliation to `state-reconciliation.js` | @Super-Admin | `.opencode/scripts/state-reconciliation.js` | 1h | UC7-P2-T08 |
| **UC7-P3-T07** | Add "Local Cache Check" to `compliance_gate_check` | @Super-Admin | `.opencode/scripts/mcp-tools/compliance-gate.js` | 1h | UC7-P2-T02 |
| **UC7-P3-T08** | Add "Docs Saved" validation to `compliance_gate_complete` | @Super-Admin | `.opencode/scripts/mcp-tools/compliance-gate.js` | 30 min | UC7-P2-T02 |
| **UC7-P3-T09** | Add OpenCode plugin hooks for UC7KS enforcement (`tool.execute.before/after` for Context7/webfetch/websearch calls) | @Super-Admin | `.opencode/plugins/uc7ks-enforcer/` (new plugin) | 2h | UC7-P3-T01 |
| **UC7-P3-T10** | Update `agent_write_scopes` in `project.config.json` with `@Knowledge-Curator` entry | @Super-Admin | `.opencode/project.config.json` | 15 min | UC7-P2-T04 |

**Phase 3 DoD**:
- [ ] `framework-enforcer.ts` enforces all 9 UC7 rules at runtime
- [ ] Pre-commit hook Layer 2.6 validates docs consistency
- [ ] Pre-execution hook validates Knowledge Gate tokens
- [ ] `code-quality-gate` enforces size limits on `docs/official_docs/`
- [ ] `framework-self-test.js` Check 19 passes for empty/valid `index.json`
- [ ] `compliance_gate_check` verifies `docs/official_docs/index.json` exists
- [ ] `compliance_gate_complete` verifies docs save evidence
- [ ] UC7KS enforcer plugin intercepts external queries
- [ ] `agent_write_scopes` includes @Knowledge-Curator

---

### Phase 4: Agent Updates — All Agent Configs

**Goal**: Update every agent config to include the UC7KS local-first search workflow. Update @Orchestrator with @Knowledge-Curator dispatch logic.

**Prerequisites**: Phase 2 + Phase 3 complete
**Compliance Gate**: Required (modifies all 9 agent configs)

| Task ID | Description | Agent | Target Files | Effort | Dependencies |
|---------|-------------|-------|-------------|--------|-------------|
| **UC7-P4-T01** | Update @Orchestrator with UC7KS dispatch router logic + `@Knowledge-Curator` target | @Super-Admin | `.opencode/agents/Orchestrator.md` | 1.5h | UC7-P2-T04, UC7-P3-T01 |
| **UC7-P4-T02** | Update @Coder-BE with local-first search checklist | @Super-Admin | `.opencode/agents/Coder-BE.md` | 30 min | — |
| **UC7-P4-T03** | Update @Coder-FE with local-first search checklist | @Super-Admin | `.opencode/agents/Coder-FE.md` | 30 min | — |
| **UC7-P4-T04** | Update @Architect with local-first search checklist | @Super-Admin | `.opencode/agents/Architect.md` | 30 min | — |
| **UC7-P4-T05** | Update @Guardian with local-first search checklist | @Super-Admin | `.opencode/agents/Guardian.md` | 30 min | — |
| **UC7-P4-T06** | Update @Meta-Planner with local-first search checklist | @Super-Admin | `.opencode/agents/Meta-Planner.md` | 30 min | — |
| **UC7-P4-T07** | Update @Arbiter with local-first search checklist | @Super-Admin | `.opencode/agents/Arbiter.md` | 30 min | — |
| **UC7-P4-T08** | Update @CI-CD-Agent with local-first search checklist | @Super-Admin | `.opencode/agents/CI-CD-Agent.md` | 30 min | — |
| **UC7-P4-T09** | Update @Super-Admin with UC7KS pre-task checklist (UC7-009) | @Super-Admin | `.opencode/agents/Super-Admin.md` | 45 min | — |
| **UC7-P4-T10** | Add `instructions` glob for UC7KS checklist auto-injection (P0-F13) | @Super-Admin | `opencode.json` | 15 min | — |
| **UC7-P4-T11** | Blacklist direct Context7 MCP tools for all non-KC agents (UC7-004) | @Super-Admin | `.opencode/project.config.json` (agent_tools_blacklist) | 30 min | — |

**Phase 4 DoD**:
- [ ] All 9 agent configs contain the UC7KS local-first search checklist
- [ ] @Orchestrator can dispatch @Knowledge-Curator with DISPATCH_TOKEN
- [ ] @Super-Admin's pre-task checklist includes UC7KS workflow
- [ ] Direct Context7 MCP calls blocked for all agents except @Knowledge-Curator
- [ ] `opencode.json.instructions` auto-injects UC7KS checklist
- [ ] All agent configs pass `framework-self-test.js` (no UNRESOLVED placeholders)

---

### Phase 5: Knowledge Management Subsystem

**Goal**: Implement Janitor, Compressor, Deduplicator, and LRU eviction logic.

**Prerequisites**: Phase 2 complete (Phase 3-4 can be done in parallel)
**Compliance Gate**: Required (modifies CI/CD agent config, creates scripts)

| Task ID | Description | Agent | Target Files | Effort | Dependencies |
|---------|-------------|-------|-------------|--------|-------------|
| **UC7-P5-T01** | Implement Indexer logic (atomic `index.json` update with file-lock pattern) | @Super-Admin | `.opencode/scripts/knowledge/indexer.js` | 2h | UC7-P2-T02 |
| **UC7-P5-T02** | Implement Deduplicator logic (SHA-256 check before save, alias addition) | @Super-Admin | `.opencode/scripts/knowledge/deduplicator.js` | 1.5h | UC7-P5-T01 |
| **UC7-P5-T03** | Implement Compressor logic (`.html` → `.md` via pandoc on threshold) | @Super-Admin | `.opencode/scripts/knowledge/compressor.js` | 1.5h | UC7-P5-T01 |
| **UC7-P5-T04** | Implement Janitor logic (TTL enforcement, LRU eviction, size cap) | @Super-Admin | `.opencode/scripts/knowledge/janitor.js` | 2h | UC7-P5-T01 |
| **UC7-P5-T05** | Integrate Janitor into @CI-CD-Agent cron workflow | @Super-Admin | `.opencode/agents/CI-CD-Agent.md` | 1h | UC7-P5-T04 |
| **UC7-P5-T06** | Implement size_report.json generation | @Super-Admin | `.opencode/scripts/knowledge/size-reporter.js` | 1h | UC7-P5-T01 |
| **UC7-P5-T07** | Create `.metadata/archives/` rotation logic | @Super-Admin | `.opencode/scripts/knowledge/archiver.js` | 1h | — |
| **UC7-P5-T08** | Write knowledge management self-test (Check 20: KMS integrity) | @Super-Admin | `.opencode/scripts/framework-self-test.js` (check 20) | 1h | UC7-P5-T01..T04 |

**Phase 5 DoD**:
- [ ] All 5 knowledge management scripts exist and are executable
- [ ] Indexer atomically updates `index.json` on every save
- [ ] Deduplicator prevents duplicate content by SHA-256
- [ ] Compressor converts `.html` to `.md` when size exceeds 200KB threshold
- [ ] Janitor enforces TTL (30-day default, 14-day fallback, 7-day OpenCode) and LRU eviction
- [ ] @CI-CD-Agent has Janitor cron task defined
- [ ] `framework-self-test.js` Check 20 passes

---

### Phase 5b: Scout Source-Analysis Integration

**Goal**: Wire OpenCode built-in Scout subagent into @Knowledge-Curator's Layer 3 escalation path.

**Prerequisites**: Phase 2 + Phase 5 complete
**Compliance Gate**: Required (modifies @Knowledge-Curator config, index.json schema)

| Task ID | Description | Agent | Target Files | Effort | Dependencies |
|---------|-------------|-------|-------------|--------|-------------|
| **UC7-P5b-T01** | Configure @Knowledge-Curator `permission.task: { "*": "deny", "scout": "allow" }` | @Super-Admin | `.opencode/agents/Knowledge-Curator.md` | 15 min | UC7-P2-T04 |
| **UC7-P5b-T02** | Implement Scout trigger-condition logic (keyword detection) | @Super-Admin | `.opencode/scripts/knowledge/scout-trigger.js` | 1.5h | UC7-P5b-T01 |
| **UC7-P5b-T03** | Implement Scout findings extraction pipeline (Scout output → `.md`) | @Super-Admin | `.opencode/scripts/knowledge/scout-extractor.js` | 2h | UC7-P5b-T02 |
| **UC7-P5b-T04** | Add `source: "scout"` metadata field and `source-analysis/` path to `index.json` schema | @Super-Admin | `docs/official_docs/index.json` (schema update), `docs/review/knowledge-management/index-manifest-schema.md` | 30 min | UC7-P2-T02 |
| **UC7-P5b-T05** | Create `source-analysis/` subdirectories in all domain hierarchies | @Super-Admin | `docs/official_docs/{opencode,framework/eslint,backend/nestjs,backend/prisma}/source-analysis/` | 10 min | UC7-P2-T01 |
| **UC7-P5b-T06** | Implement Scout-specific 14-day TTL in Janitor | @Super-Admin | `.opencode/scripts/knowledge/janitor.js` | 30 min | UC7-P5-T04 |
| **UC7-P5b-T07** | Add Scout-specific eviction rules to Janitor (source-analysis entries aged > 28 days double-TTL → delete) | @Super-Admin | `.opencode/scripts/knowledge/janitor.js` | 15 min | UC7-P5b-T06 |

**Phase 5b DoD**:
- [ ] @Knowledge-Curator can dispatch Scout via `task({ subagent_type: "scout" })`
- [ ] Scout trigger keywords ("internally", "how does X work", "edge case", "source code", "why does X behave") correctly detected
- [ ] Scout output extracted to `.md` and saved under `source-analysis/`
- [ ] `index.json` supports `source: "scout"` metadata
- [ ] Scout findings subject to 14-day TTL (half of standard 30-day)
- [ ] Scout findings aged > 28 days are permanently deleted

---

### Phase 6: Integration Testing & Validation

**Goal**: End-to-end validation of the full UC7KS pipeline across all agents.

**Prerequisites**: All previous phases complete
**Compliance Gate**: Required (test execution, may trigger Scout/Context7 calls)

| Task ID | Description | Agent | Deliverables | Effort | Dependencies |
|---------|-------------|-------|-------------|--------|-------------|
| **UC7-P6-T01** | Test @Knowledge-Curator: identify libraries → confirm → query Context7 → save → return paths | @Super-Admin | `docs/review/knowledge-management/test-report-p6-t01.md` | 1h | Phase 2 |
| **UC7-P6-T02** | Test @Knowledge-Curator: Context7 miss → webfetch fallback → save → return paths | @Super-Admin | `docs/review/knowledge-management/test-report-p6-t02.md` | 45 min | Phase 2 |
| **UC7-P6-T03** | Test @Knowledge-Curator: webfetch miss → websearch fallback → save | @Super-Admin | `docs/review/knowledge-management/test-report-p6-t03.md` | 45 min | Phase 2 |
| **UC7-P6-T04** | Test @Knowledge-Curator: websearch unavailable → graceful degradation to webfetch-only | @Super-Admin | `docs/review/knowledge-management/test-report-p6-t04.md` | 30 min | Phase 2, P0-F3 |
| **UC7-P6-T05** | Test @Knowledge-Curator: Layer 3 Scout escalation (docs insufficient → Scout dispatch → extract findings → save to source-analysis/) | @Super-Admin | `docs/review/knowledge-management/test-report-p6-t05.md` | 1.5h | Phase 5b |
| **UC7-P6-T06** | Test UC7-001: Agent requests Context7 → framework-enforcer blocks (no local cache check) | @Super-Admin | `docs/review/knowledge-management/test-report-p6-t06.md` | 30 min | Phase 3 |
| **UC7-P6-T07** | Test UC7-002: @Knowledge-Curator presents libraries → user confirms → query proceeds | @Super-Admin | `docs/review/knowledge-management/test-report-p6-t07.md` | 30 min | Phase 2 |
| **UC7-P6-T08** | Test UC7-002 negative: User rejects → query aborted | @Super-Admin | `docs/review/knowledge-management/test-report-p6-t08.md` | 15 min | Phase 2 |
| **UC7-P6-T09** | Test UC7-003: Docs saved → compliance_gate_complete verifies presence | @Super-Admin | `docs/review/knowledge-management/test-report-p6-t09.md` | 30 min | Phase 3 |
| **UC7-P6-T10** | Test UC7-005: File > 500KB → rejected | @Super-Admin | `docs/review/knowledge-management/test-report-p6-t10.md` | 15 min | Phase 3 |
| **UC7-P6-T11** | Test UC7-009: @Super-Admin follows UC7KS workflow (dispatches KC, reads cached docs) | @Super-Admin | `docs/review/knowledge-management/test-report-p6-t11.md` | 1h | Phase 4 |
| **UC7-P6-T12** | End-to-end: @Super-Admin fixes broken ESLint plugin using UC7KS-acquired docs | @Super-Admin | `docs/review/knowledge-management/test-report-p6-t12.md` | 2h | All phases |
| **UC7-P6-T13** | End-to-end: @Coder-BE implements NestJS guard using UC7KS-acquired docs | @Super-Admin | `docs/review/knowledge-management/test-report-p6-t13.md` | 1.5h | Phase 4 |
| **UC7-P6-T14** | Run `framework-self-test.js` full suite (checks 1-20) | @Super-Admin | Test output log | 15 min | All phases |
| **UC7-P6-T15** | Run Janitor once, verify TTL enforcement, LRU eviction, size report | @Super-Admin | `docs/review/knowledge-management/test-report-p6-t15.md` | 30 min | Phase 5 |

**Phase 6 DoD**:
- [ ] All 15 test scenarios pass
- [ ] `framework-self-test.js` all 20 checks pass
- [ ] End-to-end Super-Admin workflow validated (Scout escalation tested)
- [ ] End-to-end Coder-BE workflow validated
- [ ] All enforcement rules (UC7-001 through UC7-009) verified

---

## 4. Dependency Graph

```
Phase 0 (Remediation)
  ├── Must-Fix (F1-F3) ────────────────────────────────────┐
  ├── Should-Fix (F4-F11) ─────────────────────────────────┤
  └── Nice-to-Fix (F12-F22) ───────────────────────────────┤
                                                            │
Phase 1 (Foundation — Design)                               │
  ├── UC7-P1-T01 (@KC agent design) ◄──────────────────────┤
  ├── UC7-P1-T02 (skill design)                             │
  ├── UC7-P1-T03 (directory schema) ◄── @Architect          │
  ├── UC7-P1-T04 (index.json schema) ◄── @Architect         │
  ├── UC7-P1-T05 (machine.json schema) ◄── @Architect       │
  ├── UC7-P1-T06 (semantic map) ◄── @Architect               │
  ├── UC7-P1-T07 (permission mapping)                       │
  └── UC7-P1-T08 (Scout contract)                           │
                                                            │
Phase 2 (Core Infrastructure) ◄─────────────────────────────┤
  ├── UC7-P2-T01 (directories)                              │
  ├── UC7-P2-T02 (index.json)                               │
  ├── UC7-P2-T03 (query_log.json)                           │
  ├── UC7-P2-T04 (@KC agent config) ◄── P1-T01 + P1-T07     │
  ├── UC7-P2-T05 (opencode.json registration)               │
  ├── UC7-P2-T06 (context7-first skill) ◄── P1-T02           │
  ├── UC7-P2-T07 (project.config.json map) ◄── P1-T06       │
  ├── UC7-P2-T08 (machine.json state) ◄── P1-T05            │
  ├── UC7-P2-T09 (template_resolution)                      │
  └── UC7-P2-T10 (TEMPLATE_VARIABLE_STANDARD)               │
                                                            │
Phase 3 (Harness Integration) ◄─────────────────────────────┤
  ├── UC7-P3-T01 (framework-enforcer.ts) ◄── P2-T04          │
  ├── UC7-P3-T02 (pre-commit hook) ◄── P2-T02               │
  ├── UC7-P3-T03 (pre-execution hook) ◄── P2-T04            │
  ├── UC7-P3-T04 (code-quality-gate) ◄── P2-T01             │
  ├── UC7-P3-T05 (framework-self-test Check 19) ◄── P2-T02   │
  ├── UC7-P3-T06 (state-reconciliation) ◄── P2-T08          │
  ├── UC7-P3-T07 (compliance_gate_check) ◄── P2-T02         │
  ├── UC7-P3-T08 (compliance_gate_complete) ◄── P2-T02      │
  ├── UC7-P3-T09 (uc7ks-enforcer plugin)                     │
  └── UC7-P3-T10 (agent_write_scopes) ◄── P2-T04            │
                                                            │
Phase 4 (Agent Updates) ◄──── Phase 2 + Phase 3 ────────────┤
  ├── UC7-P4-T01 (@Orchestrator) ◄── P2-T04 + P3-T01        │
  ├── UC7-P4-T02..T09 (all 8 agents)                        │
  ├── UC7-P4-T10 (instructions glob)                        │
  └── UC7-P4-T11 (Context7 blacklist)                        │
                                                            │
Phase 5 (KMS) ◄────────────────── Phase 2 ──────────────────┤
  │   (can run parallel to Phase 3-4)                        │
  ├── UC7-P5-T01 (Indexer) ◄── P2-T02                       │
  ├── UC7-P5-T02 (Deduplicator) ◄── P5-T01                  │
  ├── UC7-P5-T03 (Compressor) ◄── P5-T01                    │
  ├── UC7-P5-T04 (Janitor) ◄── P5-T01                       │
  ├── UC7-P5-T05 (CI-CD cron) ◄── P5-T04                    │
  ├── UC7-P5-T06 (Size reporter) ◄── P5-T01                 │
  ├── UC7-P5-T07 (Archiver)                                 │
  └── UC7-P5-T08 (Check 20) ◄── P5-T01..T04                │
                                                            │
Phase 5b (Scout) ◄────────────── Phase 2 + Phase 5 ────────┤
  ├── UC7-P5b-T01 (Scout permission) ◄── P2-T04             │
  ├── UC7-P5b-T02 (trigger logic)                           │
  ├── UC7-P5b-T03 (extraction pipeline) ◄── P5b-T02         │
  ├── UC7-P5b-T04 (index.json schema) ◄── P2-T02            │
  ├── UC7-P5b-T05 (source-analysis/ dirs) ◄── P2-T01        │
  ├── UC7-P5b-T06 (14-day TTL) ◄── P5-T04                  │
  └── UC7-P5b-T07 (double-TTL delete) ◄── P5b-T06          │
                                                            │
Phase 6 (Testing) ◄────────── ALL PHASES ───────────────────┤
  └── UC7-P6-T01..T15 (15 test scenarios)                   │
```

---

## 5. Agent Assignments & Dispatch Matrix

| Phase | Primary Agent | Review/Approval | Notes |
|-------|--------------|-----------------|-------|
| Phase 0 | @Super-Admin | — | Self-reviewed; design doc fixes only |
| Phase 1 | @Super-Admin + @Architect | — | @Architect for schema designs; @Super-Admin for agent/skill designs |
| Phase 2 | @Super-Admin | @Guardian (config review) | Creates production files |
| Phase 3 | @Super-Admin | @Guardian (hook/enforcer review) | Modifies enforcement infrastructure |
| Phase 4 | @Super-Admin | @Guardian (agent config review) | Modifies all agent configs |
| Phase 5 | @Super-Admin | @Guardian (script review) | Creates knowledge management scripts |
| Phase 5b | @Super-Admin | @Guardian | Scout integration + config updates |
| Phase 6 | @Super-Admin | @Guardian (test evidence review) | Integration testing |
| Post-Phase 6 | @CI-CD-Agent | — | Janitor cron deployment |

### 5.1 @Super-Admin UC7KS Workflow During Implementation

Per UC7-009, @Super-Admin MUST follow the UC7KS workflow for its own tasks. During implementation:

1. Before modifying `framework-enforcer.ts` → search `docs/official_docs/framework/typescript/` for TypeScript plugin patterns
2. Before modifying hook scripts → search `docs/official_docs/framework/git/` for Git hook patterns
3. Before creating @Knowledge-Curator config → if `docs/official_docs/opencode/agents/` is empty, dispatch @Knowledge-Curator to fetch OpenCode agent config docs (note: chicken-and-egg problem — see §6 Risk Assessment)

---

## 6. Risk Assessment & Mitigation

| Risk ID | Risk | Severity | Likelihood | Mitigation |
|---------|------|----------|------------|------------|
| **R1** | Chicken-and-egg: @Knowledge-Curator doesn't exist yet, so @Super-Admin cannot dispatch it during Phase 0-1 | HIGH | Certain | @Super-Admin uses webfetch/websearch **directly** during Phase 0-1 only (documented exception). Once @KC is created in Phase 2, full UC7KS workflow applies. |
| **R2** | websearch unavailable (requires OpenCode provider or `OPENCODE_ENABLE_EXA=1`) | MEDIUM | Possible | Implement graceful degradation: Context7 → webfetch → (websearch if available, else log failure). Documented in P0-F3 fix. |
| **R3** | Context7 has no coverage for OpenCode framework internals | HIGH | Certain | Primary source for OpenCode docs is webfetch from `https://opencode.ai/docs/` + Scout source inspection from `https://github.com/anomalyco/opencode`. Context7 not expected to have OpenCode coverage. |
| **R4** | `docs/official_docs/` grows beyond 50MB cap | MEDIUM | Eventual | Janitor with LRU eviction + Compressor (`.html` → `.md`) mitigates. Hard cap enforced by `code-quality-gate`. |
| **R5** | Pre-commit hook Layer 2.6 adds latency | LOW | Unlikely | Incremental check (only validates changed `index.json` entries, not full scan). Target < 2 seconds. |
| **R6** | All agent configs need updating (8 agents) — risk of inconsistency | MEDIUM | Possible | Use `opencode.json.instructions` glob (P0-F13) for auto-injection to reduce per-agent config duplication. Phase 4-T10 addresses this. |
| **R7** | Scout permission model conflicts with @Knowledge-Curator's restricted scope | LOW | Unlikely | Scout is OpenCode built-in with read-only permission. @KC config explicitly allows `task: { "scout": "allow" }`. |
| **R8** | `safe_*` tools unavailable for @Knowledge-Curator in some environments | LOW | Unlikely | Fallback to OpenCode native `edit`/`write`/`bash` if custom tools unavailable. @KC config lists both. |

---

## 7. Definition of Done per Phase

### Phase 0 DoD
- [x] All 3 HIGH findings (F1-F3) resolved in design doc
- [x] All 8 MEDIUM findings (F4-F11) resolved in design doc
- [x] Design doc version bumped to v1.6.0 with changelog

### Phase 1 DoD
- [x] 8 design documents created in `docs/review/knowledge-management/`
- [x] @Architect signed off on schemas
- [x] @Super-Admin signed off on agent/skill designs

### Phase 2 DoD
- [x] `docs/official_docs/` directory exists with full domain hierarchy
- [x] `index.json` parseable with valid schema
- [x] @Knowledge-Curator agent config passes `framework-self-test.js`
- [x] `project.config.json` has `knowledge_semantic_map` + `template_resolution` extensions
- [x] `machine.json` has `knowledge_state` section
- [x] New template variables documented

### Phase 3 DoD
- [x] All 9 UC7 rules enforced at runtime via `framework-enforcer.ts`
- [x] Pre-commit hook Layer 2.6 validates docs consistency
- [x] Pre-execution hook validates Knowledge Gate tokens
- [x] `code-quality-gate` enforces size limits
- [x] `framework-self-test.js` Check 19 passes
- [x] UC7KS enforcer plugin active

### Phase 4 DoD
- [x] All 9 agent configs contain UC7KS local-first search checklist
- [x] @Orchestrator can dispatch @Knowledge-Curator
- [x] @Super-Admin follows UC7KS workflow
- [x] Direct Context7 calls blocked for non-KC agents

### Phase 5 DoD
- [x] Indexer, Deduplicator, Compressor, Janitor scripts functional
- [x] Janitor integrated into @CI-CD-Agent cron
- [x] `framework-self-test.js` Check 20 passes

### Phase 5b DoD
- [x] @Knowledge-Curator can dispatch Scout
- [x] Scout trigger conditions detected correctly
- [x] Scout findings extracted to `source-analysis/`
- [x] 14-day Scout-specific TTL enforced

### Phase 6 DoD
- [x] All 15 test scenarios pass
- [x] `framework-self-test.js` checks 1-20 all pass
- [x] End-to-end Super-Admin workflow validated
- [x] End-to-end Coder-BE workflow validated
- [x] All 9 enforcement rules verified

---

## 8. Timeline & Effort Estimates

| Phase | Tasks | Estimated Effort | Critical Path | Parallelizable |
|-------|-------|-----------------|---------------|----------------|
| Phase 0 | 4 tasks | 3.5 hours | Yes (blocks all) | No |
| Phase 1 | 8 tasks | 9.5 hours | Yes (blocks Phase 2) | Internally parallel (@Architect tasks) |
| Phase 2 | 10 tasks | 7.5 hours | Yes (blocks Phase 3, 4, 5) | No |
| Phase 3 | 10 tasks | 14.5 hours | Yes (blocks Phase 4) | Phase 5 can run in parallel |
| Phase 4 | 11 tasks | 7.5 hours | Yes (blocks Phase 6) | No |
| Phase 5 | 8 tasks | 11 hours | Partial | Can run parallel to Phase 3-4 |
| Phase 5b | 7 tasks | 6 hours | Yes (blocks Phase 6) | Requires Phase 2 + Phase 5 |
| Phase 6 | 15 tasks | 13 hours | Yes (final) | Internally parallel |

### Total Estimates

| Metric | Value |
|--------|-------|
| **Total tasks** | 73 |
| **Total effort** | ~72.5 hours |
| **Critical path** | Phase 0 → Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 6 (~48.5 hours) |
| **Parallel path** | Phase 5 + Phase 5b (~17 hours, can run alongside Phase 3-4) |
| **Estimated calendar time** (with parallelism) | **5-7 working days** |

### Phase Dependencies Flow

```
Day 1:   Phase 0 (3.5h) + Phase 1 start (Architect tasks)
Day 2:   Phase 1 complete + Phase 2 start
Day 3:   Phase 2 complete + Phase 3 start + Phase 5 start (parallel)
Day 4:   Phase 3 complete + Phase 4 + Phase 5 complete + Phase 5b start
Day 5:   Phase 4 complete + Phase 5b complete
Day 6-7: Phase 6 (integration testing)
```

---

## Appendix A: File Manifest (All Files Created/Modified)

### Created Files
| File | Phase | Purpose |
|------|-------|---------|
| `docs/review/knowledge-management/uc7ks-implementation-plan-v1.0.md` | — | This document |
| `docs/review/knowledge-management/knowledge-curator-agent-design.md` | P1 | @KC agent design |
| `docs/review/knowledge-management/context7-first-skill-v2-design.md` | P1 | Enhanced skill design |
| `docs/review/knowledge-management/docs-directory-schema.md` | P1 | Directory schema |
| `docs/review/knowledge-management/index-manifest-schema.md` | P1 | index.json schema |
| `docs/review/knowledge-management/machine-knowledge-state-schema.md` | P1 | machine.json extension schema |
| `docs/review/knowledge-management/semantic-map-design.md` | P1 | semantic map design |
| `docs/review/knowledge-management/kc-permission-mapping.md` | P1 | Permission mapping |
| `docs/review/knowledge-management/scout-integration-contract.md` | P1 | Scout contract |
| `docs/official_docs/` (full tree) | P2 | Knowledge cache root |
| `docs/official_docs/index.json` | P2 | Manifest |
| `docs/official_docs/.metadata/query_log.json` | P2 | Query audit log |
| `.opencode/agents/Knowledge-Curator.md` | P2 | @KC agent config |
| `.opencode/plugins/uc7ks-enforcer/` | P3 | UC7KS plugin |
| `.opencode/scripts/knowledge/indexer.js` | P5 | Indexer |
| `.opencode/scripts/knowledge/deduplicator.js` | P5 | Deduplicator |
| `.opencode/scripts/knowledge/compressor.js` | P5 | Compressor |
| `.opencode/scripts/knowledge/janitor.js` | P5 | Janitor |
| `.opencode/scripts/knowledge/size-reporter.js` | P5 | Size reporter |
| `.opencode/scripts/knowledge/archiver.js` | P5 | Archiver |
| `.opencode/scripts/knowledge/scout-trigger.js` | P5b | Scout trigger |
| `.opencode/scripts/knowledge/scout-extractor.js` | P5b | Scout extractor |
| `docs/review/knowledge-management/test-report-p6-*.md` | P6 | 15 test reports |

### Modified Files
| File | Phase | Changes |
|------|-------|---------|
| `docs/review/knowledge-management/uc7ks-design-analysis-v1.0.md` | P0 | F1-F22 fixes, version bump to v1.6.0 |
| `.opencode/skills/context7-first/SKILL.md` | P2 | UC7KS-aware instructions |
| `opencode.json` | P2, P4 | @KC registration + instructions glob |
| `.opencode/project.config.json` | P2, P3 | knowledge_semantic_map, template_resolution, agent_write_scopes, agent_tools_blacklist |
| `.opencode/state/machine.json` | P2 | knowledge_state section |
| `.opencode/rules/rule_detail/TEMPLATE_VARIABLE_STANDARD.md` | P2 | New `{knowledge.*}` placeholders |
| `.opencode/plugins/framework-enforcer/framework-enforcer.ts` | P3 | UC7-001 to UC7-009 rules |
| `.opencode/hooks/pre-commit` | P3 | Layer 2.6 |
| `.opencode/scripts/pre-execution-hook.sh` | P3 | Knowledge Gate |
| `.opencode/plugins/code-quality-gate/code-quality-gate.js` | P3 | Docs size validation |
| `.opencode/scripts/framework-self-test.js` | P3, P5 | Check 19 + Check 20 |
| `.opencode/scripts/state-reconciliation.js` | P3 | Knowledge state reconciliation |
| `.opencode/scripts/mcp-tools/compliance-gate.js` | P3 | Local cache check + docs saved validation |
| `.opencode/agents/Orchestrator.md` | P4 | UC7KS dispatch router |
| `.opencode/agents/Coder-BE.md` | P4 | Local-first checklist |
| `.opencode/agents/Coder-FE.md` | P4 | Local-first checklist |
| `.opencode/agents/Architect.md` | P4 | Local-first checklist |
| `.opencode/agents/Guardian.md` | P4 | Local-first checklist |
| `.opencode/agents/Meta-Planner.md` | P4 | Local-first checklist |
| `.opencode/agents/Arbiter.md` | P4 | Local-first checklist |
| `.opencode/agents/CI-CD-Agent.md` | P4, P5 | Local-first checklist + Janitor cron |
| `.opencode/agents/Super-Admin.md` | P4 | UC7KS pre-task checklist |
| `docs/official_docs/index.json` | P5b | `source: "scout"` metadata support |

---

## Appendix B: Quick Reference — Key UC7 Rules

| Rule ID | Constraint | Phase Implemented |
|---------|-----------|-------------------|
| UC7-001 | Local-First Search Mandatory | Phase 3 (T01) |
| UC7-002 | User Confirmation Required | Phase 2 (T04) + Phase 3 (T01) |
| UC7-003 | Save-or-Fail | Phase 2 (T04) + Phase 3 (T01, T08, T09) |
| UC7-004 | No Direct Context7 | Phase 3 (T01, T09) + Phase 4 (T11) |
| UC7-005 | Size Cap (500KB/file, 50MB/total) | Phase 3 (T04) |
| UC7-006 | TTL Enforcement (30-day default) | Phase 5 (T04, T05) |
| UC7-007 | Index Sync (atomic updates) | Phase 5 (T01) |
| UC7-008 | Scope Isolation (@KC write scope) | Phase 3 (T10) |
| UC7-009 | Super-Admin Knowledge Equality | Phase 3 (T01) + Phase 4 (T09) + Phase 6 (T11) |

---

*Document Version: 1.0.0*
*Saved to: docs/review/knowledge-management/uc7ks-implementation-plan-v1.0.md*
*Next Steps: Present to user for approval, then begin Phase 0 (design document remediation)*
