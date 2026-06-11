# Playwright E2E Testing

**Source**: Context7 (/microsoft/playwright) + Playwright official docs (playwright.dev)
**Library**: /microsoft/playwright (v1.51.0, v1.58.2)
**Fetched**: 2026-06-11

## Overview

Playwright is a framework for Web Testing and Automation, enabling cross-browser testing of Chromium, Firefox, and WebKit with a single API.

- Benchmark Score: 83.7
- Code Snippets Available: 7,228
- Source Reputation: High

## Installation

```bash
npm init playwright@latest
```

This scaffolds: `playwright.config.ts`, `tests/example.spec.ts`, and installs browser binaries.

## Writing Tests

### Basic Test

```typescript
import { test, expect } from '@playwright/test';

test('has title', async ({ page }) => {
  await page.goto('https://playwright.dev');
  await expect(page).toHaveTitle(/Playwright/);
});
```

### Test Fixtures and Isolation

Playwright Test provides isolated `page` and `context` fixtures:

```typescript
test('example test', async ({ page, context }) => {
  // "context" is an isolated BrowserContext, created for this specific test.
  // "page" belongs to this context.
});

test('another test', async ({ page, context }) => {
  // Completely isolated from the first test
});
```

Each test runs in a **fresh browser context**, equivalent to a brand new browser profile.

## Page Object Model

### Creating a Page Object

```typescript
import { expect, type Locator, type Page } from '@playwright/test';

export class PlaywrightDevPage {
  readonly page: Page;
  readonly getStartedLink: Locator;
  readonly gettingStartedHeader: Locator;

  constructor(page: Page) {
    this.page = page;
    this.getStartedLink = page.locator('a', { hasText: 'Get started' });
    this.gettingStartedHeader = page.locator('h1', { hasText: 'Installation' });
  }

  async goto() {
    await this.page.goto('https://playwright.dev');
  }

  async getStarted() {
    await this.getStartedLink.first().click();
    await expect(this.gettingStartedHeader).toBeVisible();
  }
}
```

### Using Page Objects in Tests

```typescript
import { test, expect } from '@playwright/test';
import { PlaywrightDevPage } from './playwright-dev-page';

test('getting started should contain table of contents', async ({ page }) => {
  const playwrightDev = new PlaywrightDevPage(page);
  await playwrightDev.goto();
  await playwrightDev.getStarted();
  await expect(playwrightDev.tocList).toHaveText([
    `How to install Playwright`,
    `What's installed`,
    `How to run the example test`,
  ]);
});
```

## Test Runner Features

### Cross-Browser Execution

Tests run in parallel across Chromium, Firefox, and WebKit (configurable).

### Running Tests

```bash
npx playwright test
npx playwright test --headed          # Show browser window
npx playwright test --project=chromium # Single browser
npx playwright test --ui               # UI Mode with watch
```

### HTML Test Reports

```bash
npx playwright show-report
```

Reports provide filtering by browser, passed/failed/skipped tests, error details, and attachments.

## Key Concepts

- **Browser contexts**: Isolated environments equivalent to incognito sessions
- **Auto-waiting**: Playwright automatically waits for elements to be actionable
- **Web-first assertions**: Assertions that retry until the condition is met or timeout
- **Trace Viewer**: Full trace of test execution for debugging
- **Codegen**: Generate tests by recording browser interactions
