// ==========================================
// Zod Validation Schemas for Payment Desk (v2)
// INDFURN & VINMORE Multi-Company Architecture
// ==========================================

import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().trim().min(1, 'Username or Email is required'),
  password: z.string().min(1, 'Password is required'),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const createPaymentSchema = z
  .object({
    company_id: z.string().uuid().optional(),
    sheet_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Valid sheet date (YYYY-MM-DD) is required'),
    due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Valid due date (YYYY-MM-DD) is required'),
    vendor_id: z.string().uuid('Please select a valid vendor'),
    invoice_ref: z
      .string()
      .optional()
      .nullable()
      .transform((val) => {
        const trimmed = (val || '').trim();
        return trimmed.length > 0 ? trimmed : 'NA';
      }),
    purpose: z.string().trim().min(1, 'Purpose is required'),
    payment_type: z.enum(['AGAINST_BILL', 'ON_ACCOUNT']).optional().default('AGAINST_BILL'),
    payment_mode: z.enum(['NEFT_RTGS', 'IMPS', 'CHEQUE']).optional().default('NEFT_RTGS'),
    amount: z.coerce.number().positive('Amount must be greater than 0'),
    tds: z.coerce.number().min(0, 'TDS cannot be negative').default(0),
    source_bank_id: z.string().uuid('Please select a valid bank'),
    remarks: z.string().trim().optional().nullable(),
    invoice_file_path: z.string().trim().optional().nullable(),
    recurring_reminder_id: z.string().uuid().optional().nullable(),
  })
  .refine((data) => data.tds <= data.amount, {
    message: 'TDS cannot exceed Gross Amount',
    path: ['tds'],
  });

export type CreatePaymentInput = z.infer<typeof createPaymentSchema>;

export const updateDraftPaymentSchema = createPaymentSchema.and(
  z.object({
    id: z.string().uuid('Valid payment ID required'),
  })
);

export type UpdateDraftPaymentInput = z.infer<typeof updateDraftPaymentSchema>;

export const markPaidSchema = z.object({
  payment_id: z.string().uuid('Valid payment ID is required'),
  payment_mode: z.enum(['NEFT_RTGS', 'IMPS', 'CHEQUE']).optional().default('NEFT_RTGS'),
  utr_number: z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((val) => (val ? val.toUpperCase() : val)),
  cheque_number: z.string().trim().optional().nullable(),
  cheque_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Valid Cheque Date (YYYY-MM-DD) is required')
    .or(z.literal(''))
    .optional()
    .nullable(),
  receipt_file_path: z.string().trim().optional().nullable(),
  remarks: z.string().trim().optional().nullable(),
});

export type MarkPaidInput = z.infer<typeof markPaidSchema>;

export const settlePaymentBatchItemSchema = z.object({
  payment_id: z.string().uuid('Valid payment ID is required'),
  utr_number: z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((val) => (val ? val.toUpperCase() : val)),
  cheque_number: z.string().trim().optional().nullable(),
  cheque_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Valid Cheque Date (YYYY-MM-DD) is required')
    .or(z.literal(''))
    .optional()
    .nullable(),
});

export const settlePaymentBatchSchema = z.object({
  batch_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Valid Batch Date (YYYY-MM-DD) is required')
    .optional(),
  batch_label: z.string().trim().max(60).optional().nullable(),
  receipt_file_path: z
    .string()
    .trim()
    .min(1, 'Combined Bank Receipt PDF / Image upload is required'),
  notes: z.string().trim().max(500).optional().nullable(),
  items: z
    .array(settlePaymentBatchItemSchema)
    .min(1, 'Select at least one approved payment to settle as a batch'),
});

export type SettlePaymentBatchInput = z.infer<typeof settlePaymentBatchSchema>;

export const rejectPaymentSchema = z.object({
  payment_id: z.string().uuid('Valid payment ID is required'),
  rejection_reason: z.string().trim().min(1, 'Rejection reason is required'),
});

export type RejectPaymentInput = z.infer<typeof rejectPaymentSchema>;

export const switchBankSchema = z.object({
  payment_id: z.string().uuid('Valid payment ID is required'),
  new_bank_id: z.string().uuid('Valid bank ID is required'),
});

export type SwitchBankInput = z.infer<typeof switchBankSchema>;

// Strict 5-Field Lean Vendor Schema (+ Optional WhatsApp Number) for UI Form
export const leanVendorSchema = z.object({
  party_name: z.string().trim().min(1, 'Party Name is required'),
  beneficiary_name: z.string().trim().min(1, 'Beneficiary Name (Bank Account Holder) is required'),
  account_number: z.string().trim().min(1, 'Account number is required'),
  ifsc_code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'IFSC code must be 11 uppercase characters (e.g. UTIB0001462)'),
  whatsapp_number: z
    .string()
    .trim()
    .refine(
      (val) => !val || /^\+?[0-9\s-]{10,16}$/.test(val),
      'Enter a valid 10-digit mobile or WhatsApp number (with optional +91)'
    )
    .optional()
    .nullable(),
  remarks: z.string().trim().optional().nullable(),
});

export type LeanVendorInput = z.infer<typeof leanVendorSchema>;

// General Vendor Input Schema (supports both lean form and quick-add)
export const vendorSchema = z.object({
  company_id: z.string().uuid().optional(),
  party_name: z.string().trim().min(1, 'Party Name is required').optional(),
  beneficiary_name: z.string().trim().min(1, 'Beneficiary Name is required').optional(),
  account_number: z.string().trim().min(1, 'Account number is required').optional(),
  ifsc_code: z.string().trim().toUpperCase().optional().nullable(),
  whatsapp_number: z.string().trim().optional().nullable(),
  remarks: z.string().trim().optional().nullable(),
  // Backward compatibility aliases
  name: z.string().trim().optional(),
  notes: z.string().trim().optional().nullable(),
  gstin: z.string().trim().optional().nullable(),
  bank_account_no: z.string().trim().optional().nullable(),
});

export type VendorInput = z.infer<typeof vendorSchema>;

// Company Bank Schema
export const companyBankSchema = z.object({
  company_id: z.string().uuid().optional(),
  bank_name: z.string().trim().min(1, 'Bank name is required').optional(),
  short_code: z.string().trim().min(1, 'Short code is required (e.g. AXIS)').optional(),
  ifsc_prefix: z
    .string()
    .trim()
    .toUpperCase()
    .optional(),
  account_number_masked: z.string().trim().optional().nullable(),
  full_debit_account_number: z.string().trim().optional().nullable(),
  available_balance: z.coerce.number().optional().default(0),
  is_primary: z.boolean().optional().default(false),
  is_active: z.boolean().optional().default(true),
  // Backward compatibility
  short_name: z.string().trim().optional(),
  full_name: z.string().trim().optional(),
  account_mask: z.string().trim().optional().nullable(),
});

export type CompanyBankInput = z.infer<typeof companyBankSchema>;

// User Management Schemas
export const createUserSchema = z.object({
  full_name: z.string().trim().min(1, 'Full name is required'),
  email: z.string().trim().email('Valid email address is required'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  role: z.enum(['PREPARER', 'VERIFIER', 'APPROVER', 'AUDITOR'] as const, {
    errorMap: () => ({ message: 'Role must be PREPARER, VERIFIER, APPROVER, or AUDITOR' }),
  }),
  company_ids: z.array(z.string().uuid()).min(1, 'At least one company workspace must be assigned'),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z.object({
  user_id: z.string().uuid('Valid user ID required'),
  full_name: z.string().trim().min(1, 'Full name is required'),
  role: z.enum(['PREPARER', 'VERIFIER', 'APPROVER', 'AUDITOR'] as const, {
    errorMap: () => ({ message: 'Role must be PREPARER, VERIFIER, APPROVER, or AUDITOR' }),
  }),
  is_active: z.boolean().default(true),
  company_ids: z.array(z.string().uuid()).min(1, 'At least one company workspace must be assigned'),
});

export type UpdateUserInput = z.infer<typeof updateUserSchema>;

// Recurring Reminder Schema
export const recurringReminderSchema = z.object({
  company_id: z.string().uuid().optional(),
  title: z.string().trim().min(1, 'Title is required'),
  due_day_of_month: z.coerce
    .number()
    .int('Day must be an integer')
    .min(1, 'Day must be between 1 and 31')
    .max(31, 'Day must be between 1 and 31'),
  estimated_amount: z.coerce.number().min(0, 'Estimated amount cannot be negative').optional().nullable(),
  vendor_id: z.string().uuid().optional().nullable(),
  remarks: z.string().trim().optional().nullable(),
  is_active: z.boolean().optional().default(true),
});

export type RecurringReminderInput = z.infer<typeof recurringReminderSchema>;

// Company Profile & Slip Details Schema
export const companyProfileSchema = z.object({
  companyId: z.string().uuid('Valid company ID is required'),
  name: z
    .string()
    .trim()
    .min(2, 'Display / Signature Name must be at least 2 characters')
    .max(80, 'Display / Signature Name must be 80 characters or fewer'),
  contact_email: z
    .string()
    .trim()
    .refine(
      (val) => !val || z.string().email().safeParse(val).success,
      'Please enter a valid contact email address'
    ),
  contact_phone: z
    .string()
    .trim()
    .max(30, 'Contact phone must be 30 characters or fewer'),
});

export type CompanyProfileInput = z.infer<typeof companyProfileSchema>;
