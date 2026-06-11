# Test Reporting and Coverage in GitHub Actions

> **Source**: Context7 (/websites/github_en_actions) + webfetch (docs.github.com)
> **Fetched**: 2026-06-11
> **Domain**: devops_ci — Test Reporting

## Overview

GitHub Actions provides multiple mechanisms for capturing and presenting test results and coverage data. This guide covers artifacts, check runs, code quality integrations, and JUnit XML reporting.

## 1. Uploading Test Results as Artifacts

### Basic Artifact Upload

```yaml
- name: Upload test results
  uses: actions/upload-artifact@v4
  with:
    name: test-results
    path: test-results/
    retention-days: 14
  if: ${{ always() }}
```

### Multi-Artifact Strategy

```yaml
jobs:
  test:
    steps:
      - name: Run tests
        run: npm test -- --coverage --ci

      - name: Upload coverage report
        uses: actions/upload-artifact@v4
        with:
          name: coverage-report
          path: coverage/
          retention-days: 7
        if: ${{ always() }}

      - name: Upload JUnit XML results
        uses: actions/upload-artifact@v4
        with:
          name: junit-results
          path: junit.xml
          retention-days: 30
        if: ${{ always() }}
```

## 2. Configuring Jest for CI Reporting

### Jest JUnit Reporter

Install: `npm install --save-dev jest-junit`

```javascript
// jest.config.js
module.exports = {
  reporters: [
    'default',
    ['jest-junit', {
      outputDirectory: 'test-results',
      outputName: 'junit.xml',
      classNameTemplate: '{classname}',
      titleTemplate: '{title}',
      ancestorSeparator: ' › ',
      usePathForSuiteName: true,
    }],
  ],
  coverageReporters: ['json-summary', 'lcov', 'text', 'clover'],
};
```

Or via CLI:

```bash
npm test -- \
  --ci \
  --coverage \
  --reporters=default \
  --reporters=jest-junit
```

### Jest JSON Summary

```javascript
// jest.config.js — for coverage summary parsing
module.exports = {
  coverageReporters: [
    'json-summary',   // coverage-summary.json — machine-readable
    'lcov',           // lcov.info + HTML report
    'text',           // Console output
    'clover',         // Clover XML — compatible with CI tools
    'cobertura',      // Cobertura XML — for Code Quality
  ],
};
```

## 3. Playwright Test Reporting in CI

### Playwright Reporter Configuration

```typescript
// playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],        // HTML report
    ['junit', { outputFile: 'test-results/junit.xml' }],     // JUnit for CI
    ['json', { outputFile: 'test-results/results.json' }],   // JSON for custom processing
    ['list'],                                                  // Console output
  ],
});
```

### Annotations on Failure

GitHub Actions annotations appear directly in the PR:

```typescript
// playwright.config.ts
export default defineConfig({
  reporter: [
    ['html'],
    [process.env.CI ? 'github' : 'list'],  // GitHub annotations in CI
  ],
});
```

## 4. GitHub Code Quality Integration

### Uploading Cobertura Coverage Reports

```yaml
- name: Run tests with coverage
  run: npm test -- --coverage --ci
  env:
    CI: 'true'

- name: Upload coverage to Code Quality
  uses: actions/upload-artifact@v4
  with:
    name: code-coverage-report
    path: coverage/cobertura-coverage.xml
  if: ${{ always() }}
```

To display coverage directly on PRs (instead of downloading artifacts), upload the Cobertura XML report. GitHub's Code Quality feature can render coverage results inline on pull requests.

## 5. Test Summary Job

Create a summary job that aggregates test results:

```yaml
  test-summary:
    needs: [lint, unit-tests, integration-tests, e2e-tests]
    if: ${{ always() }}
    runs-on: ubuntu-latest
    steps:
      - name: Download all artifacts
        uses: actions/download-artifact@v5
        with:
          path: all-artifacts/

      - name: Display structure
        run: |
          echo "## Test Summary" >> $GITHUB_STEP_SUMMARY
          echo "" >> $GITHUB_STEP_SUMMARY
          echo "| Job | Status | Coverage |" >> $GITHUB_STEP_SUMMARY
          echo "|-----|--------|----------|" >> $GITHUB_STEP_SUMMARY
          echo "| Lint | ✅ | N/A |" >> $GITHUB_STEP_SUMMARY
          echo "| Unit Tests | ✅ | 85% |" >> $GITHUB_STEP_SUMMARY
          echo "| Integration | ✅ | 72% |" >> $GITHUB_STEP_SUMMARY
          echo "| E2E | ✅ | N/A |" >> $GITHUB_STEP_SUMMARY
```

## 6. PR Comment with Coverage Summary

```yaml
  coverage-report:
    needs: [unit-tests]
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@v5
        with:
          name: unit-coverage

      - name: Read coverage summary
        id: coverage
        run: |
          LINES=$(jq -r '.total.lines.pct' coverage-summary.json)
          echo "lines=$LINES" >> $GITHUB_OUTPUT

      - name: Comment PR
        uses: actions/github-script@v7
        with:
          script: |
            const lines = ${{ steps.coverage.outputs.lines }};
            const status = lines >= 80 ? '✅' : '⚠️';
            await github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: `## Coverage Report\n\n${status} Line coverage: **${lines}%**`
            });
```

## 7. Always-Upload Pattern

The most important pattern: **always upload artifacts**, even (especially) when tests fail.

```yaml
- name: Run tests
  run: npm test -- --ci
  id: tests

- name: Upload test results on failure
  uses: actions/upload-artifact@v4
  with:
    name: test-failure-report
    path: |
      test-results/
      playwright-report/
  if: ${{ failure() }}       # Only on failure

- name: Upload coverage always
  uses: actions/upload-artifact@v4
  with:
    name: coverage-report
    path: coverage/
  if: ${{ always() }}        # Always — success or failure
```

## 8. Generating Workflow Run Summary

GitHub Actions supports `$GITHUB_STEP_SUMMARY` for markdown summaries:

```yaml
- name: Generate test summary
  run: |
    echo "## 🧪 Test Results" >> $GITHUB_STEP_SUMMARY
    echo "" >> $GITHUB_STEP_SUMMARY
    echo "| Suite | Status | Duration |" >> $GITHUB_STEP_SUMMARY
    echo "|-------|--------|----------|" >> $GITHUB_STEP_SUMMARY
    echo "| Unit  | ✅ Pass | 45s     |" >> $GITHUB_STEP_SUMMARY
    echo "| E2E   | ✅ Pass | 2m 30s  |" >> $GITHUB_STEP_SUMMARY
```

## 9. Full CI Pipeline with Reporting

```yaml
name: Full CI with Reporting

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - run: npm ci
      - run: npm run build --if-present

      - name: Run tests with coverage
        run: |
          npm test -- --coverage --ci \
            --reporters=default \
            --reporters=jest-junit

      - name: Check coverage threshold
        run: |
          LINES=$(jq -r '.total.lines.pct' coverage/coverage-summary.json)
          if (( $(echo "$LINES < 70" | bc -l) )); then
            echo "❌ Coverage $LINES% is below 70% threshold"
            exit 1
          fi
          echo "✅ Coverage $LINES% meets threshold"

      - name: Upload JUnit results for annotation
        uses: actions/upload-artifact@v4
        with:
          name: junit-results
          path: junit.xml
        if: ${{ always() }}

      - name: Upload coverage report
        uses: actions/upload-artifact@v4
        with:
          name: coverage
          path: coverage/
        if: ${{ always() }}

      - name: Generate summary
        run: |
          echo "## ✅ CI Pipeline Results" >> $GITHUB_STEP_SUMMARY
          echo "- **Tests**: Completed" >> $GITHUB_STEP_SUMMARY
          echo "- **Coverage**: See artifacts" >> $GITHUB_STEP_SUMMARY
```

## 10. Best Practices Summary

| Practice | Detail |
|----------|--------|
| **Always upload artifacts** | Use `if: ${{ always() }}` to capture results even on failure |
| **Use JUnit XML** | Most CI tools (including GitHub) can parse JUnit XML for annotations |
| **Set retention days** | Use `retention-days: N` to manage storage costs |
| **Separate artifacts** | Split coverage, test results, and screenshots into named artifacts |
| **Machine-readable formats** | Use JSON, JUnit XML, Cobertura — not just HTML |
| **PR comments** | Use `github-script` to post coverage summaries on PRs |
| **Step summaries** | Use `$GITHUB_STEP_SUMMARY` for inline workflow run summaries |
| **Check run annotations** | GitHub automatically annotates failures when JUnit XML is uploaded |
| **Fail on coverage drop** | Enforce coverage thresholds in CI with `coverageThreshold` in Jest config |
| **Cache dependencies** | Use `actions/setup-node` with `cache: 'npm'` to speed up installs |
