# CI Test Pipeline Integration: Jest, Playwright, and NestJS

> **Source**: Context7 (/websites/github_en_actions) + webfetch (docs.github.com, docs.docker.com)
> **Fetched**: 2026-06-11
> **Domain**: devops_ci — CI/CD Test Pipeline

## Overview

This guide covers running Jest, Playwright, and NestJS test suites in CI pipelines, with patterns for GitHub Actions and Docker Compose.

## Full Node.js CI Pipeline (Jest + Playwright)

```yaml
name: CI Test Pipeline

on:
  push:
    branches: [main, develop]
    paths:
      - 'booking-backend/**'
      - 'booking-frontend/**'
  pull_request:
    branches: [main]

env:
  NODE_VERSION: '20'

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  # ==========================================
  # Lint & Type Check
  # ==========================================
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'npm'
      - run: npm ci
      - run: npm run lint

  # ==========================================
  # Unit Tests (Jest)
  # ==========================================
  unit-tests:
    needs: lint
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'npm'
      - run: npm ci
      - run: npm run build --if-present
      - name: Run unit tests
        run: npm run test -- --coverage --ci
      - name: Upload coverage report
        uses: actions/upload-artifact@v4
        with:
          name: unit-coverage
          path: coverage/
          retention-days: 7
        if: ${{ always() }}

  # ==========================================
  # Integration Tests (NestJS + Supertest)
  # ==========================================
  integration-tests:
    needs: lint
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_DB: app_test
          POSTGRES_USER: app
          POSTGRES_PASSWORD: testpass
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 5s
          --health-timeout 3s
          --health-retries 5
      redis:
        image: redis:7-alpine
        ports:
          - 6379:6379
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 5s
          --health-timeout 3s
          --health-retries 5

    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'npm'
      - run: npm ci
      - run: npx prisma migrate deploy
        env:
          DATABASE_URL: postgresql://app:testpass@localhost:5432/app_test
      - name: Run integration tests
        run: npm run test:e2e -- --ci
        env:
          DATABASE_URL: postgresql://app:testpass@localhost:5432/app_test
          REDIS_URL: redis://localhost:6379
      - name: Upload integration test results
        uses: actions/upload-artifact@v4
        with:
          name: integration-results
          path: test-results/
          retention-days: 7
        if: ${{ always() }}

  # ==========================================
  # E2E Tests (Playwright)
  # ==========================================
  e2e-tests:
    needs: [unit-tests, integration-tests]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'npm'
      - run: npm ci
      - name: Install Playwright browsers
        run: npx playwright install --with-deps chromium
      - name: Start application
        run: |
          npm run build
          npm start &
          sleep 5
      - name: Run Playwright tests
        run: npx playwright test
      - uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 14
        if: ${{ always() }}
```

## NestJS-Specific CI Configuration

```yaml
name: NestJS CI

on:
  push:
    branches: [main]
    paths:
      - 'booking-backend/**'

jobs:
  test:
    runs-on: ubuntu-latest

    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_DB: nestjs_test
          POSTGRES_USER: nestjs
          POSTGRES_PASSWORD: nestjs_pass
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 5s
          --health-timeout 3s
          --health-retries 5

    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: booking-backend/package-lock.json

      - name: Install dependencies
        working-directory: booking-backend
        run: npm ci

      - name: Generate Prisma client
        working-directory: booking-backend
        run: npx prisma generate

      - name: Run database migrations
        working-directory: booking-backend
        run: npx prisma migrate deploy
        env:
          DATABASE_URL: postgresql://nestjs:nestjs_pass@localhost:5432/nestjs_test

      - name: Run unit tests
        working-directory: booking-backend
        run: npm test -- --coverage --ci
        env:
          DATABASE_URL: postgresql://nestjs:nestjs_pass@localhost:5432/nestjs_test

      - name: Run e2e tests
        working-directory: booking-backend
        run: npm run test:e2e -- --ci
        env:
          DATABASE_URL: postgresql://nestjs:nestjs_pass@localhost:5432/nestjs_test

      - name: Upload coverage
        uses: actions/upload-artifact@v4
        with:
          name: nestjs-coverage
          path: booking-backend/coverage/
        if: ${{ always() }}
```

## Playwright E2E in CI

```yaml
name: Playwright E2E

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  e2e:
    timeout-minutes: 30
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install dependencies
        run: npm ci

      - name: Install Playwright browsers
        run: npx playwright install --with-deps

      - name: Build application
        run: npm run build

      - name: Start application server
        run: |
          npm start &
          npx wait-on http://localhost:3000

      - name: Run Playwright tests
        run: npx playwright test
        env:
          CI: 'true'

      - name: Upload Playwright report
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 30
        if: ${{ always() }}

      - name: Upload test results
        uses: actions/upload-artifact@v4
        with:
          name: playwright-results
          path: test-results/
          retention-days: 30
        if: ${{ always() }}
```

## Playwright Configuration for CI

Configure Playwright for CI environments in `playwright.config.ts`:

```typescript
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['junit', { outputFile: 'test-results/results.xml' }],
    ['json', { outputFile: 'test-results/results.json' }],
  ],
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:3000',
    trace: process.env.CI ? 'on-first-retry' : 'on',
    screenshot: 'only-on-failure',
    video: process.env.CI ? 'retain-on-failure' : 'off',
  },
});
```

## Jest Configuration for CI

```javascript
// jest.config.js — CI-aware configuration
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.ts', '**/?(*.)+(spec|test).ts'],
  transform: { '^.+\\.ts$': 'ts-jest' },
  collectCoverageFrom: [
    'src/**/*.service.ts',
    'src/**/*.controller.ts',
    '!src/**/*.module.ts',
    '!src/main.ts',
  ],
  coverageThreshold: {
    global: {
      lines: 70,
      branches: 70,
      functions: 70,
    },
  },
  // CI-specific: fail if coverage drops below threshold
  coverageReporters: process.env.CI
    ? ['json-summary', 'lcov', 'text']
    : ['text', 'lcov'],
  // Use --silent in CI for cleaner output
  silent: !!process.env.CI,
};
```

## Docker Compose CI with Jest/Playwright

```yaml
# docker-compose.ci.yml
services:
  backend:
    build:
      context: ./booking-backend
      target: test
    environment:
      DATABASE_URL: postgresql://app:testpass@db:5432/app_test
      REDIS_URL: redis://redis:6379
      NODE_ENV: test
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_started
    command: ["sh", "-c", "npx prisma migrate deploy && npm run test:ci"]
    profiles:
      - test

  frontend:
    build:
      context: ./booking-frontend
      target: test
    environment:
      API_URL: http://backend:3000
      NODE_ENV: test
    depends_on:
      - backend
    command: ["npx", "playwright", "test"]
    profiles:
      - e2e

  db:
    image: postgres:16-alpine
    tmpfs: /var/lib/postgresql/data
    environment:
      POSTGRES_DB: app_test
      POSTGRES_USER: app
      POSTGRES_PASSWORD: testpass
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app -d app_test"]
      interval: 3s
      timeout: 3s
      retries: 10

  redis:
    image: redis:7-alpine
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5
```

## Key Practices for CI Test Pipelines

1. **Separate jobs by test type**: lint → unit → integration → e2e for parallel execution
2. **Use GitHub Actions service containers** for simple database dependencies
3. **Use Docker Compose for complex multi-service E2E environments**
4. **Set `CI: 'true'` env var** — most test frameworks use this to adjust behavior
5. **Always upload test artifacts** with `if: ${{ always() }}` to capture failures
6. **Use `--ci` flag** on Jest for CI-optimized output
7. **Install Playwright with `--with-deps`** to get system dependencies
8. **Limit Playwright workers to 1 in CI** for stability (`workers: process.env.CI ? 1 : undefined`)
9. **Configure retries** — Playwright: 2 retries in CI; Jest: use `--retries` or `jest-retry`
10. **Use `wait-on`** or health checks instead of `sleep` for service readiness
