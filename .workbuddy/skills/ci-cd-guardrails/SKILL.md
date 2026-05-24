---
name: ci-cd-guardrails
description: P2 CI/CD best practices enforcement. Platform, container runtime, and orchestration are read from project.yaml. Principles are universal (immutable tags, environment isolation, real dependency validation).
agent_created: true
level: user
---

# ci-cd-guardrails

## Purpose

Enforce CI/CD best practices for any deployment pipeline. Consolidates 4 previous overlapping skills into one universal, config-driven skill. All platform-specific details are read from `project.yaml`.

## Configuration

Read from `.workbuddy/project.yaml`:

- `ci_cd.platform` — CI/CD platform (e.g., "GitHub Actions", "GitLab CI")
- `ci_cd.container_runtime` — container tool (e.g., "Docker", "Podman")
- `ci_cd.orchestration` — orchestration tool (e.g., "Docker Compose", "Kubernetes")
- `enforcement.mode` — advisory | strict | locked

## Universal CI/CD Principles (Framework-Level)

These principles apply regardless of platform:

1. **Immutable Builds**: Build artifacts are never modified after creation
2. **Environment Isolation**: Dev/staging/prod environments are strictly separated
3. **Real Dependency Validation**: Dependencies are resolved fresh, never cached across stages
4. **Secret Management**: Secrets never appear in code, logs, or build artifacts
5. **Fail Fast**: Pipeline fails on first error, no silent failures
6. **Artifact Provenance**: Every deployment artifact is traceable to a commit
7. **Rollback Capability**: Every deployment must have a verified rollback path

## Checks

### Build Check
- Verify build command succeeds
- Verify build output exists
- Verify no build warnings in strict mode

### Container Check (if container_runtime configured)
- Verify containerfile exists
- Verify container builds successfully
- Verify container runs without errors
- Verify no root user in container

### Deployment Check
- Verify deployment configuration exists
- Verify health check endpoints respond
- Verify rollback procedure exists and is tested

### Dependency Check
- Verify lock file integrity
- Verify no known vulnerabilities
- Verify no deprecated packages

## Integration

Used by:
- `devops` agent — primary skill for CI/CD pipeline management
- `guardian` agent — gate confirm includes CI/CD readiness check

## Usage

```text
/cicd check-build     — Verify build succeeds
/cicd check-container — Verify container builds and runs
/cicd check-deploy    — Verify deployment readiness
/cicd check-deps      — Verify dependency integrity
/cicd full            — Run all CI/CD checks
/cicd report          — Show last CI/CD check results
```
