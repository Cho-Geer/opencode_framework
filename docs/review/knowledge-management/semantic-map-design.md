# knowledge_semantic_map Design v1.0

**Date**: 2026-06-05
**Phase**: UC7KS Phase 1 — Foundation (Task UC7-P1-T06)
**Source**: `uc7ks-design-analysis-v1.6.md` §10.3
**Status**: Design Document

---

## 1. Overview

The `knowledge_semantic_map` replaces the static `context7_task_mapping` in `project.config.json` with a **parameterized, stack-agnostic semantic map**. It maps task keywords to knowledge domains, Context7 library IDs, and fallback URL patterns — all using template variables for portability across tech stacks.

## 2. Location

Add to `.opencode/project.config.json` as a top-level key:

```json
{
  "project": { ... },
  "tech_stack": { ... },
  "template_resolution": { ... },
  "knowledge_semantic_map": {
    "domains": [ ... ]
  }
}
```

## 3. Domain Schema

```json
{
  "domain_id": "backend_api",
  "description": "Backend API and server-side development",
  "keywords": ["controller", "endpoint", "guard", "middleware", "swagger", "dto", "api", "service", "module", "interceptor", "pipe", "filter"],
  "context7_libraries": ["{backend.framework}"],
  "fallback_pattern": "https://{backend.framework}.dev/docs/{topic}",
  "scout_repos": ["https://github.com/{backend.framework}/{backend.framework}"],
  "save_path": "backend/{backend.framework}/",
  "ttl_days": 30
}
```

## 4. Complete Domain Map

| domain_id | Keywords | Context7 Libraries | Fallback Pattern | Save Path |
|-----------|----------|-------------------|------------------|-----------|
| `backend_api` | controller, endpoint, guard, middleware, swagger, dto, api, service, module, interceptor, pipe, filter, nestjs, express, fastify | `{backend.framework}` | `https://{backend.framework}.dev/docs/{topic}` | `backend/{backend.framework}/` |
| `persistence` | database, prisma, schema, migration, transaction, sql, orm, typeorm, sequelize, knex, seed | `{db.orm}` | `https://{db.orm}.io/docs/{topic}` | `backend/{db.orm}/` |
| `frontend_ui` | component, template, signal, store, style, css, tailwind, angular, react, vue, svelte, routing, lazy, defer | `{frontend.framework}`, `{frontend.ui_library}` | `https://{frontend.framework}.io/docs/{topic}` | `frontend/{frontend.framework}/` |
| `caching` | cache, redis, ioredis, ttl, cache-aside, memcached | `{cache.engine}` | `https://redis.io/docs/{topic}` | `database/redis/` |
| `queue` | queue, bullmq, job, worker, scheduler, rabbitmq, kafka | `{queue.engine}` | `https://docs.bullmq.io/{topic}` | `devops/{queue.engine}/` |
| `testing` | test, jest, spec, coverage, e2e, playwright, vitest, pytest, cypress | `{testing.unit}`, `{testing.e2e}` | `https://jestjs.io/docs/{topic}` | `devops/testing/` |
| `auth_security` | auth, jwt, passport, oauth, guard, token, refresh, csrf, rate-limit, helmet | `{auth.mechanism}` | `https://jwt.io/docs/{topic}` | `backend/auth/` |
| `framework_tools` | eslint, prettier, typescript, hook, plugin, config, linter, formatter, tsc | `/eslint/eslint`, `/typescript/typescript` | `https://{tool}.docs.domain/{topic}` | `framework/{tool}/` |
| `devops_ci` | docker, compose, github-actions, ci, cd, pipeline, deploy, workflow, container | `/docker/docker`, `/github/github` | `https://docs.docker.com/{topic}` | `devops/{tool}/` |
| `opencode_framework` | opencode, agent, skill, mcp, framework, compliance, gate, orchestrator, dispatch, subagent, permission, plugin | [] | `https://opencode.ai/docs/{topic}` | `opencode/{category}/` |
| `infrastructure` | git, json-schema, nodejs, markdown, yaml, pandoc | `/git/git` | `https://git-scm.com/docs/{topic}` | `framework/{tool}/` |

## 5. Resolution Algorithm

When @Knowledge-Curator parses a task description:

```
1. Tokenize task description into keywords
2. For each domain in knowledge_semantic_map.domains:
   a. Compute relevance_score = (matching_keywords / total_domain_keywords)
   b. If relevance_score > 0.1, consider domain as candidate
3. Sort candidates by relevance_score (descending)
4. For each candidate domain:
   a. Resolve {template_variables} using project.config.json
   b. Add Context7 library IDs to query list
   c. Prepare fallback URLs
5. Present top-N candidates to user for confirmation (UC7-002)
```

## 6. Stack-Agnostic Benefit

When switching from NestJS to Express:
- `{backend.framework}` resolves to `express` (from `tech_stack.backend.framework`)
- `context7_libraries` becomes `["/expressjs/express"]`
- `fallback_pattern` becomes `https://expressjs.com/docs/{topic}`
- `save_path` becomes `backend/express/`

**No changes to the semantic map itself are needed.**

## 7. Integration with project.config.json

```json
{
  "knowledge_semantic_map": {
    "domains": [
      {
        "domain_id": "backend_api",
        "keywords": ["controller", "endpoint", "guard", "middleware", "swagger", "dto", "api", "service", "module", "interceptor", "pipe", "filter"],
        "context7_libraries": ["{backend.framework}"],
        "fallback_pattern": "https://{backend.framework}.dev/docs/{topic}",
        "save_path": "backend/{backend.framework}/",
        "ttl_days": 30
      }
    ]
  }
}
```

Template variables are resolved at query time by the `dispatch-subagent.js` template resolver.

---

*Document Version: 1.0.0*
*Source: `uc7ks-design-analysis-v1.6.md` §10.3, §10.1, §10.2; `TEMPLATE_VARIABLE_STANDARD.md`*
