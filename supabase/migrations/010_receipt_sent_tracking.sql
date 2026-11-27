-- ==========================================
-- Migration 010: Receipt-Sent Tracking & Strict History Print Support
-- Payment Desk (v2) - INDFURN & VINMORE
-- ==========================================

-- 1. Add receipt tracking columns to public.payment_items
ALTER TABLE public.payment_items
  ADD COLUMN IF NOT EXISTS receipt_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS receipt_sent_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Partial index for fast Settled + Receipt-Sent queries on /history and /print
CREATE INDEX IF NOT EXISTS idx_payment_items_company_receipt_sent
  ON public.payment_items(company_id, status, receipt_sent_at)
  WHERE status = 'PAID';

-- 2. Extend enforce_payment_integrity() to allow stamping/clearing ONLY
--    receipt_sent_at and receipt_sent_by on PAID rows while keeping all financial,
--    beneficiary, bank, and settlement reference columns strictly immutable.
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
    -- 1. TERMINAL STATE LOCK & PAID POST-SETTLEMENT EXCEPTIONS
    IF OLD.status IN ('REJECTED', 'CANCELLED') THEN
      RAISE EXCEPTION 'Finalized payment records (% status) are completely immutable.', OLD.status;
    END IF;

    IF OLD.status = 'PAID' THEN
      -- Exception A: AUDITOR or Admin may stamp audited_by and audited_at once
      IF OLD.audited_at IS NULL AND NEW.audited_at IS NOT NULL THEN
        IF v_role IS DISTINCT FROM 'AUDITOR' AND NOT v_is_admin THEN
          RAISE EXCEPTION 'Only an active AUDITOR or Admin can verify audited payments.';
        END IF;

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
          OR NEW.receipt_sent_at IS DISTINCT FROM OLD.receipt_sent_at
          OR NEW.receipt_sent_by IS DISTINCT FROM OLD.receipt_sent_by
        THEN
          RAISE EXCEPTION 'Auditor cannot modify financial or beneficiary data on a paid record.';
        END IF;

        NEW.audited_by := auth.uid();
        NEW.audited_at := NOW();
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
