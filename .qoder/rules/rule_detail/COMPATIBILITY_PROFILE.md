---
type: model_decision
description: When evaluating cross-platform compatibility
---

# COMPATIBILITY PROFILE — Multi-Stack Support Reference

**Version**: v1.0.0  
**Created**: 2026-05-22  
**Author**: @Architect (RVW-REVIEW-09)  
**Applies To**: All `.qoder/agents/*.md`, `.qoder/rules/**/*.md`, `.qoder/skills/**/SKILL.md`, `.qoder/subagent-preamble.md`  
**References**: [TEMPLATE_VARIABLE_STANDARD.md](./TEMPLATE_VARIABLE_STANDARD.md)

---

## §1 Overview

### §1.1 Purpose

This document defines the **universal compatibility profile** for the OpenCode Framework's agent configuration layer. While the current `project.config.json` targets **Angular 21+ / NestJS 11+**, the framework is designed to support arbitrary tech stack combinations through its template variable placeholder system.

This profile serves three purposes:

1. **Audit**: Documents all remaining framework-specific assumptions not yet parameterized by template variables
2. **Reference**: Provides concrete override instructions for each supported alternative stack
3. **Guide**: Defines the step-by-step process for adding support for a new tech stack

### §1.2 Design Philosophy

The framework follows a **progressive parameterization** model:

| Layer                                | Mechanism                                                                                             | Example                                                               |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| **Dispatch-resolvable placeholders** | `{namespace.key}` → resolved by `dispatch-subagent.js` from `project.config.json`                     | `{backend.framework}` → `NestJS`                                      |
| **Extended placeholders**            | `UNRESOLVED{...}` → interpreted via in-document mapping tables                                        | `{backend.orm.transaction}` → `prisma.$transaction()`                 |
| **Framework-specific tables**        | Conditional checklists in agent configs that branch on `{frontend.framework}` / `{backend.framework}` | Guardian's per-framework review tables                                |
| **Hardcoded references**             | Direct mentions of specific frameworks in rule/skill/preamble text                                    | `NestJS ThrottlerModule` in project.config.json `template_resolution` |

The goal is to move all framework-specificity to Layer 1 (dispatch-resolvable placeholders in `project.config.json`), making the framework's `.qoder/` directory truly **project-agnostic**.

### §1.3 Reading This Document

- **§2** shows what is already parameterized (baseline)
- **§3** catalogues all remaining hardcoded assumptions (audit findings)
- **§4** provides per-stack override tables for all supported alternatives
- **§5** is the how-to guide for adding new stack support

---

## §2 Current Parameterization Status

### §2.1 Dispatch-Resolvable Placeholders (Fully Parameterized)

All 28 placeholders in [TEMPLATE_VARIABLE_STANDARD.md §2](./TEMPLATE_VARIABLE_STANDARD.md#§2-complete-placeholder-catalog) are dispatch-resolvable. These cover:

| Category       | Placeholders | What They Parameterize                                                             |
| -------------- | ------------ | ---------------------------------------------------------------------------------- |
| `{project.*}`  | 4            | Project identity, hash command                                                     |
| `{backend.*}`  | 5            | Source directory, framework, runtime, language, ORM schema                         |
| `{frontend.*}` | 7            | Source directory, framework, state management, UI library, CSS, DTO path, env path |
| `{cache.*}`    | 2            | Cache engine, client library                                                       |
| `{queue.*}`    | 1            | Queue engine                                                                       |
| `{db.*}`       | 2            | ORM, database engine                                                               |
| `{auth.*}`     | 3            | Auth mechanism, token/refresh TTL                                                  |
| `{testing.*}`  | 4            | Unit/E2E/Integration frameworks, coverage threshold                                |

### §2.2 Extended Placeholders (Partially Parameterized)

All 12 extended placeholders in [TEMPLATE_VARIABLE_STANDARD.md §3](./TEMPLATE_VARIABLE_STANDARD.md#§3-extended-placeholders-in-document-mapping) provide in-document mapping tables:

| Placeholder                      | Used In                       |                 Abstract?                  |
| -------------------------------- | ----------------------------- | :----------------------------------------: |
| `{backend.orm.transaction}`      | `backend-coding-standard.md`  | ✅ Abstract — any ORM with transaction API |
| `{backend.auth}`                 | `backend-coding-standard.md`  |      ✅ Abstract — any auth mechanism      |
| `{backend.rate_limit}`           | `backend-coding-standard.md`  |       ✅ Abstract — any rate limiter       |
| `{backend.error_handler}`        | `backend-coding-standard.md`  |      ✅ Abstract — any error handler       |
| `{backend.logger}`               | `backend-coding-standard.md`  |          ✅ Abstract — any logger          |
| `{backend.api_docs}`             | `backend-coding-standard.md`  |      ✅ Abstract — any API docs tool       |
| `{backend.cache_pattern}`        | `backend-coding-standard.md`  |      ✅ Abstract — any cache strategy      |
| `{frontend.css_strategy}`        | `frontend-coding-standard.md` |       ✅ Abstract — any CSS strategy       |
| `{frontend.state_pattern}`       | `frontend-coding-standard.md` |     ✅ Abstract — any state management     |
| `{frontend.component_hierarchy}` | `frontend-coding-standard.md` |  ✅ Abstract — any component organization  |
| `{frontend.lazy_loading}`        | `frontend-coding-standard.md` |  ✅ Abstract — any lazy loading mechanism  |
| `{frontend.api_pattern}`         | `frontend-coding-standard.md` |    ✅ Abstract — any API encapsulation     |

### §2.3 Guardian Framework Tables (Already Multi-Stack)

The `guardian.md` agent config already contains explicit **per-framework review checklists**:

**Frontend** (line 90-97):
| Framework | Supported? |
|-----------|:----------:|
| Angular | ✅ Full checklist |
| React | ✅ Full checklist |
| Vue | ✅ Full checklist |
| _(unconfigured)_ | ⚠️ Warning mode |

**Backend** (line 109-116):
| Framework | Supported? |
|-----------|:----------:|
| NestJS | ✅ Full checklist |
| Express | ✅ Full checklist |
| Fastify | ✅ Full checklist |
| _(unconfigured)_ | ⚠️ Warning mode |

---

## §3 Audit Findings — Remaining Hardcoded Assumptions

The following framework-specific references are **not yet parameterized** and would need manual edits when switching tech stacks.

### §3.1 Severity Classification

| Severity     | Symbol | Meaning                                                                         |
| ------------ | :----: | ------------------------------------------------------------------------------- |
| **BLOCKER**  |   🔴   | Framework switch requires changes in this file; no fallback exists              |
| **WARNING**  |   🟡   | Contains framework-specific examples but has generic qualifiers or alternatives |
| **COSMETIC** |   🟢   | Mention of framework name in descriptive text or examples; no functional impact |

### §3.2 Detailed Findings

#### 3.2.1 Rule Files

| #   | File                          | Line(s) | Finding                                                                                                           | Severity | Remediation                                                                      |
| --- | ----------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------- | :------: | -------------------------------------------------------------------------------- |
| R1  | `backend-coding-standard.md`  | 32      | `"DTO uses class + class-validator"` listed under **Tier 1 Universal** — but `class-validator` is NestJS-specific |    🔴    | Move to Tier 2; replace with `{backend.validation}` placeholder                  |
| R2  | `frontend-coding-standard.md` | 20      | `@Component` decorator mention — Angular-specific (has "or equivalent decorator" qualifier)                                  |    🟡    | Acceptable; the qualifier covers non-Angular frameworks                          |
| R3  | `frontend-coding-standard.md` | 50-51   | `@Input / @Output` references — Angular-specific (has `Props` alternative)                                        |    🟡    | Acceptable; dual-naming covers React/Vue                                         |
| R4  | `frontend-coding-standard.md` | 77      | `Sass @import` ban — Sass/SCSS is not universal                                                                   |    🟡    | Acceptable; SCSS ban applies only if SCSS is in use                              |
| R5  | `frontend-coding-standard.md` | 141     | `"Frontend Coding Standard (Angular)"` — framework name hardcoded in doc title                                           |    🟢    | Cosmetic; replace `(Angular)` with `({frontend.framework})` or remove suffix |
| R6  | `coding-standard-common.md`   | 15-16   | `"Angular frontend framework-specific standards"` and `"NestJS backend framework-specific standards"` — framework names in descriptions                    |    🟢    | Cosmetic; update to generic descriptions                                         |
| R7  | `dag-generation-standard.md`  | 70      | `"ts + html + scss + spec"` — Angular file pattern for component implementation                                   |    🟡    | Acceptable as example; actual patterns derived from project structure            |
| R8  | `dag-generation-standard.md`  | 71      | `"NgRx Signals connection"` — Angular-specific state management wiring example                                          |    🟡    | Acceptable as example; actual wiring derived from `{frontend.state_pattern}`     |

#### 3.2.2 Agent Configs (beyond what template variables cover)

| #   | File           | Line(s) | Finding                                                                                                                                          | Severity | Remediation                                                         |
| --- | -------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | :------: | ------------------------------------------------------------------- |
| A1  | `architect.md` | 73-94   | `project.config.json` `template_resolution` values include framework-specific examples (NestJS ThrottlerModule, NgRx SignalStore patterns, etc.) |    🟢    | Expected; these are the **source of truth** for the current project |
| A2  | `guardian.md`  | 104     | Angular checklist row references SCSS, `@Input()`, `@defer`, standalone components                                                               |  ✅ N/A  | Already multi-stack; Angular row is one of three supported options  |

#### 3.2.3 Skill Files

| #   | File                                  | Line(s) | Finding                                                                          | Severity | Remediation                                                                                    |
| --- | ------------------------------------- | ------- | -------------------------------------------------------------------------------- | :------: | ---------------------------------------------------------------------------------------------- |
| S1  | `fullstack-ci-cd-guardrails/SKILL.md` | 212     | Section 6 title: `"Backend-Specific Standards (NestJS + Prisma)"` — hardcoded framework names |    🟢    | Section content is generic (Prisma seed, migration images); rename section to `"Backend-Specific Standards"` ⚠️ Not migrated to .qoder/ — exists in .opencode/ reference only |
| S2  | `devops-ci-cd-guardrails/SKILL.md`    | 18      | Example table uses `NestJS` as example value for `tech_stack.backend`            |    🟢    | Cosmetic; it's an example table cell ⚠️ Not migrated to .qoder/ — exists in .opencode/ reference only |

#### 3.2.4 Subagent Preamble

| #   | File                   | Line(s)  | Finding                                                                                                                   | Severity | Remediation                                                                                           |
| --- | ---------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------- | :------: | ----------------------------------------------------------------------------------------------------- |
| P1  | `subagent-preamble.md` | 58       | File extension list: `.ts, .js, .html, .scss, .prisma, .yaml, .yml` — `.html` and `.scss` are Angular-specific extensions |    🟡    | Replace with generic: `.ts, .js, .html, .css, .scss, .prisma, .yaml, .yml, .jsx, .tsx, .vue, .svelte` |
| P2  | `subagent-preamble.md` | 121, 125 | Invocation summary example uses `nestjs` in Context7 query example                                                        |    🟢    | Cosmetic; it's an example in documentation                                                            |

#### 3.2.5 Project Execution Rules

| #   | File                      | Line(s) | Finding                                       | Severity | Remediation                                        |
| --- | ------------------------- | ------- | --------------------------------------------- | :------: | -------------------------------------------------- |
| E1  | `universal-project-execution-rules.md` | 166     | Section header: `"Backend Project Extensions"`    |    🔴    | Rename to `"Backend Project Extensions"` or parameterize         |
| E2  | `universal-project-execution-rules.md` | 179-181 | `"NestJS-Specific MCP Checks"` subsection              |    🔴    | Remove or replace with generic `"Backend Framework MCP Checks"` |
| E3  | `universal-project-execution-rules.md` | 220     | Stack listing includes `NestJS` as an example |    🟢    | Cosmetic; it's one example in a list               |

### §3.3 Summary Statistics

| Severity      | Count | Files Affected                                                                      |
| ------------- | :---: | ----------------------------------------------------------------------------------- |
| 🔴 BLOCKER    |   3   | `backend-coding-standard.md`, `universal-project-execution-rules.md`                             |
| 🟡 WARNING    |   6   | `frontend-coding-standard.md`, `dag-generation-standard.md`, `subagent-preamble.md` |
| 🟢 COSMETIC   |   8   | Various                                                                             |
| ✅ Already OK |  N/A  | `guardian.md`, `architect.md`, `coder-be.md`, `coder-fe.md`, most skills            |

---

## §4 Supported Tech Stack Combinations

### §4.1 Backend Framework Alternatives

To switch the backend framework, update these keys in `project.config.json`:

| Key in `project.config.json`          | NestJS (current) | Express              | Fastify            | Django (Python) | Spring Boot (Java) | Go (net/http) |
| ------------------------------------- | ---------------- | -------------------- | ------------------ | --------------- | ------------------ | ------------- |
| `tech_stack.backend.framework`        | `NestJS`         | `Express`            | `Fastify`          | `Django`        | `Spring Boot`      | `Go`          |
| `tech_stack.backend.runtime`          | `Node.js 22.x`   | `Node.js 22.x`       | `Node.js 22.x`     | `Python 3.12`   | `Java 21`          | `Go 1.22`     |
| `tech_stack.backend.language`         | `TypeScript 5.x` | `TypeScript 5.x`     | `TypeScript 5.x`   | `Python 3.12`   | `Java 21`          | `Go 1.22`     |
| `tech_stack.backend.context7_library` | `/nestjs/nest`   | `/expressjs/express` | `/fastify/fastify` | _(N/A)_         | _(N/A)_            | _(N/A)_       |

**Additional Overrides in `template_resolution`:**

| Key                     | NestJS Value                                                                   | Express Value                                                                   | Fastify Value                                                          |
| ----------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `backend.auth`          | `JWT + Passport with @Roles() and @SkipAuth() decorators`                      | `JWT + Passport.js middleware with role-check middleware`                       | `JWT + @fastify/jwt with preHandler hooks`                             |
| `backend.rate_limit`    | `NestJS ThrottlerModule: 15/min auth, 60/min admin, 120/min health`            | `express-rate-limit: 15/min auth, 60/min admin, 120/min health`                 | `@fastify/rate-limit: 15/min auth, 60/min admin, 120/min health`       |
| `backend.error_handler` | `Global ExceptionFilter + PrismaExceptionFilter, unified ResponseDto envelope` | `Custom error-handling middleware + Prisma error mapper, unified JSON envelope` | `Fastify setErrorHandler + Prisma error mapper, unified JSON envelope` |
| `backend.logger`        | `NestJS Logger with request interceptor (method, URL, status, duration)`       | `Winston with request-logger middleware (method, URL, status, duration)`        | `Pino with request hook (method, URL, status, duration)`               |
| `backend.api_docs`      | `Swagger/OpenAPI via @nestjs/swagger with @ApiProperty decorators`             | `Swagger/OpenAPI via swagger-jsdoc + swagger-ui-express`                        | `Swagger/OpenAPI via @fastify/swagger`                                 |

### §4.2 Frontend Framework Alternatives

| Key in `project.config.json`           | Angular (current)  | React             | Vue 3             | Svelte             |
| -------------------------------------- | ------------------ | ----------------- | ----------------- | ------------------ |
| `tech_stack.frontend.framework`        | `Angular 21+`      | `React 19+`       | `Vue 3.5+`        | `Svelte 5+`        |
| `tech_stack.frontend.language`         | `TypeScript 5.x`   | `TypeScript 5.x`  | `TypeScript 5.x`  | `TypeScript 5.x`   |
| `tech_stack.frontend.state_management` | `NgRx SignalStore` | `Zustand`         | `Pinia`           | `Svelte Store`     |
| `tech_stack.frontend.ui_library`       | `PrimeNG`          | `shadcn/ui`       | `PrimeVue`        | `shadcn-svelte`    |
| `tech_stack.frontend.css`              | `Tailwind CSS v4`  | `Tailwind CSS v4` | `Tailwind CSS v4` | `Tailwind CSS v4`  |
| `tech_stack.frontend.context7_library` | `/angular/angular` | `/reactjs/react`  | `/vuejs/vue`      | `/sveltejs/svelte` |

**Additional Overrides in `template_resolution`:**

| Key                            | Angular Value                                                                       | React Value                                                                      | Vue Value                                                                       | Svelte Value                                                                 |
| ------------------------------ | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `frontend.dto_path`            | `src/app/shared/dto/`                                                               | `src/shared/dto/`                                                                | `src/shared/dto/`                                                               | `src/lib/shared/dto/`                                                        |
| `frontend.env_path`            | `src/environments/environment.ts`                                                   | `src/config/env.ts`                                                              | `src/config/env.ts`                                                             | `src/lib/config/env.ts`                                                      |
| `frontend.css_strategy`        | `Tailwind CSS v4 First; SCSS for complex animations; BEM naming for private styles` | `Tailwind CSS v4 First; CSS Modules for complex cases`                           | `Tailwind CSS v4 First; Scoped styles for complex cases`                        | `Tailwind CSS v4 First; Scoped styles for complex cases`                     |
| `frontend.state_pattern`       | `NgRx SignalStore: signalStore() + withState() + withComputed() + withMethods()`    | `Zustand: create() with immer middleware; selectors via useShallow`              | `Pinia: defineStore() with state/getters/actions`                               | `Svelte Store: writable/derived + $state rune`                               |
| `frontend.component_hierarchy` | `Atomic Design: Atoms → Molecules → Organisms → Layouts → Pages`                    | `Component Composition: Base → Composite → Page`                                 | `SFC Hierarchy: Base → Composite → Page`                                        | `SFC Hierarchy: Base → Composite → Page`                                     |
| `frontend.lazy_loading`        | `Angular loadChildren/loadComponent + @defer(on viewport)`                          | `React.lazy() + Suspense + dynamic import`                                       | `defineAsyncComponent + Suspense + dynamic import`                              | `{#await} + dynamic import`                                                  |
| `frontend.api_pattern`         | `Service encapsulation + DTO alignment; HttpClient forbidden in components`         | `Custom hook encapsulation + DTO alignment; fetch/axios forbidden in components` | `Composable encapsulation + DTO alignment; fetch/axios forbidden in components` | `Store/service encapsulation + DTO alignment; fetch forbidden in components` |

### §4.3 ORM / Database Alternatives

| Key                                           | Prisma (current)                                      | TypeORM                                               | Sequelize                                                     | Knex                                      | SQLAlchemy (Python)                               | GORM (Go)                            |
| --------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------- | ------------------------------------ |
| `tech_stack.database.orm`                     | `Prisma`                                              | `TypeORM`                                             | `Sequelize`                                                   | `Knex`                                    | `SQLAlchemy`                                      | `GORM`                               |
| `tech_stack.database.version`                 | `7.x`                                                 | `0.3.x`                                               | `6.x`                                                         | `3.x`                                     | `2.0`                                             | `1.x`                                |
| `template_resolution.backend.orm.schema`      | `booking-backend/prisma/schema.prisma`                | `booking-backend/src/data-source.ts`                  | `booking-backend/src/models/`                                 | `booking-backend/src/knexfile.ts`         | `booking-backend/models.py`                       | `booking-backend/models/`            |
| `template_resolution.backend.orm.transaction` | `Prisma $transaction() with interactive transactions` | `TypeORM dataSource.transaction() with EntityManager` | `Sequelize sequelize.transaction() with managed transactions` | `Knex knex.transaction() with trx object` | `SQLAlchemy session.begin() with context manager` | `GORM db.Transaction() with closure` |

### §4.4 Cache Alternatives

| Key                                | Current     | Alternatives                                  |
| ---------------------------------- | ----------- | --------------------------------------------- |
| `tech_stack.cache.engine`          | `Redis 7.x` | `Memcached 1.6`, `Dragonfly 1.x`, `Hazelcast` |
| `tech_stack.cache.client`          | `ioredis`   | `node-redis`, `redis-py`, `go-redis`          |
| `template_resolution.cache.engine` | `Redis 7.x` | _(as above)_                                  |
| `template_resolution.cache.client` | `ioredis`   | _(as above)_                                  |

### §4.5 Queue Alternatives

| Key                                | Current  | Alternatives                                            |
| ---------------------------------- | -------- | ------------------------------------------------------- |
| `tech_stack.queue`                 | `BullMQ` | `RabbitMQ`, `Apache Kafka`, `AWS SQS`, `Google Pub/Sub` |
| `template_resolution.queue.engine` | `BullMQ` | _(as above)_                                            |

### §4.6 Auth Alternatives

| Key                                | Current          | Alternatives                                                            |
| ---------------------------------- | ---------------- | ----------------------------------------------------------------------- |
| `tech_stack.auth.mechanism`        | `JWT + Passport` | `OAuth 2.0 + OpenID Connect`, `Session-based`, `API Key`, `AWS Cognito` |
| `tech_stack.auth.token_validity`   | `15m`            | Any duration                                                            |
| `tech_stack.auth.refresh_validity` | `7d`             | Any duration                                                            |

### §4.7 Testing Tool Alternatives

| Key                                     | Current                      | Alternatives                                            |
| --------------------------------------- | ---------------------------- | ------------------------------------------------------- |
| `tech_stack.testing.unit`               | `Jest 29+`                   | `Vitest`, `Mocha + Chai`, `pytest`, `JUnit`             |
| `tech_stack.testing.e2e`                | `Playwright`                 | `Cypress`, `Selenium`, `Puppeteer`                      |
| `tech_stack.testing.integration`        | `Supertest + Testcontainers` | `Cypress component`, `Testing Library`, `pytest-django` |
| `tech_stack.testing.coverage_threshold` | `80`                         | Any percentage                                          |

---

## §5 How-To Guide: Adding Support for a New Tech Stack

### §5.1 Decision Flow

```
┌─────────────────────────────────────────────────┐
│ 1. Is the new stack a variant of an existing     │
│    category (e.g., new frontend framework)?      │
│    ├─ YES → Go to §5.2 (Minor Addition)          │
│    └─ NO  → Go to §5.3 (Major Addition)          │
└─────────────────────────────────────────────────┘
```

### §5.2 Minor Addition (New Framework Variant)

Adding a new framework within an existing category (e.g., adding **Svelte** support):

#### Step 1: Update `project.config.json`

Add the new framework to the `tech_stack` section and add corresponding `template_resolution` values:

```json
{
  "tech_stack": {
    "frontend": {
      "framework": "Svelte 5+",
      "language": "TypeScript 5.x",
      "state_management": "Svelte Store",
      "ui_library": "shadcn-svelte",
      "css": "Tailwind CSS v4",
      "context7_query": "Svelte 5 runes state management",
      "context7_library": "/sveltejs/svelte"
    }
  },
  "template_resolution": {
    "frontend.src": "booking-frontend/",
    "frontend.framework": "Svelte 5+",
    "frontend.state_management": "Svelte Store",
    "frontend.ui_library": "shadcn-svelte",
    "frontend.css": "Tailwind CSS v4",
    "frontend.dto_path": "src/lib/shared/dto/",
    "frontend.env_path": "src/lib/config/env.ts",
    "frontend.css_strategy": "Tailwind CSS v4 First; Scoped styles for complex cases",
    "frontend.state_pattern": "Svelte Store: writable/derived + $state rune",
    "frontend.component_hierarchy": "SFC Hierarchy: Base → Composite → Page",
    "frontend.lazy_loading": "{#await} + dynamic import for non-critical routes",
    "frontend.api_pattern": "Store/service encapsulation + DTO alignment; fetch forbidden in components"
  }
}
```

#### Step 2: Add Guardian Review Checklist Row

In `.qoder/agents/guardian.md`, add a new row to the frontend framework table:

```markdown
| Svelte | • SFC structure (script/template/style)<br>• Rune-based reactivity ($state, $derived, $effect)<br>• Svelte Store pattern<br>• Scoped styles |
```

#### Step 3: Add Context7 Task Mapping

In `project.config.json` → `context7_task_mapping`, update the `@Coder-FE` entry's keywords to include Svelte-related terms:

```json
{
  "agent": "@Coder-FE",
  "keywords": [
    "frontend",
    "component",
    "page",
    "ui",
    "svelte",
    "rune",
    "store",
    "style",
    "tailwind",
    "routing",
    "guard"
  ],
  "stacks": ["frontend"],
  "priority": 1
}
```

#### Step 4: Verify with Framework Self-Test

```bash
node .qoder/scripts/framework-self-test.js
```

Ensure Check 17 (no UNRESOLVED placeholders) and Check 18 (template_resolution section exists) pass.

#### Step 5: Update This Document

Add the new framework to the applicable table(s) in §4 of this document.

### §5.3 Major Addition (New Stack Category)

Adding an entirely new category (e.g., adding a **Mobile** layer with React Native):

#### Step 1: Design the Namespace

Choose a namespace prefix (e.g., `mobile`) and define the keys needed:

| Placeholder                 | Purpose                 | Example Value        |
| --------------------------- | ----------------------- | -------------------- |
| `{mobile.framework}`        | Mobile framework        | `React Native 0.76+` |
| `{mobile.src}`              | Mobile source directory | `mobile-app/src/`    |
| `{mobile.state_management}` | State management        | `Zustand`            |
| `{mobile.ui_library}`       | UI component library    | `React Native Paper` |

#### Step 2: Update `project.config.json`

Add entries to both `tech_stack` and `template_resolution`:

```json
{
  "tech_stack": {
    "mobile": {
      "framework": "React Native 0.76+",
      "language": "TypeScript 5.x",
      "state_management": "Zustand",
      "ui_library": "React Native Paper"
    }
  },
  "template_resolution": {
    "mobile.src": "mobile-app/src/",
    "mobile.framework": "React Native 0.76+",
    "mobile.state_management": "Zustand",
    "mobile.ui_library": "React Native Paper"
  }
}
```

#### Step 3: Update the Template Resolver

In `.qoder/scripts/command-tools/dispatch-subagent.js`, add the new namespace to `buildTemplateResolutionMap()`:

```javascript
// In buildTemplateResolutionMap():
// Add new namespace resolution:
if (config.tech_stack.mobile) {
  map["mobile.framework"] = config.tech_stack.mobile.framework;
  map["mobile.language"] = config.tech_stack.mobile.language;
  map["mobile.state_management"] = config.tech_stack.mobile.state_management;
  map["mobile.ui_library"] = config.tech_stack.mobile.ui_library;
}
// And from template_resolution:
if (config.template_resolution) {
  const tr = config.template_resolution;
  // ...existing keys...
  if (tr["mobile.src"]) map["mobile.src"] = tr["mobile.src"];
  if (tr["mobile.state_management"])
    map["mobile.state_management"] = tr["mobile.state_management"];
  if (tr["mobile.ui_library"])
    map["mobile.ui_library"] = tr["mobile.ui_library"];
}
```

#### Step 4: Register in TEMPLATE_VARIABLE_STANDARD.md

Add a new subsection to [TEMPLATE_VARIABLE_STANDARD.md §2](./TEMPLATE_VARIABLE_STANDARD.md#§2-complete-placeholder-catalog):

```markdown
### §2.X `{mobile.*}` Placeholders

| #   | Placeholder                 | Resolves To             | Source Field                         | Example Value        |
| --- | --------------------------- | ----------------------- | ------------------------------------ | -------------------- |
| 29  | `{mobile.src}`              | Mobile source directory | `template_resolution.mobile.src`     | `mobile-app/src/`    |
| 30  | `{mobile.framework}`        | Mobile framework        | `tech_stack.mobile.framework`        | `React Native 0.76+` |
| 31  | `{mobile.state_management}` | State management        | `tech_stack.mobile.state_management` | `Zustand`            |
| 32  | `{mobile.ui_library}`       | UI component library    | `tech_stack.mobile.ui_library`       | `React Native Paper` |
```

#### Step 5: Add Guardian Review Rows

If the new category has code that @Guardian should review, add a new table to `guardian.md`.

#### Step 6: Update agent_config Files

If any agent needs to reference the new category (e.g., a `@Coder-Mobile` agent), update its config to include the new placeholders.

#### Step 7: Update Context7 Mapping

Add a new entry to `project.config.json` → `context7_task_mapping` for the new agent/category.

#### Step 8: Verify

```bash
node .qoder/scripts/framework-self-test.js
grep -r 'UNRESOLVED{' .qoder/agents/ .qoder/rules/ .qoder/skills/ .qoder/subagent-preamble.md
```

#### Step 9: Update This Document

Add the new category to §4 and update the quick reference card in §A.

---

## §6 Migration Checklist Template

When migrating the OpenCode Framework to a new tech stack, use this checklist:

### §6.1 Pre-Migration

- [ ] Identify target tech stack (backend framework, frontend framework, ORM, cache, queue)
- [ ] Review §4 of this document for applicable override values
- [ ] Read [TEMPLATE_VARIABLE_STANDARD.md](./TEMPLATE_VARIABLE_STANDARD.md) for placeholder conventions
- [ ] Create a backup branch: `git checkout -b migration/<new-stack>`

### §6.2 `project.config.json` Updates

- [ ] Update `tech_stack.backend.*` fields (framework, runtime, language, context7)
- [ ] Update `tech_stack.frontend.*` fields (framework, state_management, ui_library, css, context7)
- [ ] Update `tech_stack.database.*` fields (orm, version, engine, context7) — if changing ORM
- [ ] Update `tech_stack.cache.*` fields — if changing cache
- [ ] Update `tech_stack.queue` — if changing queue
- [ ] Update `tech_stack.auth.*` fields — if changing auth
- [ ] Update `tech_stack.testing.*` fields — if changing test frameworks
- [ ] Update ALL corresponding `template_resolution.*` keys:
  - [ ] `backend.auth`, `backend.rate_limit`, `backend.error_handler`, `backend.logger`, `backend.api_docs`
  - [ ] `backend.orm.schema`, `backend.orm.transaction`
  - [ ] `frontend.dto_path`, `frontend.env_path`
  - [ ] `frontend.css_strategy`, `frontend.state_pattern`, `frontend.component_hierarchy`
  - [ ] `frontend.lazy_loading`, `frontend.api_pattern`
  - [ ] `cache.engine`, `cache.client`, `cache.cache_pattern`
  - [ ] `queue.engine`
- [ ] Update `context7_task_mapping` keywords for all affected agents

### §6.3 Guardian Tables

- [ ] Verify the new frontend framework has a row in `guardian.md`'s frontend table
- [ ] Verify the new backend framework has a row in `guardian.md`'s backend table
- [ ] If the framework is not listed, add a new row following the pattern in §5.2 Step 2

### §6.4 Agent Config Review

- [ ] Verify `coder-be.md` template variables resolve correctly for new backend
- [ ] Verify `coder-fe.md` template variables resolve correctly for new frontend
- [ ] Verify `architect.md` references are still valid
- [ ] Verify `guardian.md` framework-specific checklists are appropriate

### §6.5 Rule File Review

- [ ] Review `backend-coding-standard.md`: ensure Tier 1 rules are truly universal; add new Tier 2 rules if needed
- [ ] Review `frontend-coding-standard.md`: ensure resolution mapping table is updated
- [ ] Review `coding-standard-common.md`: ensure no framework-specific assumptions
- [ ] Review `dag-generation-standard.md`: ensure examples are generic or clearly marked as examples

### §6.6 Skill File Review

- [ ] Check `fullstack-ci-cd-guardrails/SKILL.md` for framework-specific section titles
- [ ] Check `devops-ci-cd-guardrails/SKILL.md` for framework-specific examples
- [ ] Verify CI/CD skills are framework-agnostic or have clear framework branches

### §6.7 Preamble Review

- [ ] Update `subagent-preamble.md` line 58 file extension list to include new framework extensions
- [ ] Verify Context7 examples are updated or marked as generic

### §6.8 Validation

- [ ] Run `node .qoder/scripts/framework-self-test.js` — all checks must pass
- [ ] Run `grep -r 'UNRESOLVED{' .qoder/agents/ .qoder/rules/ .qoder/skills/ .qoder/subagent-preamble.md` — should only show expected extended placeholders
- [ ] Run `{project.contract_hash_command}` to update `machine.json` keystone hashes
- [ ] Test dispatch resolution: `node .qoder/scripts/command-tools/dispatch-subagent.js Architect "test" 2>&1 | head -100`
- [ ] Verify no hardcoded paths remain in agent configs

### §6.9 Documentation

- [ ] Update this COMPATIBILITY_PROFILE.md with the new stack's values
- [ ] Update `TEMPLATE_VARIABLE_STANDARD.md` if new placeholders were added
- [ ] Update `PROJECT_REFERENCE.md` with new tech stack information
- [ ] Commit with message: `docs(compat): migrate framework to <new-stack>`

---

## §7 Quick Reference Card

```
┌──────────────────────────────────────────────────────────────────┐
│                    COMPATIBILITY QUICK REF                       │
├──────────────────────────────────────────────────────────────────┤
│ Parameterized: 28 dispatch-resolvable + 12 extended placeholders │
│                                                                   │
│ Supported Backend Frameworks:                                     │
│   ✅ NestJS (current)   ✅ Express    ✅ Fastify                   │
│   ⚠️ Django (Python)    ⚠️ Spring Boot (Java)  ⚠️ Go            │
│                                                                   │
│ Supported Frontend Frameworks:                                    │
│   ✅ Angular (current)  ✅ React      ✅ Vue 3                    │
│   ⚠️ Svelte                                                      │
│                                                                   │
│ Supported ORMs:                                                   │
│   ✅ Prisma (current)   ⚠️ TypeORM   ⚠️ Sequelize   ⚠️ Knex    │
│                                                                   │
│ Guardian Tables: Frontend 3 rows | Backend 3 rows                 │
│                                                                   │
│ 🔴 BLOCKER findings: 3  (class-validator in Tier 1, NestJS MCP    │
│                          section, Node.js/NestJS section header)  │
│ 🟡 WARNING findings: 6  (template examples, file extensions)     │
│ 🟢 COSMETIC findings: 8  (descriptive text, example values)      │
│                                                                   │
│ To switch stacks: Update project.config.json → run self-test      │
│ To add new stack: Follow §5 of COMPATIBILITY_PROFILE.md           │
│                                                                   │
│ Key Reference: TEMPLATE_VARIABLE_STANDARD.md                      │
│ Source of Truth: project.config.json                              │
└──────────────────────────────────────────────────────────────────┘
```

---

## §8 Related Documents

| Document                                                         | Relationship                                                                  |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| [TEMPLATE_VARIABLE_STANDARD.md](./TEMPLATE_VARIABLE_STANDARD.md) | Placeholder catalog and resolution mechanism                                  |
| `project.config.json`                                            | **Source of truth** for all stack values                                      |
| `.qoder/scripts/command-tools/dispatch-subagent.js`           | Template resolver implementation                                              |
| `.qoder/scripts/framework-self-test.js`                       | Validation (Check 17: UNRESOLVED placeholders, Check 18: template_resolution) |
| `.qoder/agents/guardian.md`                                   | Per-framework review checklists                                               |
| `.qoder/rules/backend-coding-standard.md`                     | Backend Tier 2 extended placeholder resolution table                          |
| `.qoder/rules/frontend-coding-standard.md`                    | Frontend Tier 2 resolution mapping table                                      |
| `.qoder/rules/coding-standard-common.md`                      | Framework-agnostic Tier 1 rules                                               |

---

_This document will be updated when new tech stack support is added or when additional hardcoded assumptions are identified and parameterized._
