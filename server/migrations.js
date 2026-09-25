import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = path.join(root, 'database', 'migrations');

function files(direction) {
 return readdirSync(migrationsDir)
  .filter(name => /^\d+_[a-z0-9_]+\.(up|down)\.sql$/.test(name) && name.endsWith(`.${direction}.sql`))
  .sort()
  .map(name => ({
   version: Number(name.match(/^(\d+)/)[1]),
   name: name.replace(/^\d+_|\.(?:up|down)\.sql$/g, ''),
   filename: name,
   sql: readFileSync(path.join(migrationsDir, name), 'utf8')
  }));
}

function ensureTable(db) {
 db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
 )`);
}

export function migrationStatus(db) {
 ensureTable(db);
 const applied = new Map(db.prepare('SELECT version,applied_at FROM schema_migrations ORDER BY version').all().map(row => [row.version, row.applied_at]));
 return files('up').map(item => ({version:item.version,name:item.name,appliedAt:applied.get(item.version) || null}));
}

export function applyMigrations(db) {
 ensureTable(db);
 const applied = new Set(db.prepare('SELECT version FROM schema_migrations').all().map(row => row.version));
 const completed=[];
 for(const migration of files('up')) {
  if(applied.has(migration.version)) continue;
  db.exec('BEGIN IMMEDIATE');
  try {
   db.exec(migration.sql);
   db.prepare('INSERT INTO schema_migrations(version,name) VALUES(?,?)').run(migration.version,migration.name);
   db.exec('COMMIT');
   completed.push(migration.version);
  } catch(error) {
   db.exec('ROLLBACK');
   throw new Error(`Migration ${migration.filename} failed: ${error.message}`);
  }
 }
 return completed;
}

export function rollbackLastMigration(db) {
 ensureTable(db);
 const latest=db.prepare('SELECT version,name FROM schema_migrations ORDER BY version DESC LIMIT 1').get();
 if(!latest) return null;
 const migration=files('down').find(item=>item.version===latest.version);
 if(!migration) throw new Error(`No rollback migration exists for version ${latest.version}`);
 db.exec('BEGIN IMMEDIATE');
 try {
  db.exec(migration.sql);
  db.prepare('DELETE FROM schema_migrations WHERE version=?').run(latest.version);
  db.exec('COMMIT');
  return latest;
 } catch(error) {
  db.exec('ROLLBACK');
  throw new Error(`Rollback ${migration.filename} failed: ${error.message}`);
 }
}

