/**
 * service/enforcement/exemptions.ts
 *
 * Centralized enforcement exemption reader.
 * All hardcoded whitelists/blacklists from plugin hooks are now
 * configurable via project.config.json -> enforcement_exemptions section.
 *
 * @since 2026-07-03
 */
import { join } from "path";
import { readFileSync, existsSync } from "fs";
import { writeLog } from "../../lib/log-manager";

const SRC = "service-exemptions";

export interface ExemptionConfig {
  agent_identity: {
    privileged_agents: string[];
    dag_exempt_agents: string[];
  };
  anti_bypass: {
    guidance_gate_exempt_tools: string[];
    guidance_gate_exempt_suffixes: string[];
    phase0_failure_exempt_tools: string[];
    enforcement_passthrough_tools: string[]; 
  };
  phase0_enforce: {
    initial_read_allowed_tools: string[];
  };
  codegraph: {
    exempt_agents: string[];
    exempt_path_patterns: string[];
  };
  git_guard: {
    break_glass_agents: string[];
  };
  config_guard: {
    approved_scripts: string[];
  };
  question_policy: {
    allow_all_agents: boolean;
  };
}

const DEFAULT_CONFIG: ExemptionConfig = {
  agent_identity: {
    privileged_agents: ["orchestrator", "super-admin"],
    dag_exempt_agents: ["meta-planner", "orchestrator", "super-admin", "knowledge-curator"],
  },
  anti_bypass: {
    guidance_gate_exempt_tools: ["clear_guidance"],
    guidance_gate_exempt_suffixes: ["_clear_guidance"],
    phase0_failure_exempt_tools: [
      "read", "Read", "config_read_attest", "skill_read_attest",
      "rule_read_attest", "checklist_status", "advance_checklist_phase",
    ],
    enforcement_passthrough_tools: ["question"]
  },
  phase0_enforce: {
    initial_read_allowed_tools: [
      "read", "Read", "skill","config_read_attest", "skill_read_attest",
      "rule_read_attest", "checklist_status", "advance_checklist_phase",
      "question"
    ],
  },
  codegraph: {
    exempt_agents: [],
    exempt_path_patterns: [
      "^\\.task_temp/", "^docs/", "^\\.opencode/agents/.*\\.md$",
      "^\\.opencode/legacy/agent-profiles/.*\\.md$",
      "^\\.understand-anything/", "^\\.codegraph/",
    ],
  },
  git_guard: {
    break_glass_agents: ["super-admin"],
  },
  config_guard: {
    approved_scripts: [
      ".opencode/scripts/install-hooks.ts",
      ".opencode/scripts/install-hooks.js",
    ],
  },
  question_policy: {
    allow_all_agents: true,
  },
};

let _config: ExemptionConfig | null = null;

function normalize(input: string | undefined | null): string {
  return (input || "").replace(/^@/, "").toLowerCase();
}

function loadConfig(): ExemptionConfig {
  if (_config) return _config;
  try {
    const root = process.env.OPENCODE_ROOT || process.cwd();
    const configPath = join(root, ".opencode", "project.config.json");
    if (existsSync(configPath)) {
      const raw = JSON.parse(readFileSync(configPath, "utf8"));
      const s = raw?.enforcement_exemptions;
      if (s) {
        _config = {
          agent_identity: {
            privileged_agents: s.agent_identity?.privileged_agents ?? DEFAULT_CONFIG.agent_identity.privileged_agents,
            dag_exempt_agents: s.agent_identity?.dag_exempt_agents ?? DEFAULT_CONFIG.agent_identity.dag_exempt_agents,
          },
          anti_bypass: {
            guidance_gate_exempt_tools: s.anti_bypass?.guidance_gate_exempt_tools ?? DEFAULT_CONFIG.anti_bypass.guidance_gate_exempt_tools,
            guidance_gate_exempt_suffixes: s.anti_bypass?.guidance_gate_exempt_suffixes ?? DEFAULT_CONFIG.anti_bypass.guidance_gate_exempt_suffixes,
            phase0_failure_exempt_tools: s.anti_bypass?.phase0_failure_exempt_tools ?? DEFAULT_CONFIG.anti_bypass.phase0_failure_exempt_tools,
            enforcement_passthrough_tools: s.anti_bypass?.enforcement_passthrough_tools ?? DEFAULT_CONFIG.anti_bypass.enforcement_passthrough_tools
          },
          phase0_enforce: {
            initial_read_allowed_tools: s.phase0_enforce?.initial_read_allowed_tools ?? DEFAULT_CONFIG.phase0_enforce.initial_read_allowed_tools,
          },
          codegraph: {
            exempt_agents: s.codegraph?.exempt_agents ?? DEFAULT_CONFIG.codegraph.exempt_agents,
            exempt_path_patterns: s.codegraph?.exempt_path_patterns ?? DEFAULT_CONFIG.codegraph.exempt_path_patterns,
          },
          git_guard: {
            break_glass_agents: s.git_guard?.break_glass_agents ?? DEFAULT_CONFIG.git_guard.break_glass_agents,
          },
          config_guard: {
            approved_scripts: s.config_guard?.approved_scripts ?? DEFAULT_CONFIG.config_guard.approved_scripts,
          },
          question_policy: {
            allow_all_agents: s.question_policy?.allow_all_agents ?? DEFAULT_CONFIG.question_policy.allow_all_agents,
          },
        };
        writeLog(SRC, "INFO", { event: "CONFIG-LOADED", source: "project.config.json" });
        return _config;
      }
    }
  } catch (e: any) {
    writeLog(SRC, "WARN", { event: "CONFIG-LOAD-FAILED", detail: e.message?.slice(0, 120) });
  }
  _config = DEFAULT_CONFIG;
  return _config;
}

// Public API

export function getExemptionConfig(): ExemptionConfig { return { ...loadConfig() }; }

export function isPrivilegedAgent(agent: string | undefined | null): boolean {
  return loadConfig().agent_identity.privileged_agents.includes(normalize(agent));
}

export function isDagExemptAgent(agent: string | undefined | null): boolean {
  return loadConfig().agent_identity.dag_exempt_agents.includes(normalize(agent));
}

export function isGuidanceGateExempt(tool: string): boolean {
  const cfg = loadConfig();
  if (cfg.anti_bypass.guidance_gate_exempt_tools.includes(tool)) return true;
  return cfg.anti_bypass.guidance_gate_exempt_suffixes.some((s) => tool.endsWith(s));
}


export function isPhase0FailureExempt(tool: string): boolean {
  return loadConfig().anti_bypass.phase0_failure_exempt_tools.includes(tool);
}

export function isInitialReadAllowed(tool: string): boolean {
  return loadConfig().phase0_enforce.initial_read_allowed_tools.includes(tool);
}

export function isCodeGraphExemptAgent(agent: string | undefined | null): boolean {
  return loadConfig().codegraph.exempt_agents.includes(normalize(agent));
}

export function getCodeGraphExemptPatterns(): RegExp[] {
  return loadConfig().codegraph.exempt_path_patterns.map((p) => new RegExp(p));
}

export function isBreakGlassAuthorized(agent: string | undefined | null): boolean {
  return loadConfig().git_guard.break_glass_agents.includes(normalize(agent));
}

export function isApprovedScriptCmd(cmd: string): boolean {
  return loadConfig().config_guard.approved_scripts.some((s) => cmd.includes(s));
}

export function isQuestionAllowedForAll(): boolean {
  return loadConfig().question_policy.allow_all_agents;
}

export function resetExemptionConfig(): void { _config = null; }

/** Tools that bypass ALL enforcement paths (Guidance Gate + Normal Enforcement) */
export function isEnforcementPassthrough(tool: string): boolean {
  return loadConfig().anti_bypass.enforcement_passthrough_tools.includes(tool);
}
