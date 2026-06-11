# Docker Compose Setup for Test Environments

> **Source**: Context7 (/docker/compose, /docker/docs) + webfetch (docs.docker.com)
> **Fetched**: 2026-06-11
> **Domain**: devops_ci — Docker Compose

## Overview

Docker Compose provides a powerful way to define and manage multi-container test environments. By defining the full environment in a Compose file, you can create and destroy isolated testing environments in just a few commands.

## Benefits for CI/CD Testing

- **Isolation**: Each test run gets a clean, isolated environment
- **Reproducibility**: Same environment locally and in CI
- **Speed**: Parallel service startup, no shared state pollution
- **Cleanup**: `docker compose down` removes all resources

## Basic Test Service Configuration

```yaml
services:
  # Application under test
  app:
    build:
      context: .
      dockerfile: Dockerfile
    environment:
      NODE_ENV: test
      DB_HOST: db
      DB_PORT: 5432
      REDIS_HOST: redis
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_started

  # Test database
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: app_test
      POSTGRES_USER: app
      POSTGRES_PASSWORD: testpass
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app -d app_test"]
      interval: 5s
      timeout: 3s
      retries: 5
    ports:
      - "5432:5432"

  # Cache service
  redis:
    image: redis:7-alpine
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5
```

## Dedicated Test Service with Profile

The recommended pattern uses a **test profile** to keep test services separate from production:

```yaml
services:
  # ========================================
  # Production Services
  # ========================================
  app:
    build:
      context: .
      dockerfile: Dockerfile
      target: production
    ports:
      - "3000:3000"
    environment:
      NODE_ENV: production
    depends_on:
      db:
        condition: service_healthy

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: app
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready"]
      interval: 5s
      timeout: 3s
      retries: 5

  # ========================================
  # Test Service
  # ========================================
  app-test:
    build:
      context: .
      dockerfile: Dockerfile
      target: test
    environment:
      NODE_ENV: test
      DB_HOST: db-test
      DB_PORT: 5432
      DB_DATABASE: app_test
      DB_USER: app
      DB_PASSWORD: testpass
    depends_on:
      db-test:
        condition: service_healthy
    command: ["npm", "run", "test:ci"]
    profiles:
      - test           # Only started with --profile test

  db-test:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: app_test
      POSTGRES_USER: app
      POSTGRES_PASSWORD: testpass
    tmpfs: /var/lib/postgresql/data   # Ephemeral storage
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app -d app_test"]
      interval: 3s
      timeout: 3s
      retries: 10
    profiles:
      - test

volumes:
  pgdata:
```

## Running Tests in CI

```bash
# Run test suite with isolated environment
docker compose --profile test up app-test --build --abort-on-container-exit

# Capture exit code
docker compose --profile test up app-test --build --abort-on-container-exit
EXIT_CODE=$?

# Cleanup (regardless of test result)
docker compose --profile test down -v

exit $EXIT_CODE
```

## Multi-Stage Dockerfile for Testing

```dockerfile
# ---- Build Stage ----
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .

# ---- Test Stage ----
FROM build AS test
ENV NODE_ENV=test
# Test stage inherits full source + dependencies
CMD ["npm", "run", "test:ci"]

# ---- Production Stage ----
FROM node:20-alpine AS production
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/package*.json ./
RUN npm ci --only=production && npm cache clean --force
CMD ["node", "dist/main"]
```

## Docker Compose for E2E Tests

```yaml
services:
  # Frontend service
  frontend:
    build:
      context: ./booking-frontend
      target: production
    ports:
      - "4200:80"
    environment:
      API_URL: http://backend:3000
    depends_on:
      backend:
        condition: service_started

  # Backend service
  backend:
    build:
      context: ./booking-backend
      target: production
    environment:
      DATABASE_URL: postgresql://app:testpass@db:5432/app_test
    depends_on:
      db:
        condition: service_healthy

  # Database
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: app_test
      POSTGRES_USER: app
      POSTGRES_PASSWORD: testpass
    tmpfs: /var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app -d app_test"]
      interval: 3s
      timeout: 3s
      retries: 10

  # E2E test runner
  e2e-tests:
    build:
      context: ./booking-frontend
      dockerfile: Dockerfile.e2e
    environment:
      BASE_URL: http://frontend:80
      API_URL: http://backend:3000
    depends_on:
      - frontend
      - backend
    profiles:
      - e2e
    command: ["npx", "playwright", "test"]
```

## Best Practices

1. **Use `tmpfs` volumes for test databases** — data is lost on container stop, no cleanup needed
2. **Always use health checks** with `condition: service_healthy` to avoid race conditions
3. **Use `profiles`** to separate test services from production ones
4. **Use `--abort-on-container-exit`** so CI fails fast when tests fail
5. **Always run `docker compose down -v`** in CI cleanup steps to remove volumes
6. **Use multi-stage Dockerfiles** with a `test` target to keep test dependencies out of production images
7. **Separate test and production databases** — never reuse the same DB service
8. **Set `CI: 'true'` environment variable** to skip interactive prompts in test containers
9. **Use `depends_on` with health checks** rather than `sleep` for service readiness
10. **Pin specific image tags** (e.g., `postgres:16-alpine`) rather than `latest`
