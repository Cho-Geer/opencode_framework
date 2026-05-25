---
trigger: manual
alwaysApply: false
---
# Operations and Deployment Design Document

## 1. Overview

### 1.1 Document Purpose
This document describes the operations architecture, deployment processes, monitoring solutions, fault recovery mechanisms, and routine maintenance operations for the Booking system (Angular + NestJS refactored version), providing comprehensive operations guidance for system administrators and the operations team. This design follows RED/GREEN TDD principles to ensure deployment process reliability and repeatability.

### 1.2 System Scope
- **Backend Service**: booking-backend (NestJS v11+ API service)
- **Frontend Service**: booking-frontend (Angular v21+ frontend application)
- **Data Storage**: PostgreSQL 16 database, Redis 7.x cache
- **Message Queue**: BullMQ asynchronous task processing
- **Deployment Environments**: Development environment (dev), Testing environment (test), Production environment (prod)
- **Operations Tools**: Docker Compose, GitHub Actions, Shell scripts, Prisma ORM
- **Monitoring Tools**: Health check endpoints, structured logging, performance metrics collection

### 1.3 Document Alignment Statement
This document maintains full consistency with the following architecture design documents. All operations decisions are based on the technical decisions made in these documents:
1. [Technology Stack Recommendations](技术栈推荐方案.md) - Operations tool selection aligned with technology stack
2. [System Architecture Design Document (SAD)](系统架构设计文档（SAD）.md) - Operations architecture aligned with system architecture
3. [Data Architecture Design Document](数据架构设计文档.md) - Database operations strategy aligned with data model
4. [API Design Specification Document](接口设计规范文档.md) - API operations aligned with API specification
5. [Security Architecture Design Document](安全架构设计文档.md) - Security operations aligned with security architecture
6. [Test Strategy and Plan](测试策略与计划.md) - Deployment verification integrated with TDD testing workflow

## 2. Operations Architecture Design

### 2.1 Infrastructure Architecture (Angular + NestJS Refactored Version)
```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Docker Compose Orchestration                      │
├──────────────┬──────────────┬──────────────┬─────────────┬─────────────┤
│ PostgreSQL   │   Redis      │  BullMQ      │  Backend    │  Frontend   │
│  (Port:5432) │  (Port:6379) │  (Port:6379) │ (Port:3001) │ (Port:4200) │
└──────────────┴──────────────┴──────────────┴─────────────┴─────────────┘
       │              │              │              │              │
       └──────────────┴──────────────┴──────────────┴─────────────┘
                              Migration Service
```

### 2.2 Environment Separation Strategy
- **Development Environment**: Used for local development and testing, ports directly exposed, uses mutable tags
- **Testing Environment**: Used for automated testing and pre-release verification, uses commit tags
- **Production Environment**: Used for formal deployment, uses immutable tags (commit tags or semantic versions)

### 2.3 Health Check Mechanism (NestJS + Angular Refactored Version)
All services are configured with health checks in accordance with [System Architecture Design Document Section 3.2](系统架构设计文档（SAD）.md#32-非功能需求):

1. **PostgreSQL**: `pg_isready` command checks database availability
2. **Redis**: `redis-cli ping` command checks Redis connection
3. **BullMQ**: Queue health check endpoint
4. **Backend (NestJS)**: `/api/health` endpoint checks application, database, Redis, and BullMQ status
5. **Frontend (Angular)**: Static resource health check, verifying Angular application accessibility
6. **Migration**: One-shot service, exits automatically upon completion

## 3. Deployment Process Design

### 3.1 Image Tag Strategy (Immutable-First Principle)

The system adopts a multi-tag strategy to ensure deployment repeatability and reliability, in accordance with the deployment requirements in [Technology Stack Recommendations Section 1.2](技术栈推荐方案.md#12-非功能需求):

| Tag Type | Format Example | Mutability | Recommended Use | Reliability Assessment | Technology Stack Basis |
|---------|---------|--------|----------|------------|----------|
| **Branch Tag** | `develop`, `main` | **Mutable** - Updated on each push | Rapid development, integration testing | Low - Not suitable for production | Development environment convenience |
| **Commit Tag** | `develop-abc123`, `main-def456` | **Immutable** - Bound to specific commit | Reliable deployment, rollback, auditing | High - Recommended for production | [Technology Stack Recommendations Section 3.4](技术栈推荐方案.md#34-开发工具与质量) |
| **Semantic Version** | `v1.0.0`, `v1.2.3` | **Immutable** - Versioned release | Formal release, version management | Highest - Production best practice | Versioned management |
| **PR Tag** | `pr-123` | **Mutable** - PR build | PR verification, code review | Low - Temporary use | CI/CD integration |
| **latest** | `latest` | **Mutable** - Latest build from main branch | Development convenience | Low - Prohibited for production | Rapid development |

### 3.2 Production Environment Deployment Principles
1. **Must use immutable tags**: Commit tags (`main-abc123def`) or semantic version tags (`v1.0.0`)
2. **Prohibited from using mutable tags**: `main` or `latest` tags must not be used in production
3. **Pre-deployment verification**: All images must pass complete deployment topology verification
4. **Migration-first**: Database migrations execute before application startup, in accordance with [Data Architecture Design Document Section 10.3](数据架构设计文档.md#103-迁移策略与工具)
5. **Security compliance**: All deployments must comply with the secret management requirements in [Security Architecture Design Document Section 4.1](安全架构设计文档.md#41-密钥生命周期管理)

### 3.3 CI/CD Pipeline (GitHub Actions)

The system is configured with complete CI/CD pipelines, aligned with the TDD verification workflow in [Test Strategy and Plan Section 8.1](测试策略与计划.md#81-cicd集成测试):

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
              │ Image Registry│
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
# 1. Enter deployment directory
cd booking-deploy

# 2. Prepare environment variables
cp compose/dev.compose.env.example compose/dev.compose.env
cp env/dev/backend.env.example env/dev/backend.env
cp env/dev/frontend.env.example env/dev/frontend.env

# 3. Edit environment variable files
# - Update image tags in compose/dev.compose.env
# - Update JWT secret, database connection, etc. in env/dev/backend.env, in accordance with [Security Architecture Design Document Section 3.1](安全架构设计文档.md#31-认证体系)
# - Update API endpoint configuration in env/dev/frontend.env

# 4. Execute deployment
./scripts/deploy-dev.sh
```

The deployment script executes the following steps:
1. **Check environment variable files** for existence
2. **Pull latest images** from Docker Hub
3. **Execute database migration** (independent migration service, using Prisma ORM)
4. **Start all services** (PostgreSQL, Redis, BullMQ, Backend, Frontend)
5. **Health check** to verify all service availability

#### 3.4.2 Production Environment Deployment
```bash
cd booking-deploy
./scripts/deploy-prod.sh
```

The production environment deployment process is the same as the development environment but uses different configurations:
- Different Docker Compose file (`docker-compose.prod.yml`)
- Different environment variable files (`prod.compose.env`, `env/prod/`)
- Uses immutable tags (commit tags or semantic versions)
- Stricter network configuration and resource limits
- Integrated Vault secret management, in accordance with [Security Architecture Design Document Section 4.1](安全架构设计文档.md#41-密钥生命周期管理)

## 4. Database Migration Management

### 4.1 Migration Strategy (Prisma ORM)
The system uses an independent migration service to ensure data consistency, in accordance with [Data Architecture Design Document Section 10.3](数据架构设计文档.md#103-迁移策略与工具):
1. **Migration-first**: Migration service executes before application startup
2. **Fail-stop**: Deployment stops on migration failure, preventing the application from connecting to an inconsistent database
3. **Idempotency**: `npx prisma migrate deploy` can be safely re-executed
4. **Partial index support**: Prisma 7.x supports partial unique indexes, enabling atomic preemption mechanism

### 4.2 Migration Service Configuration
```yaml
migration:
  image: ${BACKEND_MIGRATION_IMAGE}
  depends_on:
    postgres:
      condition: service_healthy
  command: ["npm", "run", "prisma:deploy"]
  restart: "no"  # One-shot service, exits upon completion
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

### 4.4 High-Concurrency Optimized Migration
For high-concurrency booking scenarios, database migrations include the following key optimizations:
1. **Partial unique indexes**: Ensure uniqueness of bookings within the same time slot
2. **Atomic preemption**: Atomic increment mechanism for the `slot_sequence` field
3. **Read-write separation configuration**: Support for primary-replica replication architecture
4. **Connection pool optimization**: PgBouncer configuration, supporting high-concurrency connections

## 5. Monitoring and Health Checks

### 5.1 Built-in Health Check Endpoints (NestJS Refactored Version)
1. **Backend Health Endpoint**: `GET /api/health`
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

2. **Database Health Check**: `pg_isready -U postgres -d booking_system`
3. **Redis Health Check**: `redis-cli ping`
4. **BullMQ Health Check**: Queue status check
5. **Vault Health Check**: Secret management service status

### 5.2 Post-Deployment Verification
The deployment script automatically verifies:
1. Backend health endpoint returns `200 OK`
2. Swagger UI accessible (`http://localhost:3001/api/docs`)
3. Angular frontend homepage accessible (`http://localhost:4200`)
4. Database migration status normal
5. Redis and BullMQ connections normal

### 5.3 Monitoring Metrics
The following metrics are recommended for monitoring, in accordance with [Test Strategy and Plan Section 11.3](测试策略与计划.md#113-性能指标):

| Metric Category | Specific Metrics | Target Values | Monitoring Tools | Technology Stack Basis |
|---------|---------|--------|----------|----------|
| **Application Metrics** | Request count, Response time (P95), Error rate | <500ms, <5% | Prometheus, Grafana | [Technology Stack Recommendations Section 1.2](技术栈推荐方案.md#12-非功能需求) |
| **Database Metrics** | Connection count, Query performance, Lock waits | Connections <80%, Queries <100ms | pg_stat_statements | [Data Architecture Design Document Section 5.3](数据架构设计文档.md#53-查询优化策略) |
| **Cache Metrics** | Hit rate, Memory usage, Connection count | Hit rate >90%, Memory <80% | Redis CLI, Monitor | Redis best practices |
| **Message Queue** | Queue length, Processing latency, Failure rate | Queue length <1000, Latency <1s | Bull Board, Metrics | BullMQ monitoring |
| **System Metrics** | CPU usage, Memory usage, Disk I/O | CPU <70%, Memory <80% | Node.js performance monitoring | System stability |
| **Security Metrics** | Authentication failures, Anomalous requests, Key rotation | Failures <10/min | Security event logs | [Security Architecture Design Document Section 6.1](安全架构设计文档.md#61-安全监控与审计) |

## 6. Fault Recovery and Rollback

### 6.1 Fault Detection
1. **Health check failure**: Container auto-restart (restart: unless-stopped)
2. **Migration failure**: Deployment script stops execution, manual investigation required
3. **Service unreachable**: Deployment script timeout (80-second timeout setting)
4. **High-concurrency bottleneck**: Redis soft rate limiting triggered, in accordance with [API Design Specification Document Section 2.3.3](接口设计规范文档.md#233-精细化限流策略)

### 6.2 Rollback Process
```bash
# 1. Find the previous commit tag (e.g.: main-abc123def)
# 2. Update the image tag in the production environment variable file
sed -i 's/main-xyz789ghi/main-abc123def/g' compose/prod.compose.env

# 3. Re-execute the deployment script
./scripts/deploy-prod.sh
```

### 6.3 Rollback Considerations
1. **Forward-compatible database**: Ensure the old application version is compatible with the current database schema
2. **Cache cleanup**: Consider whether Redis cache needs to be cleared
3. **Session handling**: User sessions may require re-authentication
4. **Message queue**: Unprocessed tasks in the BullMQ queue need to be handled
5. **Secret management**: Ensure the rolled-back application version can correctly access Vault secrets

## 7. Security Operations

### 7.1 Sensitive Information Management (Vault Integration)
1. **Environment variable management**: Sensitive information stored in environment variable files, not committed to version control
2. **Vault secret management**: Production environment uses HashiCorp Vault for secret management, in accordance with [Security Architecture Design Document Section 4.1](安全架构设计文档.md#41-密钥生命周期管理)
3. **Key rotation**: Regularly rotate JWT keys, database passwords, API keys
4. **Access control**: Restrict external access to database, Redis, and Vault

### 7.2 Network Security
1. **Network isolation**: Use dedicated networks for production environments
2. **Firewall rules**: Restrict unnecessary port exposure
3. **TLS/SSL**: Production environment must be configured with HTTPS
4. **CSP policy**: Angular application configured with Content Security Policy

### 7.3 Image Security
1. **Vulnerability scanning**: Regularly scan Docker images for security vulnerabilities
2. **Minimal base images**: Use lightweight base images such as Node.js Alpine
3. **Dependency updates**: Timely update npm dependency packages to fix known vulnerabilities
4. **Image signing**: Production environment images use Docker Content Trust signing

### 7.4 Auditing and Compliance
1. **Operation auditing**: Record all operations activities, in accordance with [Security Architecture Design Document Section 6.1](安全架构设计文档.md#61-安全监控与审计)
2. **Compliance checks**: Conduct regular security compliance checks
3. **Penetration testing**: Perform penetration testing quarterly
4. **Security training**: Operations team receives regular security training

## 8. Routine Operations

### 8.1 Service Management
```bash
# View service status
docker compose -f compose/docker-compose.dev.yml --env-file compose/dev.compose.env ps

# View logs
docker compose -f compose/docker-compose.dev.yml --env-file compose/dev.compose.env logs
docker compose -f compose/docker-compose.dev.yml --env-file compose/dev.compose.env logs backend

# Real-time log tailing
docker compose -f compose/docker-compose.dev.yml --env-file compose/dev.compose.env logs -f

# Stop services
docker compose -f compose/docker-compose.dev.yml --env-file compose/dev.compose.env down

# Clean up data
docker compose -f compose/docker-compose.dev.yml --env-file compose/dev.compose.env down -v
```

### 8.2 Database Management
```bash
# Connect to PostgreSQL
docker compose -f compose/docker-compose.dev.yml --env-file compose/dev.compose.env exec postgres psql -U postgres -d booking_system

# Backup database
docker compose -f compose/docker-compose.dev.yml --env-file compose/dev.compose.env exec postgres pg_dump -U postgres booking_system > backup_$(date +%Y%m%d_%H%M%S).sql

# Check Prisma migration status
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

# Clear Redis cache
docker compose -f compose/docker-compose.dev.yml --env-file compose/dev.compose.env exec redis redis-cli flushall

# View Redis memory usage
docker compose -f compose/docker-compose.dev.yml --env-file compose/dev.compose.env exec redis redis-cli info memory
```

### 8.4 Secret Management Operations
```bash
# Check Vault status
docker compose -f compose/docker-compose.dev.yml --env-file compose/dev.compose.env exec vault vault status

# Rotate JWT key
# 1. Generate new key in Vault
# 2. Update environment variable file
# 3. Restart backend service
```

## 9. Scalability and High Availability

### 9.1 Horizontal Scaling Strategy
1. **Backend scaling**: Horizontal scaling achieved by adding NestJS container instances, supporting stateless architecture
2. **Frontend scaling**: Angular frontend static resources can be distributed via CDN
3. **Load balancing**: Nginx or cloud load balancer recommended
4. **Database scaling**: PostgreSQL can scale through read-write separation or sharding
5. **Cache scaling**: Redis Cluster supports data sharding and high availability

### 9.2 High Availability Configuration
The current architecture includes the following high-availability features:
1. **Health checks**: Automatic detection of service status
2. **Auto-restart**: Failed containers automatically restart
3. **Dependency checks**: Services start in the correct order
4. **Data persistence**: Database and Redis data persistent storage
5. **Stateless services**: NestJS backend is stateless, supporting horizontal scaling
6. **Message queue**: BullMQ ensures asynchronous tasks are not lost

### 9.3 Future Expansion Directions
1. **Container orchestration**: Migrate to Kubernetes for advanced orchestration capabilities
2. **Blue-green deployment**: Achieve zero-downtime deployment
3. **Canary release**: Progressive release of new versions
4. **Monitoring integration**: Integrate Prometheus, Grafana, ELK, and other monitoring tools
5. **Service mesh**: Introduce Istio and other service mesh technologies
6. **Multi-cloud deployment**: Support multi-cloud environment deployment

## 10. Operations Team Responsibilities

### 10.1 Daily Responsibilities
1. **Monitor system status**: Regularly check service health status
2. **Handle alerts**: Respond to system alerts in a timely manner
3. **Backup management**: Ensure regular data backups
4. **Log analysis**: Analyze system logs to troubleshoot issues
5. **Performance optimization**: Monitor system performance and perform optimization adjustments
6. **Security operations**: Execute security policies and handle security incidents

### 10.2 Change Management
1. **Deployment approval**: Production environment deployment requires approval
2. **Change records**: Record all operations changes
3. **Rollback plan**: Develop and test rollback plans
4. **Documentation updates**: Update relevant documents after operations changes

### 10.3 Emergency Response
1. **Fault handling**: Quickly locate and resolve system faults
2. **Communication and coordination**: Collaborate with the development team to resolve issues
3. **Post-incident analysis**: Conduct Root Cause Analysis (RCA) after incidents
4. **Plan optimization**: Optimize emergency plans based on incident experience

## 11. Documentation and Training

### 11.1 Operations Documentation
1. **Deployment guide**: booking-deploy/README.md
2. **Script documentation**: Script documentation in the booking-deploy/scripts/ directory
3. **Troubleshooting**: Common issue resolution documentation
4. **Operations manual**: Routine operations manual
5. **Emergency plans**: Emergency response plans for various failure scenarios

### 11.2 Training Requirements
1. **Docker fundamentals**: Operations team must master Docker and Docker Compose basic operations
2. **Database management**: Familiarity with PostgreSQL and Prisma basic management operations
3. **Cache management**: Master Redis and BullMQ basic operations
4. **Monitoring tools**: Master basic log viewing and monitoring tool usage
5. **Security operations**: Understand basic security operations knowledge and practices
6. **CI/CD process**: Familiarity with GitHub Actions workflows and deployment processes

### 11.3 Knowledge Base Development
1. **Operations knowledge base**: Establish an operations knowledge base to accumulate operations experience
2. **Issue repository**: Record common issues and solutions
3. **Best practices**: Summarize operations best practices
4. **Tool library**: Accumulate operations scripts and tools

## 12. Appendix

### 12.1 Environment Variable Reference
| Environment Variable | Purpose | Default Value | Environment | Security Level |
|---------|------|--------|------|----------|
| `DATABASE_URL` | PostgreSQL connection string | - | All environments | High |
| `REDIS_URL` | Redis connection string | redis://localhost:6379 | All environments | Medium |
| `JWT_SECRET` | JWT signing key | - | All environments | High |
| `VAULT_ADDR` | Vault server address | http://localhost:8200 | Production environment | High |
| `NODE_ENV` | Environment identifier | development | All environments | Low |
| `PORT` | Service port | 3001 (backend), 4200 (frontend dev), 80 (frontend prod) | All environments | Low |

### 12.2 Related Documents
1. [Technology Stack Recommendations](技术栈推荐方案.md) - Operations tool selection basis
2. [System Architecture Design Document (SAD)](系统架构设计文档（SAD）.md) - Operations architecture design basis
3. [Data Architecture Design Document](数据架构设计文档.md) - Database operations strategy basis
4. [API Design Specification Document](接口设计规范文档.md) - API operations specification basis
5. [Security Architecture Design Document](安全架构设计文档.md) - Security operations strategy basis
6. [Test Strategy and Plan](测试策略与计划.md) - Deployment verification and test integration

### 12.3 Contact Information
- **Development Team**: Responsible for feature development and bug fixes
- **Operations Team**: Responsible for system deployment and operations
- **Architecture Team**: Responsible for system architecture and technical decisions
- **Security Team**: Responsible for security policies and compliance checks
- **Testing Team**: Responsible for testing and quality assurance

### 12.4 Operations Checklist
**Pre-Deployment Check**:
- [ ] Are image tags immutable (commit tags or semantic versions)?
- [ ] Are environment variable files correctly configured?
- [ ] Is the database backup completed?
- [ ] Is the deployment time within the maintenance window?
- [ ] Have relevant teams been notified?

**In-Deployment Check**:
- [ ] Did the migration service execute successfully?
- [ ] Are all services starting normally?
- [ ] Are health checks passing?
- [ ] Are key functions verified?

**Post-Deployment Check**:
- [ ] Are monitoring metrics normal?
- [ ] Are there anomalies in error logs?
- [ ] Is user feedback normal?
- [ ] Are performance metrics meeting targets?

---
*Document Version: 2.0 (Angular+NestJS Refactored Version)*
*Last Updated: 2026-04-14*
*Maintenance Team: DevOps Team*
*Technology Stack Versions: Angular v21+, NestJS v11+, PostgreSQL 16, Redis 7.x, BullMQ, Prisma 7.x*
*Security Compliance: Meets all requirements of the Security Architecture Design Document*
*Deployment Standard: Follows immutable-tag-first principle, supports zero-trust security model*
