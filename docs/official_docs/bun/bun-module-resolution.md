# Bun Module Resolution

**Source**: https://bun.sh/docs/runtime/modules  
**Domain**: infrastructure  
**Retrieved**: 2026-06-14  
**TTL**: 90 days

---

## Overview

Bun's module system is designed to provide **maximum compatibility** with both Node.js (CommonJS) and modern ES modules. The key architectural advantage is that Bun supports both `require()` and `import` syntax **simultaneously and interchangeably** in the same file, without configuration.

### Key Finding: Both `require` and `import` Supported, Freely Mixable

```javascript
// ✅ Freely mix require and import in the same file
import { readFileSync } from 'fs';
const path = require('path');
import express from 'express';
const chalk = require('chalk');
```

In Node.js, this would require either:
- Using `.mjs` / `.cjs` file extensions
- Setting `"type": "module"` in `package.json`
- Using `--input-type=module` flag

In Bun, **none of this matters** — the module system automatically handles both syntaxes.

## Module Resolution Algorithm

Bun implements **Node.js-compatible module resolution** with the following search order:

### For `require('./foo')` or `import './foo'`:

```
1. ./foo          (exact match)
2. ./foo.ts       (TypeScript file)
3. ./foo.tsx      (TypeScript JSX)
4. ./foo.jsx      (JSX)
5. ./foo.js       (JavaScript)
6. ./foo/index.ts (directory index)
7. ./foo/index.js (directory index)
8. ./foo/index.tsx
9. ./foo/package.json → "main" field
```

### For `require('foo')` or `import 'foo'` (bare specifier):

```
1. Built-in module (e.g., 'fs', 'path', 'bun:test')
2. ./node_modules/foo/package.json → "main" / "exports" field
3. ../node_modules/foo/    (traverse up)
4. ../../node_modules/foo/ (continue traversing)
```

## CommonJS (require) Support

Bun fully implements the CommonJS module system:

```javascript
// CommonJS exports work as expected
module.exports = { foo: 1 };
exports.bar = 2;

// require() works with .ts, .tsx, .js extensions
const mod = require('./my-module.ts');
const pkg = require('lodash');
```

### __dirname and __filename

Both are available in CommonJS modules:

```javascript
// Works in Bun for CommonJS files
console.log(__dirname);   // /path/to/project/src
console.log(__filename);  // /path/to/project/src/index.ts
```

In ES modules, use `import.meta`:

```typescript
// ES module equivalent
const __dirname = import.meta.dir;
const __filename = import.meta.path;
```

## ES Module (import/export) Support

```typescript
// Named imports/exports
import { named } from './module.ts';
export const value = 42;
export default class MyClass {}

// Dynamic imports (returns a Promise)
const module = await import('./dynamic.ts');

// import.meta
console.log(import.meta.url);   // file:///path/to/file.ts
console.log(import.meta.dir);    // /path/to (absolute path)
```

## CJS/ESM Interop

Bun provides seamless interop between CommonJS and ES modules:

### Importing CJS from ESM

```typescript
// ✅ CJS modules can be imported via ESM syntax
import express from 'express';        // CJS default export
import { Router } from 'express';     // Named import from CJS

// ✅ Dynamic import also works
const chalk = await import('chalk');
```

### Requiring ESM from CJS

```javascript
// ⚠️ require() of ESM modules: use .default to access default export
const esmModule = require('./esm-module.ts');
console.log(esmModule.default);  // Access the default export
console.log(esmModule.named);    // Access named exports
```

### Live Bindings

Unlike Node.js (prior to v22), Bun supports **live bindings** between CJS and ESM. When a CJS module's `module.exports` object is mutated, ESM imports reflect the change:

```javascript
// cjs-module.js
module.exports = { count: 0 };
setInterval(() => { module.exports.count++; }, 1000);
```

```typescript
// esm-consumer.ts
import { count } from './cjs-module.js';
// count is a live binding — it updates every second
```

## package.json Module Fields

Bun respects these `package.json` fields for resolution:

| Field | Purpose | Priority |
|-------|---------|----------|
| `"exports"` | Modern entry point mapping (conditional exports) | Highest |
| `"main"` | CommonJS entry point | Used when `"exports"` is absent |
| `"module"` | ESM entry point | Used by bundlers; Bun prefers `"exports"` |
| `"type": "module"` | Treat `.js` files as ESM | Bun auto-detects, this is optional |
| `"browser"` | Browser-specific entry point | Used for browser-targeted builds |

## Extensionless Imports

Bun resolves extensionless imports by trying extensions in order:

```typescript
// import './utils'  → resolves to (in order):
// 1. ./utils
// 2. ./utils.ts
// 3. ./utils.tsx
// 4. ./utils.jsx
// 5. ./utils.js
// 6. ./utils/index.ts
// 7. ./utils/index.js
// 8. ./utils/package.json → "main"
```

## Path Mapping (tsconfig.json paths)

Bun respects `compilerOptions.paths` from `tsconfig.json`:

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@app/*": ["./src/*"],
      "@shared/*": ["./shared/*", "./lib/shared/*"]
    }
  }
}
```

```typescript
// These now resolve correctly
import { AppModule } from '@app/modules/app.module';
import { utils } from '@shared/utils';
```

## Bun-Specific Modules

Bun provides built-in modules prefixed with `bun:`:

```typescript
import { test, expect, describe } from "bun:test";     // Test runner
import { Database } from "bun:sqlite";                  // SQLite database
import { FFI } from "bun:ffi";                          // Foreign Function Interface
import { password } from "bun:jwt";                     // JWT utilities
import { $ } from "bun:shell";                          // Shell command execution
import { file, write } from "bun";                      // File I/O
```

## Common Pitfalls

1. **`.mjs` / `.cjs` extensions**: Bun handles these but they are generally unnecessary. Use `.ts` or `.js` for simplicity.
2. **Circular dependencies**: Bun handles circular `require()` calls (returns partial exports), but circular `import` can cause TDZ errors.
3. **`module.exports` vs `export default`**: When consuming CJS from ESM, `import x from 'cjs-module'` gets the `module.exports` value. For named CJS exports, use `import { name } from 'cjs-module'`.
4. **Top-level await**: Available in both `.ts` and `.js` files without `"type": "module"`.
5. **`require.extensions`**: Not supported in Bun. Use Bun's plugin system for custom loaders.

## Comparison with Node.js

| Feature | Bun | Node.js |
|---------|-----|---------|
| CJS + ESM mixing | ✅ Always allowed | ⚠️ Requires `.mjs`/`.cjs` or `"type"` field |
| TypeScript import | ✅ Native | ❌ Requires loader/transpiler |
| Extensionless imports | ✅ Auto-resolve to `.ts`, `.js`, etc. | ⚠️ Limited auto-resolution |
| Live CJS↔ESM bindings | ✅ Supported | ⚠️ Node 22+ |
| `require.extensions` | ❌ Not supported | ✅ Supported |
| `import.meta.dir` | ✅ Available | ✅ Node 21+ |
