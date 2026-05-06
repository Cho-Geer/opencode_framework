# Test Classes Update Plan — Business Code Change Compliance

## Overview

当业务代码发生变更时，对应的测试类（`.spec.ts`）必须同步更新。  
本文档记录修复流程、合规规则和可复用的检查清单。

---

## 1. 问题背景

在 Booking System 的 API 集成阶段（Phase 4），以下业务代码变更导致测试失败：

| 业务代码文件 | 变更内容 | 影响 |
|-------------|---------|------|
| `booking.service.ts:40` | 新增 `this.store.selectedServiceId()` 调用 | 测试 mock 缺少 `selectedServiceId` |
| `booking.service.ts:56-60` | `reserveSlot()` 内部逻辑变更 | 测试需验证新的 API 调用路径 |
| `service-selection.component.ts:41` | 新增 `this.store.setSelectedServiceId()` 调用 | 测试 mock 缺少 `setSelectedServiceId` |
| `api-transform.interceptor.ts:50` | `HttpResponse.clone()` 类型修复 | 测试需要验证 interceptor 行为 |

### 影响数据

| 指标 | 数值 |
|------|------|
| 业务代码变更前测试失败数 | 63（预存） |
| 业务代码变更后新增失败 | 8 |
| 需修改的测试文件 | 2 |
| 修复后测试失败数 | 58（仅预存，无新增） |

---

## 2. 合规流程（P0 Protocol）

每次业务代码变更伴随测试更新时，必须执行以下合规流程：

### Step 1: Compliance Gate Check

```bash
/compliance-gate "Update test classes for business code changes: <描述具体变更>"
```

调用 `compliance_gate_check(task_description)` 获取 `session_id`。

### Step 2: 展示修复计划

向用户展示：
- 变更的业务代码和行号
- 受影响的测试文件清单
- 每个测试文件需要的具体修改
- 预期修复后的测试结果

### Step 3: 等待用户确认

用户确认计划后，调用 `compliance_gate_confirm(session_id, plan_summary)`。

### Step 4: 执行修复（Dispatch 子Agent）

使用 `/dispatch` 命令派遣 `@Coder-FE` 执行测试修复：

```bash
node .opencode/scripts/command-tools/dispatch-subagent.js coder-fe \
  "Fix test files broken by business code changes:
   - File A: 添加缺少的 mock 方法
   - File B: 更新 mock 返回值匹配新接口
   TDD: 先运行 RED（确认失败），再修复（GREEN），最后 REFACTOR"
```

### Step 5: 验证

运行受影响测试套件和全量测试套件：

```bash
npx jest --testPathPatterns='<测试文件模式>' --forceExit
npx jest --forceExit   # 全量验证
```

确认修复后无新增失败。

### Step 6: 完成

```bash
compliance_gate_complete(session_id, execution_summary)
```

---

## 3. 测试修复清单（基于真实案例）

### 3.1 Mock 遗漏检查

| 变更类型 | 检查项 | 案例 |
|---------|--------|------|
| 新增 Store 方法调用 | Mock 中是否包含该方法 | `setSelectedServiceId` |
| 新增 Store 状态读取 | Mock 中是否包含该状态信号 | `selectedServiceId` |
| 新增 API 调用 | Mock 中是否有对应的 `jest.fn()` | `createAppointment` |
| API 调用参数变更 | Mock 验证参数是否正确 | `serviceId`, `preferredSequence` |
| API 返回值变更 | Mock 返回值是否符合新接口 | `of({...})` 包含新字段 |
| 组件新增依赖 | `TestBed` 是否提供该依赖 | — |

### 3.2 Mock 返回值检查

| 变更类型 | Mock 配置 | 示例 |
|---------|-----------|------|
| Store 信号读取 | `jest.fn(() => <默认值>)` | `selectedServiceId: jest.fn(() => 'svc-1')` |
| API 调用成功 | `jest.fn().mockReturnValue(of(<数据>))` | `createAppointment: jest.fn().mockReturnValue(of({...}))` |
| API 调用失败 | `jest.fn().mockReturnValue(throwError(() => new Error(...)))` | 测试失败路径 |
| Store 方法调用 | `jest.fn()` | `setSelectedServiceId: jest.fn()` |

### 3.3 测试断言检查

| 变更类型 | 断言 | 说明 |
|---------|------|------|
| 新增 API 调用 | `expect(mock).toHaveBeenCalledWith(...)` | 验证参数 |
| 新增 Store 调用 | `expect(mock).toHaveBeenCalled()` | 验证调用 |
| 变更返回路径 | `expect(result).toBe(...)` | 验证新返回值 |
| 错误处理 | `expect(mock).toHaveBeenCalledWith(...)` | 验证失败路径 |

---

## 4. 可复用检查清单（CI 门禁）

在每次业务代码 PR 提交前，检查以下清单：

### 4.1 TDD 合规检查

- [ ] 所有受影响测试文件已识别
- [ ] 新业务逻辑有对应的测试用例
- [ ] 修改的业务逻辑有对应的测试更新
- [ ] 删除的业务逻辑有对应的测试移除

### 4.2 Mock 完整性检查

- [ ] 新增的 Store 状态有 mock `jest.fn(() => <类型默认值>)`
- [ ] 新增的 Store 方法有 mock `jest.fn()`
- [ ] 新增的 API 调用有 mock 返回值
- [ ] 新增的依赖已注册到 `TestBed.configureTestingModule`
- [ ] 删除的依赖已从 `TestBed` 移除

### 4.3 验证检查

- [ ] 受影响测试套件全部通过
- [ ] 全量测试套件无新增失败

---

## 5. 本次修复记录

### 5.1 `booking.service.spec.ts`

**根因**: `booking.service.ts` 新增对 `this.store.selectedServiceId()` 的调用，但测试 mock 未包含。

**修复**:
```typescript
// Fix 1: 添加 selectedServiceId mock 信号（返回有效 serviceId）
selectedServiceId: jest.fn(() => 'svc-1'),

// Fix 2: 让 createAppointment mock 返回有效 Observable
createAppointment: jest.fn().mockReturnValue(of({
  id: 'booking-1',
  status: 'CONFIRMED',
  userId: 'user-1',
  timeSlotId: 'slot-1',
  serviceId: 'svc-1',
  appointmentDate: new Date().toISOString(),
  slotSequence: 1,
  createdAt: new Date().toISOString(),
})),
```

### 5.2 `service-selection.component.spec.ts`

**根因**: `service-selection.component.ts` 新增对 `this.store.setSelectedServiceId()` 的调用，但测试 mock 未包含该方法。

**修复**:
```typescript
// 添加缺少的 Store 方法 mock
setSelectedServiceId: jest.fn(),
```

---

## 6. 效果验证

| 阶段 | 失败套件 | 失败测试 |
|------|----------|---------|
| 业务代码变更前（预存） | 13 | 63 |
| 业务代码变更后（未修复测试） | 15 | 71 |
| 测试修复后 | 13 | 58 |
| 网络归因 | 0 新增 | 0 新增 |

**结论**: 修复后 **0 个新增失败**，所有失败均为预存问题。

---

## 7. 附录：预存失败说明

当前余下的 58 个测试失败均为预存问题，与本次变更无关：

| 失败类型 | 文件 | 根因 |
|---------|------|------|
| `fakeAsync` 需要 `zone-testing` | `auth.guard.spec`, `guest.guard.spec` | Jest 与 zone.js 兼容性 |
| NG0100 表达式变更错误 | `app-toast`, `app-badge` | Angular 变更检测 |
| 生命周期钩子未模拟 | `login`, `register` | 组件测试环境问题 |
| HTTP retry 匹配 | `api.service.spec` | RxJS retry 操作符测试 |

---

**维护者**: 前端团队  
**最后更新**: 2026-04-30  
**关联文档**: `AGENTS.md`, `testing-coding-standard.md`, `frontend-coding-standard.md`  
**位置**: `docs/design/test-update-compliance-plan.md`
