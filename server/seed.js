import { DatabaseSync } from 'node:sqlite';
import { spawn } from 'node:child_process';
import { access, copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const seedKey = 'maison-wouri-demo-v1';
const from = '2026-09-17';
const through = '2028-09-17'; // Exclusive, as with all rates in this app.
const tableFor = { type: 'accommodation_types', room: 'rooms', rate: 'rates', service: 'services' };

const accommodation = [
 { slug: 'classic-king', name: 'Classic King', description: 'A calm retreat with room to settle in after a day in Douala.', bed_summary: '1 king bed', max_adults: 2, max_children: 0, max_guests: 2, size_sqm: 30, amenities: ['Wi-Fi', 'Air conditioning', 'Workspace', 'Walk-in shower'], image_url: '/demo-media/classic-king.webp', price: 78000 },
 { slug: 'classic-twin', name: 'Classic Twin', description: 'A flexible stay for colleagues or friends travelling together.', bed_summary: '2 twin beds', max_adults: 2, max_children: 0, max_guests: 2, size_sqm: 32, amenities: ['Wi-Fi', 'Air conditioning', 'Workspace', 'Walk-in shower'], image_url: '/demo-media/classic-twin.webp', price: 82000 },
 { slug: 'deluxe-balcony', name: 'Deluxe Balcony', description: 'An airy room with a private balcony and a little more space to unwind.', bed_summary: '1 king bed', max_adults: 2, max_children: 1, max_guests: 3, size_sqm: 38, amenities: ['Wi-Fi', 'Air conditioning', 'Private balcony', 'Coffee station'], image_url: '/demo-media/deluxe-balcony.webp', price: 115000 },
 { slug: 'family-room', name: 'Family Room', description: 'A practical shared space for a family of three travelling together.', bed_summary: '1 king bed and 1 daybed', max_adults: 2, max_children: 1, max_guests: 3, size_sqm: 48, amenities: ['Wi-Fi', 'Air conditioning', 'Family seating', 'Daybed'], image_url: '/demo-media/family-room.webp', price: 145000 },
 { slug: 'accessible-queen', name: 'Accessible Queen', description: 'A welcoming layout designed with step-free movement in mind. Confirm individual access needs with the property.', bed_summary: '1 queen bed', max_adults: 2, max_children: 0, max_guests: 2, size_sqm: 36, amenities: ['Wi-Fi', 'Air conditioning', 'Step-free layout concept', 'Wide circulation'], image_url: '/demo-media/accessible-queen.webp', price: 85000 },
 { slug: 'executive-suite', name: 'Executive Suite', description: 'A generous suite with separate spaces to work and relax.', bed_summary: '1 king bed', max_adults: 2, max_children: 1, max_guests: 3, size_sqm: 62, amenities: ['Wi-Fi', 'Air conditioning', 'Separate lounge', 'Coffee station'], image_url: '/demo-media/executive-suite.webp', price: 215000 }
];
const services = [
 { name: 'Extra towels', description: 'Ask the team to bring extra towels to your room.', category: 'Comfort' },
 { name: 'Housekeeping visit', description: 'Request a convenient time for room care.', category: 'Housekeeping' },
 { name: 'Wake-up call', description: 'Arrange a call at your preferred time.', category: 'Convenience' },
 { name: 'Luggage assistance', description: 'Ask for help with luggage at arrival or departure.', category: 'Concierge' },
 { name: 'Dining enquiry', description: 'Ask the team about dining options and availability.', category: 'Dining' },
 { name: 'Transport enquiry', description: 'Ask the team about local transport options.', category: 'Concierge' }
];
const settingsValues = {
 hotel_name: 'Maison Wouri (Demo)', tagline: 'Arrive well. Stay a little longer.',
 hero_image_url: '/demo-media/courtyard-hero.webp',
 description: 'Explore an illustrative hotel experience inspired by the warmth and energy of Douala. This demonstration property is fictional.',
 city: 'Douala', country: 'Cameroon', currency: 'XAF', timezone: 'Africa/Douala',
 primary_color: '#173b38', accent_color: '#d4aa6a',
 about: 'Maison Wouri is a fictional demonstration hotel. Its rooms, services and prices illustrate how a Cameroon-based property can present stays and manage availability.',
 policies: 'Demonstration content only. Rates are illustrative estimates in XAF. No payment is collected online. A real property must publish its own reservation and cancellation policies.',
 footer_text: 'A fictional Douala hotel demonstration. Property information and prices are illustrative.',
 contact_email: 'hello@maison-wouri.example', contact_phone: '', address: '',
 stays_heading: 'Rooms for every kind of visit', stays_intro: 'Find a room that feels right for your stay.',
 about_heading: 'A welcome shaped by Douala', search_heading: 'Plan your stay',
 booking_intro: 'Explore room options and request a stay. This is a demonstration property.'
};

function rows(db, sql, ...params) { return db.prepare(sql).all(...params); }
function one(db, sql, ...params) { return db.prepare(sql).get(...params); }
function run(db, sql, ...params) { return db.prepare(sql).run(...params); }
function insert(db, table, data) {
 const keys = Object.keys(data);
 return Number(run(db, `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`, ...keys.map(key => data[key])).lastInsertRowid);
}
function manifest(db) {
 db.exec(`CREATE TABLE IF NOT EXISTS seed_runs (
  seed_key TEXT PRIMARY KEY, before_settings_json TEXT NOT NULL, after_settings_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
 );
 CREATE TABLE IF NOT EXISTS seed_records (
  seed_key TEXT NOT NULL REFERENCES seed_runs(seed_key) ON DELETE CASCADE,
  entity TEXT NOT NULL, entity_id INTEGER NOT NULL, row_json TEXT NOT NULL,
  PRIMARY KEY(seed_key, entity, entity_id)
 );`);
}
function record(db, entity, id) {
 const value = one(db, `SELECT * FROM ${tableFor[entity]} WHERE id=?`, id);
 run(db, 'INSERT INTO seed_records(seed_key,entity,entity_id,row_json) VALUES(?,?,?,?)', seedKey, entity, id, JSON.stringify(value));
}
function transaction(db, fn) {
 db.exec('BEGIN IMMEDIATE');
 try { const result = fn(); db.exec('COMMIT'); return result; }
 catch (error) { db.exec('ROLLBACK'); throw error; }
}
export function applySeed(db) {
 db.exec('PRAGMA foreign_keys=ON'); manifest(db);
 if (one(db, 'SELECT seed_key FROM seed_runs WHERE seed_key=?', seedKey)) return { applied: false, reason: 'already applied' };
 return transaction(db, () => {
  const before = one(db, 'SELECT * FROM settings WHERE id=1');
  if (!before) throw new Error('Database schema is missing. Start the application once to initialize it.');
  if (before.hotel_name || ['accommodation_types', 'rooms', 'rates', 'services'].some(table => one(db, `SELECT COUNT(*) AS count FROM ${table}`).count))
   throw new Error('Seed requires an empty property and catalog; existing hotel data was left untouched.');
  const columnNames = new Set(rows(db, 'PRAGMA table_info(settings)').map(column => column.name));
  if (!columnNames.has('booking_enabled') || !columnNames.has('demo_mode'))
   throw new Error('Application schema must support booking_enabled and demo_mode before demo data can be seeded.');
  const changes = { ...settingsValues };
  changes.booking_enabled = 0;
  changes.demo_mode = 1;
  const keys = Object.keys(changes);
  run(db, `UPDATE settings SET ${keys.map(key => `${key}=?`).join(',')} WHERE id=1`, ...keys.map(key => changes[key]));
  const after = one(db, 'SELECT * FROM settings WHERE id=1');
  run(db, 'INSERT INTO seed_runs(seed_key,before_settings_json,after_settings_json) VALUES(?,?,?)', seedKey, JSON.stringify(before), JSON.stringify(after));
  for (const [index, item] of accommodation.entries()) {
   const { price, ...type } = item;
   const typeId = insert(db, 'accommodation_types', { ...type, amenities: JSON.stringify(type.amenities), images: '[]', active: 1, sort_order: index + 1 });
   record(db, 'type', typeId);
   for (let room = 1; room <= 2; room++) {
    const roomId = insert(db, 'rooms', { type_id: typeId, number: `D${index + 1}0${room}`, floor: String(index + 1), status: 'active', notes: 'Demonstration inventory' });
    record(db, 'room', roomId);
   }
   const rateId = insert(db, 'rates', { type_id: typeId, start_date: from, end_date: through, nightly_price: price, min_nights: 1 });
   record(db, 'rate', rateId);
  }
  for (const [index, service] of services.entries()) {
   const serviceId = insert(db, 'services', { ...service, active: 1, sort_order: index + 1 });
   record(db, 'service', serviceId);
  }
  return { applied: true, types: accommodation.length, rooms: accommodation.length * 2, rates: accommodation.length, services: services.length };
 });
}
export function removeSeed(db) {
 db.exec('PRAGMA foreign_keys=ON'); manifest(db);
 const saved = one(db, 'SELECT * FROM seed_runs WHERE seed_key=?', seedKey);
 if (!saved) return { removed: false, reason: 'not applied' };
 return transaction(db, () => {
  const records = rows(db, 'SELECT * FROM seed_records WHERE seed_key=?', seedKey);
  const ids = entity => records.filter(row => row.entity === entity).map(row => row.entity_id);
  const roomIds = ids('room'), typeIds = ids('type'), rateIds = ids('rate'), serviceIds = ids('service');
  const has = (sql, values) => values.length && one(db, sql.replace('IDS', values.map(() => '?').join(',')), ...values);
  if (has('SELECT id FROM reservations WHERE room_id IN (IDS) LIMIT 1', roomIds) ||
      has('SELECT id FROM reservations WHERE type_id IN (IDS) LIMIT 1', typeIds))
   throw new Error('Cannot remove demo data: a reservation references a seeded room or type.');
  if (has('SELECT id FROM blocks WHERE room_id IN (IDS) LIMIT 1', roomIds))
   throw new Error('Cannot remove demo data: an availability block references a seeded room.');
  if (has('SELECT id FROM housekeeping_tasks WHERE room_id IN (IDS) LIMIT 1', roomIds))
   throw new Error('Cannot remove demo data: a housekeeping task references a seeded room.');
  if (has('SELECT id FROM maintenance_tickets WHERE room_id IN (IDS) LIMIT 1', roomIds))
   throw new Error('Cannot remove demo data: a maintenance ticket references a seeded room.');
  if (has('SELECT id FROM service_requests WHERE service_id IN (IDS) LIMIT 1', serviceIds))
   throw new Error('Cannot remove demo data: a service request references a seeded service.');
  if (typeIds.length && one(db, `SELECT id FROM rooms WHERE type_id IN (${typeIds.map(() => '?').join(',')}) AND id NOT IN (${roomIds.map(() => '?').join(',')}) LIMIT 1`, ...typeIds, ...roomIds))
   throw new Error('Cannot remove demo data: an administrator added a room to a seeded type.');
  if (typeIds.length && one(db, `SELECT id FROM rates WHERE type_id IN (${typeIds.map(() => '?').join(',')}) AND id NOT IN (${rateIds.map(() => '?').join(',')}) LIMIT 1`, ...typeIds, ...rateIds))
   throw new Error('Cannot remove demo data: an administrator added a rate to a seeded type.');
  for (const entry of records) {
   const current = one(db, `SELECT * FROM ${tableFor[entry.entity]} WHERE id=?`, entry.entity_id);
   if (JSON.stringify(current) !== entry.row_json)
    throw new Error(`Cannot remove demo data: seeded ${entry.entity} #${entry.entity_id} was edited or deleted.`);
  }
  for (const entity of ['service', 'rate', 'room', 'type'])
   for (const entry of records.filter(row => row.entity === entity))
    run(db, `DELETE FROM ${tableFor[entity]} WHERE id=?`, entry.entity_id);
  const current = one(db, 'SELECT * FROM settings WHERE id=1');
  let settingsRestored = false;
  if (JSON.stringify(current) === saved.after_settings_json) {
   const original = JSON.parse(saved.before_settings_json);
   const keys = Object.keys(original).filter(key => key !== 'id');
   run(db, `UPDATE settings SET ${keys.map(key => `${key}=?`).join(',')} WHERE id=1`, ...keys.map(key => original[key]));
   settingsRestored = true;
  }
  run(db, 'DELETE FROM seed_runs WHERE seed_key=?', seedKey);
  return { removed: true, settingsRestored };
 });
}

async function initialize(dbPath) {
 let ready = false;
 try {
  await access(dbPath);
  const existing = new DatabaseSync(dbPath, { readOnly: true });
  ready = !!one(existing, "SELECT name FROM sqlite_master WHERE type='table' AND name='settings'");
  existing.close();
 } catch { /* A new database is initialized by the app below. */ }
 if (ready) return;
 await mkdir(path.dirname(dbPath), { recursive: true });
 await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [path.join(root, 'server/index.js')], { cwd: root, env: { ...process.env, DB_PATH: dbPath, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let settled = false, stderr = '';
  const timer = setTimeout(() => finish(new Error('Timed out initializing database')), 10000);
  function finish(error) {
   if (settled) return;
   settled = true; clearTimeout(timer); child.kill();
   if (child.exitCode !== null || child.signalCode !== null) error ? reject(error) : resolve();
   else child.once('exit', () => error ? reject(error) : resolve());
  }
  child.stdout.on('data', chunk => { if (chunk.toString().includes('listening on')) finish(); });
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  child.on('error', finish);
  child.on('exit', code => { if (!settled) finish(new Error(`Database initialization failed (${code}): ${stderr}`)); });
 });
}
async function execute(command) {
 if (!['apply', 'remove', 'snapshot'].includes(command)) throw new Error('Usage: node server/seed.js apply|remove|snapshot');
 let tempDir;
 let dbPath = path.resolve(process.env.DB_PATH || path.join(root, 'hotel.sqlite'));
 try {
  if (command === 'snapshot') {
   tempDir = await mkdtemp(path.join(tmpdir(), 'hotel-demo-'));
   dbPath = path.join(tempDir, 'demo.sqlite');
  }
  await initialize(dbPath);
  const db = new DatabaseSync(dbPath);
  let result;
  try {
   result = command === 'remove' ? removeSeed(db) : applySeed(db);
   if (command === 'snapshot') {
    for (const table of ['admins', 'sessions', 'guests', 'reservations', 'service_requests', 'housekeeping_tasks', 'maintenance_tickets', 'guest_preferences', 'audit_log'])
     if (one(db, `SELECT COUNT(*) AS count FROM ${table}`).count) throw new Error(`Snapshot contains private or operational ${table} data`);
    db.exec('PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE; VACUUM;');
   }
  } finally { db.close(); }
  if (command === 'snapshot') {
   const destination = path.join(root, 'database/demo.sqlite');
   await mkdir(path.dirname(destination), { recursive: true });
   await copyFile(dbPath, destination);
   result = { ...result, database: destination };
  }
  console.log(JSON.stringify(result));
 } finally { if (tempDir) await rm(tempDir, { recursive: true, force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
 execute(process.argv[2]).catch(error => { console.error(error.message); process.exitCode = 1; });
