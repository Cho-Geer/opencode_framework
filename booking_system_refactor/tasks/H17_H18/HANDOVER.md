# H17/H18 HANDOVER - CI Workflow Optimization + Secrets Scanning

## Task Summary

### H17: CI Workflow Redundancy Reduction
- Created a new **composite action** at `.github/actions/ci-setup/action.yml`
- Replaced duplicate `Setup Node.js` + `npm ci` (+ `npx prisma generate`) steps in 3 workflows

### H18: Secrets Scanning (Gitleaks)
- Added `gitleaks/gitleaks-action@v2` scan step to **backend-ci.yml**, **frontend-ci.yml**, and **e2e-ci.yml**

---

## Files Modified

| File | Action | Description |
|------|--------|-------------|
| `.github/actions/ci-setup/action.yml` | **NEW** | Composite action: Setup Node, cache, npm ci, optional prisma generate |
| `.github/workflows/backend-ci.yml` | MODIFIED | Replaced 5 duplicate setup blocks with CI Setup action; added gitleaks scan |
| `.github/workflows/frontend-ci.yml` | MODIFIED | Replaced 4 duplicate setup blocks with CI Setup action; added gitleaks scan |
| `.github/workflows/e2e-ci.yml` | MODIFIED | Replaced 2 duplicate setup blocks with CI Setup action; added gitleaks scan |

---

## Composite Action: `ci-setup`

**Inputs:**
| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `working_directory` | ✅ Yes | — | Sub-project dir (e.g., `booking-backend`) |
| `node_version` | ❌ No | `22` | Node.js version |
| `run_prisma_generate` | ❌ No | `false` | Set `'true'` for backend jobs needing Prisma |

**Steps executed:**
1. `actions/setup-node@v4` with cache enabled (`cache-dependency-path: <wd>/package-lock.json`)
2. `npm ci` in the working directory
3. `npx prisma generate` (conditional, only when `run_prisma_generate: 'true'`)

---

## Guardrails Applied

### Devops-CI-CD-Guardrails
- ✅ Cross-project paths respected: `booking-backend` and `booking-frontend` each use their own `working_directory`
- ✅ `working-directory` passed via composite action input (not hardcoded)
- ✅ Migration step (prisma generate + migrate deploy) preserved as separate explicit step

### Cross-Directory-CI
- ✅ Explicit `working_directory` parameter on composite action — each `run` block knows which sub-project it targets
- ✅ Composite action handles path resolution internally via `inputs.working_directory`
- ✅ No leaked CWD issues — `shell: bash` + `working-directory` in each composite step

### Fullstack-CI-CD-Guardrails
- ✅ Variable validation: `NODE_VERSION` remains as `env` in workflow, consumed by composite action
- ✅ No hardcoded Docker Hub usernames touched
- ✅ PR event handling unchanged

### Global-CICD-Practices-Enforcement
- ✅ Rule 1 (CI/CD boundary): Unchanged — deployment jobs remain separated
- ✅ Rule 2 (Quality gates): `secret-scan` is added as a dependency for downstream jobs (`needs`)
- ✅ Rule 3 (Toolchain): Composite action justification added in action.yml comment
- ✅ Rule 5 (Secrets): Gitleaks scans all commits for leaked secrets
- ✅ Rule 7 (Pipeline bloat): Reduced redundant setup steps; composite action is shared, not duplicated

---

## Key Design Decisions

1. **Gitleaks as standalone job** (not a step in an existing job): Makes it an independent quality gate that runs in parallel, and downstream jobs can depend on it via `needs`.
2. **Backend frontend-ci.yml `e2e-test` job's `Setup backend for E2E` step NOT replaced**: That step runs both `npm ci` and manual prisma commands in the `booking-backend` directory from within the frontend workflow. It was intentionally left as-is because:
   - It's a one-off inline script that also runs migrations and seed
   - The working directory is explicitly set per step (already correct per cross-directory-ci rules)
3. **Composite action uses `shell: bash`**: Required by GitHub Actions composite actions for `run` steps
4. **Gitleaks uses `fetch-depth: 0`**: Ensures full commit history for scanning

---

## Potential Gotchas

- ⚠️ Gitleaks action requires `GITHUB_TOKEN` secret (already available as `${{ secrets.GITHUB_TOKEN }}`)
- ⚠️ If Gitleaks action (`gitleaks/gitleaks-action@v2`) becomes unavailable, replace with TruffleHog as per H18 fallback
- ⚠️ The `secret-scan` job in backend-ci.yml is a dependency for `lint-and-typecheck` — if it fails, lint+typecheck won't run. Adjust `needs` if you want them parallel
- ⚠️ The `secret-scan` job in frontend-ci.yml is a dependency for `lint-and-build` — same consideration

## Commit Message
```
[Enhance] H17/H18 CI workflow optimization + secrets scanning
```
