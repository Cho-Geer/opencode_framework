'use strict';

/**
 * Rule: max-complexity-enforce — CAT3.4
 * ======================================
 * Limits cyclomatic complexity of functions to prevent AI generating overly
 * complex code that's hard to test (and thus violates low-mock principle).
 *
 * Default threshold: 15 (recommended by SonarQube)
 * Reads from contract.yaml x-eslint-policy.quality_rules.max_complexity
 *
 * Severity: warn (won't block commit, but will be flagged)
 */

const fs = require('fs');
const path = require('path');

const OPENCODE_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');
const GENERATED_DIR = path.join(OPENCODE_ROOT, '.qoder', 'generated');
const TIER_RULES_PATH = path.join(GENERATED_DIR, 'tier-rules.json');

function getMaxComplexity() {
  try {
    if (fs.existsSync(TIER_RULES_PATH)) {
      const config = JSON.parse(fs.readFileSync(TIER_RULES_PATH, 'utf-8'));
      return config.max_complexity || 15;
    }
  } catch {}
  return 15;
}

module.exports = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'CAT3.4: Limits cyclomatic complexity to prevent AI over-complexity',
    },
    messages: {
      tooComplex: 'CAT3.4: Function "{{name}}" has cyclomatic complexity {{complexity}}, exceeding limit of {{limit}}. Refactor to reduce branching.',
    },
  },
  create(context) {
    const limit = getMaxComplexity();

    function checkComplexity(node) {
      const complexity = calculateCyclomaticComplexity(node);
      if (complexity > limit) {
        const name = node.id?.name || node.key?.name || '(anonymous)';
        context.report({
          node,
          messageId: 'tooComplex',
          data: { name, complexity, limit: String(limit) },
        });
      }
    }

    return {
      FunctionDeclaration: checkComplexity,
      FunctionExpression: checkComplexity,
      ArrowFunctionExpression: checkComplexity,
    };
  },
};

function calculateCyclomaticComplexity(node) {
  let complexity = 1;
  function visit(n) {
    if (!n || typeof n !== 'object') return;
    if (n.type === 'IfStatement' || n.type === 'ConditionalExpression') { complexity++; }
    if (n.type === 'LogicalExpression' && (n.operator === '&&' || n.operator === '||')) { complexity++; }
    if (n.type === 'SwitchCase' && n.consequent?.length > 0) { complexity++; }
    if (n.type === 'ForStatement' || n.type === 'ForInStatement' || n.type === 'ForOfStatement') { complexity++; }
    if (n.type === 'WhileStatement' || n.type === 'DoWhileStatement') { complexity++; }
    if (n.type === 'CatchClause') { complexity++; }

    // Continue recursion on function bodies
    if (n.body && typeof n.body === 'object') {
      if (Array.isArray(n.body)) n.body.forEach(visit);
      else visit(n.body);
    }
    // Visit child nodes
    for (const key of Object.keys(n)) {
      if (key === 'parent' || key === 'comments') continue;
      const child = n[key];
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child === 'object' && child.type) visit(child);
    }
  }
  visit(node);
  return complexity;
}
