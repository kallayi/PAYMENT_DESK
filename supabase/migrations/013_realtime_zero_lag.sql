-- =========================================================================
-- Migration 013: Zero-Lag Realtime Hardening & Full Replica Identity
-- Payment Desk (v2) - INDFURN & VINMORE
-- Idempotent & safe to run repeatedly in Supabase SQL Editor.
-- =========================================================================

-- 1. Set REPLICA IDENTITY FULL on all live company-scoped operational tables
-- so Supabase Realtime RLS + `company_id=eq.<id>` filtered subscriptions
-- NEVER drop UPDATE or DELETE events.
ALTER TABLE public.payment_items REPLICA IDENTITY FULL;
ALTER TABLE public.payment_batches REPLICA IDENTITY FULL;
ALTER TABLE public.payment_requests REPLICA IDENTITY FULL;
ALTER TABLE public.company_banks REPLICA IDENTITY FULL;

-- 2. Ensure all 5 live tables are in the supabase_realtime publication
DO $$
DECLARE
  v_table TEXT;
  v_tables TEXT[] := ARRAY[
    'payment_items',
    'payment_batches',
    'payment_requests',
    'company_banks',
    'notifications'
  ];
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    FOREACH v_table IN ARRAY v_tables LOOP
      IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = v_table
      ) THEN
        IF NOT EXISTS (
          SELECT 1 FROM pg_publication_tables
          WHERE pubname = 'supabase_realtime'
            AND schemaname = 'public'
            AND tablename = v_table
        ) THEN
          EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', v_table);
        END IF;
      END IF;
    END LOOP;
  END IF;
END $$;
