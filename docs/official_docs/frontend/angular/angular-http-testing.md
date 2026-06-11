# Angular HTTP Service Testing with HttpClientTestingModule

**Source**: Context7 (/angular/angular) + Angular official docs
**Library**: /angular/angular
**Fetched**: 2026-06-11

## Overview

Angular provides `HttpClientTestingModule` and `HttpTestingController` to test HTTP services without making real network requests.

## Setup

### Global Test Providers (Angular v21+)

Create a `src/test-providers.ts` file:

```typescript
import { EnvironmentProviders, Provider } from '@angular/core';
import { provideHttpClientTesting } from '@angular/common/http/testing';

const testProviders: (Provider | EnvironmentProviders)[] = [
  provideHttpClientTesting(),
];

export default testProviders;
```

Reference in `angular.json`:

```json
{
  "options": {
    "providersFile": "src/test-providers.ts"
  }
}
```

## Testing HTTP Services

### Service Test Setup

```typescript
import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { DataService } from './data.service';

describe('DataService', () => {
  let service: DataService;
  let httpController: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        DataService,
      ],
    });
    service = TestBed.inject(DataService);
    httpController = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    // Verify no unmatched requests remain
    httpController.verify();
  });
});
```

### Testing GET Request

```typescript
it('should return expected data', () => {
  const mockData = [{ id: 1, name: 'Item 1' }];

  service.getItems().subscribe(data => {
    expect(data).toEqual(mockData);
  });

  const req = httpController.expectOne('/api/items');
  expect(req.request.method).toBe('GET');
  req.flush(mockData);
});
```

### Testing Error Handling

```typescript
it('should handle 404 error', () => {
  const errorMessage = 'Not Found';

  service.getItems().subscribe({
    next: () => fail('expected an error'),
    error: (error) => {
      expect(error.status).toBe(404);
      expect(error.statusText).toBe('Not Found');
    },
  });

  const req = httpController.expectOne('/api/items');
  req.flush(errorMessage, {
    status: 404,
    statusText: 'Not Found',
  });
});
```

### Testing POST Request

```typescript
it('should create an item', () => {
  const newItem = { name: 'New Item' };
  const createdItem = { id: 1, ...newItem };

  service.createItem(newItem).subscribe(data => {
    expect(data).toEqual(createdItem);
  });

  const req = httpController.expectOne('/api/items');
  expect(req.request.method).toBe('POST');
  expect(req.request.body).toEqual(newItem);
  req.flush(createdItem);
});
```

### Testing Multiple Sequential Requests

```typescript
it('should chain requests', () => {
  service.getItemAndDetails(1).subscribe();

  // First request
  const itemReq = httpController.expectOne('/api/items/1');
  expect(itemReq.request.method).toBe('GET');
  itemReq.flush({ id: 1, name: 'Item' });

  // Second request (triggered by first response)
  const detailReq = httpController.expectOne('/api/items/1/details');
  expect(detailReq.request.method).toBe('GET');
  detailReq.flush({ description: 'Details' });
});
```

## Key Testing APIs

| API | Purpose |
|-----|---------|
| `provideHttpClientTesting()` | Provide HTTP testing utilities |
| `HttpTestingController` | Mock HTTP request controller |
| `httpController.expectOne(url)` | Expect exactly one matching request |
| `httpController.expectNone(url)` | Verify no matching request |
| `httpController.verify()` | Verify no unmatched requests |
| `req.flush(data)` | Provide mock response |
| `req.flush(msg, { status, statusText })` | Provide mock error response |
| `req.request.method` | Inspect request method |
| `req.request.body` | Inspect request body |
| `req.request.params` | Inspect query params |
