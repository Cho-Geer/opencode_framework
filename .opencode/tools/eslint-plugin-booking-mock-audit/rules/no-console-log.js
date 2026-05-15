'use strict';

/**
 * Rule: no-console-log
 * CAT2.1: Detects console.log/console.error/console.warn in production (non-spec) code.
 * Debug logging should use the proper logger (e.g., Logger from @nestjs/common).
 */
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'CAT2.1: forbid console.log/error/warn in production code',
    },
    messages: {
      consoleLog: 'CAT2.1: console.{{method}}() detected in production code. Use Logger (NestJS) or a proper logging service instead.',
    },
  },
  create(context) {
    const filename = context.getFilename();
    // Allow console in test files and config files
    if (filename.endsWith('.spec.ts') || filename.endsWith('.test.ts') ||
        filename.endsWith('.config.ts') || filename.includes('eslint')) {
      return {};
    }

    return {
      CallExpression(node) {
        if (!node.callee || node.callee.type !== 'MemberExpression') return;

        const object = node.callee.object;
        const property = node.callee.property;

        if (object?.type === 'Identifier' && object.name === 'console' &&
            property?.type === 'Identifier' &&
            ['log', 'error', 'warn', 'debug', 'info'].includes(property.name)) {
          context.report({
            node,
            messageId: 'consoleLog',
            data: { method: property.name },
          });
        }
      },
    };
  },
};
