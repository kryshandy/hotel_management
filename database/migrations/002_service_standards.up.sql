ALTER TABLE service_requests ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high','urgent'));
ALTER TABLE service_requests ADD COLUMN department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL;
ALTER TABLE service_requests ADD COLUMN assigned_to TEXT NOT NULL DEFAULT '';
ALTER TABLE service_requests ADD COLUMN requested_for TEXT;
ALTER TABLE service_requests ADD COLUMN internal_notes TEXT NOT NULL DEFAULT '';
ALTER TABLE service_requests ADD COLUMN completed_at TEXT;
CREATE INDEX idx_service_request_workflow ON service_requests(status,priority,department_id,created_at);

