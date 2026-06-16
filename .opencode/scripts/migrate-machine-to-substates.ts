#!/usr/bin/env bun
/**
 * migrate-machine-to-substates.ts — P1-B Data Migration Script
 *
 * Migrate monolithic machine.json to split sub-state files.
 *
 * Usage: bun .opencode/scripts/migrate-machine-to-substates.ts [--dry-run]
 *
 * Logging convention: CLI scripts use process.stderr.write() for all
 * output (progress + errors), never console.log/error.
 * @see docs/official_docs/opencode/findings/01-log-central-management.md
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  writeMachineMeta,
  writeSubState,
  SUBSTATE_FILES,
} from "../lib/substate-manager";
import { writeLog } from "../lib/log-manager";

const SRC = "script-migrate-machine-to-substates";
const STATE_DIR = path.join(
  process.env.OPENCODE_ROOT || process.cwd(),
  ".opencode",
  "state",
);
const MACHINE_PATH = path.join(STATE_DIR, "machine.json");
const BACKUP_PATH = MACHINE_PATH + ".backup." + Date.now();

function logProgress(msg: string): void {
  process.stderr.write(`[migrate] ${msg}\n`);
}

async function migrate(dryRun: boolean) {
  writeLog(SRC, "runtime", { event: "MIGRATE-START", detail: `dryRun=${dryRun}` });
  logProgress("Reading current machine.json...");

  // Read the current monolithic machine.json directly (not via readMachine())
  // because readMachine() expects split files which don't exist yet
  if (!fs.existsSync(MACHINE_PATH)) {
    logProgress("ERROR: machine.json not found");
    process.exit(1);
  }

  const machine = JSON.parse(fs.readFileSync(MACHINE_PATH, "utf8"));

  logProgress(
    `Current size: ${(JSON.stringify(machine).length / 1024).toFixed(2)}KB`,
  );
  logProgress(
    `Sub-states found: ${Object.keys(machine).filter((k) => k !== "meta" && k !== "contracts").join(", ")}`,
  );

  if (dryRun) {
    logProgress("DRY RUN — no files will be written");
    for (const key of Object.keys(SUBSTATE_FILES)) {
      if (machine[key]) {
        const size = JSON.stringify(machine[key]).length;
        logProgress(
          `  ${key}: ${(size / 1024).toFixed(2)}KB → ${SUBSTATE_FILES[key]}`,
        );
      }
    }
    return;
  }

  // Backup original machine.json
  logProgress(`Backing up machine.json to ${path.basename(BACKUP_PATH)}...`);
  fs.copyFileSync(MACHINE_PATH, BACKUP_PATH);

  // Write meta + contracts to main file
  logProgress("Writing machine.json (meta + contracts)...");
  writeMachineMeta({
    meta: machine.meta || {},
    contracts: machine.contracts || {},
  });

  // Write each sub-state to its dedicated file
  logProgress("Writing sub-state files...");
  let successCount = 0;
  let failCount = 0;
  for (const key of Object.keys(SUBSTATE_FILES)) {
    if (machine[key]) {
      const success = writeSubState(key as any, machine[key]);
      const size = JSON.stringify(machine[key]).length;
      logProgress(
        `  ${success ? "✓" : "✗"} ${key}: ${(size / 1024).toFixed(2)}KB → ${SUBSTATE_FILES[key]}`,
      );
      if (!success) {
        writeLog(SRC, "ERROR", {
          event: "SUBSTATE-WRITE-FAILED",
          detail: `key=${key}`,
        });
        failCount++;
      } else {
        successCount++;
      }
    }
  }

  logProgress(
    `Migration complete. ${successCount} succeeded, ${failCount} failed.`,
  );
  logProgress(`Backup saved to ${path.basename(BACKUP_PATH)}`);
  logProgress(`To rollback: cp ${path.basename(BACKUP_PATH)} machine.json`);
  writeLog(SRC, "runtime", {
    event: "MIGRATE-COMPLETE",
    detail: `backup=${path.basename(BACKUP_PATH)} success=${successCount} failed=${failCount}`,
  });

  if (failCount > 0) {
    process.stderr.write(
      `\n[WARN] ${failCount} sub-state(s) failed to write. Check logs.\n`,
    );
  }
}

const dryRun = process.argv.includes("--dry-run");
migrate(dryRun).catch((err) => {
  process.stderr.write(`[migrate] Fatal error: ${err.message}\n`);
  writeLog(SRC, "ERROR", { event: "MIGRATE-FATAL", detail: err.message });
  process.exit(1);
});
