# Redis Cache Patterns with ioredis

**Source**: Context7 (/redis/ioredis) + ioredis README (GitHub)
**Library**: /redis/ioredis (v5.4.0)
**Fetched**: 2026-06-22
**Domain**: caching
**Tags**: redis, ioredis, cache, caching-patterns, cache-aside, pipelining, pub-sub, cluster, sentinel, ttl, lua-scripting

## Overview

ioredis is a robust, performance-focused, and full-featured Redis client for Node.js and TypeScript. It supports Cluster, Sentinel, Streams, Pipelining, Lua scripting, Redis Functions, Pub/Sub, and offers features like transparent key prefixing, offline queue, and auto-reconnection. This document covers common caching patterns, connection setup, and advanced features.

---

## Part 1: Connection & Basic Setup

### 1.1 Connecting to Redis

```javascript
const Redis = require("ioredis");

// Default: localhost:6379
const redis = new Redis();

// Custom port and host
const redis = new Redis(6380); // 127.0.0.1:6380
const redis = new Redis(6379, "192.168.1.1"); // 192.168.1.1:6379

// Unix socket
const redis = new Redis("/tmp/redis.sock");

// Options object
const redis = new Redis({
  port: 6379,
  host: "127.0.0.1",
  username: "default", // Redis >= 6
  password: "my-top-secret",
  db: 0, // Defaults to 0
  retryStrategy: (times) => {
    const delay = Math.min(times * 50, 2000);
    return delay; // Reconnect with exponential backoff
  },
});
```

### 1.2 Connection URLs

```javascript
// redis:// URL
new Redis("redis://:authpassword@127.0.0.1:6380/4");

// With username
new Redis("redis://username:authpassword@127.0.0.1:6380/4");

// TLS (rediss://)
new Redis("rediss://redis.my-service.com");
```

### 1.3 Connection Events

```javascript
redis.on("connect", () => console.log("Connected to Redis"));
redis.on("ready", () => console.log("Redis ready to receive commands"));
redis.on("error", (err) => console.error("Redis error:", err));
redis.on("close", () => console.log("Redis connection closed"));
redis.on("reconnecting", (delay) => console.log(`Reconnecting in ${delay}ms`));
redis.on("end", () => console.log("No more reconnections will be made"));
```

---

## Part 2: Cache Patterns

### 2.1 Cache-Aside (Lazy Caching) — Most Common Pattern

The application is responsible for reading from cache first, and falling back to the database on cache miss.

```javascript
async function getUser(userId) {
  const cacheKey = `user:${userId}`;

  // 1. Try cache first
  const cached = await redis.get(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }

  // 2. Cache miss — fetch from database
  const user = await db.users.findUnique({ where: { id: userId } });
  if (!user) return null;

  // 3. Store in cache with TTL
  await redis.setex(cacheKey, 3600, JSON.stringify(user));

  return user;
}
```

### 2.2 Write-Through Cache

Data is written to cache first, then to the database synchronously. Ensures cache always has fresh data.

```javascript
async function updateUser(userId, data) {
  const cacheKey = `user:${userId}`;

  // 1. Update database
  const user = await db.users.update({
    where: { id: userId },
    data: data,
  });

  // 2. Update cache synchronously
  await redis.setex(cacheKey, 3600, JSON.stringify(user));

  return user;
}
```

### 2.3 Write-Behind (Lazy Write)

Data is written to cache immediately and asynchronously persisted to the database. High performance but risks data loss.

```javascript
async function writeBehind(userId, data) {
  const cacheKey = `user:${userId}`;

  // 1. Write to cache immediately
  await redis.setex(cacheKey, 3600, JSON.stringify(data));

  // 2. Queue database write asynchronously
  queue.add("db-write", { userId, data });
}
```

### 2.4 Cache Invalidation Strategies

**Explicit deletion on update:**

```javascript
async function deleteUser(userId) {
  const cacheKey = `user:${userId}`;

  // 1. Delete from database
  await db.users.delete({ where: { id: userId } });

  // 2. Invalidate cache
  await redis.del(cacheKey);
}
```

**Pattern-based invalidation:**

```javascript
// Invalidate all user-related caches
async function invalidateUserCache(userId) {
  const stream = redis.scanStream({ match: `user:${userId}:*` });
  stream.on("data", async (keys) => {
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  });
}
```

**Versioned cache keys:**

```javascript
// Use a version counter to invalidate all keys at once
const version = await redis.incr("cache:user:version");
const cacheKey = `user:${userId}:v${version}`;
await redis.setex(cacheKey, 3600, JSON.stringify(user));
```

### 2.5 Rate Limiting Pattern

```javascript
async function rateLimit(userId, maxRequests, windowSeconds) {
  const key = `ratelimit:${userId}`;
  const current = await redis.incr(key);
  if (current === 1) {
    await redis.expire(key, windowSeconds); // Set TTL on first request
  }
  return current <= maxRequests;
}

// Usage
if (await rateLimit("user:123", 100, 60)) {
  // Allow request
} else {
  // Rate limited — return 429
}
```

### 2.6 Session Store Pattern

```javascript
// Store session
await redis.setex(
  `session:${sessionId}`,
  86400, // 24 hour TTL
  JSON.stringify({ userId, roles, expiresAt }),
);

// Retrieve session
const session = JSON.parse(await redis.get(`session:${sessionId}`));

// Extend session on activity
await redis.expire(`session:${sessionId}`, 86400);

// Delete session on logout
await redis.del(`session:${sessionId}`);
```

---

## Part 3: TTL & Key Expiration

### 3.1 Setting Expiration

```javascript
// Set with expiration in seconds
redis.set("key", "data", "EX", 60); // Expires in 60 seconds
redis.setex("key", 60, "data"); // Same as above (set with expire)
redis.psetex("key", 60000, "data"); // Expire in milliseconds

// Set with expiration in milliseconds
redis.set("key", "data", "PX", 60000);

// Set expiration at a specific Unix timestamp
redis.set("key", "data", "EXAT", 1719000000);

// Set on existing key
redis.expire("key", 60); // Set TTL on existing key
redis.expireat("key", 1719000000); // Set expiry at specific Unix time
redis.pexpire("key", 60000); // Expire in milliseconds
redis.ttl("key"); // Get remaining TTL in seconds
redis.pttl("key"); // Get remaining TTL in ms

// Remove expiration (make persistent)
redis.persist("key");
```

### 3.2 Conditional SET (NX/XX)

```javascript
// NX — Only set if key does NOT exist (useful for distributed locks)
await redis.set("lock:resource", "locked", "NX", "EX", 10);

// XX — Only set if key already exists
await redis.set("existing-key", "new-value", "XX");

// NX + GET — Return old value if key existed
const oldVal = await redis.set("mykey", "newvalue", "NX", "GET");

// KEEPTTL — Set value while retaining existing TTL
await redis.set("mykey", "anotherValue", "KEEPTTL");
```

### 3.3 Distributed Lock Pattern

```javascript
const LOCK_TTL = 10; // seconds

async function acquireLock(resourceId, ownerId) {
  const lockKey = `lock:${resourceId}`;
  const acquired = await redis.set(lockKey, ownerId, "NX", "EX", LOCK_TTL);
  return acquired === "OK";
}

async function releaseLock(resourceId, ownerId) {
  const script = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("del", KEYS[1])
    else
      return 0
    end
  `;
  // Only release if we still own the lock
  await redis.eval(script, 1, `lock:${resourceId}`, ownerId);
}
```

---

## Part 4: Advanced Features

### 4.1 Pipelining

Pipelining queues commands in memory and sends them all at once, improving performance 50–300%.

```javascript
// Chained pipeline
const results = await redis
  .pipeline()
  .set("foo", "bar")
  .get("foo")
  .del("cc")
  .exec();
// results === [[null, 'OK'], [null, 'bar'], [null, 1]]

// Pipeline with per-command callbacks
redis
  .pipeline()
  .set("foo", "bar")
  .get("foo", (err, result) => {
    // result === 'bar'
  })
  .exec((err, results) => {
    // results[1][1] === 'bar'
  });

// Pipeline from array
redis
  .pipeline([
    ["set", "foo", "bar"],
    ["get", "foo"],
  ])
  .exec();
```

### 4.2 Transactions (MULTI/EXEC)

```javascript
// Using multi (auto-creates pipeline)
redis
  .multi()
  .set("foo", "bar")
  .get("foo")
  .exec((err, results) => {
    // results === [[null, 'OK'], [null, 'bar']]
  });
```

### 4.3 Cluster Mode

```javascript
const Redis = require("ioredis");

const cluster = new Redis.Cluster(
  [
    { host: "127.0.0.1", port: 6380 },
    { host: "127.0.0.1", port: 6381 },
    { host: "127.0.0.1", port: 6382 },
  ],
  {
    redisOptions: {
      password: "cluster-password",
    },
    scaleReads: "slave", // Read from slaves for better throughput
  },
);

// Use cluster just like a single Redis instance
await cluster.set("key", "value");
const val = await cluster.get("key");
```

**Cluster features:**

- Auto-discovery of nodes
- Slot-based key distribution
- Read from slaves (`scaleReads: 'slave'`)
- NAT mapping support
- Automatic failover

### 4.4 Sentinel Mode

```javascript
const Redis = require("ioredis");

const sentinel = new Redis({
  sentinels: [
    { host: "sentinel1.example.com", port: 26379 },
    { host: "sentinel2.example.com", port: 26379 },
    { host: "sentinel3.example.com", port: 26379 },
  ],
  name: "mymaster", // Master group name
});

// After failover, ioredis automatically connects to the new master
// Commands sent during failover are queued and resent
```

### 4.5 Lua Scripting (defineCommand)

Define custom commands without managing script caching manually:

```javascript
redis.defineCommand("checkAndUpdate", {
  numberOfKeys: 2,
  lua: `
    local current = redis.call("GET", KEYS[1])
    if current == ARGV[1] then
      redis.call("SET", KEYS[1], ARGV[2])
      redis.call("SET", KEYS[2], ARGV[3])
      return 1
    end
    return 0
  `,
});

// Use it like any other Redis command
await redis.checkAndUpdate(
  "key1",
  "key2",
  "expectedValue",
  "newValue",
  "logValue",
);

// Dynamic key count
redis.defineCommand("echoDynamic", {
  lua: "return {KEYS[1],KEYS[2],ARGV[1],ARGV[2]}",
});
// Pass key count as first arg
await redis.echoDynamic(2, "k1", "k2", "a1", "a2");
```

---

## Part 5: Performance & Best Practices

### 5.1 Key Naming Conventions

```
user:123                    — Single user
user:123:profile            — User's profile
user:123:posts              — User's posts
ratelimit:api:user:123      — Rate limit counter
session:abc123              — Session data
lock:resource:789           — Distributed lock
cache:user:list:v2          — Versioned cache
```

### 5.2 TTL Strategy Recommendations

| Data Type           | TTL           | Rationale                         |
| ------------------- | ------------- | --------------------------------- |
| User profile        | 1–6 hours     | Low churn, acceptable staleness   |
| Session data        | 24 hours      | Standard session lifetime         |
| Post list           | 5–15 minutes  | Frequent updates, needs freshness |
| Configuration       | 1–24 hours    | Rarely changes                    |
| Rate limit counters | 1–60 seconds  | Auto-cleanup by TTL               |
| Distributed locks   | 10–30 seconds | Short-lived for safety            |

### 5.3 Error Handling

```javascript
const redis = new Redis({
  maxRetriesPerRequest: 3, // Fail after 3 retries
  retryStrategy(times) {
    if (times > 10) return null; // Stop retrying after 10 attempts
    return Math.min(times * 100, 2000);
  },
  enableOfflineQueue: true, // Queue commands when disconnected
  reconnectOnError(err) {
    if (err.message.includes("READONLY")) return true; // Reconnect on failover
    return false;
  },
});
```

### 5.4 Command Argument Transformation

```javascript
const Redis = require("ioredis");

// Use objects with hmset/mset
redis.hmset("hash:1", { field1: "value1", field2: "value2" });

// hgetall returns objects by default
const obj = await redis.hgetall("hash:1");
// { field1: 'value1', field2: 'value2' }
```

---

## Part 6: Monitoring & Debugging

### 6.1 Monitor Mode

```javascript
const monitor = await redis.monitor();
monitor.on("monitor", (time, args, source, database) => {
  console.log(`${time}: ${args.join(" ")}`);
});
```

### 6.2 Scan for Cache Audit

```javascript
// Stream-based scanning (non-blocking)
const stream = redis.scanStream({ match: "user:*", count: 100 });
stream.on("data", (resultKeys) => {
  console.log("Found keys:", resultKeys);
});
stream.on("end", () => {
  console.log("Scan complete");
});

// Hash scan
const hashStream = redis.hscanStream("myhash", { match: "age:??" });
hashStream.on("data", (data) => console.log(data));
```
