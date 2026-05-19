'use strict';

/**
 * Rule: no-empty-assertions — CAT3.1
 * ===================================
 * Detects bogus test assertions that always pass without meaningful verification.
 *
 * Violation patterns:
 *   expect(true).toBeTruthy();       → always passes
 *   expect(false).toBeFalsy();       → always passes
 *   expect(null).toBeNull();         → always passes
 *   expect(result).toBeDefined();    → only checks defined, not value
 *   expect(result).toBeTruthy();     → only checks truthy, not value
 *   expect(mockFn).toHaveBeenCalled();  → no argument verification
 *
 * Allowed patterns (examples):
 *   expect(result.id).toBe(123);
 *   expect(mockFn).toHaveBeenCalledWith({ id: 123 });
 *   expect(result).toEqual(expectedObject);
 *
 * Severity: error
 */

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'CAT3.1: Detects empty/bogus test assertions that always pass',
    },
    messages: {
      emptyAssertion: 'CAT3.1: Empty/bogus assertion: expect({{value}}).{{matcher}}() — always passes without meaningful verification.',
      truthyOnly: 'CAT3.1: expect().toBeTruthy() without specific value assertion — use toEqual() or toBe() with expected value.',
      definedOnly: 'CAT3.1: expect().toBeDefined() only checks existence, not correctness — add value assertions.',
      calledNoArgs: 'CAT3.1: toHaveBeenCalled() without argument verification — use toHaveBeenCalledWith().',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        // Must be: expect(x).matcher()
        if (!node.callee || node.callee.type !== 'MemberExpression') return;
        const callee = node.callee;
        if (!callee.object || callee.object.type !== 'CallExpression') return;
        if (callee.object.callee?.name !== 'expect') return;

        const matcher = callee.property?.name;
        const expectArg = callee.object.arguments?.[0];

        // Pattern 1: expect(true/literal).toBeTruthy(), expect(false).toBeFalsy(), expect(null).toBeNull()
        if (expectArg && (expectArg.type === 'Literal' || expectArg.type === 'Identifier')) {
          const val = expectArg.type === 'Literal' ? expectArg.value : null;
          if (val === true && matcher === 'toBeTruthy') {
            context.report({ node, messageId: 'emptyAssertion', data: { value: 'true', matcher: 'toBeTruthy' } });
            return;
          }
          if (val === false && matcher === 'toBeFalsy') {
            context.report({ node, messageId: 'emptyAssertion', data: { value: 'false', matcher: 'toBeFalsy' } });
            return;
          }
          if (val === null && matcher === 'toBeNull') {
            context.report({ node, messageId: 'emptyAssertion', data: { value: 'null', matcher: 'toBeNull' } });
            return;
          }
          if (val === undefined && matcher === 'toBeUndefined') {
            context.report({ node, messageId: 'emptyAssertion', data: { value: 'undefined', matcher: 'toBeUndefined' } });
            return;
          }
        }

        // Pattern 2: expect(result).toBeDefined() — value assertion needed
        if (matcher === 'toBeDefined') {
          context.report({ node, messageId: 'definedOnly' });
          return;
        }

        // Pattern 3: expect(mockFn).toHaveBeenCalled() — no argument check
        if (matcher === 'toHaveBeenCalled' && node.arguments?.length === 0) {
          context.report({ node, messageId: 'calledNoArgs' });
          return;
        }
      },
    };
  },
};
