# TEMPLATE VARIABLE STANDARD

**Version**: v2.0.0  
**Last Updated**: 2026-05-22  
**Author**: @Architect (FW-REPAIR-11)  
**Supersedes**: `template-variable-standard.md` v1.0.0  
**Applies To**: Agent configs (`.opencode/agents/*.md`), rule files (`.opencode/rules/**/*.md`), skill files (`.opencode/skills/**/SKILL.md`), preamble (`.opencode/subagent-preamble.md`), and any document injected into agent prompts by the dispatch system.

---

## §1 Overview

### §1.1 Purpose

The OpenCode Framework uses a **template variable placeholder system** to keep agent configurations, rule documents, and skill files **project-agnostic**. Instead of hardcoding project-specific paths (e.g., `prisma/schema.prisma` or `src/environments/environment.ts`), documents use curly-brace placeholders (`{namespace.key}`) that are resolved at **dispatch time** by `dispatch-subagent.js`.

### §1.2 Design Philosophy

| Principle                  | Description                                                                                                                                  |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Portability**            | The same `.opencode/` framework directory can be copied to any project and work after updating only `project.config.json`                    |
| **Single Source of Truth** | All placeholder values originate from `project.config.json` — no duplication or drift                                                        |
| **Fail-Safe**              | Unresolvable placeholders produce visible `UNRESOLVED{...}` markers (never silently ignored)                                                 |
| **Two-Tier Resolution**    | Simple key-value placeholders are resolved by `dispatch-subagent.js`; domain-specific "extended" placeholders use in-document mapping tables |

### §1.3 Placeholder Syntax

```
{<namespace>.<key>}
```

- **Namespace**: Top-level category (`project`, `backend`, `frontend`, `cache`, `queue`, `db`, `auth`, `testing`)
- **Key**: Dot-separated property path within the namespace (e.g., `orm.schema`, `contract_hash_command`)
- **Regex pattern** used by the resolver: `/\{([a-z_]+\.[a-z_.]+)\}/g`

---

## §2 Complete Placeholder Catalog

### §2.1 `{project.*}` Placeholders

Resolved from `project.config.json` root-level project fields and `template_resolution`.

| #   | Placeholder                       | Resolves To                      | Source Field                                | Example Value                                                                |
| --- | --------------------------------- | -------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------- |
| 1   | `{project.name}`                  | Project name                     | `project.name`                              | `booking-system`                                                             |
| 2   | `{project.version}`               | Project version                  | `project.version`                           | `1.0.0`                                                                      |
| 3   | `{project_root}`                  | Project root relative path       | `project_root`                              | `.`                                                                          |
| 4   | `{project.contract_hash_command}` | Command to compute keystone hash | `template_resolution.contract_hash_command` | `node .opencode/scripts/mcp-tools/keystone-validate.js --hash contract.yaml` |

### §2.2 `{backend.*}` Placeholders

Resolved from `template_resolution`, `tech_stack.backend`, and `paths`.

| #   | Placeholder            | Resolves To              | Source Field                             | Example Value          |
| --- | ---------------------- | ------------------------ | ---------------------------------------- | ---------------------- |
| 5   | `{backend.orm.schema}` | ORM schema file path     | `template_resolution.backend.orm.schema` | `prisma/schema.prisma` |
| 6   | `{backend.src}`        | Backend source directory | `paths.backend_src`                      | `booking-backend/src/` |
| 7   | `{backend.framework}`  | Backend framework name   | `tech_stack.backend.framework`           | `NestJS`               |
| 8   | `{backend.runtime}`    | Backend runtime          | `tech_stack.backend.runtime`             | `Node.js 22.x`         |
| 9   | `{backend.language}`   | Backend language         | `tech_stack.backend.language`            | `TypeScript 5.x`       |

### §2.3 `{frontend.*}` Placeholders

Resolved from `template_resolution`, `tech_stack.frontend`, and `paths`.

| #   | Placeholder                   | Resolves To               | Source Field                            | Example Value                     |
| --- | ----------------------------- | ------------------------- | --------------------------------------- | --------------------------------- |
| 10  | `{frontend.dto_path}`         | DTO directory path        | `template_resolution.frontend.dto_path` | `src/app/shared/dto/`             |
| 11  | `{frontend.env_path}`         | Environment config path   | `template_resolution.frontend.env_path` | `src/environments/environment.ts` |
| 12  | `{frontend.src}`              | Frontend source directory | `paths.frontend_src`                    | `booking-frontend/`               |
| 13  | `{frontend.framework}`        | Frontend framework name   | `tech_stack.frontend.framework`         | `Angular`                         |
| 14  | `{frontend.state_management}` | State management library  | `tech_stack.frontend.state_management`  | `NgRx SignalStore`                |
| 15  | `{frontend.ui_library}`       | UI component library      | `tech_stack.frontend.ui_library`        | `PrimeNG`                         |
| 16  | `{frontend.css}`              | CSS framework             | `tech_stack.frontend.css`               | `Tailwind CSS v4`                 |

### §2.4 `{cache.*}` Placeholders

Resolved from `template_resolution`.

| #   | Placeholder      | Resolves To               | Source Field                       | Example Value |
| --- | ---------------- | ------------------------- | ---------------------------------- | ------------- |
| 17  | `{cache.engine}` | Cache engine name/version | `template_resolution.cache.engine` | `Redis 7.x`   |
| 18  | `{cache.client}` | Cache client library      | `template_resolution.cache.client` | `ioredis`     |

### §2.5 `{queue.*}` Placeholders

Resolved from `template_resolution`.

| #   | Placeholder      | Resolves To       | Source Field                       | Example Value |
| --- | ---------------- | ----------------- | ---------------------------------- | ------------- |
| 19  | `{queue.engine}` | Queue engine name | `template_resolution.queue.engine` | `BullMQ`      |

### §2.6 `{db.*}` Placeholders

Resolved from `tech_stack.database`.

| #   | Placeholder   | Resolves To     | Source Field                 | Example Value   |
| --- | ------------- | --------------- | ---------------------------- | --------------- |
| 20  | `{db.orm}`    | ORM name        | `tech_stack.database.orm`    | `Prisma`        |
| 21  | `{db.engine}` | Database engine | `tech_stack.database.engine` | `PostgreSQL 16` |

### §2.7 `{auth.*}` Placeholders

Resolved from `tech_stack.auth`.

| #   | Placeholder               | Resolves To       | Source Field                       | Example Value    |
| --- | ------------------------- | ----------------- | ---------------------------------- | ---------------- |
| 22  | `{auth.mechanism}`        | Auth mechanism    | `tech_stack.auth.mechanism`        | `JWT + Passport` |
| 23  | `{auth.token_validity}`   | Token TTL         | `tech_stack.auth.token_validity`   | `15m`            |
| 24  | `{auth.refresh_validity}` | Refresh token TTL | `tech_stack.auth.refresh_validity` | `7d`             |

### §2.8 `{testing.*}` Placeholders

Resolved from `tech_stack.testing`.

| #   | Placeholder                    | Resolves To            | Source Field                            | Example Value                |
| --- | ------------------------------ | ---------------------- | --------------------------------------- | ---------------------------- |
| 25  | `{testing.unit}`               | Unit test framework    | `tech_stack.testing.unit`               | `Jest 29+`                   |
| 26  | `{testing.e2e}`                | E2E test framework     | `tech_stack.testing.e2e`                | `Playwright`                 |
| 27  | `{testing.integration}`        | Integration test tool  | `tech_stack.testing.integration`        | `Supertest + Testcontainers` |
| 28  | `{testing.coverage_threshold}` | Coverage threshold (%) | `tech_stack.testing.coverage_threshold` | `80`                         |

### §2.9 `{knowledge.*}` Placeholders

Resolved from `project.config.json.template_resolution` using keys with `knowledge.` prefix (added in UC7KS Phase 2).

| #   | Placeholder                         | Resolves To                        | Source Field                                   | Example Value |
| --- | ----------------------------------- | ---------------------------------- | ---------------------------------------------- | ------------- |
| 29  | `{knowledge.docs_root}`             | Official docs directory            | `paths.knowledge_docs`                         | `docs/official_docs/` |
| 30  | `{knowledge.index_manifest}`        | Index manifest file path           | `paths.knowledge_index`                        | `docs/official_docs/index.json` |
| 31  | `{knowledge.max_file_size}`         | Max single file size (bytes)       | `template_resolution.knowledge.max_file_size`  | `524288` (512KB) |
| 32  | `{knowledge.max_total_size}`        | Max total docs size (bytes)        | `template_resolution.knowledge.max_total_size` | `52428800` (50MB) |
| 33  | `{knowledge.default_ttl}`           | Default doc TTL (days)             | `template_resolution.knowledge.default_ttl`    | `30` |
| 34  | `{knowledge.fallback_ttl}`          | Web fallback TTL (days)            | `template_resolution.knowledge.fallback_ttl`   | `14` |
| 35  | `{knowledge.opencode_ttl}`          | OpenCode docs TTL (days)           | `template_resolution.knowledge.opencode_ttl`   | `7` |
| 36  | `{knowledge.scout_ttl}`             | Scout findings TTL (days)          | `template_resolution.knowledge.scout_ttl`      | `14` |
| 37  | `{knowledge.janitor_interval_hours}` | Janitor run interval (hours)      | `template_resolution.knowledge.janitor_interval_hours` | `24` |
| 38  | `{knowledge.compression_threshold_kb}` | Compression threshold (KB)      | `template_resolution.knowledge.compression_threshold_kb` | `200` |

### §2.10 Available but Not Currently Used

These namespaces have values in `project.config.json` but no placeholders are currently used in any file:

| Namespace   | Available Key Path     | Example Value       |
| ----------- | ---------------------- | ------------------- |
| `ci_cd`     | `tech_stack.ci_cd`     | `GitHub Actions`    |
| `container` | `tech_stack.container` | `Docker Compose v2` |

Future rules/agents may add `{ci_cd.platform}` or `{container.runtime}` placeholders as needed.

---

## §3 Extended Placeholders (In-Document Mapping)

### §3.1 Concept

Some placeholder categories represent **domain-specific conventions** rather than simple key-value lookups. These are **not resolved by `dispatch-subagent.js`** at dispatch time. Instead, each document that uses them includes an **internal resolution table** mapping the placeholder to a concrete description or implementation reference.

These placeholders will appear as `UNRESOLVED{...}` in the raw prompt passed to the agent. The agent is expected to interpret them using the document's own resolution table.

### §3.2 `{backend.*}` Extended Placeholders

Used in: `.opencode/rules/backend-coding-standard.md`

| #   | Placeholder                 | Meaning                     | Document Mapping                                                              |
| --- | --------------------------- | --------------------------- | ----------------------------------------------------------------------------- |
| E1  | `{backend.orm.transaction}` | ORM transaction API         | Mapped to `tech_stack.database.orm` → e.g., `prisma.$transaction()`           |
| E2  | `{backend.auth}`            | Auth mechanism + decorators | Mapped to `tech_stack.auth` → e.g., `@Roles('ADMIN')` + `@SkipAuth()`         |
| E3  | `{backend.rate_limit}`      | Framework rate limiting     | Mapped to `tech_stack.backend.framework` → e.g., `@Throttle()` guard          |
| E4  | `{backend.error_handler}`   | Framework error handling    | Mapped to `tech_stack.backend.framework` → e.g., Global Exception Filter      |
| E5  | `{backend.logger}`          | Framework logging           | Mapped to `tech_stack.backend.framework` → e.g., `Logger` class + interceptor |
| E6  | `{backend.api_docs}`        | API documentation spec      | Mapped to `tech_stack.backend.framework` → e.g., OpenAPI/Swagger              |
| E7  | `{backend.cache_pattern}`   | Caching strategy            | Mapped to `tech_stack.cache` → e.g., Redis + ioredis cache pattern            |

### §3.3 `{frontend.*}` Extended Placeholders

Used in: `.opencode/rules/frontend-coding-standard.md`

| #   | Placeholder                      | Meaning                   | Document Mapping                                                                     |
| --- | -------------------------------- | ------------------------- | ------------------------------------------------------------------------------------ |
| E8  | `{frontend.css_strategy}`        | CSS/styling strategy      | Mapped to `frontend.css` → e.g., Tailwind CSS v4 First, SCSS for complex cases       |
| E9  | `{frontend.state_pattern}`       | State management pattern  | Mapped to `frontend.state_management` → e.g., NgRx SignalStore with `signalStore()`  |
| E10 | `{frontend.component_hierarchy}` | Component organization    | Mapped to convention → e.g., Atomic Design (Atoms→Molecules→Organisms→Layouts→Pages) |
| E11 | `{frontend.lazy_loading}`        | Lazy loading strategy     | Mapped to framework → e.g., Angular `loadChildren` + `@defer`                        |
| E12 | `{frontend.api_pattern}`         | API encapsulation pattern | Mapped to convention → e.g., Service layer + DTO alignment                           |

### §3.4 Extended Placeholder Escalation

Since extended placeholders are NOT resolved by `dispatch-subagent.js`, they will appear as `UNRESOLVED{backend.orm.transaction}` in the agent's prompt. This is **expected behavior** — not a bug. The agent must consult the document's own resolution table.

If you need a placeholder to be machine-resolvable:

1. Add it to `project.config.json.template_resolution` with a concrete value
2. Add the corresponding key to `dispatch-subagent.js` `buildTemplateResolutionMap()` function
3. Update §2 of this document to register it as a dispatch-resolvable placeholder
4. Run `framework-self-test.js` to verify

---

## §4 Resolution Mechanism

### §4.1 Resolver: `dispatch-subagent.js`

Template resolution is performed by `.opencode/scripts/command-tools/dispatch-subagent.js` in the prompt assembly phase (between agent config parsing and final prompt generation).

**Source file**: `.opencode/scripts/command-tools/dispatch-subagent.js`  
**Key functions**:

- `buildTemplateResolutionMap(projectConfig)` — Lines 186–251: builds the key→value map from `project.config.json`
- `resolveTemplateVariables(content, templateMap, sourceLabel)` — Lines 256–268: regex replace engine

### §4.2 Resolution Flow

```
┌─────────────────────────────────────────────────┐
│ 1. Read .opencode/project.config.json            │
├─────────────────────────────────────────────────┤
│ 2. Parse agent config YAML frontmatter           │
├─────────────────────────────────────────────────┤
│ 3. ═══ TEMPLATE RESOLUTION (this step) ═══      │
│    a. Extract template_resolution section        │
│    b. Build resolution map from three sources:   │
│       ┌─────────────────────────────────────┐    │
│       │ Layer 1 (base): project root fields  │    │
│       │   {project.name}, {project_root}     │    │
│       ├─────────────────────────────────────┤    │
│       │ Layer 2 (mid): tech_stack.* fields   │    │
│       │   backend.*, frontend.*, db.*,       │    │
│       │   auth.*, testing.*, cache.*         │    │
│       ├─────────────────────────────────────┤    │
│       │ Layer 3 (override): template_        │    │
│       │   resolution keys                    │    │
│       │   contract_hash_command,             │    │
│       │   backend.orm.schema,                │    │
│       │   frontend.dto_path, etc.            │    │
│       └─────────────────────────────────────┘    │
│    c. Scan agent config for {template_key}        │
│    d. Replace resolved placeholders              │
│    e. Log warnings for unresolvable              │
├─────────────────────────────────────────────────┤
│ 4. Read subagent-preamble.md (also resolved)     │
├─────────────────────────────────────────────────┤
│ 5. Assemble final wrapped prompt                 │
└─────────────────────────────────────────────────┘
```

### §4.3 Resolution Map Priority

Later layers **override** earlier layers. For example, if both `tech_stack.backend.framework` and a `template_resolution.backend.framework` key exist, the `template_resolution` value wins.

| Priority     | Source                     | Example Keys                                                                       |
| ------------ | -------------------------- | ---------------------------------------------------------------------------------- |
| 1 (base)     | `project` root fields      | `name`, `version`, `project_root`                                                  |
| 2 (mid)      | `tech_stack` nested fields | `backend.framework`, `database.orm`, `auth.mechanism`, `testing.unit`              |
| 3 (override) | `template_resolution` keys | `contract_hash_command`, `backend.orm.schema`, `frontend.dto_path`, `cache.engine` |

### §4.4 Resolution Code Path

```javascript
// From dispatch-subagent.js lines 256-268:
function resolveTemplateVariables(content, templateMap, sourceLabel) {
  if (!content || Object.keys(templateMap).length === 0) return content;
  return content.replace(/\{([a-z_]+\.[a-z_.]+)\}/g, (match, key) => {
    if (templateMap.hasOwnProperty(key)) {
      return templateMap[key];
    }
    console.error(
      `[dispatch] WARNING: Unresolvable placeholder '${match}' in ${sourceLabel}`,
    );
    return `UNRESOLVED${match}`;
  });
}
```

### §4.5 Unresolvable Placeholder Behavior

When a `{template_key}` cannot be resolved:

1. It is replaced with the string `UNRESOLVED{template_key}` in the agent's prompt
2. A warning is logged to stderr: `[dispatch] WARNING: Unresolvable placeholder '{unknown.var}' in <agent config path>`
3. `framework-self-test.js` Check 17 scans all `.opencode/` files for `UNRESOLVED{` strings and fails if any are found
4. Extended placeholders (§3) naturally appear as `UNRESOLVED{...}` — this is expected and should be documented in the Check 17 exemption list

---

## §5 Where Placeholders Can Be Used

### §5.1 Allowed Locations

| Location          | Example File                                                                | Resolution Timing                                                                                                                  |
| ----------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Agent Configs** | `.opencode/agents/Architect.md`, `Coder-BE.md`, `Coder-FE.md`               | At dispatch, before prompt assembly                                                                                                |
| **Rule Files**    | `.opencode/rules/backend-coding-standard.md`, `frontend-coding-standard.md` | These are injected into prompts; extended placeholders remain as `UNRESOLVED{...}` and are interpreted via internal mapping tables |
| **Skill Files**   | `.opencode/skills/*/SKILL.md`                                               | At dispatch, when skill content is injected                                                                                        |
| **Preamble**      | `.opencode/subagent-preamble.md`                                            | At dispatch, line 299-304 of `dispatch-subagent.js` resolves preamble placeholders                                                 |

### §5.2 Explicitly Prohibited Locations

| Location                                                          | Reason                                                                |
| ----------------------------------------------------------------- | --------------------------------------------------------------------- |
| `project.config.json` itself                                      | No self-referencing — this would create circular resolution           |
| `dispatch-subagent.js`                                            | The resolver cannot resolve itself                                    |
| State machine files (`machine.json`, `gate-state.json`)           | Must be concrete JSON — no template expansion during state operations |
| Source code (`booking-backend/src/**`, `booking-frontend/src/**`) | Placeholders are framework-level, not application-level               |
| `contract.yaml`                                                   | Contract must contain concrete, verifiable values                     |

### §5.3 Files Resolved at Dispatch

The following files are scanned for `{template_key}` patterns during dispatch:

```
.opencode/agents/<agent_type>.md         ← Primary target
.opencode/subagent-preamble.md           ← Resolved before injection
.opencode/rules/backend-coding-standard.md ← Injected as-is (extended placeholders)
.opencode/rules/frontend-coding-standard.md
```

---

## §6 Correct Usage Examples

### §6.1 Agent Config — Pre-Commit Mandatory Action

```markdown
## Pre‑Commit Mandatory Actions

1. **Contract file change check**: If the current change involves
   `contract.yaml` or requirement documents:
   - Run `{project.contract_hash_command}` to automatically compute
     and update the hash value.
```

**Resolves to** (for `booking-system`):

```markdown
1. **Contract file change check**: If the current change involves
   `contract.yaml` or requirement documents:
   - Run `node .opencode/scripts/mcp-tools/keystone-validate.js --hash contract.yaml` to automatically compute
     and update the hash value.
```

### §6.2 Agent Config — ORM Schema Reference

```markdown
Before any code change, you MUST review `{backend.orm.schema}`.
```

**Resolves to** (for `booking-system`):

```markdown
Before any code change, you MUST review `prisma/schema.prisma`.
```

### §6.3 Rule File — Multiple Placeholders

```markdown
The database schema is defined in `{backend.orm.schema}`.
Frontend DTOs live in `{frontend.dto_path}`.
Caching uses `{cache.engine}` with `{cache.client}` client.
Auth is handled by `{auth.mechanism}` with `{auth.token_validity}` tokens.
```

**Resolves to** (for `booking-system`):

```markdown
The database schema is defined in `prisma/schema.prisma`.
Frontend DTOs live in `src/app/shared/dto/`.
Caching uses `Redis 7.x` with `ioredis` client.
Auth is handled by `JWT + Passport` with `15m` tokens.
```

### §6.4 Rule File — Extended Placeholder (NOT resolved by dispatch)

```markdown
6. **Transaction Management**: Use `{backend.orm.transaction}` to manage transaction boundaries.
```

**Remains as** (in the agent's prompt):

```markdown
6. **Transaction Management**: Use `UNRESOLVED{backend.orm.transaction}` to manage transaction boundaries.
```

The agent then consults the resolution table in `backend-coding-standard.md`:

> `{backend.orm.transaction}` → `prisma.$transaction()`

### §6.5 Preamble — Docs Consistency Check Reference

```markdown
- `{backend.orm.schema}` — database schema
  (resolved via template_resolution in project.config.json)
```

**Resolves to** (for `booking-system`):

```markdown
- `prisma/schema.prisma` — database schema
  (resolved via template_resolution in project.config.json)
```

---

## §7 Common Anti-Patterns

### §7.1 Hardcoded Paths

**❌ WRONG:**

```markdown
The schema is at `prisma/schema.prisma`.
The cache uses `Redis 7.x`.
```

**✅ CORRECT:**

```markdown
The schema is at `{backend.orm.schema}`.
The cache uses `{cache.engine}`.
```

### §7.2 Placeholder in project.config.json

**❌ WRONG (in `project.config.json`):**

```json
{
  "template_resolution": {
    "backend.orm.schema": "{backend.src}/prisma/schema.prisma"
  }
}
```

**✅ CORRECT (in `project.config.json`):**

```json
{
  "template_resolution": {
    "backend.orm.schema": "booking-backend/prisma/schema.prisma"
  }
}
```

### §7.3 Unknown Namespace

**❌ WRONG:**

```markdown
The build tool is `{build.tool}`.
```

This will produce `UNRESOLVED{build.tool}` because `build` is not a recognized namespace. Check §2 first, then register a new namespace if needed.

### §7.4 Assuming Extended Placeholders Are Resolved

**❌ WRONG expectation:**
"I used `{backend.orm.transaction}` in my agent config and it should resolve to `prisma.$transaction()`"

**✅ CORRECT understanding:**
`{backend.orm.transaction}` is an extended placeholder — it will appear as `UNRESOLVED{backend.orm.transaction}` and the agent must look up its meaning in the `backend-coding-standard.md` resolution table.

### §7.5 Typo in Placeholder Key

**❌ WRONG:**

```markdown
`{project.contract_hash_comand}` ← "comand" instead of "command"
```

**✅ CORRECT:**

```markdown
`{project.contract_hash_command}`
```

Always verify the exact key spelling against §2 of this document and the corresponding `project.config.json` field.

---

## §8 Escalation Path for Unresolvable Placeholders

### §8.1 Diagnostic Flow

```
┌────────────────────────────────────────────────┐
│ 1. Is the placeholder listed in §2?             │
│    ├─ YES → Check project.config.json           │
│    │         └─ Key missing? → Add it           │
│    └─ NO  → Is it listed in §3 (extended)?      │
│              ├─ YES → Expected behavior          │
│              │        (agent interprets via      │
│              │         internal mapping table)   │
│              └─ NO  → Unknown placeholder        │
│                       → Go to §8.2              │
└────────────────────────────────────────────────┘
```

### §8.2 Step-by-Step Resolution

| Step  | Action                                                                                                                                      | Tool/File                                                               |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| **1** | Verify the placeholder exists in §2 of this document                                                                                        | `TEMPLATE_VARIABLE_STANDARD.md`                                         |
| **2** | Check that the corresponding key exists in `project.config.json`                                                                            | `.opencode/project.config.json` → `template_resolution` or `tech_stack` |
| **3** | If the key is missing, add it to `project.config.json.template_resolution`                                                                  | Edit `project.config.json`                                              |
| **4** | If the placeholder is a new category (not `project`, `backend`, `frontend`, `cache`, `queue`, `db`, `auth`, `testing`), update the resolver | Edit `dispatch-subagent.js` → `buildTemplateResolutionMap()`            |
| **5** | Run `framework-self-test.js` to verify resolution                                                                                           | `node .opencode/scripts/framework-self-test.js`                         |
| **6** | Check Check 17 output for `UNRESOLVED{` strings                                                                                             | Framework self-test report                                              |
| **7** | Check stderr logs for `[dispatch] WARNING: Unresolvable placeholder`                                                                        | Dispatch output                                                         |

### §8.3 Common Failure Scenarios

| Symptom                                               | Likely Cause                                                                   | Fix                                                                       |
| ----------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `UNRESOLVED{backend.orm.transaction}` in agent prompt | Extended placeholder — expected behavior                                       | Agent must consult `backend-coding-standard.md` resolution table          |
| `UNRESOLVED{project.contract_hash_command}`           | `template_resolution.contract_hash_command` missing from `project.config.json` | Add the key-value pair                                                    |
| `UNRESOLVED{frontend.dto_path}`                       | `frontend.dto_path` missing from `template_resolution`                         | Add `"frontend.dto_path": "src/app/shared/dto/"` to `template_resolution` |
| All placeholders unresolved                           | `project.config.json` not found or malformed                                   | Verify `OPENCODE_ROOT` env var and file existence                         |
| `framework-self-test.js` Check 17 fails               | New unregistered placeholder or missing template_resolution key                | Follow §8.2 steps                                                         |

---

## §9 Maintenance Guide

### §9.1 Adding a New Placeholder

```
1. Determine the category (dispatch-resolvable vs extended)
2. Add the key-value pair to project.config.json.template_resolution
   (if dispatch-resolvable)
3. Add the corresponding mapping in dispatch-subagent.js
   buildTemplateResolutionMap() (if dispatch-resolvable)
4. Add an entry to §2 (or §3 if extended) of this document
5. Run framework-self-test.js Check 17 + Check 18
6. Update all files that should use the new placeholder
```

### §9.2 Removing a Placeholder

```
1. Remove the key from project.config.json.template_resolution
2. Remove the corresponding mapping from dispatch-subagent.js
3. Update §2 or §3 to mark the placeholder as deprecated
4. Search for all usages with: grep -r "{template_key}" .opencode/
5. Replace or remove all usages
6. Run framework-self-test.js to verify no UNRESOLVED{...} remain
```

### §9.3 Modifying a Placeholder Value

```
1. Update the value in project.config.json (for dispatch-resolvable)
   OR update the resolution table in the document (for extended)
2. No code changes needed in dispatch-subagent.js (keys unchanged)
3. Run framework-self-test.js to verify
```

### §9.4 Adding a New Namespace

```
1. Decide if it should be dispatch-resolvable or extended
2. If dispatch-resolvable:
   a. Add the value to project.config.json (tech_stack or template_resolution)
   b. Add resolution logic to dispatch-subagent.js buildTemplateResolutionMap()
3. Add a new subsection to §2 (or §3) of this document
4. Register the namespace in framework-self-test.js Check 18 validation
5. Run full framework self-test
```

### §9.5 Verification Commands

```bash
# Check for unresolved placeholders across the framework
node .opencode/scripts/framework-self-test.js

# Check a specific agent config resolution (manual)
node .opencode/scripts/command-tools/dispatch-subagent.js Architect "test" 2>&1 | grep UNRESOLVED

# Scan all .opencode files for placeholder patterns
grep -r '\{[a-z_]*\.[a-z_.]*\}' .opencode/ --include="*.md" | grep -v 'UNRESOLVED\|template-variable-standard\|TEMPLATE_VARIABLE_STANDARD\|node_modules'
```

---

## §10 Related Documents

| Document                                               | Relationship                                                                                                    |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `.opencode/project.config.json`                        | **Source of truth** for all placeholder values (`template_resolution` + `tech_stack` sections)                  |
| `.opencode/scripts/command-tools/dispatch-subagent.js` | Resolver implementation (`buildTemplateResolutionMap` + `resolveTemplateVariables`)                             |
| `.opencode/scripts/framework-self-test.js`             | Check 17 verifies no orphaned `UNRESOLVED{...}` strings; Check 18 verifies `template_resolution` section exists |
| `.opencode/subagent-preamble.md`                       | Consumer of template variables; all `{template_key}` references resolved before prompt injection                |
| `.opencode/rules/backend-coding-standard.md`           | Consumer of 7 extended `{backend.*}` placeholders (§3.2); contains internal resolution table                    |
| `.opencode/rules/frontend-coding-standard.md`          | Consumer of 5 extended `{frontend.*}` placeholders (§3.3); contains internal resolution table                   |
| `.opencode/agents/Architect.md`                        | Consumer of `{project.contract_hash_command}`                                                                   |
| `.opencode/agents/Coder-BE.md`                         | Consumer of `{backend.orm.schema}` and `{project.contract_hash_command}`                                        |
| `.opencode/agents/Coder-FE.md`                         | Consumer of `{frontend.dto_path}`, `{frontend.env_path}`, and `{project.contract_hash_command}`                 |

---

## §A Quick Reference Card

```
┌─────────────────────────────────────────────────────────────┐
│                TEMPLATE VARIABLE QUICK REF                  │
├──────────────┬──────────────────────────────────────────────┤
│ 28 resolvable│ {project.*} ×4   {backend.*} ×5              │
│              │ {frontend.*} ×7  {cache.*} ×2                │
│              │ {queue.*} ×1     {db.*} ×2                   │
│              │ {auth.*} ×3      {testing.*} ×4              │
├──────────────┼──────────────────────────────────────────────┤
│ 12 extended  │ {backend.*} ×7   {frontend.*} ×5             │
│              │ (resolved by in-document mapping tables)      │
├──────────────┼──────────────────────────────────────────────┤
│ Resolver     │ dispatch-subagent.js                         │
│              │ → buildTemplateResolutionMap()                │
│              │ → resolveTemplateVariables()                  │
├──────────────┼──────────────────────────────────────────────┤
│ Validator    │ framework-self-test.js Check 17 + Check 18   │
├──────────────┼──────────────────────────────────────────────┤
│ Source of    │ project.config.json                          │
│ Truth        │ → template_resolution section                │
│              │ → tech_stack section                         │
│              │ → paths section                              │
├──────────────┼──────────────────────────────────────────────┤
│ Unresolved   │ Placeholder replaced with                    │
│ fallback     │ UNRESOLVED{template_key}                      │
│              │ + stderr warning from dispatcher              │
└──────────────┴──────────────────────────────────────────────┘
```
