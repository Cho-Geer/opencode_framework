# OpenCode Framework Core Feature & Risk Assessment (2026-05-21)

## 1) Core features sorted (what the framework is really centered on)

### A. Compliance-gate lifecycle as hard entry/exit control
- The framework defines a mandatory start sequence: `compliance_gate_check` -> user confirmation -> `compliance_gate_confirm`, and a mandatory completion sequence with `compliance_gate_complete`. This is described in global policy and reinforced by command docs and implementation.  
- The gate state is persisted in `.opencode/state/gate-state.json` with session lifecycle fields and `active_sessions`.

### B. Central state machine for governance evidence
- `.opencode/state/machine.json` is positioned as the runtime governance state (eslint/type/dependency/format/write-audit/tdd/compliance/contracts hashes).
- Rule docs describe it as single source of truth for lifecycle validation, and pre-commit hooks read it.
- Schema exists (`machine.schema.json`) to constrain machine structure and required sections.

### C. Three-layer eight-role orchestration model
- Role model: Meta-Planner, Orchestrator, Architect, Coder-FE, Coder-BE, Guardian, Arbiter, CI-CD-Agent.
- Strict separation of concerns is explicitly documented, especially Orchestrator's "schedule-only" boundary and Meta-Planner mandatory DAG entry.

### D. DAG-driven execution
- Task planning/dependency management is centralized in `Task.DAG.json` and linked to role workflows.
- Pre-commit hooks include checks around gate state and broader compliance state.

### E. Strong binding via contract and keystone hash
- `contract.yaml` has `x-keystone-state-hash`; `machine.json.keystone_hashes` stores expected digest.
- Scripts (`keystone-validate.js`) and role policies enforce synchronized hash updates.

### F. Template-variable resolution + role write scopes
- `.opencode/project.config.json` provides template resolution keys (`contract_hash_command`, `backend.orm.schema`, etc.).
- Agent write scopes define allow/deny paths per role to constrain unauthorized edits.

## 2) Potential problems, inconsistencies, and omissions

### P0/P1 design issues (central state management perspective)

1. **Single-source-of-truth claim is diluted by dual state planes without explicit transactional protocol.**  
   `machine.json` governs audit/compliance posture, while `gate-state.json` governs session lifecycle. They are coupled by policy, but stored separately and updated by different paths. There is no documented atomic commit protocol across both files, so crash/interruption can leave partial truth across planes.

2. **Cross-workspace contamination risk still visible in persisted state.**  
   `machine.json.write_audit_state.current_session.files_written` still contains absolute paths outside current repo root (`/home/zhaoge/workspace/opencode/Playground2.backup...`), indicating historical or unresolved workspace leakage in central state.

3. **Project reference/documentation drift creates practical operability confusion.**  
   `PROJECT_REFERENCE.md` points to a different absolute project tree and operational commands not matching current repo reality, reducing universality and weakening onboarding reliability.

4. **Gate checks validate file presence more than semantic freshness.**  
   `compliance-gate.js` checks existence of rules/skills files. Presence-only checks are weak against stale, incompatible, or partially-updated rule content.

5. **State recovery strategy is script-based but not policy-bound as mandatory auto-repair.**  
   A reset script exists (`state-reset.js`), but policy does not enforce deterministic automatic reconciliation when state divergence is detected pre-commit or pre-run.

### Multi-agent system consistency issues

6. **Role policy is strict, but enforcement pathways are uneven.**  
   AGENTS/rules express strict boundaries; actual hard enforcement depends heavily on hooks and cooperative scripts. Runtime guarantees against every unauthorized edit path are not fully centralized in one verifier.

7. **DAG and runtime evidence can diverge without a canonical reconciliation authority loop.**  
   Policy says only Meta-Planner updates DAG and Orchestrator schedules; however, strong continuous syncing between `Task.DAG.json`, `machine.json.currentTask` semantics, and gate sessions is not represented as a single reconciliation engine.

### Strong binding & universal/practical effectiveness gaps

8. **Bindings are strong for contract hash, weaker for requirement-set integrity.**  
   Keystone hash anchors `contract.yaml`, but there is no equally strong hash chain for full requirement corpus and role/rule bundles; this leaves room for subtle drift between contract and governance docs.

9. **Absolute-path footprint reduces portability/universality.**  
   Paths in docs/state artifacts reveal environment coupling; practical reuse across environments or forks becomes fragile.

10. **Operational completion semantics rely on social workflow + hook timing.**  
    `compliance_gate_complete` is mandatory by policy, but execution environments that bypass expected hook flow can still produce inconsistent perceived completion unless additional server-side policy enforcement exists.

## 3) Priority recommendations (practical + effective)

### Immediate (P0)
1. **Introduce a unified state transaction envelope** for updates touching both `gate-state.json` and `machine.json` (single operation ID, monotonic revision, two-phase write + recovery marker).
2. **Add strict workspace-root canonicalization** at read/write boundary (reject and auto-scrub foreign absolute paths across all state sections).
3. **Replace presence checks with semantic version checks** in gate preflight (rule digest/version compatibility assertions).

### Near-term (P1)
4. **Create a reconciliation daemon/check command** that validates consistency among `Task.DAG.json`, gate sessions, and `machine.json` before commit and before orchestration dispatch.
5. **Add integrity chaining**: hash bundle for critical rule docs + requirement docs + agent configs, stored in machine state and verified in hook/toolchain.
6. **Normalize all docs and references to repo-relative paths** and add CI linting that rejects absolute path leakage.

### Medium-term (P2)
7. **Event-sourced audit log layer** (append-only events) with derived materialized states for gate/machine; improves forensics and rollback safety.
8. **Formalize enforcement modes** (advisory/strict/locked) so environments can opt into stronger hard-fail behavior consistently.
9. **Add universal compatibility profile** for non-Angular/Nest stacks to make template resolution and governance truly framework-agnostic.

## 4) Bottom-line judgment

- **Central state management**: Conceptually strong, implementation still partially split and leak-prone.  
- **Multi-agent system**: Role model and protocol are comprehensive, but practical consistency depends on stronger automatic reconciliation and integrity verification.  
- **Strongly binding/universal/effective**: Strong in intent and contract hash discipline; weaker in full-system integrity chaining, portability hygiene, and cross-state atomicity.

Overall, the framework is **architecturally advanced** but needs a tighter **state coherence backbone** to be fully universal and operationally robust under real-world failures.
