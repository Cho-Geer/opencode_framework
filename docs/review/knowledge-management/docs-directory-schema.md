# docs/official_docs/ Directory Schema v1.0

**Date**: 2026-06-05
**Phase**: UC7KS Phase 1 — Foundation (Task UC7-P1-T03)
**Source**: `uc7ks-design-analysis-v1.6.md` §2.2, §8.2
**Status**: Design Document

---

## 1. Directory Tree (Complete)

```
docs/
+-- review/
|   +-- knowledge-management/
|       +-- uc7ks-design-analysis-v1.6.md
|       +-- uc7ks-cross-reference-findings-v1.0.md
|       +-- uc7ks-implementation-plan-v1.0.md
|       +-- knowledge-curator-agent-design.md       [Phase 1]
|       +-- context7-first-skill-v2-design.md       [Phase 1]
|       +-- docs-directory-schema.md                [this document]
|       +-- index-manifest-schema.md                [Phase 1]
|       +-- machine-knowledge-state-schema.md       [Phase 1]
|       +-- semantic-map-design.md                  [Phase 1]
|       +-- kc-permission-mapping.md                [Phase 1]
|       +-- scout-integration-contract.md         [Phase 1]
|
+-- official_docs/                          [CREATED in Phase 2]
    +-- index.json                          # Central manifest
    +-- .metadata/                          # Internal tracking
    |   +-- query_log.json                  # All queries for audit
    |   +-- last_janitor_run                # Timestamp file
    |   +-- size_report.json                # Per-directory size tracking
    |   +-- archives/                       # Compressor archive (7-day retention)
    |
    +-- backend/                            # Backend technology docs
    |   +-- nestjs/
    |   |   +-- v11.x-guards.html
    |   |   +-- source-analysis/            # Scout code findings
    |   +-- prisma/
    |   |   +-- v7.x-relations.html
    |   |   +-- source-analysis/
    |   +-- express/                        # Future stack support
    |
    +-- frontend/                           # Frontend technology docs
    |   +-- angular/
    |   |   +-- source-analysis/
    |   +-- react/                          # Future stack support
    |
    +-- database/                           # Database/Infrastructure docs
    |   +-- postgresql/
    |   +-- redis/
    |
    +-- devops/                             # DevOps/CI/CD docs
    |   +-- docker/
    |   +-- github-actions/
    |
    +-- opencode/                           # OpenCode official knowledge
    |   +-- agents/                         # Agent config docs
    |   +-- skills/                         # Skill development docs
    |   +-- framework/                      # Framework architecture
    |   |   +-- source-analysis/            # OpenCode source-code analysis (Scout)
    |   +-- mcp/                            # MCP integration docs
    |   +-- deployment/                     # Deployment/ops docs
    |
    +-- framework/                          # Non-OpenCode framework tools (Super-Admin)
    |   +-- eslint/
    |   |   +-- source-analysis/            # ESLint source-code analysis (Scout)
    |   +-- typescript/
    |   +-- git/
    |   +-- json-schema/
    |   +-- nodejs/
    |   +-- github-actions/
    |
    +-- fallback/                           # webfetch/websearch results
    |   +-- web-[sha256].html               # SHA-based naming for dedup
    |
    +-- scout-extracts/                     # Scout findings staging
        +-- [domain]-[library]-[topic].md   # Pre-save staging
```

## 2. Domain Classification Rules

| Domain | What Goes Here | Example Libraries |
|--------|---------------|-------------------|
| `backend/` | Server-side frameworks, ORMs, API tools | NestJS, Express, Prisma, Fastify |
| `frontend/` | Client-side frameworks, UI libraries | Angular, React, Vue, Tailwind CSS |
| `database/` | Database engines, caching solutions | PostgreSQL, Redis, MongoDB |
| `devops/` | CI/CD, containerization, deployment | Docker, GitHub Actions, Kubernetes |
| `opencode/` | OpenCode framework official docs | Agent config, skills, MCP, deployment |
| `framework/` | Non-OpenCode framework tools for Super-Admin | ESLint, TypeScript, Git, JSON Schema, Node.js |
| `fallback/` | All webfetch/websearch results | SHA-256 named HTML files |
| `scout-extracts/` | Scout findings before archival | Staged .md files |

## 3. File Naming Convention

### Documentation (Context7/webfetch/websearch)

```
{domain}/{library}/{version}-{topic}.html
```

Examples:
- `backend/nestjs/v11.x-guards.html`
- `backend/prisma/v7.x-relations.html`
- `framework/eslint/v9.x-plugin-api.html`
- `opencode/agents/agent-config-guide.html`

### Fallback (webfetch/websearch)

```
fallback/web-{sha256}.html
```

SHA-256 of the original URL.

### Source Analysis (Scout)

```
{domain}/{library}/source-analysis/{topic}.md
```

Examples:
- `opencode/framework/source-analysis/dispatch-mechanism.md`
- `framework/eslint/source-analysis/plugin-api-internals.md`

## 4. Metadata Directory

### `.metadata/query_log.json`

```json
{
  "queries": [
    {
      "query_id": "q_001",
      "token_id": "uc7_T-014_20260605_001",
      "agent": "@Super-Admin",
      "libraries_queried": ["/eslint/eslint"],
      "source": "context7",
      "result": "success",
      "timestamp": "2026-06-05T12:00:00Z"
    }
  ]
}
```

### `.metadata/size_report.json`

```json
{
  "generated_at": "2026-06-05T00:00:00Z",
  "total_size_bytes": 23456789,
  "total_files": 47,
  "per_domain": {
    "backend": { "size_bytes": 1234567, "file_count": 12 },
    "frontend": { "size_bytes": 890123, "file_count": 5 },
    "framework": { "size_bytes": 4567890, "file_count": 15 },
    "opencode": { "size_bytes": 234567, "file_count": 3 },
    "fallback": { "size_bytes": 6789012, "file_count": 8 }
  }
}
```

## 5. Size Limits (UC7-005)

| Limit | Value | Enforcement |
|-------|-------|-------------|
| Max single file | 500 KB | `code-quality-gate` write-check |
| Max total `docs/official_docs/` | 50 MB | Janitor + `code-quality-gate` |
| Compression threshold | 200 KB | Compressor (`.html` → `.md`) |
| Scout finding TTL | 14 days | Janitor |
| Standard doc TTL | 30 days | Janitor |
| OpenCode doc TTL | 7 days | Janitor |
| Fallback doc TTL | 14 days | Janitor |

---

*Document Version: 1.0.0*
*Source: `uc7ks-design-analysis-v1.6.md` §2.2, §8.2, §3.1 (UC7-005)*
