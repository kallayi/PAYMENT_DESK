-- =========================================================================
-- Migration 008: Direct Payment Requests Inbox (/requests)
-- Owner / Admin / Verifier -> Preparer -> Standard Approval Workflow
-- Strictly isolated per company and idempotent.
-- =========================================================================

-- 1. Create public.payment_requests table
CREATE TABLE IF NOT EXISTS public.payment_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  vendor_id UUID REFERENCES public.vendors(id) ON DELETE RESTRICT,
  unlisted_vendor_name TEXT,
  gross_amount NUMERIC(14, 2) NOT NULL CHECK (gross_amount > 0),
  invoice_ref TEXT,
  purpose TEXT NOT NULL,
  due_date DATE,
  remarks TEXT,
  bill_file_path TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SUBMITTED', 'DECLINED', 'CANCELLED')),
  requested_by UUID NOT NULL REFERENCES public.profiles(id),
  requested_role TEXT NOT NULL,
  processed_by UUID REFERENCES public.profiles(id),
  processed_at TIMESTAMPTZ,
  decline_reason TEXT,
  converted_payment_id UUID REFERENCES public.payment_items(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_requests_company_status
  ON public.payment_requests(company_id, status, created_at DESC);

DROP TRIGGER IF EXISTS trg_payment_requests_updated_at ON public.payment_requests;
CREATE TRIGGER trg_payment_requests_updated_at
  BEFORE UPDATE ON public.payment_requests
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 2. Extend notification_event enum and notifications columns idempotently
ALTER TYPE public.notification_event ADD VALUE IF NOT EXISTS 'PAYMENT_REQUEST_CREATED';
ALTER TYPE public.notification_event ADD VALUE IF NOT EXISTS 'PAYMENT_REQUEST_SUBMITTED';
ALTER TYPE public.notification_event ADD VALUE IF NOT EXISTS 'PAYMENT_REQUEST_DECLINED';

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS payment_request_id UUID REFERENCES public.payment_requests(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS action_url TEXT;

-- 3. Enable RLS & Company-Scoped Policies on public.payment_requests
ALTER TABLE public.payment_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "payment_requests_select" ON public.payment_requests;
CREATE POLICY "payment_requests_select" ON public.payment_requests
  FOR SELECT TO authenticated
  USING (
    public.has_company_access(company_id)
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.is_active = TRUE
    )
  );

DROP POLICY IF EXISTS "payment_requests_insert" ON public.payment_requests;
CREATE POLICY "payment_requests_insert" ON public.payment_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_company_access(company_id)
    AND requested_by = auth.uid()
    AND (public.get_my_role() IN ('APPROVER', 'VERIFIER') OR public.is_admin_user())
  );

DROP POLICY IF EXISTS "payment_requests_update" ON public.payment_requests;
CREATE POLICY "payment_requests_update" ON public.payment_requests
  FOR UPDATE TO authenticated
  USING (
    public.has_company_access(company_id)
    AND (
      public.get_my_role() = 'PREPARER'
      OR public.is_admin_user()
      OR (requested_by = auth.uid() AND status = 'PENDING')
    )
  )
  WITH CHECK (
    public.has_company_access(company_id)
    AND (
      public.get_my_role() = 'PREPARER'
      OR public.is_admin_user()
      OR requested_by = auth.uid()
    )
  );

GRANT SELECT, INSERT, UPDATE ON public.payment_requests TO authenticated;
GRANT ALL ON public.payment_requests TO service_role;

-- 4. Allow APPROVER and VERIFIER to upload request bills into supplier-invoices bucket
DROP POLICY IF EXISTS "supplier_invoices_insert" ON storage.objects;
CREATE POLICY "supplier_invoices_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'supplier-invoices'
    AND (public.get_my_role() IN ('PREPARER', 'APPROVER', 'VERIFIER') OR public.is_admin_user())
    AND (
      CASE
        WHEN (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
        THEN public.has_company_access(((storage.foldername(name))[1])::uuid)
        ELSE FALSE
      END
    )
  );

-- 5. Enable Supabase Realtime publication idempotently for live inbox sync
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'payment_requests'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.payment_requests;
    END IF;
  END IF;
END $$;
