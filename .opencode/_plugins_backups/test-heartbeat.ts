// test-heartbeat.ts — minimal plugin to verify OpenCode scans .opencode/plugins/
import * as fs from "node:fs";
fs.writeFileSync("/tmp/test-heartbeat-loaded.txt", `${new Date().toISOString()} test plugin loaded\n`, "utf8");
export default (async (_ctx: any) => { return {}; }) as any;
