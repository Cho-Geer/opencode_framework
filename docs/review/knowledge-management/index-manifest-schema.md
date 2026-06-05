# index.json Manifest Schema v1.0

**Date**: 2026-06-05
**Phase**: UC7KS Phase 1 — Foundation (Task UC7-P1-T04)
**Source**: `uc7ks-design-analysis-v1.6.md` §9.3
**Status**: Design Document

---

## 1. JSON Schema (Draft 2020-12)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://opencode.internal/schemas/knowledge-index.json",
  "title": "Knowledge Index Manifest",
  "description": "Central manifest for docs/official_docs/ knowledge cache",
  "type": "object",
  "required": ["manifest_version", "last_updated", "entries"],
  "properties": {
    "manifest_version": {
      "type": "string",
      "description": "Semantic version of the manifest schema",
      "pattern": "^\\d+\\.\\d+\\.\\d+$",
      "example": "1.2.0"
    },
    "last_updated": {
      "type": "string",
      "format": "date-time",
      "description": "ISO 8601 timestamp of last atomic update"
    },
    "total_entries": {
      "type": "integer",
      "minimum": 0,
      "description": "Total number of knowledge entries (derived, for quick stats)"
    },
    "entries": {
      "type": "array",
      "description": "All knowledge entries indexed by library/topic",
      "items": {
        "$ref": "#/$defs/knowledge_entry"
      }
    }
  },
  "$defs": {
    "knowledge_entry": {
      "type": "object",
      "required": ["library_id", "query_topic", "files"],
      "properties": {
        "library_id": {
          "type": "string",
          "description": "Context7 library ID or 'web-fallback'",
          "examples": ["/nestjs/nest", "/prisma/prisma", "web-fallback"]
        },
        "query_topic": {
          "type": "string",
          "description": "Topic keywords extracted from the query",
          "maxLength": 200
        },
        "domain": {
          "type": "string",
          "description": "Domain classification",
          "enum": ["backend", "frontend", "database", "devops", "opencode", "framework", "fallback"]
        },
        "tags": {
          "type": "array",
          "items": { "type": "string" },
          "description": "Searchable keyword tags"
        },
        "files": {
          "type": "array",
          "minItems": 1,
          "items": {
            "$ref": "#/$defs/file_entry"
          }
        }
      }
    },
    "file_entry": {
      "type": "object",
      "required": ["path", "source", "sha256", "size_bytes", "created_at"],
      "properties": {
        "path": {
          "type": "string",
          "description": "Relative path from docs/official_docs/",
          "pattern": "^[a-z0-9_/.-]+$"
        },
        "source": {
          "type": "string",
          "description": "Acquisition source",
          "enum": ["context7", "webfetch", "websearch", "scout"]
        },
        "original_url": {
          "type": "string",
          "format": "uri",
          "description": "Original URL (required for webfetch/websearch sources)"
        },
        "context7_library": {
          "type": "string",
          "description": "Context7 library ID (required for context7 source)"
        },
        "sha256": {
          "type": "string",
          "pattern": "^sha256:[a-f0-9]{64}$",
          "description": "SHA-256 hash of file content (used for dedup)"
        },
        "size_bytes": {
          "type": "integer",
          "minimum": 0,
          "maximum": 524288,
          "description": "File size in bytes (max 500KB per UC7-005)"
        },
        "created_at": {
          "type": "string",
          "format": "date-time",
          "description": "ISO 8601 creation timestamp"
        },
        "ttl_days": {
          "type": "integer",
          "minimum": 1,
          "maximum": 365,
          "description": "Time-to-live in days (default: 30, Scout: 14, OpenCode: 7, Fallback: 14)"
        },
        "access_count": {
          "type": "integer",
          "minimum": 0,
          "default": 0,
          "description": "Number of times this file has been accessed"
        },
        "last_accessed": {
          "type": "string",
          "format": "date-time",
          "description": "ISO 8601 last access timestamp"
        },
        "compressed_from": {
          "type": "string",
          "description": "Path to original .html if this is compressed to .md"
        },
        "status": {
          "type": "string",
          "enum": ["active", "archived", "compressed", "stale"],
          "default": "active"
        }
      }
    }
  }
}
```

## 2. Example Manifest (Initial State)

```json
{
  "manifest_version": "1.2.0",
  "last_updated": "2026-06-05T12:00:00Z",
  "total_entries": 0,
  "entries": []
}
```

## 3. Example Entry (Populated)

```json
{
  "library_id": "/nestjs/nest",
  "query_topic": "guards jwt authentication",
  "domain": "backend",
  "tags": ["nestjs", "guard", "jwt", "authentication", "canactivate"],
  "files": [
    {
      "path": "backend/nestjs/v11.x-guards.html",
      "source": "context7",
      "context7_library": "/nestjs/nest",
      "sha256": "sha256:a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2",
      "size_bytes": 45231,
      "created_at": "2026-06-01T10:00:00Z",
      "ttl_days": 30,
      "access_count": 12,
      "last_accessed": "2026-06-05T11:00:00Z",
      "status": "active"
    }
  ]
}
```

## 4. Atomic Update Protocol (UC7-007)

```
1. Read current index.json
2. Apply changes in-memory
3. Write to index.json.tmp (temp file)
4. fsync index.json.tmp
5. atomic rename: index.json.tmp → index.json
```

This prevents partial writes and ensures the manifest is always in a consistent state.

## 5. Deduplication Logic (UC7)

Before adding a new file entry:
1. Compute SHA-256 of new content
2. Search all existing `files[].sha256` for match
3. If match found:
   - Do NOT create a new file
   - Update the existing entry's `tags` with new topic keywords
   - Increment `access_count`
   - Update `last_accessed`
4. If no match: create new file and entry

---

*Document Version: 1.0.0*
*Source: `uc7ks-design-analysis-v1.6.md` §9.3, §11.2, §11.3*
