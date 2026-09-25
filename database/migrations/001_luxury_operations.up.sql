CREATE TABLE feature_flags (
 key TEXT PRIMARY KEY,
 label TEXT NOT NULL,
 description TEXT NOT NULL DEFAULT '',
 category TEXT NOT NULL DEFAULT 'operations',
 enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
 sort_order INTEGER NOT NULL DEFAULT 0
);

INSERT INTO feature_flags(key,label,description,category,enabled,sort_order) VALUES
 ('public_booking','Online reservations','Let guests search availability and request reservations.','guest_experience',1,10),
 ('guest_services','Guest service requests','Let guests request services from their private stay page.','guest_experience',1,20),
 ('housekeeping','Housekeeping operations','Plan room cleaning, turndown and inspections.','operations',1,30),
 ('maintenance','Maintenance operations','Track defects, repairs and out-of-order rooms.','operations',1,40),
 ('guest_preferences','Guest preferences','Record service preferences for future stays.','guest_experience',1,50),
 ('availability_blocks','Availability blocks','Remove rooms from sale for maintenance or private use.','revenue',1,60),
 ('rate_management','Rate management','Manage dated room rates and minimum stays.','revenue',1,70),
 ('service_catalog','Service catalogue','Publish the services guests can request.','guest_experience',1,80),
 ('activity_log','Activity log','Keep a trace of administrator changes.','governance',1,90),
 ('media_library','Image uploads','Upload property and accommodation imagery.','content',1,100);

CREATE TABLE booking_rules (
 id INTEGER PRIMARY KEY CHECK(id=1),
 max_advance_days INTEGER NOT NULL DEFAULT 730 CHECK(max_advance_days BETWEEN 1 AND 3650),
 max_stay_nights INTEGER NOT NULL DEFAULT 30 CHECK(max_stay_nights BETWEEN 1 AND 365),
 minimum_lead_hours INTEGER NOT NULL DEFAULT 0 CHECK(minimum_lead_hours BETWEEN 0 AND 8760),
 require_phone INTEGER NOT NULL DEFAULT 1 CHECK(require_phone IN (0,1)),
 allow_children INTEGER NOT NULL DEFAULT 1 CHECK(allow_children IN (0,1)),
 allow_special_requests INTEGER NOT NULL DEFAULT 1 CHECK(allow_special_requests IN (0,1)),
 auto_confirm INTEGER NOT NULL DEFAULT 0 CHECK(auto_confirm IN (0,1)),
 cancellation_window_hours INTEGER NOT NULL DEFAULT 24 CHECK(cancellation_window_hours BETWEEN 0 AND 8760),
 terms_url TEXT NOT NULL DEFAULT ''
);
INSERT INTO booking_rules(id) VALUES(1);

CREATE TABLE departments (
 id INTEGER PRIMARY KEY,
 name TEXT NOT NULL UNIQUE,
 color TEXT NOT NULL DEFAULT '#315f5a',
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 sort_order INTEGER NOT NULL DEFAULT 0
);
INSERT INTO departments(name,color,sort_order) VALUES
 ('Front Office','#315f5a',10),
 ('Housekeeping','#64748b',20),
 ('Concierge','#a77638',30),
 ('Engineering','#9a5b4a',40),
 ('Food & Beverage','#6f5b8f',50),
 ('Security','#455468',60);

CREATE TABLE housekeeping_tasks (
 id INTEGER PRIMARY KEY,
 room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
 reservation_id INTEGER REFERENCES reservations(id) ON DELETE SET NULL,
 task_type TEXT NOT NULL DEFAULT 'stayover' CHECK(task_type IN ('arrival','departure','stayover','turndown','inspection','deep_clean','other')),
 priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high','urgent')),
 status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','assigned','in_progress','inspection','completed','cancelled')),
 scheduled_for TEXT NOT NULL,
 assigned_to TEXT NOT NULL DEFAULT '',
 notes TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_housekeeping_schedule ON housekeeping_tasks(scheduled_for,status,room_id);

CREATE TABLE maintenance_tickets (
 id INTEGER PRIMARY KEY,
 room_id INTEGER REFERENCES rooms(id) ON DELETE SET NULL,
 title TEXT NOT NULL,
 description TEXT NOT NULL DEFAULT '',
 priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high','critical')),
 status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','assigned','in_progress','on_hold','resolved','cancelled')),
 out_of_order INTEGER NOT NULL DEFAULT 0 CHECK(out_of_order IN (0,1)),
 assigned_to TEXT NOT NULL DEFAULT '',
 reported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 due_at TEXT,
 resolved_at TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_maintenance_status ON maintenance_tickets(status,priority,room_id);

CREATE TABLE guest_preferences (
 id INTEGER PRIMARY KEY,
 guest_id INTEGER NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
 category TEXT NOT NULL,
 preference TEXT NOT NULL,
 sensitivity TEXT NOT NULL DEFAULT 'standard' CHECK(sensitivity IN ('standard','private')),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_guest_preferences_guest ON guest_preferences(guest_id,active);

CREATE TABLE content_sections (
 id INTEGER PRIMARY KEY,
 section_key TEXT NOT NULL UNIQUE,
 nav_label TEXT NOT NULL DEFAULT '',
 eyebrow TEXT NOT NULL DEFAULT '',
 heading TEXT NOT NULL,
 body TEXT NOT NULL DEFAULT '',
 image_url TEXT NOT NULL DEFAULT '',
 cta_label TEXT NOT NULL DEFAULT '',
 cta_url TEXT NOT NULL DEFAULT '',
 layout TEXT NOT NULL DEFAULT 'editorial' CHECK(layout IN ('editorial','feature','split','quote')),
 enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
 sort_order INTEGER NOT NULL DEFAULT 0
);

