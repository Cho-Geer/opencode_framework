# SF项目执行规则框架 v2.0

Salesforce项目专用规则，配合通用项目执行规则框架v3.0使用。聚焦SF专有MCP检查、Apex/LWC/SOQL验证和迁移规范。

---

## SF核心原则

1. **SF MCP绝对强制**：SF技术任务必须首先调用SF DX MCP工具，禁止基于记忆/过时文档
2. **完整记录**：所有SF DX MCP调用必须有完整记录
3. **阻塞性执行**：MCP失败后完成处理前严禁后续SF任务
4. **最新信息优先**：SF分析前必须MCP获取最新官方指导

---

## SF专用MCP检查

### 身份验证（阻塞性）
- [ ] `get_username` 确认组织身份验证 | `list_all_orgs` 验证组织配置

### 开发指导
- [ ] `get_mobile_lwc_offline_guidance` LWC移动兼容性 | `guide_utam_generation` UI测试自动化

### 迁移专项（迁移项目必须）
- [ ] `deploy_metadata` 元数据部署 | `retrieve_metadata` 元数据检索
- [ ] `create_org_snapshot` 环境快照 | `run_soql_query` 数据迁移可行性

### Apex开发验证
- [ ] SOQL注入防护：绑定变量或`escapeSingleQuotes()` | CRUD/FLS检查：对象字段级访问控制
- [ ] 共享规则：`with sharing`/`without sharing` | 批量优化：批量Apex最佳实践
- [ ] 查询选择性：SOQL足够选择性 | 循环优化：避免循环内SOQL/DML
- [ ] 测试覆盖率：>=75% | 错误处理：try-catch和日志

### LWC移动兼容性
- [ ] 避免`lwc:if`/`lwc:elseif`/`lwc:else`（移动不兼容）
- [ ] 提取内联GraphQL到独立getter | 验证移动离线场景

---

## SF迁移检查清单

- [ ] 确认源/目标组织配置 | 验证用户名/别名/权限 | 识别元数据依赖 | 评估API版本差异
- [ ] 确定增量/全量部署策略 | 制定冲突解决流程 | 准备回滚方案 | 按依赖确定部署顺序
- [ ] 设计字段映射 | 确定Data Loader/SOQL/ETL | 数据清洗转换规则 | 一致性完整性验证
- [ ] Apex测试>=75%（建议>=85%） | 集成测试+UTAM自动化 | 迁移后性能评估

---

## SF MCP工具矩阵

| 工具 | 用途 | 输出 |
|------|------|------|
| `get_username` | 组织用户名 | 用户名列表 |
| `list_all_orgs` | 列出组织 | 组织状态 |
| `deploy_metadata` | 部署元数据 | 部署结果 |
| `retrieve_metadata` | 检索元数据 | 元数据 |
| `create_scratch_org` | 创建临时组织 | 创建状态 |
| `create_org_snapshot` | 创建快照 | 快照信息 |
| `run_soql_query` | SOQL查询 | 查询结果 |
| `get_mobile_lwc_offline_guidance` | LWC移动指导 | 结构化指导 |
| `guide_utam_generation` | UTAM测试指导 | 生成流程 |

---

## 版本历史
- **v2.0** (2026-04-04): 重构为通用框架SF补充 | **v1.0** (2026-04-04): 初始版本

---
**本文件为SF专用补充，必须配合通用框架v3.0使用。**
