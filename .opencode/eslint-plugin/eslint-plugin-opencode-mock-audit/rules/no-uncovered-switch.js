'use strict';

/**
 * Rule: no-uncovered-switch
 * CAT3.2: Detects switch statements without a default branch.
 * Missing default means the switch silently ignores unknown cases.
 */
module.exports = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'CAT3.2: switch statements should have a default branch',
    },
    messages: {
      missingDefault: 'CAT3.2: Switch statement has no default branch. Add a default case to handle unknown values.',
    },
  },
  create(context) {
    return {
      SwitchStatement(node) {
        const hasDefault = node.cases.some(c => !c.test);
        if (!hasDefault) {
          context.report({
            node,
            messageId: 'missingDefault',
          });
        }
      },
    };
  },
};
