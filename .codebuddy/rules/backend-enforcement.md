---
alwaysApply: false
paths: "src/backend/**/*.{ts,js,py,go,java,rs,rb,php}"
---

# Backend Layer Enforcement Rules

These rules are automatically activated when editing backend source files.

## Mandatory Verification (5 Classes)

When backend code is modified, ALL of the following verification classes MUST pass before the task can be completed:

### 1. Structure Verification
- Validate API route structure is consistent
- Verify endpoint inventory matches expected routes
- Check middleware/pipeline ordering

### 2. Design Verification
- Verify API design compliance with project conventions
- Check naming conventions (endpoints, models, services)
- Validate API versioning rules
- Check OpenAPI/Swagger schema compliance (if configured)

### 3. I/O Verification
- Verify request/response contract integrity
- Check serialization/deserialization correctness
- Validate boundary value handling
- Verify input sanitization

### 4. Error Verification
- Verify error codes and error propagation
- Check error response format consistency
- Validate recovery paths work correctly
- Ensure no unhandled exceptions leak to clients

### 5. Threshold Verification
- Verify API p95 latency within `project.yaml → quality.performance.backend_p95_ms`
- Check memory stability under load
- Validate concurrent request handling

## TDD Requirement

All backend source code changes MUST have corresponding test files. Follow the tdd-enforcer Skill:
- RED: Write failing test first
- GREEN: Write minimal code to pass
- REFACTOR: Clean up while keeping tests green

## Contract-Driven Development

If contract files are configured in `project.yaml → contracts.files`:
- All API changes must align with contract specifications
- Contract integrity must be validated before implementation
- Any contract changes require `architect` approval

## Invocation

Run `/verify all --layer backend` to execute all 5 verification classes for the backend layer.
