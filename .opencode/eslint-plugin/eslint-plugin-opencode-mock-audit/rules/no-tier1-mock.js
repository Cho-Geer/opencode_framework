'use strict';

/**
 * Rule: no-tier1-mock
 * CAT1.1: Detects jest.spyOn/jest.mock/direct mock on TIER1 services (PrismaService, RedisService, ConfigService).
 * 
 * Reads TIER1 service list from .opencode/generated/tier-rules.json at runtime.
 * This file is auto-generated from contract.yaml x-eslint-policy before each ESLint run.
 */
const fs = require('fs');
const path = require('path');

const TIER_RULES_PATH = path.resolve(
  __dirname, '..', '..', '..', '..', 'generated', 'tier-rules.json'
);

function getTier1Services() {
  try {
    if (fs.existsSync(TIER_RULES_PATH)) {
      const config = JSON.parse(fs.readFileSync(TIER_RULES_PATH, 'utf-8'));
      return config.tier1 || [];
    }
  } catch {
    // Fallback: hardcoded defaults if tier-rules.json not generated yet
  }
  return ['prisma', 'prismaService', 'redisService', 'configService'];
}

const FORBIDDEN_METHODS = [
  'mockResolvedValue', 'mockImplementation', 'mockReturnValue',
  'mockResolvedValueOnce', 'mockImplementationOnce', 'mockReturnValueOnce',
  'mockRejectedValue', 'mockRejectedValueOnce',
];

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'CAT1.1: forbid jest.spyOn/jest.mock on TIER1 services',
    },
    messages: {
      tier1Mock: 'CAT1.1: TIER1 service "{{service}}" is mocked. Use Testcontainers real instance instead.',
      tier1JestMock: 'CAT1.1: jest.mock("{{module}}") is not allowed for TIER1 modules. Use Testcontainers.',
    },
  },
  create(context) {
    const TIER1 = getTier1Services();

    return {
      // Detects: jest.spyOn(tier1Service.xxx, 'method').mockResolvedValue(...)
      CallExpression(node) {
        if (!node.callee || node.callee.type !== 'MemberExpression') return;

        // Check if this is .mockResolvedValue() or similar
        if (!FORBIDDEN_METHODS.includes(node.callee.property?.name)) return;

        // Walk up to find the jest.spyOn(...) or direct mock
        let current = node.callee.object;
        let serviceName = '';

        // Navigate the member expression chain to extract service variable name
        while (current) {
          if (current.type === 'CallExpression' &&
              current.callee?.type === 'MemberExpression' &&
              current.callee?.object?.name === 'jest' &&
              current.callee?.property?.name === 'spyOn') {
            // jest.spyOn(prismaService.xxx, 'method')
            const arg0 = current.arguments?.[0];
            if (arg0?.type === 'MemberExpression') {
              serviceName = arg0.object?.name || '';
            } else if (arg0?.type === 'Identifier') {
              serviceName = arg0.name;
            }
            break;
          }
          if (current.type === 'MemberExpression' && current.object?.type === 'Identifier') {
            serviceName = current.object.name;
            break;
          }
          if (current.type === 'Identifier') {
            serviceName = current.name;
            break;
          }
          current = current.object;
        }

        if (serviceName && TIER1.some(s => serviceName.toLowerCase().includes(s.toLowerCase()))) {
          context.report({
            node,
            messageId: 'tier1Mock',
            data: { service: serviceName },
          });
        }
      },

      // Detects: jest.mock('@prisma/client')
      CallExpression(node) {
        if (node.callee?.type === 'MemberExpression' &&
            node.callee?.object?.name === 'jest' &&
            node.callee?.property?.name === 'mock' &&
            node.arguments?.[0]?.type === 'Literal') {

          const moduleName = node.arguments[0].value;
          for (const svc of TIER1) {
            if (moduleName.toLowerCase().includes(svc.toLowerCase().replace(/service$/, ''))) {
              context.report({
                node,
                messageId: 'tier1JestMock',
                data: { module: moduleName },
              });
              break;
            }
          }
        }
      },
    };
  },
};
