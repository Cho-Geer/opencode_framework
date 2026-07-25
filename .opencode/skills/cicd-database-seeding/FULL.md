---
name: "cicd-database-seeding"
description: "Provides validated solutions for executing database seed scripts in CI/CD environments, preventing common module resolution and path errors. Invoke when working with database seeding (Prisma, TypeORM, Knex, etc.) in CI/CD pipelines."
---

# SKILL: 在 CI/CD 环境中正确执行数据库种子脚本

## 技能概述

在 CI/CD 管道（如 GitHub Actions）中执行数据库种子脚本时，可能遭遇模块解析失败、路径错误、执行上下文偏差等问题。这些问题通常源于 `ts-node` 等工具的项目根目录自动探测偏差、CI 文件系统结构差异、或 ORM 特定配置缺失。

本技能提供跨 ORM/跨数据库的通用指导原则（Section 1），以及 Prisma 特定的经过验证的解决方案（Section 2），确保种子脚本在任何 CI 环境中稳定执行。

---

## Section 1: 通用 CI/CD 数据库种子原则

### 1.1 核心原则

1. **优先使用 ORM 内置种子命令**：各 ORM（Prisma `db seed`、TypeORM `migration:run --seed`、Knex `seed:run`）提供的内置种子命令通常已正确处理执行上下文和模块解析，优先于直接调用底层运行时。
2. **工作目录必须为项目根目录**：种子脚本的执行上下文应为包含 `package.json` 和 ORM 配置文件的目录，不应在子目录（如 `prisma/`、`migrations/`）下执行。
3. **环境变量隔离**：数据库连接字符串（`DATABASE_URL`、`DB_HOST`）必须存储在 CI Secrets 中，不得硬编码于工作流文件或种子脚本中。
4. **幂等性设计**：种子脚本应支持重复执行，通过 `UPSERT`、`ON CONFLICT DO NOTHING` 等机制避免重复插入数据。

### 1.2 通用检查清单 `[VERIFICATION]`

在 CI/CD 中配置数据库种子步骤时，请验证：

> **本清单是 `[VERIFICATION]`**--每项检查必须实际运行命令并引用输出。「SQL 语句看起来对」不是验证。

| 检查项 | 验证方法 |
| :--- | :--- |
| ORM CLI 可用 | CI 步骤中添加 `npx <orm-cli> --version` |
| 配置文件存在 | `ls -la <orm-config-file>`（如 `prisma/schema.prisma`、`ormconfig.json`） |
| 数据库可访问 | 确认 CI 服务容器（Postgres/MySQL）已启动并监听正确端口 |
| 种子文件存在 | `ls -la <seed-directory>/` |
| 环境变量正确 | `echo "DB_HOST=${{ secrets.DB_HOST }}"`（避免打印密码） |

### 1.3 常见错误模式与通用解决方案

| 错误模式 | 通用根因 | 通用解决方案 |
| :--- | :--- | :--- |
| `Cannot find module '<seed-file>'` | 运行时模块解析根目录偏差 | 使用 ORM 内置命令；或显式指定 `--project tsconfig.json` |
| `Connection refused` | 数据库服务未就绪 | 添加 `wait-for-it` 或 health check 步骤 |
| `Migration pending` | 种子执行前未运行迁移 | 先执行 `migrate deploy` / `migration:run` |
| `Duplicate entry` | 种子脚本非幂等 | 使用 `UPSERT` 或先清理再插入 |
| `Permission denied` | CI runner 文件权限问题 | 确保 `chmod +x` 或使用容器内执行 |

### 1.4 多 ORM 参考配置

#### TypeORM
```yaml
- name: Run database seeds
  working-directory: ./backend
  run: npx typeorm migration:run && npx ts-node src/seeds/index.ts
```

#### Knex.js
```yaml
- name: Run database seeds
  working-directory: ./backend
  run: npx knex seed:run
```

#### Sequelize
```yaml
- name: Run database seeds
  working-directory: ./backend
  run: npx sequelize-cli db:seed:all
```

---

## Section 2: Prisma 特定种子执行方案

### 2.1 适用场景

- 前后端分离的 Monorepo 或独立仓库，在 CI 中需要拉取后端代码并执行数据库初始化。
- 使用 `ts-node` 直接运行 TypeScript 编写的 Prisma 种子文件。
- CI 运行环境为 Node.js v18+，特别是 v22+。

### 2.2 问题根因

`ts-node` 在启动时会尝试自动探测项目的 `tsconfig.json` 位置以确定 TypeScript 项目根目录。在某些 CI 文件系统结构或 Node.js 版本（如 v22）下，该自动探测逻辑可能发生偏差：

- 它从入口文件 `prisma/seed.ts` 所在的 `backend/prisma` 目录开始向上查找 `tsconfig.json`。
- 由于权限、符号链接或内部解析逻辑变更，查找过程可能异常终止于 `backend/prisma` 而非正确的 `backend/`。
- 后续所有相对路径解析均基于 `backend/prisma`，导致寻找 `prisma/seed.ts` 时实际路径变为 `backend/prisma/prisma/seed.ts`，从而抛出 `MODULE_NOT_FOUND`。

**关键证据**（来自错误堆栈）：
```
Require stack:
- /home/runner/work/.../backend/prisma/imaginaryUncacheableRequireResolveScript
```

### 2.3 推荐解决方案

#### ✅ 方案一：使用 Prisma 内置 Seed 命令（强烈推荐）

通过 Prisma CLI 的 `db seed` 命令执行种子脚本，Prisma 会正确处理执行上下文，规避 `ts-node` 的路径解析缺陷。

##### 配置步骤

1. **在 `backend/package.json` 中添加 `prisma.seed` 字段**：
   ```json
   {
     "prisma": {
       "seed": "ts-node prisma/seed.ts"
     }
   }
   ```

2. **在 CI 工作流中执行**：
   ```yaml
   - name: Prisma seed
     working-directory: ./backend
     run: npx prisma db seed
   ```

##### 优点

- 与 Prisma 官方推荐方式一致，未来兼容性好。
- 无需直接调用 `ts-node`，避免环境相关怪癖。
- 可与其他 Prisma 命令（`migrate deploy`、`generate`）统一管理。

#### ✅ 方案二：显式指定 `tsconfig.json` 项目路径

如果因特殊原因必须直接使用 `ts-node`，可以通过 `--project` 参数强制指定 TypeScript 项目根目录。

```yaml
- name: Prisma seed
  working-directory: ./backend
  run: npx ts-node --project tsconfig.json prisma/seed.ts
```

##### 说明

- `--project tsconfig.json` 告诉 `ts-node` 将当前工作目录（`backend/`）视为 TypeScript 项目根目录，跳过不可靠的自动探测。
- 此方法同样适用于本地开发或 Docker 容器内执行。

### 2.4 避免的错误配置

| ❌ 错误配置 | 后果 |
| :--- | :--- |
| 将 `working-directory` 设为 `./backend/prisma` 并执行 `npm run prisma:seed` | 路径基准错误，找不到 `seed.ts` |
| 直接执行 `npx ts-node prisma/seed.ts` 而不指定 `--project` | 可能触发自动探测失败 |
| 在 CI 中拉取不包含 `seed.ts` 的错误分支（注意 `ref` 配置） | 文件真实缺失，报错与路径无关 |

### 2.5 调试检查清单

如果问题仍然出现，请按以下顺序排查：

1. **确认文件存在性**  
   在 CI 步骤中添加 `ls -la backend/prisma/` 验证 `seed.ts` 是否被正确检出。

2. **确认 `prisma.seed` 配置**  
   检查 `backend/package.json` 中是否包含正确的 `prisma.seed` 字段。

3. **确认 Node.js 版本**  
   `node -v` 若为 v22+，考虑降级至 v20 进行测试（仅作为临时规避）。

4. **添加调试日志**  
   ```yaml
   - name: Debug ts-node project resolution
     working-directory: ./backend
     run: npx ts-node --show-config prisma/seed.ts
   ```
   观察输出的 `tsconfig.json` 路径是否正确指向 `backend/tsconfig.json`。

5. **检查 `tsconfig.json` 中的模块解析配置**  
   确保 `moduleResolution` 设置为 `"node"` 或 `"bundler"`，且 `esModuleInterop` 为 `true`。

---

## 验证机制

使用本技能时，必须验证：

1. **配置验证**：`package.json` 中存在正确的种子配置（如 `prisma.seed`）
2. **执行验证**：CI 步骤使用 ORM 内置种子命令（如 `npx prisma db seed`）
3. **路径验证**：`working-directory` 设置为项目根目录（如 `./backend`）
4. **调试验证**：当问题出现时，按检查清单步骤排查

## 强制约束

- **禁止**直接在 ORM 配置子目录（如 `backend/prisma`）下执行种子脚本
- **禁止**不指定 `--project` 参数直接使用 `ts-node` 执行 TypeScript 种子文件
- **必须**使用 ORM 内置种子命令作为首选方案
- **必须**确保 CI 拉取的分支包含完整的种子文件
- **必须**将数据库敏感信息存储在 CI Secrets 中

## 集成点

本技能应与以下技能配合使用：
- `cross-directory-ci`：处理多目录 CI 执行环境
- `devops-ci-cd-guardrails`：确保 CI/CD 配置的可靠性
- `global-cicd-practices-enforcement`：强制执行 CI/CD 最佳实践

## 相关资源

- [Prisma 官方文档：Seeding](https://www.prisma.io/docs/orm/prisma-migrate/workflows/seeding)
- [TypeORM 官方文档：Migrations](https://typeorm.io/migrations)
- [Knex.js 官方文档：Seeds](https://knexjs.org/guide/migrations.html#seed-files)
- [ts-node 项目根目录探测逻辑说明](https://github.com/TypeStrong/ts-node#help-my-types-are-missing)
