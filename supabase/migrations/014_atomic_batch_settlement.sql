-- =========================================================================
-- Migration 014: Atomic Batch Settlement RPC
-- Payment Desk (v2) - INDFURN & VINMORE
-- Idempotent & safe to run repeatedly in Supabase SQL Editor.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.settle_payment_batch_atomic(
  p_company_id UUID,
  p_batch_date DATE,
  p_receipt_file_path TEXT,
  p_notes TEXT,
  p_items JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_role public.user_role;
  v_is_admin BOOLEAN;
  v_is_active BOOLEAN;
  v_batch_date DATE;
  v_receipt_path TEXT;
  v_notes TEXT;
  v_requested_count INTEGER;
  v_distinct_count INTEGER;
  v_payment_ids UUID[];
  v_locked_count INTEGER := 0;
  v_total_amount NUMERIC(14, 2) := 0;
  v_bank_ids UUID[] := ARRAY[]::UUID[];
  v_shared_source_bank_id UUID;
  v_row RECORD;
  v_item RECORD;
  v_seen_utrs TEXT[] := ARRAY[]::TEXT[];
  v_clean_utr TEXT;
  v_clean_cheque_no TEXT;
  v_clean_cheque_date DATE;
  v_conflict_invoice TEXT;
  v_code_prefix TEXT;
  v_max_seq INTEGER := 0;
  v_batch_code TEXT;
  v_batch_id UUID;
  v_updated_count INTEGER := 0;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  -- 1. Strict caller authentication, active profile & role/company access check
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized. Please sign in.' USING ERRCODE = '42501';
  END IF;

  SELECT p.role, p.is_admin, p.is_active
  INTO v_role, v_is_admin, v_is_active
  FROM public.profiles p
  WHERE p.id = v_user_id
  LIMIT 1;

  IF NOT FOUND OR v_is_active IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Account is disabled or profile not found.' USING ERRCODE = '42501';
  END IF;

  IF v_role IS DISTINCT FROM 'PREPARER' AND NOT COALESCE(v_is_admin, FALSE) THEN
    RAISE EXCEPTION 'Access denied: Only Preparers or Administrators can settle payment batches.' USING ERRCODE = '42501';
  END IF;

  IF p_company_id IS NULL OR NOT public.has_company_access(p_company_id) THEN
    RAISE EXCEPTION 'Access denied: You do not have access to the selected company workspace.' USING ERRCODE = '42501';
  END IF;

  v_batch_date := COALESCE(p_batch_date, (NOW() AT TIME ZONE 'Asia/Kolkata')::DATE);
  v_receipt_path := btrim(COALESCE(p_receipt_file_path, ''));
  v_notes := NULLIF(btrim(COALESCE(p_notes, '')), '');

  IF v_receipt_path = '' THEN
    RAISE EXCEPTION 'Combined Bank Receipt PDF / Image upload is required.';
  END IF;

  -- 2. Validate p_items is a non-empty JSON array with no duplicate payment_id entries
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Select at least one approved payment to settle as a batch.';
  END IF;

  SELECT
    COUNT(*),
    COUNT(DISTINCT (elem->>'payment_id')::uuid)
  INTO v_requested_count, v_distinct_count
  FROM jsonb_array_elements(p_items) AS elem;

  IF v_requested_count = 0 OR v_requested_count <> v_distinct_count THEN
    RAISE EXCEPTION 'Duplicate payment items found in batch selection.';
  END IF;

  SELECT ARRAY_AGG((elem->>'payment_id')::uuid ORDER BY (elem->>'payment_id')::uuid)
  INTO v_payment_ids
  FROM jsonb_array_elements(p_items) AS elem;

  -- 3. Transaction-scoped advisory lock per company + date to prevent BATCH-YYYYMMDD-NN collisions
  PERFORM pg_advisory_xact_lock(hashtext(p_company_id::text || ':' || v_batch_date::text));

  -- 4. Lock all targeted payment_items rows in deterministic UUID order (ORDER BY id FOR UPDATE)
  FOR v_row IN
    SELECT
      pi.id,
      pi.status,
      pi.source_bank_id,
      pi.net_payable,
      pi.invoice_ref
    FROM public.payment_items pi
    WHERE pi.company_id = p_company_id
      AND pi.id = ANY(v_payment_ids)
    ORDER BY pi.id ASC
    FOR UPDATE
  LOOP
    v_locked_count := v_locked_count + 1;

    IF v_row.status <> 'APPROVED' THEN
      RAISE EXCEPTION 'Payment "%" is in ''%'' status. Only APPROVED payments can be batch-settled.',
        COALESCE(v_row.invoice_ref, v_row.id::text),
        v_row.status;
    END IF;

    v_total_amount := v_total_amount + COALESCE(v_row.net_payable, 0);

    IF v_row.source_bank_id IS NOT NULL AND NOT (v_row.source_bank_id = ANY(v_bank_ids)) THEN
      v_bank_ids := array_append(v_bank_ids, v_row.source_bank_id);
    END IF;
  END LOOP;

  IF v_locked_count <> v_requested_count THEN
    RAISE EXCEPTION 'One or more selected payments could not be found in the active company.';
  END IF;

  v_total_amount := ROUND(v_total_amount, 2);
  v_shared_source_bank_id := CASE
    WHEN COALESCE(array_length(v_bank_ids, 1), 0) = 1 THEN v_bank_ids[1]
    ELSE NULL
  END;

  -- 5. Validate per-item UTR / Cheque requirements & UTR uniqueness (intra-batch and database-wide)
  FOR v_item IN
    SELECT
      (elem->>'payment_id')::uuid AS payment_id,
      elem->>'utr_number' AS utr_number,
      elem->>'cheque_number' AS cheque_number,
      NULLIF(btrim(COALESCE(elem->>'cheque_date', '')), '')::date AS cheque_date,
      pi.payment_mode,
      pi.invoice_ref
    FROM jsonb_array_elements(p_items) AS elem
    JOIN public.payment_items pi
      ON pi.id = (elem->>'payment_id')::uuid
     AND pi.company_id = p_company_id
  LOOP
    IF v_item.payment_mode::text IN ('NEFT_RTGS', 'IMPS') THEN
      v_clean_utr := UPPER(btrim(COALESCE(v_item.utr_number, '')));
      IF v_clean_utr = '' THEN
        RAISE EXCEPTION 'UTR / Reference Number is required for invoice "%".',
          COALESCE(v_item.invoice_ref, v_item.payment_id::text);
      END IF;

      IF v_clean_utr = ANY(v_seen_utrs) THEN
        RAISE EXCEPTION 'Duplicate UTR "%" entered within this batch (invoice "%").',
          v_clean_utr,
          COALESCE(v_item.invoice_ref, v_item.payment_id::text);
      END IF;
      v_seen_utrs := array_append(v_seen_utrs, v_clean_utr);

      SELECT pi2.invoice_ref
      INTO v_conflict_invoice
      FROM public.payment_items pi2
      WHERE (UPPER(btrim(pi2.utr_number)) = v_clean_utr OR btrim(pi2.utr_number) = v_clean_utr)
        AND pi2.id <> ALL(v_payment_ids)
      LIMIT 1;

      IF FOUND THEN
        RAISE EXCEPTION 'UTR "%" is already recorded on invoice "%". Please enter unique UTRs.',
          v_clean_utr,
          COALESCE(v_conflict_invoice, 'existing payment');
      END IF;
    ELSIF v_item.payment_mode::text = 'CHEQUE' THEN
      v_clean_cheque_no := btrim(COALESCE(v_item.cheque_number, ''));
      v_clean_cheque_date := COALESCE(v_item.cheque_date, v_batch_date);
      IF v_clean_cheque_no = '' OR v_clean_cheque_date IS NULL THEN
        RAISE EXCEPTION 'Cheque Number and Cheque Date are required for invoice "%".',
          COALESCE(v_item.invoice_ref, v_item.payment_id::text);
      END IF;
    END IF;
  END LOOP;

  -- 6. Compute next sequential batch_code (BATCH-YYYYMMDD-01, -02, ...)
  v_code_prefix := 'BATCH-' || to_char(v_batch_date, 'YYYYMMDD') || '-';

  SELECT COALESCE(MAX(
    CASE
      WHEN substring(pb.batch_code FROM length(v_code_prefix) + 1) ~ '^\d+$'
      THEN substring(pb.batch_code FROM length(v_code_prefix) + 1)::integer
      ELSE 0
    END
  ), 0)
  INTO v_max_seq
  FROM public.payment_batches pb
  WHERE pb.company_id = p_company_id
    AND pb.batch_code LIKE v_code_prefix || '%';

  v_batch_code := v_code_prefix || lpad((v_max_seq + 1)::text, 2, '0');

  -- 7. Insert payment_batches record
  INSERT INTO public.payment_batches (
    company_id,
    batch_code,
    batch_date,
    source_bank_id,
    receipt_file_path,
    item_count,
    total_amount,
    notes,
    audit_status,
    created_by
  )
  VALUES (
    p_company_id,
    v_batch_code,
    v_batch_date,
    v_shared_source_bank_id,
    v_receipt_path,
    v_locked_count,
    v_total_amount,
    v_notes,
    'PENDING',
    v_user_id
  )
  RETURNING id INTO v_batch_id;

  -- 8. Atomically transition all targeted APPROVED payment_items to PAID linked to v_batch_id
  UPDATE public.payment_items pi
  SET
    status = 'PAID',
    batch_id = v_batch_id,
    utr_number = CASE
      WHEN pi.payment_mode::text IN ('NEFT_RTGS', 'IMPS') THEN UPPER(btrim(v.utr_number))
      ELSE NULL
    END,
    cheque_number = CASE
      WHEN pi.payment_mode::text = 'CHEQUE' THEN btrim(v.cheque_number)
      ELSE NULL
    END,
    cheque_date = CASE
      WHEN pi.payment_mode::text = 'CHEQUE' THEN COALESCE(v.cheque_date, v_batch_date)
      ELSE NULL
    END,
    receipt_file_path = v_receipt_path,
    paid_by = v_user_id,
    paid_at = v_now,
    updated_at = v_now
  FROM (
    SELECT
      (elem->>'payment_id')::uuid AS payment_id,
      elem->>'utr_number' AS utr_number,
      elem->>'cheque_number' AS cheque_number,
      NULLIF(btrim(COALESCE(elem->>'cheque_date', '')), '')::date AS cheque_date
    FROM jsonb_array_elements(p_items) AS elem
  ) v
  WHERE pi.id = v.payment_id
    AND pi.company_id = p_company_id
    AND pi.status = 'APPROVED';

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  IF v_updated_count <> v_locked_count THEN
    RAISE EXCEPTION 'Batch settlement failed: expected % item(s) updated, got %.', v_locked_count, v_updated_count;
  END IF;

  -- 9. Insert BATCH_SETTLED audit log entry
  INSERT INTO public.audit_logs (
    table_name,
    record_id,
    company_id,
    action,
    new_data,
    changed_by
  )
  VALUES (
    'payment_batches',
    v_batch_id,
    p_company_id,
    'BATCH_SETTLED',
    jsonb_build_object(
      'batch_code', v_batch_code,
      'batch_date', v_batch_date,
      'item_count', v_locked_count,
      'total_amount', v_total_amount,
      'payment_ids', to_jsonb(v_payment_ids)
    ),
    v_user_id
  );

  -- 10. Return atomic settlement summary
  RETURN jsonb_build_object(
    'batch_id', v_batch_id,
    'batch_code', v_batch_code,
    'item_count', v_locked_count,
    'total_amount', v_total_amount
  );
END;
$$;

REVOKE ALL ON FUNCTION public.settle_payment_batch_atomic(UUID, DATE, TEXT, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.settle_payment_batch_atomic(UUID, DATE, TEXT, TEXT, JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION public.settle_payment_batch_atomic(UUID, DATE, TEXT, TEXT, JSONB) TO authenticated;
