#!/usr/bin/env bun
// Compatibility re-export for legacy callers that reference state-integrity-scan
// from the .opencode/ root. The canonical implementation lives in
// .opencode/scripts/state-integrity-scan.ts.
module.exports = require("./scripts/state-integrity-scan");
