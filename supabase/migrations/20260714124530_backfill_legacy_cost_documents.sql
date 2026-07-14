-- The pre-document multi-line invoice form wrote allocation rows sequentially.
-- When those rows had neither an uploaded file nor a reference number, the
-- initial document migration intentionally left them separate. Reunite only
-- the unmistakable legacy save signature: identical shared invoice fields,
-- created in the same second, before the document-aware code was merged.

WITH legacy_groups AS (
  SELECT
    id,
    (min(id::text) OVER legacy_invoice)::uuid AS document_id,
    count(*) OVER legacy_invoice AS line_count
  FROM public.cost_actuals
  WHERE cost_document_id = id
    AND created_at < timestamptz '2026-07-14 16:43:01+00'
  WINDOW legacy_invoice AS (
    PARTITION BY
      project_id,
      lower(btrim(vendor)),
      lower(btrim(reference_number)),
      cost_date,
      category,
      status,
      btrim(notes),
      date_trunc('second', created_at)
  )
)
UPDATE public.cost_actuals AS actual
SET cost_document_id = grouped.document_id
FROM legacy_groups AS grouped
WHERE actual.id = grouped.id
  AND grouped.line_count > 1;
