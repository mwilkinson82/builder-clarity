-- CRMFOLLOWUP1 security follow-up.
--
-- Some existing Supabase projects automatically expose newly created public
-- tables to both Data API roles. The foundation migration grants only the
-- authenticated role intentionally; make the anonymous denial explicit so
-- project-level exposure defaults cannot widen CRM access.

REVOKE ALL PRIVILEGES ON TABLE public.crm_value_assets FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.crm_followup_playbooks FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.crm_followup_playbook_steps FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.crm_followup_enrollments FROM anon;
