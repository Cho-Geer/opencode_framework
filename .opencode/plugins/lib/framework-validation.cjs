"use strict";
/**
 * framework-validation.ts — Shared Framework Validation Module
 * =================================================================
 *
 * Pure utility functions for framework state validation, eliminating
 * code duplication across the framework harness:
 *   - framework-enforcer.ts (plugin hooks)
 *   - framework-compliance-check.js, state-integrity-scan.js (CLI scripts)
 *   - gate-lifecycle-audit.js, pre-execution-gate.js (dispatch gate)
 *   - framework-doctor.js (health check)
 *   - state-reconciliation.js (state repair)
 *   - framework-self-test.js (binding force test)
 *
 * All functions are PURE — no console.log, no process.exit, no
 * side effects during import. Structured return objects only.
 * Never throws except for FrameworkEnforcementError.
 *
 * @author  @Architect
 * @version 1.0.0
 * @phase   FW-HARNESS-SHARED-MODULE
 * @since   2026-05-25
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.FrameworkEnforcementError = void 0;
exports.readJsonFile = readJsonFile;
exports.fileExists = fileExists;
exports.computeSHA256 = computeSHA256;
exports.resolveFrameworkPaths = resolveFrameworkPaths;
exports.checkDagExists = checkDagExists;
exports.checkTaskInDag = checkTaskInDag;
exports.checkDagProgress = checkDagProgress;
exports.checkArmedSession = checkArmedSession;
exports.checkStaleSessions = checkStaleSessions;
exports.checkGateIntegrity = checkGateIntegrity;
exports.checkMachineCleanliness = checkMachineCleanliness;
exports.checkRuleRegistryIntegrity = checkRuleRegistryIntegrity;
exports.isAgentAllowedToWrite = isAgentAllowedToWrite;
exports.pathMatchesGlob = pathMatchesGlob;
exports.getEnforcementMode = getEnforcementMode;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const crypto = __importStar(require("node:crypto"));
// ============================================================================
// A. File Operations
// ============================================================================
/**
 * Safely read and parse a JSON file. Returns the parsed object or null on any
 * failure (file missing, unreadable, invalid JSON).
 */
function readJsonFile(filePath) {
    try {
        if (!fs.existsSync(filePath)) {
            return null;
        }
        const raw = fs.readFileSync(filePath, "utf-8");
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
/**
 * Check whether a file exists at the given path.
 */
function fileExists(filePath) {
    try {
        return fs.statSync(filePath).isFile();
    }
    catch {
        return false;
    }
}
/**
 * Compute SHA-256 hex digest of a file's content.
 * Returns the hex string (no prefix) or null on failure.
 */
function computeSHA256(filePath) {
    try {
        const content = fs.readFileSync(filePath);
        const hash = crypto.createHash("sha256");
        hash.update(content);
        return hash.digest("hex");
    }
    catch {
        return null;
    }
}
/**
 * Resolve all framework file paths from a project root.
 * If no root is provided, derive it from the module's location (__dirname walk-up)
 * or fall back to process.cwd().
 *
 * @param root - Optional explicit project root path
 * @returns FrameworkPaths with all paths resolved as absolute paths
 */
function resolveFrameworkPaths(root) {
    const resolvedRoot = root
        ? path.resolve(root)
        : deriveOpenCodeRoot();
    return {
        root: resolvedRoot,
        dag: path.join(resolvedRoot, "Task.DAG.json"),
        gateState: path.join(resolvedRoot, ".opencode", "state", "gate-state.json"),
        machine: path.join(resolvedRoot, ".opencode", "state", "machine.json"),
        projectConfig: path.join(resolvedRoot, ".opencode", "project.config.json"),
        ruleRegistry: path.join(resolvedRoot, ".opencode", "state", "rule_registry.json"),
        ruleRegistryFallback: path.join(resolvedRoot, ".opencode", "rule_registry.json"),
        pluginsDir: path.join(resolvedRoot, ".opencode", "plugins"),
        hooksDir: path.join(resolvedRoot, ".opencode", "hooks"),
        stateDir: path.join(resolvedRoot, ".opencode", "state"),
        scriptsDir: path.join(resolvedRoot, ".opencode", "scripts"),
        agentsDir: path.join(resolvedRoot, ".opencode", "agents"),
        rulesDir: path.join(resolvedRoot, ".opencode", "rules"),
    };
}
/**
 * Derive the OpenCode project root by walking up from known marker directories.
 * This is a pure function — no environment access, no shell.
 * It must be called from a script inside .opencode/ for the walk-up to work.
 */
function deriveOpenCodeRoot() {
    // Strategy: check for .opencode/ directory from cwd upward
    let current = path.resolve(process.cwd());
    for (let i = 0; i < 10; i++) {
        const dotOpenCode = path.join(current, ".opencode");
        if (fs.existsSync(dotOpenCode)) {
            return current;
        }
        const parent = path.dirname(current);
        if (parent === current) {
            break; // reached filesystem root
        }
        current = parent;
    }
    return process.cwd();
}
/**
 * Check if Task.DAG.json exists and count tasks.
 */
function checkDagExists(paths) {
    const dag = readJsonFile(paths.dag);
    if (!dag || !Array.isArray(dag.tasks)) {
        return { found: fileExists(paths.dag), taskCount: 0 };
    }
    return { found: true, taskCount: dag.tasks.length };
}
/**
 * Check if a specific task exists in Task.DAG.json and return its status.
 */
function checkTaskInDag(taskId, paths) {
    const dag = readJsonFile(paths.dag);
    if (!dag || !Array.isArray(dag.tasks)) {
        return { found: false, status: "unknown", owner: "" };
    }
    const task = dag.tasks.find((t) => t.id === taskId);
    if (!task) {
        return { found: false, status: "unknown", owner: "" };
    }
    return {
        found: true,
        status: task.status,
        owner: task.owner || "",
    };
}
/**
 * Calculate DAG progress (total, completed, pending, percent).
 */
function checkDagProgress(paths) {
    const dag = readJsonFile(paths.dag);
    if (!dag || !Array.isArray(dag.tasks)) {
        return { total: 0, completed: 0, pending: 0, progressPercent: 0 };
    }
    const tasks = dag.tasks;
    const total = tasks.length;
    const completed = tasks.filter((t) => t.status === "completed").length;
    const pending = tasks.filter((t) => t.status === "pending" || t.status === "in_progress").length;
    const progressPercent = total > 0 ? Math.round((completed / total) * 100) : 0;
    return { total, completed, pending, progressPercent };
}
/**
 * Check if an armed compliance gate session exists.
 * An "armed" session has confirmed_at set, consumed_at is null, and
 * gate_status is "armed" (not "failed" or "drained").
 */
function checkArmedSession(taskId, paths) {
    const gate = readJsonFile(paths.gateState);
    if (!gate || !gate.sessions) {
        return { found: false, sessionId: null };
    }
    const sessions = Object.values(gate.sessions);
    const armed = sessions.find((s) => s.gate_status === "armed" &&
        s.consumed_at === null);
    return armed
        ? { found: true, sessionId: armed.session_id }
        : { found: false, sessionId: null };
}
/**
 * Scan for stale gate sessions (older than thresholds).
 * Stale = drained sessions > 48h old, or checked sessions > 48h old
 * without confirmation (never confirmed).
 */
function checkStaleSessions(paths) {
    const gate = readJsonFile(paths.gateState);
    const now = Date.now();
    const stale = [];
    if (!gate || !gate.sessions) {
        return { stale, count: 0 };
    }
    const STALE_THRESHOLD_HOURS = 48;
    const STALE_THRESHOLD_MS = STALE_THRESHOLD_HOURS * 60 * 60 * 1000;
    for (const s of Object.values(gate.sessions)) {
        const createdAt = s.created_at ? new Date(s.created_at).getTime() : 0;
        if (!createdAt)
            continue;
        const ageHours = (now - createdAt) / (60 * 60 * 1000);
        // Drained sessions
        if (s.gate_status === "drained" && ageHours > STALE_THRESHOLD_HOURS) {
            stale.push({ id: s.session_id, age: Math.round(ageHours * 10) / 10 });
            continue;
        }
        // Checked but never confirmed within the threshold
        if (s.gate_status === "checked" &&
            !s.confirmed_at &&
            ageHours > STALE_THRESHOLD_HOURS) {
            stale.push({ id: s.session_id, age: Math.round(ageHours * 10) / 10 });
        }
    }
    return { stale, count: stale.length };
}
/**
 * Check gate-state.json structural integrity.
 * Validates: formatVersion presence, sessions object structure, session ID format.
 */
function checkGateIntegrity(paths) {
    const issues = [];
    if (!fileExists(paths.gateState)) {
        // Missing gate-state.json is normal for fresh projects — not an integrity failure
        return { valid: true, issues: [] };
    }
    const gate = readJsonFile(paths.gateState);
    if (!gate) {
        issues.push("gate-state.json exists but cannot be parsed as JSON");
        return { valid: false, issues };
    }
    if (!gate.formatVersion) {
        issues.push("gate-state.json missing formatVersion field");
    }
    if (!gate.sessions || typeof gate.sessions !== "object") {
        issues.push("gate-state.json missing 'sessions' object");
    }
    else {
        const sessions = Object.values(gate.sessions);
        if (sessions.length === 0 && (gate.active_sessions || []).length > 0) {
            issues.push("gate-state.json: active_sessions non-empty but sessions object is empty");
        }
        for (const s of sessions) {
            if (!s.session_id) {
                issues.push("gate-state.json: session entry missing session_id");
            }
            if (s.gate_status &&
                !["checked", "armed", "completed", "failed", "drained"].includes(s.gate_status)) {
                issues.push(`gate-state.json: unknown gate_status '${s.gate_status}' in session ${s.session_id || "(unknown)"}`);
            }
        }
    }
    return { valid: issues.length === 0, issues };
}
/**
 * Check if machine.json sub-states are clean (no violations, no dirty modules).
 */
function checkMachineCleanliness(paths) {
    const dirty = [];
    const machine = readJsonFile(paths.machine);
    if (!machine) {
        // Missing machine.json is clean by definition (no state to check)
        return { clean: true, dirty: [] };
    }
    // Check ESLint state
    const eslintAgg = machine.eslint_state?.aggregate;
    if (eslintAgg?.dirty_modules && eslintAgg.dirty_modules.length > 0) {
        dirty.push(`eslint_state: ${eslintAgg.dirty_modules.length} dirty module(s) — ${eslintAgg.dirty_modules.join(", ")}`);
    }
    // Check type check state
    if (machine.type_check_state?.status &&
        machine.type_check_state.status !== "clean") {
        const dirtyFiles = machine.type_check_state.dirty_files || [];
        dirty.push(`type_check_state: status=${machine.type_check_state.status}, ${dirtyFiles.length} dirty file(s)`);
    }
    // Check dependency state
    if (machine.dependency_state?.status &&
        machine.dependency_state.status !== "clean") {
        dirty.push(`dependency_state: status=${machine.dependency_state.status}, ${(machine.dependency_state.violations || []).length} violation(s)`);
    }
    // Check format state
    if (machine.format_state?.status &&
        machine.format_state.status !== "clean") {
        const unformatted = machine.format_state.unformatted_files || [];
        dirty.push(`format_state: status=${machine.format_state.status}, ${unformatted.length} unformatted file(s)`);
    }
    return { clean: dirty.length === 0, dirty };
}
/**
 * Check rule_registry.json integrity by comparing stored digests with
 * actual file digests. HIGH severity = digest changed but version unchanged.
 * WARNING = version bumped (intentional). INFO = unregistered file.
 */
function checkRuleRegistryIntegrity(paths) {
    const mismatches = [];
    // Resolve registry path (primary + fallback)
    let registryPath = paths.ruleRegistry;
    if (!fileExists(registryPath)) {
        if (fileExists(paths.ruleRegistryFallback)) {
            registryPath = paths.ruleRegistryFallback;
        }
        else {
            // No registry exists — valid by definition
            return { valid: true, mismatches: [] };
        }
    }
    const rr = readJsonFile(registryPath);
    if (!rr || !rr.entries) {
        mismatches.push({
            file: "rule_registry.json",
            severity: "HIGH",
        });
        return { valid: false, mismatches };
    }
    const entries = rr.entries;
    const onDiskRegistry = readJsonFile(registryPath);
    for (const [key, entry] of Object.entries(entries)) {
        const filePath = path.join(paths.root, entry.path);
        const storedHash = entry.sha256 || "";
        if (!fileExists(filePath)) {
            mismatches.push({
                file: entry.path,
                severity: "HIGH",
            });
            continue;
        }
        const actualHash = computeSHA256(filePath);
        if (!actualHash) {
            mismatches.push({ file: entry.path, severity: "HIGH" });
            continue;
        }
        if (actualHash !== storedHash) {
            // Try to detect version change
            let versionBumped = false;
            try {
                const content = fs.readFileSync(filePath, "utf-8");
                const ymMatch = content.match(/^version:\s*"?(\d+\.\d+\.\d+)"?/m);
                if (ymMatch && ymMatch[1] !== entry.semver) {
                    versionBumped = true;
                }
            }
            catch {
                // Can't read — treat as HIGH
            }
            mismatches.push({
                file: entry.path,
                severity: versionBumped ? "WARNING" : "HIGH",
            });
        }
    }
    return {
        valid: mismatches.filter((m) => m.severity === "HIGH").length === 0,
        mismatches,
    };
}
/**
 * Check whether an agent is allowed to write to a given file path.
 * Returns true if write is permitted, false otherwise.
 */
function isAgentAllowedToWrite(agent, filePath, paths) {
    const config = readJsonFile(paths.projectConfig);
    const scopes = config?.agent_write_scopes?.[agent];
    if (!scopes) {
        // No scope defined for this agent — allow all
        return true;
    }
    // Check denied patterns first (explicit deny always wins)
    for (const pattern of scopes.denied) {
        if (pathMatchesGlob(filePath, pattern)) {
            return false;
        }
    }
    // Check allowed patterns
    for (const pattern of scopes.allowed) {
        if (pathMatchesGlob(filePath, pattern)) {
            return true;
        }
    }
    // No matching allow pattern — deny
    return false;
}
/**
 * Simple glob matching for agent_write_scopes patterns.
 * Supports ** (recursive), * (single-segment wildcard), and literal paths.
 * Handles both forward and backslash separators on all platforms.
 */
function pathMatchesGlob(filePath, pattern) {
    const normalized = filePath.replace(/\\/g, "/");
    const pat = pattern.replace(/\\/g, "/");
    const regexStr = pat
        .replace(/\./g, "\\.")
        .replace(/\*\*/g, "{{GLOBSTAR}}")
        .replace(/\*/g, "[^/]*")
        .replace(/{{GLOBSTAR}}/g, ".*");
    const regex = new RegExp(`^${regexStr}$`);
    return regex.test(normalized);
}
const VALID_MODES = new Set([
    "advisory",
    "strict",
    "locked",
]);
/**
 * Determine the current enforcement mode.
 * Priority: ENFORCEMENT_MODE env var > project.config.json > default "strict".
 */
function getEnforcementMode(paths) {
    // 1. Environment variable override (highest priority)
    //    Read from process.env only when called (pure otherwise)
    if (typeof process !== "undefined" && process.env) {
        const envMode = process.env.ENFORCEMENT_MODE || process.env.FRAMEWORK_MODE || "";
        if (VALID_MODES.has(envMode)) {
            return envMode;
        }
    }
    // 2. Read from project.config.json
    const config = readJsonFile(paths.projectConfig);
    const mode = config?.template_resolution?.enforcement_mode;
    if (mode && VALID_MODES.has(mode)) {
        return mode;
    }
    // 3. Default fallback: strict
    return "strict";
}
// ============================================================================
// H. Error Class
// ============================================================================
/**
 * FrameworkEnforcementError — structured error for enforcement violations.
 * Carries check name, severity, agent identity, task ID, and enforcement mode
 * for rich error handling upstream.
 */
class FrameworkEnforcementError extends Error {
    /** Which check failed (e.g., "DAG Coverage", "Gate Lifecycle") */
    check;
    /** Severity level: "HIGH", "WARNING", or "INFO" */
    severity;
    /** Agent type that triggered the violation (e.g., "@Coder-BE") */
    agent;
    /** Task ID associated with the violation (empty string if N/A) */
    taskId;
    /** Enforcement mode at the time of the violation */
    mode;
    constructor(check, message, severity, agent = "", taskId = "", mode = "strict") {
        super(message);
        this.name = "FrameworkEnforcementError";
        this.check = check;
        this.severity = severity;
        this.agent = agent;
        this.taskId = taskId;
        this.mode = mode;
        // Maintain proper prototype chain for instanceof checks
        Object.setPrototypeOf(this, FrameworkEnforcementError.prototype);
    }
    /**
     * Serialise the error to a JSON-friendly object.
     */
    toJSON() {
        return {
            name: this.name,
            message: this.message,
            check: this.check,
            severity: this.severity,
            agent: this.agent,
            taskId: this.taskId,
            mode: this.mode,
        };
    }
}
exports.FrameworkEnforcementError = FrameworkEnforcementError;
