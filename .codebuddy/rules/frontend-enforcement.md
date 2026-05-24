---
alwaysApply: false
paths: "src/frontend/**/*.{ts,tsx,html,css,scss,sass,less,vue,svelte,jsx}"
---

# Frontend Layer Enforcement Rules

These rules are automatically activated when editing frontend source files.

## Mandatory Verification (5 Classes)

When frontend code is modified, ALL of the following verification classes MUST pass before the task can be completed:

### 1. Structure Verification
- Validate layout/component hierarchy has not regressed unintentionally
- Verify responsive breakpoints are maintained
- Check component tree matches expected structure

### 2. Design Verification
- Verify UI design compliance with design tokens/style system
- Check accessibility standards (WCAG where applicable)
- Validate visual consistency with project design system

### 3. I/O Verification
- Verify user input validation and boundary conditions
- Check form submission flows
- Validate user-facing output correctness

### 4. Error Verification
- Verify error states render correctly
- Check user-facing error messages are meaningful
- Validate graceful degradation paths

### 5. Threshold Verification
- Verify FCP (First Contentful Paint) within `project.yaml → quality.performance.frontend_fcp_ms`
- Verify Lighthouse score within `project.yaml → quality.performance.frontend_lighthouse_min`
- Check bundle size against configured budget

## TDD Requirement

All frontend source code changes MUST have corresponding test files. Follow the tdd-enforcer Skill:
- RED: Write failing test first
- GREEN: Write minimal code to pass
- REFACTOR: Clean up while keeping tests green

## Invocation

Run `/verify all --layer frontend` to execute all 5 verification classes for the frontend layer.
