-- Admin poller kill-switch policy
-- ---------------------------------------------------------------------------
-- The live-feed backend tables (sync_state, etc.) were created outside
-- schema.sql. They are client-read-only by default, but the Admin "API Health"
-- panel needs commissioners to flip sync_state.poller_paused. Without an UPDATE
-- policy, Supabase silently changes 0 rows and the toggle reverts.
--
-- Run this once in the Supabase SQL Editor. Uses the existing is_admin()
-- helper (see schema.sql) and matches the admin_group_results policy style.

create policy admin_update_sync_state on sync_state
  for update to authenticated
  using (is_admin()) with check (is_admin());

-- If you also want to scope it to a single row, the panel only ever touches
-- id = 1, so the policy above is already safe (sync-live runs as service_role
-- and bypasses RLS entirely).
