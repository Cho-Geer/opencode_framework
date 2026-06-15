# Bun TypeScript Support

**Source**: https://bun.sh/docs/typescript  
**Domain**: infrastructure  
**Retrieved**: 2026-06-14  
**TTL**: 90 days

---

## Native TypeScript Execution

Bun executes TypeScript (`.ts`) and TypeScript JSX (`.tsx`) files **natively** without any additional configuration, transpilation step, or build tool. This is the single most important architectural difference from Node.js.

### Key Finding: `require('./file.ts')` Works Natively

```javascript
// ✅ Works natively in Bun — no ts-node, no build step
const myModule = require('./my-module.ts');

// ✅ Also works for .tsx files
const component = require('./MyComponent.tsx');
```

In Node.js, this would require `ts-node` (with `--loader ts-node/esm` for ESM) or a separate TypeScript compilation step. In Bun, it works out of the box.

## How It Works

Bun's TypeScript support is powered by its **built-in transpiler**:

1. **Parsing**: Bun parses TypeScript source files directly
2. **Type-stripping**: Type annotations are stripped at parse time (no type-checking is performed during execution)
3. **Transpilation**: JSX, decorators, enums, and other TypeScript features are transpiled to plain JavaScript
4. **Execution**: The resulting JavaScript is executed by JavaScriptCore

**Important**: Bun does **not** perform type-checking. For type safety, use `tsc --noEmit` as a separate step:

```bash
# Type-check without emitting (recommended in CI)
tsc --noEmit

# Bun runs the file regardless of type errors
bun run index.ts
```

## Supported TypeScript Features

| Feature | Support | Notes |
|---------|:-------:|-------|
| Type annotations | ✅ | Fully supported, stripped at runtime |
| Interfaces / Type aliases | ✅ | Stripped at runtime |
| Enums | ✅ | Transpiled to JavaScript objects |
| Decorators | ✅ | Experimental and TC39 decorators |
| JSX / TSX | ✅ | `bun run App.tsx` works natively |
| `paths` / `baseUrl` | ✅ | Respects `tsconfig.json` compiler options |
| `const` assertions | ✅ | `as const` supported |
| Namespaces | ✅ | Transpiled |
| Parameter properties | ✅ | `constructor(public x: number)` works |

## tsconfig.json

Bun reads `tsconfig.json` for module resolution and path mapping, **not** for type-checking:

```json
{
  "compilerOptions": {
    // Bun uses these for module resolution
    "baseUrl": ".",
    "paths": {
      "@app/*": ["./src/*"]
    },
    
    // Bun respects JSX configuration
    "jsx": "react-jsx",
    
    // These are IGNORED by Bun's transpiler
    "target": "esnext",
    "module": "esnext",
    "strict": true
  }
}
```

**Compiler options that Bun respects** for module resolution:
- `baseUrl`
- `paths`
- `jsx` / `jsxFactory` / `jsxFragmentFactory` / `jsxImportSource`

**Compiler options that Bun ignores** (only used by `tsc` type-checking):
- `target`, `module`, `moduleResolution`
- `strict`, `noImplicitAny`
- `outDir`, `rootDir`
- All type-checking flags

## TypeScript with Bun APIs

Some Bun-specific APIs have TypeScript types:

```typescript
// Install Bun types for IDE support
bun add -d @types/bun

// Use Bun-specific APIs
const server = Bun.serve({
  port: 3000,
  fetch(req: Request): Response {
    return new Response("Hello from Bun!");
  },
});

console.log(`Server running on ${server.url}`);
```

## Common Patterns

### Running TypeScript directly

```bash
# No build step needed
bun run src/index.ts

# With file watching (auto-restart on changes)
bun --watch src/index.ts

# Run a script from package.json
bun run start
```

### Importing TypeScript modules

```typescript
// ✅ Both import and require work for .ts files
import { myFunction } from './utils.ts';
const { myFunction } = require('./utils.ts');

// ✅ Mixed .ts and .js imports work transparently
import { api } from './api.js';   // imports api.ts actually
import { ui } from './ui';        // resolves to ui.ts or ui/index.ts
```

### TypeScript in tests

```typescript
// test/math.test.ts — runs directly with `bun test`
import { expect, test } from "bun:test";

test("addition", () => {
  expect(1 + 1).toBe(2);
});
```

## Limitations and Caveats

1. **No runtime type-checking**: Type errors are not caught at runtime. Run `tsc --noEmit` in CI.
2. **Experimental decorators**: TC39 Stage 3 decorators are preferred over legacy TypeScript decorators.
3. **const enum**: Bun does not support `const enum` (TypeScript-specific optimization). Use regular `enum` or string unions instead.
4. **namespace merging**: Complex namespace merging patterns may not work correctly.
5. **`.d.ts` files**: Only used for editor/IDE support, not by Bun's runtime.
