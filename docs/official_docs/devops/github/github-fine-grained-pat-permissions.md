# GitHub Fine-grained Personal Access Token (PAT) — 完整权限文档

> **Source**: webfetch (docs.github.com)
> **Fetched**: 2026-06-19
> **Domain**: devops_ci — GitHub
> **URLs**:
>
> - https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens
> - https://docs.github.com/en/rest/overview/permissions-required-for-fine-grained-personal-access-tokens

## 目录

1. [Fine-grained PAT 概述](#1-fine-grained-pat-概述)
2. [Fine-grained PAT vs Classic PAT 对比](#2-fine-grained-pat-vs-classic-pat-对比)
3. [Fine-grained PAT 的限制](#3-fine-grained-pat-的限制)
4. [权限的作用范围分类](#4-权限的作用范围分类)
5. [Repository 级别权限完整列表](#5-repository-级别权限完整列表)
6. [Organization 级别权限完整列表](#6-organization-级别权限完整列表)
7. [Account 级别权限完整列表](#7-account-级别权限完整列表)
8. [权限的访问级别说明](#8-权限的访问级别说明)

---

## 1. Fine-grained PAT 概述

Fine-grained Personal Access Token（细粒度个人访问令牌）是 GitHub 推荐的认证方式，用于替代 Personal Access Token (Classic)。它具有以下安全优势：

- **资源隔离**：每个 Token 仅限访问单个用户或组织拥有的资源
- **仓库限制**：可进一步限制仅访问特定仓库
- **细粒度权限**：授予特定、细粒度的权限，比 Classic PAT 的作用域（scopes）提供更多控制
- **组织审批**：组织所有者可以要求对能访问组织资源的 Fine-grained PAT 进行审批

### 创建限额

每个用户最多可创建 **50 个 Fine-grained PAT**。如需更多 Token，建议使用 GitHub App。

### Token 预填充 URL

可以通过 URL 参数预填充 Token 创建表单：

```
https://github.com/settings/personal-access-tokens/new
  ?name=Repo-reading+token
  &description=Just+contents:read
  &target_name=octodemo
  &expires_in=45
  &contents=read
```

支持的查询参数：

| 参数           | 类型           | 说明                                    |
| -------------- | -------------- | --------------------------------------- |
| `name`         | string         | Token 显示名称（≤40字符，URL编码）      |
| `description`  | string         | Token 描述（≤1024字符，URL编码）        |
| `target_name`  | string         | 资源所有者（用户或组织 slug）           |
| `expires_in`   | integer/`none` | 到期天数（1-366），或 `none` 表示不过期 |
| `<permission>` | string         | 权限和访问级别（如 `contents=read`）    |

---

## 2. Fine-grained PAT vs Classic PAT 对比

| 特性                  |        Fine-grained PAT        |      Classic PAT       |
| --------------------- | :----------------------------: | :--------------------: |
| **安全性**            |    ✅ 更高 — 细粒度权限控制    | ⚠️ 较低 — 宽泛的作用域 |
| **资源范围**          |         单个用户或组织         | 所有可访问的组织和仓库 |
| **仓库限制**          |         可选择特定仓库         |    授予所有仓库访问    |
| **权限粒度**          | 细粒度权限（Read/Write/Admin） |     粗粒度 Scopes      |
| **组织审批**          |         组织可要求审批         |       无审批机制       |
| **公开仓库写入**      |  ❌ 不支持（非所属组织成员）   |        ✅ 支持         |
| **外部协作者**        |           ❌ 不支持            |        ✅ 支持         |
| **多组织访问**        |   ❌ 不支持（单Token单组织）   |        ✅ 支持         |
| **Packages 访问**     |           ❌ 不支持            |        ✅ 支持         |
| **Checks API**        |           ❌ 不支持            |        ✅ 支持         |
| **用户账户 Projects** |           ❌ 不支持            |        ✅ 支持         |
| **过期策略**          |       支持，可设置无限期       |   支持，可设置无限期   |
| **自动废弃**          |       1年未使用自动移除        |   1年未使用自动移除    |

---

## 3. Fine-grained PAT 的限制

以下是 Fine-grained PAT 当前不支持的功能（GitHub 正在逐步解决）：

1. 在非所属成员的非组织公开仓库中贡献
2. 外部协作者（Outside Collaborator）或仓库协作者访问
3. 同时访问多个组织
4. 访问 Packages
5. 调用 Checks API
6. 访问用户账户拥有的 Projects

---

## 4. 权限的作用范围分类

Fine-grained PAT 的权限按作用范围分为三类：

| 范围             | 适用条件                 | 说明                     |
| ---------------- | ------------------------ | ------------------------ |
| **Repository**   | 用户和组织资源所有者     | 控制仓库级资源的访问     |
| **Organization** | 仅组织资源所有者         | 控制组织级资源的访问     |
| **Account**      | 仅当前用户作为资源所有者 | 控制用户账户级资源的访问 |

---

## 5. Repository 级别权限完整列表

Repository 权限适用于用户和组织两种资源所有者。

| 权限名称（参数名）             | 显示名称                       |  访问级别   | 控制的 API/功能                                |
| ------------------------------ | ------------------------------ | :---------: | ---------------------------------------------- |
| `actions`                      | Actions                        | Read, Write | 管理 GitHub Actions 工作流运行、artifact、缓存 |
| `administration`               | Administration                 | Read, Write | 仓库管理设置、分支保护、Runner管理             |
| `artifact_metadata`            | Artifact metadata              | Read, Write | Artifact 元数据管理                            |
| `attestations`                 | Attestations                   | Read, Write | 构建来源认证                                   |
| `code_quality`                 | Code quality                   | Read, Write | 代码质量管理、设置                             |
| `security_events`              | Code scanning alerts           | Read, Write | Code scanning 告警                             |
| `codespaces`                   | Codespaces                     | Read, Write | Codespaces 管理                                |
| `codespaces_lifecycle_admin`   | Codespaces lifecycle admin     | Read, Write | Codespaces 生命周期管理                        |
| `codespaces_metadata`          | Codespaces metadata            |    Read     | Codespaces 元数据只读                          |
| `codespaces_secrets`           | Codespaces secrets             |    Write    | Codespaces 密钥管理                            |
| `statuses`                     | Commit statuses                | Read, Write | 提交状态管理                                   |
| `contents`                     | Contents                       | Read, Write | 仓库内容（代码、文件、releases等）             |
| `repository_custom_properties` | Custom properties              | Read, Write | 仓库自定义属性                                 |
| `vulnerability_alerts`         | Dependabot alerts              | Read, Write | Dependabot 告警                                |
| `dependabot_secrets`           | Dependabot secrets             | Read, Write | Dependabot 密钥                                |
| `deployments`                  | Deployments                    | Read, Write | 部署管理                                       |
| `discussions`                  | Discussions                    | Read, Write | 讨论管理                                       |
| `environments`                 | Environments                   | Read, Write | 环境管理                                       |
| `issues`                       | Issues                         | Read, Write | Issue 管理                                     |
| `merge_queues`                 | Merge queues                   | Read, Write | 合并队列                                       |
| `metadata`                     | Metadata                       |    Read     | 仓库元数据只读（所有Token自带此权限）          |
| `pages`                        | Pages                          | Read, Write | GitHub Pages                                   |
| `pull_requests`                | Pull requests                  | Read, Write | Pull Request 管理                              |
| `repository_advisories`        | Repository security advisories | Read, Write | 仓库安全通告                                   |
| `secret_scanning_alerts`       | Secret scanning alerts         | Read, Write | Secret scanning 告警                           |
| `secrets`                      | Secrets                        | Read, Write | Actions 密钥                                   |
| `actions_variables`            | Variables                      | Read, Write | Actions 变量                                   |
| `repository_hooks`             | Webhooks                       | Read, Write | 仓库 Webhook                                   |
| `workflows`                    | Workflows                      |    Write    | GitHub Actions 工作流文件（仅Write）           |

### 常用 Repository 权限详解

#### `contents` — 仓库内容

- **Read**: 查看仓库代码、文件列表、下载 releases
- **Write**: Push 代码、创建/发布 releases、管理标签

#### `issues` — Issue

- **Read**: 查看、搜索 Issues
- **Write**: 创建、编辑、关闭、分配 Issues

#### `pull_requests` — Pull Request

- **Read**: 查看、搜索 PRs
- **Write**: 创建、审查、合并 PRs

#### `actions` — Actions

- **Read**: 查看工作流运行状态、日志
- **Write**: 触发、取消、重新运行工作流、删除 artifacts

#### `secrets` — 密钥

- **Read**: 查看密钥名称（不暴露值）
- **Write**: 创建、更新、删除 Actions 密钥

#### `metadata` — 元数据

- **Read-only**: 查看仓库基本信息、可见性、主题。**所有 Token 自动拥有此权限**。

#### `workflows` — 工作流文件

- **Write-only**: 在 `.github/workflows/` 目录中创建或更新 GitHub Actions 工作流文件

---

## 6. Organization 级别权限完整列表

Organization 权限仅当资源所有者是组织时可用。

| 权限名称（参数名）                              | 显示名称                                          |      访问级别      | 控制的 API/功能                |
| ----------------------------------------------- | ------------------------------------------------- | :----------------: | ------------------------------ |
| `organization_api_insights`                     | API Insights                                      |        Read        | API 使用情况统计数据           |
| `organization_administration`                   | Administration                                    |    Read, Write     | 组织设置管理、规则集、安全配置 |
| `organization_user_blocking`                    | Blocking users                                    |    Read, Write     | 组织级别用户屏蔽               |
| `organization_campaigns`                        | Campaigns                                         |    Read, Write     | 活动管理                       |
| `organization_custom_org_roles`                 | Custom organization roles                         |    Read, Write     | 自定义组织角色                 |
| `organization_custom_properties`                | Custom repository properties                      | Read, Write, Admin | 自定义仓库属性                 |
| `organization_custom_roles`                     | Custom repository roles                           |    Read, Write     | 自定义仓库角色                 |
| `organization_events`                           | Events                                            |        Read        | 组织事件                       |
| `organization_copilot_seat_management`          | GitHub Copilot Business                           |    Read, Write     | Copilot 席位管理               |
| `issue_types`                                   | Issue Types                                       |    Read, Write     | Issue 类型管理                 |
| `organization_knowledge_bases`                  | Knowledge bases                                   |    Read, Write     | 知识库管理                     |
| `members`                                       | Members                                           |    Read, Write     | 组织成员、团队、邀请管理       |
| `organization_models`                           | Models                                            |        Read        | AI 模型访问                    |
| `organization_network_configurations`           | Network configurations                            |    Read, Write     | 网络配置                       |
| `organization_announcement_banners`             | Organization announcement banners                 |    Read, Write     | 组织公告横幅                   |
| `organization_codespaces`                       | Organization Codespaces                           |    Read, Write     | 组织 Codespaces                |
| `organization_codespaces_secrets`               | Organization Codespaces secrets                   |    Read, Write     | 组织 Codespaces 密钥           |
| `organization_codespaces_settings`              | Organization Codespaces settings                  |    Read, Write     | 组织 Codespaces 设置           |
| `organization_dependabot_secrets`               | Organization Dependabot secrets                   |    Read, Write     | 组织 Dependabot 密钥           |
| `organization_code_scanning_dismissal_requests` | Organization dismissal requests for code scanning |    Read, Write     | Code scanning 驳回请求         |
| `organization_private_registries`               | Organization private registries                   |    Read, Write     | 私有注册表                     |
| `organization_plan`                             | Plan                                              |        Read        | 组织计划信息                   |
| `organization_projects`                         | Projects                                          | Read, Write, Admin | 组织 Projects（beta）          |
| `organization_secrets`                          | Secrets                                           |    Read, Write     | 组织 Actions 密钥              |
| `organization_self_hosted_runners`              | Self-hosted runners                               |    Read, Write     | 自托管 Runner 组管理           |
| `team_discussions`                              | Team discussions                                  |    Read, Write     | 团队讨论                       |
| `organization_actions_variables`                | Variables                                         |    Read, Write     | 组织 Actions 变量              |
| `organization_hooks`                            | Webhooks                                          |    Read, Write     | 组织 Webhook                   |

### 常用 Organization 权限详解

#### `members` — 成员管理

- **Read**: 查看组织成员列表、团队信息
- **Write**: 添加/移除成员、管理团队、发送邀请

#### `organization_secrets` — 组织密钥

- **Read**: 查看密钥名称
- **Write**: 创建、更新、删除组织级 Actions 密钥

#### `organization_self_hosted_runners` — 自托管 Runner

- **Read**: 查看 Runner 列表和状态
- **Write**: 创建/删除 Runner 组、注册/移除 Runner

#### `organization_projects` — 项目

- **Read**: 查看组织项目
- **Write**: 创建/编辑项目
- **Admin**: 完全管理控制

---

## 7. Account 级别权限完整列表

Account 权限仅当当前用户是资源所有者时可用。

| 权限名称（参数名）            | 显示名称                |  访问级别   | 控制的 API/功能                   |
| ----------------------------- | ----------------------- | :---------: | --------------------------------- |
| `blocking`                    | Block another user      | Read, Write | 用户屏蔽                          |
| `codespaces_user_secrets`     | Codespaces user secrets | Read, Write | Codespaces 用户密钥               |
| `copilot_messages`            | Copilot Chat            |    Read     | Copilot Chat 消息                 |
| `copilot_editor_context`      | Copilot Editor Context  |    Read     | Copilot 编辑器上下文              |
| `copilot_requests`            | Copilot requests        |    Write    | Copilot 请求（消耗 premium 配额） |
| `emails`                      | Email addresses         | Read, Write | 邮箱地址管理                      |
| `user_events`                 | Events                  |    Read     | 用户事件                          |
| `followers`                   | Followers               | Read, Write | 关注者管理                        |
| `gpg_keys`                    | GPG keys                | Read, Write | GPG 密钥管理                      |
| `gists`                       | Gists                   |    Write    | Gist 创建                         |
| `keys`                        | Git SSH keys            | Read, Write | Git SSH 密钥管理                  |
| `interaction_limits`          | Interaction limits      | Read, Write | 交互限制                          |
| `knowledge_bases`             | Knowledge bases         | Read, Write | 知识库                            |
| `user_models`                 | Models                  |    Read     | AI 模型访问                       |
| `plan`                        | Plan                    |    Read     | 用户计划信息                      |
| `profile`                     | Profile                 |    Write    | 用户个人资料编辑                  |
| `git_signing_ssh_public_keys` | SSH signing keys        | Read, Write | SSH 签名密钥                      |
| `starring`                    | Starring                | Read, Write | Star 管理                         |
| `watching`                    | Watching                | Read, Write | Watch 管理                        |

### 常用 Account 权限详解

#### `gists` — Gist

- **Write-only**: 创建 Gist（匿名 Gist 不需要此权限）

#### `profile` — 个人资料

- **Write-only**: 更新用户个人资料信息

#### `plan` — 计划

- **Read-only**: 查看用户账户计划信息

---

## 8. 权限的访问级别说明

### 访问级别层次

```
admin (管理)
  └── write (写入)
       └── read (读取)
```

- **Read**: 读取资源信息，无修改能力
- **Write**: 读取和修改资源（自动包含 Read）
- **Admin**: 完全的读取、修改和管理控制（自动包含 Write + Read）

### 权限的可用访问级别矩阵

|        级别        | 说明         |                           适用权限数量                           |
| :----------------: | ------------ | :--------------------------------------------------------------: |
|        Read        | 仅可读取     |                       少数（metadata 等）                        |
|       Write        | 仅可写入     |               少数（workflows, gists, profile 等）               |
|    Read, Write     | 可选择读或写 |                              大多数                              |
| Read, Write, Admin | 完整控制     | 少数（organization_projects, organization_custom_properties 等） |

### X-Accepted-GitHub-Permissions Header

当使用 Fine-grained PAT 调用 REST API 时，如果权限不足，响应头 `X-Accepted-GitHub-Permissions` 会告知调用该端点所需的权限。例如：

```
X-Accepted-GitHub-Permissions: contents=read, issues=write
```

---

## 附录：常见场景 Token 创建示例

### 场景 1：读取仓库代码

```
name=Repo-reading+token&contents=read
```

### 场景 2：推送代码到仓库

```
name=Repo-writing+token&contents=write
```

### 场景 3：完整开发流程（写代码 + 创建 PR + 运行 Actions）

```
name=Core-loop+token&contents=write&pull_requests=write&workflows=write
```

### 场景 4：管理组织 Copilot 许可证

```
name=Copilot+admin+token&organization_copilot_seat_management=write
```

### 场景 5：GitHub Models API 调用

```
name=GitHub+Models+token&user_models=read
```

---

> **参考来源**: GitHub 官方文档 — Authentication & REST API
> https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens
> https://docs.github.com/en/rest/overview/permissions-required-for-fine-grained-personal-access-tokens
