-- =========================================================================
-- Migration 006: Database-Backed Auto-Save Payment Purposes
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.payment_purposes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_purposes_company_label
  ON public.payment_purposes (company_id, LOWER(TRIM(label)));

CREATE INDEX IF NOT EXISTS idx_payment_purposes_company
  ON public.payment_purposes (company_id, label ASC);

ALTER TABLE public.payment_purposes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Company members can read payment purposes" ON public.payment_purposes;
CREATE POLICY "Company members can read payment purposes"
  ON public.payment_purposes
  FOR SELECT
  TO authenticated
  USING (public.has_company_access(company_id));

DROP POLICY IF EXISTS "Preparers and admins can insert payment purposes" ON public.payment_purposes;
CREATE POLICY "Preparers and admins can insert payment purposes"
  ON public.payment_purposes
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_company_access(company_id)
    AND (public.get_my_role() = 'PREPARER' OR public.is_admin_user())
  );

DROP POLICY IF EXISTS "Preparers and admins can delete payment purposes" ON public.payment_purposes;
CREATE POLICY "Preparers and admins can delete payment purposes"
  ON public.payment_purposes
  FOR DELETE
  TO authenticated
  USING (
    public.has_company_access(company_id)
    AND (public.get_my_role() = 'PREPARER' OR public.is_admin_user())
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_purposes TO authenticated;
GRANT ALL ON public.payment_purposes TO service_role;

-- Seed starter default purposes for both INDFURN and VINMORE idempotently
INSERT INTO public.payment_purposes (company_id, label)
SELECT c.id, p.label
FROM public.companies c
CROSS JOIN (
  VALUES
    ('Against Bill'),
    ('On Account'),
    ('Advance'),
    ('Electricity Charge'),
    ('Rent'),
    ('Staff Salary'),
    ('Freight / Transport')
) AS p(label)
WHERE c.code IN ('INDFURN', 'VINMORE')
ON CONFLICT DO NOTHING;
