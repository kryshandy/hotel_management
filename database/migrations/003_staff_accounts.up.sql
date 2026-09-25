ALTER TABLE admins ADD COLUMN display_name TEXT NOT NULL DEFAULT '';
ALTER TABLE admins ADD COLUMN role TEXT NOT NULL DEFAULT 'owner' CHECK(role IN ('owner','manager','front_office','housekeeping','concierge','engineering','revenue','viewer'));
ALTER TABLE admins ADD COLUMN active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1));
CREATE INDEX idx_admins_active_role ON admins(active,role);

