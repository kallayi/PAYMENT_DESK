-- =========================================================================
-- Payment Desk (v2) — Migration 007: Company Profile & Slip Details
-- Ensures contact_email / contact_phone columns, Admin UPDATE RLS policy,
-- and safe NULL-only backfill for INDFURN defaults.
-- Idempotent & safe to run repeatedly in Supabase SQL Editor.
-- =========================================================================

-- 1. Ensure contact columns exist on public.companies
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS contact_email TEXT,
  ADD COLUMN IF NOT EXISTS contact_phone TEXT;

-- 2. Explicit Admin-only UPDATE policy on public.companies
DROP POLICY IF EXISTS "companies_admin_update" ON public.companies;
CREATE POLICY "companies_admin_update" ON public.companies
  FOR UPDATE TO authenticated
  USING (public.is_admin_user())
  WITH CHECK (public.is_admin_user());

-- 3. Backfill INDFURN default contact info ONLY where currently NULL
UPDATE public.companies
SET
  contact_email = COALESCE(contact_email, 'info@indfurn.in'),
  contact_phone = COALESCE(contact_phone, '9539 661 661')
WHERE UPPER(code) = 'INDFURN';
