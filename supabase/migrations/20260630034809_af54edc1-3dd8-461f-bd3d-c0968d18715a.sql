CREATE TABLE IF NOT EXISTS public.billing_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  billing_application_id uuid REFERENCES public.billing_applications(id) ON DELETE SET NULL,
  invoice_number text NOT NULL DEFAULT '',
  title text NOT NULL DEFAULT '',
  issue_date date,
  due_date date,
  subtotal numeric NOT NULL DEFAULT 0,
  retainage numeric NOT NULL DEFAULT 0,
  total_due numeric NOT NULL DEFAULT 0,
  paid_amount numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft',
  client_visible boolean NOT NULL DEFAULT false,
  sent_at timestamptz,
  paid_at timestamptz,
  notes text NOT NULL DEFAULT '',
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_invoices_status_check CHECK (
    status IN ('draft', 'sent', 'viewed', 'partially_paid', 'paid', 'overdue', 'void')
  )
);

CREATE TABLE IF NOT EXISTS public.payment_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES public.billing_invoices(id) ON DELETE CASCADE,
  billing_application_id uuid REFERENCES public.billing_applications(id) ON DELETE SET NULL,
  amount numeric NOT NULL DEFAULT 0,
  processor_fee numeric NOT NULL DEFAULT 0,
  overwatch_fee numeric NOT NULL DEFAULT 0,
  net_payout numeric NOT NULL DEFAULT 0,
  payment_method text NOT NULL DEFAULT 'manual',
  processor text NOT NULL DEFAULT 'manual',
  processor_payment_id text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'succeeded',
  paid_at timestamptz NOT NULL DEFAULT now(),
  notes text NOT NULL DEFAULT '',
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_ledger_status_check CHECK (
    status IN ('pending', 'succeeded', 'failed', 'refunded', 'void')
  )
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.billing_invoices TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_ledger TO authenticated;
GRANT ALL ON public.billing_invoices TO service_role;
GRANT ALL ON public.payment_ledger TO service_role;

ALTER TABLE public.billing_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_ledger ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS billing_invoices_project_id_idx
  ON public.billing_invoices(project_id, issue_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS billing_invoices_billing_application_id_idx
  ON public.billing_invoices(billing_application_id);
CREATE INDEX IF NOT EXISTS billing_invoices_client_visible_idx
  ON public.billing_invoices(project_id, client_visible, status);
CREATE INDEX IF NOT EXISTS payment_ledger_project_id_idx
  ON public.payment_ledger(project_id, paid_at DESC);
CREATE INDEX IF NOT EXISTS payment_ledger_invoice_id_idx
  ON public.payment_ledger(invoice_id, paid_at DESC);

DROP TRIGGER IF EXISTS billing_invoices_set_updated_at ON public.billing_invoices;
CREATE TRIGGER billing_invoices_set_updated_at
  BEFORE UPDATE ON public.billing_invoices
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DROP TRIGGER IF EXISTS payment_ledger_set_updated_at ON public.payment_ledger;
CREATE TRIGGER payment_ledger_set_updated_at
  BEFORE UPDATE ON public.payment_ledger
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DROP POLICY IF EXISTS billing_invoices_team_select ON public.billing_invoices;
CREATE POLICY billing_invoices_team_select ON public.billing_invoices
  FOR SELECT TO authenticated
  USING (public.can_read_project(project_id));

DROP POLICY IF EXISTS billing_invoices_team_insert ON public.billing_invoices;
CREATE POLICY billing_invoices_team_insert ON public.billing_invoices
  FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_project(project_id));

DROP POLICY IF EXISTS billing_invoices_team_update ON public.billing_invoices;
CREATE POLICY billing_invoices_team_update ON public.billing_invoices
  FOR UPDATE TO authenticated
  USING (public.can_manage_project(project_id))
  WITH CHECK (public.can_manage_project(project_id));

DROP POLICY IF EXISTS billing_invoices_team_delete ON public.billing_invoices;
CREATE POLICY billing_invoices_team_delete ON public.billing_invoices
  FOR DELETE TO authenticated
  USING (public.can_manage_project(project_id));

DROP POLICY IF EXISTS billing_invoices_client_select ON public.billing_invoices;
CREATE POLICY billing_invoices_client_select ON public.billing_invoices
  FOR SELECT TO authenticated
  USING (client_visible AND public.can_view_client_billing(project_id));

DROP POLICY IF EXISTS payment_ledger_team_select ON public.payment_ledger;
CREATE POLICY payment_ledger_team_select ON public.payment_ledger
  FOR SELECT TO authenticated
  USING (public.can_read_project(project_id));

DROP POLICY IF EXISTS payment_ledger_team_insert ON public.payment_ledger;
CREATE POLICY payment_ledger_team_insert ON public.payment_ledger
  FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_project(project_id));

DROP POLICY IF EXISTS payment_ledger_team_update ON public.payment_ledger;
CREATE POLICY payment_ledger_team_update ON public.payment_ledger
  FOR UPDATE TO authenticated
  USING (public.can_manage_project(project_id))
  WITH CHECK (public.can_manage_project(project_id));

DROP POLICY IF EXISTS payment_ledger_team_delete ON public.payment_ledger;
CREATE POLICY payment_ledger_team_delete ON public.payment_ledger
  FOR DELETE TO authenticated
  USING (public.can_manage_project(project_id));

DROP POLICY IF EXISTS payment_ledger_client_select ON public.payment_ledger;
CREATE POLICY payment_ledger_client_select ON public.payment_ledger
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.billing_invoices i
      WHERE i.id = payment_ledger.invoice_id
        AND i.project_id = payment_ledger.project_id
        AND i.client_visible
        AND public.can_view_client_billing(i.project_id)
    )
  );

INSERT INTO public.billing_invoices (
  project_id, billing_application_id, invoice_number, title, issue_date, due_date,
  subtotal, retainage, total_due, paid_amount, status, client_visible, sent_at, paid_at,
  notes, created_at, updated_at
)
SELECT
  b.project_id, b.id,
  COALESCE(NULLIF(b.invoice_number, ''), b.application_number, ''),
  COALESCE(NULLIF(b.application_number, ''), NULLIF(b.invoice_number, ''), 'Pay application invoice'),
  b.submitted_date, b.due_date,
  COALESCE(b.amount_billed, 0), COALESCE(b.retainage, 0),
  GREATEST(0, COALESCE(b.amount_billed, 0) - COALESCE(b.retainage, 0)),
  COALESCE(b.paid_to_date, 0),
  CASE
    WHEN COALESCE(b.paid_to_date, 0) >= GREATEST(0, COALESCE(b.amount_billed, 0) - COALESCE(b.retainage, 0))
      AND GREATEST(0, COALESCE(b.amount_billed, 0) - COALESCE(b.retainage, 0)) > 0 THEN 'paid'
    WHEN COALESCE(b.paid_to_date, 0) > 0 THEN 'partially_paid'
    WHEN b.status = 'submitted' THEN 'sent'
    WHEN b.status = 'paid' THEN 'paid'
    WHEN b.status = 'partial' THEN 'partially_paid'
    WHEN b.status = 'rejected' THEN 'void'
    ELSE 'draft'
  END,
  b.status IN ('submitted', 'paid', 'partial'),
  CASE WHEN b.status IN ('submitted', 'paid', 'partial') THEN COALESCE(b.updated_at, b.created_at, now()) END,
  CASE WHEN b.status = 'paid' THEN COALESCE(b.updated_at, now()) END,
  COALESCE(b.notes, ''),
  COALESCE(b.created_at, now()), COALESCE(b.updated_at, now())
FROM public.billing_applications b
WHERE NOT EXISTS (SELECT 1 FROM public.billing_invoices i WHERE i.billing_application_id = b.id);

INSERT INTO public.payment_ledger (
  project_id, invoice_id, billing_application_id, amount, processor_fee, overwatch_fee,
  net_payout, payment_method, processor, status, paid_at, notes, created_at, updated_at
)
SELECT
  i.project_id, i.id, i.billing_application_id, i.paid_amount, 0, 0, i.paid_amount,
  'manual', 'manual', 'succeeded',
  COALESCE(i.paid_at, i.updated_at, now()),
  'Existing paid-to-date balance imported from pay application.',
  COALESCE(i.updated_at, now()), COALESCE(i.updated_at, now())
FROM public.billing_invoices i
WHERE i.paid_amount > 0
  AND NOT EXISTS (SELECT 1 FROM public.payment_ledger p WHERE p.invoice_id = i.id AND p.status = 'succeeded');