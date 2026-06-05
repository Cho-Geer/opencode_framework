# machine.json knowledge_state Extension Schema v1.0

**Date**: 2026-06-05
**Phase**: UC7KS Phase 1 — Foundation (Task UC7-P1-T05)
**Source**: `uc7ks-design-analysis-v1.6.md` §9.1, §9.2
**Status**: Design Document

---

## 1. New Top-Level Section: `knowledge_state`

Add to `.opencode/state/machine.json`:

```json
{
  "knowledge_state": {
    "version": "1.2.0",
    "index_manifest_sha256": "sha256:...",
    "total_docs_count": 0,
    "total_size_bytes": 0,
    "last_janitor_run": null,
    "active_queries": [],
    "query_stats": {
      "total_queries": 0,
      "context7_hits": 0,
      "web_fallbacks": 0,
      "scout_escalations": 0,
      "cache_hits": 0
    },
    "ttl_violations": [],
    "size_violations": [],
    "last_reconciliation": null
  }
}
```

## 2. Field Definitions

| Field | Type | Description |
|-------|------|-------------|
| `version` | string | Schema version (semantic) |
| `index_manifest_sha256` | string | SHA-256 of `index.json` for integrity verification |
| `total_docs_count` | integer | Total count of individual doc files |
| `total_size_bytes` | integer | Aggregate size of all docs |
| `last_janitor_run` | ISO 8601/null | Timestamp of last Janitor execution |
| `active_queries` | array | Currently in-progress @Knowledge-Curator queries |
| `query_stats` | object | Aggregate query statistics |
| `ttl_violations` | array | Docs exceeding TTL |
| `size_violations` | array | Files/domains exceeding size limits |
| `last_reconciliation` | ISO 8601/null | Last time state-reconciliation.js ran |

## 3. Active Query Entry

```json
{
  "token_id": "uc7_T-014_20260605_001",
  "status": "in_progress",
  "agent": "@Super-Admin",
  "libraries": ["/eslint/eslint"],
  "timestamp": "2026-06-05T12:00:00Z"
}
```

Status values: `in_progress`, `completed`, `failed`, `aborted`

## 4. Query Stats Entry

```json
{
  "total_queries": 156,
  "context7_hits": 134,
  "web_fallbacks": 18,
  "websearch_fallbacks": 4,
  "scout_escalations": 8,
  "cache_hits": 289,
  "failed_queries": 2
}
```

## 5. TTL Violation Entry

```json
{
  "path": "docs/official_docs/framework/eslint/v8.x-obsolete.html",
  "age_days": 45,
  "ttl_days": 30,
  "action": "flagged_for_refresh",
  "detected_at": "2026-06-05T00:00:00Z"
}
```

Action values: `flagged_for_refresh`, `archived`, `deleted`

## 6. State Reconciliation Hooks

`state-reconciliation.js` will validate:
1. `index_manifest_sha256` matches actual `index.json` SHA-256
2. `total_docs_count` matches count of entries in `index.json`
3. `active_queries` have not exceeded their token TTL
4. `last_janitor_run` is within `janitor_interval_hours` of now

## 7. machine.schema.json Update

Add to `.opencode/state/machine.schema.json`:

```json
{
  "knowledge_state": {
    "type": "object",
    "required": ["version", "total_docs_count", "total_size_bytes"],
    "properties": {
      "version": { "type": "string" },
      "index_manifest_sha256": { "type": "string" },
      "total_docs_count": { "type": "integer", "minimum": 0 },
      "total_size_bytes": { "type": "integer", "minimum": 0 },
      "last_janitor_run": { "type": ["string", "null"], "format": "date-time" },
      "active_queries": { "type": "array", "items": { "$ref": "#/$defs/active_query" } },
      "query_stats": { "$ref": "#/$defs/query_stats" },
      "ttl_violations": { "type": "array", "items": { "$ref": "#/$defs/ttl_violation" } },
      "size_violations": { "type": "array", "items": { "type": "object" } },
      "last_reconciliation": { "type": ["string", "null"], "format": "date-time" }
    }
  }
}
```

---

*Document Version: 1.0.0*
*Source: `uc7ks-design-analysis-v1.6.md` §9.1, §9.2; `state-machine-standard.md`*
