---
trigger: manual
alwaysApply: false
---
# 运维与部署设计文档

## 1. 概述

### 1.1 文档目的
本文档描述Booking系统（Angular + NestJS重构版）的运维架构、部署流程、监控方案、故障恢复机制和日常维护操作，为系统管理员和运维团队提供全面的运维指导。本设计遵循RED/GREEN TDD原则，确保部署过程的可靠性和可重复性。

### 1.2 系统范围
- **后端服务**: booking-backend (NestJS v11+ API服务)
- **前端服务**: booking-frontend (Angular v21+ 前端应用)
- **数据存储**: PostgreSQL 16数据库、Redis 7.x缓存
- **消息队列**: BullMQ 异步任务处理
- **部署环境**: 开发环境(dev)、测试环境(test)、生产环境(prod)
- **运维工具**: Docker Compose、GitHub Actions、Shell脚本、Prisma ORM
- **监控工具**: 健康检查端点、结构化日志、性能指标收集

### 1.3 文档对齐性声明
本文档与以下架构设计文档保持完全一致性，所有运维决策均基于这些文档的技术决策：
1. [技术栈推荐方案](技术栈推荐方案.md) - 运维工具选型与技术栈一致
2. [系统架构设计文档（SAD）](系统架构设计文档（SAD）.md) - 运维架构与系统架构对应
3. [数据架构设计文档](数据架构设计文档.md) - 数据库运维策略与数据模型一致
4. [接口设计规范文档](接口设计规范文档.md) - API运维与接口规范一致
5. [安全架构设计文档](安全架构设计文档.md) - 安全运维与安全架构一致
6. [测试策略与计划](测试策略与计划.md) - 部署验证与TDD测试流程集成

## 2. 运维架构设计

### 2.1 基础设施架构 (Angular + NestJS重构版)
```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Docker Compose 编排                                 │
├──────────────┬──────────────┬──────────────┬─────────────┬─────────────┤
│ PostgreSQL   │   Redis      │  BullMQ      │  Backend    │  Frontend   │
│   (端口:5432) │   (端口:6379) │  (端口:6379) │ (端口:3001)  │ (端口:4200)  │
└──────────────┴──────────────┴──────────────┴─────────────┴─────────────┘
       │              │              │              │              │
       └──────────────┴──────────────┴──────────────┴─────────────┘
                              Migration Service
```

### 2.2 环境分离策略
- **开发环境**: 用于本地开发和测试，端口直接暴露，使用可变标签
- **测试环境**: 用于自动化测试和预发布验证，使用提交标签
- **生产环境**: 用于正式部署，使用不可变标签（提交标签或语义版本）

### 2.3 健康检查机制 (NestJS + Angular重构版)
所有服务都配置了健康检查，符合[系统架构设计文档3.2节](系统架构设计文档（SAD）.md#32-非功能需求)：

1. **PostgreSQL**: `pg_isready`命令检查数据库可用性
2. **Redis**: `redis-cli ping`命令检查Redis连接
3. **BullMQ**: 队列健康检查端点
4. **Backend (NestJS)**: `/api/health`端点检查应用、数据库、Redis和BullMQ状态
5. **Frontend (Angular)**: 静态资源健康检查，验证Angular应用可访问性
6. **Migration**: 一次性服务，完成后自动退出

## 3. 部署流程设计

### 3.1 镜像标签策略 (不可变优先原则)

系统采用多标签策略，确保部署的可重复性和可靠性，符合[技术栈推荐方案1.2节](技术栈推荐方案.md#12-非功能需求)中的部署要求：

| 标签类型 | 格式示例 | 可变性 | 推荐用途 | 可靠性评估 | 技术栈依据 |
|---------|---------|--------|----------|------------|----------|
| **分支标签** | `develop`, `main` | **可变** - 每次推送更新 | 快速开发、集成测试 | 低 - 不适用于生产 | 开发环境便利性 |
| **提交标签** | `develop-abc123`, `main-def456` | **不可变** - 绑定特定提交 | 可靠部署、回滚、审计 | 高 - 推荐用于生产 | [技术栈推荐方案3.4节](技术栈推荐方案.md#34-开发工具与质量) |
| **语义版本** | `v1.0.0`, `v1.2.3` | **不可变** - 版本化发布 | 正式发布、版本管理 | 最高 - 生产最佳实践 | 版本化管理 |
| **PR标签** | `pr-123` | **可变** - PR构建 | PR验证、代码审查 | 低 - 临时使用 | CI/CD集成 |
| **latest** | `latest` | **可变** - main分支最新构建 | 开发便利 | 低 - 禁止用于生产 | 快速开发 |

### 3.2 生产环境部署原则
1. **必须使用不可变标签**: 提交标签(`main-abc123def`)或语义版本标签(`v1.0.0`)
2. **禁止使用可变标签**: `main`或`latest`标签不得用于生产
3. **部署前验证**: 所有镜像必须通过完整的部署拓扑验证
4. **迁移先行**: 数据库迁移在应用启动前执行，符合[数据架构设计文档10.3节](数据架构设计文档.md#103-迁移策略与工具)
5. **安全合规**: 所有部署必须符合[安全架构设计文档4.1节](安全架构设计文档.md#41-密钥生命周期管理)的密钥管理要求

### 3.3 CI/CD流水线 (GitHub Actions)

系统配置了完整的CI/CD流水线，符合[测试策略与计划8.1节](测试策略与计划.md#81-cicd集成测试)的TDD验证流程：

#### 3.3.1 镜像构建流水线
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
              │  镜像仓库       │
              └───────────────┘
```

#### 3.3.2 部署验证流水线
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

### 3.4 部署步骤

#### 3.4.1 开发环境部署
```bash
# 1. 进入部署目录
cd booking-deploy

# 2. 准备环境变量
cp compose/dev.compose.env.example compose/dev.compose.env
cp env/dev/backend.env.example env/dev/backend.env
cp env/dev/frontend.env.example env/dev/frontend.env

# 3. 编辑环境变量文件
# - 更新compose/dev.compose.env中的镜像标签
# - 更新env/dev/backend.env中的JWT密钥、数据库连接等，符合[安全架构设计文档3.1节](安全架构设计文档.md#31-认证体系)
# - 更新env/dev/frontend.env中的API端点配置

# 4. 执行部署
./scripts/deploy-dev.sh
```

部署脚本执行以下步骤：
1. **检查环境变量文件**是否存在
2. **拉取最新镜像**从Docker Hub
3. **执行数据库迁移** (独立的migration服务，使用Prisma ORM)
4. **启动所有服务** (PostgreSQL, Redis, BullMQ, Backend, Frontend)
5. **健康检查**验证所有服务可用性

#### 3.4.2 生产环境部署
```bash
cd booking-deploy
./scripts/deploy-prod.sh
```

生产环境部署流程与开发环境相同，但使用不同的配置：
- 不同的Docker Compose文件 (`docker-compose.prod.yml`)
- 不同的环境变量文件 (`prod.compose.env`, `env/prod/`)
- 使用不可变标签（提交标签或语义版本）
- 更严格的网络配置和资源限制
- 集成Vault密钥管理，符合[安全架构设计文档4.1节](安全架构设计文档.md#41-密钥生命周期管理)

## 4. 数据库迁移管理

### 4.1 迁移策略 (Prisma ORM)
系统采用独立的迁移服务确保数据一致性，符合[数据架构设计文档10.3节](数据架构设计文档.md#103-迁移策略与工具)：
1. **迁移先行**: 迁移服务在应用启动前执行
2. **失败停止**: 迁移失败时部署停止，防止应用连接到不一致的数据库
3. **幂等性**: `npx prisma migrate deploy`可安全重复执行
4. **部分索引支持**: Prisma 7.x支持部分唯一索引，实现原子化抢占机制

### 4.2 迁移服务配置
```yaml
migration:
  image: ${BACKEND_MIGRATION_IMAGE}
  depends_on:
    postgres:
      condition: service_healthy
  command: ["npm", "run", "prisma:deploy"]
  restart: "no"  # 一次性服务，完成后退出
  environment:
    - DATABASE_URL=postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}
    - NODE_ENV=production
```

### 4.3 手动迁移执行
```bash
# 开发环境
docker compose -f compose/docker-compose.dev.yml --env-file compose/dev.compose.env run --rm migration

# 生产环境
docker compose -f compose/docker-compose.prod.yml --env-file compose/prod.compose.env run --rm migration
```

### 4.4 高并发优化迁移
对于高并发预约场景，数据库迁移包含以下关键优化：
1. **部分唯一索引**: 确保同一时间槽内预约的唯一性
2. **原子化抢占**: `slot_sequence`字段的原子递增机制
3. **读写分离配置**: 支持主从复制架构
4. **连接池优化**: PgBouncer配置，支持高并发连接

## 5. 监控与健康检查

### 5.1 内置健康检查端点 (NestJS重构版)
1. **后端健康端点**: `GET /api/health`
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

2. **数据库健康检查**: `pg_isready -U postgres -d booking_system`
3. **Redis健康检查**: `redis-cli ping`
4. **BullMQ健康检查**: 队列状态检查
5. **Vault健康检查**: 密钥管理服务状态

### 5.2 部署后验证
部署脚本自动验证：
1. 后端健康端点返回`200 OK`
2. Swagger UI可访问 (`http://localhost:3001/api/docs`)
3. Angular前端首页可访问 (`http://localhost:4200`)
4. 数据库迁移状态正常
5. Redis和BullMQ连接正常

### 5.3 监控指标
建议监控以下指标，符合[测试策略与计划11.3节](测试策略与计划.md#113-性能指标)：

| 指标类别 | 具体指标 | 目标值 | 监控工具 | 技术栈依据 |
|---------|---------|--------|----------|----------|
| **应用指标** | 请求数、响应时间(P95)、错误率 | <500ms, <5% | Prometheus, Grafana | [技术栈推荐方案1.2节](技术栈推荐方案.md#12-非功能需求) |
| **数据库指标** | 连接数、查询性能、锁等待 | 连接数<80%, 查询<100ms | pg_stat_statements | [数据架构设计文档5.3节](数据架构设计文档.md#53-查询优化策略) |
| **缓存指标** | 命中率、内存使用、连接数 | 命中率>90%, 内存<80% | Redis CLI, Monitor | Redis最佳实践 |
| **消息队列** | 队列长度、处理延迟、失败率 | 队列长度<1000, 延迟<1s | Bull Board, Metrics | BullMQ监控 |
| **系统指标** | CPU使用率、内存使用、磁盘I/O | CPU<70%, 内存<80% | Node.js性能监控 | 系统稳定性 |
| **安全指标** | 认证失败次数、异常请求、密钥轮换 | 失败次数<10/分钟 | 安全事件日志 | [安全架构设计文档6.1节](安全架构设计文档.md#61-安全监控与审计) |

## 6. 故障恢复与回滚

### 6.1 故障检测
1. **健康检查失败**: 容器自动重启 (restart: unless-stopped)
2. **迁移失败**: 部署脚本停止执行，需要手动排查
3. **服务不可达**: 部署脚本超时 (80秒超时设置)
4. **高并发瓶颈**: Redis软限流触发，符合[接口设计规范文档2.3.3节](接口设计规范文档.md#233-精细化限流策略)

### 6.2 回滚流程
```bash
# 1. 找到之前的提交标签 (例如: main-abc123def)
# 2. 更新生产环境变量文件中的镜像标签
sed -i 's/main-xyz789ghi/main-abc123def/g' compose/prod.compose.env

# 3. 重新执行部署脚本
./scripts/deploy-prod.sh
```

### 6.3 回滚注意事项
1. **数据库向前兼容**: 确保旧版本应用能与当前数据库模式兼容
2. **缓存清理**: 考虑是否需要清理Redis缓存
3. **会话处理**: 用户会话可能需要重新认证
4. **消息队列**: BullMQ队列中的未处理任务需要处理
5. **密钥管理**: 确保回滚后的应用版本能正确访问Vault密钥

## 7. 安全运维

### 7.1 敏感信息管理 (Vault集成)
1. **环境变量管理**: 敏感信息存储在环境变量文件中，不提交到版本控制
2. **Vault密钥管理**: 生产环境使用HashiCorp Vault管理密钥，符合[安全架构设计文档4.1节](安全架构设计文档.md#41-密钥生命周期管理)
3. **密钥轮换**: 定期轮换JWT密钥、数据库密码、API密钥
4. **访问控制**: 限制对数据库、Redis、Vault的外部访问

### 7.2 网络安全
1. **网络隔离**: 为生产环境使用专用网络
2. **防火墙规则**: 限制不必要的端口暴露
3. **TLS/SSL**: 生产环境必须配置HTTPS
4. **CSP策略**: Angular应用配置Content Security Policy

### 7.3 镜像安全
1. **漏洞扫描**: 定期扫描Docker镜像中的安全漏洞
2. **最小化基础镜像**: 使用Node.js Alpine等轻量级基础镜像
3. **依赖更新**: 及时更新npm依赖包修复已知漏洞
4. **镜像签名**: 生产环境镜像使用Docker Content Trust签名

### 7.4 审计与合规
1. **操作审计**: 记录所有运维操作，符合[安全架构设计文档6.1节](安全架构设计文档.md#61-安全监控与审计)
2. **合规检查**: 定期进行安全合规检查
3. **渗透测试**: 每季度执行渗透测试
4. **安全培训**: 运维团队定期接受安全培训

## 8. 日常运维操作

### 8.1 服务管理
```bash
# 查看服务状态
docker compose -f compose/docker-compose.dev.yml --env-file compose/dev.compose.env ps

# 查看日志
docker compose -f compose/docker-compose.dev.yml --env-file compose/dev.compose.env logs
docker compose -f compose/docker-compose.dev.yml --env-file compose/dev.compose.env logs backend

# 实时日志跟踪
docker compose -f compose/docker-compose.dev.yml --env-file compose/dev.compose.env logs -f

# 停止服务
docker compose -f compose/docker-compose.dev.yml --env-file compose/dev.compose.env down

# 清理数据
docker compose -f compose/docker-compose.dev.yml --env-file compose/dev.compose.env down -v
```

### 8.2 数据库管理
```bash
# 连接到PostgreSQL
docker compose -f compose/docker-compose.dev.yml --env-file compose/dev.compose.env exec postgres psql -U postgres -d booking_system

# 备份数据库
docker compose -f compose/docker-compose.dev.yml --env-file compose/dev.compose.env exec postgres pg_dump -U postgres booking_system > backup_$(date +%Y%m%d_%H%M%S).sql

# 查看Prisma迁移状态
docker compose -f compose/docker-compose.dev.yml --env-file compose/dev.compose.env exec backend npx prisma migrate status

# 执行Prisma Seed
docker compose -f compose/docker-compose.dev.yml --env-file compose/dev.compose.env exec backend npx prisma db seed
```

### 8.3 缓存与队列管理
```bash
# 连接到Redis
docker compose -f compose/docker-compose.dev.yml --env-file compose/dev.compose.env exec redis redis-cli

# 查看BullMQ队列状态
docker compose -f compose/docker-compose.dev.yml --env-file compose/dev.compose.env exec backend npm run bull:monitor

# 清空Redis缓存
docker compose -f compose/docker-compose.dev.yml --env-file compose/dev.compose.env exec redis redis-cli flushall

# 查看Redis内存使用
docker compose -f compose/docker-compose.dev.yml --env-file compose/dev.compose.env exec redis redis-cli info memory
```

### 8.4 密钥管理操作
```bash
# 查看Vault状态
docker compose -f compose/docker-compose.dev.yml --env-file compose/dev.compose.env exec vault vault status

# 轮换JWT密钥
# 1. 在Vault中生成新密钥
# 2. 更新环境变量文件
# 3. 重启后端服务
```

## 9. 扩展性与高可用性

### 9.1 水平扩展策略
1. **后端扩展**: 可通过增加NestJS容器实例实现水平扩展，支持无状态架构
2. **前端扩展**: Angular前端静态资源可通过CDN分发
3. **负载均衡**: 建议使用Nginx或云负载均衡器
4. **数据库扩展**: PostgreSQL可通过读写分离或分片扩展
5. **缓存扩展**: Redis集群支持数据分片和高可用

### 9.2 高可用配置
当前架构具备以下高可用特性：
1. **健康检查**: 自动检测服务状态
2. **自动重启**: 失败容器自动重启
3. **依赖检查**: 服务按正确顺序启动
4. **数据持久化**: 数据库和Redis数据持久化存储
5. **无状态服务**: NestJS后端无状态，支持水平扩展
6. **消息队列**: BullMQ确保异步任务不丢失

### 9.3 未来扩展方向
1. **容器编排**: 迁移到Kubernetes实现更高级的编排能力
2. **蓝绿部署**: 实现零停机部署
3. **金丝雀发布**: 渐进式发布新版本
4. **监控集成**: 集成Prometheus、Grafana、ELK等监控工具
5. **服务网格**: 引入Istio等服务网格技术
6. **多云部署**: 支持多云环境部署

## 10. 运维团队职责

### 10.1 日常职责
1. **监控系统状态**: 定期检查服务健康状态
2. **处理告警**: 及时响应系统告警
3. **备份管理**: 确保数据定期备份
4. **日志分析**: 分析系统日志排查问题
5. **性能优化**: 监控系统性能，进行优化调整
6. **安全运维**: 执行安全策略，处理安全事件

### 10.2 变更管理
1. **部署审批**: 生产环境部署需要审批
2. **变更记录**: 记录所有运维变更
3. **回滚预案**: 制定并测试回滚预案
4. **文档更新**: 运维变更后更新相关文档

### 10.3 应急响应
1. **故障处理**: 快速定位和解决系统故障
2. **沟通协调**: 与开发团队协作解决问题
3. **事后分析**: 故障后进行根本原因分析(RCA)
4. **预案优化**: 根据故障经验优化应急预案

## 11. 文档与培训

### 11.1 运维文档
1. **部署指南**: booking-deploy/README.md
2. **脚本说明**: booking-deploy/scripts/目录下的脚本说明
3. **故障排查**: 常见问题解决方案文档
4. **操作手册**: 日常运维操作手册
5. **应急预案**: 各种故障场景的应急预案

### 11.2 培训要求
1. **Docker基础**: 运维团队需掌握Docker和Docker Compose基本操作
2. **数据库管理**: 熟悉PostgreSQL和Prisma基本管理操作
3. **缓存管理**: 掌握Redis和BullMQ的基本操作
4. **监控工具**: 掌握基本的日志查看和监控工具使用
5. **安全运维**: 了解基本的安全运维知识和实践
6. **CI/CD流程**: 熟悉GitHub Actions工作流和部署流程

### 11.3 知识库建设
1. **运维知识库**: 建立运维知识库，积累运维经验
2. **问题库**: 记录常见问题和解决方案
3. **最佳实践**: 总结运维最佳实践
4. **工具库**: 积累运维脚本和工具

## 12. 附录

### 12.1 环境变量说明
| 环境变量 | 用途 | 默认值 | 环境 | 安全级别 |
|---------|------|--------|------|----------|
| `DATABASE_URL` | PostgreSQL连接字符串 | - | 所有环境 | 高 |
| `REDIS_URL` | Redis连接字符串 | redis://localhost:6379 | 所有环境 | 中 |
| `JWT_SECRET` | JWT签名密钥 | - | 所有环境 | 高 |
| `VAULT_ADDR` | Vault服务器地址 | http://localhost:8200 | 生产环境 | 高 |
| `NODE_ENV` | 环境标识 | development | 所有环境 | 低 |
| `PORT` | 服务端口 | 3001(后端), 4200(前端开发), 80(前端生产) | 所有环境 | 低 |

### 12.2 相关文档
1. [技术栈推荐方案](技术栈推荐方案.md) - 运维工具选型依据
2. [系统架构设计文档（SAD）](系统架构设计文档（SAD）.md) - 运维架构设计依据
3. [数据架构设计文档](数据架构设计文档.md) - 数据库运维策略依据
4. [接口设计规范文档](接口设计规范文档.md) - API运维规范依据
5. [安全架构设计文档](安全架构设计文档.md) - 安全运维策略依据
6. [测试策略与计划](测试策略与计划.md) - 部署验证与测试集成

### 12.3 联系人信息
- **开发团队**: 负责功能开发和bug修复
- **运维团队**: 负责系统部署和运维
- **架构团队**: 负责系统架构和技术决策
- **安全团队**: 负责安全策略和合规检查
- **测试团队**: 负责测试和质量保证

### 12.4 运维检查清单
**部署前检查**:
- [ ] 镜像标签是否为不可变标签（提交标签或语义版本）
- [ ] 环境变量文件是否正确配置
- [ ] 数据库备份是否完成
- [ ] 部署时间是否在维护窗口内
- [ ] 相关团队是否已通知

**部署中检查**:
- [ ] 迁移服务是否成功执行
- [ ] 所有服务是否正常启动
- [ ] 健康检查是否通过
- [ ] 关键功能是否验证通过

**部署后检查**:
- [ ] 监控指标是否正常
- [ ] 错误日志是否有异常
- [ ] 用户反馈是否正常
- [ ] 性能指标是否达标

---
*文档版本: 2.0 (Angular+NestJS重构版)*
*最后更新: 2026-04-14*
*维护团队: DevOps团队*
*技术栈版本: Angular v21+, NestJS v11+, PostgreSQL 16, Redis 7.x, BullMQ, Prisma 7.x*
*安全合规: 符合安全架构设计文档所有要求*
*部署标准: 遵循不可变标签优先原则，支持零信任安全模型*
