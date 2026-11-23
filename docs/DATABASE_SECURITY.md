# 03 — Database Schema & Financial Security: INDFURN Payment System

## 1. Security & Data Integrity Principles
Because this application authorizes real B2B financial payouts, security MUST be enforced at the **PostgreSQL database layer** (RLS + Triggers + Constraints)—never solely in frontend UI code.

1. **Exact Decimal Arithmetic:** Always use `NUMERIC(12,2)` for all currency values. Never use `FLOAT`, `REAL`, or `DOUBLE PRECISION`.
2. **Strict Post-Approval Immutability:** Once a payment item is `APPROVED` or `PAID`, its financial fields (`vendor_id`, `invoice_ref`, `amount`, `tds`, `purpose`) are locked by a PostgreSQL trigger.
3. **Zero Hard Deletes:** Submitted payment items (`status != 'DRAFT'`) cannot be deleted from the database. Use `CANCELLED` status instead.
4. **Unique UTR Guarantee:** Prevent accidental duplicate UTR entry using a normalized case-insensitive unique index.
5. **Role Separation:** `STAFF` has zero read access to `payment_items`, `company_banks`, or `audit_logs`. They can only access `incoming_bills` and `vendors`.
6. **Private Document Storage:** Supplier invoices and bank transaction receipts (which contain account numbers and corporate KYC metadata) are stored in **private Supabase buckets** and accessed exclusively through short-lived **Signed URLs (5-minute expiry)**.

---

## 2. Complete PostgreSQL Schema (Supabase SQL)

Run in Supabase SQL Editor or save as initial migration (`supabase/migrations/001_initial_schema.sql`).

```sql
-- ==========================================
-- 1. ENUMS
-- ==========================================
CREATE TYPE public.user_role AS ENUM ('STAFF', 'ACCOUNTANT', 'OWNER');

CREATE TYPE public.payment_status AS ENUM (
  'DRAFT',
  'PENDING_APPROVAL',
  'ON_HOLD',
  'APPROVED',
  'PAID',
  'REJECTED',
  'CANCELLED'
);

CREATE TYPE public.incoming_bill_status AS ENUM ('NEW', 'CONVERTED', 'DISMISSED');

-- ==========================================
-- 2. PROFILES (Linked to auth.users)
-- ==========================================
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  role public.user_role NOT NULL DEFAULT 'STAFF',
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
-- 4. INCOMING BILLS (Uploaded by Stock Staff)
-- ==========================================
CREATE TABLE public.incoming_bills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID REFERENCES public.vendors(id),
  vendor_name_fallback TEXT,             -- Used if vendor is not yet in master table
  invoice_ref TEXT NOT NULL,
  estimated_amount NUMERIC(12,2) CHECK (estimated_amount IS NULL OR estimated_amount > 0),
  file_path TEXT NOT NULL,               -- Private storage path in 'supplier-invoices'
  notes TEXT,
  status public.incoming_bill_status NOT NULL DEFAULT 'NEW',
  uploaded_by UUID NOT NULL REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ==========================================
-- 5. PAYMENT ITEMS (Core Approval & UTR Ledger)
-- ==========================================
CREATE TABLE public.payment_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sheet_date DATE NOT NULL DEFAULT CURRENT_DATE,
  incoming_bill_id UUID REFERENCES public.incoming_bills(id),

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
-- 6. IMMUTABLE AUDIT LOGS
-- ==========================================
CREATE TABLE public.audit_logs (
  id BIGSERIAL PRIMARY KEY,
  table_name TEXT NOT NULL,
  record_id UUID NOT NULL,
  action TEXT NOT NULL,                  -- 'CREATED', 'SUBMITTED', 'APPROVED', 'REJECTED', 'HOLD', 'BANK_CHANGED', 'PAID', 'UPDATED'
  old_data JSONB,
  new_data JSONB,
  changed_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_record ON public.audit_logs (record_id, created_at DESC);
3. Database-Level Security Triggers (Immutability & Auto-Audit)
SQL
-- Helper function to read current user's role safely
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS public.user_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$ SELECT role FROM public.profiles WHERE id = auth.uid() AND is_active = TRUE; $$;

-- ==========================================
-- TRIGGER 1: Enforce Workflow, Role Authority & Post-Approval Locking
-- ==========================================
CREATE OR REPLACE FUNCTION public.enforce_payment_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$ DECLARE v_role public.user_role; BEGIN v_role := public.get_my_role();    -- Block hard deletes on anything except DRAFT IF TG_OP = 'DELETE' THEN IF OLD.status <> 'DRAFT' THEN RAISE EXCEPTION 'Submitted payment records cannot be deleted. Use CANCELLED status instead.'; END IF; RETURN OLD; END IF;    IF TG_OP = 'UPDATE' THEN NEW.updated_at := NOW();      -- 1. Only OWNER can transition to APPROVED, ON_HOLD, or REJECTED IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('APPROVED', 'ON_HOLD', 'REJECTED') THEN IF v_role <> 'OWNER' THEN RAISE EXCEPTION 'Only OWNER can approve, hold, or reject payment items.'; END IF; END IF;      -- 2. Stamp approval metadata automatically IF NEW.status = 'APPROVED' AND OLD.status <> 'APPROVED' THEN NEW.approved_by := auth.uid(); NEW.approved_at := NOW(); END IF;      -- 3. Stamp paid metadata automatically IF NEW.status = 'PAID' AND OLD.status <> 'PAID' THEN IF OLD.status <> 'APPROVED' THEN RAISE EXCEPTION 'Only APPROVED items can be marked as PAID.'; END IF; NEW.paid_by := auth.uid(); NEW.paid_at := NOW(); END IF;      -- 4. POST-APPROVAL IMMUTABILITY LOCK -- Once APPROVED, lock core financial fields forever IF OLD.status = 'APPROVED' THEN IF NEW.vendor_id IS DISTINCT FROM OLD.vendor_id OR NEW.invoice_ref IS DISTINCT FROM OLD.invoice_ref OR NEW.amount IS DISTINCT FROM OLD.amount OR NEW.tds IS DISTINCT FROM OLD.tds OR NEW.purpose IS DISTINCT FROM OLD.purpose OR NEW.sheet_date IS DISTINCT FROM OLD.sheet_date OR NEW.source_bank_id IS DISTINCT FROM OLD.source_bank_id THEN RAISE EXCEPTION 'Core financial fields are locked after Owner approval.'; END IF; END IF;      -- 5. TERMINAL STATE LOCK (PAID / REJECTED / CANCELLED cannot be mutated) IF OLD.status IN ('PAID', 'REJECTED', 'CANCELLED') THEN RAISE EXCEPTION 'Finalized payment records (\% status) are completely immutable.', OLD.status; END IF; END IF;    RETURN NEW; END; $$;

CREATE TRIGGER trg_enforce_payment_integrity
  BEFORE UPDATE OR DELETE ON public.payment_items
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_payment_integrity();

-- ==========================================
-- TRIGGER 2: Automatic Audit Logging
-- ==========================================
CREATE OR REPLACE FUNCTION public.log_payment_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$ DECLARE v_action TEXT; BEGIN IF TG_OP = 'INSERT' THEN v_action := 'CREATED'; INSERT INTO public.audit_logs (table_name, record_id, action, old_data, new_data, changed_by) VALUES ('payment_items', NEW.id, v_action, NULL, to_jsonb(NEW), auth.uid()); RETURN NEW; END IF;    IF TG_OP = 'UPDATE' THEN IF NEW.status IS DISTINCT FROM OLD.status THEN v_action := 'STATUS_' \vert{}\vert{} NEW.status::TEXT; ELSIF NEW.source_bank_id IS DISTINCT FROM OLD.source_bank_id THEN v_action := 'BANK_CHANGED'; ELSE v_action := 'UPDATED'; END IF;      INSERT INTO public.audit_logs (table_name, record_id, action, old_data, new_data, changed_by) VALUES ('payment_items', NEW.id, v_action, to_jsonb(OLD), to_jsonb(NEW), auth.uid()); RETURN NEW; END IF;    RETURN NULL; END; $$;

CREATE TRIGGER trg_log_payment_audit
  AFTER INSERT OR UPDATE ON public.payment_items
  FOR EACH ROW
  EXECUTE FUNCTION public.log_payment_audit();
4. Row Level Security (RLS) Policies
Enable RLS on every table with default-deny:

SQL
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_banks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incoming_bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- PROFILES: Users see own profile; OWNER & ACCOUNTANT can view all names (for sign-offs)
CREATE POLICY "profiles_select" ON public.profiles
  FOR SELECT USING (id = auth.uid() OR public.get_my_role() IN ('OWNER', 'ACCOUNTANT'));

CREATE POLICY "profiles_owner_manage" ON public.profiles
  FOR ALL USING (public.get_my_role() = 'OWNER');

-- VENDORS: All active authenticated users can read; ACCOUNTANT & OWNER can insert/update
CREATE POLICY "vendors_select" ON public.vendors
  FOR SELECT USING (public.get_my_role() IS NOT NULL);

CREATE POLICY "vendors_manage" ON public.vendors
  FOR INSERT WITH CHECK (public.get_my_role() IN ('ACCOUNTANT', 'OWNER', 'STAFF'));

CREATE POLICY "vendors_update" ON public.vendors
  FOR UPDATE USING (public.get_my_role() IN ('ACCOUNTANT', 'OWNER'));

-- COMPANY BANKS: Only ACCOUNTANT & OWNER can view; only OWNER can manage
CREATE POLICY "banks_select" ON public.company_banks
  FOR SELECT USING (public.get_my_role() IN ('ACCOUNTANT', 'OWNER'));

CREATE POLICY "banks_owner_manage" ON public.company_banks
  FOR ALL USING (public.get_my_role() = 'OWNER');

-- INCOMING BILLS: STAFF can insert & view own uploads; ACCOUNTANT & OWNER see all
CREATE POLICY "incoming_bills_select" ON public.incoming_bills
  FOR SELECT USING (
    public.get_my_role() IN ('ACCOUNTANT', 'OWNER')
    OR uploaded_by = auth.uid()
  );

CREATE POLICY "incoming_bills_insert" ON public.incoming_bills
  FOR INSERT WITH CHECK (
    public.get_my_role() IN ('STAFF', 'ACCOUNTANT', 'OWNER')
    AND uploaded_by = auth.uid()
  );

CREATE POLICY "incoming_bills_update" ON public.incoming_bills
  FOR UPDATE USING (public.get_my_role() IN ('ACCOUNTANT', 'OWNER'));

-- PAYMENT ITEMS: Strictly hidden from STAFF! Only ACCOUNTANT & OWNER have access.
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
5. Private File Storage Security (Supabase Storage)
Create 2 Private Buckets (public = false):

supplier-invoices — Supplier invoices/PIs uploaded by Staff or Accountant.

bank-receipts — Axis Bank Neo reports & South Indian Bank transaction receipts uploaded by Accountant.

Storage Rules
Max File Size: 5 MB per file.

Allowed MIME Types: application/pdf, image/jpeg, image/png, image/webp.

Naming Convention: {year}/{month}/{uuid}.{ext} (prevents filename collisions and hides vendor names from paths).

Access Pattern:

NEVER call getPublicUrl().

ALWAYS generate temporary Signed URLs on the server via supabase.storage.from(bucket).createSignedUrl(path, 300) (5-minute validity).

Bucket Access Policies:

supplier-invoices: Upload allowed for STAFF, ACCOUNTANT, OWNER. Read allowed for ACCOUNTANT, OWNER, and the STAFF user who uploaded the file.

bank-receipts: Upload & Read strictly restricted to ACCOUNTANT and OWNER only (STAFF has zero access).

6. Application-Layer Security Checklist
Server-Side Auth Checks: Every Next.js Server Action / Route Handler must verify supabase.auth.getUser() (never trust getSession() alone on the server) and validate the payload with Zod.

No Service Role Key on Client: Keep SUPABASE_SERVICE_ROLE_KEY strictly on the server (only needed for Owner creating new user accounts via Admin API).

Duplicate Invoice Check Helper: Before inserting a payment_items row, query existing non-rejected/non-cancelled items matching (vendor_id, LOWER(TRIM(invoice_ref))) where invoice_ref is not 'na' or 'on account' and return a clear warning to the UI.

HTTPS & Security Headers: Enforce HTTPS (automatic on Vercel) and disable open user self-signup in Supabase Auth settings (only the Owner creates accounts for INDFURN staff).

Backups: Enable Supabase automatic daily backups (or schedule a weekly pg_dump export if on the Free tier) so financial history is never lost.