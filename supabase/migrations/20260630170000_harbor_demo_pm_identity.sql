-- Keep existing Harbor Residence teaching projects aligned with the demo identity.

UPDATE public.projects
SET project_manager = 'Marshall Wilkinson'
WHERE (name = 'Harbor Residence' OR job_number = 'DEMO-HARBOR')
  AND project_manager = 'Overwatch Demo PM';

UPDATE public.daily_reports dr
SET author = 'Marshall Wilkinson'
FROM public.projects p
WHERE dr.project_id = p.id
  AND (p.name = 'Harbor Residence' OR p.job_number = 'DEMO-HARBOR')
  AND dr.author = 'Overwatch Demo PM';

UPDATE public.reviews r
SET reviewer = 'Marshall Wilkinson'
FROM public.projects p
WHERE r.project_id = p.id
  AND (p.name = 'Harbor Residence' OR p.job_number = 'DEMO-HARBOR')
  AND r.reviewer = 'Overwatch Demo PM';
