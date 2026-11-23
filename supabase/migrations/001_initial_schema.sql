-- ==========================================
-- 001_initial_schema.sql: INDFURN Payment Approval System
-- Simplified 2-Role Architecture: ACCOUNTANT and OWNER
-- ==========================================

-- 1. ENUMS
CREATE TYPE public.user_role AS ENUM ('ACCOUNTANT', 'OWNER');

CREATE TYPE public.payment_status AS ENUM (
  'DRAFT',
  'PENDING_APPROVAL',
  'ON_HOLD',
  'APPROVED',
  'PAID',
  'REJECTED',
  'CANCELLED'
);

-- ==========================================
-- 2. PROFILES (Linked to auth.users)
-- ==========================================
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  role public.user_role NOT NULL DEFAULT 'ACCOUNTANT',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ==========================================
-- 3. MASTER TABLES: VENDORS & COMPANY BANKS
-- ==========================================
CREATE TABLE public.vendors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  gstin TEXT,
  bank_account_no TEXT,
  ifsc_code TEXT,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.company_banks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  short_name TEXT NOT NULL UNIQUE,       -- e.g., 'Axis', 'SIB'
  full_name TEXT NOT NULL,               -- e.g., 'Axis Bank (Neo Corporate)', 'South Indian Bank'
  account_mask TEXT,                     -- e.g., 'XXXX0698' (never store full raw credentials)
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed default INDFURN company banks
INSERT INTO public.company_banks (short_name, full_name)
VALUES
  ('Axis', 'Axis Bank'),
  ('SIB', 'South Indian Bank')
ON CONFLICT (short_name) DO NOTHING;

-- ==========================================
-- 4. PAYMENT ITEMS (Core Approval & UTR Ledger)
-- ==========================================
CREATE TABLE public.payment_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sheet_date DATE NOT NULL DEFAULT CURRENT_DATE,

  vendor_id UUID NOT NULL REFERENCES public.vendors(id),
  invoice_ref TEXT NOT NULL,             -- e.g., '0282', 'On Account', 'Sep-Oct', 'NA'
  due_date DATE NOT NULL,
  purpose TEXT NOT NULL,                 -- e.g., 'Against Bill', 'Against PI', 'Transfer', 'Electricity Charge'

  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  tds NUMERIC(12,2) NOT NULL DEFAULT 0.00 CHECK (tds >= 0 AND tds <= amount),
  net_payable NUMERIC(12,2) GENERATED ALWAYS AS (amount - tds) STORED,

  source_bank_id UUID NOT NULL REFERENCES public.company_banks(id),
  invoice_file_path TEXT,                -- Private storage path in 'supplier-invoices'

  status public.payment_status NOT NULL DEFAULT 'DRAFT',
  remarks TEXT,
  rejection_reason TEXT,

  -- Post-payment UTR reconciliation fields
  utr_number TEXT,
  receipt_file_path TEXT,                -- Private storage path in 'bank-receipts'

  -- Sign-off metadata
  created_by UUID NOT NULL REFERENCES public.profiles(id),
  submitted_at TIMESTAMPTZ,
  approved_by UUID REFERENCES public.profiles(id),
  approved_at TIMESTAMPTZ,
  paid_by UUID REFERENCES public.profiles(id),
  paid_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Data consistency constraints
  CONSTRAINT chk_paid_requires_utr CHECK (
    status <> 'PAID' OR (utr_number IS NOT NULL AND TRIM(utr_number) <> '' AND receipt_file_path IS NOT NULL)
  ),
  CONSTRAINT chk_rejected_requires_reason CHECK (
    status <> 'REJECTED' OR (rejection_reason IS NOT NULL AND TRIM(rejection_reason) <> '')
  )
);

-- Enforce globally unique UTR (case-insensitive, trimmed)
CREATE UNIQUE INDEX idx_payment_items_unique_utr
  ON public.payment_items (UPPER(TRIM(utr_number)))
  WHERE utr_number IS NOT NULL AND TRIM(utr_number) <> '';

-- Performance indexes for daily sheets, history, and duplicate checks
CREATE INDEX idx_payment_items_sheet_date ON public.payment_items (sheet_date DESC);
CREATE INDEX idx_payment_items_status ON public.payment_items (status);
CREATE INDEX idx_payment_items_vendor_invoice ON public.payment_items (vendor_id, LOWER(TRIM(invoice_ref)));

-- ==========================================
-- 5. IMMUTABLE AUDIT LOGS
-- ==========================================
CREATE TABLE public.audit_logs (
  id BIGSERIAL PRIMARY KEY,
  table_name TEXT NOT NULL,
  record_id UUID NOT NULL,
  action TEXT NOT NULL,
  old_data JSONB,
  new_data JSONB,
  changed_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_record ON public.audit_logs (record_id, created_at DESC);

-- ==========================================
-- 6. DATABASE HELPER FUNCTIONS
-- ==========================================

-- Helper: Get user role safely inside RLS policies
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS public.user_role AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid() LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ==========================================
-- 7. DATABASE TRIGGERS
-- ==========================================

-- 7.1 Auto-profile creation on auth.users sign-up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', 'INDFURN User'),
    COALESCE((NEW.raw_user_meta_data->>'role')::public.user_role, 'ACCOUNTANT')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 7.2 Updated_at timestamp sync
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_profiles_updated_at ON public.profiles;
CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trg_payment_items_updated_at ON public.payment_items;
CREATE TRIGGER trg_payment_items_updated_at
  BEFORE UPDATE ON public.payment_items
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 7.3 Payment state transition validation & post-approval integrity
CREATE OR REPLACE FUNCTION public.enforce_payment_integrity()
RETURNS TRIGGER AS $$
DECLARE
  v_role public.user_role;
BEGIN
  v_role := public.get_my_role();

  -- Prevent deletion of any item unless it is still in DRAFT
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'Only DRAFT payments can be deleted. Use CANCELLED for logged items.';
    END IF;
    RETURN OLD;
  END IF;

  -- Timestamp tracking for state transitions
  IF TG_OP = 'UPDATE' THEN
    -- Submitted to owner
    IF OLD.status = 'DRAFT' AND NEW.status = 'PENDING_APPROVAL' THEN
      NEW.submitted_at := NOW();
    END IF;

    -- Owner approval
    IF OLD.status IN ('PENDING_APPROVAL', 'ON_HOLD') AND NEW.status = 'APPROVED' THEN
      IF v_role <> 'OWNER' THEN
        RAISE EXCEPTION 'Only an OWNER can approve payment items.';
      END IF;
      NEW.approved_by := auth.uid();
      NEW.approved_at := NOW();
    END IF;

    -- Accountant marked as paid with UTR
    IF OLD.status = 'APPROVED' AND NEW.status = 'PAID' THEN
      NEW.paid_by := auth.uid();
      NEW.paid_at := NOW();
    END IF;

    -- Disallow editing financial parameters once approved or paid
    IF OLD.status IN ('APPROVED', 'PAID') THEN
      IF NEW.amount <> OLD.amount
        OR NEW.vendor_id <> OLD.vendor_id
        OR NEW.invoice_ref <> OLD.invoice_ref
        OR NEW.tds <> OLD.tds
        OR NEW.purpose <> OLD.purpose
        OR NEW.sheet_date <> OLD.sheet_date
        OR NEW.source_bank_id <> OLD.source_bank_id
      THEN
        RAISE EXCEPTION 'Cannot modify financial parameters (amount, vendor, bank, invoice) once a payment is APPROVED or PAID.';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_enforce_payment_integrity ON public.payment_items;
CREATE TRIGGER trg_enforce_payment_integrity
  BEFORE UPDATE OR DELETE ON public.payment_items
  FOR EACH ROW EXECUTE FUNCTION public.enforce_payment_integrity();

-- 7.4 Audit logging trigger for payment_items
CREATE OR REPLACE FUNCTION public.log_payment_audit()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.audit_logs (table_name, record_id, action, new_data, changed_by)
    VALUES ('payment_items', NEW.id, 'INSERT', to_jsonb(NEW), auth.uid());
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.status <> NEW.status
      OR OLD.source_bank_id <> NEW.source_bank_id
      OR OLD.amount <> NEW.amount
      OR OLD.utr_number IS DISTINCT FROM NEW.utr_number
    THEN
      INSERT INTO public.audit_logs (table_name, record_id, action, old_data, new_data, changed_by)
      VALUES ('payment_items', NEW.id, 'STATUS_CHANGE', to_jsonb(OLD), to_jsonb(NEW), auth.uid());
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.audit_logs (table_name, record_id, action, old_data, changed_by)
    VALUES ('payment_items', OLD.id, 'DELETE', to_jsonb(OLD), auth.uid());
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_audit_payment_items ON public.payment_items;
CREATE TRIGGER trg_audit_payment_items
  AFTER INSERT OR UPDATE OR DELETE ON public.payment_items
  FOR EACH ROW
  EXECUTE FUNCTION public.log_payment_audit();

-- ==========================================
-- 8. ROW LEVEL SECURITY (RLS) POLICIES
-- ==========================================
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_banks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- PROFILES: Users see own profile; OWNER & ACCOUNTANT can view all profiles
CREATE POLICY "profiles_select" ON public.profiles
  FOR SELECT USING (id = auth.uid() OR public.get_my_role() IN ('OWNER', 'ACCOUNTANT'));

CREATE POLICY "profiles_owner_manage" ON public.profiles
  FOR ALL USING (public.get_my_role() = 'OWNER');

-- VENDORS: All active authenticated users can read; ACCOUNTANT & OWNER can insert/update
CREATE POLICY "vendors_select" ON public.vendors
  FOR SELECT USING (public.get_my_role() IS NOT NULL);

CREATE POLICY "vendors_manage" ON public.vendors
  FOR INSERT WITH CHECK (public.get_my_role() IN ('ACCOUNTANT', 'OWNER'));

CREATE POLICY "vendors_update" ON public.vendors
  FOR UPDATE USING (public.get_my_role() IN ('ACCOUNTANT', 'OWNER'));

-- COMPANY BANKS: Only ACCOUNTANT & OWNER can view; only OWNER can manage
CREATE POLICY "banks_select" ON public.company_banks
  FOR SELECT USING (public.get_my_role() IN ('ACCOUNTANT', 'OWNER'));

CREATE POLICY "banks_owner_manage" ON public.company_banks
  FOR ALL USING (public.get_my_role() = 'OWNER');

-- PAYMENT ITEMS: Accessible only to ACCOUNTANT & OWNER
CREATE POLICY "payment_items_select" ON public.payment_items
  FOR SELECT USING (public.get_my_role() IN ('ACCOUNTANT', 'OWNER'));

CREATE POLICY "payment_items_insert" ON public.payment_items
  FOR INSERT WITH CHECK (
    public.get_my_role() IN ('ACCOUNTANT', 'OWNER')
    AND created_by = auth.uid()
  );

CREATE POLICY "payment_items_update" ON public.payment_items
  FOR UPDATE USING (public.get_my_role() IN ('ACCOUNTANT', 'OWNER'));

CREATE POLICY "payment_items_delete_draft_only" ON public.payment_items
  FOR DELETE USING (
    public.get_my_role() IN ('ACCOUNTANT', 'OWNER')
    AND status = 'DRAFT'
  );

-- AUDIT LOGS: Read-only for OWNER & ACCOUNTANT; no direct client INSERT/UPDATE/DELETE
CREATE POLICY "audit_logs_select" ON public.audit_logs
  FOR SELECT USING (public.get_my_role() IN ('ACCOUNTANT', 'OWNER'));
