DROP INDEX IF EXISTS idx_admins_active_role;
ALTER TABLE admins DROP COLUMN active;
ALTER TABLE admins DROP COLUMN role;
ALTER TABLE admins DROP COLUMN display_name;

