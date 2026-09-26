import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

test('migration CLI initializes a blank SQLite database',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'hotel-migration-')),dbPath=path.join(dir,'blank.sqlite');
 let db;t.after(async()=>{db?.close();await rm(dir,{recursive:true,force:true});});
 const result=spawnSync(process.execPath,['server/migrate.js','up'],{cwd:root,env:{...process.env,DB_PATH:dbPath},encoding:'utf8',timeout:15000});
 assert.equal(result.status,0,result.stderr);
 assert.deepEqual(JSON.parse(result.stdout).applied,[1,2,3]);
 db=new DatabaseSync(dbPath,{readOnly:true});
 assert.equal(db.prepare('PRAGMA quick_check').get().quick_check,'ok');
 assert.equal(db.prepare('SELECT COUNT(*) count FROM schema_migrations').get().count,3);
 assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='service_requests'").get());
});
