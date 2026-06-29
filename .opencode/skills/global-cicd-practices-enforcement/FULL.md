---
name: "global-cicd-practices-enforcement"
description: "Enforces mandatory global best practices in CI/CD pipeline design. Invoke when designing CI/CD pipelines, reviewing CI/CD configurations, or generating CI/CD configurations with AI."
---

# Global CI/CD Practices Enforcement

## Purpose
This skill provides **mandatory, high-constraint rules** that must be satisfied by any CI/CD pipeline configuration. It is designed to prevent the seven strategic failure modes identified in industry-wide analysis of CI/CD implementations. Deviation from these rules requires explicit justification and documented exception approval.

## Mandatory Rules (Non-Negotiable)

### Rule 1: Explicit CI/CD Boundary Definition
**Constraint**: The pipeline configuration **MUST** clearly separate Continuous Integration (pre-merge validation) from Continuous Delivery (post-merge artifact promotion and deployment). They **MUST NOT** be conflated into a single monolithic workflow.

**Enforcement**:
- Pre-merge jobs **SHALL NOT** deploy to any environment beyond ephemeral test instances.
- Post-merge jobs **SHALL** have distinct trigger conditions (e.g., `push` to `main` branch) separate from PR triggers.
- Configuration **MUST** use conditional gates to prevent deployment steps from executing in pre-merge contexts.

**Prohibited Pattern**:
```yaml
# ❌ Conflated: Deploy step runs on every PR push
on: [pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps: [...]
  deploy:
    runs-on: ubuntu-latest
    steps: [...]
```

**Required Pattern**:
```yaml
# ✅ Separated: Deployment only on main branch merge
on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  test:
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    steps: [...]
  deploy:
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps: [...]
```

---

### Rule 2: Mandatory Pre-Merge Quality Gates
**Constraint**: Every pipeline **MUST** execute a defined set of quality checks **before** code merge is permitted. At minimum, this set **SHALL** include linting, type checking, and unit tests.

**Enforcement**:
- A dedicated `quality-gate` job or stage **MUST** exist and run on every pull request.
- The merge button **MUST** be protected by requiring this quality gate to pass (configured in repository settings).
- No `continue-on-error` flags **SHALL** be applied to any step within the quality gate.

**Required Check List** (minimum):
- [ ] Static analysis / Linting
- [ ] Type validation (if typed language)
- [ ] Unit test suite execution
- [ ] Build verification (ensuring artifact can be produced)

**Prohibited Pattern**:
```yaml
- name: Lint
  run: npm run lint
  continue-on-error: true   # ❌ FORBIDDEN
```

---

### Rule 3: Toolchain Consolidation Requirement
**Constraint**: The pipeline **MUST NOT** integrate more than **two** distinct orchestration platforms or delivery tools without documented justification. Any multi-tool setup **MUST** include a review comment explaining why a unified platform cannot satisfy requirements.

**Enforcement**:
- A comment header in the CI configuration file **MUST** list all integrated tools and justify each.
- If Jenkins, ArgoCD, GitHub Actions, and GitLab CI are all present in a single delivery flow, the pipeline is **REJECTED**.

**Required Header Example**:
```yaml
# TOOLCHAIN JUSTIFICATION:
# - GitHub Actions: Primary CI orchestrator (chosen due to tight GitHub integration)
# - ArgoCD: GitOps deployment controller (required for declarative Kubernetes deployments)
# Justification: GitHub Actions lacks native GitOps pull-based deployment capabilities.
```

---

### Rule 4: Environment Drift Prevention
**Constraint**: All runtime environments (development, test, staging, production) **MUST** be defined and provisioned using Infrastructure as Code (IaC) committed to the same repository as the application code. No manual configuration changes are permitted.

**Enforcement**:
- The repository **MUST** contain IaC definitions (e.g., `Dockerfile`, `docker-compose.yml`, `terraform/`, `kubernetes/`) for all environments.
- The pipeline **MUST** validate that the built artifact passes through **identical** container images or binaries from test through production.
- Environment-specific values **MUST** be injected via secret variables or config maps, **NOT** baked into separate artifacts.

**Prohibited Pattern**:
```bash
# ❌ Building different images per environment
docker build -t app:dev --build-arg ENV=dev .
docker build -t app:prod --build-arg ENV=prod .
```

**Required Pattern**:
```bash
# ✅ Single immutable image, config injected at runtime
docker build -t app:$COMMIT_SHA .
# Deploy same image to all environments, mount env-specific configs
```

---

### Rule 5: Secret Management Zero-Tolerance
**Constraint**: No secret (API key, password, token, private key) **SHALL** be hardcoded in source code, configuration files, or pipeline definitions. All secrets **MUST** be referenced exclusively through the CI platform's encrypted secret store or an external secrets manager.

**Enforcement**:
- Pipeline logs **MUST** be reviewed for accidental secret exposure; any step that might echo secrets **MUST** explicitly suppress output.
- The repository **MUST** pass secret scanning (e.g., `gitleaks`, `trufflehog`) as part of the quality gate.

**Required Pattern**:
```yaml
- name: Deploy
  env:
    API_KEY: ${{ secrets.API_KEY }}   # ✅ Referenced, never echoed
  run: ./deploy.sh
```

**Prohibited Pattern**:
```yaml
- run: export API_KEY=sk-1234567890abcdef   # ❌ HARDCODED
```

---

### Rule 6: Observability Metric Export
**Constraint**: Every pipeline execution **MUST** export or log the following DORA metrics (or equivalent) to a centralized monitoring system:
- **Lead Time for Changes** (time from commit to production)
- **Deployment Frequency**
- **Mean Time to Restore (MTTR)** (time from failure detection to recovery)
- **Change Failure Rate**

**Enforcement**:
- The pipeline **MUST** include a final step that calculates or records these metrics.
- At minimum, the pipeline **MUST** log build duration and success/failure status in a structured format (e.g., JSON) suitable for ingestion.

**Required Pattern**:
```yaml
- name: Export Metrics
  if: always()
  run: |
    echo "{\"duration\": $(( $(date +%s) - $START_TIME )), \"status\": \"${{ job.status }}\"}" > metrics.json
    curl -X POST https://metrics.example.com/ingest -d @metrics.json
```

---

### Rule 7: Pipeline Bloat Prevention
**Constraint**: The total runtime of the CI pipeline for a typical change (excluding optional heavy integration suites) **MUST NOT** exceed **15 minutes** without explicit justification. Any job exceeding this threshold **MUST** be optimized or split into an asynchronous, non-blocking workflow.

**Enforcement**:
- A `timeout-minutes` attribute **MUST** be set on every job, capped at 20 minutes for standard jobs.
- Parallelization **MUST** be used wherever possible to reduce total wall-clock time.
- Redundant steps (e.g., multiple `npm install` invocations, repeated artifact downloads) **MUST** be eliminated via caching and artifact sharing.

**Required Pattern**:
```yaml
jobs:
  build:
    timeout-minutes: 15
    steps: [...]
```

**Prohibited Pattern**:
```yaml
jobs:
  long-running-test:
    runs-on: ubuntu-latest
    # ❌ No timeout specified, could hang indefinitely
    steps: [...]
```

---

## Pre-Commit Validation Checklist

Before committing any CI/CD configuration change, the author **MUST** verify:

- [ ] **Rule 1**: Are CI and CD triggers clearly separated?
- [ ] **Rule 2**: Does the quality gate include linting, type check, and unit tests, with **zero** `continue-on-error` flags?
- [ ] **Rule 3**: Is a toolchain justification comment present if more than two orchestration tools are used?
- [ ] **Rule 4**: Are environment definitions committed as IaC, and is the same artifact promoted across environments?
- [ ] **Rule 5**: Does secret scanning pass? Are all secrets referenced via platform secret store?
- [ ] **Rule 6**: Are build metrics exported or logged in a structured format?
- [ ] **Rule 7**: Is every job capped with a `timeout-minutes` ≤ 20, and does total pipeline runtime meet the 15-minute target?

## Exception Handling
Any violation of the above rules **MUST** be documented with:
1. A comment in the pipeline configuration file citing the rule being waived.
2. A justification explaining the technical or business constraint.
3. An expiration date for the waiver, after which the violation must be remediated.

Example Waiver Comment:
```yaml
# WAIVER (Rule 7): This integration test suite requires 25 minutes due to third-party
# service latency. Waiver expires 2026-06-01. Ticket: ENG-1234 to mock external services.
```

## Integration with AI Assistants
When this skill is active, an AI assistant generating or reviewing CI/CD configurations **MUST**:
- Reject any configuration that violates the mandatory rules.
- Suggest concrete remediation steps aligned with the required patterns.
- Insert the pre-commit validation checklist as a comment in the generated file.
- Flag any detected `continue-on-error` or hardcoded secret patterns as critical errors.

By enforcing these constraints, this skill ensures CI/CD pipelines are strategically sound, secure, observable, and maintainable from day one.