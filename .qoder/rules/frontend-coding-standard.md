---
type: model_decision
description: When working on frontend code
---

# Frontend Coding Standard — Layered Template

> **See also**: [coding-standard-common.md](.qoder/rules/coding-standard-common.md) — Framework-agnostic common coding standards (naming conventions, type safety, TDD, file separation, import ordering, file length limits, JSDoc, Git commit format, etc.). Tier 1 rules are fully defined in that file.

This document is the layered template for the frontend coding standard: **Tier 1** contains immutable universal rules for all frontend projects, **Tier 2** contains framework-parameterized rules referenced via `{frontend.*}` placeholders from project configuration. Each project injects specific implementations through `project.config.json` and `context/code_standards/frontend-coding-standard.md`.

---

## Tier 1 — Universal Rules

The following rules apply to all frontend frameworks (Angular / React / Vue / Svelte, etc.) and are immutable. Full definitions and code examples are in [coding-standard-common.md](.qoder/rules/coding-standard-common.md).

### 1. File Separation

It is **prohibited** to use inline `template` or `styles` strings in `@Component` (or equivalent decorators). Component logic, template, and styles must be physically separated into three independent files.

### 2. No `any` Type

All function parameters, return values, and variables must have explicit TypeScript type annotations. The `any` type is prohibited. When dynamic types are truly needed, use `unknown` + type guards.

### 3. Import Ordering

Import statements must be grouped in the following order, separated by blank lines between groups, sorted alphabetically within each group:

1. External dependencies (third-party packages)
2. Internal modules (absolute path imports from the project's `src/`)
3. Relative imports (relative paths from the same level or subdirectories)

### 4. TDD Mandate (RED → GREEN → REFACTOR)

- **RED**: Write test cases first; execution must fail
- **GREEN**: Write the **minimal** code to make tests pass
- **REFACTOR**: Refactor only after all tests pass
- It is **prohibited** to write business code without corresponding test cases
- Minimum coverage: Lines / Branches / Functions all ≥ 70%, core business paths ≥ 90%

### 5. File Length Limits

- Component logic files (`.component.ts`) must not exceed 400 lines
- Template files (`.component.html`) must not exceed 200 lines
- When exceeded, must split into smaller sub-components or helper modules

### 6. JSDoc Documentation

All public APIs (component `@Input` / `@Output`, Service public methods, Store methods) must include JSDoc comments explaining purpose, parameters, and return values. Complex logic must have inline comments explaining **why** rather than **what**.

### 7. Git Commit Format

```text
<type>[scope]: <description>

[optional body]
```

TDD phase tags (mandatory):
| Phase | Tag | Example |
|:---|:---|:---|
| RED (test-first) | `[Red] {task_id}` | `test(booking): add unit tests [Red] T-014` |
| GREEN (implementation passes) | `[Green] {task_id}` | `feat(booking): implement creation [Green] T-014` |
| REFACTOR (refactoring) | `[Refactor] {task_id}` | `refactor(booking): extract logic [Refactor] T-014` |

---

## Tier 2 — Framework-Parameterized Rules

The following standards are referenced via `{frontend.*}` placeholders from project configuration. Each project injects specific implementations through `project.config.json` and `context/code_standards/frontend-coding-standard.md`.

### 8. CSS Strategy

**Placeholder**: `{frontend.css_strategy}`

Prefer the project-configured CSS solution for styling. Component-private styles serve only as supplements. Global style files are used only for CSS resets, font imports, and global variable definitions. The use of deprecated CSS features (e.g., Sass `@import`) is prohibited.

> **Current resolved value and config source: see [Resolution Block](#resolution-block) below.**

### 9. State Management

**Placeholder**: `{frontend.state_pattern}`

Follow the project-configured state management pattern:

- Page components may inject the global state Store
- Presentational child components (atoms / molecules) are **prohibited** from directly accessing global state; they must receive data via `@Input()` / Props
- Each feature domain has its own independent Store, with State, Computed, and Methods separated within the Store

> **Current resolved value and config source: see [Resolution Block](#resolution-block) below.**

### 10. Component Hierarchy

**Placeholder**: `{frontend.component_hierarchy}`

Components must be organized according to the project-defined hierarchy architecture, strictly following hierarchy dependency constraints: upper layers may depend on lower layers; lower layers are prohibited from depending on upper layers. Components reused across domains are promoted to the shared directory.

> **Current resolved value and config source: see [Resolution Block](#resolution-block) below.**

### 11. Lazy Loading

**Placeholder**: `{frontend.lazy_loading}`

Non-initial-screen routes and content must use the project framework's lazy loading mechanism for on-demand loading, reducing initial bundle size. Critical first-screen paths are unrestricted.

> **Current resolved value and config source: see [Resolution Block](#resolution-block) below.**

### 12. API Encapsulation

**Placeholder**: `{frontend.api_pattern}`

All HTTP requests must be encapsulated through the Service layer; components are **prohibited** from directly calling HTTP clients. DTOs (Data Transfer Objects) are defined in independent files and must strictly align with the backend API response format (field names, types, and nested structures must be completely identical). Service methods return Promises (or the framework's equivalent async primitive).

> **Current resolved value and config source: see [Resolution Block](#resolution-block) below.**

---

## Resolution Block

The table below resolves each Tier 2 placeholder to the current project's specific implementation values. When the project's tech stack changes, only this mapping table and the corresponding `context/code_standards/frontend-coding-standard.md` implementation document need updating; Tier 1 universal rules require no modification.

| Rule # | Placeholder                           | Current Project Resolved Value                                                                                                                                                                                          | Config Source                                                         |
| :----: | :------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------- |
|   8    | `{frontend.css_strategy}`        | **Tailwind CSS v4 First** — Prefer Tailwind utility classes for layout/spacing/color/font; SCSS only for scenarios Tailwind cannot cover (complex animations, pseudo-elements); component-private styles use BEM naming                                                         | `project.config.json` → `frontend.css`; Implementation doc §5              |
|   9    | `{frontend.state_pattern}`       | **NgRx SignalStore** — Page components inject Store and subscribe to `vm` Signal; molecule/atom components receive data via `@Input()`; each feature domain has its own Store (`signalStore()` + `withState()` + `withComputed()` + `withMethods()`)                 | `project.config.json` → `frontend.state_management`; Implementation doc §6 |
|   10   | `{frontend.component_hierarchy}` | **Atomic Design** — `Atoms → Molecules → Organisms → Layouts → Pages` (original "Templates" layer renamed to "Layouts"); Pages are prohibited from directly depending on Molecules/Atoms                                                             | `context/code_standards/frontend-coding-standard.md` §1.2        |
|   11   | `{frontend.lazy_loading}`        | **Angular Route Lazy Loading + `@defer` Deferred Views** — Root routes lazy-load feature modules via `loadChildren`; features lazy-load page components via `loadComponent`; non-initial-screen content uses `@defer (on viewport)`                                        | `context/code_standards/frontend-coding-standard.md` §8          |
|   12   | `{frontend.api_pattern}`         | **Service Layer Encapsulation + Strict DTO Alignment** — Components are prohibited from using `HttpClient` directly; all HTTP requests are encapsulated in `*Service` classes (`@Injectable({ providedIn: 'root' })`); DTO files are independent at `features/*/dto/`; interface names must exactly match backend API response field names | `context/code_standards/frontend-coding-standard.md` §7          |

### Change Management Rules

1. **Tier 1 Rule Modifications** (Rules 1–7): Must synchronously update `coding-standard-common.md` as the authoritative source and update the reference here.
2. **Tier 2 Resolved Value Changes**: When the project tech stack changes, update the "Current Project Resolved Value" column in the Resolution Block above, and synchronously update the corresponding implementation section in `context/code_standards/frontend-coding-standard.md`.
3. **New Tier 2 Rules**: Add new rule entries with `{frontend.*}` placeholders in the Tier 2 section, and add a corresponding row in the Resolution Block.

---

## Full Implementation Document

For the complete specification and framework-specific code examples, see: [Frontend Coding Standard Document (Angular)](.qoder/context/code_standards/frontend-coding-standard.md)
