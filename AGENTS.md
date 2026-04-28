# 三层八角色多智能体体系 - 全局协作规范

### 🚨 P0 强制规则: 所有任务必须从 `/compliance-gate` 开始
任何开发、分析、设计、审查或部署任务必须以 `/compliance-gate "<task_description>"` 命令启动。合规门未武装（gate not armed），严禁进入分析、设计、编码或审查阶段。此规则优先级高于本文件所有其他规则。

### 🚨 P0 子Agent派遣规则: 必须使用 `/dispatch` 命令
当主Agent需要委托子Agent（subagent）执行任务时，必须通过以下流程：
1. 运行 `node .opencode/scripts/dispatch-subagent.js <agent_type> "<task>"` 生成包装后的Prompt
2. 将生成的包装Prompt原样传递给 `Task()` 工具的 `prompt` 参数
3. 禁止手动编写子Agent Prompt绕过执行前检查

包装后的Prompt自动包含：
- `.opencode/agents/<agent_type>.md` 中声明的全部 `skills` 和 `mcp_tools` 调用指令
- 基于任务描述自动判断的 context7 技术栈查询指令
- 完整的 compliance_gate_check → confirm → complete 流程
- 子Agent配置文件中定义的执行协议

此规则确保子Agent始终执行完整的 P0 协议，无论接收何种类型的任务。

## 一、体系总览

本项目采用**三层八角色**全生命周期自治多智能体架构，覆盖从需求规划、开发实现、质量验证到运维部署的完整链路，严格遵循项目规则。

### 可用子Agent清单（必须完整声明）
- @Meta-Planner
- @Orchestrator
- @Architect
- @Coder-FE
- @Coder-BE
- @Guardian
- @Arbiter
- @CI-CD-Agent

## 二、全局强制规则（Always Apply，最高优先级）
所有智能体必须严格遵循以下项目规则文件（自动加载）：
1. 核心规则
- `.opencode\rules\common-project.md`：通用项目开发规范
- `.opencode\rules\mcp-compliance-guide.md`：MCP工具使用合规要求
- `.opencode\rules\skill-compliance-guide.md`：Skill调用权限与合规要求
2. 项目要件与设计文档（强制遵循）
- `.opencode\context\requirements\系统架构设计文档（SAD）.md`
- `.opencode\context\requirements\接口设计规范文档.md`
- `.opencode\context\requirements\数据架构设计文档.md`
- `.opencode\context\requirements\安全架构设计文档.md`
- `.opencode\context\requirements\测试策略与计划.md`
- `.opencode\context\requirements\运维与部署设计文档.md`
- `.opencode\context\code_standards\frontend-coding-standard.md`（前端开发强制遵循）
- `.opencode\context\code_standards\backend-coding-standard.md`（后端开发强制遵循）
- `.opencode\context\code_standards\testing-coding-standard.md`（测试编写与审查强制遵循）

### 🚨 合规门禁强制（所有Agent无条件遵守，最高优先级）
所有任务开始前必须依序执行以下三步（均不可跳过）：
1. 调用 `compliance_gate_check(task_description)` — 执行合规门禁检查
2. 向用户展示完整任务计划并等待确认
3. 调用 `compliance_gate_confirm(plan_summary)` — 武装合规门禁

合规门未武装，任何Agent不得进入分析、设计或编码阶段。此门禁优先级高于所有其他规则。

### 🚨 TDD 强制铁律（所有Agent无条件遵守）
1. 测试绝对先行：**无测试用例，禁止编写任何业务代码**
2. RED阶段：测试用例必须先执行失败，方可进入开发
3. GREEN阶段：仅编写最简代码通过测试，禁止过度实现
4. REFACTOR阶段：重构必须在测试全量通过后进行
5. 门禁规则：测试未100%通过，禁止进入代码审查环节

## 三、角色清单与分工（8大专业智能体）

### 元认知层（Meta Layer）

| 角色名           | 核心定位               | 调用方式            |
| ------------- | ------------------ | --------------- |
| @Meta-Planner | 项目CTO，顶层需求拆解与DAG规划 | `@Meta-Planner` | 必须遵循 `.opencode/rules/rule_detail/dag-generation-standard.md` |
| @Orchestrator | 项目经理，任务调度与状态管控     | `@Orchestrator` |

### 编排与执行层（Orchestration & Execution Layer）

| 角色名        | 核心定位                                | 调用方式         |
| ---------- | ----------------------------------- | ------------ |
| @Architect | 系统架构师，接口契约与技术规范定义                   | `@Architect` |
| @Coder-FE  | 前端开发工程师，页面/组件/交互实现                  | `@Coder-FE`  |
| @Coder-BE  | 后端/服务端开发工程师（含Salesforce），API/业务逻辑实现 | `@Coder-BE`  |

### 验证与运维层（Validation & Operation Layer）

| 角色名          | 核心定位                        | 调用方式           |
| ------------ | --------------------------- | -------------- |
| @Guardian    | 质量门禁，代码规范/安全/架构约束审查 + 测试执行证据验证 | `@Guardian`    |
| @Arbiter     | 技术委员会，冲突裁决与技术债豁免审批          | `@Arbiter`     |
| @CI-CD-Agent | DevOps/SRE，CI管道运维、自动部署与生产自愈 | `@CI-CD-Agent` |

## 四、核心协作协议

1. **权限隔离原则**：每个智能体仅拥有专属Skill权限，禁止越权操作，严格遵循`skill-compliance-guide.md`
2. **DAG调度规则**：由@Orchestrator解析@Meta-Planner生成的`Task.DAG.json`，按依赖顺序调度子任务，无依赖任务并行执行
3. **契约驱动开发**：@Architect输出的`contract.yaml`为只读锁定状态，前后端开发、测试、审查均以此为唯一依据
4. **质量门禁强制**：所有代码必须通过@Guardian审查（含测试执行证据验证），未通过禁止合并
5. **闭环反馈机制**：@CI/CD-Agent将部署/运维结果回传给@Orchestrator，@Arbiter将裁决结果回传给@Meta-Planner，形成全链路闭环
6. **上下文治理**：每个阶段完成后自动压缩上下文，仅传递必要结果，禁止冗余信息污染
7. **死循环熔断**：连续3次未通过审查/测试，自动触发@Arbiter介入，终止当前任务流
8. **工作记忆草稿纸**：@Coder-BE 和 @Coder-FE 在编写代码前，必须先更新任务专属 `TASK_LOG.md`，记录本次修改计划、新增方法、返回类型等关键信息，防止长串行输出中的上下文漂移。该文件不提交到 Git（已加入 `.gitignore`）
9. **测试执行证据强制**：@Coder-BE/@Coder-FE 输出的 `test_report.json` 必须包含 `execution_evidence` 字段（测试命令输出的关键摘要或断言结果），@Guardian 审查时若发现缺失则直接返回 `FAIL`
10. **技术债可视化追踪**：@Arbiter 批准 `WAIVE.md` 后，必须在项目根目录 `TECH_DEBT_REGISTRY.md` 中追加记录；@Meta-Planner 规划新版本时必须扫描该注册表，将临近偿还日的技术债转化为新任务
11. **交接摘要机制**：每个执行类 Agent（@Coder-BE、@Coder-FE）在任务完成时，必须输出 `HANDOVER.md` 放在任务专属临时目录下，包含核心改动、关键假设、潜在坑点、测试提醒，降低串行环节信息损耗
12. **自愈熔断重试策略**：任务被 @Arbiter 熔断后，@Orchestrator 按优先级执行降级重试（调用 @Meta-Planner 生成更细粒度任务）、专家切换（@Architect 重审契约）、或人工待命（附完整失败上下文）

### 运行时产物路径规范

所有 Agent 运行时产物（TASK_LOG.md, HANDOVER.md, test_report.json, *_report.json）统一存放于 `.task_temp/{taskId}/` 目录下。全局交叉任务文件（Task.DAG.json, WAIVE.md, incident_report.md, deployment_status.json）存放于 `.task_temp/_global/`。

## 五、Skill调用规范

所有智能体仅可调用自身配置中绑定的专属Skill，禁止越权调用未授权Skill，严格遵循项目Skill合规要求。

## 六、标准执行流程（要件优先 + RED/GREEN TDD 强制 + 工程化可靠性）
1. 需求输入 → @Meta-Planner 读取要件文档 + **扫描 TECH_DEBT_REGISTRY.md** → 生成 Project.graph + Task.DAG.json
2. @Orchestrator 调度任务 → @Architect 输出 contract.yaml（含 `x-qoder-state-hash`，接口/数据契约，TDD唯一依据）
3. 【TDD-RED 阶段】@Coder-BE / @Coder-FE 基于契约+要件书 → 编写失败测试用例（Commit Message 标记 `[Red] {task_id}`）→ 执行测试（强制失败）
4. 【TDD-GREEN 阶段】@Coder-FE / @Coder-BE **更新 TASK_LOG.md 工作记忆** → 基于测试用例 → 编写最简业务代码 → 让测试全部通过（Commit Message 标记 `[Green] {task_id}`）
5. 【任务交接】执行 Agent 输出 **HANDOVER.md 交接摘要** + **test_report.json（含 execution_evidence）**
6. 【TDD-REFACTOR 阶段】@Coder 重构代码 → 回归测试（保持全量通过）→ 更新 test_report.json
7. @Guardian 代码审查（规范/安全/架构 + **测试执行证据验证（DoD 强制检查）**）→ 冲突由 @Arbiter 裁决
8. Git Hook 校验 machine.json 契约哈希同步 → 代码合并
9. @CI-CD-Agent 部署/自愈 → 结果回传@Orchestrator → 全流程闭环
10. 【熔断重试】若连续3次未通过 → @Arbiter 介入 → @Orchestrator 执行降级重试/专家切换/人工待命

---

# 附录：项目技术参考

## 项目结构

```
/mnt/c/Users/User/Documents/Playground 2/
├── booking_system_refactor/     # 主项目目录
│   ├── booking-backend/         # NestJS v11+ API (port 3000)
│   ├── booking-frontend/        # Angular v21+ SPA (port 4200)
│   ├── e2e/                     # Playwright E2E tests
│   ├── playwright/              # Playwright config & fixtures
│   ├── scripts/                 # Build & utility scripts
│   ├── contract.yaml            # API 契约定义
│   └── Task.DAG.json            # 任务依赖图
└── .opencode/                      # 项目规则与上下文
```

## 常用命令

### booking-backend (NestJS v11+)

```bash
cd booking_system_refactor/booking-backend

# Development
npm run start:dev              # Hot reload dev server (port 3000)
npm run start:debug            # Debug mode with watch

# Build & Production
npm run build
npm run start:prod

# Code Quality
npm run typecheck              # tsc --noEmit
npm run lint                   # ESLint with auto-fix

# Testing
npm run test                   # Unit tests (Jest)
npm run test:watch             # Watch mode
npm run test:cov               # Coverage (threshold: 70%)
npm run test:integration       # Integration tests with Testcontainers
npm run test:e2e               # E2E tests
npm run test:mutation          # Stryker mutation testing

# Database (Prisma)
npm run prisma:generate        # Generate Prisma client
npm run prisma:migrate:dev     # Development migrations
npm run prisma:migrate:deploy  # Production migrations
npm run prisma:studio          # Open Prisma Studio
npm run prisma:seed            # Run seed script
npm run prisma:reset           # Reset database
```

### booking-frontend (Angular v21+)

```bash
cd booking_system_refactor/booking-frontend

# Development
npm run start                  # ng serve (port 4200)
npm run ng serve               # Alternative

# Build
npm run build                  # Production build
npm run watch                  # Development build with watch

# Testing
npm run test                   # Karma + Jasmine tests
npm run test:audit-coverage    # Coverage audit
```

### E2E Tests (Playwright)

```bash
cd booking_system_refactor
npx playwright test            # Run all E2E tests
npx playwright test --ui       # UI mode
npx playwright test --headed   # Headed mode
```

## 架构速查

### Backend (NestJS v11+)

**Modules** (`src/modules/`):
- `appointments/` - 预约管理
- `auth/` - JWT 认证
- `cache/` - Redis 缓存
- `email/` - 邮件服务
- `health/` - 健康检查
- `notifications/` - 通知服务
- `rate-limiter/` - 限流控制
- `services/` - 服务管理
- `stats/` - 统计报表
- `time-slots/` - 时间段管理
- `users/` - 用户管理
- `verification/` - 验证码服务

**Common** (`src/common/`):
- 共享基础设施模块

**Stack**:
- NestJS v11+, Node.js 22.x LTS
- Prisma 6.16.2 + PostgreSQL 16
- Redis 7.x + BullMQ
- JWT + Passport 认证
- Jest + Testcontainers 测试

### Frontend (Angular v21+)

**Structure** (`src/app/`):
- `core/` - 核心模块（服务、拦截器、守卫）
- `features/` - 功能模块
- `shared/` - 共享组件
- `stores/` - NgRx Signals 状态管理

**Stack**:
- Angular v21+ with standalone components
- NgRx Signals (@ngrx/signals) 状态管理
- PrimeNG + Tailwind CSS v4
- Karma + Jasmine 测试

## API 契约要点

- **Base URL**: `http://localhost:3000/v1`
- **Versioning**: URI path versioning
- **Auth**: JWT Bearer Token (15分钟有效期, 7天刷新)
- **Key Endpoints**:
  - `POST /v1/auth/login` - 登录
  - `POST /v1/auth/register` - 注册
  - `POST /v1/auth/refresh` - 刷新 Token
  - `POST /v1/appointments` - 创建预约
  - `GET /v1/appointments` - 查询预约列表
  - `GET /v1/time-slots/available` - 可用时间段
  - `GET /v1/services` - 服务列表

- **Frontend Proxy**: Angular 开发服务器代理 `/api` → `http://localhost:3000/v1`

## 环境配置

### Backend (.env)
```
PORT=3000
DATABASE_URL=postgresql://user:pass@localhost:5432/booking
REDIS_URL=redis://localhost:6379
JWT_SECRET=your-secret
JWT_REFRESH_SECRET=your-refresh-secret
```

### Frontend
配置位于 `src/environments/`

## 开发启动流程

1. `docker compose -f docker-compose.dev.yml up -d` - 启动 PostgreSQL + Redis
2. `cd booking-backend && npm run prisma:migrate:dev && npm run start:dev`
3. `cd booking-frontend && npm run start`
4. 打开 `http://localhost:4200`

## 覆盖率阈值

| 组件 | Lines | Branches | Functions | Statements |
|------|-------|----------|-----------|------------|
| Backend | 85% | 80% | 85% | 85% |
| Frontend | Per lighthouserc.json | - | - | - |

