'use strict';

/**
 * Rule: tier3-verify
 * CAT1.3: TIER3 mocks must verify that the mocked method was called with expected parameters.
 * Detects: jest.spyOn(tier3Service, 'method').mockResolvedValue(...)
 * Requires: expect(tier3Service.method).toHaveBeenCalledWith(...) in the same test case.
 * 
 * Reads TIER3 service list from .opencode/generated/tier-rules.json at runtime.
 */
const fs = require('fs');
const path = require('path');

const TIER_RULES_PATH = path.resolve(
  __dirname, '..', '..', '..', '..', 'generated', 'tier-rules.json'
);

function getTier3Services() {
  try {
    if (fs.existsSync(TIER_RULES_PATH)) {
      const config = JSON.parse(fs.readFileSync(TIER_RULES_PATH, 'utf-8'));
      return config.tier3 || [];
    }
  } catch {}
  return ['EmailService', 'SMSService'];
}

module.exports = {
  meta: {
    type: 'warn',
    docs: {
      description: 'CAT1.3: TIER3 mocks must verify call parameters with toHaveBeenCalledWith',
    },
    messages: {
      missingVerify: 'CAT1.3: TIER3 mock on "{{service}}" must be verified with toHaveBeenCalledWith() in the same test case',
    },
  },
  create(context) {
    const TIER3 = getTier3Services();
    const mockSpyRefs = new Map();  // testName -> Set<serviceName>

    return {
      // Track jest.spyOn on TIER3 services
      'CallExpression[callee.object.name="jest"][callee.property.name="spyOn"]'(node) {
        const arg0 = node.arguments?.[0];
        let serviceName = '';
        if (arg0?.type === 'MemberExpression') {
          serviceName = arg0.object?.name || arg0.property?.name || '';
        } else if (arg0?.type === 'Identifier') {
          serviceName = arg0.name;
        }

        if (!serviceName) return;
        if (!TIER3.some(s => serviceName.toLowerCase().includes(s.toLowerCase()))) return;

        // Find the containing test/it block
        let scope = node;
        while (scope) {
          if (scope.type === 'CallExpression' &&
              ['it', 'test'].includes(scope.callee?.name)) {
            const testName = context.getSourceCode().getText(scope).substring(0, 80);
            if (!mockSpyRefs.has(testName)) {
              mockSpyRefs.set(testName, new Set());
            }
            mockSpyRefs.get(testName).add(serviceName);
            break;
          }
          scope = scope.parent;
        }
      },

      // Check that toHaveBeenCalledWith exists for each mock
      'CallExpression[callee.property.name="toHaveBeenCalledWith"]'(node) {
        // Find the containing test and remove the service from required verification
        let scope = node;
        while (scope) {
          if (scope.type === 'CallExpression' &&
              ['it', 'test'].includes(scope.callee?.name)) {
            const testName = context.getSourceCode().getText(scope).substring(0, 80);
            if (mockSpyRefs.has(testName)) {
              mockSpyRefs.get(testName).clear();  // all verified
            }
            break;
          }
          scope = scope.parent;
        }
      },

      // At end of each test, report if verification is missing
      'CallExpression[callee.name=/^(it|test)$/]:exit'(node) {
        const testName = context.getSourceCode().getText(node).substring(0, 80);
        if (mockSpyRefs.has(testName) && mockSpyRefs.get(testName).size > 0) {
          for (const svc of mockSpyRefs.get(testName)) {
            context.report({
              node,
              messageId: 'missingVerify',
              data: { service: svc },
            });
          }
          mockSpyRefs.delete(testName);
        }
      },
    };
  },
};
