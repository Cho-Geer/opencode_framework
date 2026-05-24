# Project Technical Reference (PROJECT_REFERENCE.md)

> **Note**: This file is a project-specific appendix to `AGENTS.md`, containing the current project's tech stack, directory structure, common commands, architecture quick reference, and other information.
>
> **Related**: For general multi-agent collaboration protocols, see [AGENTS.md](./AGENTS.md).

---

## Project Structure

```
/home/zhaoge/workspace/opencode/Playground2.backup.20260426_012219/
├── ./
│   ├── booking-backend/src/       # NestJS API (port 3000)
│   ├── booking-frontend/          # Angular SPA (port 4200)
│   ├── e2e/                       # Playwright E2E tests
│   ├── scripts/                   # Build & utility scripts
│   ├── contract.yaml              # API contract definition
│   └── Task.DAG.json              # Task dependency graph
└── .opencode/                     # Project rules and context
```

## Common Commands

### booking-backend (NestJS)

```bash
cd ./

# Development
npm run start:dev              # Hot reload dev server (port 3000)
npm run start:debug            # Debug mode with watch

# Build & Production
npm run build
npm run start:prod

# Code Quality
npm run typecheck              # Static type check
npm run lint                   # Linter with auto-fix

# Testing
npm run test                   # Unit tests (Jest)
npm run test:watch             # Watch mode
npm run test:cov               # Coverage (threshold: 80%)
npm run test:integration       # Integration tests (Testcontainers)
npm run test:e2e               # E2E tests (Playwright)
```

### booking-frontend (Angular)

```bash
cd booking-frontend/

# Development
npm run start                  # Dev server (port 4200)
npm run start:debug            # Debug mode

# Build
npm run build                  # Production build
npm run build:staging          # Staging build

# Testing
npm run test                   # Unit tests (Jest)
npm run test:watch             # Watch mode
npm run test:cov               # Coverage (threshold: 80%)
npm run test:e2e               # E2E tests

# Code Quality
npm run lint                   # Linter
npm run typecheck              # TypeScript check
```

## Technical Architecture Quick Reference

### Backend (NestJS v11+ / Node.js 22.x / TypeScript 5.x)

| Module | Path | Description |
|--------|------|-------------|
| Auth | `booking-backend/src/auth/` | JWT + Passport authentication, RBAC authorization |
| Users | `booking-backend/src/users/` | User management, multi-role support |
| Appointments | `booking-backend/src/appointments/` | Appointment core business, high-concurrency conflict handling |
| Services | `booking-backend/src/services/` | Service/provider management |
| Time-Slots | `booking-backend/src/time-slots/` | Time slot management and pre-reservation |
| Email | `booking-backend/src/email/` | Email notifications |
| Stats | `booking-backend/src/stats/` | Operations statistics |
| Timezone | `booking-backend/src/timezone/` | Timezone handling |
| Admin | `booking-backend/src/admin/` | Admin panel API |

### Frontend (Angular v21+ / TypeScript 5.x / Tailwind CSS v4)

| Module | Path | Description |
|--------|------|-------------|
| Core | `booking-frontend/src/app/core/` | Core services, interceptors, guards |
| Auth | `booking-frontend/src/app/auth/` | Login/registration/MFA |
| Admin | `booking-frontend/src/app/admin/` | Admin panel (PrimeNG) |
| Appointments | `booking-frontend/src/app/appointments/` | Appointment flow |
| Profile | `booking-frontend/src/app/profile/` | User profile |

### Database (PostgreSQL 16 / Prisma 7.x ORM / Redis 7.x)

| Component | Technology | Port | Description |
|-----------|-----------|:----:|-------------|
| Database | PostgreSQL 16 | 5432 | Primary database, 71 indexes |
| Cache | Redis 7.x | 6379 | Cache/queue/rate limiting |
| ORM | Prisma 7.x | — | Data access layer, transaction support |

### Authentication & Security

| Mechanism | Configuration | Description |
|-----------|--------------|-------------|
| JWT Access | 15m expiry | Short-lived access token |
| JWT Refresh | 7d expiry | Long-lived refresh token |
| Bcrypt | rounds=12 | Password hashing |
| Encryption | AES-256-GCM | PII field encryption |
| Rate Limiting | Multi-tier (user + IP + global) | DDoS protection |

## Environment Variables

```bash
# Backend
DATABASE_URL="postgresql://user:pass@localhost:5432/booking"
REDIS_URL="redis://localhost:6379"
JWT_SECRET="<your-jwt-secret>"
JWT_REFRESH_SECRET="<your-jwt-refresh-secret>"

# Frontend
API_BASE_URL="http://localhost:3000/api"
```

## Test Strategy

| Layer | Framework | Coverage Target | Description |
|-------|-----------|:--------------:|-------------|
| Unit | Jest 29+ | 70%+ | Pure logic + Service layer |
| Integration | Supertest + Testcontainers | 20% | Real database integration tests |
| E2E | Playwright | 10% | End-to-end user flows |
| Mutation | Stryker | 80% | Mutation testing quality gate |

## CI/CD

| Stage | Tool | Description |
|-------|------|-------------|
| CI | GitHub Actions | Automated tests + lint + build |
| CD | Docker Compose v2 | Immutable tag deployment strategy |
| Migration | Prisma migrate deploy | Database migration automation |
