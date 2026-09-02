-- The sender needs to read the queue it drains.
--
-- 20260901140000 revoked the outbox from anon and authenticated, which was right —
-- it holds who cancelled on whom across every league — but relied on the default
-- privileges to leave service_role its access. They do not: service_role came out
-- of that migration holding TRIGGER, TRUNCATE and REFERENCES and none of the DML
-- it actually uses, so the function failed with "permission denied for view
-- pending_notifications" the first time there was anything in the queue to read.
--
-- Worth noting how close that came to shipping: an empty queue never touches the
-- view, so the deployed function answered 200 and looked healthy. It would have
-- broken on the first real drop-out and nowhere earlier.
--
-- Granted explicitly here rather than by not revoking, so the privileges say what
-- they mean and do not depend on what the platform's defaults happen to be.
grant select on public.pending_notifications to service_role;

-- Select to find them, update to mark them sent or record why they were not.
-- No insert: rows arrive from the triggers only. No delete: a sent notice is the
-- record that it was sent.
grant select, update on public.notification_outbox to service_role;
