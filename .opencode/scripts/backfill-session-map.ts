#!/usr/bin/env bun
/**
 * 一次性回填脚本：从 SDK session 表回填 session_map + 清理 orphan
 * 
 * 用法：
 *   bun run scripts/backfill-session-map.ts --dry-run   # 预览
 *   bun run scripts/backfill-session-map.ts              # 执行
 */

import { Database } from "bun:sqlite";

const SDK_DB = process.env.OPENCODE_DB || `${process.env.HOME}/.local/share/opencode/opencode.db`;
const FW_DB = `${process.cwd()}/.opencode/state/framework-state.db`;
const DRY_RUN = process.argv.includes("--dry-run");

const sdk = new Database(SDK_DB, { readonly: true });
const fw = new Database(FW_DB);

console.log(`SDK DB: ${SDK_DB}`);
console.log(`FW DB:  ${FW_DB}`);
console.log(`Mode:   ${DRY_RUN ? "DRY RUN" : "LIVE"}`);
console.log("");

// 统计当前状态
const sdkCount = sdk.query("SELECT count(*) as c FROM session").get() as any;
const fwCount = fw.query("SELECT count(*) as c FROM session_map").get() as any;
console.log(`Before: SDK=${sdkCount.c}  FW_session_map=${fwCount.c}`);

// 找出需要回填的 session（SDK 中有但 FW 中没有的）
const sdkSessions = sdk.query(`
  SELECT s.id, s.parent_id, s.agent
  FROM session s
  WHERE s.agent IS NOT NULL AND s.agent != ''
  ORDER BY s.time_created DESC
`).all() as any[];

const fwIds = new Set(
  (fw.query("SELECT session_id FROM session_map").all() as any[]).map((r: any) => r.session_id)
);

const toBackfill = sdkSessions.filter((s: any) => !fwIds.has(s.id));
console.log(`To backfill: ${toBackfill.length} sessions`);

// 找出 orphan（FW 中有但 SDK 中没有的）
const sdkIds = new Set(sdkSessions.map((s: any) => s.id));
const orphans = (fw.query("SELECT session_id FROM session_map WHERE session_id NOT LIKE 'dispatch:%'").all() as any[])
  .filter((r: any) => !sdkIds.has(r.session_id));
console.log(`Orphans to clean: ${orphans.length}`);

if (DRY_RUN) {
  console.log("\n--- DRY RUN: Would backfill (first 20) ---");
  for (const s of toBackfill.slice(0, 20)) {
    console.log(`  ${s.id} | agent=${s.agent} | parent=${s.parent_id || "root"}`);
  }
  if (toBackfill.length > 20) console.log(`  ... and ${toBackfill.length - 20} more`);
  console.log("\n--- DRY RUN: Would clean orphans ---");
  for (const o of orphans.slice(0, 10)) {
    console.log(`  ${o.session_id}`);
  }
  sdk.close(); fw.close();
  process.exit(0);
}

// 执行回填
fw.run("BEGIN TRANSACTION");
try {
  let backfilled = 0;
  for (const s of toBackfill) {
    fw.run(`
      INSERT OR IGNORE INTO session_map (session_id, agent, parent_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `, [s.id, s.agent, s.parent_id || null, Date.now(), Date.now()]);
    backfilled++;
  }

  let cleaned = 0;
  for (const o of orphans) {
    fw.run("DELETE FROM session_map WHERE session_id = ?", [o.session_id]);
    cleaned++;
  }

  fw.run("COMMIT");
  console.log(`\nDone: backfilled=${backfilled}  cleaned=${cleaned}`);
} catch (e: any) {
  fw.run("ROLLBACK");
  console.error("Rollback:", e.message);
  sdk.close(); fw.close();
  process.exit(1);
}

// 验证
const fwAfter = fw.query("SELECT count(*) as c FROM session_map").get() as any;
console.log(`After:  FW_session_map=${fwAfter.c}`);

sdk.close(); fw.close();
