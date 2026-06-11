---
trigger: always_on
alwaysApply: true
---

---

## 🔒 P0 PROTOCOL — MANDATORY PREEXECUTION SEQUENCE

> **Enforcement note**: Steps 0 (Knowledge Pipeline), 2 (Compliance Gate), and 4 (Close Gate)
> are **physically enforced by TypeScript plugins** (`uc7ks-before.ts`, `gate-before.ts`,
> `compliance_gate_complete` MCP tool). The text below is procedural guidance for steps
> that have **no plugin enforcement**.

### Step 0: Knowledge Pipeline — P0 Mandatory (plugin-enforced with hard constraints)

> **UC7-001c HARDEN** (2026-06-11): Three evidence fields are REQUIRED for valid
> sufficiency determination. Any of `reason`, `files_read`, or `content_summary`
> missing or empty → treated as `"insufficient"` across all enforcement layers.

**0a.** Call `module_scope_declare(module, task_id)` to declare your target knowledge domain. Use the same `task_id` across all pipeline calls.

**0b.** Call `knowledge_cache_search(domain, task_id)`. The tool will:
- Search `docs/official_docs/index.json` for entries matching your domain
- Auto-fill `cache_sufficiency.reason` (why sufficient/insufficient)
- Auto-fill `cache_sufficiency.files_read` (which cache files were matched)
- Auto-fill `cache_sufficiency.content_summary` (brief summary of findings)
- Return `cache_sufficiency.status` and `next_step` guidance

**0c.** Check the result:
- `status === "sufficient"` → proceed to Step 1
- `status === "insufficient"` → declare what is missing, request @Orchestrator dispatch @Knowledge-Curator, wait for KC to complete, re-search cache

**Enforcement**: `uc7ks-before.ts` blocks external queries when cache is available but agent has not satisfied UC7-001. `compliance-gate.ts` and `pre-execution-hook.sh` Stage 4 reject tasks with incomplete sufficiency evidence.

### Step 1: Invoke skills (P0 mandatory — no plugin enforcement)

Invoke all skills listed in your agent config in order. P0 skills (`execution-preflight-check`, `context7-first`) MUST be called first.

### Step 2: Execute

Proceed with task. Write-time quality checks (type/lint/deps/format/scope) run automatically after each file change. Fix violations immediately.

### Domain Reference (knowledge_semantic_map)

| Domain | Scope |
|--------|-------|
| `backend_api` | API controllers, endpoints, DTOs, middleware |
| `persistence` | Database ORM, schema, migrations, models |
| `frontend_ui` | Components, state management, styling, routing |
| `caching` | Cache engine, cache patterns, TTL management |
| `queue` | Job queues, workers, message scheduling |
| `testing` | Test frameworks, integration testing, coverage |
| `auth_security` | Authentication, authorization, security guards |
| `framework_tools` | Static analysis, formatting, type systems |
| `devops_ci` | Containerization, CI/CD platforms, pipelines |
| `opencode_framework` | Agent configs, rules, skills, plugins |
| `infrastructure` | Git, JSON Schema, Node.js, shell |
| `state_management` | machine.json, gate-state.json, keystone, enforcement |

<!-- FW-SLIM-03 (2026-06-11, @Super-Admin): Slimmed from 48→28 effective lines.
  Removed: Step 0 (Knowledge Pipeline — enforced by uc7ks-before.ts),
  Step 2 (Compliance Gate — enforced by gate-before.ts),
  Step 4 (Close Gate — enforced by compliance_gate_complete MCP tool).
  Renumbered: Step 1→1 (skills), Step 3→2 (execute).
  Added: enforcement note explaining plugin coverage.
  Kept: Step 1 (skills — no plugin), Step 2 (execute — no plugin), Domain Reference table.
  Version history: 163→108 (FW-SLIM-01) → 48 (FW-SLIM-02) → 28 (FW-SLIM-03). -->
