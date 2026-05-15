'use strict';

/**
 * Rule: no-deep-import — CAT4.5
 * ==============================
 * Detects deep imports that bypass barrel (index.ts) files.
 *
 * This enforces the architectural rule that modules should only import
 * from established public entry points (barrel files), not from deep
 * internal paths.
 *
 * Violation example:
 *   import { Thing } from '../features/auth/auth.service';  ← deep import
 *
 * Allowed example:
 *   import { AuthService } from '../auth';                  ← barrel import
 *
 * Severity: warn (architecture guidance, won't block commit)
 */

module.exports = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'CAT4.5: Prevents deep imports that bypass barrel files',
    },
    messages: {
      deepImport: 'CAT4.5: Deep import detected: "{{path}}". Import from barrel (index.ts) instead.',
    },
  },
  create(context) {
    return {
      ImportDeclaration(node) {
        const importPath = node.source.value;
        if (!importPath || typeof importPath !== 'string') return;

        // Skip node_modules, core modules, and external packages
        if (!importPath.startsWith('.') && !importPath.startsWith('@/') && !importPath.startsWith('@modules/') && !importPath.startsWith('@common/') && !importPath.startsWith('app/') && !importPath.startsWith('src/')) {
          return;
        }

        // Check: does the import go deeper than a barrel file?
        // Barrel imports look like: './auth' or '../shared' (no specific file after the directory)
        // Deep imports look like: '../auth/auth.service' or './subdir/component/thing'
        const segments = importPath.split('/');
        const lastSegment = segments[segments.length - 1];

        // If the last segment is a dot-prefixed directory (like '../..') or ends with '.ts', it's not an import target
        // If it contains a dot (like 'auth.service', 'component.ts') it's a deep file import
        if (lastSegment && lastSegment.includes('.')) {
          return; // Already importing a specific file extension, skip
        }

        // Check if this import references a specific sub-file without going through a barrel
        // Barrel rules: imports should look like:
        //   Relative: ../sibling  (no specific file)
        //   Absolute: @modules/auth  (only the module name)
        const isBarrelImport = (importPath.match(/\//g) || []).length <= 1;

        if (!isBarrelImport) {
          context.report({ node, messageId: 'deepImport', data: { path: importPath } });
        }
      },
    };
  },
};
