# DEPRECATED: nextjs-router-guardrails

> **此 Skill 已被废弃，通用路由守卫原则已合并至 `fullstack-ci-cd-guardrails`。**

- **废弃日期**: 2026-05-21
- **废弃原因**: 该 Skill 为 Next.js/React 特定实现（446 行），包含 Next.js Middleware、React HOC、Next.js `useRouter` 等框架绑定内容。为提升框架通用性，通用安全原则已被提取并合并到 `fullstack-ci-cd-guardrails` Skill 中。
- **废弃决定**: @Architect 于 2026-05-21 UNIV-P4-I 中执行废弃标记 + 原则提取。@Arbiter 已批准（WV-2026-005 scope limitation）。
- **替代方案**: 路由守卫的通用安全原则（分层防御、JWT 验证、安全头、匹配器优化）已合并至 `fullstack-ci-cd-guardrails` Skill §9 "Router Guardrails"。Next.js 特定代码示例保留在此文件中作为参考附录。
- **迁移说明**:
  1. 无需更新 agent 引用（无 agent 直接引用此 Skill）
  2. `skill-invocation-standard.md` §3.1 中的条目已更新为 ❌ 废弃
  3. 如需路由守卫指导，请使用 `fullstack-ci-cd-guardrails`
  4. 框架特定代码示例保留在此文件中供参考
- **关联文档**:
  - `TECH_DEBT_REGISTRY.md` § TD-2026-011
  - `.opencode/rules/rule_detail/skill-invocation-standard.md` §3.1
  - `.opencode/skills/fullstack-ci-cd-guardrails/SKILL.md` §9
