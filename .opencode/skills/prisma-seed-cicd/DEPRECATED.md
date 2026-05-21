# DEPRECATED: prisma-seed-cicd

> **此 Skill 已被废弃，由 `cicd-database-seeding` 替代。**

- **废弃日期**: 2026-05-21
- **废弃原因**: 该 Skill 为 Prisma 特定实现。为提升框架通用性，已重命名为 `cicd-database-seeding` 并扩展为通用 CI/CD 数据库播种框架（支持 Prisma、TypeORM、Knex、Sequelize 等多 ORM）。Prisma 特化内容保留为新 Skill 的第二节。
- **废弃决定**: @Architect 于 2026-05-21 UNIV-P4-H 中执行重命名。@Arbiter 已批准（WV-2026-005 scope limitation）。
- **替代方案**: 使用 `cicd-database-seeding` Skill。新 Skill 保留了所有 Prisma 特定内容（Section 2），并新增了通用 CI/CD 数据库播种指导（Section 1）。
- **迁移说明**: 
  1. `coder-be.md` 中的 skill 引用已更新为 `cicd-database-seeding`
  2. `skill-invocation-standard.md` §3.1 中的条目已更新
  3. 旧文件保留作为参考，不会自动删除
- **关联文档**:
  - `TECH_DEBT_REGISTRY.md` § TD-2026-011
  - `.opencode/rules/rule_detail/skill-invocation-standard.md` §3.1
  - `.opencode/agents/coder-be.md`
