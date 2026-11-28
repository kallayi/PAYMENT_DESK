-- =========================================================================
-- Migration 015: Grant Accounts Preparers Company Bank Management RLS
-- Payment Desk (v2) - INDFURN & VINMORE
-- Idempotent & safe to run repeatedly in Supabase SQL Editor.
-- Note: DELETE on public.company_banks stays strictly Admin-only.
-- =========================================================================

-- 1. Allow active PREPARER (or Admin) to INSERT company_banks strictly inside authorized companies
DROP POLICY IF EXISTS "company_banks_preparer_insert" ON public.company_banks;
CREATE POLICY "company_banks_preparer_insert" ON public.company_banks
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_company_access(company_id)
    AND (public.get_my_role() = 'PREPARER' OR public.is_admin_user())
  );

-- 2. Allow active PREPARER (or Admin) to UPDATE company_banks strictly inside authorized companies
DROP POLICY IF EXISTS "company_banks_preparer_update_balance" ON public.company_banks;
DROP POLICY IF EXISTS "company_banks_preparer_update" ON public.company_banks;
CREATE POLICY "company_banks_preparer_update" ON public.company_banks
  FOR UPDATE TO authenticated
  USING (
    public.has_company_access(company_id)
    AND (public.get_my_role() = 'PREPARER' OR public.is_admin_user())
  )
  WITH CHECK (
    public.has_company_access(company_id)
    AND (public.get_my_role() = 'PREPARER' OR public.is_admin_user())
  );

-- 3. Ensure SELECT, INSERT, UPDATE grants for authenticated users (DELETE remains guarded by RLS Admin-only policy)
GRANT SELECT, INSERT, UPDATE ON public.company_banks TO authenticated;
GRANT ALL ON public.company_banks TO service_role;
