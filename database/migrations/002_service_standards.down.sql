DROP INDEX IF EXISTS idx_service_request_workflow;
ALTER TABLE service_requests DROP COLUMN completed_at;
ALTER TABLE service_requests DROP COLUMN internal_notes;
ALTER TABLE service_requests DROP COLUMN requested_for;
ALTER TABLE service_requests DROP COLUMN assigned_to;
ALTER TABLE service_requests DROP COLUMN department_id;
ALTER TABLE service_requests DROP COLUMN priority;

