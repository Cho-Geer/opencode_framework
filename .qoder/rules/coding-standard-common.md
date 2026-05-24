---
type: always
description: Universal coding standards
---

# Framework-Agnostic Common Coding Standard

This document extracts all **framework-agnostic** common coding rules from the project's frontend and backend code standards, serving as the unified baseline standard for the entire project.
For framework-specific rules, please refer to their respective standard files.

## Related Documents

| Document | Purpose |
| :--- | :--- |
| [Frontend Coding Standard](.qoder/rules/frontend-coding-standard.md) | Angular frontend framework-specific standards |
| [Backend Coding Standard](.qoder/rules/backend-coding-standard.md) | NestJS backend framework-specific standards |
| [Frontend Coding Standard (Detailed)](.qoder/context/code_standards/frontend-coding-standard.md) | Complete frontend context standards |
| [Backend Coding Standard (Detailed)](.qoder/context/code_standards/backend-coding-standard.md) | Complete backend context standards |

---

## 1. File Naming Conventions

### Rules

| Type | Naming Rule | Example |
| :--- | :--- | :--- |
| **Files** | `kebab-case` | `booking-form.component.ts`, `appointment.service.ts` |
| **Classes** | `PascalCase` | `BookingFormComponent`, `AppointmentService`, `AuthController` |
| **Interfaces** | `PascalCase`, **no `I` prefix** | `Appointment`, `UserSession`, `LoginResponse` |
| **Type Aliases** | `PascalCase` | `AppointmentStatus`, `UserRole` |
| **Enums** | `PascalCase`, members `UPPER_SNAKE_CASE` | `enum AppointmentStatus { PENDING, CONFIRMED }` |
| **Constants** | `UPPER_SNAKE_CASE` | `MAX_RETRY_COUNT`, `JWT_EXPIRES_IN` |
| **Variables/Functions** | `camelCase` | `currentUser`, `findAvailableSlots()` |
| **Private Members** | Per frontend/backend convention (frontend `_` prefix or framework convention, backend `private readonly`) | `_http` (FE), `private readonly userRepository` (BE) |

### Rationale

Unified naming conventions reduce cognitive load, enabling developers to seamlessly switch between frontend and backend codebases.

### Source

- Frontend Coding Standard §3.1 (`.qoder/context/code_standards/frontend-coding-standard.md`)
- Backend Coding Standard §3.1 (`.qoder/context/code_standards/backend-coding-standard.md`)

---

## 2. File Separation Principle

### Rules

Each file is responsible for **one** concept only (one class, one component, one service, one DTO, one guard, etc.).

It is **prohibited** to mix multiple classes, components, or logic with different responsibilities into the same file.

### Rationale

- Improves code readability and maintainability
- Reduces merge conflict probability
- Makes code reviews more focused

### Source

- Frontend Coding Standard §1.1 Separation of Concerns (`.qoder/context/code_standards/frontend-coding-standard.md`)
- Backend Coding Standard §1.1 Modularization and Separation of Concerns (`.qoder/context/code_standards/backend-coding-standard.md`)

---

## 3. No `any` Type

### Rules

The use of TypeScript `any` type is **strictly prohibited**.

All function parameters, return values, and variables must have explicit type annotations. For cases where the type truly cannot be determined, use `unknown` with type guards.

```typescript
// ❌ Prohibited
async create(data: any): Promise<any> { ... }
const items: any[] = [];

// ✅ Correct
async create(data: CreateAppointmentDto): Promise<Appointment> { ... }
const items: Appointment[] = [];
```

### Rationale

The `any` type bypasses TypeScript's type checking system, rendering type safety ineffective and increasing the risk of runtime errors.

### Source

- Frontend Coding Standard §3.2 Type Safety (`.qoder/context/code_standards/frontend-coding-standard.md`)
- Backend Coding Standard §3.2 Type Safety (`.qoder/context/code_standards/backend-coding-standard.md`)

---

## 4. Import Ordering Convention

### Rules

Import statements must be grouped in the following order, separated by blank lines between groups:

1. **External dependencies** (third-party packages, e.g., `express`, `react`, `lodash`, `class-validator`)
2. **Internal modules** (absolute path imports from within the project's `src/`, e.g., `../../common/database/database.service`)
3. **Relative imports** (relative paths from the same level or subdirectories, e.g., `./dto/create-appointment.dto`)

Each group is sorted alphabetically.

```typescript
// 1. External dependencies
import { Router, Request, Response } from 'express';
import { IsString, IsUUID } from 'class-validator';
import { debounce, cloneDeep } from 'lodash';

// 2. Internal modules
import { DatabaseService } from '../../common/database/database.service';
import { EmailService } from '../email/email.service';

// 3. Relative imports
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { Appointment } from './interfaces/appointment.interface';
```

### Rationale

Unified import ordering makes dependency relationships clear at a glance, enabling quick identification of external and internal module dependencies.

### Source

- Frontend Coding Standard §3.3 Component Class Structure (implied import organization requirements)
- Backend Coding Standard §3.3 Class Member Ordering (implied import organization requirements)

---

## 5. Error Handling Patterns

### Rules

#### Backend

| Exception Type | Use Case | HTTP Status Code |
| :--- | :--- | :--- |
| Resource Not Found (404) | Requested resource not found | 404 |
| Business Conflict (409) | Appointment conflict, duplicate operation | 409 |
| Parameter Validation Failure (400) | Request parameters do not meet rules | 400 |
| Authentication Failure (401) | No valid identity credentials provided | 401 |
| Insufficient Permissions (403) | Identity verified but insufficient permissions | 403 |

Use a unified "global exception handling layer" for error capture, and map database/ORM errors to the standard HTTP error responses above.

#### Frontend

- Store methods must use `try-catch` to capture async operation errors
- Error messages must be written to the Store's `error` state field
- The UI layer displays user-friendly error messages via `vm.error`

```typescript
// Backend example
if (timeSlot.currentSequence > timeSlot.capacity) {
  throw new Error('This time slot is fully booked'); // In actual projects, use the framework's corresponding business exception type
}

// Frontend example (Store)
async loadAppointments(date: string): Promise<void> {
  patchState(store, { isLoading: true, error: null });
  try {
    const appointments = await bookingService.getByDate(date);
    patchState(store, { appointments, isLoading: false });
  } catch (error) {
    patchState(store, {
      error: error instanceof Error ? error.message : 'Unknown error',
      isLoading: false,
    });
  }
}
```

### Rationale

Unified error handling ensures users receive consistent error feedback, while facilitating operations team monitoring and issue localization.

### Source

- Backend Coding Standard §6.3 Exception Handling, §11 Error Handling (`.qoder/context/code_standards/backend-coding-standard.md`)
- Frontend Coding Standard §6 Error Handling Patterns in Store Structure (`.qoder/context/code_standards/frontend-coding-standard.md`)

---

## 6. Logging Standards

### Rules

All services and critical business logic must include structured logging.

#### Backend

Use the project's logging framework (e.g., NestJS Logger, Winston, Pino, etc.):

```typescript
// Choose the logging solution appropriate for the project's tech stack; below is a generic log level pattern
logger.info('Appointment created successfully');     // INFO — Normal business flow
logger.warn('Slot capacity approaching limit');     // WARNING — Requires attention
logger.error('Failed to create appointment', err);  // ERROR — Requires fix
logger.debug(`Processing slot: ${slotId}`);         // DEBUG — Development environment only
```

"Request logging middleware" (or a generic logging interception mechanism) should automatically record key information for each request (method, path, user identifier, status code, duration).

#### Frontend

- Exercise restraint when using frontend framework console methods; prefer passing errors through state management's `error` state
- Critical API call failures should output detailed error logs in the development environment
- `console.log` is prohibited in production

### Rationale

Structured logging is the foundation of observability, facilitating fault diagnosis, performance analysis, and security auditing.

### Source

- Backend Coding Standard §12 Logging Standards (`.qoder/context/code_standards/backend-coding-standard.md`)

---

## 7. TDD Requirements (Test-Driven Development)

### Rules

All code implementation must strictly follow the **RED → GREEN → REFACTOR** cycle:

1. **RED**: Write test cases first; execution must **fail**
2. **GREEN**: Write the **minimal** code to make tests pass
3. **REFACTOR**: Refactor code only after all tests pass

It is **prohibited** to write any business implementation code without corresponding test cases.

### Coverage Requirements

| Type | Minimum Coverage |
| :--- | :--- |
| Line Coverage (Lines) | 70% |
| Branch Coverage (Branches) | 70% |
| Function Coverage (Functions) | 70% |
| Core Business Paths (Core Business) | 90%+ |

### Test File Location

- Test files are co-located with source files in the same directory, using the `.spec.ts` suffix
- Test reports are uniformly output to `.task_temp/{taskId}/test_report.json` and must include the `execution_evidence` field

### Rationale

TDD ensures code testability, reduces regression defects, and coverage requirements provide a quality baseline.

### Source

- Frontend Coding Standard §10 Testing Standards (`.qoder/context/code_standards/frontend-coding-standard.md`)
- Backend Coding Standard §14 Testing Standards (`.qoder/context/code_standards/backend-coding-standard.md`)

---

## 8. Maximum File Length

### Rules

- A single file **should not exceed 400 lines** (including comments and blank lines)
- When exceeded, it must be split into smaller modules/components/services
- Frontend template files (`.component.html`) **should not exceed 200 lines**
- When limits are exceeded, prioritize extracting sub-components or helper functions

### Rationale

Long files are difficult to read, understand, and maintain, increasing code review burden and merge conflict risk.

### Source

- Frontend Coding Standard §4.3 Template Size (`.qoder/context/code_standards/frontend-coding-standard.md`)

---

## 9. Comments & Documentation Standards

### Rules

#### JSDoc Comments

All public methods, classes, and interfaces must have JSDoc comments explaining purpose, parameters, and return values:

```typescript
/**
 * Create appointment — high-concurrency atomic preemption
 * Relies on PostgreSQL partial unique index + slot_sequence atomic increment
 * @param dto - Create appointment data transfer object
 * @returns The newly created appointment record
 * @throws ConflictException - Thrown when appointment slots are full
 */
async create(dto: CreateAppointmentDto): Promise<Appointment> { ... }
```

#### API Documentation

- All backend endpoints must have complete API documentation decorators (e.g., NestJS/Swagger's `@ApiOperation`, `@ApiResponse`, or OpenAPI annotations)
- All DTO fields must have corresponding documentation description decorators

#### Inline Comments

- Complex logic must have inline comments explaining **why** something is done, not **what** is being done
- Avoid redundant comments (e.g., `// create a user` immediately following `createUser()`)

### Rationale

Good documentation reduces knowledge silos, accelerates onboarding of new members, and reduces long-term maintenance costs.

### Source

- Backend Coding Standard §13 Swagger/OpenAPI Documentation (`.qoder/context/code_standards/backend-coding-standard.md`)
- Frontend Coding Standard §11 Comment Standards in DTO Naming Alignment (`.qoder/context/code_standards/frontend-coding-standard.md`)

---

## 10. Git Commit Message Format

### Rules

Commit messages must follow this format:

```
<type>[scope]: <description>

[optional body]
```

#### TDD Phase Tags (Mandatory)

Based on the TDD phase, commit messages must include the corresponding tag:

| TDD Phase | Tag | Example |
| :--- | :--- | :--- |
| RED (test-first) | `[Red] {task_id}` | `test(booking): add appointment creation unit tests [Red] T-014` |
| GREEN (implementation passes) | `[Green] {task_id}` | `feat(booking): implement appointment creation [Green] T-014` |
| REFACTOR (refactoring) | `[Refactor] {task_id}` | `refactor(booking): extract slot preemption logic [Refactor] T-014` |

#### Type Prefix

| Type | Purpose |
| :--- | :--- |
| `feat` | New feature |
| `fix` | Bug fix |
| `refactor` | Code refactoring (no functional change) |
| `test` | Adding or modifying tests |
| `docs` | Documentation changes |
| `style` | Formatting adjustments (no logic impact) |
| `chore` | Build/tool/dependency changes |

### Rationale

Standardized commit messages make Git history readable and searchable; TDD tags support automated quality gate verification.

### Source

- Frontend Coding Standard §10 Testing Process (implied TDD phase commit requirements)
- Backend Coding Standard §14.1 TDD Process (implied TDD phase commit requirements)

---

## Change Log

| Date | Version | Change Description | Approver |
| :--- | :--- | :--- | :--- |
| 2026-05-18 | 1.0.0 | Initial version, extracted framework-agnostic rules from frontend and backend coding standards | @Architect |
