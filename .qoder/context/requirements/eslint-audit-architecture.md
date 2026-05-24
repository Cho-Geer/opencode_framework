# ESLint Audit 强约束实施计划

> **版本**: 2.0.0  
> **日期**: 2026-05-14  
> **作者**: @Architect  
> **审批**: @Arbiter  

---

## 1. 要解决的问题

`time-slots.service.spec.ts` mock 了 `PrismaService`（TIER1）——违反 CAT1.1。单元测试未发现（mock 了全部依赖）、@Guardian 审查未拦截、Playwright 抓到症状被误判。根源：**约束规则有文档但无自动执行**。本计划消除这一差距。

---

## 2. 架构原则

### 2.1 单一真相源

```
contract.yaml ← 唯一约束定义
      │
      ├──→ tier-rules.json (自动生成，不手写)
      ├──→ machine.json    (运行时状态)
      └──→ ESLint 规则     (执行器)
```

### 2.2 强制分层防御

不是一层做所有事，而是三层叠加——每一层独立覆盖上一层的盲区：

```
Layer A: Agent 主动     → 建议（提前发现，不强制）
Layer B: Gate 强制      → P0 不可绕过（真正有效的防线）
Layer C: Hook 兜底      → 拦截 gate 外的意外
```

**只有 Layer B 是真正不可绕过的。** Layer A 和 C 是辅助，不依赖它们。

---

## 3. 角色职责

| 角色 | 职责 |
|------|------|
| @Architect | 维护 contract.yaml `x-eslint-policy`<br>维护 ESLint 插件 `.qoder/tools/eslint-plugin-opencode-mock-audit/`<br>维护 MCP tool `.qoder/scripts/mcp-tools/eslint-audit.js`<br>维护 machine.json schema |
| @Coder-BE/@Coder-FE | write/edit 后建议调 eslint-audit（Layer A）<br>**任务结束时必须调 compliance_gate_complete**（Layer B）<br>违规时：修复代码 OR 申请 @Arbiter waiver |
| @Guardian | 读 machine.json.eslint_state → violations=0 且无 stale 状态 → PASS<br>审 waiver 合理性 → 引用 TECH_DEBT_REGISTRY.md |
| @Arbiter | 审批 waiver → TECH_DEBT_REGISTRY.md 追加记录 |
| @Orchestrator | 读 machine.json → dirty 模块拒调度 |

---

## 4. ESLint 插件

**位置**: `.qoder/tools/eslint-plugin-opencode-mock-audit/`

### 规则

| 规则 | 级别 | 检测内容 |
|------|:---:|------|
| `no-tier1-mock` | **error** | `jest.spyOn(prisma.*, '*').mock*`、直接 `.mockResolvedValue`、`jest.mock('@prisma/client')` |
| `no-skipped-audit` | **error** | `eslint-disable` 绕过 no-tier1-mock 但未引用有效 waiver ID |
| `tier3-verify` | warn | TIER3 mock 未验证调用参数 |

### 关键设计

```
规则不硬编码 TIER 服务列表
       ↓
每次执行前从 contract.yaml → 自动生成 tier-rules.json
       ↓
规则读取 tier-rules.json 获取 TIER1_SERVICES
```

### waiver 引用格式

```typescript
// eslint-disable-next-line booking/no-tier1-mock -- waiver: WAIVE-2026-001
```

waiver ID 必须在 `TECH_DEBT_REGISTRY.md` 中存在且 status = "approved"。空注释或不存在的 ID → `no-skipped-audit` 报 error。

---

## 5. MCP Tool

**位置**: `.qoder/scripts/mcp-tools/eslint-audit.js`

```
MCP Server: eslint-audit
Tool: run_audit

输入:
  { changed_file?: string }     // 可选，单文件扫描
  { full_scan: true }           // 全量扫描，compliance_gate 调用时使用

输出:
  {
    status: "pass" | "fail",
    module: string,
    violations: [{ file, line, rule, message }],
    machine_json_updated: boolean
  }

副作用:
  更新 machine.json.eslint_state.{module}
```

### 执行流程

```
1. 从 contract.yaml → 生成 .qoder/generated/tier-rules.json
2. 确定扫描范围 (单文件 or 全量)
3. npx eslint --format json
4. 解析输出 → violations[]
5. 更新 machine.json.eslint_state:
   ├── status = violations > 0 ? "dirty" : "clean"
   ├── violations = [...]
   ├── last_check = now
   └── aggregate 计数重算
6. 返回结果
```

---

## 6. 三层触发

### Layer A: Agent 主动（建议）

```
@Coder 执行 write/edit
       │
       ▼
(可选) eslint-audit.run_audit({ changed_file })
       │
       ├── PASS → 继续
       └── FAIL → 提前修复，不等 gate
```

**不是强制步骤。Agent 可以跳过。** 价值是即时反馈，减少 gate 时返工。

### Layer B: compliance_gate_complete（P0 不可绕过）

```
@Coder 完成开发 → compliance_gate_complete(session_id, summary)
                        │
                        ├── keystone_validate()           (已有)
                        ├── eslint_audit.run_audit({       (新增)
                        │       full_scan: true
                        │   })
                        │      │
                        │      ├── PASS → 继续
                        │      └── FAIL
                        │         ├── machine.json 标记 dirty
                        │         └── complete 返回 failed
                        │            Agent 必须修复后重新 complete
                        │
                        └── machine.json.contract_compliance = "passed"
```

**为什么要依赖 complete 而不是 check**：AGENTS.md 已规定所有任务以 `compliance_gate_check` 开始。同样，`compliance_gate_complete` 必须升级为 P0 强制结束步骤——Agent 不调 complete = 任务未完成 = @Orchestrator 拒调度下一个任务。

**AGENTS.md 需新增**:
```markdown
### 🚨 P0 强制规则（补充）

所有任务结束时必须调用 compliance_gate_complete。未调 complete 的任务视为未完成，
@Orchestrator 拒绝调度该 Agent 的下一个任务。
```

### Layer C: pre-commit hook（兜底）

```bash
# .git/hooks/pre-commit
npx eslint --rule 'booking/no-tier1-mock: error' $(git diff --cached --name-only | grep '\.spec\.ts$')
# FAIL → commit 拒绝
```

拦截 Agent 跳过 gate 直接 commit 的边缘情况。可被 `--no-verify` 绕过，但 Layer B 已先行拦截。

---

## 7. contract.yaml 新增

```yaml
x-eslint-policy:
  version: "2.0.0"

  tier_definition:
    tier1_real_only:
      services: [PrismaService, RedisService, ConfigService]
      mock_policy: "forbidden"
      error_level: "error"
    tier2_fake_ok:
      services: [JwtService, QueueService, NotificationGateway, RateLimiterService]
      mock_policy: "warn"
      error_level: "warn"
    tier3_boundary_mock:
      services: [EmailService, SMSService]
      mock_policy: "require_param_verification"
      error_level: "warn"

  integration_test_requirement:
    mode: "per_module"
    modules:
      - appointments
      - auth
      - cache
      - email
      - health
      - notifications
      - rate-limiter
      - services
      - stats
      - time-slots
      - users
      - verification
```

---

## 8. machine.json 新增

```jsonc
{
  "x-keystone-state-hash": "<sha256>",

  "eslint_state": {
    "last_full_scan": "2026-05-14T13:00:00Z",
    "modules": {
      "time-slots": {
        "status": "clean",         // "clean" | "dirty" | "waived"
        "violations": [],
        "last_check": null,
        "waivers_applied": []
      }
    },
    "aggregate": {
      "total_violations": 0,
      "dirty_modules": [],
      "waived_modules": []
    }
  },

  "contract_compliance": {
    "eslint_audit": "passed",      // 由 compliance_gate_complete 写入
    "checked_at": null
  },

  "waivers_consumed": []
}
```

---

## 9. @Guardian 审查流程（机器判定）

```
@Guardian 审查:

1. 读 machine.json.eslint_state

2. aggregate.total_violations > 0 ?
   ├── NO  → 继续步骤 3
   └── YES → 逐个检查 waiver
       ├── violation.waiver 不为 null
       │   └── TECH_DEBT_REGISTRY.md 存在且 approved 且未过期
       │       ├── YES → 该 violation 豁免
       │       └── NO  → FAIL (CAT1.0: 无效 waiver)
       └── violation.waiver 为 null
           └── FAIL (CAT1.1: 无豁免的 TIER1 mock)

3. integration_test_coverage 检查
   ├── contract.yaml x-eslint-policy.integration_test_requirement.modules
   ├── 扫描 test/integration/
   ├── 缺失模块 = [] → PASS
   └── 缺失模块 ≠ [] → FAIL (CAT3.6)
       → @Meta-Planner DAG 自动插入补测试任务

4. 写入 machine.json.contract_compliance
```

---

## 10. Waiver 机制

```
@Coder → @Arbiter: "/waiver TIER1 time-slots time-slots.service.spec.ts:466"

@Arbiter 审批 → TECH_DEBT_REGISTRY.md 追加:
  | WAIVE-2026-001 | TIER1 | time-slots | jest.spyOn(prisma.timeSlot) |
    等待 Testcontainers 迁移 | 2026-06-14 | approved |

@Coder 代码中:
  // eslint-disable-next-line booking/no-tier1-mock -- waiver: WAIVE-2026-001

machine.json:
  .eslint_state.modules.time-slots.violations[0].waiver = "WAIVE-2026-001"
  .waivers_consumed += "WAIVE-2026-001"

@Orchestrator 检查:
  waiver.expires_at < now → 过期 → 模块重新标记 dirty → 拒调度
```

---

## 11. 约束强度验证

### 原始 bug 在新架构下

```
@Coder-BE writes: jest.spyOn(prisma.timeSlot, 'findMany').mockResolvedValue(...)

Layer A (主动):  Agent 可能跳过                    → 未发现  ← 允许，不是强制

Layer B (gate):  compliance_gate_complete()
                    └→ eslint-audit.run_audit({ full_scan: true })
                    └→ 'no-tier1-mock' → error
                    └→ machine.json.time-slots.status = "dirty"
                    └→ complete 返回 FAIL             ← 拦截 ✓
                    
                  Agent 不调 complete?
                    └→ 任务未完成
                    └→ @Orchestrator 不调度下一个       ← 拦截 ✓

Layer C (hook):  git commit → pre-commit hook → ESLint → FAIL  ← 拦截 ✓

就算三层全漏:
  @Guardian 读 machine.json → "dirty" → FAIL           ← 拦截 ✓
```

### 所有攻击向量

| 攻击 | 结果 | 机制 |
|------|:---:|------|
| 写违规代码，调 complete | **拦截** | complete 内全量扫描 → FAIL |
| 写违规代码，不调 complete | **拦截** | 任务未完成，@Orchestrator 拒调度 |
| git commit --no-verify | **拦截** | gate 已在 complete 时拦截 |
| eslint-disable 无 waiver | **拦截** | no-skipped-audit 规则 → error |
| eslint-disable + 假 waiver ID | **拦截** | @Guardian 验证 TECH_DEBT_REGISTRY |
| eslint-disable + 过期 waiver | **拦截** | @Orchestrator 检查过期 → 拒调度 |
| @Guardian 漏判 | **拦截** | machine.json 是机器写的 status 字段，无需人的判断 |

---

## 12. MCP 工具注册

`eslint-audit` MCP server 需要在 opencode 客户端配置中注册才能被 Agent 发现和调用。在 `~/.config/opencode/opencode.json` 或等效的客户端配置中添加以下条目：

```json
{
  "mcpServers": {
    "eslint-audit": {
      "command": "node",
      "args": [".qoder/scripts/mcp-tools/eslint-audit.js"],
      "env": {},
      "disabled": false,
      "autoApprove": null
    }
  }
}
```

注册后，所有 Agent 将可以通过 `eslint_audit.run_audit()` 调用此 MCP 工具。

## 13. 实施步骤

| # | 角色 | 内容 | 产出 |
|:--:|------|------|------|
| 1 | @Architect | 创建 ESLint plugin | `.qoder/tools/eslint-plugin-opencode-mock-audit/` |
| 2 | @Architect | 创建 MCP tool server | `.qoder/scripts/mcp-tools/eslint-audit.js` |
| 3 | @Architect | 更新 contract.yaml | 新增 `x-eslint-policy` 段 |
| 4 | @Architect | 更新 machine.json schema | 新增 `eslint_state` |
| 5 | @Architect | 更新 compliance_gate_complete | 新增 eslint_audit 检查 |
| 6 | @Architect | 更新 AGENTS.md | complete 升级为 P0 强制 |
| 7 | @Architect | 更新 @Guardian 审查清单 | 新增 eslint_state 判定 |
| 8 | @Architect | 创建 pre-commit hook | ESLint 兜底检查 |
| 9 | @Coder-BE | 修复 `time-slots.service.spec.ts` | 改用 Testcontainers |
| 10 | @Coder-BE | 补 `time-slots.integration.spec.ts` | Testcontainers 真实 PostgreSQL |
| 11 | @Guardian | 全量验证 | 所有模块 eslint_state = clean |
| 12 | @Arbiter | 审批遗留 waiver | TECH_DEBT_REGISTRY.md |