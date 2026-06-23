-- Keep one Harbor Residence learning project per Overwatch company workspace.
-- The app-side seed uses this reserved job number to avoid creating duplicate
-- demo projects when users return to the Portfolio page.
CREATE UNIQUE INDEX IF NOT EXISTS projects_org_harbor_demo_job_number_idx
  ON public.projects(organization_id, job_number)
  WHERE job_number = 'DEMO-HARBOR';
