CREATE OR REPLACE FUNCTION public.reorder_schedule_wbs_sections(
  p_project_id uuid,
  p_parent_id uuid,
  p_ordered_ids uuid[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_expected integer := cardinality(p_ordered_ids);
  v_matched integer := 0;
  v_changed integer := 0;
BEGIN
  IF p_project_id IS NULL THEN
    RAISE EXCEPTION 'Project is required.';
  END IF;

  IF p_ordered_ids IS NULL OR cardinality(p_ordered_ids) = 0 THEN
    RETURN 0;
  END IF;

  IF NOT public.can_manage_project(p_project_id) THEN
    RAISE EXCEPTION 'You do not have permission to manage this project schedule.';
  END IF;

  SELECT count(*)
    INTO v_matched
  FROM public.schedule_wbs_sections section
  WHERE section.project_id = p_project_id
    AND section.id = ANY(p_ordered_ids)
    AND section.parent_id IS NOT DISTINCT FROM p_parent_id;

  IF v_matched <> v_expected THEN
    RAISE EXCEPTION 'WBS order can only be saved for sections under the same parent.';
  END IF;

  WITH ordered AS (
    SELECT
      item.id,
      (item.ordinality::integer * 10) AS sort_order
    FROM unnest(p_ordered_ids) WITH ORDINALITY AS item(id, ordinality)
  ),
  updated AS (
    UPDATE public.schedule_wbs_sections section
    SET sort_order = ordered.sort_order
    FROM ordered
    WHERE section.project_id = p_project_id
      AND section.id = ordered.id
      AND section.parent_id IS NOT DISTINCT FROM p_parent_id
      AND section.sort_order IS DISTINCT FROM ordered.sort_order
    RETURNING section.id
  )
  SELECT count(*) INTO v_changed FROM updated;

  RETURN v_changed;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reorder_schedule_wbs_sections(uuid, uuid, uuid[]) TO authenticated;
