---
name: devops-ci-cd-guardrails
description: Use for any DevOps, CI, CD, Docker, Docker Compose, GitHub Actions, deployment, image build, image verification, migration, rollback, release, or environment-variable work in this project. Trigger when the task touches CI/CD pipeline configuration, Docker-related files, deployment scripts, compose files, or project source directories defined in project.config.json. Resolve project-specific paths and directory names via .opencode/project.config.json before applying guardrails (see Config Resolution below). Enforce project-specific CI/CD guardrails before proposing or making changes.
---

# devops-ci-cd-guardrails

## Config Resolution

**Before applying any guardrails, resolve project-specific paths from `.opencode/project.config.json`:**

| Config Key | Purpose | Example Resolution |
|---|---|---|
| `project.project_root` | Root directory for the project's business code | e.g. `booking_system_refactor` |
| `paths.backend_src` | Backend source directory (relative to project_root) | e.g. `booking-backend/src/` → backend dir is `booking-backend/` |
| `paths.frontend_src` | Frontend source directory (relative to project_root) | e.g. `booking-frontend/src/` → frontend dir is `booking-frontend/` |
| `tech_stack.ci_cd` | CI/CD technology stack in use | e.g. Docker + GitHub Actions |
| `tech_stack.backend` | Backend framework | e.g. NestJS |
| `tech_stack.database` | Database / ORM | e.g. Prisma + PostgreSQL |

Use the resolved directory names (extracted from `paths.backend_src` and `paths.frontend_src`) wherever `{backend_dir}` and `{frontend_dir}` appear below. The deployment surface consists of Dockerfiles, compose files, deploy scripts, workflow files (`.github/workflows/`), and environment templates found within the project.

---

## Core Intent

Apply the project's DevOps CI/CD rules immediately when working on GitHub Actions, Docker images, deploy scripts, compose files, deployment docs, rollout plans, or CI/CD reviews.

Treat `{backend_dir}`, `{frontend_dir}`, and the deployment surface (Dockerfiles, compose files, workflow files) as **one unified CI/CD surface**, not unrelated directories.

## Project Facts To Keep In Mind

- `{backend_dir}` (resolved from `paths.backend_src`) owns backend CI and backend image build concerns.
- `{frontend_dir}` (resolved from `paths.frontend_src`) owns frontend CI and cross-repo E2E against backend.
- The **deployment surface** includes:
  - `compose/` or equivalent — dev/prod compose files
  - `env/` or equivalent — deployment env templates
  - `scripts/` or equivalent — deploy and image verification scripts
  - `.github/workflows/` — CI/CD pipeline definitions
  - `Dockerfile*` — image build definitions
  - Deployment documentation (README.md, operator-facing guidance)
- Health endpoint contract should be documented in the project's API specification (typically `/v1/health` or equivalent).
- Deployment flow is expected to be:
  1. pull image
  2. run migration
  3. start services
  4. verify health
- Migration is a first-class deploy step and must not be treated as an afterthought.

## Non-Negotiable Guardrails

### 1. Validate the real deploy contract, not a fake happy path

- Do not accept image validation that starts backend in isolation if real deployment requires a database, cache, and runtime env.
- Prefer validation that matches deploy topology.
- If a workflow proves only that a container starts, say clearly that it is not deploy-grade validation.

### 2. Migration must use a migration-capable image

- Do not assume the regular backend runtime image can run database migrations.
- Check whether the runtime image prunes dev dependencies.
- If `Dockerfile.migrate` or an equivalent migration image exists, deployment should use that contract explicitly.
- Flag any mismatch between:
  - migration service definition
  - migration image tag
  - image workflow outputs
  - deploy env examples

### 3. Prefer immutable deploy inputs

- Treat mutable tags like `dev`, `main`, `latest`, `dev-latest`, `prod-latest` as convenience tags, not the safest default for reproducible deploys.
- For release, rollback, and incident analysis, prefer immutable tags such as commit-based tags or semantic versions.
- If docs or env examples recommend mutable tags by default, call that out.

### 4. Cross-repo E2E must be version-aware

- When frontend CI depends on backend source (e.g., checkout, integration tests), verify whether the backend revision is pinned.
- If it is not pinned, call out that E2E compatibility is nondeterministic.
- Treat backend ref pinning as a CI trustworthiness issue, not just a style issue.

### 5. Review deployment surface as production-facing code

- Treat changes to deployment configuration (compose files, Dockerfiles, workflow files, deploy scripts) with the same rigor as application code.
- Verify consistency across:
  - compose files
  - env examples / env templates
  - deploy scripts
  - image workflows
  - deployment documentation (README, operator guides)
- If one source says `main` and another says `prod-latest` or `sha-*`, call out the inconsistency.

## Required Review Checklist

Whenever doing DevOps CI/CD work, explicitly check these before concluding:

- Does the workflow validate the same runtime dependencies the deployment actually uses?
- Does migration run before app startup?
- Is the migration image real, published, and runnable?
- Are deploy image references reproducible and rollback-friendly?
- Are frontend and backend CI/E2E flows version-paired or drifting?
- Do docs match scripts and compose files?
- Are health checks dependency-aware and meaningful?

## Preferred Output Style

When reviewing:
- Findings first, ordered by severity.
- Focus on bugs, broken contracts, deployment risk, rollback risk, and false confidence in CI.
- Be explicit about whether something is:
  - already implemented
  - partially implemented
  - documented only
  - broken by contract mismatch

When proposing fixes:
- Group by `P1 / P2 / P3`.
- Prefer "smallest change that closes the risk".
- Keep recommendations executable and repo-specific.

## Project-Specific Known Risk Patterns

Watch especially for these patterns (resolve directory names from project.config.json):

- `migration` service points to the normal backend image instead of a dedicated migration image.
- Image workflow tests backend without database/cache/env and treats that as deploy validation.
- Image verification scripts validate images outside the real compose topology.
- Deploy env examples point at mutable branch tags.
- Frontend E2E checks out backend source without a pinned ref.
- Docs claim a deploy path is reliable when workflows do not actually produce the required images.

## What To Avoid

- Do not treat "workflow exists" as "pipeline is trustworthy".
- Do not assume docs are true if scripts and compose files disagree.
- Do not recommend weakening health checks just to make CI green.
- Do not discuss backend, frontend, and deploy in isolation when the issue crosses boundaries.
