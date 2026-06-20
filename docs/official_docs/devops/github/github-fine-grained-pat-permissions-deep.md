# GitHub Fine-grained PAT — 深度知识文档

> **Source**: webfetch (docs.github.com + github.com)
> **Fetched**: 2026-06-20
> **Domain**: devops_ci — GitHub Fine-grained PAT
> **URLs**:
>
> - https://docs.github.com/en/rest/overview/permissions-required-for-fine-grained-personal-access-tokens
> - https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens
> - https://docs.github.com/en/rest/overview/troubleshooting#resource-not-accessible
> - https://docs.github.com/en/organizations/managing-programmatic-access-to-your-organization/reviewing-and-revoking-personal-access-tokens-in-your-organization
> - https://docs.github.com/en/graphql/guides/forming-calls-with-graphql
> - https://github.com/actions/add-to-project

---

## 目录

1. [X-Accepted-GitHub-Permissions 响应头详解](#1-x-accepted-github-permissions-响应头详解)
2. [常见 PAT 错误排查 — "Resource not accessible"](#2-常见-pat-错误排查--resource-not-accessible)
3. [404 Not Found 错误（私有资源认证问题）](#3-404-not-found-错误私有资源认证问题)
4. [Fine-grained PAT 组织审批流程](#4-fine-grained-pat-组织审批流程)
5. [Fine-grained PAT 权限优先级规则](#5-fine-grained-pat-权限优先级规则)
6. [GraphQL API 与 Fine-grained PAT](#6-graphql-api-与-fine-grained-pat)
7. [Fine-grained PAT 的局限性（Limitations）](#7-fine-grained-pat-的局限性limitations)
8. [Token 安全最佳实践](#8-token-安全最佳实践)
9. [REST API 端点与权限映射导引](#9-rest-api-端点与权限映射导引)
10. [organization_projects 与 add-to-project Action](#10-organization_projects-与-add-to-project-action)

---

## 1. X-Accepted-GitHub-Permissions 响应头详解

### 1.1 基本概念

当使用 Fine-grained PAT 或 GitHub App 调用 REST API 时，如果返回**权限不足**的错误，响应头 `X-Accepted-GitHub-Permissions` 会告知调用该端点所需的精确权限和访问级别。

### 1.2 响应头格式

```
X-Accepted-GitHub-Permissions: contents=read
```

权限之间有逗号分隔，表示需要**同时拥有**这些权限：

```
X-Accepted-GitHub-Permissions: pull_requests=write, contents=read
```

### 1.3 多选一权限

某些端点支持从多组权限中选择任意一组。这种情况下，多组权限间用**分号**分隔：

```
X-Accepted-GitHub-Permissions: pull_requests=read,contents=read; issues=read,contents=read
```

上述示例含义：Token 需要**要么** `pull_requests:read + contents:read`，**要么** `issues:read + contents:read`。

### 1.4 使用场景

当调试 "Resource not accessible by personal access token" 错误时：

```bash
curl -I -H "Authorization: Bearer YOUR_FINE_GRAINED_PAT" \
  https://api.github.com/repos/owner/repo/issues

# 如果权限不足，响应中会包含：
# X-Accepted-GitHub-Permissions: issues=read
```

这告诉你需要在 Token 设置中添加 `issues:read` 权限。

### 1.5 多权限类型

| 权限组合方式   | 语法                       | 示例                                       |
| -------------- | -------------------------- | ------------------------------------------ |
| 单权限         | `permission=level`         | `contents=read`                            |
| 多权限（AND）  | `perm1=level, perm2=level` | `pull_requests=write,contents=read`        |
| 多组可选（OR） | `group1; group2`           | `contents=read; issues=read,contents=read` |

---

## 2. 常见 PAT 错误排查 — "Resource not accessible"

### 2.1 "Resource not accessible by personal access token" 错误

**原因**: Fine-grained PAT 没有足够的权限来访问指定的端点。

**排查步骤**:

1. **检查响应头 `X-Accepted-GitHub-Permissions`**:

   ```bash
   curl -sI -H "Authorization: Bearer YOUR_TOKEN" https://api.github.com/...
   # 查看 X-Accepted-GitHub-Permissions 响应头
   ```

2. **检查 Token 权限**:
   - 访问 GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens
   - 编辑 Token 并检查已授予的权限

3. **验证资源所有者**:
   - Token 指定的资源所有者必须与目标资源的所有者匹配
   - 例如：Token 指定了 Organization A，但尝试访问 Organization B 的资源

4. **检查仓库访问权限**:
   - 如果 Token 设置为 "Only select repositories"，确保目标仓库在允许列表中

5. **检查 Token 是否过期或被撤销**:
   - GitHub 会在 1 年不使用后自动废弃 Token
   - 组织管理员可以撤销访问组织资源的 Token

### 2.2 Fine-grained PAT 常见排查清单

| 症状                      | 可能原因            | 解决方案                                      |
| ------------------------- | ------------------- | --------------------------------------------- |
| `Resource not accessible` | 权限不足            | 根据 `X-Accepted-GitHub-Permissions` 添加权限 |
| `404 Not Found`           | 认证问题或 URL 错误 | 验证 Token 认证、检查 URL 拼写                |
| `403 Forbidden`           | 速率限制或权限不足  | 检查 `x-ratelimit-remaining` 头               |
| Token 显示为 `pending`    | 组织审批未通过      | 等待组织管理员审批                            |
| `401 Bad credentials`     | Token 无效或过期    | 重新生成 Token                                |

---

## 3. 404 Not Found 错误（私有资源认证问题）

### 3.1 关键行为

GitHub REST API 对**私有资源**的未认证访问返回 `404 Not Found` 而非 `403 Forbidden`。这是为了防止泄露私有仓库的存在。

### 3.2 排查步骤

如果确定资源存在但返回 404：

1. **Classic PAT 用户**:
   - Token 是否有所需的 scope？
   - Token 所有者是否拥有所需权限？
   - Token 是否过期或被撤销？

2. **Fine-grained PAT 用户**:
   - Token 是否有所需权限？（查看端点文档）
   - 资源所有者是否匹配？
   - Token 是否能访问目标私有仓库？
   - Token 所有者是否拥有所需权限（如仅组织所有者可用的端点）？
   - Token 是否过期或被撤销？

3. **其他检查**:
   - URL 中是否有多余的尾部斜杠？
   - 路径参数是否进行了 URL 编码（如 `/` → `%2F`）？

---

## 4. Fine-grained PAT 组织审批流程

### 4.1 流程概述

组织（Organization）可以要求对能访问组织资源的 Fine-grained PAT 进行审批。这是 Fine-grained PAT 相比 Classic PAT 的重要安全优势。

### 4.2 创建需要审批的 Token

1. 用户在创建 Fine-grained PAT 时选择组织作为资源所有者
2. 如果组织启用了审批策略，用户需要输入申请理由（justification）
3. Token 创建后将显示为 `pending` 状态
4. Token 在审批前**只能读取公开资源**

### 4.3 组织管理员的审批操作

1. 进入组织 → Settings → Personal access tokens → Active tokens
2. 查看所有能访问组织资源的 Fine-grained PAT
3. 点击 Token 名称查看详细权限
4. 可以使用筛选条件过滤：
   - **Owner**: 按 Token 创建者筛选
   - **Repository**: 按仓库访问权限筛选
   - **Permissions**: 按权限筛选
5. **审批**: Token 自动获得访问（或管理员手动批准）
6. **撤销**: 点击 "Revoke" 按钮撤销 Token 的访问
7. **批量撤销**: 选择多个 Token → 点击 "Revoke..."

### 4.4 撤销后的影响

- SSH 密钥仍可继续工作
- Token 仍可读取组织的公开资源
- Token 创建者会收到邮件通知

### 4.5 审批策略配置位置

组织所有者可以在组织 Settings → Personal access tokens 中设置策略：

- 允许/禁止 Fine-grained PAT
- 允许/禁止 Classic PAT
- 设置最大生命周期策略

### 4.6 REST API 管理

组织所有者也可以通过 REST API 查看和撤销 Fine-grained PAT，但这些端点**只能用 GitHub App 调用**，不能用 PAT 或 OAuth App 调用。

---

## 5. Fine-grained PAT 权限优先级规则

### 5.1 访问级别层次

```
admin (管理)
  └── write (写入)     ← 自动包含 read
       └── read (读取) ← 最低级别
```

- **Read**: 读取资源信息，无修改能力
- **Write**: 读取和修改资源（**自动包含 Read**）
- **Admin**: 完全的读取、修改和管理控制（**自动包含 Write + Read**）

### 5.2 多权限组合

当端点需要多个权限时，Token **必须同时拥有**所有这些权限。例如：

- `X-Accepted-GitHub-Permissions: pull_requests=write,contents=read`
  → Token 需要 `pull_requests:write` **AND** `contents:read`

### 5.3 多选一权限组

某些端点允许从多组权限中选择一组。在这种情况下，Token 只需满足**其中一组**的所有权限要求：

```
X-Accepted-GitHub-Permissions: pull_requests=read,contents=read; issues=read,contents=read
```

→ 只要满足第 1 组 `pull_requests:read + contents:read` **或** 第 2 组 `issues:read + contents:read` 即可。

### 5.4 资源所有者隔离

- Fine-grained PAT **只能访问单个资源所有者**（用户或组织）的资源
- Token 不能同时访问多个组织
- 如果需要访问多个组织的资源，必须创建多个 Token 或使用 GitHub App

### 5.5 Token 权限与用户权限的关系

Token 的权限不能超过 Token 所有者的权限。例如：

- 如果用户不是组织所有者，即使 Token 有 `administration:write` 权限，也不能执行组织所有者才能执行的操作
- Token 权限是对用户权限的**进一步限制**，而不是扩展

---

## 6. GraphQL API 与 Fine-grained PAT

### 6.1 认证方式

GraphQL API 使用与 REST API 相同的认证机制：

```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -X POST -d '{ "query": "query { viewer { login } }" }' \
  https://api.github.com/graphql
```

GraphQL 端点是固定的：`https://api.github.com/graphql`

### 6.2 Fine-grained PAT 的 GraphQL 权限要求

Fine-grained PAT 的权限在 GraphQL 和 REST API 之间**基本一致**。例如：

- 读取 Issues → 需要 `issues:read`
- 创建 Issue → 需要 `issues:write`
- 读取仓库 → 需要 `contents:read`（会自动包含 `metadata:read`）
- 添加 React 到 Issue → 需要 `issues:write`

### 6.3 GraphQL 特有权限注意事项

1. **查询（Query）**：类似 REST GET，需要对应资源的 Read 权限
2. **变更（Mutation）**：类似 REST POST/PATCH/DELETE，需要对应资源的 Write 权限
3. 所有 Fine-grained PAT 自动拥有公开仓库的只读访问权限
4. Classic PAT 需要 `public_repo` scope 来访问公开仓库

### 6.4 GraphQL 中的 Projects 操作

```graphql
# 添加 Issue/PR 到 Project
mutation {
  addProjectV2ItemById(
    input: { projectId: "PROJECT_ID", contentId: "CONTENT_ID" }
  ) {
    item {
      id
    }
  }
}
```

需要权限：

- `organization_projects:write`（组织 Project）或 Project 对应的仓库级权限

### 6.5 错误处理

如果 Fine-grained PAT 权限不足，GraphQL API 会返回：

```json
{
  "data": null,
  "errors": [
    {
      "type": "FORBIDDEN",
      "path": ["repository"],
      "message": "Resource not accessible by personal access token"
    }
  ]
}
```

此时需要检查 Token 的权限设置。

---

## 7. Fine-grained PAT 的局限性（Limitations）

| 局限性        | 说明                                       | 当前状态        |
| ------------- | ------------------------------------------ | --------------- |
| 公开仓库贡献  | 不能用于非所属成员的非组织公开仓库         | GitHub 正在解决 |
| 外部协作者    | 外部协作者（Outside Collaborator）无法使用 | GitHub 正在解决 |
| 多组织访问    | 单 Token 不能同时访问多个组织              | GitHub 正在解决 |
| Packages 访问 | 不能访问 Packages                          | GitHub 正在解决 |
| Checks API    | 不能调用 Checks API                        | GitHub 正在解决 |
| 用户 Projects | 不能访问用户账户拥有的 Projects            | GitHub 正在解决 |

**替代方案**：在这些场景下，需要使用 Classic PAT 或 GitHub App。

---

## 8. Token 安全最佳实践

1. **使用 Fine-grained PAT 代替 Classic PAT** — 提供更细粒度的权限控制
2. **最小权限原则** — 只授予 Token 完成任务所需的最少权限
3. **设置过期时间** — 避免创建永不过期的 Token
4. **使用 GITHUB_TOKEN 代替** — 在 GitHub Actions 工作流中优先使用内置的 GITHUB_TOKEN
5. **存储为 Secret** — 将 Token 存储在 GitHub Secrets 中，而不是硬编码在代码里
6. **定期审查** — 组织管理员定期审查 Active tokens 列表
7. **自动废弃** — GitHub 会在 Token 1 年未使用后自动废弃
8. **创建数量限制** — 每个用户最多可创建 50 个 Fine-grained PAT

---

## 9. REST API 端点与权限映射导引

### 9.1 如何查找端点所需权限

1. 查看端点的 API 文档页
2. 文档会标明是否需要 Fine-grained PAT 认证
3. 如果返回权限不足，检查 `X-Accepted-GitHub-Permissions` 响应头

### 9.2 常用操作权限速查

| 操作                 | 所需权限                           | 级别  |
| -------------------- | ---------------------------------- | ----- |
| 查看仓库代码         | `contents`                         | Read  |
| 推送代码             | `contents`                         | Write |
| 创建 Issue           | `issues`                           | Write |
| 查看/搜索 Issues     | `issues`                           | Read  |
| 创建 PR              | `pull_requests`                    | Write |
| 审查/合并 PR         | `pull_requests`                    | Write |
| 查看 Actions 状态    | `actions`                          | Read  |
| 触发/取消工作流      | `actions`                          | Write |
| 管理 Secrets         | `secrets`                          | Write |
| 创建/更新工作流文件  | `workflows`                        | Write |
| 管理 Webhook         | `repository_hooks`                 | Write |
| 管理部署             | `deployments`                      | Write |
| 查看 Dependabot 告警 | `vulnerability_alerts`             | Read  |
| 管理组织成员         | `members`                          | Write |
| 管理组织 Projects    | `organization_projects`            | Write |
| 管理组织 Secrets     | `organization_secrets`             | Write |
| 管理组织 Runner      | `organization_self_hosted_runners` | Write |
| 查看组织成员         | `members`                          | Read  |
| 管理仓库设置         | `administration`                   | Write |
| 管理分支保护         | `administration`                   | Write |

### 9.3 常见端点权限参考

| REST API 端点                                             | 所需权限         | 级别  | 备注                   |
| --------------------------------------------------------- | ---------------- | ----- | ---------------------- |
| `GET /repos/{owner}/{repo}`                               | `metadata`       | Read  | 自动拥有               |
| `GET /repos/{owner}/{repo}/issues`                        | `issues`         | Read  |                        |
| `POST /repos/{owner}/{repo}/issues`                       | `issues`         | Write |                        |
| `GET /repos/{owner}/{repo}/pulls`                         | `pull_requests`  | Read  |                        |
| `POST /repos/{owner}/{repo}/pulls`                        | `pull_requests`  | Write |                        |
| `GET /repos/{owner}/{repo}/actions/runs`                  | `actions`        | Read  |                        |
| `POST /repos/{owner}/{repo}/actions/runs/{run_id}/cancel` | `actions`        | Write |                        |
| `GET /repos/{owner}/{repo}/contents/{path}`               | `contents`       | Read  |                        |
| `PUT /repos/{owner}/{repo}/contents/{path}`               | `contents`       | Write |                        |
| `GET /repos/{owner}/{repo}/actions/secrets`               | `secrets`        | Read  | 只能看到名称，不暴露值 |
| `PUT /repos/{owner}/{repo}/actions/secrets/{name}`        | `secrets`        | Write |                        |
| `POST /orgs/{org}/repos`                                  | `administration` | Write | 组织级别               |
| `GET /orgs/{org}/members`                                 | `members`        | Read  | 组织级别               |
| `PUT /orgs/{org}/memberships/{username}`                  | `members`        | Write | 组织级别               |
| `PATCH /repos/{owner}/{repo}`                             | `administration` | Write | 更新仓库设置           |
| `POST /repos/{owner}/{repo}/branches/{branch}/protection` | `administration` | Write | 设置分支保护           |

### 9.4 完整端点-权限映射表

REST API 权限映射完整表（通过 `permissions-required-for-fine-grained-personal-access-tokens` 页面获取）包含了数十个组织级别和仓库级别的端点权限映射。

**组织级别权限覆盖以下类别**：

- API Insights, Administration, Agent secrets/variables, Blocking users, Campaigns, Copilot Spaces, Copilot agent settings, Copilot content exclusion, Custom org roles, Custom properties, Events, GitHub Copilot Business, Hosted runner images, Issue Fields/Types, Members, Network configurations, Organization metrics, Organization codespaces/secrets/settings, Organization dependabot secrets, Private registries, Projects, Secrets, Self-hosted runners, Variables, Webhooks

**仓库级别权限覆盖以下类别**：

- Actions, Administration, Agent secrets/variables, Artifact metadata, Attestations, Code quality, Code scanning alerts, Codespaces, Commit statuses, Contents, Custom properties, Dependabot alerts/secrets, Deployments, Discussions, Environments, Issues, Merge queues, Metadata, Pages, Pull requests, Repository advisories, Secret scanning alerts, Secrets, Variables, Webhooks, Workflows

---

## 10. organization_projects 与 add-to-project Action

### 10.1 `actions/add-to-project@vX` 官方 Action

GitHub 官方提供了 `actions/add-to-project` Action，用于自动将 Issue 或 PR 添加到 GitHub Projects（现代版本，非 Classic）。

**仓库**: https://github.com/actions/add-to-project
**最新版本**: v2.0.0 (2026-05-04)

#### 基本用法

```yaml
name: Add issue to project
on:
  issues:
    types:
      - opened
jobs:
  add-to-project:
    name: Add issue to project
    runs-on: ubuntu-latest
    steps:
      - uses: actions/add-to-project@v2
        with:
          project-url: https://github.com/orgs/<orgName>/projects/<projectNumber>
          github-token: ${{ secrets.ADD_TO_PROJECT_PAT }}
          labeled: bug, needs-triage
          label-operator: OR
```

#### Inputs 参数

| 参数             | 必需 | 说明                                                                                               |
| ---------------- | ---- | -------------------------------------------------------------------------------------------------- |
| `project-url`    | ✅   | GitHub Project 的 URL，格式：`https://github.com/orgs\|users/<ownerName>/projects/<projectNumber>` |
| `github-token`   | ✅   | 具有 `repo` 和 `project` 权限的 PAT                                                                |
| `labeled`        | ❌   | 逗号分隔的标签过滤列表                                                                             |
| `label-operator` | ❌   | 标签匹配方式：`AND`、`OR` 或 `NOT`（默认 `OR`）                                                    |

#### 支持的事件

- `issues`: `opened`, `reopened`, `transferred`, `labeled`
- `pull_request`: `opened`, `reopened`, `labeled`

#### 所需 Fine-grained PAT 权限

如果使用 Fine-grained PAT 作为 `github-token`，需要以下权限：

1. **Organization permissions** → `Projects` → `read & write`
2. **Repository permissions** → `Issues` → `read-only`
3. **Repository permissions** → `Pull requests` → `read-only`
4. 选择 Token 的资源和仓库范围

#### 标签过滤示例

**OR 模式**（默认）：只要匹配任一标签：

```yaml
labeled: bug, needs-triage
label-operator: OR
```

**AND 模式**：必须匹配所有标签：

```yaml
labeled: needs-review, size/XL
label-operator: AND
```

**NOT 模式**：排除含特定标签的 Issue/PR：

```yaml
labeled: bug, needs-triage
label-operator: NOT
```

#### 设置自定义状态列

Action 本身只负责将 Issue/PR 添加到 Project。要设置自定义状态列（如 "In Progress"），需要在 Project UI 中配置默认列：

- 打开 Project → 菜单 → Workflows
- 配置 "When items are added to project" 自动设置状态

---

> **参考来源**:
>
> - https://docs.github.com/en/rest/overview/permissions-required-for-fine-grained-personal-access-tokens
> - https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens
> - https://docs.github.com/en/rest/overview/troubleshooting
> - https://docs.github.com/en/organizations/managing-programmatic-access-to-your-organization/reviewing-and-revoking-personal-access-tokens-in-your-organization
> - https://docs.github.com/en/graphql/guides/forming-calls-with-graphql
> - https://github.com/actions/add-to-project
