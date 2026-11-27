-- ==========================================
-- Migration 009: Allow VERIFIER to Insert Company Vendors
-- Payment Desk (v2) - INDFURN & VINMORE
-- ==========================================

DROP POLICY IF EXISTS "vendors_insert" ON public.vendors;
CREATE POLICY "vendors_insert" ON public.vendors
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_company_access(company_id)
    AND (
      public.get_my_role() IN ('PREPARER', 'VERIFIER')
      OR public.is_admin_user()
    )
  );
