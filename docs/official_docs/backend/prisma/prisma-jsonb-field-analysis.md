# Prisma JSONB Field Analysis

**Source**: Project schema analysis
**Date**: 2026-07-04
**Domain**: persistence
**TTL**: 30 days

## Overview

Analysis of JSONB/Json fields in the project's Prisma schema (`booking_system_refactor/booking-backend/prisma/schema.prisma`).

## Field Inventory

| # | Model | Field | Type | Line | Purpose |
|---|-------|-------|------|------|---------|
| 1 | User | `deviceInfo` | `Json?` | 80 | Device information (browser, OS, etc.) — storage only |
| 2 | UserSession | `deviceInfo` | `Json? @db.JsonB` | 113 | Device details for session tracking — storage only |
| 3 | Appointment | `customerInfo` | `Json` (required) | 226 | Customer info attached to booking — storage only |
| 4 | AppointmentHistory | `metadata` | `Json?` | 264 | Change metadata (audit trail) — storage only |
| 5 | Notification | `metadata` | `Json?` | 288 | BullMQ jobId and metadata — storage only |
| 6 | ActivityLog | `metadata` | `Json?` | 362 | Activity operation metadata — storage only |
| 7 | SystemLog | `context` | `Json?` | 426 | Log context information — storage only |

## Key Findings

1. **All are `jsonb`** — Prisma's `Json` type maps to PostgreSQL `jsonb` by default. Only `UserSession.deviceInfo` has explicit `@db.JsonB`.
2. **No GIN indexes** — None of the models define GIN indexes on Json fields.
3. **No optimization needed** — Confirmed by project owner: all fields are storage/audit/logging only. No JSONB containment queries or key-existence operators needed.

## Future Optimization Candidates

If JSONB query requirements arise:

| Field | Recommended Index | Query Pattern |
|-------|-------------------|---------------|
| `Appointment.customerInfo` | GIN index (`CREATE INDEX idx_appt_custinfo ON appointments USING GIN (customer_info)`) | `@>` containment queries on customer attributes |
| `ActivityLog.metadata` | GIN index | Key-existence or containment queries for activity analysis |
| `SystemLog.context` | GIN index | Error aggregation queries using `@>` or `?` operators |
