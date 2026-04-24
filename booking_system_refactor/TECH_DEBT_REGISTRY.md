# 技术债注册表 (TECH_DEBT_REGISTRY)

## 概述

本文件记录所有已登记的技术债。@Meta-Planner 在每次版本规划时必须扫描本文件，将临近偿还日的债务转化为新任务。

## 技术债清单

### Auth 模块

| ID | 文件 | 失败数（原估/实际） | 登记日期 | 偿还截止日 | 状态 | 责任人 |
|----|------|-------------------|---------|-----------|------|--------|
| TD-2026-001 | register.component.spec.ts | ~15 / 44 | 2026-04-23 | 2026-05-01 | closed ✅ | @Coder-FE |
| TD-2026-002 | login.component.spec.ts | ~12 / 40 | 2026-04-23 | 2026-05-01 | closed ✅ | @Coder-FE |
| TD-2026-003 | register-form.component.spec.ts | ~10 / 24 | 2026-04-23 | 2026-05-01 | closed ✅ | @Coder-FE |
| TD-2026-004 | auth.dto.spec.ts | ~8 / 0 (已通过) | 2026-04-23 | 2026-05-01 | closed ✅ | @Coder-FE |
| TD-2026-005 | auth.store.spec.ts | ~16 / 6 | 2026-04-23 | 2026-05-01 | closed ✅ | @Coder-FE |

### Booking 模块

| ID | 文件 | 失败数（原估/实际） | 登记日期 | 偿还截止日 | 状态 | 责任人 |
|----|------|-------------------|---------|-----------|------|--------|
| TD-2026-006 | booking-confirmation.component.spec.ts | ~12 / 8 | 2026-04-23 | 2026-05-10 | closed ✅ | @Coder-FE |
| TD-2026-007 | service-selection.component.spec.ts | ~10 / 1 | 2026-04-23 | 2026-05-10 | closed ✅ | @Coder-FE |
| TD-2026-008 | time-slot-picker.component.spec.ts | ~14 / 13 | 2026-04-23 | 2026-05-10 | closed ✅ | @Coder-FE |
| TD-2026-009 | booking-success.component.spec.ts | ~8 / 7 | 2026-04-23 | 2026-05-10 | closed ✅ | @Coder-FE |
| TD-2026-010 | booking.store.spec.ts | ~14 / 0 (已通过) | 2026-04-23 | 2026-05-10 | closed ✅ | @Coder-FE |

### Core 模块

| ID | 文件 | 失败数（估） | 登记日期 | 偿还截止日 | 状态 | 责任人 |
|----|------|-------------|---------|-----------|------|--------|
| TD-2026-011 | api.service.spec.ts | ~10 / 6 | 2026-04-23 | 2026-05-23 | closed ✅ | @Coder-FE |
| TD-2026-012 | socket.service.spec.ts | ~8 / 0 (已通过) | 2026-04-23 | 2026-05-23 | closed ✅ | @Coder-FE |

### Shared 模块

| ID | 文件 | 失败数（估） | 登记日期 | 偿还截止日 | 状态 | 责任人 |
|----|------|-------------|---------|-----------|------|--------|
| TD-2026-013 | auth-form.component.spec.ts | ~10 / 0 (已通过) | 2026-04-23 | 2026-05-23 | closed ✅ | @Coder-FE |

## 合计

- **总债务数**: 13 条 (已偿还 10 条)
- **总失败测试数**: ~147 (Auth模块已全部偿还, Booking模块已全部偿还)
- **计划偿还截止日**: 2026-05-23
- **Auth模块偿还结果**: 2026-04-24 完成。146 tests 全部通过 (54+44+24+9+15)，114个失败测试已修复。
- **Booking模块偿还结果**: 2026-04-24 完成。126 tests 全部通过 (37+27+34+7+19)，29个失败测试已修复。

## 状态颜色说明

| 状态 | 含义 |
|------|------|
| open | 未开始修复 |
| in_progress | 正在修复中 |
| verified | @Guardian 已验证通过 |
| closed | 已关闭（技术债已偿清） |
| overdue | 已超期（自动触发 P0 强制修复） |
