-- Re-run the Harbor Residence CPM seed with broader project matching.
-- Earlier backfill matched only the exact project name. Some live demo copies
-- carry company-specific metadata, so this migration catches Harbor-named,
-- demo-numbered, or Private Luxury Residence demo projects.

WITH demo_projects AS (
  SELECT id
  FROM public.projects
  WHERE lower(coalesce(name, '')) LIKE '%harbor residence%'
    OR lower(coalesce(job_number, '')) LIKE '%harbor%'
    OR lower(coalesce(client, '')) LIKE '%private luxury residence%'
),
placeholder_cleanup AS (
  DELETE FROM public.schedule_activities a
  USING demo_projects p
  WHERE a.project_id = p.id
    AND a.activity_id LIKE 'A-%'
    AND a.division = 'Milestones'
    AND NOT EXISTS (
      SELECT 1
      FROM public.schedule_activities seeded
      WHERE seeded.project_id = a.project_id
        AND seeded.activity_id = '01-010'
    )
  RETURNING a.project_id
),
demo_activities (
  activity_id,
  name,
  division,
  start_date,
  finish_date,
  percent_complete,
  predecessor_activity_ids,
  successor_activity_ids,
  notes,
  sort_order
) AS (
  VALUES
    (
      '01-010',
      'Contract award and preconstruction complete',
      '00 - Procurement / Preconstruction',
      DATE '2026-02-03',
      DATE '2026-02-07',
      100,
      ARRAY[]::text[],
      ARRAY['01-020','12-010']::text[],
      'Baseline launch activity. This anchors the CPM network before site mobilization and long-lead procurement.',
      1
    ),
    (
      '01-020',
      'Site mobilization and layout',
      '01 - General Requirements',
      DATE '2026-02-10',
      DATE '2026-02-14',
      100,
      ARRAY['01-010']::text[],
      ARRAY['31-010']::text[],
      'Mobilization, layout, temporary protection, and trade coordination before field production begins.',
      2
    ),
    (
      '31-010',
      'Sitework, utilities, and erosion control',
      '31 - Earthwork / Sitework',
      DATE '2026-02-17',
      DATE '2026-02-28',
      100,
      ARRAY['01-020']::text[],
      ARRAY['03-010']::text[],
      'Site readiness activity. Completing this cleanly protects foundation start and early project momentum.',
      3
    ),
    (
      '03-010',
      'Foundations and slab',
      '03 - Concrete',
      DATE '2026-03-03',
      DATE '2026-03-21',
      100,
      ARRAY['31-010']::text[],
      ARRAY['06-010']::text[],
      'Foundation and slab work complete. This drives the structural shell.',
      4
    ),
    (
      '06-010',
      'Framing and structural shell',
      '06 - Wood / Framing',
      DATE '2026-03-24',
      DATE '2026-04-18',
      100,
      ARRAY['03-010']::text[],
      ARRAY['07-010','22-010','23-010','26-010']::text[],
      'Structural shell complete. Multiple rough-in and dry-in paths start once this is released.',
      5
    ),
    (
      '07-010',
      'Dry-in envelope and roof',
      '07 - Thermal / Moisture',
      DATE '2026-04-21',
      DATE '2026-05-09',
      100,
      ARRAY['06-010']::text[],
      ARRAY['08-010','32-010']::text[],
      'Dry-in finished one week later than baseline, which contributes to later rough-in and finish pressure.',
      6
    ),
    (
      '08-010',
      'Windows and exterior doors',
      '08 - Openings',
      DATE '2026-05-12',
      DATE '2026-06-02',
      80,
      ARRAY['07-010']::text[],
      ARRAY['09-010']::text[],
      'Window delivery moved five weeks. The PM is tracking resequencing before acceleration costs become real exposure.',
      7
    ),
    (
      '22-010',
      'Plumbing rough-in',
      '22 - Plumbing',
      DATE '2026-04-28',
      DATE '2026-05-16',
      100,
      ARRAY['06-010']::text[],
      ARRAY['09-010']::text[],
      'Plumbing rough-in complete and ready for inspection closeout.',
      8
    ),
    (
      '23-010',
      'HVAC rough-in',
      '23 - HVAC',
      DATE '2026-04-28',
      DATE '2026-05-16',
      100,
      ARRAY['06-010']::text[],
      ARRAY['09-010']::text[],
      'HVAC rough-in complete. Coordination hold is now on appliance and opening decisions.',
      9
    ),
    (
      '26-010',
      'Electrical rough-in',
      '26 - Electrical',
      DATE '2026-04-29',
      DATE '2026-05-20',
      100,
      ARRAY['06-010']::text[],
      ARRAY['09-010']::text[],
      'Electrical rough-in complete. Lighting allowance exposure remains in the IOR because selections exceeded allowance.',
      10
    ),
    (
      '09-010',
      'Rough inspections and insulation',
      '09 - Finishes',
      DATE '2026-05-23',
      DATE '2026-06-05',
      65,
      ARRAY['08-010','22-010','23-010','26-010']::text[],
      ARRAY['09-020']::text[],
      'Rough inspections and insulation are the current handoff point into drywall. This is where the late appliance and window issues show up in the schedule.',
      11
    ),
    (
      '09-020',
      'Drywall hang and finish',
      '09 - Finishes',
      DATE '2026-06-06',
      DATE '2026-06-28',
      40,
      ARRAY['09-010']::text[],
      ARRAY['09-030','12-020']::text[],
      'Drywall is active and under performance watch. If quality slips, the E-Hold becomes a trade-performance recovery action.',
      12
    ),
    (
      '09-030',
      'Tile and interior finish start',
      '09 - Finishes',
      DATE '2026-06-24',
      DATE '2026-07-15',
      20,
      ARRAY['09-020']::text[],
      ARRAY['09-040']::text[],
      'Interior finish activity overlaps late drywall areas where possible so the team can claw back schedule without buying full acceleration.',
      13
    ),
    (
      '12-010',
      'Cabinet fabrication and delivery',
      '12 - Furnishings / Casework',
      DATE '2026-04-20',
      DATE '2026-07-03',
      50,
      ARRAY['01-010']::text[],
      ARRAY['12-020']::text[],
      'Cabinets were misassembled and damaged. This is a long-lead procurement activity tied directly to a recoverable E-Hold.',
      14
    ),
    (
      '12-020',
      'Cabinet install and built-ins',
      '12 - Furnishings / Casework',
      DATE '2026-07-06',
      DATE '2026-07-17',
      0,
      ARRAY['09-020','12-010']::text[],
      ARRAY['22-020','26-020','09-040']::text[],
      'Install cannot start until drywall areas and replacement cabinet delivery are released.',
      15
    ),
    (
      '22-020',
      'Trim plumbing and fixtures',
      '22 - Plumbing',
      DATE '2026-07-20',
      DATE '2026-07-28',
      0,
      ARRAY['12-020']::text[],
      ARRAY['99-010']::text[],
      'Trim plumbing follows cabinet and finish release. This should be watched for owner-furnished fixture decisions.',
      16
    ),
    (
      '26-020',
      'Trim electrical and lighting package',
      '26 - Electrical',
      DATE '2026-07-20',
      DATE '2026-07-31',
      0,
      ARRAY['12-020']::text[],
      ARRAY['99-010']::text[],
      'Lighting selections drove allowance exposure. This activity shows how financial exposure and CPM logic meet.',
      17
    ),
    (
      '09-040',
      'Paint, final finishes, and punch prep',
      '09 - Finishes',
      DATE '2026-07-18',
      DATE '2026-08-01',
      0,
      ARRAY['09-030','12-020']::text[],
      ARRAY['99-010']::text[],
      'Final finishes are the point where the C-Hold for finish-phase uncertainty should be gardened and then released.',
      18
    ),
    (
      '32-010',
      'Exterior hardscape and pool coordination',
      '32 - Exterior Improvements',
      DATE '2026-06-17',
      DATE '2026-08-07',
      30,
      ARRAY['07-010']::text[],
      ARRAY['99-010']::text[],
      'Pool equipment relocation and outdoor kitchen change orders are shown here as schedule-adjacent scope exposure.',
      19
    ),
    (
      '99-010',
      'Final punch, owner walk, and substantial completion',
      '99 - Closeout',
      DATE '2026-08-10',
      DATE '2026-08-21',
      0,
      ARRAY['22-020','26-020','09-040','32-010']::text[],
      ARRAY[]::text[],
      'Closeout milestone. This rolls the CPM story into the IOR: current schedule is later than baseline, and risk decisions decide how much margin is protected.',
      20
    )
)
INSERT INTO public.schedule_activities (
  project_id,
  activity_id,
  name,
  division,
  start_date,
  finish_date,
  percent_complete,
  predecessor_activity_ids,
  successor_activity_ids,
  notes,
  sort_order
)
SELECT
  p.id,
  a.activity_id,
  a.name,
  a.division,
  a.start_date,
  a.finish_date,
  a.percent_complete,
  a.predecessor_activity_ids,
  a.successor_activity_ids,
  a.notes,
  a.sort_order
FROM demo_projects p
CROSS JOIN demo_activities a
WHERE NOT EXISTS (
  SELECT 1
  FROM public.schedule_activities existing
  WHERE existing.project_id = p.id
    AND existing.activity_id = a.activity_id
);
