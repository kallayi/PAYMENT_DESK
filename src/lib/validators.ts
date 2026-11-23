// ==========================================
// Zod Validation Schemas for INDFURN PayFlow
// Simplified 2-Role Architecture: ACCOUNTANT and OWNER
// ==========================================

import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().trim().min(1, 'Username or Email is required'),
  password: z.string().min(1, 'Password is required'),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const createPaymentSchema = z
  .object({
    sheet_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Valid sheet date (YYYY-MM-DD) is required'),
    due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Valid due date (YYYY-MM-DD) is required'),
    vendor_id: z.string().uuid('Please select a valid vendor'),
    invoice_ref: z.string().trim().min(1, 'Invoice / Ref No is required'),
    purpose: z.string().trim().min(1, 'Purpose is required'),
    amount: z.coerce.number().positive('Amount must be greater than 0'),
    tds: z.coerce.number().min(0, 'TDS cannot be negative').default(0),
    source_bank_id: z.string().uuid('Please select a valid bank'),
    remarks: z.string().trim().optional().nullable(),
    invoice_file_path: z.string().trim().optional().nullable(),
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
  utr_number: z
    .string()
    .trim()
    .min(1, 'UTR / Payment Ref No is required')
    .transform((val) => val.toUpperCase()),
  receipt_file_path: z.string().trim().min(1, 'Bank transaction receipt file is required'),
  remarks: z.string().trim().optional().nullable(),
});

export type MarkPaidInput = z.infer<typeof markPaidSchema>;

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

export const vendorSchema = z.object({
  name: z.string().trim().min(1, 'Vendor name is required'),
  gstin: z.string().trim().toUpperCase().optional().nullable(),
  bank_account_no: z.string().trim().optional().nullable(),
  ifsc_code: z.string().trim().toUpperCase().optional().nullable(),
  notes: z.string().trim().optional().nullable(),
});

export type VendorInput = z.infer<typeof vendorSchema>;

export const companyBankSchema = z.object({
  short_name: z.string().trim().min(1, 'Short label is required'),
  full_name: z.string().trim().min(1, 'Bank full name is required'),
  account_mask: z.string().trim().optional().nullable(),
});

export type CompanyBankInput = z.infer<typeof companyBankSchema>;

export const createUserSchema = z.object({
  full_name: z.string().trim().min(1, 'Full name is required'),
  email: z.string().trim().email('Valid email address is required'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  role: z.enum(['ACCOUNTANT', 'OWNER'], {
    errorMap: () => ({ message: 'Role must be ACCOUNTANT or OWNER' }),
  }),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
