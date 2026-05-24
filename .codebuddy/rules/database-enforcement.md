---
alwaysApply: false
paths: "prisma/**/*,migrations/**/*,sql/**/*,db/**/*,schema/**/*,*.sql,*.prisma"
---

# Database Layer Enforcement Rules

These rules are automatically activated when editing database-related files (schema, migrations, seeds, SQL).

## Mandatory Verification (5 Classes)

When database code is modified, ALL of the following verification classes MUST pass before the task can be completed:

### 1. Structure Verification
- Validate schema structure integrity
- Verify migration safety (no destructive changes without explicit approval)
- Check foreign key and constraint consistency
- Validate migration dry-run succeeds

### 2. Design Verification
- Verify database design compliance (normalization, naming conventions)
- Check index design and coverage
- Validate schema follows project conventions
- Review entity-relationship consistency

### 3. I/O Verification
- Verify CRUD operations produce correct results
- Check constraint enforcement (unique, not-null, foreign key)
- Validate seed data integrity
- Verify query result correctness

### 4. Error Verification
- Verify constraint violation handling
- Check migration failure rollback works
- Validate data corruption detection and recovery
- Ensure error messages are meaningful and actionable

### 5. Threshold Verification
- Verify query performance within `project.yaml → quality.performance.database_query_ms`
- Check index coverage within `project.yaml → quality.performance.database_index_coverage_min`
- Validate connection pool behavior under load

## Migration Safety

- All migrations MUST be reversible (have a down migration)
- Destructive migrations (DROP TABLE, DROP COLUMN) MUST have explicit `architect` approval
- Schema validation MUST pass before migration can be applied
- Migration command is read from `project.yaml → layers.database.migration_command`

## TDD Requirement

All database code changes SHOULD have corresponding test coverage. Follow the tdd-enforcer Skill:
- RED: Write failing test for the database change
- GREEN: Implement the migration/schema change
- REFACTOR: Optimize indexes/queries while keeping tests green

## Invocation

Run `/verify all --layer database` to execute all 5 verification classes for the database layer.
