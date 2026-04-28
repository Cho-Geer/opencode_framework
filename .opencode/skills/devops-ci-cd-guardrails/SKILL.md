---
name: devops-ci-cd-guardrails
description: Use for any DevOps, CI, CD, Docker, Docker Compose, GitHub Actions, deployment, image build, image verification, migration, rollback, release, or environment-variable work in this project. Trigger when the task touches booking-backend, booking-frontend, or deploy, especially workflow files, deploy scripts, image tags, migration flow, cross-repo E2E, or release-readiness review. Enforce project-specific CI/CD guardrails before proposing or making changes.
---

# devops-ci-cd-guardrails

## Core Intent

Apply the project's DevOps CI/CD rules immediately when working on GitHub Actions, Docker images, deploy scripts, compose files, deployment docs, rollout plans, or CI/CD reviews.

Treat `booking-backend`, `booking-frontend`, and `deploy` as one CI/CD surface, not three unrelated directories.

## Project Facts To Keep In Mind

- `booking-backend` owns backend CI and backend image build concerns.
- `booking-frontend` owns frontend CI and cross-repo E2E against backend.
- `deploy` is the deployment surface:
  - `compose/` for dev/prod compose files
  - `env/` for deployment env templates
  - `scripts/` for deploy and image verification scripts
  - `README.md` for operator-facing deployment guidance
- Health endpoint contract is `/v1/health`.
- Deployment flow is expected to be:
  1. pull image
  2. run migration
  3. start services
  4. verify health
- Migration is a first-class deploy step and must not be treated as an afterthought.

## Non-Negotiable Guardrails

### 1. Validate the real deploy contract, not a fake happy path

- Do not accept image validation that starts backend in isolation if real deployment requires Postgres, Redis, and runtime env.
- Prefer validation that matches deploy topology.
- If a workflow proves only that a container starts, say clearly that it is not deploy-grade validation.

### 2. Migration must use a migration-capable image

- Do not assume the regular backend runtime image can run `prisma:deploy`.
- Check whether the runtime image prunes dev dependencies.
- If `Dockerfile.migrate` or an equivalent migration image exists, deployment should use that contract explicitly.
- Flag any mismatch between:
  - migration service definition
  - migration image tag
  - image workflow outputs
  - deploy env examples

### 3. Prefer immutable deploy inputs

- Treat mutable tags like `dev`, `main`, `latest`, `dev-latest`, `prod-latest` as convenience tags, not the safest default for reproducible deploys.
- For release, rollback, and incident analysis, prefer immutable tags such as commit-based tags.
- If docs or env examples recommend mutable tags by default, call that out.

### 4. Cross-repo E2E must be version-aware

- When frontend CI checks out backend, verify whether the backend revision is pinned.
- If it is not pinned, call out that E2E compatibility is nondeterministic.
- Treat backend ref pinning as a CI trustworthiness issue, not just a style issue.

### 5. Review `deploy` as production-facing code

- Treat changes under `deploy/` with the same rigor as application code.
- Verify consistency across:
  - compose files
  - env examples
  - deploy scripts
  - image workflows
  - README instructions
- If one says `main` and another says `prod-latest` or `sha-*`, call out the inconsistency.

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
- Prefer “smallest change that closes the risk”.
- Keep recommendations executable and repo-specific.

## Project-Specific Known Risk Patterns

Watch especially for these patterns:

- `migration` service points to the normal backend image instead of a dedicated migration image.
- image workflow tests backend without DB/Redis/env and treats that as deploy validation.
- `verify-images.sh` or similar scripts validate images outside the real compose topology.
- deploy env examples point at mutable branch tags.
- frontend E2E checks out backend without a pinned ref.
- docs claim a deploy path is reliable when workflows do not actually produce the required images.

## What To Avoid

- Do not treat “workflow exists” as “pipeline is trustworthy”.
- Do not assume docs are true if scripts and compose files disagree.
- Do not recommend weakening health checks just to make CI green.
- Do not discuss backend, frontend, and deploy in isolation when the issue crosses boundaries.