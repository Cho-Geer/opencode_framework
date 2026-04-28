---
name: "fullstack-ci-cd-guardrails"
description: "Enforces full-stack CI/CD best practices for Docker and GitHub Actions. Invoke when working with Docker images, GitHub Actions workflows, or deployment pipelines."
---

# 全栈项目 CI/CD 规范与问题防御指南

## 技能标识

- **名称**: `fullstack-ci-cd-guardrails`
- **适用场景**: 所有采用 Next.js + Node.js + Docker + GitHub Actions 的前后端分离项目
- **约束等级**: 🔴 **强制遵守**（违反将导致 CI 构建失败、镜像推送失败或部署验证异常）

---

## 1. 核心原则

1. **变量统一管理**：所有仓库的 Docker Hub 用户名、镜像前缀等非敏感配置必须通过 Repository Variable 统一管理，严禁硬编码。
2. **标签不可变优先**：生产部署必须使用不可变标签（commit SHA 或语义版本），开发环境可使用可变分支标签。
3. **环境隔离**：`dev` / `prod` 环境通过 GitHub Environments 和独立 Secrets 隔离，验证步骤不得依赖特定环境保护规则。
4. **测试真实性**：E2E 测试和镜像验证必须提供完整的运行时依赖（数据库、缓存、后端服务）。
5. **工作流健壮性**：所有变量使用前必须校验，矩阵策略默认关闭快速失败，登录步骤不得被 PR 事件跳过。

---

## 2. 仓库配置强制规范

### 2.1 Repository Variable（必须）

| 变量名 | 作用域 | 示例值 | 用途 |
| :--- | :--- | :--- | :--- |
| `DOCKER_HUB_USER` | All environments | `zhaogeyinzuo` | Docker Hub 命名空间，用于动态拼接镜像名 |

**禁止**在 `env` 中硬编码用户名，必须使用 `${{ vars.DOCKER_HUB_USER }}`。

### 2.2 GitHub Secrets（必须）

| Secret 名称 | 环境 | 用途 |
| :--- | :--- | :--- |
| `DOCKERHUB_USERNAME` | 仓库级 | Docker Hub 登录用户名 |
| `DOCKERHUB_TOKEN` | 仓库级 | Docker Hub 访问令牌（**只读**权限） |
| `DEV_POSTGRES_PASSWORD` | development | 开发环境数据库密码 |
| `DEV_DB_PASSWORD` | development | 后端连接开发数据库密码 |
| `DEV_JWT_SECRET` | development | 开发环境 JWT 签名密钥 |
| `DEV_JWT_REFRESH_SECRET` | development | 开发环境 JWT 刷新密钥 |
| `PROD_*` | production | 生产环境对应 Secrets |

**规则**：生产环境 Secrets 必须绑定 `production` 环境并配置审批者。

---

## 3. 镜像构建工作流强制规范（`*-image.yml`）

### 3.1 镜像命名与标签

```yaml
env:
  REGISTRY: docker.io
  IMAGE_NAME: docker.io/${{ vars.DOCKER_HUB_USER }}/<service-name>
```

**标签策略**：

```yaml
tags: |
  type=ref,event=branch
  type=ref,event=pr
  type=semver,pattern={{version}}
  type=semver,pattern={{major}}.{{minor}}
  type=sha,prefix={{branch}}-,enable=${{ github.event_name != 'pull_request' }}
  type=sha,prefix=sha-,enable=${{ github.event_name == 'pull_request' }}
  type=raw,value=latest,enable=${{ github.ref == 'refs/heads/master' }}
```

- PR 事件生成 `sha-abc123`，Push 事件生成 `develop-abc123`。
- **禁止**在 PR 事件下推送镜像，仅构建并加载到本地（`load: true`）。

### 3.2 登录 Docker Hub

```yaml
- name: Log in to Docker Hub
  uses: docker/login-action@v3
  with:
    username: ${{ secrets.DOCKERHUB_USERNAME }}
    password: ${{ secrets.DOCKERHUB_TOKEN }}
```

- **必须**无条件执行，不得使用 `if: github.event_name != 'pull_request'`。
- 使用**只读** Token，遵循最小权限原则。

### 3.3 变量校验步骤（必须）

在 `Set up Docker Buildx` 之后添加：

```yaml
- name: Validate required variables
  run: |
    if [ -z "${{ vars.DOCKER_HUB_USER }}" ]; then
      echo "❌ Error: DOCKER_HUB_USER variable is not set."
      exit 1
    fi
    echo "✅ DOCKER_HUB_USER is set to: ${{ vars.DOCKER_HUB_USER }}"
```

### 3.4 PR 阶段测试

- 必须启动临时 Postgres + Redis 服务。
- 使用本地构建的镜像进行健康检查。
- 不得依赖外部 Secrets，使用硬编码测试值（如 `test` / `test`）。

### 3.5 Push 阶段测试

- 从 Registry 拉取刚推送的镜像。
- 数据库连接可使用 Secrets，但必须确保值正确指向可访问的测试实例，或与 PR 测试保持一致。

---

## 4. 部署验证工作流强制规范（`verify-images.yml`）

### 4.1 矩阵策略

```yaml
strategy:
  fail-fast: false   # 一个环境失败不得取消其他环境
  matrix:
    environment: [dev, prod]
```

### 4.2 环境文件生成（必须）

所有 `.env` 文件不得提交到仓库，必须从 `.example` 动态生成。

```yaml
- name: Prepare environment files
  run: |
    COMPOSE_ENV_FILE="compose/${{ matrix.environment }}.compose.env"
    cp "${COMPOSE_ENV_FILE}.example" "${COMPOSE_ENV_FILE}"
    sed -i "s/{{DOCKER_HUB_USER}}/${{ vars.DOCKER_HUB_USER }}/g" "${COMPOSE_ENV_FILE}"
    # 根据环境注入 Secrets
    if [ "${{ matrix.environment }}" = "dev" ]; then
      sed -i "s/POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=${{ secrets.DEV_POSTGRES_PASSWORD }}/g" "${COMPOSE_ENV_FILE}"
      sed -i "s/dev-abc123def/develop/g" "${COMPOSE_ENV_FILE}"
    else
      sed -i "s/POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=${{ secrets.PROD_POSTGRES_PASSWORD }}/g" "${COMPOSE_ENV_FILE}"
      sed -i "s/main-abc123def/main/g" "${COMPOSE_ENV_FILE}"
    fi
```

### 4.3 示例文件中的占位符

`*.compose.env.example` 中必须使用 `{{DOCKER_HUB_USER}}` 占位符，**严禁**硬编码用户名。

```bash
BACKEND_IMAGE=docker.io/{{DOCKER_HUB_USER}}/booking-backend:dev-abc123def
```

### 4.4 验证脚本自愈能力

`verify-images.sh` 必须包含环境文件自动生成逻辑，若文件缺失则从 `.example` 复制并注入默认值。

---

## 5. 前端特定规范（Next.js Pages Router）

### 5.1 路由钩子安全使用

- **必须**从 `next/compat/router` 导入 `useRouter`。
- 访问 `router` 属性前**必须**使用可选链或空值检查。

```typescript
import { useRouter } from 'next/compat/router';

const router = useRouter();
const pathname = router?.pathname ?? '';
```

### 5.2 E2E 测试环境

- 必须配置 Redis 服务容器。
- 后端必须以 `NODE_ENV=development` 启动，并将验证码写入 Redis。
- 测试代码中必须设置 `E2E_REDIS_URL` 环境变量。

```yaml
services:
  redis:
    image: redis:7-alpine
    ports:
      - 6379:6379
```

### 5.3 Playwright 浏览器安装

```yaml
- name: Install Playwright browsers
  run: npx playwright install --with-deps chromium
```

### 5.4 PR 镜像测试

```yaml
- name: Build image (no push)
  uses: docker/build-push-action@v6
  with:
    context: .
    push: false
    tags: <service>:pr-test
    load: true   # 必须加载到 Docker 守护进程
```

---

## 6. 后端特定规范（NestJS + Prisma）

### 6.1 Prisma Seed 执行

- **必须**使用 `npx prisma db seed` 而非直接调用 `ts-node`。
- 在 `package.json` 中配置：

```json
"prisma": {
  "seed": "ts-node prisma/seed.ts"
}
```

### 6.2 迁移镜像独立构建

- 必须同时构建主镜像和迁移镜像，标签保持一致。

---

## 7. 验收检查清单

在合并任何 PR 前，必须确认以下项目全部通过：

| 检查项                   | 通过标准                                           |
| :-------------------- | :--------------------------------------------- |
| 所有变量校验步骤通过            | 日志显示 `✅ DOCKER_HUB_USER is set to: xxx`        |
| 镜像构建成功                | 无标签非法错误，`docker buildx` 完成                     |
| PR 阶段镜像测试通过           | 容器健康检查返回 200                                   |
| Push 阶段镜像推送成功         | Docker Hub 出现对应标签                              |
| `verify-images` 工作流全绿 | `dev` 和 `prod` 环境均显示 `✅ 所有镜像验证通过`              |
| 示例文件占位符正确             | `*.example` 中包含 `{{DOCKER_HUB_USER}}` 而非硬编码用户名 |
| E2E 测试通过              | Playwright 报告全部通过                              |

---

## 8. 常见错误快速索引

| 错误现象                                                  | 参考解决方案                             |
| :---------------------------------------------------- | :--------------------------------- |
| `Cannot find module './seed.ts'`                      | 改用 `npx prisma db seed`            |
| `NextRouter was not mounted`                          | 改用 `next/compat/router`            |
| `invalid tag "docker.io//xxx:pr-5"`                   | 校验 `DOCKER_HUB_USER` 变量存在且作用域为 All |
| `pull access denied`                                  | 确保 `docker/login-action` 无条件执行     |
| `Error: browserType.launch: Executable doesn't exist` | 安装 Playwright 浏览器                  |
| `Waiting for status to be reported`                   | 移除 job 级别 `environment` 或调整保护规则    |
| `fail-fast` 导致其他环境被取消                                 | 添加 `fail-fast: false`              |

---

## 验证机制

使用本技能时，必须验证：

1. **变量管理验证**：确认所有 Docker Hub 用户名通过 Repository Variable 管理
2. **标签策略验证**：确认镜像标签使用不可变标签（commit SHA 或语义版本）
3. **环境隔离验证**：确认 dev/prod 环境通过 GitHub Environments 隔离
4. **工作流健壮性验证**：确认变量校验步骤、fail-fast 配置、登录步骤配置正确
5. **测试真实性验证**：确认 E2E 测试和镜像验证提供完整的运行时依赖

---

## 强制约束

- **禁止**：在 `env` 中硬编码 Docker Hub 用户名
- **禁止**：在 PR 事件下推送镜像到 Docker Hub
- **禁止**：使用 `if: github.event_name != 'pull_request'` 跳过 Docker Hub 登录
- **必须**：所有变量使用前进行校验
- **必须**：矩阵策略默认关闭快速失败（`fail-fast: false`）
- **必须**：使用 `npx prisma db seed` 而非直接调用 `ts-node`
- **必须**：从 `next/compat/router` 导入 `useRouter`

---

## 集成点

本技能应与以下技能配合使用：
- `devops-ci-cd-guardrails`：确保 CI/CD 配置的可靠性
- `global-cicd-practices-enforcement`：强制执行 CI/CD 最佳实践
- `cross-directory-ci`：处理多目录 CI 执行环境
- `prisma-seed-cicd`：确保 Prisma seed 在 CI/CD 中正确执行
- `nextjs-router-guardrails`：确保 Next.js 路由安全实施

---

## 相关资源

- [Docker Buildx 文档](https://docs.docker.com/build/buildx/)
- [GitHub Actions Docker 文档](https://docs.docker.com/build/ci/github-actions/)
- [Next.js 官方文档](https://nextjs.org/docs)
- [Prisma 官方文档](https://www.prisma.io/docs)

---

**生效日期**: 2026-04-10
**维护团队**: DevOps / 前端架构组
**适用范围**: 所有 `booking-*` 仓库及新建项目
