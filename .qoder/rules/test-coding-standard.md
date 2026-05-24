---
type: model_decision
description: When writing or reviewing tests
---

# Test Coding Standard Reference

This document references all standards defined in `.qoder/context/code_standards/testing-coding-standard.md`.

## Applicable Scope

All tasks involving frontend and backend test writing, test review, and test strategy formulation must comply with this standard. Each project should replace the content in `context/code_standards/testing-coding-standard.md` according to its own tech stack.

## Mandatory Triggering Agents

| Agent          | Trigger Scenario                                       |
| -------------- | ---------------------------------------------- |
| **@Coder-BE**  | Backend unit/integration test writing, coverage verification              |
| **@Coder-FE**  | Frontend unit/integration test writing, coverage verification              |
| **@Guardian**  | Test code review (false-positive detection, coverage compliance, test quality) |
| **@Architect** | Test architecture design, E2E critical use case review                 |

## Core Standards Quick Reference

1. **Sole Value of Tests**: The only value of tests is to find bugs; writing false-positive tests is strictly prohibited
2. **TDD Iron Rule**: RED → GREEN → REFACTOR; no development without tests
3. **Testing Trophy Model**: 40% Unit + 40% Integration + 20% E2E
4. **Coverage Requirements**: Overall ≥70%, core modules ≥90%
5. **Mutation Testing**: Kill rate ≥80% (core modules), executed on a daily schedule
6. **False-Positive Test Prohibition**: Empty assertions, testing only Getters/Setters, excessive mocking, mocks without verification, coupling to implementation details
7. **Data Isolation**: Each test uses independent data; Testcontainers preferred
8. **Critical E2E**: Concurrent appointment preemption test is the system's most critical E2E use case; modifications require architect review
9. **No Defect Recurrence**: Every defect fix must include at least 1 new test case
10. **CI Gate**: Unit/integration tests 100% passing, coverage targets met, mutation testing does not block regular PRs

## Full Documentation

For the complete specification, see: [Test Coding Standard Document](.qoder/context/code_standards/testing-coding-standard.md)
