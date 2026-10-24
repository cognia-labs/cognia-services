-- Windowed alerts (crash spike, upload and storage failure, processing
-- backlog) look back over their own recent deliveries before queueing, and the
-- spike rule counts a group's accepted incidents over a trailing window. Both
-- run inside the transaction that accepts an incident or refuses an upload.
CREATE INDEX alert_deliveries_dedupe_idx
    ON alert_deliveries (tenant_id, project_id, alert_kind, created_at);
CREATE INDEX incidents_group_accepted_idx
    ON incidents (tenant_id, group_id, accepted_at)
    WHERE accepted_at IS NOT NULL;
