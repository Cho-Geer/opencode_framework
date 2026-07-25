---
name: "cross-directory-ci"
description: "Systematic guidance for avoiding and debugging CI/CD failures from incorrect CWD. Invoke when DevOps/CI/CD tasks are mentioned or CI/CD pipeline configuration is discussed."
---

# Cross-Directory CI Script Execution Skill

This skill provides systematic guidance for avoiding and debugging CI/CD failures caused by incorrect current working directories (CWD) or path resolution contexts. It applies to any project where CI jobs check out multiple repositories, work with monorepos, or execute commands in subdirectories.

## Purpose

CI/CD pipelines often operate in a workspace containing multiple codebases (e.g., frontend and backend checked out into separate subdirectories) or a monorepo structure. Scripts executed from the wrong current working directory (CWD) are a frequent source of failure. This skill defines a repeatable methodology to prevent and resolve these issues across any language or toolchain.

## Core Problem Pattern

A command like `npm run build`, `python scripts/seed.py`, `go run ./cmd/server`, or `mvn compile` is executed in a CI step. The command itself or the tool it invokes relies on **relative paths** that are resolved against the **current working directory**. If the CI step's CWD is not the directory where those relative paths are valid (e.g., the root of the respective sub-project), the command fails with a "file not found" or "module not found" error.

## Universal Pre-Execution Checklist `[VERIFICATION]`

Before writing any CI step that runs a command inside a subdirectory of the workspace, verify:

> **本清单是 `[VERIFICATION]`**--必须实际运行 CI 并引用输出验证。「CI 配置看起来对」不是验证。

| Checkpoint | Why It Matters | Implementation |
| :--- | :--- | :--- |
| **Explicit Working Directory** | The CWD determines how all relative paths (`./src`, `config/`, `requirements.txt`) are resolved. | Use the CI system's native directive (e.g., `working-directory` in GitHub Actions, `cd` in a script block with proper shell handling). |
| **Shell Context Isolation** | Multiple `run` blocks in a CI job **do not** share the same CWD unless explicitly set. Each block starts fresh. | Use `working-directory` per step, or use a single multi-line `run` block with `cd subdir && command1 && command2` to maintain the changed directory. |
| **Tool's Own Working Directory Logic** | Some tools (e.g., `npm --prefix`, `make -C`, `git -C`) accept a directory flag, but they may only change where they look for configuration files, **not** the CWD for any subprocesses they spawn. | Prefer changing the CWD of the entire step using the CI's built-in mechanism. Avoid relying solely on tool-specific directory flags unless you have verified they also adjust the CWD for nested script executions. |
| **Environment File Loading** | If your script loads environment variables from a `.env` file using a relative path, that path is resolved relative to the CWD. | Use absolute paths to the env file or change to the correct directory before sourcing it. |
| **Binary/Executable Resolution** | Commands like `pytest`, `ts-node`, or `prisma` may be installed locally in the subdirectory (e.g., `node_modules/.bin`). They are only in the `PATH` when the shell's CWD is within that subdirectory (or if the CI explicitly adds it). | Execute via the sub-project's package manager scripts (e.g., `npm run`, `yarn`, `pipenv run`, `poetry run`) from within the correct directory. |

## Common Anti-Patterns and Solutions (Framework Agnostic)

### ❌ Anti-Pattern 1: Unscoped `cd` in Separate Steps
```yaml
- run: cd backend
- run: npm run build   # ❌ This runs in the workspace root, NOT in backend/
```
**Why it fails:** Each `run` block starts with a fresh shell, discarding the previous `cd`.

#### ✅ Solution A: Use CI's working-directory feature
```yaml
- name: Build Backend
  working-directory: ./backend
  run: npm run build
```

#### ✅ Solution B: Chain Commands in a Single Shell Block
```yaml
- name: Build Backend
  run: |
    cd backend
    npm run build
```

### ❌ Anti-Pattern 2: Over-reliance on Tool Prefix Flags
```yaml
- run: npm run test --prefix backend
```
**Why it fails often:** The script `test` defined in `backend/package.json` may itself execute another command with a relative path (e.g., `jest ./tests`). `jest` will run with the CWD of the workspace root, not `backend/`, and fail to find `./tests`.

#### ✅ Solution: Change the CWD properly as shown above.

### ❌ Anti-Pattern 3: Hardcoding Relative Paths from Workspace Root in Scripts
```json
// backend/package.json
"scripts": {
  "build": "tsc -p ../tsconfig.json"   // ❌ Assumes script is always run from a specific depth.
}
```
**Why it fails:** This breaks local development (when run from `backend/`) and is fragile.

#### ✅ Solution: Keep scripts self-contained relative to their own project root. Let CI handle the directory switching.

## Debugging "File Not Found" Errors in CI

When a CI step fails with an error indicating a missing file or module, use this diagnostic flow:

1.  **Insert a Debug Step** *before* the failing command:
    ```yaml
    - name: Debug CWD and Directory Structure
      run: |
        pwd
        ls -la
        ls -la backend/ || true
    ```
2.  **Compare the Expected Relative Path with the Actual CWD.**
    - If the command is `python scripts/seed.py`, the file `scripts/seed.py` must exist directly inside the directory reported by `pwd`.
3.  **If the file is in a subdirectory** (e.g., `backend/scripts/seed.py`), then the CWD is wrong. Add `working-directory: ./backend` to the step.
4.  **If the error is from a nested tool** (e.g., `ts-node`, `pytest`, `go build`), examine the exact error message. It often reveals the full path it attempted to resolve, confirming the CWD mismatch.

## Technology-Specific Notes (Generalized)

| Technology Stack | Common Pitfall | Recommendation |
| :--- | :--- | :--- |
| **Node.js / npm / yarn** | `npm run` scripts execute in the CWD where `npm` was invoked. Local binaries (`node_modules/.bin`) are added to `PATH` only for that invocation. | Always use `working-directory` for steps that run `npm` commands inside a sub-project. |
| **Python (pipenv, poetry, venv)** | Virtual environment activation and script execution (`python manage.py`) depend on being in the correct directory to find modules and `.env` files. | Activate the environment and run commands in the same shell block with the correct CWD. |
| **Go** | `go run ./cmd/server` and `go test ./...` rely on the module context (the nearest `go.mod`). Running from outside the module root can cause "no required module provides package" errors. | Set CWD to the directory containing `go.mod`. |
| **Java (Maven, Gradle)** | Maven and Gradle look for `pom.xml` or build scripts in the CWD. Running from a parent directory fails. | Use `working-directory` or `-f` flags appropriately. |
| **Make** | `make -C subdir` changes directory for the Make execution, but any sub‑commands in the Makefile that use relative paths will still resolve relative to `subdir`. This is usually correct. | If you encounter issues, verify the Makefile does not contain hardcoded paths like `../something`. |

## Template for a Robust Multi-Repository CI Job

```yaml
jobs:
  integration:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout Main Repository
        uses: actions/checkout@v4
        with:
          path: main

      - name: Checkout Secondary Repository
        uses: actions/checkout@v4
        with:
          repository: org/other-repo
          path: other

      # Setup for Secondary Component
      - name: Setup Environment (e.g., Node, Python)
        uses: actions/setup-node@v4
        # No working-directory here; setup actions are global.

      - name: Install Dependencies (Secondary)
        working-directory: ./other
        run: npm ci   # or pip install -r requirements.txt, etc.

      - name: Run Preparation Script (Secondary)
        working-directory: ./other
        run: npm run prepare-data
        env:
          CONFIG_PATH: ${{ github.workspace }}/other/config.yml   # Use absolute paths for clarity

      # Tests for Main Component (which may depend on the secondary component)
      - name: Install Dependencies (Main)
        working-directory: ./main
        run: npm ci

      - name: Run Tests (Main)
        working-directory: ./main
        run: npm test
```

## Integration Points with CI/CD Pipelines

This skill integrates with CI/CD pipelines by:

1. **Preventive Design**: Apply the Universal Pre-Execution Checklist during pipeline authoring.
2. **Debugging Integration**: Use the diagnostic flow when pipeline failures occur.
3. **Tool-Specific Adaptation**: Apply technology-specific recommendations based on the stack.
4. **Multi-Repository Coordination**: Use the template for complex workflows involving multiple codebases.

## Summary for AI Assistance

When advising on CI configuration for projects with subdirectories or multiple checkouts:

- **Prioritize explicit `working-directory` declarations** for each step that interacts with a sub-project.
- **Flag any use of tool-specific directory flags** (`--prefix`, `-C`) if the executed command contains further relative paths.
- **Suggest inserting `pwd` and `ls` debug steps** when the user reports path-related failures.
- **Remind that each `run` block starts with a clean shell** and does not retain state like CWD or exported environment variables from previous steps unless explicitly persisted.

This skill provides a universal framework to eliminate one of the most common and subtle classes of CI failures.