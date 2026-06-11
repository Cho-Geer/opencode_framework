# Prisma Testing Strategies

**Source**: Context7 (/prisma/prisma) + Prisma official docs
**Library**: /prisma/prisma (v5.x, v6.x, v7.x)
**Fetched**: 2026-06-11

## Overview

Prisma testing involves several strategies from unit mocking to full integration testing with real databases.

## Strategy 1: Mocking Prisma Client (Unit Tests)

### Mocking the PrismaService for NestJS

```typescript
const module: TestingModule = await Test.createTestingModule({
  providers: [
    CatsService,
    {
      provide: PrismaService,
      useValue: {
        cat: {
          findMany: jest.fn(),
          findUnique: jest.fn(),
          create: jest.fn(),
          update: jest.fn(),
          delete: jest.fn(),
        },
        $transaction: jest.fn(),
      },
    },
  ],
}).compile();
```

### Testing with Mock Transaction

```typescript
it('should perform transactional create', async () => {
  prisma.$transaction.mockImplementation(async (cb) => {
    return cb(prisma);
  });

  const result = await service.createWithTransaction(dto);
  expect(prisma.cat.create).toHaveBeenCalled();
});
```

## Strategy 2: Test Database with SQLite (Integration)

Use SQLite `:memory:` for fast, isolated tests:

```typescript
import { PrismaClient } from '@prisma/client';

describe('CatRepository (integration)', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = new PrismaClient({
      datasources: { db: { url: 'file:./test.db' } },
    });
    await prisma.$connect();
    // Run migrations or push schema
    await prisma.$executeRawUnsafe('PRAGMA foreign_keys = OFF');
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  afterEach(async () => {
    // Clean up data between tests
    await prisma.cat.deleteMany();
  });

  it('should create a cat', async () => {
    const cat = await prisma.cat.create({
      data: { name: 'Tom', breed: 'Siamese' },
    });
    expect(cat.id).toBeDefined();
    expect(cat.name).toBe('Tom');
  });
});
```

## Strategy 3: Transaction Isolation

### Understanding Isolation Levels

Prisma supports setting the isolation level for transactions:

```typescript
// Default: no explicit isolation level set, database default applies
await prisma.$transaction([
  prisma.user.findFirst({}),
  prisma.user.findFirst({}),
]);

// With specific isolation level
await prisma.$transaction(
  [
    prisma.user.create({ data: { name: 'Alice' } }),
    prisma.user.update({ where: { id: 1 }, data: { name: 'Bob' } }),
  ],
  { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
);
```

### Best Practices for Test Isolation

1. **Use `deleteMany()` in `afterEach`** to clean up data between tests
2. **Wrap each test in a transaction** that rolls back at the end for perfect isolation
3. **Use unique test data** to prevent collisions in parallel test runs

```typescript
// Transaction rollback pattern for perfect isolation
it('should handle concurrent bookings', async () => {
  // Test with explicit transaction that we can abort
  await prisma.$transaction(async (tx) => {
    const slots = await tx.timeSlot.findMany({ where: { date: today } });
    // ... test assertions ...
    // Transaction rolls back automatically on test failure
  });
});
```

## Strategy 4: Test Fixtures and Seeding

```typescript
// Before all tests, seed common data
beforeAll(async () => {
  await prisma.cat.createMany({
    data: [
      { name: 'Tom', breed: 'Siamese' },
      { name: 'Jerry', breed: 'Tabby' },
    ],
  });
});
```

## Strategy 5: Using Testcontainers

For production-like testing with PostgreSQL/MySQL:

```typescript
// Using Testcontainers for a real PostgreSQL instance
// Requires Docker
import { PostgreSqlContainer } from '@testcontainers/postgresql';

let container: PostgreSqlContainer;

beforeAll(async () => {
  container = await new PostgreSqlContainer().start();
  process.env.DATABASE_URL = container.getConnectionUri();
  // Reinitialize Prisma with new connection
});
```

## Strategy 6: Migration Testing

```typescript
// Testing migration workflows (from Prisma's own test suite)
it('should run migrate diff to detect schema drift', async () => {
  const result = MigrateDiff.new().parse(
    ['--from-config-datasource', '--to-schema=./prisma/schema.prisma', '--script'],
    await ctx.config(),
    ctx.configDir(),
  );
  await expect(result).resolves.toMatchInlineSnapshot(`""`);
});
```
