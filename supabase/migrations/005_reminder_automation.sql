-- =========================================================================
-- Migration 005: Automatic Due-Day Reminder Alerts & Live Payment Linkage
-- =========================================================================

-- 1. Add 'REMINDER_DUE' to public.notification_event enum idempotently
ALTER TYPE public.notification_event ADD VALUE IF NOT EXISTS 'REMINDER_DUE';

-- 2. Prevent duplicate due-day alerts within the same calendar month (YYYY-MM IST)
ALTER TABLE public.recurring_reminders
  ADD COLUMN IF NOT EXISTS last_notified_month TEXT;

-- 3. Link payment items directly back to a monthly recurring reminder
ALTER TABLE public.payment_items
  ADD COLUMN IF NOT EXISTS recurring_reminder_id UUID
  REFERENCES public.recurring_reminders(id) ON DELETE SET NULL;

-- 4. Index for fast lookup of linked payments per reminder
CREATE INDEX IF NOT EXISTS idx_payment_items_reminder
  ON public.payment_items (recurring_reminder_id)
  WHERE recurring_reminder_id IS NOT NULL;
