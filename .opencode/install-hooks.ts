#!/usr/bin/env bun
// Compatibility re-export for legacy callers that reference install-hooks
// from the .opencode/ root. The canonical implementation lives in
// .opencode/scripts/install-hooks.ts.
module.exports = require("./scripts/install-hooks");
