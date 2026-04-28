# DAG 制定标准 v1.0

**制定时间**: 2026-04-16  
**版本**: v1.0.0  
**适用范围**: 所有涉及 Task.DAG.json 生成、更新、审查的任务

---

## 一、适用范围

所有涉及 `Task.DAG.json` 生成、更新、审查的任务必须遵循本规范。

## 二、强制触发 Agent

| Agent | 触发场景 |
|-------|---------|
| **@Meta-Planner** | DAG 生成、版本升级、任务追加 |
| **@Guardian** | DAG 覆盖率和完整性审查 |
| **@Orchestrator** | DAG 执行监控、状态同步验证 |

---

## 三、全面性约束 (Completeness Rules)

### C1 - 要件全覆盖

DAG 任务必须覆盖以下全部 6 份要件文档的每一个可验证条款：

| 序号 | 要件文档 | 文件路径 |
|------|---------|---------|
| 1 | 系统架构设计文档（SAD） | `.opencode/context/requirements/系统架构设计文档（SAD）.md` |
| 2 | 接口设计规范文档 | `.opencode/context/requirements/接口设计规范文档.md` |
| 3 | 数据架构设计文档 | `.opencode/context/requirements/数据架构设计文档.md` |
| 4 | 安全架构设计文档 | `.opencode/context/requirements/安全架构设计文档.md` |
| 5 | 测试策略与计划 | `.opencode/context/requirements/测试策略与计划.md` |
| 6 | 运维与部署设计文档 | `.opencode/context/requirements/运维与部署设计文档.md` |

**违反后果**: 需求遗漏，项目无法 100% 完成。  
**验证方式**: Guardian 审查时逐项核对要件条款与 DAG 任务映射关系。

### C2 - 契约条款映射

`contract.yaml` 中的每个 endpoint、data model、security rule 必须有对应的 DAG 任务。

映射要求：
- 每个 API endpoint 至少对应 1 个实现任务 + 1 个测试任务
- 每个 data model 变更至少对应 1 个迁移任务
- 每个 security rule 至少对应 1 个安全实现任务

### C3 - 模块级拆解

每个后端模块至少生成 **3 个任务**：

| 任务类型 | 内容 | 示例 |
|---------|------|------|
| 实现任务 | controller + service + dto + module | `time-slots.controller.ts`, `time-slots.service.ts` |
| 测试任务 | spec 文件（单元 + 集成） | `time-slots.service.spec.ts` |
| 集成任务 | 与其他模块的连接/wiring | 在 `app.module.ts` 中注册 |

**适用模块**: auth, users, services, time-slots, appointments, notifications, cache, rate-limiter, stats, health, email

### C4 - 前端原子拆解

每个前端组件族至少生成 **2 个任务**：

| 任务类型 | 内容 | 示例 |
|---------|------|------|
| 组件实现 | ts + html + scss + spec | `login.component.ts`, `login.component.html` |
| Store wiring | NgRx Signals 连接 | `auth.store.ts` 连接到组件 |

**适用组件族**: auth, booking, admin, shared

### C5 - 安全增强独立

每个安全增强项必须是**独立任务**，不能合并在其他任务中：

| 安全项 | 优先级 | 对应要件 |
|--------|--------|---------|
| CSRF protection | P1 | 安全架构设计文档 |
| Rate limiting with Redis | P1 | 安全架构设计文档 |
| Token blacklisting | P1 | 安全架构设计文档 |
| Vault integration placeholder | P2 | 安全架构设计文档 |

### C6 - DevOps 独立

以下各项必须是**独立任务**：

| DevOps 项 | 优先级 | 对应要件 |
|----------|--------|---------|
| Docker Compose 配置 | P1 | 运维与部署设计文档 |
| CI/CD Pipeline (GitHub Actions) | P1 | 运维与部署设计文档 |
| 部署配置与环境变量 | P2 | 运维与部署设计文档 |
| 监控与健康检查 | P2 | 运维与部署设计文档 |

---

## 四、细粒度约束 (Granularity Rules)

### G1 - 单任务工作量上限

单个任务的 `target_files` 数量 **不超过 5 个**。

判定公式：`task.target_files.length <= 5`

### G2 - 最小任务数公式

总任务数必须满足：

```
总任务数 >= 后端模块数 x 3 + 前端组件族数 x 2 + 安全项数 + DevOps项数
```

本项目参考值：
- 后端模块数: 11 (auth, users, services, time-slots, appointments, notifications, cache, rate-limiter, stats, health, email)
- 前端组件族数: 4 (auth, booking, admin, shared)
- 安全项数: 4 (CSRF, rate limiting, token blacklisting, Vault)
- DevOps项数: 4 (Docker Compose, CI/CD, 部署配置, 监控)

**最小任务数 >= 11x3 + 4x2 + 4 + 4 = 49**

### G3 - 测试独立

每个业务模块必须有**独立的测试任务**，不能合并在实现任务中。

TDD 铁律要求：
- 测试任务必须先于实现任务（依赖关系）
- 测试任务必须明确标记为 `TDD-RED` 阶段
- 实现任务必须标记为 `TDD-GREEN` 阶段

### G4 - Definition of Done

每个任务必须包含明确的完成标准，格式如下：

```json
{
  "definition_of_done": {
    "files_exist": ["预期文件路径1", "预期文件路径2"],
    "logic_complete": "业务逻辑描述",
    "tests_pass": "测试用例数量及覆盖率要求",
    "guardian_approved": true
  }
}
```

---

## 五、可追溯性约束 (Traceability Rules)

### T1 - 需求来源字段

每个任务必须有 `requirement_source` 字段，格式为：

```json
{
  "requirement_source": {
    "document": "要件文档名称",
    "section": "具体章节",
    "clause": "条款编号或描述"
  }
}
```

### T2 - 契约引用字段

每个 API/数据任务必须引用 `contract.yaml` 的具体路径：

```json
{
  "contract_reference": {
    "path": "contract.yaml 中的 YAML 路径",
    "type": "endpoint | data_model | security_rule | high_concurrency"
  }
}
```

### T3 - 文件映射字段

每个任务必须有 `target_files` 字段，列出预期产出文件路径：

```json
{
  "target_files": [
    "booking-backend/src/modules/xxx/xxx.controller.ts",
    "booking-backend/src/modules/xxx/xxx.service.ts"
  ]
}
```

### T4 - 依赖真实性

任务依赖必须基于**代码实际 import 关系**，不基于设计假设。

验证方式：Guardian 审查时检查依赖任务的文件是否被目标任务 import。

---

## 六、动态更新约束 (Dynamic Update Rules)

### D1 - 状态同步

任务状态变更必须与实际文件状态一致。

同步规则：
- 文件创建且逻辑完整 → 任务状态可从 `pending` 改为 `in_progress`
- 文件逻辑完整且测试通过 → 任务状态可从 `in_progress` 改为 `completed`
- Guardian 审查通过 → 任务状态确认为 `completed`

### D2 - 差距追加

Guardian 审查发现未覆盖的需求时，自动生成新任务追加到 DAG。

追加流程：
1. Guardian 识别未覆盖的要件条款
2. 生成新任务，包含 `requirement_source`、`target_files`、`definition_of_done`
3. 更新 DAG 版本号
4. 通知 @Orchestrator 调度新任务

### D3 - 版本管理

每次 DAG 更新必须：
- 递增 `meta.version` 字段（语义化版本）
- 在 `meta.description` 中记录变更原因
- 在 `meta.changelog` 中添加变更日志条目
- 保留历史版本文件（`Task.DAG.v{version}.json`）

### D4 - 覆盖率门禁

DAG 覆盖率 < 100% 时**禁止进入执行阶段**。

覆盖率计算公式：

```
覆盖率 = (任务覆盖的要件条款数 / 要件条款总数) x 100%
```

要件条款总数 = 从 6 份要件文档中提取的独立可验证条款数  
任务覆盖的要件条款数 = 至少有一个任务引用该条款的数量

---

## 七、DAG JSON Schema 要求

`Task.DAG.json` 必须包含以下必填字段：

```json
{
  "meta": {
    "version": "string (semantic versioning)",
    "project": "string",
    "generatedBy": "string",
    "generatedAt": "ISO 8601 datetime",
    "description": "string",
    "changelog": [
      {
        "version": "string",
        "date": "ISO 8601 datetime",
        "changes": ["string"]
      }
    ]
  },
  "tasks": [
    {
      "id": "string (e.g., T001)",
      "name": "string",
      "description": "string",
      "agent": "string (@AgentName)",
      "dependencies": ["string (task IDs)"],
      "outputs": ["string"],
      "priority": "P0 | P1 | P2",
      "status": "pending | in_progress | completed",
      "requirement_source": {
        "document": "string",
        "section": "string",
        "clause": "string"
      },
      "target_files": ["string"],
      "definition_of_done": {
        "files_exist": ["string"],
        "logic_complete": "string",
        "tests_pass": "string",
        "guardian_approved": "boolean"
      }
    }
  ]
}
```

---

## 八、违规处理

| 违规类型 | 违反规则 | 处理方式 |
|---------|---------|---------|
| 需求遗漏 | C1, C2 | DAG 生成失败，必须重新生成 |
| 粒度不足 | C3, C4, G1, G2, G3 | @Guardian 审查不通过，退回重新拆解 |
| 定义模糊 | G4 | 任务标记为"不可执行"，限期补充 DoD |
| 不可追溯 | T1, T2, T3, T4 | 任务标记为"不可追溯"，限期修正 |
| 状态不同步 | D1 | @Orchestrator 暂停执行，直至修复 |
| 差距未追加 | D2 | Guardian 自动生成补充任务 |
| 版本混乱 | D3 | 回退到上一有效版本 |
| 覆盖率不足 | D4 | 禁止进入执行阶段 |

---

## 九、与其他规范的引用关系

| 规范文档 | 引用关系 |
|---------|---------|
| `common-project.md` | 本规范被其引用，具有同等强制力 |
| `meta-planner.md` | @Meta-Planner 必须遵循本规范生成 DAG |
| `AGENTS.md` | 在多智能体体系中引用本规范 |
| `测试代码规范.md` | G3 测试独立与其 TDD 铁律协同 |
| `backend-coding-standard.md` | C3 模块级拆解与其模块化规范协同 |
| `frontend-coding-standard.md` | C4 前端原子拆解与其原子设计规范协同 |

---

*本文档将根据项目演进持续更新。*
