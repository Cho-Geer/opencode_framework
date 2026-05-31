'use strict';

/**
 * Rule: no-only-left — CAT3.3
 * ===========================
 * Detects it.only(), describe.only(), test.only() left in test files.
 * These are commonly left by AI agents during debugging and must be removed.
 *
 * Severity: error (commits with .only should be rejected)
 */

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'CAT3.3: Detects debugging-only it.only/describe.only/test.only calls',
    },
    messages: {
      onlyLeft: 'CAT3.3: {{type}}.only() left in test file — remove before committing. Only this test will run.',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (!node.callee || node.callee.type !== 'MemberExpression') return;
        const objectName = node.callee.object?.name;
        const propertyName = node.callee.property?.name;

        if (['it', 'describe', 'test'].includes(objectName) && propertyName === 'only') {
          context.report({ node, messageId: 'onlyLeft', data: { type: objectName } });
        }
      },
    };
  },
};
