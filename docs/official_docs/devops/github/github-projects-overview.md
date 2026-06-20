# GitHub Projects — 完整概念详解

> **Source**: webfetch (docs.github.com)
> **Fetched**: 2026-06-19
> **Domain**: devops_ci — GitHub Projects
> **URLs**: https://docs.github.com/en/issues/planning-and-tracking-with-projects/

## 概述

GitHub Projects（项目）是一个**可适配、灵活的项目规划和跟踪工具**，与 GitHub 上的 Issues（议题）和 Pull Requests（拉取请求）深度集成。它提供了表格（Table）、看板（Board）和路线图（Roadmap）三种视图布局，支持通过筛选、排序、分组和切片来定制视图。

Projects 不是传统的项目管理工具——它**以 Issue 和 PR 为数据源**，通过双向同步保持信息一致。

---

## 1. GitHub Projects 的 Item（项目项）定义

### Item 的三种类型

| Item 类型                    | 来源                | 生命周期            | 特性                                                                   |
| ---------------------------- | ------------------- | ------------------- | ---------------------------------------------------------------------- |
| **Issue（议题）**            | 仓库中的 Issue      | 与仓库 Issue 同步   | 有标题、描述、标签、指派对象、里程碑等                                 |
| **Pull Request（拉取请求）** | 仓库中的 PR         | 与仓库 PR 同步      | 有标题、描述、审查状态、CI 状态等                                      |
| **Draft Issue（草稿议题）**  | 仅在 Project 内创建 | 仅存在于 Project 中 | 有标题、正文、可指派对象和自定义字段；不会触发通知；可转换为正式 Issue |

### 关键约束

- 一个 Project **最多包含 50,000 个 Item**（包括活跃视图和存档页）
- 每个 Item 可以有最多 **50 个字段**（包括内置字段和自定义字段）
- Item 通过 `content{...}` GraphQL 联合类型区分：`DraftIssue`、`Issue`、`PullRequest`

### GraphQL Item 查询示例

```graphql
query {
  node(id: "PROJECT_ID") {
    ... on ProjectV2 {
      items(first: 20) {
        nodes {
          id
          content {
            ... on DraftIssue {
              title
              body
            }
            ... on Issue {
              title
              assignees(first: 10) {
                nodes {
                  login
                }
              }
            }
            ... on PullRequest {
              title
              assignees(first: 10) {
                nodes {
                  login
                }
              }
            }
          }
        }
      }
    }
  }
}
```

---

## 2. Item 与 Issue、Pull Request 的关系

### 关系本质

| 方面         | 说明                                                                       |
| ------------ | -------------------------------------------------------------------------- |
| **引用关系** | Item 是 Project 中的"容器"，Issue/PR 作为 `content` 被引用到 Item 中       |
| **双向同步** | Project 中修改字段 → Issue/PR 同步更新；Issue/PR 中修改 → Project 自动同步 |
| **独立存在** | Issue 和 PR 可以**不属于任何 Project**，它们独立存在于仓库中               |
| **多对多**   | **一个 Issue/PR 可以同时属于多个不同的 Project**                           |
| **删除影响** | 从 Project 中删除 Item → **不会删除** Issue/PR（仅移除引用）               |

### 同步机制

- **双向自动同步**：当你在 Project 中更改 Issue/PR 的字段（如指派对象），Issue/PR 也会反映该更改
- **事件记录**：当 Issue/PR 被添加/移除/状态变更时，Issue/PR 的时间线（Timeline）中会添加事件记录
- **权限**：Timeline 事件仅对至少有 Project 读取权限的人可见

### 例外字段

⚠️ 以下字段是 Issue/PR 的属性，**不能**通过 `updateProjectV2ItemFieldValue` 修改：

- `Assignees`（指派对象）
- `Labels`（标签）
- `Milestone`（里程碑）
- `Repository`（仓库）

这些字段必须使用专门的 Mutations（如 `addAssigneesToAssignable`、`addLabelsToLabelable` 等）。

---

## 3. Issue 和 PR 如何关联到 Project

### 方法 A：从 Project 中添加（多种方式）

1. **URL 粘贴**：在 Project 底部的行中输入 Issue/PR 的 URL，按 Enter
2. **搜索添加**：键入 `#` 选择仓库，然后搜索 Issue/PR
3. **批量添加**：点击 `+` → "Add item from repository" → 选择多个 Issue/PR
4. **命令行**：按 `Cmd+K`（Mac）或 `Ctrl+K`（Win）打开命令面板

### 方法 B：从 Issue/PR 中添加

在 Issue 或 PR 页面的侧边栏中：

1. 点击 **Projects** 区域
2. 选择目标 Project
3. 可选：填充自定义字段

### 方法 C：从仓库 Issue/PR 列表中批量添加

1. 在仓库的 Issues 或 Pull requests 标签页
2. 勾选想要添加的条目
3. 点击顶部的 **Projects** 按钮
4. 选择目标 Project

### 方法 D：自动添加（内置 Workflow）

配置内置 Workflow：

1. 进入 Project → 菜单 → **Workflows**
2. 启用 "When issues or pull requests from a repository match a filter"
3. 设置筛选条件（如 `label:bug`）
4. 当 Issue/PR 匹配条件时，自动添加到 Project

### 方法 E：通过 GitHub Actions 自动添加

```yaml
name: Add PR to project
on:
  pull_request:
    types: [ready_for_review]
jobs:
  track_pr:
    runs-on: ubuntu-latest
    steps:
      - name: Generate token
        id: generate-token
        uses: actions/create-github-app-token@v3
        with:
          client-id: ${{ vars.APP_CLIENT_ID }}
          private-key: ${{ secrets.APP_PRIVATE_KEY }}

      - name: Add PR to project
        env:
          GH_TOKEN: ${{ steps.generate-token.outputs.token }}
          PR_ID: ${{ github.event.pull_request.node_id }}
        run: |
          gh api graphql -f query='
            mutation($project:ID!, $pr:ID!) {
              addProjectV2ItemById(input: {projectId: $project, contentId: $pr}) {
                item { id }
              }
            }' -f project=$PROJECT_ID -f pr=$PR_ID
```

### 方法 F：通过 GraphQL API 编程添加

```graphql
mutation {
  addProjectV2ItemById(
    input: {
      projectId: "PROJECT_ID"
      contentId: "CONTENT_ID" # Issue 或 PR 的 Node ID
    }
  ) {
    item {
      id
    }
  }
}
```

---

## 4. GitHub Project 和 Git Branch 的关系

### ⚠️ 核心结论：GitHub Projects 与 Git branches 之间没有直接关联

GitHub Projects **不直接管理或跟踪 Git 分支**。它们之间的关联是通过**中间层**间接实现的：

```
Git Branch → [Pull Request] → GitHub Project Item
                 或
Git Branch → [Issue] → GitHub Project Item
```

### 间接链路详解

| 链路                         | 步骤                                          | 说明                                         |
| ---------------------------- | --------------------------------------------- | -------------------------------------------- |
| **Branch → PR → Project**    | 1. 从分支创建 PR → 2. PR 添加到 Project       | 最常见的链路，通过 GitHub Actions 可自动完成 |
| **Branch → Issue → Project** | 1. 从分支关联 Issue → 2. Issue 添加到 Project | 分支名包含 Issue 编号时可自动关联            |

### 分支如何与 Project 关联（实际操作）

1. **在 Issue 中创建分支**：GitHub 允许从 Issue 页面直接创建分支，该分支会自动引用此 Issue
2. **PR 描述中引用 Issue**：PR 描述中使用 `Closes #123` 等关键词可关联 Issue
3. **GitHub Actions 自动添加**：通过 Actions 工作流，当 PR 被创建或标记为 ready_for_review 时自动将 PR 添加到 Project
4. **分支命名约定**：虽然 Project 不直接跟踪分支，但团队可以约定分支命名规范（如 `feature/PROJECT-123-description`）来手动关联

### 实际场景举例

```
你有一个 Feature Project "Opencode_framework Project"
  ↓
你在本地创建分支 fix-bug-001
  ↓
你提交代码并 push 到 GitHub
  ↓
你创建 Pull Request: fix-bug-001 → main
  ↓
[自动/手动] PR 被添加到 Opencode_framework Project 作为 Item
  ↓
PR 在 Project 中的状态字段（如 "In Progress"）被更新
  ↓
PR 合并后，Project Item 自动标记为 "Done"
```

---

## 5. 如何在本地 branch 提交代码后关联到远程 Project

### 分步指南

#### 前提条件

- 拥有目标 Project 的写入权限
- 拥有目标仓库的写入权限
- （推荐）配置了 GitHub Actions 自动添加工作流

#### 方案 A：通过 PR 自动关联（推荐）

```bash
# 1. 在本地 branch 上工作
git checkout -b my-feature-branch
git add .
git commit -m "feat: implement new feature"

# 2. push 到远程
git push -u origin my-feature-branch

# 3. 在 GitHub 上创建 Pull Request
#    (可以从 CLI 或 Web UI 创建)

# 4. PR 创建后，如果配置了 GitHub Actions 自动添加工作流：
#    PR 会自动成为 Project 的 Item
#    或者在 PR 侧边栏手动选择 Project

# 5. 当 PR 合并后，内置 Workflow 自动将状态设为 "Done"
```

#### 方案 B：手动关联（无自动化）

```
1. Push 分支到 GitHub
2. 创建 Pull Request 或 Issue
3. 打开目标 Project → 底部 + 号
4. 粘贴 Issue/PR 的 URL 或搜索添加
5. Item 会自动同步 Issue/PR 的变更
```

#### 方案 C：通过 `actions/add-to-project` 工作流（推荐方式）

在仓库的 `.github/workflows/` 中添加：

```yaml
name: Add issues and PRs to project
on:
  issues:
    types: [opened]
  pull_request:
    types: [opened]
jobs:
  add-to-project:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/add-to-project@v1
        with:
          project-url: https://github.com/orgs/YOUR_ORG/projects/YOUR_PROJECT_NUMBER
          github-token: ${{ secrets.ADD_TO_PROJECT_PAT }}
```

这样，**每次创建 Issue 或 PR 时，都会自动添加到指定的 Project**。

---

## 总结：核心概念关系图

```
┌──────────────────────────────────────────────┐
│              GitHub Repository                │
│  ┌──────────┐      ┌──────────────────┐      │
│  │  Issues  │      │  Pull Requests   │      │
│  └─────┬────┘      └────────┬─────────┘      │
│        │                    │                 │
│        └──────┬─────────────┘                 │
│               │                               │
│        引用为 content{}                        │
│               │                               │
│               ▼                               │
│  ┌──────────────────────────────────────┐    │
│  │       GitHub Project (V2)            │    │
│  │                                      │    │
│  │  Items:                              │    │
│  │  ┌────────┐ ┌────────┐ ┌──────────┐ │    │
│  │  │ Issue  │ │   PR   │ │ Draft    │ │    │
│  │  │ Item   │ │  Item  │ │ Issue    │ │    │
│  │  └────────┘ └────────┘ └──────────┘ │    │
│  │                                      │    │
│  │  字段系统:                            │    │
│  │  - 内置字段 (指派对象、标签等)         │    │
│  │  - 自定义字段 (日期、数字、单选、      │    │
│  │    文本、迭代)                        │    │
│  │                                      │    │
│  │  视图: Table / Board / Roadmap       │    │
│  └──────────────────────────────────────┘    │
│                                              │
│  Git Branches → 通过 PR 或 Issue 间接关联     │
│  (Branch → PR/Issue → Project Item)          │
└──────────────────────────────────────────────┘
```

### 快速问答

| 问题                                   | 答案                                                            |
| -------------------------------------- | --------------------------------------------------------------- |
| Project Item 有几种类型？              | 3 种：Issue、Pull Request、Draft Issue                          |
| Issue/PR 可以属于多个 Project 吗？     | 是的，一个 Issue/PR 可以同时属于多个 Project                    |
| 删除 Project Item 会删除 Issue/PR 吗？ | 不会，仅移除引用关系                                            |
| Project 直接关联 Git branch 吗？       | 不直接，通过 PR 或 Issue 间接关联                               |
| 如何在本地提交后关联到 Project？       | Push → 创建 PR → 通过 GitHub Actions 或手动将 PR 添加到 Project |
| 支持自动添加吗？                       | 是的，通过内置 Workflow 或 GitHub Actions                       |

---

> **参考来源**: GitHub 官方文档 — Issues → Planning and tracking with projects
> https://docs.github.com/en/issues/planning-and-tracking-with-projects
