import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runSeed = (command, dbPath) => spawnSync(process.execPath, ['server/seed.js', command], {
 cwd: root, env: { ...process.env, DB_PATH: dbPath }, encoding: 'utf8', timeout: 15000
});
const count = (db, table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;

test('demo seed is idempotent, contains no private data, and removes cleanly', async t => {
 const dir = await mkdtemp(path.join(tmpdir(), 'hotel-seed-test-'));
 let db;
 t.after(async () => { db?.close(); await rm(dir, { recursive: true, force: true }); });
 const dbPath = path.join(dir, 'hotel.sqlite');
 const applied = runSeed('apply', dbPath);
 assert.equal(applied.status, 0, applied.stderr);
 assert.equal(JSON.parse(applied.stdout).applied, true);
 db = new DatabaseSync(dbPath);
 assert.equal(count(db, 'accommodation_types'), 6);
 assert.equal(count(db, 'rooms'), 12);
 assert.equal(count(db, 'rates'), 6);
 assert.equal(count(db, 'services'), 6);
 for (const table of ['admins', 'sessions', 'guests', 'reservations', 'service_requests', 'housekeeping_tasks', 'maintenance_tickets', 'guest_preferences', 'audit_log'])
  assert.equal(count(db, table), 0, table);
 const settings = db.prepare('SELECT * FROM settings WHERE id=1').get();
 assert.equal(settings.hotel_name, 'Maison Wouri (Demo)');
 assert.equal(settings.currency, 'XAF');
 assert.equal(settings.timezone, 'Africa/Douala');
 assert.equal(settings.booking_enabled, 0);
 assert.equal(settings.demo_mode, 1);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM rates WHERE start_date=? AND end_date=?').get('2026-09-17', '2028-09-17').n, 6);
 assert.equal(JSON.parse(runSeed('apply', dbPath).stdout).applied, false);
 assert.equal(count(db, 'rooms'), 12);
 const removed = runSeed('remove', dbPath);
 assert.equal(removed.status, 0, removed.stderr);
 assert.equal(JSON.parse(removed.stdout).settingsRestored, true);
 for (const table of ['accommodation_types', 'rooms', 'rates', 'services', 'seed_records', 'seed_runs'])
  assert.equal(count(db, table), 0, table);
 assert.equal(db.prepare('SELECT hotel_name FROM settings WHERE id=1').get().hotel_name, '');
 assert.equal(JSON.parse(runSeed('remove', dbPath).stdout).removed, false);
});

test('removal preserves edited settings and refuses to destroy a reservation', async t => {
 const dir = await mkdtemp(path.join(tmpdir(), 'hotel-seed-guard-'));
 let db;
 t.after(async () => { db?.close(); await rm(dir, { recursive: true, force: true }); });
 const dbPath = path.join(dir, 'hotel.sqlite');
 assert.equal(runSeed('apply', dbPath).status, 0);
 db = new DatabaseSync(dbPath);
 db.exec("UPDATE settings SET tagline='Owner-edited tagline' WHERE id=1");
 const room = db.prepare('SELECT id,type_id FROM rooms LIMIT 1').get();
 const guestId = Number(db.prepare("INSERT INTO guests(name,email) VALUES('Real Guest','real@example.test')").run().lastInsertRowid);
 db.prepare(`INSERT INTO reservations(reference,token_hash,type_id,room_id,guest_id,check_in,check_out,adults,quoted_total)
  VALUES(?,?,?,?,?,'2027-01-10','2027-01-12',1,156000)`).run('REAL-BOOKING', 'private-token-hash', room.type_id, room.id, guestId);
 const blocked = runSeed('remove', dbPath);
 assert.notEqual(blocked.status, 0);
 assert.match(blocked.stderr, /reservation references a seeded room or type/);
 assert.equal(count(db, 'rooms'), 12);
 assert.equal(count(db, 'seed_runs'), 1);
 db.exec('DELETE FROM reservations; DELETE FROM guests;');
 const removed = runSeed('remove', dbPath);
 assert.equal(removed.status, 0, removed.stderr);
 assert.equal(JSON.parse(removed.stdout).settingsRestored, false);
 assert.equal(db.prepare('SELECT tagline FROM settings WHERE id=1').get().tagline, 'Owner-edited tagline');
});
