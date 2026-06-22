# Prisma Transactions and Relations

**Source**: Context7 (/prisma/prisma) + Prisma official docs
**Library**: /prisma/prisma (v7.5.0)
**Fetched**: 2026-06-22
**Domain**: persistence
**Tags**: prisma, transaction, relation, ORM, database, interactive-transaction, nested-write, include, relation-filter

## Overview

Prisma provides a type-safe ORM for Node.js and TypeScript with powerful transaction management and relation querying capabilities. This document covers interactive transactions, relation queries (include/select), nested writes, and relation filters.

---

## Part 1: Transactions

### 1.1 Interactive Transactions ($transaction with callback)

Interactive transactions allow you to execute multiple Prisma operations within a single transaction context that can be committed or rolled back atomically.

```typescript
import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

// Basic interactive transaction
await prisma.$transaction(async (tx) => {
  const user = await tx.user.create({
    data: { email: "alice@example.com", name: "Alice" },
  });

  const post = await tx.post.create({
    data: {
      title: "My First Post",
      content: "Hello World",
      authorId: user.id,
    },
  });

  return post;
});
```

**Key characteristics:**

- If any operation fails, ALL operations are rolled back
- The `tx` client is a PrismaClient proxy — use it instead of the main `prisma` instance
- Return a value from the callback to pass it outside the transaction
- Automatic rollback on thrown errors

### 1.2 Batch Transaction ($transaction with array)

For independent operations that don't depend on each other's results:

```typescript
// Batch operations in a single transaction
const [user, post] = await prisma.$transaction([
  prisma.user.create({ data: { email: "bob@example.com", name: "Bob" } }),
  prisma.post.create({
    data: { title: "Batch Post", content: "Created in batch", authorId: 1 },
  }),
]);
```

**Limitations:**

- Operations are independent (no chaining results)
- Uses `PrismaPromise` — all promises are executed within a single transaction
- If any fails, all are rolled back

### 1.3 Transaction Isolation Levels

Prisma supports setting isolation levels for interactive transactions:

```typescript
// ReadCommitted isolation level
await prisma.$transaction(
  async (tx) => {
    await tx.user.create({ data: { email: "user@example.com" } });
  },
  {
    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
  },
);

// Serializable isolation level (highest isolation)
await prisma.$transaction(
  async (tx) => {
    await tx.user.create({ data: { email: "user@example.com" } });
  },
  {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  },
);
```

**Available isolation levels:**
| Level | Description |
|-------|-------------|
| `ReadUncommitted` | Lowest isolation — dirty reads possible |
| `ReadCommitted` | Prevents dirty reads — default for most databases |
| `RepeatableRead` | Prevents non-repeatable reads |
| `Serializable` | Highest isolation — full serializability |

### 1.4 Transaction Configuration Options

```typescript
export type Options = {
  /** Timeout (ms) for starting the transaction */
  maxWait?: number;

  /** Timeout (ms) for the transaction body */
  timeout?: number;

  /** Transaction isolation level */
  isolationLevel?: IsolationLevel;

  /** Used for nested interactive transactions */
  newTxId?: string;
};
```

Example with all options:

```typescript
await prisma.$transaction(
  async (tx) => {
    // Transaction body
    const result = await tx.user.update({
      where: { id: userId },
      data: { balance: { decrement: amount } },
    });
    return result;
  },
  {
    maxWait: 5000, // Wait max 5s for transaction to start
    timeout: 30000, // Transaction body timeout: 30s
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  },
);
```

### 1.5 Row Locking (SELECT FOR UPDATE)

Prevent concurrent updates by locking rows within a transaction:

```typescript
await prisma.$transaction(
  async (tx) => {
    // Lock the row to prevent concurrent modifications
    await tx.$queryRaw`SELECT id FROM "User" WHERE email = 'x' FOR UPDATE`;

    const user = await tx.user.findUniqueOrThrow({
      where: { email: "x" },
    });

    const updatedUser = await tx.user.update({
      where: { email: "x" },
      data: { val: user.val + 1 },
    });

    return updatedUser;
  },
  { timeout: 60_000, maxWait: 60_000 },
);
```

### 1.6 Retry Logic for P2034 (Write Conflicts)

When using `Serializable` isolation level, transactions may fail with P2034 (write conflict/deadlock). Implement retry logic:

```typescript
const MAX_RETRIES = 5;

async function executeWithRetry<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let retries = 0; retries < MAX_RETRIES; retries++) {
    try {
      return await prisma.$transaction(fn, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 10000,
      });
    } catch (e) {
      if ((e as any)?.code === "P2034") {
        // Transaction failed due to write conflict or deadlock — retry
        continue;
      }
      throw e;
    }
  }
  throw new Error("Max retries exceeded for transaction");
}
```

### 1.7 Nested Interactive Transactions

You can catch errors from nested transactions and continue the outer transaction:

```typescript
await prisma.$transaction(async (tx) => {
  await tx.user.create({ data: { email: "outer1@example.com" } });

  try {
    await tx.$transaction(async (tx2) => {
      await tx2.user.create({ data: { email: "inner@example.com" } });
      throw new Error("Inner transaction rolled back");
    });
  } catch (e) {
    // Inner transaction rolled back, but outer continues
    console.log("Inner transaction failed:", e.message);
  }

  // This still succeeds because only the inner transaction was rolled back
  await tx.user.create({ data: { email: "outer2@example.com" } });
});
```

**Important:** The inner transaction rollback does NOT roll back the outer transaction. Only the inner changes are discarded.

### 1.8 Preventing Duplicate Records (Unique Constraint)

Use partial unique indexes (PostgreSQL) with `$transaction` for idempotent operations:

```typescript
// Schema: unique constraint on [date, slot_sequence]
model TimeSlot {
  id             Int      @id @default(autoincrement())
  date           DateTime
  slot_sequence  Int
  is_booked      Boolean  @default(false)

  @@unique([date, slot_sequence])
}

// Safe creation within transaction
await prisma.$transaction(async (tx) => {
  try {
    const slot = await tx.timeSlot.create({
      data: { date, slot_sequence: sequence },
    });
    return slot;
  } catch (e) {
    if ((e as any)?.code === 'P2002') {
      // Unique constraint violation — slot already exists
      return null;
    }
    throw e;
  }
});
```

---

## Part 2: Relations

### 2.1 Defining Relations in Schema

**1:1 Relation:**

```prisma
model User {
  id      Int      @id @default(autoincrement())
  profile Profile?
}

model Profile {
  id     Int  @id @default(autoincrement())
  userId Int  @unique
  user   User @relation(fields: [userId], references: [id])
}
```

**1:N Relation:**

```prisma
model User {
  id    Int    @id @default(autoincrement())
  posts Post[]
}

model Post {
  id       Int  @id @default(autoincrement())
  author   User @relation(fields: [authorId], references: [id])
  authorId Int
}
```

**N:M Relation:**

```prisma
model Post {
  id        Int          @id @default(autoincrement())
  categories Category[]
}

model Category {
  id    Int    @id @default(autoincrement())
  posts Post[]
}
```

**N:M with Explicit Join Table:**

```prisma
model Post {
  id          Int              @id @default(autoincrement())
  categories  PostsOnCategories[]
}

model Category {
  id    Int              @id @default(autoincrement())
  posts PostsOnCategories[]
}

model PostsOnCategories {
  postId     Int
  categoryId Int
  post       Post     @relation(fields: [postId], references: [id])
  category   Category @relation(fields: [categoryId], references: [id])

  @@id([postId, categoryId])
}
```

### 2.2 Including Relations in Queries

**Basic include:**

```typescript
// Include related posts
const user = await prisma.user.findUnique({
  where: { id: 1 },
  include: { posts: true },
});

// Nested include (relation within relation)
const user = await prisma.user.findUnique({
  where: { id: 1 },
  include: {
    posts: {
      include: {
        categories: true,
      },
    },
  },
});
```

**Select with nested fields:**

```typescript
// Select specific fields from main record AND relation
const user = await prisma.user.findUnique({
  where: { id: 1 },
  select: {
    id: true,
    name: true,
    email: true,
    posts: {
      select: {
        id: true,
        title: true,
        published: true,
      },
    },
  },
});
```

### 2.3 Filtering by Relations

**Using `some` — at least one related record matches:**

```typescript
// Find users who have at least one post with "Prisma" in title
const users = await prisma.user.findMany({
  where: {
    posts: {
      some: {
        title: { contains: "Prisma" },
      },
    },
  },
});
```

**Using `every` — ALL related records match:**

```typescript
// Find users where ALL posts are published
const users = await prisma.user.findMany({
  where: {
    posts: {
      every: {
        published: true,
      },
    },
  },
});
```

**Using `none` — NO related records match:**

```typescript
// Find users with no posts
const users = await prisma.user.findMany({
  where: {
    posts: {
      none: {
        published: true,
      },
    },
  },
});
```

**Filtering with AND/OR on relations:**

```typescript
const comments = await prisma.comment.findMany({
  where: {
    OR: [{ id: id1 }, { id: id2 }],
    contents: {
      every: {
        upvotes: { every: { vote: true } },
      },
    },
  },
});
```

### 2.4 Nested Writes (Create Related Records)

**Create with nested create:**

```typescript
// Create user AND their first post in one query
const user = await prisma.user.create({
  data: {
    name: "Alice",
    email: "alice@example.com",
    posts: {
      create: { title: "My First Post", content: "Hello Prisma!" },
    },
  },
  include: { posts: true },
});
```

**Connect existing records:**

```typescript
// Create a post and connect it to an existing user
const post = await prisma.post.create({
  data: {
    title: "New Post",
    content: "Content here",
    author: { connect: { id: 1 } },
  },
});
```

**Connect or create:**

```typescript
const post = await prisma.post.create({
  data: {
    title: "Post with Category",
    content: "Content",
    author: { connect: { id: 1 } },
    categories: {
      connectOrCreate: {
        where: { id: 5 },
        create: { name: "Technology" },
      },
    },
  },
});
```

### 2.5 Update with Nested Writes

**Create + Connect in update:**

```typescript
const user = await prisma.user.update({
  where: { id: 1 },
  data: {
    posts: {
      create: { title: "Another Post" },
      connect: { id: 10 },
    },
  },
  select: {
    id: true,
    name: true,
    posts: {
      select: { id: true, title: true },
    },
  },
});
```

**Disconnect + Delete:**

```typescript
const user = await prisma.user.update({
  where: { id: 1 },
  data: {
    posts: {
      disconnect: { id: 5 }, // Unlink post 5 (keep post)
      delete: { id: 3 }, // Delete post 3
    },
  },
});
```

**Set (replace all relations):**

```typescript
// Replace ALL categories with just these two
const post = await prisma.post.update({
  where: { id: 1 },
  data: {
    categories: {
      set: [{ id: 1 }, { id: 2 }],
    },
  },
});
```

**Delete many:**

```typescript
const user = await prisma.user.update({
  where: { id: 1 },
  data: {
    posts: {
      deleteMany: {
        published: false,
      },
    },
  },
});
```

---

## Part 3: Best Practices

### 3.1 Transaction Best Practices

1. **Keep transactions short** — Long transactions hold locks and reduce concurrency
2. **Use `timeout`** — Always set a timeout to prevent hanging transactions
3. **Retry on P2034** — Implement retry logic for `Serializable` isolation
4. **Use `maxWait`** — Set a reasonable max wait time for transaction availability
5. **Prefer interactive transactions** — When you need conditional logic or dependent operations

### 3.2 Relation Best Practices

1. **Use `include` sparingly** — Only include what you need; use `select` for nested field filtering
2. **Avoid N+1 queries** — Use `include` to eager-load relations instead of querying in a loop
3. **Use pagination** — Use `take`/`skip` when fetching large relation sets
4. **Index foreign keys** — Ensure foreign key columns have indexes for relation queries
5. **Use `@@unique` for composite keys** — Define composite unique constraints for business logic validation

### 3.3 Error Handling Reference

| Error Code | Description                 | Common Cause                           |
| ---------- | --------------------------- | -------------------------------------- |
| P2002      | Unique constraint violation | Duplicate entry                        |
| P2025      | Record not found            | Update/delete on missing record        |
| P2014      | Required relation violation | Missing required relation              |
| P2034      | Transaction write conflict  | Concurrent modification (Serializable) |
