# WorkBuddy Framework Migration Assessment

_Date: 2026-05-24_
_Purpose: Investigate whether the migration plan makes the WorkBuddy Framework more WorkBuddy-native while completely inheriting all capabilities from the original Opencode Framework_

---

## 1. Executive Summary

The current v2 migration plan achieves **~70% WorkBuddy-native alignment**. It correctly replaces Meta-Planner and Orchestrator with WorkBuddy's Plan mode and Task management, uses Skills and Custom Agents as intended, and leverages Working Memory for state persistence. However, it has **3 critical gaps** and **4 significant opportunities** that would make the framework substantially more native and capable:

| Dimension | Current Score | Potential Score | Gap |
|-----------|:------------:|:--------------:|:---:|
| Native feature usage | 5/8 | 8/8 | -3 |
| Capability inheritance | 7/9 | 9/9 | -2 |
| Enforcement robustness | 3/6 | 6/6 | -3 |
| Operational efficiency | 4/6 | 6/6 | -2 |

**Overall: 19/29 (66%) → 29/29 (100%) achievable**

---

## 2. WorkBuddy Native Feature Audit

### 2.1 Features Properly Used (5/8)

| # | WorkBuddy Feature | How Migration Uses It | Verdict |
|---|-------------------|----------------------|---------|
| 1 | **Plan mode** | Replaces Meta-Planner agent; task DAG is generated natively | Correct |
| 2 | **Task management** | TaskCreate/TaskUpdate/TaskList used for TDD phases and gate lifecycle | Correct |
| 3 | **Skills (SKILL.md)** | 7 skills properly defined with frontmatter, auto-triggered | Correct |
| 4 | **Custom Agents (.md)** | 5 agents defined with YAML frontmatter, skills bindings, tool scoping | Correct |
| 5 | **Working Memory** | `.workbuddy/memory/` for framework-state, gate-sessions, tech-debt, invocation-log | Correct |

### 2.2 Features Underused (2/8)

| # | WorkBuddy Feature | Current Migration Approach | Problem | Opportunity |
|---|-------------------|---------------------------|---------|-------------|
| 6 | **Rules system** (`.codebuddy/rules/`) | project.yaml contains all config; no `.codebuddy/rules/` files exist | Conditional rules (per-file-type enforcement) are a WorkBuddy native feature that could replace manual skill-level path checking | Decompose project.yaml enforcement into conditional rules that auto-trigger per layer |
| 7 | **CODEBUDDY.md** | project.yaml is the config source of truth, but no CODEBUDDY.md exists | Every session must manually discover project.yaml rules; CODEBUDDY.md is auto-loaded at session start | Create a CODEBUDDY.md that references project.yaml and provides quick-start instructions |

### 2.3 Features Not Used at All (1/8)

| # | WorkBuddy Feature | Current Migration Approach | Problem | Opportunity |
|---|-------------------|---------------------------|---------|-------------|
| 8 | **Hooks system** | Skills manually orchestrate enforcement (guardian agent calls compliance-gate Skill) | Hooks provide **event-driven** enforcement that is more reliable than manual Skill invocation. PreToolUse hooks can BLOCK operations before they happen; PostToolUse hooks can auto-validate after; Stop hooks can prevent premature completion | **CRITICAL GAP** — see Section 3.1 |

---

## 3. Critical Findings

### 3.1 CRITICAL: Hooks System Not Used (Enforcement Gap)

**The Problem:**

The original Opencode Framework uses a **compliance-gate MCP tool** that is called as a blocking gate. In the migration, this was translated into a Skill (`compliance-gate`) that relies on **the AI agent voluntarily invoking it**. This is a fundamental enforcement gap:

| Aspect | Original Framework | Current Migration | With Hooks |
|--------|-------------------|------------------|------------|
| Gate trigger | MCP tool blocks execution | Skill must be manually invoked | PreToolUse hook auto-triggers |
| Write enforcement | Machine state tracks writes | Skill checks after the fact | PostToolUse hook validates immediately |
| Completion block | Gate state prevents advance | AI may skip gate confirm | Stop hook blocks if gate incomplete |
| TDD enforcement | RED phase must exist first | Agent may forget to check | PreToolUse on Write blocks non-TDD writes |

**The Impact:**
- P0 rules (compliance gate, TDD iron law) are **not truly enforced** — they are advisory instructions that the AI may ignore
- The "strong binding" capability from the original framework is **lost** because Skills cannot block operations
- Write auditing happens post-hoc rather than preventively

**The Fix:**
Implement hooks at three enforcement points:

1. **PreToolUse hook on Write/Edit** → Enforce TDD (no source write without corresponding test)
2. **PostToolUse hook on Write/Edit** → Auto-log to invocation-log.md (write audit)
3. **Stop hook** → Block completion if compliance gate has not passed

### 3.2 CRITICAL: Conditional Rules Not Leveraged (Layer Enforcement Gap)

**The Problem:**

The verification suite needs to determine which layers are affected by a code change. Currently, the Skill reads project.yaml and matches file paths at runtime. However, WorkBuddy's **conditional rules** (`.codebuddy/rules/` with `paths` frontmatter) provide this exact capability natively:

- A rule with `paths: "src/frontend/**/*.{ts,tsx}"` and `alwaysApply: false` automatically activates only when frontend files are being edited
- This is **deterministic** (no AI judgment needed) vs. the current approach (Skill must read config and match patterns)

**The Impact:**
- Layer detection is fragile — it depends on the AI correctly reading and matching project.yaml patterns
- Verification may miss layers if the Skill is not invoked or reads config incorrectly
- The 5x3 verification matrix trigger is not guaranteed

**The Fix:**
Create conditional rules that auto-inject verification requirements:

```
.codebuddy/rules/
├── frontend-verification.md   # paths: "src/frontend/**/*.{ts,tsx,html,css}"
├── backend-verification.md    # paths: "src/backend/**/*.{ts,js,py,go}"
├── database-verification.md  # paths: "prisma/**/*, migrations/**/*"
└── enforcement.md             # alwaysApply: true — P0/P1 rules
```

### 3.3 SIGNIFICANT: Agent Skill Binding Uses Custom YAML (Not Native Frontmatter)

**The Problem:**

The agent `.md` files define `skills:` in their YAML frontmatter:

```yaml
---
name: coder
skills:
  - tdd-enforcer
  - code-quality-gate
---
```

WorkBuddy's native agent format supports a `skills:` field that auto-loads skills when the agent starts. However, the current agent files also include `workbuddy_type:`, `scope_source:`, `write_scopes:`, and `role:` — all custom fields that WorkBuddy does not natively process.

**The Impact:**
- Custom fields are **documentation-only** — WorkBuddy does not read or enforce them
- `write_scopes` (guardian's read-only restriction) is NOT enforced by the platform
- `workbuddy_type` is redundant with the `subagent_type` parameter in Agent tool

**The Fix:**
- Move `write_scopes` enforcement to a PreToolUse hook (deterministic enforcement)
- Remove `workbuddy_type` (use `subagent_type` parameter when dispatching)
- Keep custom fields as documentation but don't rely on them for enforcement
- Use `allowed-tools` in agent frontmatter to restrict guardian's tool access instead

---

## 4. Capability Inheritance Assessment

### 4.1 Original Framework Capabilities vs. Migration Status

| # | Original Capability | Description | Inherited? | Quality | Notes |
|---|-------------------|-------------|:----------:|:-------:|-------|
| 1 | **Multi-agent system** | 8-role agent architecture | Partial | Medium | 5 agents + 2 native, but enforcement relies on AI compliance rather than platform guarantees |
| 2 | **Strong binding (P0 gate)** | Blocking compliance gate | Weak | Low | Skill-based gate cannot truly block; needs hooks |
| 3 | **Central state management** | machine.json + gate-state.json | Yes | High | Migrated to memory/*.md; unified format |
| 4 | **TDD iron law** | RED→GREEN→REFACTOR enforced | Weak | Low | Relies on Skill invocation; no Write-blocking |
| 5 | **Contract-driven dev** | SHA-256 hash verification | Yes | High | Skill correctly implements contract validation |
| 6 | **5x3 verification matrix** | Full-stack 5-class verification | Yes | High | Correctly covers all layers |
| 7 | **Write audit** | All file writes logged | Partial | Medium | Skill-based logging; not automatic via hooks |
| 8 | **Code quality gate** | Lint/type/deps enforcement | Yes | High | Config-driven, reads from project.yaml |
| 9 | **Config-driven universality** | Zero hardcoded tech references | Yes | High | Validated with 0 hardcoded references |
| 10 | **Enforcement mode** | advisory/strict/locked | Partial | Medium | Mode defined in config but enforcement mechanism is weak |

**Score: 7/10 capabilities inherited, but 3 of the 7 are weakly inherited**

### 4.2 Lost or Weakened Capabilities

| Capability | Why It's Weak | How to Restore |
|-----------|--------------|----------------|
| Strong binding (P0 gate) | Skills cannot block operations | PreToolUse hooks that return exit code 2 |
| TDD iron law | No Write-blocking mechanism | PreToolUse hook on Write/Edit that checks TDD state |
| Write audit | Post-hoc logging, not automatic | PostToolUse hook on Write/Edit that auto-logs |
| Enforcement mode | AI may ignore strict/locked mode | Stop hook that checks gate state before allowing completion |

---

## 5. Recommendations (Priority Order)

### P0: Must Fix — Hooks Integration

**Action:** Add `.codebuddy/settings.json` with hooks configuration:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "prompt",
            "prompt": "Evaluate whether this file write complies with TDD rules. Context: $ARGUMENTS. If the file is a source file (not a test file), verify that a corresponding test exists or is being created first. Respond with JSON: {\"ok\": true} to allow, or {\"ok\": false, \"reason\": \"TDD violation: no test exists for this source file\"} to block.",
            "timeout": 30
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "echo '{\"hook_event_name\":\"PostToolUse\",\"agent\":\"auto\",\"skill\":\"write-audit\",\"action\":\"log\",\"target\":\"$ARGUMENTS\"}' >> .workbuddy/memory/invocation-log.md",
            "timeout": 10
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "prompt",
            "prompt": "Before stopping, verify that the compliance gate has been completed for all active tasks. Context: $ARGUMENTS. If any task has an incomplete gate session, respond with {\"ok\": false, \"reason\": \"Compliance gate incomplete for task X\"}. Otherwise {\"ok\": true}.",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

### P1: Should Fix — Conditional Rules

**Action:** Create `.codebuddy/rules/` directory with conditional rules:

| Rule File | Paths | Purpose |
|-----------|-------|---------|
| `frontend-enforcement.md` | `src/frontend/**/*.{ts,tsx,html,css,scss}` | Auto-inject frontend verification requirements |
| `backend-enforcement.md` | `src/backend/**/*.{ts,js,py,go,java}` | Auto-inject backend verification requirements |
| `database-enforcement.md` | `prisma/**/*, migrations/**/*, sql/**/*` | Auto-inject database verification requirements |
| `framework-core.md` | (alwaysApply: true) | P0/P1 rule definitions, enforcement mode |

### P2: Nice to Have — CODEBUDDY.md Auto-Discovery

**Action:** Create `CODEBUDDY.md` at project root that:
- References `project.yaml` as the config source
- Provides quick commands for each skill
- Defines project conventions that auto-load at session start

### P3: Nice to Have — Agent Tool Scoping

**Action:** Use `allowed-tools` in agent frontmatter instead of custom `write_scopes`:

```yaml
---
name: guardian
description: Quality gate enforcement agent. Proactively verify code quality and compliance.
allowed-tools: Read, Grep, Glob, Bash, TaskCreate, TaskUpdate, TaskList, TaskGet
---
```

This natively restricts the guardian from using Write/Edit tools, achieving the same read-only enforcement.

### P4: Future — Agent Teams for Parallel Verification

**Action:** For large code changes affecting all 3 layers, consider using Agent Teams to run verification in parallel:
- One member for frontend verification
- One member for backend verification
- One member for database verification
- Team lead aggregates results

---

## 6. Comparative Architecture: Before vs. After

| Aspect | Original Opencode | Current Migration v2 | Proposed v3 (with Hooks) |
|--------|-------------------|---------------------|--------------------------|
| Planning | Meta-Planner agent | WorkBuddy Plan mode | WorkBuddy Plan mode |
| Task coordination | Orchestrator agent | Task management (native) | Task management (native) |
| P0 enforcement | MCP tool (blocking) | Skill (advisory) | **Hooks + Skill (blocking)** |
| TDD enforcement | Sub-agent protocol | Skill (advisory) | **PreToolUse Hook (blocking)** |
| Write audit | machine.json state | Skill + memory files | **PostToolUse Hook (automatic)** |
| Completion block | Gate-state.json | Skill confirm step | **Stop Hook (blocking)** |
| Layer detection | Config + path matching | Skill reads project.yaml | **Conditional Rules (automatic)** |
| State storage | JSON files | Markdown memory files | Markdown memory files |
| Config source | AGENTS.md + hardcoded | project.yaml | project.yaml + rules |
| Agent tool scoping | Custom YAML field | Custom YAML field | **allowed-tools frontmatter** |

---

## 7. Conclusion

The v2 migration plan correctly identifies and preserves the conceptual framework from Opencode, but **fails to leverage WorkBuddy's strongest enforcement mechanism: hooks**. Without hooks:

- P0 rules are **aspirational** rather than **guaranteed**
- The "strong binding" capability is **not truly inherited**
- TDD enforcement relies on **AI compliance** rather than platform enforcement
- Write auditing is **manual** rather than automatic

The good news: **all gaps are fixable without changing the existing framework structure**. Adding hooks, conditional rules, and proper agent scoping would bring the framework to full WorkBuddy-native alignment while completely inheriting every original capability.

The recommended path forward is:
1. Add hooks configuration (P0) — this is the single highest-impact change
2. Add conditional rules (P1) — this makes layer enforcement automatic
3. Refine agent frontmatter (P3) — this makes tool scoping native
4. Add CODEBUDDY.md (P2) — this improves discoverability
