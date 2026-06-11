# Jest 29+ Unit Testing Framework

**Source**: Context7 (/jestjs/jest) + Jest official docs (jestjs.io)
**Library**: /jestjs/jest (v29.7.0)
**Fetched**: 2026-06-11

## Overview

Jest is a delightful JavaScript Testing Framework with a focus on simplicity. It works great out of the box for most JavaScript projects, producing zero-configuration testing.

- Benchmark Score: 87.7
- Code Snippets Available: 3,155
- Source Reputation: Medium

## Core Concepts

### describe/it/expect Pattern

```javascript
describe('Calculator', () => {
  describe('addition', () => {
    it('should return 4 when adding 2 + 2', () => {
      expect(2 + 2).toBe(4);
    });

    it('should handle negative numbers', () => {
      expect(-1 + 1).toBe(0);
    });
  });
});
```

### Setup and Teardown

```javascript
beforeEach(() => {
  initializeCityDatabase();
});

afterEach(() => {
  clearCityDatabase();
});

test('city database has Vienna', () => {
  expect(isCity('Vienna')).toBeTruthy();
});
```

## Mock Functions

### Creating Mock Functions with jest.fn()

```javascript
const mockCallback = jest.fn(x => 42 + x);

test('forEach mock function', () => {
  forEach([0, 1], mockCallback);
  expect(mockCallback.mock.calls).toHaveLength(2);
  expect(mockCallback.mock.calls[0][0]).toBe(0);
  expect(mockCallback.mock.calls[1][0]).toBe(1);
  expect(mockCallback.mock.results[0].value).toBe(42);
});
```

### jest.spyOn() — Spy on Object Methods

```javascript
const video = {
  play() { return true; },
};

afterEach(() => {
  jest.restoreAllMocks();
});

test('plays video', () => {
  const spy = jest.spyOn(video, 'play');
  const isPlaying = video.play();
  expect(spy).toHaveBeenCalled();
  expect(isPlaying).toBe(true);
});
```

### Mock Return Values

```javascript
const myMock = jest.fn();
myMock.mockReturnValueOnce(10).mockReturnValueOnce('x').mockReturnValue(true);
// 10, 'x', true, true
```

### Mocking Modules

```javascript
import axios from 'axios';
import Users from './users';

jest.mock('axios');

test('should fetch users', () => {
  const users = [{name: 'Bob'}];
  const resp = {data: users};
  axios.get.mockResolvedValue(resp);
  return Users.all().then(data => expect(data).toEqual(users));
});
```

### jest.mock() with ES6 Classes

```javascript
jest.mock('./sound-player', () => {
  return jest.fn().mockImplementation(() => {
    return {playSoundFile: mockPlaySoundFile};
  });
});
```

### Partial Mocks

```javascript
jest.mock('../foo-bar-baz', () => {
  const originalModule = jest.requireActual('../foo-bar-baz');
  return {
    __esModule: true,
    ...originalModule,
    default: jest.fn(() => 'mocked baz'),
    foo: 'mocked foo',
  };
});
```

### Mock Implementations

```javascript
const myMockFn = jest
  .fn()
  .mockImplementationOnce(cb => cb(null, true))
  .mockImplementationOnce(cb => cb(null, false));
```

## Custom Matchers

```javascript
expect(mockFunc).toHaveBeenCalled();
expect(mockFunc).toHaveBeenCalledWith(arg1, arg2);
expect(mockFunc).toHaveBeenLastCalledWith(arg1, arg2);
expect(mockFunc).toMatchSnapshot();
```

## Mock Property Inspection

```javascript
// Using the .mock property directly
expect(mockFunc.mock.calls.length).toBeGreaterThan(0);
expect(mockFunc.mock.calls).toContainEqual([arg1, arg2]);
expect(mockFunc.mock.calls[mockFunc.mock.calls.length - 1]).toEqual([arg1, arg2]);
expect(mockFunc.mock.calls).toEqual([[arg1, arg2]]);
expect(mockFunc.getMockName()).toBe('a mock name');
```

## Configuration

### Jest Config (jest.config.ts)

```typescript
import {defineConfig} from 'jest';

export default defineConfig({
  automock: true,
  fakeTimers: { enableGlobally: true },
  setupFilesAfterEnv: ['./jest.setup.ts'],
  coverageThreshold: {
    global: { lines: 80, branches: 70, functions: 80, statements: 80 },
  },
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.spec.ts'],
});
```

### Fake Timers

```javascript
jest.useFakeTimers({doNotFake: ['performance']});
jest.useFakeTimers({timerLimit: 100});
```

## Coverage Reporting

```bash
npx jest --coverage
```

Coverage thresholds can enforce quality gates in CI/CD pipelines.
