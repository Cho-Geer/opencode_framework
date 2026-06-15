# Template Variable Standard

**Version**: v1.0.0  
**Last Updated**: 2026-05-21  
**Applies To**: Agent configs (`.opencode/agents/*.md`), rule files (`.opencode/rules/**/*.md`), skill files (`.opencode/skills/**/SKILL.md`), preamble (`.opencode/subagent-preamble.md`), and any document injected into agent prompts by the dispatch system.

---

## §1 Overview

OpenCode Framework uses a **template variable placeholder system** to keep agent configurations, rule documents, and skill files **project-agnostic**. Instead of hardcoding project-specific paths (e.g., `prisma/schema.prisma` or `src/environments/environment.ts`), documents use curly-brace placeholders that are resolved at **dispatch time** by `dispatch-subagent.js`.

This document defines all valid placeholders, their resolution mechanism, and the rules for using them.

---

## §2 Placeholder Catalog

### §2.1 `{project.*}` Placeholders

Resolved from `project.config.json` root-level project fields.

| Placeholder                       | Resolves To                      | Source Field                                | Example Value                                                                |
| --------------------------------- | -------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------- |
| `{project.name}`                  | Project name                     | `project.name`                              | `booking-system`                                                             |
| `{project.version}`               | Project version                  | `project.version`                           | `1.0.0`                                                                      |
| `{project_root}`                  | Project root relative path       | `project_root`                              | `.`                                                                          |
| `{project.contract_hash_command}` | Command to compute keystone hash | `template_resolution.contract_hash_command` | `bun .opencode/scripts/mcp-tools/keystone-validate.ts --hash contract.yaml` |

### §2.2 `{backend.*}` Placeholders

Resolved from `project.config.json.template_resolution` using keys with `backend.` prefix.

| Placeholder            | Resolves To              | Template Key                   | Example Value          |
| ---------------------- | ------------------------ | ------------------------------ | ---------------------- |
| `{backend.orm.schema}` | ORM schema file path     | `backend.orm.schema`           | `prisma/schema.prisma` |
| `{backend.src}`        | Backend source directory | `paths.backend_src`            | `booking-backend/src/` |
| `{backend.framework}`  | Backend framework name   | `tech_stack.backend.framework` | `NestJS`               |
| `{backend.runtime}`    | Backend runtime          | `tech_stack.backend.runtime`   | `Node.js 22.x`         |
| `{backend.language}`   | Backend language         | `tech_stack.backend.language`  | `TypeScript 5.x`       |

### §2.3 `{frontend.*}` Placeholders

Resolved from `project.config.json.template_resolution` using keys with `frontend.` prefix.

| Placeholder                   | Resolves To               | Template Key                           | Example Value                     |
| ----------------------------- | ------------------------- | -------------------------------------- | --------------------------------- |
| `{frontend.dto_path}`         | DTO directory path        | `frontend.dto_path`                    | `src/app/shared/dto/`             |
| `{frontend.env_path}`         | Environment config path   | `frontend.env_path`                    | `src/environments/environment.ts` |
| `{frontend.src}`              | Frontend source directory | `paths.frontend_src`                   | `booking-frontend/`               |
| `{frontend.framework}`        | Frontend framework name   | `tech_stack.frontend.framework`        | `Angular`                         |
| `{frontend.state_management}` | State management lib      | `tech_stack.frontend.state_management` | `NgRx SignalStore`                |
| `{frontend.ui_library}`       | UI component library      | `tech_stack.frontend.ui_library`       | `PrimeNG`                         |
| `{frontend.css}`              | CSS framework             | `tech_stack.frontend.css`              | `Tailwind CSS v4`                 |

### §2.4 `{cache.*}` Placeholders

Resolved from `project.config.json.template_resolution` using keys with `cache.` prefix.

| Placeholder      | Resolves To               | Template Key   | Example Value |
| ---------------- | ------------------------- | -------------- | ------------- |
| `{cache.engine}` | Cache engine name/version | `cache.engine` | `Redis 7.x`   |
| `{cache.client}` | Cache client library      | `cache.client` | `ioredis`     |

### §2.5 `{queue.*}` Placeholders

Resolved from `project.config.json.template_resolution` using keys with `queue.` prefix.

| Placeholder      | Resolves To       | Template Key   | Example Value |
| ---------------- | ----------------- | -------------- | ------------- |
| `{queue.engine}` | Queue engine name | `queue.engine` | `BullMQ`      |

### §2.6 `{db.*}` Placeholders

Resolved from `project.config.json.tech_stack.database`.

| Placeholder   | Resolves To     | Source Field                 | Example Value   |
| ------------- | --------------- | ---------------------------- | --------------- |
| `{db.orm}`    | ORM name        | `tech_stack.database.orm`    | `Prisma`        |
| `{db.engine}` | Database engine | `tech_stack.database.engine` | `PostgreSQL 16` |

### §2.7 `{auth.*}` Placeholders

Resolved from `project.config.json.tech_stack.auth`.

| Placeholder               | Resolves To    | Source Field                       | Example Value    |
| ------------------------- | -------------- | ---------------------------------- | ---------------- |
| `{auth.mechanism}`        | Auth mechanism | `tech_stack.auth.mechanism`        | `JWT + Passport` |
| `{auth.token_validity}`   | Token TTL      | `tech_stack.auth.token_validity`   | `15m`            |
| `{auth.refresh_validity}` | Refresh TTL    | `tech_stack.auth.refresh_validity` | `7d`             |

### §2.8 `{testing.*}` Placeholders

Resolved from `project.config.json.tech_stack.testing`.

| Placeholder                    | Resolves To           | Source Field                            | Example Value                |
| ------------------------------ | --------------------- | --------------------------------------- | ---------------------------- |
| `{testing.unit}`               | Unit test framework   | `tech_stack.testing.unit`               | `Jest 29+`                   |
| `{testing.e2e}`                | E2E test framework    | `tech_stack.testing.e2e`                | `Playwright`                 |
| `{testing.integration}`        | Integration test tool | `tech_stack.testing.integration`        | `Supertest + Testcontainers` |
| `{testing.coverage_threshold}` | Coverage threshold    | `tech_stack.testing.coverage_threshold` | `80`                         |

---

## §3 Resolution Mechanism

### §3.1 Resolver: `dispatch-subagent.js`

Template resolution is performed by `.opencode/scripts/command-tools/dispatch-subagent.js` in the prompt assembly phase (between agent config parsing and prompt generation).

**Resolution Flow:**

```
1. Read .opencode/project.config.json
2. Parse agent config YAML frontmatter
3. ── TEMPLATE RESOLUTION (this step) ──
   a. Extract template_resolution section from project.config.json
   b. Build resolution map from:
      - template_resolution keys (e.g., "backend.orm.schema" → "prisma/schema.prisma")
      - tech_stack nested values (e.g., "cache.engine" → "Redis 7.x")
      - project root-level fields (e.g., "name" → "booking-system")
   c. Scan agent config for `{variable_name}` patterns
   d. Replace resolved placeholders with their values
   e. Log warnings for unresolvable placeholders
4. Assemble final wrapped prompt
```

### §3.2 Resolution Map Construction

The resolution map is built from three sources, merged in order (later sources override earlier):

| Priority     | Source                     | Keys                                                                                 |
| ------------ | -------------------------- | ------------------------------------------------------------------------------------ |
| 1 (base)     | `project` root fields      | `name`, `version`, `project_root`                                                    |
| 2 (mid)      | `tech_stack` nested fields | `backend.*`, `frontend.*`, `database.*`, `cache.*`, `queue.*`, `auth.*`, `testing.*` |
| 3 (override) | `template_resolution` keys | All keys in `template_resolution` section                                            |

### §3.3 Unresolvable Placeholders

Any template variable that cannot be resolved is replaced with the string `UNRESOLVED{var}` and logged as a warning to stderr.

**Warning format:**

```
[dispatch] WARNING: Unresolvable placeholder '{unknown.var}' in <agent config path>
```

`framework-self-test.js` Check 17 scans for `UNRESOLVED{` strings and fails if any are found.

---

## §4 Where Placeholders Can Be Used

### §4.1 Agent Configs (`.opencode/agents/*.md`)

All content after the YAML frontmatter. Example:

```markdown
## Backend Architecture Trigger Scenarios

When the following scenarios are involved, consult `{backend.orm.schema}` for the database schema.
```

### §4.2 Rule Files (`.opencode/rules/**/*.md`)

Any rule document injected into agent prompts. Example:

```markdown
Run tests with `{testing.unit}` at coverage threshold `{testing.coverage_threshold}%`.
```

### §4.3 Skill Files (`.opencode/skills/**/SKILL.md`)

Skill documents that reference project-specific paths. Example:

```markdown
Seed scripts must be placed relative to `{backend.orm.schema}`.
```

### §4.4 Preamble (`.opencode/subagent-preamble.md`)

The universal P0 protocol template injected into every sub-agent prompt. Example:

```markdown
- `{backend.orm.schema}` — database schema
```

### §4.5 NOT Allowed

- **project.config.json itself** — no self-referencing placeholders
- **dispatch-subagent.js** — the resolver cannot resolve itself
- **state machine files** (`machine.json`, `gate-state.json`) — must be concrete JSON

---

## §5 Usage Examples

### Correct

```markdown
The database schema is defined in `{backend.orm.schema}`.
Frontend DTOs live in `{frontend.dto_path}`.
Caching uses `{cache.engine}` with `{cache.client}` client.
```

Resolves to:

```markdown
The database schema is defined in `prisma/schema.prisma`.
Frontend DTOs live in `src/app/shared/dto/`.
Caching uses `Redis 7.x` with `ioredis` client.
```

### Incorrect

```markdown
The schema is at `prisma/schema.prisma`. ❌ HARDCODED
The cache uses Redis. ❌ HARDCODED
```

---

## §6 Escalation Path for Unresolvable Placeholders

1. Check that the placeholder is listed in §2 of this document.
2. Verify the corresponding key exists in `project.config.json.template_resolution` or `tech_stack`.
3. If the key is missing, add it to `project.config.json.template_resolution`.
4. If the placeholder uses a new category (not `project`, `backend`, `frontend`, `cache`, `queue`, `db`, `auth`, `testing`), update this document and the resolver in `dispatch-subagent.js`.
5. For runtime resolution failures, check `stderr` logs for `[dispatch] WARNING: Unresolvable placeholder`.

---

## §7 Maintenance

- **Adding a new placeholder**: Add to `template_resolution` in `project.config.json`, then add an entry to §2 of this document.
- **Removing a placeholder**: Remove from both `project.config.json.template_resolution` and §2.
- **Updating resolver logic**: Modify `.opencode/scripts/command-tools/dispatch-subagent.js` → run `framework-self-test.js` Check 18 to verify `template_resolution` is valid.

---

## §8 Related Documents

- `.opencode/project.config.json` — `template_resolution` section (source of truth)
- `.opencode/scripts/command-tools/dispatch-subagent.js` — template resolver implementation
- `.opencode/scripts/framework-self-test.js` — Check 17/18 for placeholder validation
- `.opencode/subagent-preamble.md` — consumer of template variables
