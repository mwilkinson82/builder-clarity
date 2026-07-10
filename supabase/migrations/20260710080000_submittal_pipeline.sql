-- SUBMITTAL / RFI PIPELINE (field request, DB3T 2026-07-10): "create at the
-- beginning of the job a list of submittals that need to be sent and have that
-- first stage be called 'pending' then submitted once its all submitted. same
-- for rfis" — plus a due date so the log can track days outstanding.
--
-- 1) status gains 'pending' — the planned-at-job-start stage, before anything
--    is sent. Existing values keep their meaning ('' = legacy not-set).
-- 2) due_date — when the answer/return is needed by; drives the overdue flag
--    and days-outstanding tracking in the log.
-- Idempotent + portable; migration desk applies this.

ALTER TABLE public.submittal_log_entries
  DROP CONSTRAINT IF EXISTS submittal_log_entries_status_check;
ALTER TABLE public.submittal_log_entries
  ADD CONSTRAINT submittal_log_entries_status_check
    CHECK (status IN ('', 'pending', 'a', 'aan', 'rar', 'ur'));

ALTER TABLE public.submittal_log_entries
  ADD COLUMN IF NOT EXISTS due_date date;

NOTIFY pgrst, 'reload schema';
