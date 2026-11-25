-- =========================================================================
-- INDFURN Payment Approval & UTR Tracking System
-- Migration: 002_security_fix.sql (Reviewed & Fixed)
-- =========================================================================

-- 1. ACTIVE USER CHECK IN public.get_my_role()
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS public.user_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role
  FROM public.profiles
  WHERE id = auth.uid()
    AND is_active = TRUE
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_role() TO authenticated, service_role;

-- 2. STRICT WORKFLOW, OWNER AUTHORITY & TERMINAL IMMUTABILITY TRIGGER
CREATE OR REPLACE FUNCTION public.enforce_payment_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role public.user_role;
BEGIN
  v_role := public.get_my_role();

  -- DELETE: Only DRAFT records may be deleted
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'Submitted payment records cannot be deleted. Use CANCELLED status instead.';
    END IF;
    RETURN OLD;
  END IF;

  -- UPDATE
  IF TG_OP = 'UPDATE' THEN
    -- 1. TERMINAL STATE LOCK
    IF OLD.status IN ('PAID', 'REJECTED', 'CANCELLED') THEN
      RAISE EXCEPTION 'Finalized payment records (% status) are completely immutable.', OLD.status;
    END IF;

    -- 2. OWNER AUTHORITY (NULL-safe check with IS DISTINCT FROM)
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF NEW.status IN ('APPROVED', 'ON_HOLD', 'REJECTED')
         OR (OLD.status = 'ON_HOLD' AND NEW.status = 'PENDING_APPROVAL')
      THEN
        IF v_role IS DISTINCT FROM 'OWNER' THEN
          RAISE EXCEPTION 'Only an OWNER can approve, hold, reject, or resume payment items.';
        END IF;
      END IF;
    END IF;

    -- 3. PREREQUISITE VALIDATION: Approvals
    IF NEW.status = 'APPROVED' AND OLD.status NOT IN ('PENDING_APPROVAL', 'ON_HOLD') THEN
      RAISE EXCEPTION 'Only payments in PENDING_APPROVAL or ON_HOLD status can be approved.';
    END IF;

    -- 4. PREREQUISITE VALIDATION: Disbursements (NULL-safe check)
    IF NEW.status = 'PAID' AND OLD.status <> 'PAID' THEN
      IF OLD.status <> 'APPROVED' THEN
        RAISE EXCEPTION 'Only APPROVED payment items can be marked as PAID.';
      END IF;
      IF v_role IS NULL OR v_role NOT IN ('ACCOUNTANT', 'OWNER') THEN
        RAISE EXCEPTION 'Only an ACCOUNTANT or OWNER can record UTR settlements.';
      END IF;
      NEW.paid_by := auth.uid();
      NEW.paid_at := NOW();
    END IF;

    -- 5. AUTOMATIC METADATA STAMPING
    IF OLD.status = 'DRAFT' AND NEW.status = 'PENDING_APPROVAL' THEN
      NEW.submitted_at := NOW();
    END IF;

    IF NEW.status = 'APPROVED' AND OLD.status <> 'APPROVED' THEN
      NEW.approved_by := auth.uid();
      NEW.approved_at := NOW();
    END IF;

    -- 6. POST-APPROVAL FINANCIAL IMMUTABILITY LOCK
    IF OLD.status = 'APPROVED' THEN
      IF NEW.amount IS DISTINCT FROM OLD.amount
        OR NEW.vendor_id IS DISTINCT FROM OLD.vendor_id
        OR NEW.invoice_ref IS DISTINCT FROM OLD.invoice_ref
        OR NEW.tds IS DISTINCT FROM OLD.tds
        OR NEW.purpose IS DISTINCT FROM OLD.purpose
        OR NEW.sheet_date IS DISTINCT FROM OLD.sheet_date
        OR NEW.source_bank_id IS DISTINCT FROM OLD.source_bank_id
      THEN
        RAISE EXCEPTION 'Core financial fields (amount, vendor, invoice, TDS, purpose, sheet_date, bank) are locked after Owner approval.';
      END IF;
    END IF;

    -- 7. Always update updated_at timestamp
    NEW.updated_at := NOW();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_payment_integrity ON public.payment_items;
CREATE TRIGGER trg_enforce_payment_integrity
  BEFORE UPDATE OR DELETE ON public.payment_items
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_payment_integrity();

-- 3. PRIVATE STORAGE BUCKETS (supplier-invoices & bank-receipts)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  (
    'supplier-invoices',
    'supplier-invoices',
    false,
    5242880,
    ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']::text[]
  ),
  (
    'bank-receipts',
    'bank-receipts',
    false,
    5242880,
    ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']::text[]
  )
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 5242880,
  allowed_mime_types = ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']::text[];

-- 4. STORAGE RLS POLICIES ON storage.objects
-- (RLS is already enabled on storage.objects by default in Supabase)

-- 4.1 'supplier-invoices'
DROP POLICY IF EXISTS "supplier_invoices_select" ON storage.objects;
CREATE POLICY "supplier_invoices_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'supplier-invoices'
    AND public.get_my_role() IN ('OWNER', 'ACCOUNTANT')
  );

DROP POLICY IF EXISTS "supplier_invoices_insert" ON storage.objects;
CREATE POLICY "supplier_invoices_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'supplier-invoices'
    AND public.get_my_role() IN ('OWNER', 'ACCOUNTANT')
  );

DROP POLICY IF EXISTS "supplier_invoices_update" ON storage.objects;
CREATE POLICY "supplier_invoices_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'supplier-invoices'
    AND public.get_my_role() IN ('OWNER', 'ACCOUNTANT')
  )
  WITH CHECK (
    bucket_id = 'supplier-invoices'
    AND public.get_my_role() IN ('OWNER', 'ACCOUNTANT')
  );

DROP POLICY IF EXISTS "supplier_invoices_delete" ON storage.objects;
CREATE POLICY "supplier_invoices_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'supplier-invoices'
    AND public.get_my_role() IN ('OWNER', 'ACCOUNTANT')
  );

-- 4.2 'bank-receipts'
DROP POLICY IF EXISTS "bank_receipts_select" ON storage.objects;
CREATE POLICY "bank_receipts_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'bank-receipts'
    AND public.get_my_role() IN ('OWNER', 'ACCOUNTANT')
  );

DROP POLICY IF EXISTS "bank_receipts_insert" ON storage.objects;
CREATE POLICY "bank_receipts_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'bank-receipts'
    AND public.get_my_role() IN ('OWNER', 'ACCOUNTANT')
  );

DROP POLICY IF EXISTS "bank_receipts_update" ON storage.objects;
CREATE POLICY "bank_receipts_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'bank-receipts'
    AND public.get_my_role() = 'OWNER'
  )
  WITH CHECK (
    bucket_id = 'bank-receipts'
    AND public.get_my_role() = 'OWNER'
  );

DROP POLICY IF EXISTS "bank_receipts_delete" ON storage.objects;
CREATE POLICY "bank_receipts_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'bank-receipts'
    AND public.get_my_role() = 'OWNER'
  );

-- =========================================================================
-- 5. IDEMPOTENT NEW USER TRIGGER FUNCTION (public.handle_new_user)
-- =========================================================================
-- Handles auth.users sign-up/creation with ON CONFLICT DO UPDATE so it never
-- clashes with application-level profile upserts, and properly reads role
-- from raw_app_meta_data or raw_user_meta_data.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', 'INDFURN User'),
    COALESCE(
      (NEW.raw_app_meta_data->>'role')::public.user_role,
      (NEW.raw_user_meta_data->>'role')::public.user_role,
      'ACCOUNTANT'::public.user_role
    )
  )
  ON CONFLICT (id) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    role = EXCLUDED.role,
    updated_at = NOW();
  RETURN NEW;
END;
$$;
