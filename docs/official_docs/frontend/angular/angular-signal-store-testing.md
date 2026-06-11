# Angular SignalStore Testing Patterns

**Source**: Context7 (/angular/angular) + NgRx SignalStore documentation
**Library**: /angular/angular
**Fetched**: 2026-06-11

## Overview

NgRx SignalStore provides a reactive state management solution using Angular Signals. Testing SignalStore follows patterns similar to testing services, with specific considerations for signal-based reactivity.

## SignalStore Basics

### Defining a SignalStore

```typescript
import { signalStore, withState, withComputed, withMethods } from '@ngrx/signals';
import { computed } from '@angular/core';

interface CounterState {
  count: number;
  lastUpdated: Date | null;
}

const initialState: CounterState = {
  count: 0,
  lastUpdated: null,
};

export const CounterStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withComputed(({ count }) => ({
    doubled: computed(() => count() * 2),
    isPositive: computed(() => count() >= 0),
  })),
  withMethods((store) => ({
    increment() {
      patchState(store, (state) => ({
        count: state.count + 1,
        lastUpdated: new Date(),
      }));
    },
    setCount(value: number) {
      patchState(store, { count: value, lastUpdated: new Date() });
    },
  })),
);
```

## Testing SignalStore State

### Testing Initial State

```typescript
import { TestBed } from '@angular/core/testing';

describe('CounterStore', () => {
  let store: InstanceType<typeof CounterStore>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [CounterStore],
    });
    store = TestBed.inject(CounterStore);
  });

  it('should have initial count of 0', () => {
    expect(store.count()).toBe(0);
    expect(store.lastUpdated()).toBeNull();
  });
});
```

### Testing Methods that Mutate State

```typescript
it('should increment count', () => {
  store.increment();
  expect(store.count()).toBe(1);
  expect(store.lastUpdated()).toBeInstanceOf(Date);
});

it('should set count to a specific value', () => {
  store.setCount(42);
  expect(store.count()).toBe(42);
});
```

### Testing Computed Signals

```typescript
it('should compute doubled value', () => {
  store.setCount(5);
  expect(store.doubled()).toBe(10);
});

it('should detect positive numbers', () => {
  store.setCount(10);
  expect(store.isPositive()).toBe(true);

  store.setCount(-5);
  expect(store.isPositive()).toBe(false);
});
```

## Testing SignalStore with HTTP

### Store with API Calls

```typescript
export const ProductStore = signalStore(
  { providedIn: 'root' },
  withState({ products: [], loading: false, error: null }),
  withMethods((store, httpClient = inject(HttpClient)) => ({
    loadProducts() {
      patchState(store, { loading: true });
      httpClient.get<Product[]>('/api/products').subscribe({
        next: (products) => patchState(store, { products, loading: false }),
        error: (error) => patchState(store, { error: error.message, loading: false }),
      });
    },
  })),
);
```

### Testing Store with Mocked HTTP

```typescript
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';

describe('ProductStore', () => {
  let store: InstanceType<typeof ProductStore>;
  let httpController: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        ProductStore,
      ],
    });
    store = TestBed.inject(ProductStore);
    httpController = TestBed.inject(HttpTestingController);
  });

  it('should load products', () => {
    const mockProducts = [{ id: 1, name: 'Product 1' }];

    store.loadProducts();
    expect(store.loading()).toBe(true);

    const req = httpController.expectOne('/api/products');
    req.flush(mockProducts);

    expect(store.products()).toEqual(mockProducts);
    expect(store.loading()).toBe(false);
  });

  it('should handle load error', () => {
    store.loadProducts();

    const req = httpController.expectOne('/api/products');
    req.flush('Server Error', { status: 500, statusText: 'Server Error' });

    expect(store.error()).toBeDefined();
    expect(store.loading()).toBe(false);
  });
});
```

## Testing Effects (with rxMethod)

```typescript
import { signalStore, withHooks } from '@ngrx/signals';

export const AuthStore = signalStore(
  { providedIn: 'root' },
  withState({ user: null, token: null, initialized: false }),
  withMethods((store, auth = inject(AuthService)) => ({
    login: rxMethod<Credentials>(
      pipe(
        switchMap((credentials) =>
          auth.login(credentials).pipe(
            tapResponse({
              next: (response) => patchState(store, {
                user: response.user,
                token: response.token,
              }),
              error: (error) => patchState(store, { error: error.message }),
            }),
          ),
        ),
      ),
    ),
  })),
  withHooks({
    onInit(store) {
      // Auto-init logic
    },
  }),
);
```

## Best Practices

1. **Test signal values directly** — read signals with `store.signalName()`
2. **Test computed signals** — verify derived state reacts correctly
3. **Mock dependencies** — use Angular DI to inject mock services
4. **Use `TestBed.inject()`** — avoids manual instantiation
5. **Test async methods** — use fake timers or async patterns
6. **Verify loading/error states** — ensure proper state transitions
