'use strict';

/**
 * Rule: no-skipped-tests
 * CAT1.2: Detects skipped tests (describe.skip, it.skip, test.skip, xdescribe, xit) in spec files.
 * These indicate tests that are intentionally disabled, reducing test coverage.
 */
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'CAT1.2: forbid skipped tests (describe.skip, it.skip, xdescribe, xit)',
    },
    messages: {
      skippedSuite: 'CAT1.2: Test suite is skipped via "{{method}}". Remove the .skip() or replace with a valid condition.',
      skippedTest: 'CAT1.2: Test is skipped via "{{method}}". Remove the .skip() or replace with a valid condition.',
    },
  },
  create(context) {
    const filename = context.getFilename();
    if (!filename.endsWith('.spec.ts') && !filename.endsWith('.test.ts')) {
      return {};
    }

    return {
      CallExpression(node) {
        if (!node.callee || node.callee.type !== 'MemberExpression') return;

        const { object, property } = node.callee;

        // describe.skip(...) or it.skip(...) or test.skip(...)
        if (property && property.type === 'Identifier' && property.name === 'skip') {
          if (object && object.type === 'Identifier') {
            if (object.name === 'describe') {
              context.report({
                node,
                messageId: 'skippedSuite',
                data: { method: 'describe.skip' },
              });
            } else if (object.name === 'it' || object.name === 'test') {
              context.report({
                node,
                messageId: 'skippedTest',
                data: { method: `${object.name}.skip` },
              });
            }
          }
        }

        // xdescribe(...) or xit(...)
        if (object && object.type === 'Identifier') {
          const calleeName = object.name;
          if (calleeName === 'xdescribe') {
            context.report({
              node,
              messageId: 'skippedSuite',
              data: { method: 'xdescribe' },
            });
          } else if (calleeName === 'xit') {
            context.report({
              node,
              messageId: 'skippedTest',
              data: { method: 'xit' },
            });
          }
        }
      },

      // test.skip(...) also matches as Jest shorthand
      MemberExpression(node) {
        if (node.object?.name === 'test' && node.property?.name === 'skip') {
          context.report({
            node,
            messageId: 'skippedTest',
            data: { method: 'test.skip' },
          });
        }
      },
    };
  },
};
