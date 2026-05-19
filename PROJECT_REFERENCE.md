# 项目技术参考 (PROJECT_REFERENCE.md)

> **说明**: 本文件是 `AGENTS.md` 的项目特定附录，包含当前项目的技术栈、目录结构、常用命令、架构速查等信息。
>
> **关联**: 通用多智能体协作协议请参见 [AGENTS.md](./AGENTS.md)。

---

## 项目结构

```
/home/zhaoge/workspace/opencode/Playground2.backup.20260426_012219/
├── ./
│   ├── booking-backend/src/       # NestJS API (port 3000)
│   ├── booking-frontend/          # Angular SPA (port 4200)
│   ├── e2e/                       # Playwright E2E tests
│   ├── scripts/                   # Build & utility scripts
│   ├── contract.yaml              # API 契约定义
│   └── Task.DAG.json              # 任务依赖图
└── .opencode/                     # 项目规则与上下文
```

## 常用命令

### booking-backend (NestJS)

```bash
cd ./

# Development
npm run start:dev              # Hot reload dev server (port 3000)
npm run start:debug            # Debug mode with watch

# Build & Production
npm run build
npm run start:prod

# Code Quality
npm run typecheck              # Static type check
npm run lint                   # Linter with auto-fix

# Testing
npm run test                   # Unit tests (Jest)
npm run test:watch             # Watch mode
npm run test:cov               # Coverage (threshold: 80%)
npm run test:integration       # Integration tests (Testcontainers)
npm run test:e2e               # E2E tests (Playwright)
```

### booking-frontend (Angular)

```bash
cd booking-frontend/

# Development
npm run start                  # Dev server (port 4200)
npm run start:debug            # Debug mode

# Build
npm run build                  # Production build
npm run build:staging          # Staging build

# Testing
npm run test                   # Unit tests (Jest)
npm run test:watch             # Watch mode
npm run test:cov               # Coverage (threshold: 80%)
npm run test:e2e               # E2E tests

# Code Quality
npm run lint                   # Linter
npm run typecheck              # TypeScript check
```

## 技术架构速查

### 后端 (NestJS v11+ / Node.js 22.x / TypeScript 5.x)

| 模块 | 路径 | 说明 |
|------|------|------|
| Auth | `booking-backend/src/auth/` | JWT + Passport 认证, RBAC 授权 |
| Users | `booking-backend/src/users/` | 用户管理, 多角色支持 |
| Appointments | `booking-backend/src/appointments/` | 预约核心业务, 高并发冲突处理 |
| Services | `booking-backend/src/services/` | 服务/医师管理 |
| Time-Slots | `booking-backend/src/time-slots/` | 时段管理与预占 |
| Email | `booking-backend/src/email/` | 邮件通知 |
| Stats | `booking-backend/src/stats/` | 运营统计 |
| Timezone | `booking-backend/src/timezone/` | 时区处理 |
| Admin | `booking-backend/src/admin/` | 管理后台API |

### 前端 (Angular v21+ / TypeScript 5.x / Tailwind CSS v4)

| 模块 | 路径 | 说明 |
|------|------|------|
| Core | `booking-frontend/src/app/core/` | 核心服务, 拦截器, 守卫 |
| Auth | `booking-frontend/src/app/auth/` | 登录/注册/MFA |
| Admin | `booking-frontend/src/app/admin/` | 管理面板 (PrimeNG) |
| Appointments | `booking-frontend/src/app/appointments/` | 预约流程 |
| Profile | `booking-frontend/src/app/profile/` | 个人信息 |

### 数据库 (PostgreSQL 16 / Prisma 7.x ORM / Redis 7.x)

| 组件 | 技术 | 端口 | 说明 |
|------|------|:----:|------|
| Database | PostgreSQL 16 | 5432 | 主数据库, 71个索引 |
| Cache | Redis 7.x | 6379 | 缓存/队列/速率限制 |
| ORM | Prisma 7.x | — | 数据访问层, 支持事务 |

### 认证与安全

| 机制 | 配置 | 说明 |
|------|------|------|
| JWT Access | 15m 有效期 | 短期访问令牌 |
| JWT Refresh | 7d 有效期 | 长期刷新令牌 |
| Bcrypt | rounds=12 | 密码哈希 |
| Encryption | AES-256-GCM | PII 字段加密 |
| Rate Limiting | 多级 (用户+IP+全局) | DDoS 防护 |

## 环境变量

```bash
# 后端
DATABASE_URL="postgresql://user:pass@localhost:5432/booking"
REDIS_URL="redis://localhost:6379"
JWT_SECRET="<your-jwt-secret>"
JWT_REFRESH_SECRET="<your-jwt-refresh-secret>"

# 前端
API_BASE_URL="http://localhost:3000/api"
```

## 测试策略

| 层级 | 框架 | 覆盖率目标 | 说明 |
|------|------|:----------:|------|
| Unit | Jest 29+ | 70%+ | 纯逻辑 + Service 层 |
| Integration | Supertest + Testcontainers | 20% | 真实数据库集成测试 |
| E2E | Playwright | 10% | 端到端用户流程 |
| Mutation | Stryker | 80% | 变异测试质量门禁 |

## CI/CD

| 阶段 | 工具 | 说明 |
|------|------|------|
| CI | GitHub Actions | 自动测试 + lint + 构建 |
| CD | Docker Compose v2 | 不可变标签部署策略 |
| Migration | Prisma migrate deploy | 数据库迁移自动化 |
