# GitHub Actions Workflow Syntax and CI/CD Best Practices

> **Source**: Context7 (/websites/github_en_actions) + webfetch (docs.github.com)
> **Fetched**: 2026-06-11
> **Domain**: devops_ci — GitHub Actions

## Overview

GitHub Actions provides workflow automation for CI/CD pipelines. Workflows are YAML files stored in `.github/workflows/` that define automated processes triggered by repository events.

## Basic Workflow Structure

```yaml
name: CI Pipeline
on: [push]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - name: Install dependencies
        run: npm ci
      - name: Run tests
        run: npm test
```

## Event Triggers

### Single/Multiple Events

```yaml
# Single event
on: push

# Multiple events
on: [push, pull_request]

# Specific branches
on:
  push:
    branches:
      - main
      - 'releases/**'
  pull_request:
    branches:
      - main
```

### Path-Based Triggers

```yaml
on:
  push:
    paths:
      - 'src/**'          # Only run when src/ changes
      - '!docs/**'        # Exclude docs changes
```

Service-level triggers (only backend changes):

```yaml
on:
  push:
    paths:
      - 'booking-backend/**'
      - '.github/workflows/**'
```

### Scheduled Triggers (Cron)

```yaml
on:
  schedule:
    - cron: '0 6 * * 1-5'    # Weekdays at 6:00 UTC
```

## Matrix Strategy for Multi-Version Testing

```yaml
jobs:
  test:
    strategy:
      matrix:
        node-version: ['18.x', '20.x', '22.x']
        os: [ubuntu-latest, windows-latest]

    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
      - run: npm ci
      - run: npm test
```

## Service Containers for Integration Tests

GitHub Actions supports service containers for databases, caches, etc.:

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_DB: test
          POSTGRES_PASSWORD: testpass
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
      redis:
        image: redis:7
        ports:
          - 6379:6379

    steps:
      - uses: actions/checkout@v6
      - run: npm ci
      - run: npm test
        env:
          DATABASE_URL: postgresql://postgres:testpass@localhost:5432/test
          REDIS_URL: redis://localhost:6379
```

## Reusable Workflows

```yaml
# .github/workflows/test-ci.yml (called workflow)
name: Test Suite
on:
  workflow_call:
    inputs:
      node-version:
        required: true
        type: string
      coverage:
        required: false
        type: boolean
        default: true

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ inputs.node-version }}
      - run: npm ci
      - run: npm run build --if-present
      - run: npm test
```

## Caching Dependencies

```yaml
steps:
  - uses: actions/setup-node@v4
    with:
      node-version: '20'
      cache: 'npm'         # Auto-caches ~/.npm
  - run: npm ci

  # Or manually with cache action
  - uses: actions/cache@v4
    with:
      path: ~/.npm
      key: ${{ runner.os }}-npm-${{ hashFiles('package-lock.json') }}
      restore-keys: |
        ${{ runner.os }}-npm-
```

## Permissions and Security

```yaml
permissions:
  contents: read
  checks: write        # Needed for check runs
  pull-requests: write # Needed for PR comments

jobs:
  test:
    permissions:
      contents: read   # Override per job
```

## Best Practices for Test Pipelines

1. **Use `npm ci` instead of `npm install`** for reproducible installs
2. **Always run `--if-present` on build scripts** to support projects without build steps
3. **Leverage `if: ${{ always() }}` for artifact upload** — ensures test results are uploaded even on failure
4. **Use matrix strategies** to test across Node.js versions and operating systems
5. **Service containers** for database-backed integration tests (avoid Docker Compose complexity)
6. **Cache `node_modules` or npm cache** for faster pipeline execution
7. **Use `actions/upload-artifact@v4` with `retention-days`** to manage storage costs
8. **Separate lint, unit, integration, and e2e jobs** for parallel execution
9. **Use `workflow_call`** to create reusable test workflows across repositories
10. **Set appropriate `permissions`** to follow least-privilege security model

## Concurrency and Cancellation

```yaml
# Cancel in-progress runs for the same branch
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
```

## Environment Variables

```yaml
env:
  NODE_ENV: test
  CI: true

jobs:
  test:
    env:
      DATABASE_URL: postgresql://localhost:5432/test
    steps:
      - run: echo $DATABASE_URL
