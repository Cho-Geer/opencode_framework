# NestJS Testing with @nestjs/testing

**Source**: Context7 (/nestjs/nest) + NestJS official docs (docs.nestjs.com)
**Library**: /nestjs/nest (v10.4.15, v11.1.16)
**Fetched**: 2026-06-11

## Overview

The `@nestjs/testing` package provides a `Test` class used to construct isolated module environments for both unit and integration testing in NestJS.

## Test.createTestingModule

### Unit Testing a Controller

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { CatsController } from './cats.controller';
import { CatsService } from './cats.service';

describe('CatsController', () => {
  let controller: CatsController;
  let service: CatsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CatsController],
      providers: [CatsService],
    })
      .overrideProvider(CatsService)
      .useValue({
        findAll: jest.fn().mockReturnValue([{ id: 1, name: 'Tom' }]),
      })
      .compile();

    controller = module.get<CatsController>(CatsController);
    service = module.get<CatsService>(CatsService);
  });

  it('should return cats from service', () => {
    const result = controller.findAll();
    expect(result).toEqual([{ id: 1, name: 'Tom' }]);
    expect(service.findAll).toHaveBeenCalledTimes(1);
  });
});
```

### Auto-Mocking with useMocker

```typescript
const module = await Test.createTestingModule({ imports: [AppModule] })
  .useMocker(token => {
    if (token === CatsService) {
      return { findAll: jest.fn().mockReturnValue([]) };
    }
  })
  .compile();
```

### Provider Override Strategies

| Strategy | Method | Use Case |
|----------|--------|----------|
| Custom value | `.useValue(mock)` | Simple mock object |
| Factory | `.useFactory(() => instance)` | Dynamic mock creation |
| Class | `.useClass(MockClass)` | Reusable mock class |

## E2E Testing with Supertest

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from './../src/app.module';

describe('AppController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });
});
```

## Running Tests

```bash
# Unit tests
npm run test

# E2E tests
npm run test:e2e

# Test coverage
npm run test:cov
```

## Key Testing Patterns

1. **Unit test controllers**: Mock all service dependencies
2. **Unit test services**: Mock repository/DB dependencies
3. **Integration tests**: Use `.useMocker()` for auto-mocking or compile full modules
4. **E2E tests**: Create full NestJS app with `createNestApplication()`, test via Supertest
5. **Override guards/pipes/interceptors**: Use `.overrideGuard()`, `.overridePipe()`, `.overrideInterceptor()`
