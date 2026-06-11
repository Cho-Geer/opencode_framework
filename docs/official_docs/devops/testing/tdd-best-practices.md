# TDD Best Practices — RED-GREEN-REFACTOR Cycle

**Source**: Compiled from Jest docs, NestJS docs, industry best practices
**Fetched**: 2026-06-11

## Overview

Test-Driven Development (TDD) is a software development approach where tests are written before the implementation code. The cycle is: **RED → GREEN → REFACTOR**.

## The TDD Cycle

### 1. RED Phase — Write a Failing Test

Write a test that describes the desired behavior. Run it — it **must fail** because the code doesn't exist yet.

```typescript
// RED: This test will fail because AppService doesn't exist yet
describe('AppService', () => {
  it('should return "Hello World!"', () => {
    const service = new AppService();
    expect(service.getHello()).toBe('Hello World!');
  });
});
```

**Key Rules:**
- Write the test FIRST
- Test must fail (verify red)
- Test describes one behavior only
- No implementation code exists yet

### 2. GREEN Phase — Make the Test Pass

Write the **minimum** amount of code to make the test pass. Do not over-engineer.

```typescript
// GREEN: Minimum implementation to pass the test
@Injectable()
export class AppService {
  getHello(): string {
    return 'Hello World!';
  }
}
```

**Key Rules:**
- Write only enough code to pass the test
- No extra features
- All existing tests must still pass
- It's OK to write "ugly" code — you'll refactor next

### 3. REFACTOR Phase — Improve the Code

With all tests passing, improve the code quality without changing behavior.

**Key Rules:**
- All tests must continue to pass
- Improve design, readability, performance
- Remove duplication
- Extract methods, rename variables
- No new functionality

## Benefits of TDD

1. **Better design**: Forces you to think about API/interface first
2. **Comprehensive test coverage**: Every line of code has a test
3. **Regression protection**: Tests catch breaking changes immediately
4. **Documentation**: Tests serve as executable documentation
5. **Confidence**: Refactoring becomes safe and routine

## Test Trophy Model

```
     ╱╲
    ╱ E2E ╲          ~20% — Critical user journeys
   ╱─────────╲
  ╱ Integration ╲    ~40% — Service/module interactions
 ╱───────────────╲
╱   Unit Tests    ╲  ~40% — Individual functions/classes
╱───────────────────╲
```

## Coverage Threshold Guidelines

| Metric | Minimum | Core Business |
|--------|---------|---------------|
| Lines | 70% | 90% |
| Branches | 70% | 90% |
| Functions | 70% | 90% |
| Statements | 70% | 90% |

## Anti-Patterns to Avoid

### ❌ Bogus Tests (False Positives)
```javascript
// WRONG: Always passes
test('test', () => {
  expect(true).toBe(true);
});
```

### ❌ Testing Implementation Details
```javascript
// WRONG: Tests internal state, not behavior
expect(component.internalState.isLoading).toBe(true);

// RIGHT: Tests visible behavior
expect(component.loadingMessage()).toBe('Loading...');
```

### ❌ Over-Mocking
```javascript
// WRONG: Mocking everything, testing nothing real
const mockA = jest.fn();
const mockB = jest.fn();
const mockC = jest.fn();
```

### ❌ Missing Assertions
```javascript
// WRONG: No assertions — not testing anything
test('should do something', async () => {
  await service.create(data);
  // Missing expect() calls!
});
```
