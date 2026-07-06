---
name: ci-cd-guardrails
description: Enforces CI/CD best practices for Docker, GitHub Actions, deployment, and pipeline design. Invoke when working with Docker images, CI/CD workflows, deployment pipelines, migration, rollback, release, compose files, or environment variables.
---

# CI/CD Guardrails (Merged)

> Merged from: devops-ci-cd-guardrails + fullstack-ci-cd-guardrails + global-cicd-practices-enforcement
> Date: 2026-07-05 (Phase 1)

---

## Part A: 7 Universal Mandatory Rules

These rules MUST be satisfied by any CI/CD pipeline configuration.

### Rule 1: Explicit CI/CD Boundary Definition
Pre-merge (CI) and post-merge (CD) MUST be separated. Deploy steps MUST NOT execute on PR triggers.

```yaml
# ✅ Required pattern
on:
  pull_request:
    branches: [main]
  push:
    branches: [main]
jobs:
  test:
    if: github.event_name == 'pull_request'
  deploy:
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
```

### Rule 2: Mandatory Pre-Merge Quality Gates
Every pipeline MUST run lint + type-check + unit-test before merge. Zero `continue-on-error` flags allowed in quality gate steps.

### Rule 3: Toolchain Consolidation
No more than 2 orchestration platforms without documented justification comment in CI config.

### Rule 4: Environment Drift Prevention
All environments defined as IaC in the same repo. Same artifact promoted through all environments. Environment-specific values injected via secrets/config maps, NOT baked into artifacts.

### Rule 5: Secret Management Zero-Tolerance
No hardcoded secrets anywhere. All secrets via platform secret store. Secret scanning MUST pass as part of quality gate.

### Rule 6: Observability Metric Export
Every pipeline MUST export DORA metrics (lead time, deploy frequency, MTTR, change failure rate) or at minimum log build duration + status in structured format.

### Rule 7: Pipeline Bloat Prevention
Total CI runtime MUST NOT exceed 15 minutes (excluding heavy integration suites). Every job MUST have `timeout-minutes` ≤ 20.

---

## Part B: Project-Specific Config Resolution

Before applying guardrails, resolve project paths from `.opencode/project.config.json`:

| Config Key | Purpose |
|---|---|
| `project.project_root` | Root directory for business code |
| `paths.backend_src` | Backend source directory |
| `paths.frontend_src` | Frontend source directory |
| `tech_stack.ci_cd` | CI/CD technology stack |
| `tech_stack.backend` | Backend framework |
| `tech_stack.database` | Database / ORM |

Use resolved directory names wherever `{backend_dir}` and `{frontend_dir}` appear below.

---

## Part C: Repository Configuration

### Variable Management (Mandatory)

| Variable | Scope | Purpose |
|---|---|---|
| `DOCKER_HUB_USER` | All environments | Docker Hub namespace via `${{ vars.DOCKER_HUB_USER }}` |

**Forbidden**: Hardcoding Docker Hub username in `env`.

### Secrets (Mandatory)

| Secret | Environment | Purpose |
|---|---|---|
| `DOCKERHUB_USERNAME` / `DOCKERHUB_TOKEN` | Repository | Docker Hub auth (read-only token) |
| `DEV_POSTGRES_PASSWORD` etc. | development | Dev DB credentials |
| `PROD_*` | production | Prod credentials (require approval) |

---

## Part D: Image Build Workflow

### Tag Strategy
```yaml
tags: |
  type=ref,event=branch
  type=ref,event=pr
  type=semver,pattern={{version}}
  type=sha,prefix={{branch}}-,enable=${{ github.event_name != 'pull_request' }}
  type=sha,prefix=sha-,enable=${{ github.event_name == 'pull_request' }}
```

- PR events: build only, load locally (`load: true`), NEVER push
- Push events: generate immutable tags (SHA or semver)
- Mutable tags (`dev`, `main`, `latest`) are convenience only, not for production

### Docker Hub Login (Unconditional)
```yaml
- name: Log in to Docker Hub
  uses: docker/login-action@v3
  with:
    username: ${{ secrets.DOCKERHUB_USERNAME }}
    password: ${{ secrets.DOCKERHUB_TOKEN }}
```
MUST run unconditionally. No `if: github.event_name != 'pull_request'` guard.

### Variable Validation Step (Required)
After Buildx setup, validate `DOCKER_HUB_USER` is non-empty. Fail fast if missing.

### PR Stage Testing
- Start temporary Postgres + Redis service containers
- Use locally built image for health check
- Use hardcoded test values (no external Secrets dependency)

### Push Stage Testing
- Pull image from Registry after push
- Verify with full compose topology (DB + cache + env)

---

## Part E: Deploy Verification

### Matrix Strategy
```yaml
strategy:
  fail-fast: false
  matrix:
    environment: [dev, prod]
```

### Environment File Generation
All `.env` files generated from `.example` at deploy time. `*.compose.env.example` uses `{{DOCKER_HUB_USER}}` placeholder.

### Deploy Flow
1. Pull image
2. Run migration (using dedicated migration image if exists)
3. Start services
4. Verify health (dependency-aware, not just container start)

### Migration Rules
- Migration MUST use migration-capable image (check if runtime image prunes dev deps)
- If `Dockerfile.migrate` exists, deployment MUST use it
- Migration is a first-class deploy step, not an afterthought

---

## Part F: Non-Negotiable Guardrails

1. **Validate real deploy contract**: Image validation MUST match deploy topology (DB + cache + env), not isolated container start
2. **Immutable deploy inputs**: Prefer commit SHA / semver tags for release. Mutable tags for convenience only
3. **Cross-repo E2E version-aware**: Frontend CI depending on backend MUST pin the backend ref
4. **Deployment surface review**: Treat compose files, Dockerfiles, workflow files as production code. Verify consistency across all deployment artifacts + docs
5. **Health endpoint contract**: Documented in API spec, dependency-aware

---

## Part G: Frontend-Specific (Next.js)

- Import `useRouter` from `next/compat/router`, always use optional chaining
- E2E tests: Redis service container + `NODE_ENV=development` backend
- Playwright: `npx playwright install --with-deps chromium`
- PR image test: `load: true` (must load to Docker daemon)

## Part H: Backend-Specific (NestJS + Prisma)

- Prisma seed: use `npx prisma db seed` (not direct `ts-node`)
- Migration image: build separately, keep tags in sync with main image

---

## Part I: Route Guard Safety Principles (Framework-Agnostic)

### Layered Defense (3 layers minimum)
| Layer | Scope | Implementation |
|---|---|---|
| L1 - Gateway | Request entry | Middleware / Reverse Proxy |
| L2 - Page | Client rendering | Auth HOC / Route Guard |
| L3 - API | Server-side | API route validation / Interceptors |

### JWT Validation
Always validate signature + expiration. Never rely on single verification point.

### Security Headers (All responses)
`X-XSS-Protection`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Content-Security-Policy`

### Forbidden Patterns
| Forbidden | Correct |
|---|---|
| Single verification point | Multi-layer defense |
| Client-side guard only | Server must also validate |
| Hardcoded paths | Centralized route constants |
| localStorage for tokens | httpOnly cookies |

---

## Pre-Commit Validation Checklist

- [ ] Rule 1: CI/CD triggers separated?
- [ ] Rule 2: Quality gate includes lint + type-check + test, zero `continue-on-error`?
- [ ] Rule 3: Toolchain justification comment present (if >2 tools)?
- [ ] Rule 4: Environments as IaC, same artifact promoted?
- [ ] Rule 5: Secret scanning passes? All secrets via platform store?
- [ ] Rule 6: Build metrics exported in structured format?
- [ ] Rule 7: Every job has `timeout-minutes` ≤ 20, total ≤ 15min?
- [ ] Docker Hub login unconditional?
- [ ] Variable validation step present?
- [ ] Migration uses dedicated image?
- [ ] Deploy validation matches real topology?
- [ ] Frontend E2E uses pinned backend ref?
- [ ] Docs match scripts and compose files?

## Exception Handling
Any rule violation MUST have:
1. Comment citing the waived rule
2. Technical/business justification
3. Expiration date

```yaml
# WAIVER (Rule 7): Integration test requires 25min due to external service.
# Expires 2026-09-01. Ticket: ENG-1234.
```

## Common Errors Quick Reference

| Error | Fix |
|---|---|
| `Cannot find module './seed.ts'` | Use `npx prisma db seed` |
| `NextRouter was not mounted` | Use `next/compat/router` |
| `invalid tag "docker.io//xxx"` | Validate `DOCKER_HUB_USER` variable |
| `pull access denied` | Ensure unconditional Docker login |
| `fail-fast` cancelled other envs | Set `fail-fast: false` |
