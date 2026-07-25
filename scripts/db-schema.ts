#!/usr/bin/env bun
import { Database } from "bun:sqlite";
import { resolve } from "node:path";

const DB_PATH = resolve(import.meta.dir, "../.opencode/state/framework-state.db");
const db = new Database(DB_PATH, { readonly: true });
const tName = process.argv[2];

const tables = (db.query(
  "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
).all() as any[]).map((r: any) => r.name);

const result: Record<string, Array<{ cid: number; name: string; type: string; notnull: number; pk: number }>> = {};

for (const t of tables) {
  try {
    result[t] = db.query(`PRAGMA table_info(${t})`).all() as any[];
  } catch {
    result[t] = [];
  }
}

console.log(JSON.stringify(tName ? result[tName] : result, null, 2));
db.close();
