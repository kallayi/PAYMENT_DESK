-- =========================================================================
-- Payment Desk (v2) — Enhancement Migration 004
-- Adds Vendor optional WhatsApp number, Company contact details for Payment
-- Acknowledgement slips, and optional full Debit Account Number on banks.
-- Idempotent & safe to run repeatedly in Supabase SQL Editor.
-- =========================================================================

-- 1. Optional Vendor WhatsApp Number (never mandatory)
ALTER TABLE public.vendors
  ADD COLUMN IF NOT EXISTS whatsapp_number TEXT;

-- 2. Company Contact Email & Phone for Payment Acknowledgement footer
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS contact_email TEXT;

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS contact_phone TEXT;

-- Seed INDFURN official contact details
UPDATE public.companies
SET
  contact_email = COALESCE(NULLIF(BTRIM(contact_email), ''), 'info@indfurn.in'),
  contact_phone = COALESCE(NULLIF(BTRIM(contact_phone), ''), '9539 661 661')
WHERE code = 'INDFURN';

-- 3. Optional Full Corporate Debit Account Number for Axis Neo Bulk Excel
ALTER TABLE public.company_banks
  ADD COLUMN IF NOT EXISTS full_debit_account_number TEXT;
