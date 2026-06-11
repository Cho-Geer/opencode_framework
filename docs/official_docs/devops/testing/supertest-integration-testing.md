# Supertest HTTP Integration Testing

**Source**: Context7 (/forwardemail/supertest)
**Library**: /forwardemail/supertest
**Fetched**: 2026-06-11

## Overview

Supertest is a SuperAgent-driven library for testing HTTP servers that provides high-level abstractions for HTTP assertions and request handling.

- Benchmark Score: 94.17
- Source Reputation: High

## Basic Usage

### Testing Express Apps

```javascript
const request = require('supertest');
const express = require('express');

const app = express();

app.get('/users', (req, res) => {
  res.status(200).json([
    { id: 1, name: 'John' },
    { id: 2, name: 'Jane' }
  ]);
});

request(app)
  .get('/users')
  .expect('Content-Type', /json/)
  .expect(200)
  .end((err, res) => {
    if (err) throw err;
    console.log(res.body);
  });
```

### Using async/await (Recommended)

```javascript
describe('GET /users', () => {
  it('returns user list', async () => {
    const res = await request(app).get('/users');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });
});
```

## HTTP Methods

```javascript
// POST with JSON body
request(app)
  .post('/users')
  .send({ name: 'John', email: 'john@example.com' })
  .set('Accept', 'application/json')
  .expect('Content-Type', /json/)
  .expect(201);

// PUT
request(app)
  .put('/users/1')
  .send({ name: 'John Updated' })
  .expect(200, { id: '1', name: 'John Updated' });

// DELETE
request(app)
  .delete('/users/1')
  .expect(204);
```

## Response Assertions

### Combined Status + Body Assertion

```javascript
request(app)
  .get('/user')
  .expect(200, { name: 'john', email: 'john@example.com' });
```

### Status + Text Body

```javascript
request(app)
  .get('/message')
  .expect(200, 'Hello World');
```

## Persistent Sessions with request.agent()

```javascript
const agent = request.agent(app);

// Login - cookie will be saved
await agent
  .post('/login')
  .expect(200);

// Cookie is automatically sent with subsequent requests
const res = await agent
  .get('/profile')
  .expect(200);

// Set default headers
const authenticatedAgent = request.agent(app)
  .set('Authorization', 'Bearer token123');
```

## Using with NestJS

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from './../src/app.module';

describe('AppController (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });
});
```

## All HTTP Methods

| Method | Usage |
|--------|-------|
| `.get(path)` | GET request |
| `.post(path)` | POST request with body |
| `.put(path)` | PUT request with body |
| `.delete(path)` or `.del(path)` | DELETE request |
| `.patch(path)` | PATCH request with body |
| `.head(path)` | HEAD request |
