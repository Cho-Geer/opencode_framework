#!/usr/bin/env bun
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = new URL('.', import.meta.url).pathname;
const ROOT = join(__dirname, '../..');
const STATE = join(ROOT, '.opencode/state');
const LOGS = join(ROOT, '.opencode/logs');
const PRETTY = process.argv.includes('--pretty');
function sz(path) { return existsSync(path) ? statSync(path).size : -1; }
function fmt(bytes) { if(bytes<0)return'N/A';if(bytes<1024)return bytes+'B';if(bytes<1048576)return(bytes/1024).toFixed(1)+'KB';return(bytes/1048576).toFixed(1)+'MB'; }
function countJsonl(dir) { if(!existsSync(dir))return{f:0,e:0};const fs2=readdirSync(dir).filter(f=>f.endsWith('.jsonl'));let e=0;
for(const f of fs2){try{const c=readFileSync(join(dir,f),'utf8');e+=c.split('\n').filter(l=>l.trim()).length}catch{}}return{files:fs2.length,entries:e};}
const m = { timestamp: new Date().toISOString(),
  gate_state: { hot_size: sz(join(STATE,'gate-state.json')), hot_size_formatted: fmt(sz(join(STATE,'gate-state.json'))), index_size: fmt(sz(join(STATE,'gate-state.index.json'))),
    archive_sessions: existsSync(join(STATE,'gate-state.archive.json'))?JSON.parse(readFileSync(join(STATE,'gate-state.archive.json'),'utf8')).session_count||0:0, history: countJsonl(join(STATE,'gate-state.history')) },
  dag: { hot_size: sz(join(ROOT,'Task.DAG.json')), hot_size_formatted: fmt(sz(join(ROOT,'Task.DAG.json'))), index_size: fmt(sz(join(ROOT,'Task.DAG.index.json'))), changelog_size: fmt(sz(join(ROOT,'Task.DAG.changelog.md'))),
    versions: existsSync(join(ROOT,'Task.DAG.versions'))?readdirSync(join(ROOT,'Task.DAG.versions')).filter(f=>f.endsWith('.json')).length:0 },
  logs: { safe_bash_size: sz(join(LOGS,'safe-bash.log')), safe_bash_formatted: fmt(sz(join(LOGS,'safe-bash.log'))), rotated: existsSync(join(LOGS,'safe-bash.log.1'))?1:0 },
  machine: { size: fmt(sz(join(STATE,'machine.json'))) } };
console.log(JSON.stringify(m,null,PRETTY?2:0));
