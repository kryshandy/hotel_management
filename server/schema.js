export function initializeCoreSchema(db) {
 db.exec(`
 CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK(id=1), hotel_name TEXT NOT NULL DEFAULT '', tagline TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '', logo_url TEXT NOT NULL DEFAULT '', hero_image_url TEXT NOT NULL DEFAULT '',
  primary_color TEXT NOT NULL DEFAULT '#18314a', accent_color TEXT NOT NULL DEFAULT '#bce4e7',
  contact_email TEXT NOT NULL DEFAULT '', contact_phone TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '', country TEXT NOT NULL DEFAULT '', currency TEXT NOT NULL DEFAULT 'USD',
  timezone TEXT NOT NULL DEFAULT 'UTC', check_in_time TEXT NOT NULL DEFAULT '15:00',
  check_out_time TEXT NOT NULL DEFAULT '11:00', policies TEXT NOT NULL DEFAULT '', about TEXT NOT NULL DEFAULT '',
  footer_text TEXT NOT NULL DEFAULT '', nav_stays_label TEXT NOT NULL DEFAULT '',
  nav_about_label TEXT NOT NULL DEFAULT '', nav_contact_label TEXT NOT NULL DEFAULT '',
  stays_heading TEXT NOT NULL DEFAULT '', stays_intro TEXT NOT NULL DEFAULT '',
  about_heading TEXT NOT NULL DEFAULT '', search_heading TEXT NOT NULL DEFAULT '',
  booking_intro TEXT NOT NULL DEFAULT '', show_about INTEGER NOT NULL DEFAULT 1 CHECK(show_about IN (0,1)),
  show_contact INTEGER NOT NULL DEFAULT 1 CHECK(show_contact IN (0,1)),
  booking_enabled INTEGER NOT NULL DEFAULT 1 CHECK(booking_enabled IN (0,1)),
  demo_mode INTEGER NOT NULL DEFAULT 0 CHECK(demo_mode IN (0,1))
 );
 INSERT OR IGNORE INTO settings(id) VALUES(1);
 CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
 );
 CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
 );
 CREATE TABLE IF NOT EXISTS accommodation_types (
  id INTEGER PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  bed_summary TEXT NOT NULL DEFAULT '', max_adults INTEGER NOT NULL DEFAULT 2 CHECK(max_adults>=1),
  max_children INTEGER NOT NULL DEFAULT 0 CHECK(max_children>=0),
  max_guests INTEGER NOT NULL DEFAULT 2 CHECK(max_guests>=1), size_sqm REAL,
  amenities TEXT NOT NULL DEFAULT '[]', image_url TEXT NOT NULL DEFAULT '', images TEXT NOT NULL DEFAULT '[]',
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), sort_order INTEGER NOT NULL DEFAULT 0
 );
 CREATE TABLE IF NOT EXISTS rooms (
  id INTEGER PRIMARY KEY, type_id INTEGER NOT NULL REFERENCES accommodation_types(id) ON DELETE RESTRICT,
  number TEXT NOT NULL UNIQUE, floor TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'active'
  CHECK(status IN ('active','maintenance','inactive')), notes TEXT NOT NULL DEFAULT ''
 );
 CREATE TABLE IF NOT EXISTS rates (
  id INTEGER PRIMARY KEY, type_id INTEGER NOT NULL REFERENCES accommodation_types(id) ON DELETE CASCADE,
  start_date TEXT NOT NULL, end_date TEXT NOT NULL, nightly_price REAL NOT NULL CHECK(nightly_price>=0),
  min_nights INTEGER NOT NULL DEFAULT 1 CHECK(min_nights>=1), CHECK(start_date<end_date)
 );
 CREATE TABLE IF NOT EXISTS blocks (
  id INTEGER PRIMARY KEY, room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  start_date TEXT NOT NULL, end_date TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '', CHECK(start_date<end_date)
 );
 CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), sort_order INTEGER NOT NULL DEFAULT 0
 );
 CREATE TABLE IF NOT EXISTS guests (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
 );
 CREATE TABLE IF NOT EXISTS reservations (
  id INTEGER PRIMARY KEY, reference TEXT NOT NULL UNIQUE, token_hash TEXT NOT NULL UNIQUE,
  type_id INTEGER NOT NULL REFERENCES accommodation_types(id) ON DELETE RESTRICT,
  room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE RESTRICT,
  guest_id INTEGER NOT NULL REFERENCES guests(id) ON DELETE RESTRICT,
  check_in TEXT NOT NULL, check_out TEXT NOT NULL, adults INTEGER NOT NULL, children INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmed','checked_in','checked_out','cancelled','no_show')),
  quoted_total REAL NOT NULL, notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, CHECK(check_in<check_out)
 );
 CREATE TABLE IF NOT EXISTS service_requests (
  id INTEGER PRIMARY KEY, reservation_id INTEGER NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  service_id INTEGER REFERENCES services(id) ON DELETE SET NULL,
  title TEXT NOT NULL, message TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_progress','completed','cancelled')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
 );
 CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY, admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE RESTRICT,
  action TEXT NOT NULL, entity TEXT NOT NULL, entity_id INTEGER,
  before_json TEXT, after_json TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
 );
 CREATE INDEX IF NOT EXISTS idx_reservation_overlap ON reservations(room_id,check_in,check_out,status);
 CREATE INDEX IF NOT EXISTS idx_block_overlap ON blocks(room_id,start_date,end_date);
 CREATE INDEX IF NOT EXISTS idx_rate_dates ON rates(type_id,start_date,end_date);
 `);

 const additionalSettings={
  nav_stays_label:"TEXT NOT NULL DEFAULT ''",nav_about_label:"TEXT NOT NULL DEFAULT ''",
  nav_contact_label:"TEXT NOT NULL DEFAULT ''",stays_heading:"TEXT NOT NULL DEFAULT ''",
  stays_intro:"TEXT NOT NULL DEFAULT ''",about_heading:"TEXT NOT NULL DEFAULT ''",
  search_heading:"TEXT NOT NULL DEFAULT ''",booking_intro:"TEXT NOT NULL DEFAULT ''",
  show_about:'INTEGER NOT NULL DEFAULT 1',show_contact:'INTEGER NOT NULL DEFAULT 1',
  booking_enabled:'INTEGER NOT NULL DEFAULT 1',demo_mode:'INTEGER NOT NULL DEFAULT 0'
 };
 const knownSettings=new Set(db.prepare('PRAGMA table_info(settings)').all().map(x=>x.name));
 for(const [name,definition] of Object.entries(additionalSettings))if(!knownSettings.has(name))db.exec(`ALTER TABLE settings ADD COLUMN ${name} ${definition}`);
}
