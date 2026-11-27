-- =========================================================================
-- Migration 012 (Fixed Order): Batch-Wise Settlement & Auditor Batch Compare
-- Payment Desk (v2) - INDFURN & VINMORE
-- Idempotent & safe to run repeatedly in Supabase SQL Editor.
-- =========================================================================

-- 1. Create public.payment_batches table
CREATE TABLE IF NOT EXISTS public.payment_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  batch_code TEXT NOT NULL,
  batch_date DATE NOT NULL DEFAULT (NOW() AT TIME ZONE 'Asia/Kolkata')::DATE,
  source_bank_id UUID REFERENCES public.company_banks(id) ON DELETE SET NULL,
  receipt_file_path TEXT NOT NULL,
  item_count INTEGER NOT NULL CHECK (item_count > 0),
  total_amount NUMERIC(14, 2) NOT NULL CHECK (total_amount >= 0),
  notes TEXT,
  audit_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (audit_status IN ('PENDING', 'AUDITED', 'FLAGGED')),
  audit_note TEXT,
  created_by UUID NOT NULL REFERENCES public.profiles(id),
  audited_at TIMESTAMPTZ,
  audited_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, batch_code)
);

CREATE INDEX IF NOT EXISTS idx_payment_batches_company_date
  ON public.payment_batches(company_id, batch_date DESC, created_at DESC);

DROP TRIGGER IF EXISTS trg_payment_batches_updated_at ON public.payment_batches;
CREATE TRIGGER trg_payment_batches_updated_at
  BEFORE UPDATE ON public.payment_batches
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 2. Add batch_id, audit_status, audit_note columns to public.payment_items
ALTER TABLE public.payment_items
  ADD COLUMN IF NOT EXISTS batch_id UUID REFERENCES public.payment_batches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS audit_status TEXT NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS audit_note TEXT;

ALTER TABLE public.payment_items DROP CONSTRAINT IF EXISTS chk_payment_items_audit_status;
ALTER TABLE public.payment_items ADD CONSTRAINT chk_payment_items_audit_status
  CHECK (audit_status IN ('PENDING', 'AUDITED', 'FLAGGED'));

CREATE INDEX IF NOT EXISTS idx_payment_items_batch_id
  ON public.payment_items(batch_id) WHERE batch_id IS NOT NULL;

-- 3. Enable RLS & Company-Scoped Policies on public.payment_batches
ALTER TABLE public.payment_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "payment_batches_select" ON public.payment_batches;
CREATE POLICY "payment_batches_select" ON public.payment_batches
  FOR SELECT TO authenticated
  USING (
    public.has_company_access(company_id)
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.is_active = TRUE
    )
  );

DROP POLICY IF EXISTS "payment_batches_insert" ON public.payment_batches;
CREATE POLICY "payment_batches_insert" ON public.payment_batches
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_company_access(company_id)
    AND (public.get_my_role() = 'PREPARER' OR public.is_admin_user())
  );

DROP POLICY IF EXISTS "payment_batches_update" ON public.payment_batches;
CREATE POLICY "payment_batches_update" ON public.payment_batches
  FOR UPDATE TO authenticated
  USING (
    public.has_company_access(company_id)
    AND (public.get_my_role() IN ('PREPARER', 'AUDITOR') OR public.is_admin_user())
  )
  WITH CHECK (
    public.has_company_access(company_id)
    AND (public.get_my_role() IN ('PREPARER', 'AUDITOR') OR public.is_admin_user())
  );

GRANT SELECT, INSERT, UPDATE ON public.payment_batches TO authenticated;
GRANT ALL ON public.payment_batches TO service_role;

-- 4. Extend notification_event enum for grouped batch settlement alerts
ALTER TYPE public.notification_event ADD VALUE IF NOT EXISTS 'BATCH_SETTLED';

-- 5. Enable Supabase Realtime publication idempotently for payment_batches
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'payment_batches'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.payment_batches;
    END IF;
  END IF;
END $$;

-- 6. Update enforce_payment_integrity() FIRST (before backfilling PAID rows)
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
    IF auth.uid() IS NOT NULL AND v_role IS DISTINCT FROM 'PREPARER' AND NOT v_is_admin THEN
      RAISE EXCEPTION 'Only a PREPARER or Admin can delete draft payments.';
    END IF;
    RETURN OLD;
  END IF;

  -- UPDATE
  IF TG_OP = 'UPDATE' THEN
    -- 1. TERMINAL STATE LOCK & PAID POST-SETTLEMENT EXCEPTIONS
    IF OLD.status IN ('REJECTED', 'CANCELLED') THEN
      RAISE EXCEPTION 'Finalized payment records (% status) are completely immutable.', OLD.status;
    END IF;

    IF OLD.status = 'PAID' THEN
      -- Exception A: AUDITOR, Admin, or verified server-side service_role may stamp/update audit status & note
      IF (OLD.audited_at IS NULL AND NEW.audited_at IS NOT NULL)
        OR NEW.audit_status IS DISTINCT FROM OLD.audit_status
        OR NEW.audit_note IS DISTINCT FROM OLD.audit_note
      THEN
        IF auth.uid() IS NOT NULL AND v_role IS DISTINCT FROM 'AUDITOR' AND NOT v_is_admin THEN
          RAISE EXCEPTION 'Only an active AUDITOR or Admin can verify or flag audited payments.';
        END IF;

        IF NEW.status IS DISTINCT FROM OLD.status
          OR NEW.amount IS DISTINCT FROM OLD.amount
          OR NEW.tds IS DISTINCT FROM OLD.tds
          OR NEW.vendor_id IS DISTINCT FROM OLD.vendor_id
          OR NEW.company_id IS DISTINCT FROM OLD.company_id
          OR NEW.source_bank_id IS DISTINCT FROM OLD.source_bank_id
          OR NEW.batch_id IS DISTINCT FROM OLD.batch_id
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
          OR NEW.receipt_sent_at IS DISTINCT FROM OLD.receipt_sent_at
          OR NEW.receipt_sent_by IS DISTINCT FROM OLD.receipt_sent_by
        THEN
          RAISE EXCEPTION 'Auditor cannot modify financial or beneficiary data on a paid record.';
        END IF;

        IF NEW.audit_status = 'FLAGGED' THEN
          NEW.audited_by := NULL;
          NEW.audited_at := NULL;
        ELSE
          NEW.audit_status := 'AUDITED';
          NEW.audited_by := COALESCE(OLD.audited_by, NEW.audited_by, auth.uid());
          NEW.audited_at := COALESCE(OLD.audited_at, NEW.audited_at, NOW());
        END IF;

        NEW.updated_at := NOW();
        RETURN NEW;

      -- Exception B: Authorized staff (or verified server-side admin client) may update ONLY receipt_sent_at / receipt_sent_by
      ELSIF NEW.receipt_sent_at IS DISTINCT FROM OLD.receipt_sent_at
        OR NEW.receipt_sent_by IS DISTINCT FROM OLD.receipt_sent_by
      THEN
        IF NEW.status IS DISTINCT FROM OLD.status
          OR NEW.amount IS DISTINCT FROM OLD.amount
          OR NEW.tds IS DISTINCT FROM OLD.tds
          OR NEW.vendor_id IS DISTINCT FROM OLD.vendor_id
          OR NEW.company_id IS DISTINCT FROM OLD.company_id
          OR NEW.source_bank_id IS DISTINCT FROM OLD.source_bank_id
          OR NEW.batch_id IS DISTINCT FROM OLD.batch_id
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
          OR NEW.audited_at IS DISTINCT FROM OLD.audited_at
          OR NEW.audited_by IS DISTINCT FROM OLD.audited_by
          OR NEW.audit_status IS DISTINCT FROM OLD.audit_status
          OR NEW.audit_note IS DISTINCT FROM OLD.audit_note
        THEN
          RAISE EXCEPTION 'Cannot modify financial, settlement, or audit fields when updating receipt sent tracking.';
        END IF;

        IF auth.uid() IS NOT NULL THEN
          IF NEW.receipt_sent_at IS NULL THEN
            IF v_role IS DISTINCT FROM 'PREPARER' AND NOT v_is_admin THEN
              RAISE EXCEPTION 'Only a PREPARER or Admin can clear receipt sent confirmation.';
            END IF;
          ELSE
            IF v_role NOT IN ('PREPARER', 'VERIFIER', 'APPROVER') AND NOT v_is_admin THEN
              RAISE EXCEPTION 'Access denied: Unauthorized role for marking receipt sent.';
            END IF;
          END IF;
        END IF;

        NEW.updated_at := NOW();
        RETURN NEW;
      ELSE
        RAISE EXCEPTION 'Paid payment records are completely immutable.';
      END IF;
    END IF;

    -- 2. ZERO DIRECT FINANCIAL EDITS POST-DRAFT
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
        IF OLD.status NOT IN ('PENDING_APPROVAL', 'ON_HOLD') OR (auth.uid() IS NOT NULL AND v_role IS DISTINCT FROM 'APPROVER' AND NOT v_is_admin) THEN
          RAISE EXCEPTION 'Source bank can only be changed by an APPROVER prior to final approval.';
        END IF;
      END IF;
    END IF;

    -- 3. ROLE-ENFORCED STATE TRANSITIONS
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      -- DRAFT -> PENDING_VERIFICATION: PREPARER or Admin
      IF OLD.status = 'DRAFT' AND NEW.status = 'PENDING_VERIFICATION' THEN
        IF auth.uid() IS NOT NULL AND v_role IS DISTINCT FROM 'PREPARER' AND NOT v_is_admin THEN
          RAISE EXCEPTION 'Only a PREPARER or Admin can submit drafts for verification.';
        END IF;
        NEW.submitted_at := COALESCE(NEW.submitted_at, NOW());
      END IF;

      -- PENDING_VERIFICATION -> PENDING_APPROVAL: VERIFIER or Approver/Admin override
      IF OLD.status = 'PENDING_VERIFICATION' AND NEW.status = 'PENDING_APPROVAL' THEN
        IF auth.uid() IS NOT NULL AND v_role IS DISTINCT FROM 'VERIFIER' AND v_role IS DISTINCT FROM 'APPROVER' AND NOT v_is_admin THEN
          RAISE EXCEPTION 'Only a VERIFIER or APPROVER can verify payments.';
        END IF;
        NEW.verified_by := COALESCE(NEW.verified_by, auth.uid());
        NEW.verified_at := COALESCE(NEW.verified_at, NOW());
      END IF;

      -- Return / Reject from PENDING_VERIFICATION: requires reason
      IF OLD.status = 'PENDING_VERIFICATION' AND NEW.status = 'REJECTED' THEN
        IF auth.uid() IS NOT NULL AND v_role IS DISTINCT FROM 'VERIFIER' AND v_role IS DISTINCT FROM 'APPROVER' AND NOT v_is_admin THEN
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
        IF auth.uid() IS NOT NULL AND v_role IS DISTINCT FROM 'APPROVER' AND NOT v_is_admin THEN
          RAISE EXCEPTION 'Only an APPROVER can approve, hold, or reject payments.';
        END IF;

        IF NEW.status = 'APPROVED' THEN
          NEW.approved_by := COALESCE(NEW.approved_by, auth.uid());
          NEW.approved_at := COALESCE(NEW.approved_at, NOW());
        END IF;

        IF NEW.status = 'REJECTED' THEN
          IF btrim(COALESCE(NEW.rejection_reason, '')) = '' THEN
            RAISE EXCEPTION 'A mandatory rejection reason is required when rejecting payments.';
          END IF;
        END IF;
      END IF;

      -- APPROVED -> PAID: PREPARER or Admin
      IF OLD.status = 'APPROVED' AND NEW.status = 'PAID' THEN
        IF auth.uid() IS NOT NULL AND v_role IS DISTINCT FROM 'PREPARER' AND NOT v_is_admin THEN
          RAISE EXCEPTION 'Only a PREPARER or Admin can mark approved payments as PAID.';
        END IF;

        IF NEW.payment_mode::text IN ('NEFT_RTGS', 'IMPS') THEN
          IF btrim(COALESCE(NEW.utr_number, '')) = '' THEN
            RAISE EXCEPTION 'A valid unique UTR reference number is required for NEFT/RTGS/IMPS payments.';
          END IF;
        ELSIF NEW.payment_mode::text = 'CHEQUE' THEN
          IF btrim(COALESCE(NEW.cheque_number, '')) = '' OR NEW.cheque_date IS NULL THEN
            RAISE EXCEPTION 'Cheque number and cheque date are required for Cheque settlements.';
          END IF;
        END IF;

        NEW.paid_by := COALESCE(NEW.paid_by, auth.uid());
        NEW.paid_at := COALESCE(NEW.paid_at, NOW());
      END IF;
    END IF;

    -- Always stamp updated_at
    NEW.updated_at := NOW();
  END IF;

  RETURN NEW;
END;
$$;

-- 7. NOW safely backfill existing audited rows (trigger now allows it)
UPDATE public.payment_items
SET audit_status = 'AUDITED'
WHERE audited_at IS NOT NULL
  AND audit_status = 'PENDING';