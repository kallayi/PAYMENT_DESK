-- =========================================================================
-- Migration: 003_payment_desk_v2.sql
-- Payment Desk (v2) for INDFURN and VINMORE
-- Multi-Company Isolation, 4-Role RBAC, Financial Integrity, and Storage
-- =========================================================================

-- CRITICAL SAFETY RULE:
-- NEVER execute ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
-- Supabase enables RLS on storage.objects by default; running that statement causes Error 42501.

-- =========================================================================
-- 1. COMPANIES MASTER TABLE & SEEDING (Strictly INDFURN and VINMORE)
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed fixed two-company scope
INSERT INTO public.companies (code, name)
VALUES
  ('INDFURN', 'INDFURN'),
  ('VINMORE', 'VINMORE')
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  is_active = TRUE;

-- =========================================================================
-- 2. ENUMS UPGRADE & CREATION
-- =========================================================================

-- 2.1 Upgrade public.user_role to 4 operational roles: PREPARER, VERIFIER, APPROVER, AUDITOR
DO $$
BEGIN
  -- If old enum exists with ACCOUNTANT or OWNER, safely migrate column & type
  IF EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname = 'user_role' AND e.enumlabel IN ('ACCOUNTANT', 'OWNER')
  ) THEN
    -- Drop dependent functions
    DROP FUNCTION IF EXISTS public.get_my_role() CASCADE;

    -- Ensure is_admin column exists on profiles before updating
    ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;

    -- Drop default constraint on profiles.role
    ALTER TABLE public.profiles ALTER COLUMN role DROP DEFAULT;

    -- Temporarily convert role to text
    ALTER TABLE public.profiles ALTER COLUMN role TYPE text USING role::text;

    -- Migrate existing profiles: OWNER -> APPROVER + is_admin, ACCOUNTANT -> PREPARER
    UPDATE public.profiles SET role = 'APPROVER', is_admin = TRUE WHERE role = 'OWNER';
    UPDATE public.profiles SET role = 'PREPARER' WHERE role = 'ACCOUNTANT';
    UPDATE public.profiles SET role = 'PREPARER' WHERE role NOT IN ('PREPARER', 'VERIFIER', 'APPROVER', 'AUDITOR');

    -- Drop old type and recreate with 4 operational roles
    DROP TYPE public.user_role CASCADE;
    CREATE TYPE public.user_role AS ENUM ('PREPARER', 'VERIFIER', 'APPROVER', 'AUDITOR');

    -- Convert role column to new enum type
    ALTER TABLE public.profiles ALTER COLUMN role TYPE public.user_role USING role::public.user_role;
    ALTER TABLE public.profiles ALTER COLUMN role SET DEFAULT 'PREPARER'::public.user_role;
  ELSIF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
    CREATE TYPE public.user_role AS ENUM ('PREPARER', 'VERIFIER', 'APPROVER', 'AUDITOR');
  END IF;
END $$;

-- 2.2 Ensure public.payment_status has PENDING_VERIFICATION
DO $$
DECLARE
  pol RECORD;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname = 'payment_status' AND e.enumlabel = 'PENDING_VERIFICATION'
  ) THEN
    -- Drop payment integrity trigger & helper functions that depend on payment_status if needed
    DROP TRIGGER IF EXISTS trg_enforce_payment_integrity ON public.payment_items;

    -- Drop check constraints referencing status
    ALTER TABLE public.payment_items DROP CONSTRAINT IF EXISTS chk_paid_requires_utr;
    ALTER TABLE public.payment_items DROP CONSTRAINT IF EXISTS chk_rejected_requires_reason;

    -- Dynamically drop any legacy policies on payment_items before altering column type
    FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'payment_items' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.payment_items', pol.policyname);
    END LOOP;

    -- Convert payment_items.status to text
    ALTER TABLE public.payment_items ALTER COLUMN status DROP DEFAULT;
    ALTER TABLE public.payment_items ALTER COLUMN status TYPE text USING status::text;

    -- Drop old payment_status type
    DROP TYPE public.payment_status CASCADE;

    -- Recreate payment_status with PENDING_VERIFICATION
    CREATE TYPE public.payment_status AS ENUM (
      'DRAFT',
      'PENDING_VERIFICATION',
      'PENDING_APPROVAL',
      'APPROVED',
      'PAID',
      'ON_HOLD',
      'REJECTED',
      'CANCELLED'
    );

    -- Restore payment_items.status column type & default
    ALTER TABLE public.payment_items ALTER COLUMN status TYPE public.payment_status USING status::public.payment_status;
    ALTER TABLE public.payment_items ALTER COLUMN status SET DEFAULT 'DRAFT'::public.payment_status;
  END IF;
END $$;

-- 2.3 Create v2 operational enums: payment_mode, payment_type, notification_event
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_mode') THEN
    CREATE TYPE public.payment_mode AS ENUM ('NEFT_RTGS', 'CHEQUE');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_type') THEN
    CREATE TYPE public.payment_type AS ENUM ('AGAINST_BILL', 'ON_ACCOUNT');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_event') THEN
    CREATE TYPE public.notification_event AS ENUM (
      'SUBMITTED_FOR_VERIFICATION',
      'VERIFIED_FOR_APPROVAL',
      'APPROVED',
      'HELD',
      'REJECTED'
    );
  END IF;
END $$;

-- =========================================================================
-- 3. PROFILES & USER COMPANY ACCESS
-- =========================================================================

-- Ensure profiles has is_admin and is_active
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

-- Create user_company_access mapping table
CREATE TABLE IF NOT EXISTS public.user_company_access (
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, company_id)
);

-- Seed access: Grant existing admin/approver users access to BOTH INDFURN and VINMORE
INSERT INTO public.user_company_access (user_id, company_id)
SELECT p.id, c.id
FROM public.profiles p
CROSS JOIN public.companies c
WHERE p.is_admin = TRUE OR p.role = 'APPROVER'
ON CONFLICT (user_id, company_id) DO NOTHING;

-- Grant any other existing users access to INDFURN by default
INSERT INTO public.user_company_access (user_id, company_id)
SELECT p.id, c.id
FROM public.profiles p
CROSS JOIN public.companies c
WHERE c.code = 'INDFURN'
ON CONFLICT (user_id, company_id) DO NOTHING;

-- =========================================================================
-- 4. COMPANY BANKS (Per-Company Master & Live Balances)
-- =========================================================================

-- Drop legacy unique constraints on short_name since banks are per-company
ALTER TABLE public.company_banks DROP CONSTRAINT IF EXISTS company_banks_short_name_key;

-- Safely drop legacy NOT NULL constraints on short_name and full_name
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'company_banks'
      AND column_name = 'short_name'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE public.company_banks ALTER COLUMN short_name DROP NOT NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'company_banks'
      AND column_name = 'full_name'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE public.company_banks ALTER COLUMN full_name DROP NOT NULL;
  END IF;
END $$;

-- Add v2 columns to company_banks
ALTER TABLE public.company_banks ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE;
ALTER TABLE public.company_banks ADD COLUMN IF NOT EXISTS bank_name TEXT;
ALTER TABLE public.company_banks ADD COLUMN IF NOT EXISTS short_code TEXT;
ALTER TABLE public.company_banks ADD COLUMN IF NOT EXISTS ifsc_prefix TEXT;
ALTER TABLE public.company_banks ADD COLUMN IF NOT EXISTS account_number_masked TEXT;
ALTER TABLE public.company_banks ADD COLUMN IF NOT EXISTS available_balance NUMERIC(14,2) NOT NULL DEFAULT 0.00;
ALTER TABLE public.company_banks ADD COLUMN IF NOT EXISTS balance_updated_at TIMESTAMPTZ;
ALTER TABLE public.company_banks ADD COLUMN IF NOT EXISTS balance_updated_by UUID REFERENCES public.profiles(id);
ALTER TABLE public.company_banks ADD COLUMN IF NOT EXISTS is_primary BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.company_banks ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Backfill company_banks for existing rows
DO $$
DECLARE
  v_indfurn_id UUID;
BEGIN
  SELECT id INTO v_indfurn_id FROM public.companies WHERE code = 'INDFURN' LIMIT 1;

  UPDATE public.company_banks
  SET company_id = v_indfurn_id
  WHERE company_id IS NULL;

  UPDATE public.company_banks
  SET
    bank_name = COALESCE(bank_name, full_name, 'Axis Bank'),
    short_code = COALESCE(short_code, UPPER(short_name), 'AXIS'),
    account_number_masked = COALESCE(account_number_masked, account_mask)
  WHERE bank_name IS NULL OR short_code IS NULL;

  UPDATE public.company_banks
  SET ifsc_prefix = 'UTIB', is_primary = TRUE
  WHERE (short_code = 'AXIS' OR short_name = 'Axis') AND ifsc_prefix IS NULL;

  UPDATE public.company_banks
  SET ifsc_prefix = 'SIBL'
  WHERE (short_code = 'SIB' OR short_name = 'SIB') AND ifsc_prefix IS NULL;
END $$;

-- Fallback for any bank row missing ifsc_prefix before enforcing NOT NULL
UPDATE public.company_banks SET ifsc_prefix = 'UTIB' WHERE ifsc_prefix IS NULL;

-- Enforce NOT NULL on core bank fields
ALTER TABLE public.company_banks ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.company_banks ALTER COLUMN bank_name SET NOT NULL;
ALTER TABLE public.company_banks ALTER COLUMN short_code SET NOT NULL;
ALTER TABLE public.company_banks ALTER COLUMN ifsc_prefix SET NOT NULL;

-- Unique bank short_code per company
CREATE UNIQUE INDEX IF NOT EXISTS idx_company_banks_company_short_code
  ON public.company_banks (company_id, short_code);

-- Seed INDFURN & VINMORE company banks
DO $$
DECLARE
  v_indfurn_id UUID;
  v_vinmore_id UUID;
BEGIN
  SELECT id INTO v_indfurn_id FROM public.companies WHERE code = 'INDFURN' LIMIT 1;
  SELECT id INTO v_vinmore_id FROM public.companies WHERE code = 'VINMORE' LIMIT 1;

  -- INDFURN Banks: Axis (UTIB, primary), SIB (SIBL), HDFC (HDFC), Kotak (KKBK)
  INSERT INTO public.company_banks (company_id, bank_name, short_code, ifsc_prefix, is_primary)
  VALUES
    (v_indfurn_id, 'Axis Bank Neo for Corporates', 'AXIS', 'UTIB', TRUE),
    (v_indfurn_id, 'South Indian Bank', 'SIB', 'SIBL', FALSE),
    (v_indfurn_id, 'HDFC Bank', 'HDFC', 'HDFC', FALSE),
    (v_indfurn_id, 'Kotak Mahindra Bank', 'KOTAK', 'KKBK', FALSE)
  ON CONFLICT (company_id, short_code) DO UPDATE SET
    bank_name = EXCLUDED.bank_name,
    ifsc_prefix = EXCLUDED.ifsc_prefix,
    is_primary = EXCLUDED.is_primary;

  -- VINMORE Banks: Axis (UTIB, primary), HDFC (HDFC), Kotak (KKBK) - No SIB
  INSERT INTO public.company_banks (company_id, bank_name, short_code, ifsc_prefix, is_primary)
  VALUES
    (v_vinmore_id, 'Axis Bank', 'AXIS', 'UTIB', TRUE),
    (v_vinmore_id, 'HDFC Bank', 'HDFC', 'HDFC', FALSE),
    (v_vinmore_id, 'Kotak Mahindra Bank', 'KOTAK', 'KKBK', FALSE)
  ON CONFLICT (company_id, short_code) DO UPDATE SET
    bank_name = EXCLUDED.bank_name,
    ifsc_prefix = EXCLUDED.ifsc_prefix,
    is_primary = EXCLUDED.is_primary;
END $$;

-- =========================================================================
-- 5. VENDORS (Lean Beneficiary Master — No Mandatory GSTIN / Mobile)
-- =========================================================================

-- Drop legacy unique constraint on name since party_name is scoped per company
ALTER TABLE public.vendors DROP CONSTRAINT IF EXISTS vendors_name_key;

-- Safely drop legacy NOT NULL constraint on vendors.name
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'vendors'
      AND column_name = 'name'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE public.vendors ALTER COLUMN name DROP NOT NULL;
  END IF;
END $$;

-- Add v2 columns
ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE;
ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS party_name TEXT;
ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS beneficiary_name TEXT;
ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS account_number TEXT;
ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS remarks TEXT;
ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Backfill vendors for existing rows
DO $$
DECLARE
  v_indfurn_id UUID;
BEGIN
  SELECT id INTO v_indfurn_id FROM public.companies WHERE code = 'INDFURN' LIMIT 1;

  UPDATE public.vendors
  SET company_id = v_indfurn_id
  WHERE company_id IS NULL;

  UPDATE public.vendors
  SET
    party_name = COALESCE(party_name, name, 'Vendor'),
    beneficiary_name = COALESCE(beneficiary_name, name, 'Vendor'),
    account_number = COALESCE(account_number, bank_account_no, '000000000000'),
    ifsc_code = CASE
      WHEN UPPER(TRIM(COALESCE(ifsc_code, ''))) ~ '^[A-Z]{4}0[A-Z0-9]{6}$' THEN UPPER(TRIM(ifsc_code))
      ELSE 'UTIB0000000'
    END,
    remarks = COALESCE(remarks, notes);
END $$;

-- Enforce constraints on vendors
ALTER TABLE public.vendors ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.vendors ALTER COLUMN party_name SET NOT NULL;
ALTER TABLE public.vendors ALTER COLUMN beneficiary_name SET NOT NULL;
ALTER TABLE public.vendors ALTER COLUMN account_number SET NOT NULL;
ALTER TABLE public.vendors ALTER COLUMN ifsc_code SET NOT NULL;

-- Validate IFSC code format: 4 uppercase letters, '0', 6 alphanumeric characters
ALTER TABLE public.vendors DROP CONSTRAINT IF EXISTS vendors_ifsc_code_check;
ALTER TABLE public.vendors ADD CONSTRAINT vendors_ifsc_code_check CHECK (ifsc_code ~ '^[A-Z]{4}0[A-Z0-9]{6}$');

-- Unique vendor party_name per company
CREATE UNIQUE INDEX IF NOT EXISTS idx_vendors_company_party
  ON public.vendors (company_id, LOWER(TRIM(party_name)));

CREATE INDEX IF NOT EXISTS idx_vendors_company_active
  ON public.vendors (company_id, is_active);

-- =========================================================================
-- 6. PAYMENT ITEMS (Upgraded Ledger & Critical Indexes)
-- =========================================================================

-- Add v2 columns
ALTER TABLE public.payment_items ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE;
ALTER TABLE public.payment_items ADD COLUMN IF NOT EXISTS payment_type public.payment_type NOT NULL DEFAULT 'AGAINST_BILL';
ALTER TABLE public.payment_items ADD COLUMN IF NOT EXISTS payment_mode public.payment_mode NOT NULL DEFAULT 'NEFT_RTGS';
ALTER TABLE public.payment_items ADD COLUMN IF NOT EXISTS cheque_number TEXT;
ALTER TABLE public.payment_items ADD COLUMN IF NOT EXISTS cheque_date DATE;
ALTER TABLE public.payment_items ADD COLUMN IF NOT EXISTS verified_by UUID REFERENCES public.profiles(id);
ALTER TABLE public.payment_items ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;
ALTER TABLE public.payment_items ADD COLUMN IF NOT EXISTS audited_by UUID REFERENCES public.profiles(id);
ALTER TABLE public.payment_items ADD COLUMN IF NOT EXISTS audited_at TIMESTAMPTZ;

-- Backfill company_id for existing payment_items
DO $$
DECLARE
  v_indfurn_id UUID;
BEGIN
  SELECT id INTO v_indfurn_id FROM public.companies WHERE code = 'INDFURN' LIMIT 1;

  UPDATE public.payment_items
  SET company_id = v_indfurn_id
  WHERE company_id IS NULL;
END $$;

ALTER TABLE public.payment_items ALTER COLUMN company_id SET NOT NULL;

-- Re-establish check constraints on payment_items
ALTER TABLE public.payment_items DROP CONSTRAINT IF EXISTS chk_rejected_requires_reason;
ALTER TABLE public.payment_items ADD CONSTRAINT chk_rejected_requires_reason CHECK (
  status <> 'REJECTED' OR (rejection_reason IS NOT NULL AND btrim(rejection_reason) <> '')
);

-- Critical performance indexes from docs/DATABASE_SECURITY.md
DROP INDEX IF EXISTS idx_payment_items_status;
DROP INDEX IF EXISTS idx_payment_items_sheet_date;
DROP INDEX IF EXISTS idx_payment_items_vendor_invoice;
DROP INDEX IF EXISTS idx_payment_items_unique_utr;

CREATE INDEX IF NOT EXISTS idx_payment_items_company_status_due
  ON public.payment_items (company_id, status, due_date ASC);

CREATE INDEX IF NOT EXISTS idx_payment_items_company_sheet_date
  ON public.payment_items (company_id, sheet_date DESC);

CREATE INDEX IF NOT EXISTS idx_payment_items_vendor
  ON public.payment_items (company_id, vendor_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_items_utr
  ON public.payment_items (btrim(utr_number))
  WHERE utr_number IS NOT NULL AND btrim(utr_number) <> '';

CREATE INDEX IF NOT EXISTS idx_payment_items_dup_invoice
  ON public.payment_items (company_id, vendor_id, lower(invoice_ref));

-- =========================================================================
-- 7. NOTIFICATIONS, PUSH SUBSCRIPTIONS & RECURRING REMINDERS
-- =========================================================================

-- 7.1 Workflow Notifications (In-App)
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  recipient_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  payment_item_id UUID REFERENCES public.payment_items(id) ON DELETE SET NULL,
  event_type public.notification_event NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_recipient_read
  ON public.notifications (recipient_user_id, is_read, created_at DESC);

-- 7.2 Web Push Subscriptions
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  endpoint TEXT UNIQUE NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_push_subs_user
  ON public.push_subscriptions (user_id);

-- 7.3 Accounts-Only Monthly Reminders
CREATE TABLE IF NOT EXISTS public.recurring_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  due_day_of_month INT NOT NULL CHECK (due_day_of_month BETWEEN 1 AND 31),
  estimated_amount NUMERIC(14,2),
  vendor_id UUID REFERENCES public.vendors(id) ON DELETE SET NULL,
  remarks TEXT,
  last_completed_month TEXT, -- e.g., '2026-11'
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recurring_reminders_company
  ON public.recurring_reminders (company_id, is_active);

-- 7.4 Audit Logs company_id scope
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL;
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS payment_item_id UUID REFERENCES public.payment_items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_audit_logs_company
  ON public.audit_logs (company_id, created_at DESC);

-- =========================================================================
-- 8. SECURITY HELPER FUNCTIONS (SECURITY DEFINER + search_path = public)
-- =========================================================================

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

CREATE OR REPLACE FUNCTION public.is_admin_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT is_admin FROM public.profiles WHERE id = auth.uid() AND is_active = TRUE LIMIT 1),
    FALSE
  );
$$;

CREATE OR REPLACE FUNCTION public.has_company_access(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.is_active = TRUE
      AND (
        p.is_admin = TRUE
        OR EXISTS (
          SELECT 1 FROM public.user_company_access uca
          WHERE uca.user_id = p.id AND uca.company_id = p_company_id
        )
      )
  );
$$;

-- =========================================================================
-- 9. DATABASE INTEGRITY TRIGGERS
-- =========================================================================

-- 9.1 Idempotent Auth New User Trigger (Reads raw_app_meta_data + ON CONFLICT DO UPDATE)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role public.user_role;
  v_is_admin boolean;
  v_full_name text;
BEGIN
  v_role := COALESCE(
    (NEW.raw_app_meta_data->>'role')::public.user_role,
    (NEW.raw_user_meta_data->>'role')::public.user_role,
    'PREPARER'::public.user_role
  );

  v_is_admin := COALESCE(
    (NEW.raw_app_meta_data->>'is_admin')::boolean,
    (NEW.raw_user_meta_data->>'is_admin')::boolean,
    FALSE
  );

  v_full_name := COALESCE(
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_app_meta_data->>'full_name',
    'Payment Desk User'
  );

  INSERT INTO public.profiles (id, full_name, role, is_admin, is_active)
  VALUES (NEW.id, v_full_name, v_role, v_is_admin, TRUE)
  ON CONFLICT (id) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    role = EXCLUDED.role,
    is_admin = EXCLUDED.is_admin,
    updated_at = NOW();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 9.2 Payment Integrity Trigger (NULL-Safe Role Guard + Single Audit Exception)
CREATE OR REPLACE FUNCTION public.enforce_payment_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role public.user_role;
  v_is_admin boolean;
BEGIN
  v_role := public.get_my_role();
  v_is_admin := public.is_admin_user();

  -- DELETE: Only DRAFT payments can be hard-deleted by PREPARER or Admin
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'Submitted payment records cannot be deleted. Use CANCELLED status instead.';
    END IF;
    IF v_role IS DISTINCT FROM 'PREPARER' AND NOT v_is_admin THEN
      RAISE EXCEPTION 'Only a PREPARER or Admin can delete draft payments.';
    END IF;
    RETURN OLD;
  END IF;

  -- UPDATE
  IF TG_OP = 'UPDATE' THEN
    -- 1. TERMINAL STATE LOCK & SINGLE-AUDIT EXCEPTION
    IF OLD.status IN ('REJECTED', 'CANCELLED') THEN
      RAISE EXCEPTION 'Finalized payment records (% status) are completely immutable.', OLD.status;
    END IF;

    IF OLD.status = 'PAID' THEN
      -- Sole exception: AUDITOR or Admin may stamp audited_by and audited_at once
      IF OLD.audited_at IS NULL AND NEW.audited_at IS NOT NULL THEN
        IF v_role IS DISTINCT FROM 'AUDITOR' AND NOT v_is_admin THEN
          RAISE EXCEPTION 'Only an active AUDITOR or Admin can verify audited payments.';
        END IF;

        -- Verify that NO core financial fields were altered during audit stamp
        IF NEW.status IS DISTINCT FROM OLD.status
          OR NEW.amount IS DISTINCT FROM OLD.amount
          OR NEW.tds IS DISTINCT FROM OLD.tds
          OR NEW.vendor_id IS DISTINCT FROM OLD.vendor_id
          OR NEW.company_id IS DISTINCT FROM OLD.company_id
          OR NEW.source_bank_id IS DISTINCT FROM OLD.source_bank_id
          OR NEW.utr_number IS DISTINCT FROM OLD.utr_number
          OR NEW.cheque_number IS DISTINCT FROM OLD.cheque_number
          OR NEW.cheque_date IS DISTINCT FROM OLD.cheque_date
          OR NEW.receipt_file_path IS DISTINCT FROM OLD.receipt_file_path
          OR NEW.invoice_ref IS DISTINCT FROM OLD.invoice_ref
          OR NEW.due_date IS DISTINCT FROM OLD.due_date
          OR NEW.purpose IS DISTINCT FROM OLD.purpose
          OR NEW.sheet_date IS DISTINCT FROM OLD.sheet_date
          OR NEW.payment_type IS DISTINCT FROM OLD.payment_type
          OR NEW.payment_mode IS DISTINCT FROM OLD.payment_mode
        THEN
          RAISE EXCEPTION 'Auditor cannot modify financial or beneficiary data on a paid record.';
        END IF;

        NEW.audited_by := auth.uid();
        NEW.audited_at := NOW();
        NEW.updated_at := NOW();
        RETURN NEW;
      ELSE
        RAISE EXCEPTION 'Paid payment records are completely immutable.';
      END IF;
    END IF;

    -- 2. ZERO DIRECT FINANCIAL EDITS POST-DRAFT
    -- Core financial parameters may only be modified while in DRAFT by PREPARER
    IF OLD.status <> 'DRAFT' THEN
      IF NEW.amount IS DISTINCT FROM OLD.amount
        OR NEW.tds IS DISTINCT FROM OLD.tds
        OR NEW.vendor_id IS DISTINCT FROM OLD.vendor_id
        OR NEW.company_id IS DISTINCT FROM OLD.company_id
        OR NEW.invoice_ref IS DISTINCT FROM OLD.invoice_ref
        OR NEW.due_date IS DISTINCT FROM OLD.due_date
        OR NEW.purpose IS DISTINCT FROM OLD.purpose
        OR NEW.payment_type IS DISTINCT FROM OLD.payment_type
        OR NEW.payment_mode IS DISTINCT FROM OLD.payment_mode
        OR NEW.sheet_date IS DISTINCT FROM OLD.sheet_date
      THEN
        RAISE EXCEPTION 'Core financial parameters (amount, TDS, vendor, invoice, due date, purpose, mode) are locked after submission.';
      END IF;

      -- Source bank can be adjusted by APPROVER only while in PENDING_APPROVAL or ON_HOLD
      IF NEW.source_bank_id IS DISTINCT FROM OLD.source_bank_id THEN
        IF OLD.status NOT IN ('PENDING_APPROVAL', 'ON_HOLD') OR (v_role IS DISTINCT FROM 'APPROVER' AND NOT v_is_admin) THEN
          RAISE EXCEPTION 'Source bank can only be changed by an APPROVER prior to final approval.';
        END IF;
      END IF;
    END IF;

    -- 3. ROLE-ENFORCED STATE TRANSITIONS
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      -- DRAFT -> PENDING_VERIFICATION: PREPARER or Admin
      IF OLD.status = 'DRAFT' AND NEW.status = 'PENDING_VERIFICATION' THEN
        IF v_role IS DISTINCT FROM 'PREPARER' AND NOT v_is_admin THEN
          RAISE EXCEPTION 'Only a PREPARER or Admin can submit drafts for verification.';
        END IF;
        NEW.submitted_at := NOW();
      END IF;

      -- PENDING_VERIFICATION -> PENDING_APPROVAL: VERIFIER or Approver/Admin override
      IF OLD.status = 'PENDING_VERIFICATION' AND NEW.status = 'PENDING_APPROVAL' THEN
        IF v_role IS DISTINCT FROM 'VERIFIER' AND v_role IS DISTINCT FROM 'APPROVER' AND NOT v_is_admin THEN
          RAISE EXCEPTION 'Only a VERIFIER or APPROVER can verify payments.';
        END IF;
        NEW.verified_by := auth.uid();
        NEW.verified_at := NOW();
      END IF;

      -- Return / Reject from PENDING_VERIFICATION: requires reason
      IF OLD.status = 'PENDING_VERIFICATION' AND NEW.status = 'REJECTED' THEN
        IF v_role IS DISTINCT FROM 'VERIFIER' AND v_role IS DISTINCT FROM 'APPROVER' AND NOT v_is_admin THEN
          RAISE EXCEPTION 'Only a VERIFIER or APPROVER can return or reject pending verifications.';
        END IF;
        IF btrim(COALESCE(NEW.rejection_reason, '')) = '' THEN
          RAISE EXCEPTION 'A mandatory rejection reason is required when rejecting or returning payments.';
        END IF;
      END IF;

      -- PENDING_APPROVAL / ON_HOLD -> APPROVED / ON_HOLD / REJECTED: APPROVER only (or Admin)
      -- Direct override from PENDING_VERIFICATION -> APPROVED: APPROVER only
      IF (OLD.status IN ('PENDING_APPROVAL', 'ON_HOLD') AND NEW.status IN ('APPROVED', 'ON_HOLD', 'REJECTED'))
         OR (OLD.status = 'PENDING_VERIFICATION' AND NEW.status = 'APPROVED')
      THEN
        IF v_role IS DISTINCT FROM 'APPROVER' AND NOT v_is_admin THEN
          RAISE EXCEPTION 'Only an APPROVER can approve, hold, or reject payments.';
        END IF;

        IF NEW.status = 'APPROVED' THEN
          NEW.approved_by := auth.uid();
          NEW.approved_at := NOW();
        END IF;

        IF NEW.status = 'REJECTED' THEN
          IF btrim(COALESCE(NEW.rejection_reason, '')) = '' THEN
            RAISE EXCEPTION 'A mandatory rejection reason is required when rejecting payments.';
          END IF;
        END IF;
      END IF;

      -- APPROVED -> PAID: PREPARER or Admin
      IF OLD.status = 'APPROVED' AND NEW.status = 'PAID' THEN
        IF v_role IS DISTINCT FROM 'PREPARER' AND NOT v_is_admin THEN
          RAISE EXCEPTION 'Only a PREPARER or Admin can mark approved payments as PAID.';
        END IF;

        -- Validate payment mode details
        IF NEW.payment_mode = 'NEFT_RTGS' THEN
          IF btrim(COALESCE(NEW.utr_number, '')) = '' THEN
            RAISE EXCEPTION 'A valid unique UTR reference number is required for NEFT/RTGS payments.';
          END IF;
        ELSIF NEW.payment_mode = 'CHEQUE' THEN
          IF btrim(COALESCE(NEW.cheque_number, '')) = '' OR NEW.cheque_date IS NULL THEN
            RAISE EXCEPTION 'Cheque number and cheque date are required for Cheque settlements.';
          END IF;
        END IF;

        NEW.paid_by := auth.uid();
        NEW.paid_at := NOW();
      END IF;
    END IF;

    -- Always stamp updated_at
    NEW.updated_at := NOW();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_payment_integrity ON public.payment_items;
CREATE TRIGGER trg_enforce_payment_integrity
  BEFORE UPDATE OR DELETE ON public.payment_items
  FOR EACH ROW EXECUTE FUNCTION public.enforce_payment_integrity();

-- 9.3 Audit log trigger for payment items
CREATE OR REPLACE FUNCTION public.log_payment_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.audit_logs (table_name, record_id, company_id, payment_item_id, action, new_data, changed_by)
    VALUES ('payment_items', NEW.id, NEW.company_id, NEW.id, 'INSERT', to_jsonb(NEW), auth.uid());
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.status IS DISTINCT FROM NEW.status
      OR OLD.source_bank_id IS DISTINCT FROM NEW.source_bank_id
      OR OLD.amount IS DISTINCT FROM NEW.amount
      OR OLD.utr_number IS DISTINCT FROM NEW.utr_number
      OR OLD.cheque_number IS DISTINCT FROM NEW.cheque_number
      OR OLD.audited_at IS DISTINCT FROM NEW.audited_at
    THEN
      INSERT INTO public.audit_logs (table_name, record_id, company_id, payment_item_id, action, old_data, new_data, changed_by)
      VALUES ('payment_items', NEW.id, NEW.company_id, NEW.id, 'STATUS_CHANGE', to_jsonb(OLD), to_jsonb(NEW), auth.uid());
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.audit_logs (table_name, record_id, company_id, payment_item_id, action, old_data, changed_by)
    VALUES ('payment_items', OLD.id, OLD.company_id, OLD.id, 'DELETE', to_jsonb(OLD), auth.uid());
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_payment_items ON public.payment_items;
CREATE TRIGGER trg_audit_payment_items
  AFTER INSERT OR UPDATE OR DELETE ON public.payment_items
  FOR EACH ROW EXECUTE FUNCTION public.log_payment_audit();

-- =========================================================================
-- 10. ROW LEVEL SECURITY (RLS) POLICIES ON ALL TABLES
-- =========================================================================

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_company_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_banks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recurring_reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- 10.1 COMPANIES
DROP POLICY IF EXISTS "companies_select" ON public.companies;
CREATE POLICY "companies_select" ON public.companies
  FOR SELECT TO authenticated
  USING (public.has_company_access(id));

DROP POLICY IF EXISTS "companies_admin_manage" ON public.companies;
CREATE POLICY "companies_admin_manage" ON public.companies
  FOR ALL TO authenticated
  USING (public.is_admin_user());

-- 10.2 PROFILES
DROP POLICY IF EXISTS "profiles_select" ON public.profiles;
CREATE POLICY "profiles_select" ON public.profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.get_my_role() IS NOT NULL OR public.is_admin_user());

DROP POLICY IF EXISTS "profiles_owner_manage" ON public.profiles;
DROP POLICY IF EXISTS "profiles_admin_update" ON public.profiles;
CREATE POLICY "profiles_admin_update" ON public.profiles
  FOR UPDATE TO authenticated
  USING (public.is_admin_user())
  WITH CHECK (public.is_admin_user());

-- 10.3 USER COMPANY ACCESS
DROP POLICY IF EXISTS "uca_select" ON public.user_company_access;
CREATE POLICY "uca_select" ON public.user_company_access
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin_user());

DROP POLICY IF EXISTS "uca_admin_manage" ON public.user_company_access;
CREATE POLICY "uca_admin_manage" ON public.user_company_access
  FOR ALL TO authenticated
  USING (public.is_admin_user());

-- 10.4 COMPANY BANKS
DROP POLICY IF EXISTS "banks_select" ON public.company_banks;
DROP POLICY IF EXISTS "company_banks_select" ON public.company_banks;
CREATE POLICY "company_banks_select" ON public.company_banks
  FOR SELECT TO authenticated
  USING (public.has_company_access(company_id));

DROP POLICY IF EXISTS "banks_owner_manage" ON public.company_banks;
DROP POLICY IF EXISTS "company_banks_admin_manage" ON public.company_banks;
CREATE POLICY "company_banks_admin_manage" ON public.company_banks
  FOR ALL TO authenticated
  USING (public.is_admin_user());

DROP POLICY IF EXISTS "company_banks_preparer_update_balance" ON public.company_banks;
CREATE POLICY "company_banks_preparer_update_balance" ON public.company_banks
  FOR UPDATE TO authenticated
  USING (
    public.has_company_access(company_id)
    AND (public.get_my_role() = 'PREPARER' OR public.is_admin_user())
  )
  WITH CHECK (
    public.has_company_access(company_id)
    AND (public.get_my_role() = 'PREPARER' OR public.is_admin_user())
  );

-- 10.5 VENDORS
DROP POLICY IF EXISTS "vendors_select" ON public.vendors;
CREATE POLICY "vendors_select" ON public.vendors
  FOR SELECT TO authenticated
  USING (public.has_company_access(company_id));

DROP POLICY IF EXISTS "vendors_manage" ON public.vendors;
DROP POLICY IF EXISTS "vendors_insert" ON public.vendors;
CREATE POLICY "vendors_insert" ON public.vendors
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_company_access(company_id)
    AND (public.get_my_role() = 'PREPARER' OR public.is_admin_user())
  );

DROP POLICY IF EXISTS "vendors_update" ON public.vendors;
CREATE POLICY "vendors_update" ON public.vendors
  FOR UPDATE TO authenticated
  USING (
    public.has_company_access(company_id)
    AND (public.get_my_role() = 'PREPARER' OR public.is_admin_user())
  )
  WITH CHECK (
    public.has_company_access(company_id)
    AND (public.get_my_role() = 'PREPARER' OR public.is_admin_user())
  );

-- 10.6 PAYMENT ITEMS
DROP POLICY IF EXISTS "payment_items_select" ON public.payment_items;
CREATE POLICY "payment_items_select" ON public.payment_items
  FOR SELECT TO authenticated
  USING (public.has_company_access(company_id));

DROP POLICY IF EXISTS "payment_items_insert" ON public.payment_items;
CREATE POLICY "payment_items_insert" ON public.payment_items
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_company_access(company_id)
    AND (public.get_my_role() = 'PREPARER' OR public.is_admin_user())
    AND status IN ('DRAFT', 'PENDING_VERIFICATION')
  );

DROP POLICY IF EXISTS "payment_items_update" ON public.payment_items;
CREATE POLICY "payment_items_update" ON public.payment_items
  FOR UPDATE TO authenticated
  USING (
    public.has_company_access(company_id)
    AND (public.get_my_role() IS NOT NULL OR public.is_admin_user())
  );

DROP POLICY IF EXISTS "payment_items_delete_draft_only" ON public.payment_items;
CREATE POLICY "payment_items_delete_draft_only" ON public.payment_items
  FOR DELETE TO authenticated
  USING (
    public.has_company_access(company_id)
    AND (public.get_my_role() = 'PREPARER' OR public.is_admin_user())
    AND status = 'DRAFT'
  );

-- 10.7 NOTIFICATIONS
DROP POLICY IF EXISTS "notifications_select" ON public.notifications;
CREATE POLICY "notifications_select" ON public.notifications
  FOR SELECT TO authenticated
  USING (recipient_user_id = auth.uid());

DROP POLICY IF EXISTS "notifications_update" ON public.notifications;
CREATE POLICY "notifications_update" ON public.notifications
  FOR UPDATE TO authenticated
  USING (recipient_user_id = auth.uid())
  WITH CHECK (recipient_user_id = auth.uid());

DROP POLICY IF EXISTS "notifications_insert" ON public.notifications;
CREATE POLICY "notifications_insert" ON public.notifications
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

-- 10.8 PUSH SUBSCRIPTIONS
DROP POLICY IF EXISTS "push_subs_select" ON public.push_subscriptions;
CREATE POLICY "push_subs_select" ON public.push_subscriptions
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "push_subs_insert" ON public.push_subscriptions;
CREATE POLICY "push_subs_insert" ON public.push_subscriptions
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "push_subs_update" ON public.push_subscriptions;
CREATE POLICY "push_subs_update" ON public.push_subscriptions
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "push_subs_delete" ON public.push_subscriptions;
CREATE POLICY "push_subs_delete" ON public.push_subscriptions
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- 10.9 RECURRING REMINDERS (Accounts / PREPARER Only)
DROP POLICY IF EXISTS "reminders_select" ON public.recurring_reminders;
CREATE POLICY "reminders_select" ON public.recurring_reminders
  FOR SELECT TO authenticated
  USING (
    public.has_company_access(company_id)
    AND (public.get_my_role() = 'PREPARER' OR public.is_admin_user())
  );

DROP POLICY IF EXISTS "reminders_manage" ON public.recurring_reminders;
CREATE POLICY "reminders_manage" ON public.recurring_reminders
  FOR ALL TO authenticated
  USING (
    public.has_company_access(company_id)
    AND (public.get_my_role() = 'PREPARER' OR public.is_admin_user())
  );

-- 10.10 AUDIT LOGS
DROP POLICY IF EXISTS "audit_logs_select" ON public.audit_logs;
CREATE POLICY "audit_logs_select" ON public.audit_logs
  FOR SELECT TO authenticated
  USING (company_id IS NULL OR public.has_company_access(company_id));

DROP POLICY IF EXISTS "audit_logs_insert" ON public.audit_logs;
CREATE POLICY "audit_logs_insert" ON public.audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

-- =========================================================================
-- 11. STORAGE BUCKETS & STORAGE RLS POLICIES
-- =========================================================================
-- REMINDER: Never run ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

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

-- Storage Policies on storage.objects using company path prefix: <company_id>/<payment_item_id>/...

-- 11.1 supplier-invoices
DROP POLICY IF EXISTS "supplier_invoices_select" ON storage.objects;
CREATE POLICY "supplier_invoices_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'supplier-invoices'
    AND (
      CASE
        WHEN (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
        THEN public.has_company_access(((storage.foldername(name))[1])::uuid)
        ELSE FALSE
      END
    )
  );

DROP POLICY IF EXISTS "supplier_invoices_insert" ON storage.objects;
CREATE POLICY "supplier_invoices_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'supplier-invoices'
    AND (public.get_my_role() = 'PREPARER' OR public.is_admin_user())
    AND (
      CASE
        WHEN (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
        THEN public.has_company_access(((storage.foldername(name))[1])::uuid)
        ELSE FALSE
      END
    )
  );

DROP POLICY IF EXISTS "supplier_invoices_update" ON storage.objects;
CREATE POLICY "supplier_invoices_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'supplier-invoices'
    AND (public.get_my_role() = 'PREPARER' OR public.is_admin_user())
    AND (
      CASE
        WHEN (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
        THEN public.has_company_access(((storage.foldername(name))[1])::uuid)
        ELSE FALSE
      END
    )
  );

DROP POLICY IF EXISTS "supplier_invoices_delete" ON storage.objects;
CREATE POLICY "supplier_invoices_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'supplier-invoices'
    AND (public.get_my_role() = 'PREPARER' OR public.is_admin_user())
    AND (
      CASE
        WHEN (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
        THEN public.has_company_access(((storage.foldername(name))[1])::uuid)
        ELSE FALSE
      END
    )
  );

-- 11.2 bank-receipts
DROP POLICY IF EXISTS "bank_receipts_select" ON storage.objects;
CREATE POLICY "bank_receipts_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'bank-receipts'
    AND (
      CASE
        WHEN (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
        THEN public.has_company_access(((storage.foldername(name))[1])::uuid)
        ELSE FALSE
      END
    )
  );

DROP POLICY IF EXISTS "bank_receipts_insert" ON storage.objects;
CREATE POLICY "bank_receipts_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'bank-receipts'
    AND (public.get_my_role() = 'PREPARER' OR public.is_admin_user())
    AND (
      CASE
        WHEN (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
        THEN public.has_company_access(((storage.foldername(name))[1])::uuid)
        ELSE FALSE
      END
    )
  );

DROP POLICY IF EXISTS "bank_receipts_update" ON storage.objects;
CREATE POLICY "bank_receipts_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'bank-receipts'
    AND public.is_admin_user()
    AND (
      CASE
        WHEN (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
        THEN public.has_company_access(((storage.foldername(name))[1])::uuid)
        ELSE FALSE
      END
    )
  );

DROP POLICY IF EXISTS "bank_receipts_delete" ON storage.objects;
CREATE POLICY "bank_receipts_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'bank-receipts'
    AND public.is_admin_user()
    AND (
      CASE
        WHEN (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
        THEN public.has_company_access(((storage.foldername(name))[1])::uuid)
        ELSE FALSE
      END
    )
  );

-- =========================================================================
-- 12. MANDATORY SCHEMA, TABLE & FUNCTION GRANTS
-- =========================================================================

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated, service_role;

-- =========================================================================
-- 13. SYNCHRONIZE AUTH.USERS.RAW_APP_META_DATA
-- =========================================================================
-- Synchronize app_metadata for all existing users so role and is_admin match public.profiles right away

UPDATE auth.users u
SET raw_app_meta_data = COALESCE(u.raw_app_meta_data, '{}'::jsonb) ||
  jsonb_build_object(
    'role', p.role::text,
    'is_admin', p.is_admin
  )
FROM public.profiles p
WHERE u.id = p.id;
