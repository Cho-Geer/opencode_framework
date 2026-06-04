# Agent Permission Architecture

**Version**: 1.1.0
**Date**: 2026-06-02
**Author**: @Architect (permission scope-down per Architect Permission Scope-Down Plan v1.0.0)

## Overview

This document describes the permission architecture for all agents in the OpenCode multi-agent system. It defines what each agent is allowed to write, delete, create, and execute at the framework enforcement level.

## Permission Matrix

| Agent | Read | Shell | Write Scope |
|-------|------|-------|-------------|
| @Meta-Planner | 只读 + Context7 | read-only | safe_edit: Task.DAG.json + Project.graph + .task_temp/ |
| @Orchestrator | Task.DAG.json + agent configs | denied | read-only dispatch only |
| @Architect | 只读 + GitHub + Context7 | safe_edit: contract.yaml + context/ + machine.json + docs/ + .task_temp/ ; 源码/框架基础设施 deny |
| @Coder-BE | backend src + test + prisma | node/npm/npx | safe_edit: booking-backend src/test/prisma; 框架 deny |
| @Coder-FE | frontend src | node/npm/npx | safe_edit: booking-frontend; 框架 deny |
| @Guardian | 全项目 review | read-only grep/find/ls | safe_edit: .task_temp/ only; 源码/框架 deny |
| @Arbiter | 裁决相关 | read-only | safe_edit: WAIVE.md + TECH_DEBT_REGISTRY.md + .task_temp/ |
| @CI-CD-Agent | CI/CD + infra | full shell | safe_edit: docker-compose, GitHub Actions, Dockerfile, .env, prisma |
| @Super-Admin | 全框架 | full shell (ask) | safe_edit: .opencode/**, opencode.json, AGENTS.md, PROJECT_REFERENCE.md, contract.yaml, Task.DAG.json |

## Enforcement Layers

1. **opencode.json** — Runtime permission enforcement (safe_edit, safe_shell, safe_delete, safe_mkdir)
2. **project.config.json** — agent_write_scopes logical enforcement
3. **framework-enforcer.ts** — Physical enforcement plugin (in-process intercept)
4. **Pre-commit hook** — Git hook validation (keystone hashes, TDD order, gate armed)

## Architect Scope-Down (2026-06-02)

Architect's permissions were reduced from full `.opencode/**` framework access to five inner-project paths:
- `contract.yaml` — interface contract (primary deliverable)
- `.opencode/state/machine.json` — keystone hash updates
- `.opencode/context/**` — specifications, standards, requirements, detailed designs
- `.task_temp/**` — task artifacts
- `docs/**` — architecture design output

All framework infrastructure (agents/, rules/, scripts/, plugins/, subagent-preamble.md, project.config.json, opencode.json) is now administered exclusively by @Super-Admin, which is P0 human-trigger-only.

## Change Log

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.1.0 | 2026-06-02 | @Architect | Architect permission scope-down: reduced from .opencode/** to 5 inner-project paths; framework maintenance moved to @Super-Admin |
| 1.0.0 | (previous) | @Architect | Initial architecture documenting Architect as framework custodian |
