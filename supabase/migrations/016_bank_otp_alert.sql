-- Migration 016: Add manual Bank OTP Ready & Released workflow notification events
ALTER TYPE public.notification_event ADD VALUE IF NOT EXISTS 'BANK_OTP_READY';
ALTER TYPE public.notification_event ADD VALUE IF NOT EXISTS 'BANK_OTP_RELEASED';
