/**
 * Safe Bash Tool - Allowlisted shell command execution
 * Hardened constraint: Only allowlisted commands may execute
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Default allowlist for safe bash commands
const DEFAULT_ALLOWLIST = [
  'npm run *',
  'npx jest *',
  'npx tsc *',
  'npx eslint *',
  'node * --help',
  'node *.js',
  'node *.ts',
  'git status',
  'git log *',
  'git diff *',
  'git add *',
  'git commit *',
  'docker --version',
  'docker-compose --version',
  'echo *',
  'cat *',
  'ls *',
  'pwd',
  'mkdir -p *',
  'rm -rf .task_temp/*',
  'touch *',
  'cp * *',
  'mv * *',
  'grep *',
  'find *',
  'head *',
  'tail *',
  'wc -l *',
  'sort *',
  'uniq *',
  'whoami',
  'date',
  'uname *',
  'which *',
  'env | grep *',
];

// Agent-specific allowlist extensions
const AGENT_ALLOWLISTS = {
  '@CI-CD-Agent': [
    'docker build *',
    'docker push *',
    'docker pull *',
    'docker run *',
    'docker-compose up *',
    'docker-compose down *',
    'docker ps *',
    'docker images *',
    'docker logs *',
    'kubectl *',
    'helm *',
    'terraform *',
    'ansible-playbook *',
  ],
  '@Coder-BE': [
    'npx prisma *',
    'npm run db:*',
    'npm run test:*',
    'npm run build',
    'npm run lint',
    'npm run format',
    'curl *',
  ],
};

// Dangerous command patterns (always blocked regardless of allowlist)
const DANGEROUS_PATTERNS = [
  /rm\s+.*\.(json|yaml|yml|md|ts|js)\b/i,  // Don't delete source files
  />\s*\.(opencode|git)/i,  // Don't redirect to framework dirs
  /curl\s+.*\|\s*sh/i,  // No pipe to shell
  /wget\s+.*\|\s*sh/i,  // No pipe to shell
  /eval\s*\(/i,  // No eval
  /exec\s*\(/i,  // No exec
  /child_process/i,  // No child_process in child_process
  /require\s*\(\s*['"]http['"]\s*\)/i,  // No HTTP requests
  /require\s*\(\s*['"]https['"]\s*\)/i,  // No HTTPS requests
];

/**
 * Match command against glob pattern
 */
function matchGlob(command, pattern) {
  const regex = pattern
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]');
  return new RegExp(`^${regex}$`, 'i').test(command.trim());
}

/**
 * Check if command matches any pattern in allowlist
 */
function isAllowed(command, allowlist) {
  return allowlist.some(pattern => matchGlob(command, pattern));
}

/**
 * Check if command contains dangerous patterns
 */
function isDangerous(command) {
  return DANGEROUS_PATTERNS.some(pattern => pattern.test(command));
}

/**
 * Get the effective allowlist for an agent
 */
function getAllowlist(agent) {
  const extensions = AGENT_ALLOWLISTS[agent] || [];
  return [...DEFAULT_ALLOWLIST, ...extensions];
}

/**
 * Log safe bash action
 */
function logAction(result) {
  const logDir = path.join(process.cwd(), '.opencode', 'logs');
  const logFile = path.join(logDir, 'safe-bash.log');
  
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
  
  const entry = {
    timestamp: new Date().toISOString(),
    ...result,
  };
  
  fs.appendFileSync(logFile, JSON.stringify(entry) + '\n');
}

/**
 * Execute safe bash command
 */
function safeBashTool(options) {
  const {
    command,
    timeout = 300000, // 5 minutes
    dryRun = false,
    agent = process.env.FRAMEWORK_AGENT || 'unknown',
  } = options;
  
  const allowlist = getAllowlist(agent);
  
  // Check for dangerous patterns
  if (isDangerous(command)) {
    const result = {
      command,
      agent,
      allowed: false,
      executed: false,
      exitCode: null,
      stdout: '',
      stderr: '',
      blockedReason: 'DANGEROUS_PATTERN: Command matches blocked pattern',
      timestamp: new Date().toISOString(),
    };
    logAction(result);
    return result;
  }
  
  // Check allowlist
  if (!isAllowed(command, allowlist)) {
    const result = {
      command,
      agent,
      allowed: false,
      executed: false,
      exitCode: null,
      stdout: '',
      stderr: '',
      blockedReason: `NOT_IN_ALLOWLIST: Command not in agent ${agent} allowlist`,
      timestamp: new Date().toISOString(),
    };
    logAction(result);
    return result;
  }
  
  // Dry run - validate only
  if (dryRun) {
    const result = {
      command,
      agent,
      allowed: true,
      executed: false,
      exitCode: null,
      stdout: '',
      stderr: '',
      blockedReason: null,
      timestamp: new Date().toISOString(),
    };
    logAction(result);
    return result;
  }
  
  // Execute command
  try {
    const stdout = execSync(command, {
      timeout,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    
    const result = {
      command,
      agent,
      allowed: true,
      executed: true,
      exitCode: 0,
      stdout: stdout.trim(),
      stderr: '',
      blockedReason: null,
      timestamp: new Date().toISOString(),
    };
    logAction(result);
    return result;
  } catch (error) {
    const result = {
      command,
      agent,
      allowed: true,
      executed: true,
      exitCode: error.status || 1,
      stdout: error.stdout?.toString() || '',
      stderr: error.stderr?.toString() || error.message,
      blockedReason: null,
      timestamp: new Date().toISOString(),
    };
    logAction(result);
    return result;
  }
}

module.exports = {
  safeBashTool,
  DEFAULT_ALLOWLIST,
  AGENT_ALLOWLISTS,
  DANGEROUS_PATTERNS,
  matchGlob,
  isAllowed,
  isDangerous,
  getAllowlist,
};
