import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyMigrations, migrationStatus, rollbackLastMigration } from './migrations.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dbPath=path.resolve(process.env.DB_PATH || path.join(root,'hotel.sqlite'));
const command=process.argv[2] || 'status';
const db=new DatabaseSync(dbPath);
db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
try {
 if(command==='up') console.log(JSON.stringify({applied:applyMigrations(db),database:dbPath}));
 else if(command==='down') console.log(JSON.stringify({rolledBack:rollbackLastMigration(db),database:dbPath}));
 else if(command==='status') console.table(migrationStatus(db));
 else throw new Error('Usage: node server/migrate.js status|up|down');
} finally { db.close(); }

