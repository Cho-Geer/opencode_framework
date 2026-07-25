#!/usr/bin/env bun
import { Database } from "bun:sqlite";
import { resolve } from "node:path";

const DB_PATH = resolve(import.meta.dir, "../.opencode/state/framework-state.db");
const table = process.argv[2];
const where = process.argv[3];

if (!table) {
  console.error("Usage: bun run scripts/db-query.ts <table> [where_clause]");
  console.error('Example: bun run scripts/db-query.ts gate_call_context "status = \'pending\'"');
  process.exit(1);
}

const db = new Database(DB_PATH, { readonly: true });
try {
  const sql = where
    ? `SELECT * FROM ${table} WHERE ${where} ORDER BY rowid DESC`
    : `SELECT * FROM ${table} ORDER BY rowid DESC`;
  const rows = db.query(sql).all();
  console.log(JSON.stringify(rows, null, 2));
} catch (e: any) {
  console.error(JSON.stringify({ error: e.message, table, where: where || null }));
  process.exit(1);
} finally {
  db.close();
}
