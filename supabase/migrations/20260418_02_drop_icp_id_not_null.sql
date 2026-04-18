-- Allow icp_id to be nullable in agent_lead_queue.
-- The simplified lead insert model no longer provides icp_id,
-- so the NOT NULL constraint was blocking all lead inserts.

alter table agent_lead_queue
  alter column icp_id drop not null;
