---
type: model_decision
description: Only relevant during skill invocation
---

# Skill调用合规指南

## Skill调用自检清单
- [ ] 已查阅`.qoder/rules/rule_detail/skill-invocation-standard.md`中的"已注册Skill清单"
- [ ] 已识别任务类型和关键词，匹配触发关键词
- [ ] 已创建"计划调用的Skill清单"并向用户展示确认
- [ ] 按优先级顺序调用Skill（P0→P1→P2）

## Skill调用运行时检查
- 开始任何任务：先规划并展示Skill调用计划
- 调用Skill：验证符合`.qoder/rules/rule_detail/skill-invocation-standard.md`中的流程要求
- 添加新Skill：必须使用skill-creator Skill并更新`.qoder/rules/rule_detail/skill-invocation-standard.md`

## Skill调用违规预防模式
1. 先规划后执行：任何任务开始前必须先展示Skill调用计划
2. 查阅`.qoder/rules/rule_detail/skill-invocation-standard.md`优先：这是所有任务的第一步
3. Skill必须注册：所有Skill必须在`.qoder/rules/rule_detail/skill-invocation-standard.md`中注册
4. 透明化监督：任务前展示计划，让用户监督

