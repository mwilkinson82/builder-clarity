-- COMPLIANCE GATING (docs/compliance arc, module 2) — lien waivers + insurance
-- as HARD gates on subcontractor payment.
--
-- Founder rule: by default a subcontractor can't be paid until (a) a valid
-- Certificate of Insurance is on file and (b) a lien waiver for the payment is
-- collected. A per-project toggle turns the requirement off ("I don't require
-- this for this project — I'll check it myself"). The gate is enforced
-- server-side in recordSubcontractPayment; this migration is the storage + the
-- toggle. Certificate/waiver PDFs live in the existing private 'project-docs'
-- bucket (reused — no new bucket), path <projectId>/<file>, team storage RLS.
--
-- v1 is the SUBCONTRACTOR side only. The owner/self-perform side (GC's COI to the
-- owner, GC lien waivers on pay-apps) is module 2b. Idempotent + portable.

-- ── Per-project enforcement toggle (default ON) ─────────────────────────────
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS require_compliance_gating boolean NOT NULL DEFAULT true;

-- ── Insurance certificates (COIs), one or more per subcontract (renewals) ───
CREATE TABLE IF NOT EXISTS public.insurance_certificates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  subcontract_id uuid NOT NULL REFERENCES public.subcontracts(id) ON DELETE CASCADE,
  carrier text NOT NULL DEFAULT '',
  effective_date date,
  expiry_date date,
  -- The reviewer's "this COI is valid / verified" attestation. A cert can be on
  -- file but not yet checked — only a verified, unexpired cert clears the gate.
  verified boolean NOT NULL DEFAULT false,
  -- Coverage limits (dollars). 0 = not captured.
  gl_limit numeric NOT NULL DEFAULT 0,
  wc_limit numeric NOT NULL DEFAULT 0,
  auto_limit numeric NOT NULL DEFAULT 0,
  umbrella_limit numeric NOT NULL DEFAULT 0,
  other_coverage text NOT NULL DEFAULT '',
  storage_path text NOT NULL DEFAULT '',
  file_name text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  uploaded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS insurance_certificates_subcontract_idx
  ON public.insurance_certificates(subcontract_id);
CREATE INDEX IF NOT EXISTS insurance_certificates_project_idx
  ON public.insurance_certificates(project_id);

-- ── Lien waivers, collected per payment/period ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.lien_waivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  subcontract_id uuid NOT NULL REFERENCES public.subcontracts(id) ON DELETE CASCADE,
  -- The payment this waiver covers, once recorded. Nullable so a waiver can be
  -- collected first (clearing the gate) and the payment recorded against it.
  payment_id uuid REFERENCES public.subcontract_payments(id) ON DELETE SET NULL,
  waiver_type text NOT NULL DEFAULT 'conditional_progress'
    CHECK (waiver_type IN (
      'conditional_progress','unconditional_progress',
      'conditional_final','unconditional_final'
    )),
  through_date date,
  amount numeric NOT NULL DEFAULT 0,
  signed_date date,
  storage_path text NOT NULL DEFAULT '',
  file_name text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  uploaded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lien_waivers_subcontract_idx
  ON public.lien_waivers(subcontract_id);
CREATE INDEX IF NOT EXISTS lien_waivers_project_idx ON public.lien_waivers(project_id);
CREATE INDEX IF NOT EXISTS lien_waivers_payment_idx ON public.lien_waivers(payment_id);

-- ── Grants + RLS (team-based, matching subcontracts) ────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON public.insurance_certificates TO authenticated;
GRANT ALL ON public.insurance_certificates TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lien_waivers TO authenticated;
GRANT ALL ON public.lien_waivers TO service_role;

ALTER TABLE public.insurance_certificates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lien_waivers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS insurance_certificates_select ON public.insurance_certificates;
CREATE POLICY insurance_certificates_select ON public.insurance_certificates
  FOR SELECT USING (public.can_read_project(project_id));
DROP POLICY IF EXISTS insurance_certificates_insert ON public.insurance_certificates;
CREATE POLICY insurance_certificates_insert ON public.insurance_certificates
  FOR INSERT WITH CHECK (public.can_manage_project(project_id));
DROP POLICY IF EXISTS insurance_certificates_update ON public.insurance_certificates;
CREATE POLICY insurance_certificates_update ON public.insurance_certificates
  FOR UPDATE USING (public.can_manage_project(project_id))
  WITH CHECK (public.can_manage_project(project_id));
DROP POLICY IF EXISTS insurance_certificates_delete ON public.insurance_certificates;
CREATE POLICY insurance_certificates_delete ON public.insurance_certificates
  FOR DELETE USING (public.can_manage_project(project_id));

DROP POLICY IF EXISTS lien_waivers_select ON public.lien_waivers;
CREATE POLICY lien_waivers_select ON public.lien_waivers
  FOR SELECT USING (public.can_read_project(project_id));
DROP POLICY IF EXISTS lien_waivers_insert ON public.lien_waivers;
CREATE POLICY lien_waivers_insert ON public.lien_waivers
  FOR INSERT WITH CHECK (public.can_manage_project(project_id));
DROP POLICY IF EXISTS lien_waivers_update ON public.lien_waivers;
CREATE POLICY lien_waivers_update ON public.lien_waivers
  FOR UPDATE USING (public.can_manage_project(project_id))
  WITH CHECK (public.can_manage_project(project_id));
DROP POLICY IF EXISTS lien_waivers_delete ON public.lien_waivers;
CREATE POLICY lien_waivers_delete ON public.lien_waivers
  FOR DELETE USING (public.can_manage_project(project_id));
