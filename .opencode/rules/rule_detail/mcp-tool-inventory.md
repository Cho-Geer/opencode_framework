
# MCP工具清单与调用策略

**制定时间**: 2026-04-10  
**最后更新**: 2026-04-10  
**版本**: v1.2.1（修正章节编号，确保完整）

---

## 一、当前项目可用MCP工具清单

### 1.1 GitHub MCP工具集
| 工具名称 | 功能描述 | 适用场景 |
|---------|---------|---------|
| `mcp_GitHub_search_repositories` | 搜索GitHub仓库 | 查找参考项目、开源库 |
| `mcp_GitHub_get_file_contents` | 获取仓库文件内容 | 查看代码、配置文件 |
| `mcp_GitHub_create_issue` | 创建Issue | 问题跟踪、需求记录 |
| `mcp_GitHub_create_pull_request` | 创建PR | 代码变更提交 |
| `mcp_GitHub_list_commits` | 列出提交记录 | 查看变更历史 |
| `mcp_GitHub_list_issues` | 列出Issues | 项目管理 |
| `mcp_GitHub_update_issue` | 更新Issue | 状态变更 |
| `mcp_GitHub_add_issue_comment` | 添加Issue评论 | 讨论交流 |
| `mcp_GitHub_search_code` | 搜索代码 | 代码示例查找 |
| `mcp_GitHub_search_issues` | 搜索Issues | 问题查找 |
| `mcp_GitHub_search_users` | 搜索用户 | 协作者查找 |
| `mcp_GitHub_get_issue` | 获取Issue详情 | 问题详情查看 |
| `mcp_GitHub_get_pull_request` | 获取PR详情 | PR详情查看 |
| `mcp_GitHub_list_pull_requests` | 列出PRs | PR列表查看 |
| `mcp_GitHub_create_pull_request_review` | 创建PR评审 | 代码评审 |
| `mcp_GitHub_merge_pull_request` | 合并PR | 代码合并 |
| `mcp_GitHub_get_pull_request_files` | 获取PR变更文件 | 变更文件查看 |
| `mcp_GitHub_get_pull_request_status` | 获取PR状态 | PR状态检查 |
| `mcp_GitHub_update_pull_request_branch` | 更新PR分支 | 分支同步 |
| `mcp_GitHub_get_pull_request_comments` | 获取PR评论 | 评审讨论查看 |
| `mcp_GitHub_get_pull_request_reviews` | 获取PR评审 | 评审结果查看 |

### 1.2 Context7 MCP工具
| 工具名称 | 功能描述 | 适用场景 |
|---------|---------|---------|
| `mcp_context7_resolve-library-id` | 解析库ID | 获取技术栈库信息 |
| `mcp_context7_query-docs` | 查询文档 | 获取最新技术文档 |

### 1.3 Pandoc MCP工具
| 工具名称 | 功能描述 | 适用场景 |
|---------|---------|---------|
| `mcp_Pandoc_convert-contents` | 转换文档格式 | Markdown↔PDF↔DOCX等 |

### 1.4 Playwright MCP工具
| 工具名称 | 功能描述 | 适用场景 |
|---------|---------|---------|
| Playwright MCP Server | 浏览器自动化、UI测试 | 浏览器操作、UI测试自动化 |

### 1.5 Salesforce DX MCP工具
| 工具名称 | 功能描述 | 适用场景 |
|---------|---------|---------|
| Salesforce DX MCP | Salesforce项目开发、Apex/LWC开发 | Salesforce项目、元数据部署、SOQL查询 |

### 1.6 Docker MCP工具
| 工具名称 | 功能描述 | 适用场景 |
|---------|---------|---------|
| `mcp_docker_list_containers` | 列出容器 | 查看运行中的容器 |
| `mcp_docker_create_container` | 创建容器 | 创建新容器 |
| `mcp_docker_run_container` | 运行容器 | 启动容器 |
| `mcp_docker_recreate_container` | 重建容器 | 重新创建容器 |
| `mcp_docker_start_container` | 启动容器 | 启动已停止的容器 |
| `mcp_docker_fetch_container_logs` | 获取容器日志 | 查看容器日志 |
| `mcp_docker_stop_container` | 停止容器 | 停止运行中的容器 |
| `mcp_docker_remove_container` | 删除容器 | 删除容器 |
| `mcp_docker_list_images` | 列出镜像 | 查看本地镜像 |
| `mcp_docker_pull_image` | 拉取镜像 | 从仓库拉取镜像 |
| `mcp_docker_push_image` | 推送镜像 | 推送镜像到仓库 |
| `mcp_docker_build_image` | 构建镜像 | 构建Docker镜像 |
| `mcp_docker_remove_image` | 删除镜像 | 删除本地镜像 |
| `mcp_docker_list_networks` | 列出网络 | 查看Docker网络 |
| `mcp_docker_create_network` | 创建网络 | 创建Docker网络 |
| `mcp_docker_remove_network` | 删除网络 | 删除Docker网络 |
| `mcp_docker_list_volumes` | 列出卷 | 查看Docker卷 |
| `mcp_docker_create_volume` | 创建卷 | 创建Docker卷 |
| `mcp_docker_remove_volume` | 删除卷 | 删除Docker卷 |

### 1.7 PostgreSQL MCP工具
| 工具名称 | 功能描述 | 适用场景 |
|---------|---------|---------|
| `mcp_PostgreSQL_query` | 执行SQL查询 | 数据库查询、数据分析 |

### 1.9 Compliance-Gate MCP工具
| 工具名称 | 功能描述 | 适用场景 |
|---------|---------|---------|
| `compliance_gate_check` | 任务执行前合规门禁检查，验证规则合规、MCP准备、Skill调用要求；自动生成per-session session_id | 所有任务执行前强制调用（P0阻塞） |
| `compliance_gate_confirm` | 用户确认后锁定合规门禁状态，标记任务计划已获批准；需传入session_id | 用户确认任务计划后调用，解锁任务执行 |
| `compliance_gate_complete` | 任务执行完成后关闭合规门禁会话，输出审计摘要；需传入session_id | 任务执行完成后强制调用（P0阻塞），产生审计记录 |

### 1.10 Keystone Validate MCP工具
| 工具名称 | 功能描述 | 适用场景 |
|---------|---------|---------|
| `keystone_validate` | 执行Keystone全量校验：契约哈希、任务生命周期证据、TDD合规性、合规门禁状态。读取`.opencode/state/machine.json`作为单数据源，返回结构化PASS/FAIL报告 | 多Agent系统内任意Agent在提交或完成阶段调用；CI管道中替代pre-commit hook |
| CLI: `npm run keystone:validate` | 同上，支持`--pre-commit`/`--audit`/`--ci`三种模式 | 开发者在提交前手动检查；CI脚本中调用 |

### 1.8 Task Agent工具（技术栈专家）
| 工具名称 | 功能描述 | 适用场景 |
|---------|---------|---------|
| `Task(search)` | 搜索代理 | 代码库搜索、文档查找 |
| `Task(salesforce-dx-expert)` | Salesforce DX专家 | Salesforce项目开发、Apex/LWC开发、CI/CD配置、部署故障排除 |
| `Task(devops-architect)` | DevOps架构师 | CI/CD管道设计、GitOps工作流、容器化应用、云原生基础设施架构设计 |
| `Task(playwright-mcp-expert)` | Playwright MCP专家 | Playwright MCP Server配置、LLM浏览器自动化、连接问题排除、元素定位策略优化 |

---

## 二、MCP工具调用策略

### 2.1 按任务类型选择MCP工具

| 任务类型 | 优先MCP工具 | 次要MCP工具 |
|---------|------------|------------|
| **技术栈咨询** | Context7 MCP | GitHub Search |
| **代码开发** | Context7 MCP, Task(search) | GitHub MCP |
| **CI/CD配置** | Task(devops-architect) | GitHub MCP |
| **GitHub操作** | GitHub MCP | - |
| **Docker/容器化** | Docker MCP | Task(devops-architect) |
| **数据库查询** | PostgreSQL MCP | - |
| **文档转换** | Pandoc MCP | - |
| **Salesforce开发** | Salesforce DX MCP | GitHub MCP |
| **DevOps/CI/CD** | Task(devops-architect) | Docker MCP, GitHub MCP |
| **UI测试/浏览器自动化** | Playwright MCP | - |

### 2.2 阻塞性MCP调用清单

以下MCP调用为阻塞性，必须成功完成才能进入下一阶段：

| 任务阶段 | 阻塞性MCP调用 | 失败处理 |
|---------|-------------|---------|
| **环境验证** | 依赖检查、版本验证 | 重试3次 → 官方文档替代 |
| **技术栈确认** | Context7查询最新文档 | 重试3次 → 使用已知最佳实践 |
| **安全扫描** | 依赖漏洞扫描 | 重试3次 → 记录风险继续 |
| **合规门禁（前）** | `compliance_gate_check` + `compliance_gate_confirm` | 阻塞，未通过不得进行任何任务执行 |
| **合规门禁（后）** | `compliance_gate_complete` | 阻塞，未完成不得标记任务结束 |

---

## 三、MCP调用最佳实践

### 3.1 调用前检查
- [ ] 确认MCP工具可用性
- [ ] 准备必要的参数
- [ ] 规划失败处理策略
- [ ] 使用TodoWrite跟踪状态

### 3.2 调用中执行
- [ ] 按优先级顺序调用
- [ ] 阻塞性调用先执行
- [ ] 完整记录调用输出
- [ ] 实时更新TodoWrite状态

### 3.3 调用后处理
- [ ] 解析MCP输出关键信息
- [ ] 应用MCP指导到决策
- [ ] 记录决策依据
- [ ] 归档MCP调用记录

---

## 四、MCP工具扩展指南

### 4.1 添加新MCP工具
1. 在本文档"一、当前项目可用MCP工具清单"中添加对应表格
2. 更新"二、MCP工具调用策略"中的映射关系
3. 添加调用示例和最佳实践

### 4.2 更新现有MCP工具
1. 更新工具功能描述
2. 调整适用场景
3. 更新调用策略

---

## 五、失败处理流程

```
MCP调用失败
    ↓
记录失败详情和时间戳
    ↓
立即暂停所有后续任务
    ↓
尝试重试（最多3次，每次间隔≥30秒）
    ↓
重试成功？ → 是 → 继续执行
    ↓ 否
启动官方文档替代方案评估
    ↓
记录替代理由和风险评估
    ↓
标记MCP项为"已通过替代方案解决"
    ↓
恢复任务执行
```

---

*本文档将根据MCP工具变化持续更新。*

