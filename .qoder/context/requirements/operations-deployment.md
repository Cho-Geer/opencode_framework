---
trigger: manual
alwaysApply: false
---
# Operations and Deployment Design Document

## 1. Overview

### 1.1 Document Purpose
This document describes the operations architecture, deployment processes, monitoring solutions, fault recovery mechanisms, and daily maintenance operations for the Booking system (Angular + NestJS refactored version), providing comprehensive operations guidance for system administrators and operations teams. This design follows RED/GREEN TDD principles to ensure deployment process reliability and repeatability.

### 1.2 System Scope
- **Backend Service**: booking-backend (NestJS v11+ API service)
- **Frontend Service**: booking-frontend (Angular v21+ frontend application)
- **Data Storage**: PostgreSQL 16 database, Redis 7.x cache
- **Message Queue**: BullMQ asynchronous task processing
- **Deployment Environments**: Development (dev), Testing (test), Production (prod)
- **Operations Tools**: Docker Compose, GitHub Actions, Shell scripts, Prisma ORM
- **Monitoring Tools**: Health check endpoints, structured logging, performance metrics collection

### 1.3 Document Alignment Statement
This document maintains complete consistency with the following architecture design documents; all operations decisions are based on the technical decisions in these documents:
1. [Tech Stack Recommendation](tech-stack-recommendation.md) - Operations tool selection aligned with tech stack
2. [System Architecture Design Document (SAD)](system-architecture-design.md) - Operations architecture corresponds to system architecture
3. [Data Architecture Design Document](data-architecture.md) - Database operations strategy aligned with data model
4. [API Design Specification Document](api-design-specification.md) - API operations aligned with interface specification
5. [Security Architecture Design Document](security-architecture.md) - Security operations aligned with security architecture
6. [Test Strategy and Plan](testing-strategy.md) - Deployment verification integrated with TDD testing workflow

## 2. Operations Architecture Design

### 2.1 Infrastructure Architecture (Angular + NestJS Refactored Version)
```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Docker Compose Orchestration                        │
├──────────────┬──────────────┬──────────────┬─────────────┬─────────────┤
│ PostgreSQL   │   Redis      │  BullMQ      │  Backend    │  Frontend   │
│   (Port:5432) │   (Port:6379) │  (Port:6379) │ (Port:3001)  │ (Port:4200)  │
└──────────────┴──────────────┴──────────────┴─────────────┴─────────────┘
       │              │              │              │              │
       └──────────────┴──────────────┴──────────────┴─────────────┘
                              Migration Service
```

### 2.2 Environment Separation Strategy
- **Development Environment**: For local development and testing, ports directly exposed, uses mutable tags
- **Test Environment**: For automated testing and pre-release verification, uses commit tags
- **Production Environment**: For production deployment, uses immutable tags (commit tags or semantic versions)

### 2.3 Health Check Mechanism (NestJS + Angular Refactored Version)
All services are configured with health checks, in compliance with [System Architecture Design Document Section 3.2](system-architecture-design.md#32-non-functional-requirements):

1. **PostgreSQL**: `pg_isready` command checks database availability
2. **Redis**: `redis-cli ping` command checks Redis connection
3. **BullMQ**: Queue health check endpoint
4. **Backend (NestJS)**: `/api/health` endpoint checks application, database, Redis, and BullMQ status
5. **Frontend (Angular)**: Static resource health check, verifies Angular application accessibility
6. **Migration**: One-time service, automatically exits upon completion

## 3. Deployment Process Design

### 3.1 Image Tag Strategy (Immutable-First Principle)

The system adopts a multi-tag strategy to ensure deployment repeatability and reliability, in compliance with the deployment requirements in [Tech Stack Recommendation Section 1.2](tech-stack-recommendation.md#12-non-functional-requirements):

| Tag Type | Format Example | Mutability | Recommended Use | Reliability Assessment | Tech Stack Basis |
|---------|---------|--------|----------|------------|----------|
| **Branch Tag** | `develop`, `main` | **Mutable** - Updated on each push | Rapid development, integration testing | Low - Not suitable for production | Development environment convenience |
| **Commit Tag** | `develop-abc123`, `main-def456` | **Immutable** - Bound to specific commit | Reliable deployment, rollback, auditing | High - Recommended for production | [Tech Stack Recommendation Section 3.4](tech-stack-recommendation.md#34-development-tools-and-quality) |
| **Semantic Version** | `v1.0.0`, `v1.2.3` | **Immutable** - Versioned release | Official releases, version management | Highest - Production best practice | Version management |
| **PR Tag** | `pr-123` | **Mutable** - PR build | PR verification, code review | Low - Temporary use | CI/CD integration |
| **latest** | `latest` | **Mutable** - Latest main branch build | Development convenience | Low - Prohibited in production | Rapid development |

### 3.2 Production Environment Deployment Principles
1. **Must use immutable tags**: Commit tags (`main-abc123def`) or semantic version tags (`v1.0.0`)
2. **Mutable tags prohibited**: `main` or `latest` tags must not be used in production
3. **Pre-deployment verification**: All images must pass complete deployment topology verification
4. **Migration first**: Database migration executes before application startup, in compliance with [Data Architecture Design Document Section 10.3](data-architecture.md#103-migration-strategy-and-tools)
5. **Security compliance**: All deployments must comply with key management requirements in [Security Architecture Design Document Section 4.1](security-architecture.md#41-key-lifecycle-management)

### 3.3 CI/CD Pipeline (GitHub Actions)

The system is configured with a complete CI/CD pipeline, in compliance with the TDD verification workflow in [Test Strategy and Plan Section 8.1](testing-strategy.md#81-cicd-integration-testing):

#### 3.3.1 Image Build Pipeline
```
┌─────────────────┐    ┌─────────────────┐
│ booking-backend │    │ booking-frontend│
│   .github/      │    │   .github/      │
│  workflows/     │    │  workflows/     │
│    └─ backend-  │    │    └─ frontend- │
│       image.yml │    │       image.yml │
└─────────────────┘    └─────────────────┘
          │                       │
          └───────────┬───────────┘
                      │
              ┌───────▼───────┐
              │  Docker Hub   │
              │  Image Registry  │
              └───────────────┘
```

#### 3.3.2 Deployment Verification Pipeline
```
┌─────────────────┐
│ booking-deploy  │
│   .github/      │
│  workflows/     │
│    ├─ verify-   │
│    │   images.yml│
│    └─ verify-   │
│       deployment.yml│
└─────────────────┘
```

### 3.4 Deployment Steps

#### 3.4.1 Development Environment Deployment
```bash
# 1. Navigate to deployment directory
cd booking-deploy

# 2. Prepare environment variables
cp compose/dev.compose.env.example compose/dev.compose.env
cp env/dev/backend.env.example env/dev/backend.env
cp env/dev/frontend.env.example env/dev/frontend.env

# 3. Edit environment variable files
# - Update image tags in compose/dev.compose.env
# - Update JWT secrets, database connections, etc. in env/dev/backend.env, per [Security Architecture Design Document Section 3.1](security-architecture.md#31-authentication-system)
# - Update API endpoint configuration in env/dev/frontend.env

# 4. Execute deployment
./scripts/deploy-dev.sh
```

The deployment script executes the following steps:
1. **Check environment variable files** exist
2. **Pull latest images** from Docker Hub
3. **Execute database migration** (independent migration service, using Prisma ORM)
4. **Start all services** (PostgreSQL, Redis, BullMQ, Backend, Frontend)
5. **Health check** verifies all service availability

#### 3.4.2 Production Environment Deployment
```bash
cd booking-deploy
./scripts/deploy-prod.sh
```

Production environment deployment process is the same as development, but uses different configuration:
- Different Docker Compose file (`docker-compose.prod.yml`)
- Different environment variable files (`prod.compose.env`, `env/prod/`)
- Uses immutable tags (commit tags or semantic versions)
- Stricter network configuration and resource limits
- Integrated Vault key management, per [Security Architecture Design Document Section 4.1](security-architecture.md#41-key-lifecycle-management)

## 4. Database Migration Management

### 4.1 Migration Strategy (Prisma ORM)
The system adopts an independent migration service to ensure data consistency, per [Data Architecture Design Document Section 10.3](data-architecture.md#103-migration-strategy-and-tools):
1. **Migration first**: Migration service executes before application startup
2. **Fail-stop**: Deployment stops on migration failure, preventing application from connecting to inconsistent database
3. **Idempotency**: `npx prisma migrate deploy` can be safely re-executed
4. **Partial index support**: Prisma 7.x supports partial unique indexes for atomic slot occupation mechanism

### 4.2 Migration Service Configuration
```yaml
migration:
  image: ${BACKEND_MIGRATION_IMAGE}
  depends_on:
    postgres:
      condition: service_healthy
  command: ["npm", "run", "prisma:deploy"]
  restart: "no"  # One-time service, exits upon completion
  environment:
    - DATABASE_URL=postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}
    - NODE_ENV=production
```

### 4.3 Manual Migration Execution
```bash
# Development environment
docker compose -f compose/docker-compose.dev.yml --env-file compose/dev.compose.env run --rm migration

# Production environment
docker compose -f compose/docker-compose.prod.yml --env-file compose/prod.compose.env run --rm migration
```

### 4.4 High-Concurrency Optimization Migration
For high-concurrency appointment scenarios, database migration includes the following key optimizations:
1. **Partial unique index**: Ensures uniqueness of appointments within the same time slot
2. **Atomic slot occupation**: Atomic increment mechanism for `slot_sequence` field
3. **Read-write split configuration**: Supports primary-replica replication architecture
4. **Connection pool optimization**: PgBouncer configuration for high-concurrency connections

## 5. Monitoring and Health Checks

### 5.1 Built-in Health Check Endpoints (NestJS Refactored Version)
1. **Backend health endpoint**: `GET /api/health`
   ```json
   {
     "status": "healthy",
     "timestamp": "2026-04-14T00:00:00.000Z",
     "uptime": 3600,
     "services": {
       "database": "connected",
       "redis": "connected",
       "bullmq": "connected",
       "vault": "connected"
     },
     "version": "1.0.0",
     "environment": "production"
   }
   ```

2. **Database health check**: `pg_isready -U postgres -d booking_system`
3. **Redis health check**: `redis-cli ping`
4. **BullMQ health check**: Queue status check
5. **Vault health check**: Key management service status

### 5.2 Post-Deployment Verification
The deployment script automatically verifies:
1. Backend health endpoint returns `200 OK`
2. Swagger UI is accessible (`http://localhost:3001/api/docs`)
3. Angular frontend homepage is accessible (`http://localhost:4200`)
4. Database migration status is normal
5. Redis and BullMQ connections are normal

### 5.3 Monitoring Metrics
Recommended metrics to monitor, per [Test Strategy and Plan Section 11.3](testing-strategy.md#113-performance-metrics):

| Metric Category | Specific Metrics | Target Value | Monitoring Tool | Tech Stack Basis |
|---------|---------|--------|----------|----------|
| **Application Metrics** | Request count, response time (P95), error rate | <500ms, <5% | Prometheus, Grafana | [Tech Stack Recommendation Section 1.2](tech-stack-recommendation.md#12-non-functional-requirements) |
| **Database Metrics** | Connection count, query performance, lock waits | Connections <80%, queries <100ms | pg_stat_statements | [Data Architecture Design Document Section 5.3](data-architecture.md#53-query-optimization-strategy) |
| **Cache Metrics** | Hit rate, memory usage, connections | Hit rate >90%, memory <80% | Redis CLI, Monitor | Redis best practices |
| **Message Queue** | Queue length, processing latency, failure rate | Queue length <1000, latency <1s | Bull Board, Metrics | BullMQ monitoring |
| **System Metrics** | CPU usage, memory usage, disk I/O | CPU <70%, memory <80% | Node.js performance monitoring | System stability |
| **Security Metrics** | Auth failure count, anomalous requests, key rotation | Failures <10/min | Security event logs | [Security Architecture Design Document Section 6.1](security-architecture.md#61-security-monitoring-and-auditing) |

## 6. Fault Recovery and Rollback

### 6.1 Fault Detection
1. **Health check failure**: Container automatically restarts (restart: unless-stopped)
2. **Migration failure**: Deployment script stops execution, requires manual investigation
3. **Service unreachable**: Deployment script timeout (80-second timeout setting)
4. **High-concurrency bottleneck**: Redis soft limiting triggered, per [API Design Specification Document Section 2.3.3](api-design-specification.md#233-fine-grained-rate-limiting-strategy)

### 6.2 Rollback Process
```bash
# 1. Find the previous commit tag (e.g., main-abc123def)
# 2. Update image tags in production environment variable file
sed -i 's/main-xyz789ghi/main-abc123def/g' compose/prod.compose.env

# 3. Re-execute deployment script
./scripts/deploy-prod.sh
```

### 6.3 Rollback Considerations
1. **Database forward compatibility**: Ensure older application version is compatible with current database schema
2. **Cache clearing**: Consider whether Redis cache needs to be cleared
3. **Session handling**: User sessions may require re-authentication
4. **Message queue**: Unprocessed tasks in BullMQ queue need to be handled
5. **Key management**: Ensure rolled-back application version can correctly access Vault keys

## 7. Security Operations

### 7.1 Sensitive Information Management (Vault Integration)
1. **Environment variable management**: Sensitive information stored in environment variable files, not committed to version control
2. **Vault key management**: Production environment uses HashiCorp Vault for key management, per [Security Architecture Design Document Section 4.1](security-architecture.md#41-key-lifecycle-management)
3. **Key rotation**: Regular rotation of JWT secrets, database passwords, API keys
4. **Access control**: Restrict external access to database, Redis, and Vault

### 7.2 Network Security
1. **Network isolation**: Use dedicated network for production environment
2. **Firewall rules**: Restrict unnecessary port exposure
3. **TLS/SSL**: Production environment must configure HTTPS
4. **CSP policy**: Angular application configured with Content Security Policy

### 7.3 Image Security
1. **Vulnerability scanning**: Regularly scan Docker images for security vulnerabilities
2. **Minimized base images**: Use lightweight base images like Node.js Alpine
3. **Dependency updates**: Promptly update npm dependencies to fix known vulnerabilities
4. **Image signing**: Production environment images signed using Docker Content Trust

### 7.4 Audit and Compliance
1. **Operations audit**: Record all operations activities, per [Security Architecture Design Document Section 6.1](security-architecture.md#61-security-monitoring-and-auditing)
2. **Compliance checks**: Regular security compliance audits
3. **Penetration testing**: Quarterly penetration tests
4. **Security training**: Operations team receives regular security training

## 8. Daily Operations

### 8.1 Service Management
```bash
# View service status
docker compose -f compose/docker-compose.dev.yml --env-file compose/dev.compose.env ps

# View logs
docker compose -f compose/docker-compose.dev.yml --env-file compose/dev.compose.env logs
docker compose -f compose/docker-compose.dev.yml --env-file compose/dev.compose.env logs backend

# Real-time log tracking
docker compose -f compose/docker-compose.dev.yml --env-file compose/dev.compose.env logs -f

# Stop services
docker compose -f compose/docker-compose.dev.yml --env-file compose/dev.compose.env down

# Clean data
docker compose -f compose/docker-compose.dev.yml --env-file compose/dev.compose.env down -v
```

### 8.2 Database Management
```bash
# Connect to PostgreSQL
docker compose -f compose/docker-compose.dev.yml --env-file compose/dev.compose.env exec postgres psql -U postgres -d booking_system

# Backup database
docker compose -f compose/docker-compose.dev.yml --env-file compose/dev.compose.env exec postgres pg_dump -U postgres booking_system > backup_$(date +%Y%m%d_%H%M%S).sql

# View Prisma migration status
docker compose -f compose/docker-compose.dev.yml --env-file compose/dev.compose.env exec backend npx prisma migrate status

# Execute Prisma Seed
docker compose -f compose/docker-compose.dev.yml --env-file compose/dev.compose.env exec backend npx prisma db seed
```

### 8.3 Cache and Queue Management
```bash
# Connect to Redis
docker compose -f compose/docker-compose.dev.yml --env-file compose/dev.compose.env exec redis redis-cli

# View BullMQ queue status
docker compose -f compose/docker-compose.dev.yml --env-file compose/dev.compose.env exec backend npm run bull:monitor

# Flush Redis cache
docker compose -f compose/docker-compose.dev.yml --env-file compose/dev.compose.env exec redis redis-cli flushall

# View Redis memory usage
docker compose -f compose/docker-compose.dev.yml --env-file compose/dev.compose.env exec redis redis-cli info memory
```

### 8.4 Key Management Operations
```bash
# View Vault status
docker compose -f compose/docker-compose.dev.yml --env-file compose/dev.compose.env exec vault vault status

# Rotate JWT keys
# 1. Generate new keys in Vault
# 2. Update environment variable files
# 3. Restart backend service
```

## 9. Scalability and High Availability

### 9.1 Horizontal Scaling Strategy
1. **Backend scaling**: Horizontal scaling by adding NestJS container instances, supports stateless architecture
2. **Frontend scaling**: Angular frontend static resources can be distributed via CDN
3. **Load balancing**: Recommend using Nginx or cloud load balancer
4. **Database scaling**: PostgreSQL can scale via read-write split or sharding
5. **Cache scaling**: Redis cluster supports data sharding and high availability

### 9.2 High Availability Configuration
The current architecture has the following high availability features:
1. **Health checks**: Automatic service status detection
2. **Auto-restart**: Failed containers automatically restart
3. **Dependency checks**: Services start in correct order
4. **Data persistence**: Database and Redis data persisted to storage
5. **Stateless services**: NestJS backend is stateless, supports horizontal scaling
6. **Message queue**: BullMQ ensures async tasks are not lost

### 9.3 Future Scaling Directions
1. **Container orchestration**: Migrate to Kubernetes for more advanced orchestration capabilities
2. **Blue-green deployment**: Implement zero-downtime deployment
3. **Canary releases**: Progressive rollout of new versions
4. **Monitoring integration**: Integrate Prometheus, Grafana, ELK, and other monitoring tools
5. **Service mesh**: Introduce service mesh technologies like Istio
6. **Multi-cloud deployment**: Support multi-cloud environment deployment

## 10. Operations Team Responsibilities

### 10.1 Daily Responsibilities
1. **Monitor system status**: Regularly check service health status
2. **Handle alerts**: Respond to system alerts promptly
3. **Backup management**: Ensure data is regularly backed up
4. **Log analysis**: Analyze system logs to troubleshoot issues
5. **Performance optimization**: Monitor system performance and make optimization adjustments
6. **Security operations**: Execute security policies, handle security incidents

### 10.2 Change Management
1. **Deployment approval**: Production environment deployments require approval
2. **Change records**: Record all operations changes
3. **Rollback plans**: Develop and test rollback plans
4. **Documentation updates**: Update relevant documentation after operations changes

### 10.3 Emergency Response
1. **Fault handling**: Quickly locate and resolve system faults
2. **Communication coordination**: Collaborate with development team to resolve issues
3. **Post-incident analysis**: Conduct Root Cause Analysis (RCA) after faults
4. **Plan optimization**: Optimize emergency plans based on fault experience

## 11. Documentation and Training

### 11.1 Operations Documentation
1. **Deployment guide**: booking-deploy/README.md
2. **Script documentation**: Script descriptions in booking-deploy/scripts/ directory
3. **Troubleshooting**: Common issue resolution documentation
4. **Operations manual**: Daily operations handbook
5. **Emergency plans**: Emergency response plans for various fault scenarios

### 11.2 Training Requirements
1. **Docker fundamentals**: Operations team must master Docker and Docker Compose basic operations
2. **Database management**: Familiarity with PostgreSQL and Prisma basic management operations
3. **Cache management**: Master basic Redis and BullMQ operations
4. **Monitoring tools**: Master basic log viewing and monitoring tool usage
5. **Security operations**: Understanding of basic security operations knowledge and practices
6. **CI/CD workflows**: Familiarity with GitHub Actions workflows and deployment processes

### 11.3 Knowledge Base Building
1. **Operations knowledge base**: Build operations knowledge base, accumulate operations experience
2. **Issue database**: Record common issues and solutions
3. **Best practices**: Summarize operations best practices
4. **Tool library**: Accumulate operations scripts and tools

## 12. Appendix

### 12.1 Environment Variable Reference
| Environment Variable | Purpose | Default Value | Environment | Security Level |
|---------|------|--------|------|----------|
| `DATABASE_URL` | PostgreSQL connection string | - | All environments | High |
| `REDIS_URL` | Redis connection string | redis://localhost:6379 | All environments | Medium |
| `JWT_SECRET` | JWT signing key | - | All environments | High |
| `VAULT_ADDR` | Vault server address | http://localhost:8200 | Production | High |
| `NODE_ENV` | Environment identifier | development | All environments | Low |
| `PORT` | Service port | 3001 (backend), 4200 (frontend dev), 80 (frontend prod) | All environments | Low |

### 12.2 Related Documents
1. [Tech Stack Recommendation](tech-stack-recommendation.md) - Operations tool selection basis
2. [System Architecture Design Document (SAD)](system-architecture-design.md) - Operations architecture design basis
3. [Data Architecture Design Document](data-architecture.md) - Database operations strategy basis
4. [API Design Specification Document](api-design-specification.md) - API operations specification basis
5. [Security Architecture Design Document](security-architecture.md) - Security operations strategy basis
6. [Test Strategy and Plan](testing-strategy.md) - Deployment verification and test integration

### 12.3 Contact Information
- **Development team**: Responsible for feature development and bug fixes
- **Operations team**: Responsible for system deployment and operations
- **Architecture team**: Responsible for system architecture and technical decisions
- **Security team**: Responsible for security policies and compliance checks
- **Testing team**: Responsible for testing and quality assurance

### 12.4 Operations Checklist
**Pre-Deployment Checks**:
- [ ] Is image tag an immutable tag (commit tag or semantic version)?
- [ ] Are environment variable files correctly configured?
- [ ] Is database backup complete?
- [ ] Is deployment time within maintenance window?
- [ ] Have relevant teams been notified?

**During Deployment Checks**:
- [ ] Did migration service execute successfully?
- [ ] Did all services start normally?
- [ ] Did health checks pass?
- [ ] Were critical functions verified?

**Post-Deployment Checks**:
- [ ] Are monitoring metrics normal?
- [ ] Are there anomalies in error logs?
- [ ] Is user feedback normal?
- [ ] Do performance metrics meet targets?

---
*Document version: 2.0 (Angular+NestJS refactored version)*
*Last updated: 2026-04-14*
*Maintenance team: DevOps team*
*Tech stack versions: Angular v21+, NestJS v11+, PostgreSQL 16, Redis 7.x, BullMQ, Prisma 7.x*
*Security compliance: Meets all Security Architecture Design Document requirements*
*Deployment standard: Follows immutable-tag-first principle, supports zero-trust security model*
