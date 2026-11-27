// ==========================================
// Strict Database & Application Types for Payment Desk (v2)
// INDFURN & VINMORE Multi-Company Architecture
// ==========================================

export type UserRole = 'PREPARER' | 'VERIFIER' | 'APPROVER' | 'AUDITOR';

export type PaymentStatus =
  | 'DRAFT'
  | 'PENDING_VERIFICATION'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'PAID'
  | 'ON_HOLD'
  | 'REJECTED'
  | 'CANCELLED';

export type PaymentMode = 'NEFT_RTGS' | 'IMPS' | 'CHEQUE';

export type DisbursementMode = PaymentMode;

export type PaymentType = 'AGAINST_BILL' | 'ON_ACCOUNT';

export type NotificationEvent =
  | 'SUBMITTED_FOR_VERIFICATION'
  | 'VERIFIED_FOR_APPROVAL'
  | 'APPROVED'
  | 'HELD'
  | 'REJECTED'
  | 'REMINDER_DUE'
  | 'PAYMENT_REQUEST_CREATED'
  | 'PAYMENT_REQUEST_SUBMITTED'
  | 'PAYMENT_REQUEST_DECLINED'
  | 'BATCH_SETTLED';

export type AuditStatus = 'PENDING' | 'AUDITED' | 'FLAGGED';

export type PaymentRequestStatus = 'PENDING' | 'SUBMITTED' | 'DECLINED' | 'CANCELLED';

export type Company = {
  id: string;
  code: 'INDFURN' | 'VINMORE' | string;
  name: string;
  contact_email?: string | null;
  contact_phone?: string | null;
  is_active: boolean;
  created_at: string;
};

export type Profile = {
  id: string;
  full_name: string;
  role: UserRole;
  is_admin: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type UserCompanyAccess = {
  user_id: string;
  company_id: string;
  created_at: string;

  // Joined relations
  company?: Company;
  profile?: Profile;
};

export type CompanyBank = {
  id: string;
  short_name: string;
  full_name: string;
  company_id?: string;
  bank_name?: string;
  short_code?: string;
  ifsc_prefix?: string;
  account_number_masked?: string | null;
  account_mask?: string | null;
  full_debit_account_number?: string | null;
  available_balance?: number;
  balance_updated_at?: string | null;
  balance_updated_by?: string | null;
  balance_updater?: Profile | null;
  is_primary?: boolean;
  is_active: boolean;
  created_at: string;
  updated_at?: string;
};

export type Vendor = {
  id: string;
  name: string;
  company_id?: string;
  party_name?: string;
  beneficiary_name?: string;
  account_number?: string;
  ifsc_code?: string | null;
  whatsapp_number?: string | null;
  remarks?: string | null;
  notes?: string | null;
  gstin?: string | null;
  bank_account_no?: string | null;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at?: string;
};

export type PaymentItem = {
  id: string;
  company_id?: string;
  sheet_date: string;
  vendor_id: string;
  source_bank_id: string;
  invoice_ref: string;
  due_date: string;
  purpose: string;
  payment_type?: PaymentType;
  payment_mode?: PaymentMode;
  amount: number;
  tds: number;
  net_payable: number;
  remarks: string | null;
  invoice_file_path: string | null;
  status: PaymentStatus;
  rejection_reason: string | null;
  utr_number: string | null;
  cheque_number?: string | null;
  cheque_date?: string | null;
  receipt_file_path: string | null;
  created_by: string;
  submitted_at: string | null;
  verified_by?: string | null;
  verified_at?: string | null;
  approved_by: string | null;
  approved_at: string | null;
  paid_by: string | null;
  paid_at: string | null;
  audited_by?: string | null;
  audited_at?: string | null;
  audit_status?: AuditStatus;
  audit_note?: string | null;
  batch_id?: string | null;
  receipt_sent_at?: string | null;
  receipt_sent_by?: string | null;
  recurring_reminder_id?: string | null;
  created_at: string;
  updated_at: string;

  // Joined relations
  vendor?: Vendor;
  source_bank?: CompanyBank;
  creator?: Profile;
  verifier?: Profile | null;
  approver?: Profile | null;
  payer?: Profile | null;
  auditor?: Profile | null;
  company?: Company;
  batch?: PaymentBatch | null;
};

export type PaymentBatch = {
  id: string;
  company_id: string;
  batch_code: string;
  batch_date: string;
  source_bank_id: string | null;
  receipt_file_path: string;
  item_count: number;
  total_amount: number;
  notes: string | null;
  audit_status?: AuditStatus;
  audit_note?: string | null;
  created_by: string;
  audited_at: string | null;
  audited_by: string | null;
  created_at: string;
  updated_at: string;

  // Joined relations
  source_bank?: CompanyBank | null;
  creator?: Profile | null;
  auditor?: Profile | null;
};

export type Notification = {
  id: string;
  company_id: string;
  recipient_user_id: string;
  payment_item_id: string | null;
  payment_request_id?: string | null;
  action_url?: string | null;
  event_type: NotificationEvent;
  title: string;
  body: string;
  is_read: boolean;
  created_at: string;

  // Joined relations
  payment_item?: PaymentItem | null;
};

export type PaymentRequest = {
  id: string;
  company_id: string;
  vendor_id: string | null;
  unlisted_vendor_name: string | null;
  gross_amount: number;
  invoice_ref: string | null;
  purpose: string;
  due_date: string | null;
  remarks: string | null;
  bill_file_path: string | null;
  status: PaymentRequestStatus;
  requested_by: string;
  requested_role: string;
  processed_by: string | null;
  processed_at: string | null;
  decline_reason: string | null;
  converted_payment_id: string | null;
  created_at: string;
  updated_at: string;

  // Joined relations
  vendor?: Vendor | null;
  requester?: Profile | null;
  processor?: Profile | null;
};

export type PushSubscription = {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  created_at: string;
};

export type RecurringReminder = {
  id: string;
  company_id: string;
  title: string;
  due_day_of_month: number;
  estimated_amount: number | null;
  vendor_id: string | null;
  remarks: string | null;
  last_completed_month: string | null;
  last_notified_month?: string | null;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;

  // Joined relations
  vendor?: Vendor | null;
};

export type ReminderLinkedPayment = {
  id: string;
  recurring_reminder_id: string | null;
  status: PaymentStatus;
  net_payable: number;
  utr_number: string | null;
  cheque_number?: string | null;
  paid_at: string | null;
  rejection_reason: string | null;
  updated_at: string;
};

export type PaymentPurpose = {
  id: string;
  company_id: string;
  label: string;
  created_by: string | null;
  created_at: string;
};

export type AuditLog = {
  id: number;
  table_name: string;
  record_id: string;
  company_id?: string | null;
  payment_item_id?: string | null;
  action: string;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  changed_by: string | null;
  created_at: string;

  // Joined relations
  performer?: Profile | null;
};

// Server Action standard return type
export type ActionResult<T = undefined> =
  | { success: true; data: T }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

// Supabase Database generic definition matching postgrest-js GenericSchema
export type Database = {
  public: {
    Tables: {
      companies: {
        Row: Company;
        Insert: Partial<Company> & { code: string; name: string };
        Update: Partial<Company>;
        Relationships: [];
      };
      profiles: {
        Row: Profile;
        Insert: Partial<Profile> & { id: string; full_name: string; role?: UserRole; is_admin?: boolean };
        Update: Partial<Profile>;
        Relationships: [];
      };
      user_company_access: {
        Row: UserCompanyAccess;
        Insert: { user_id: string; company_id: string; created_at?: string };
        Update: Partial<UserCompanyAccess>;
        Relationships: [];
      };
      vendors: {
        Row: Vendor;
        Insert: {
          id?: string;
          name?: string;
          company_id?: string;
          party_name?: string;
          beneficiary_name?: string;
          account_number?: string;
          ifsc_code?: string | null;
          whatsapp_number?: string | null;
          remarks?: string | null;
          notes?: string | null;
          gstin?: string | null;
          bank_account_no?: string | null;
          is_active?: boolean;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Omit<Vendor, 'id'>>;
        Relationships: [];
      };
      company_banks: {
        Row: CompanyBank;
        Insert: {
          id?: string;
          short_name?: string;
          full_name?: string;
          company_id?: string;
          bank_name?: string;
          short_code?: string;
          ifsc_prefix?: string;
          account_number_masked?: string | null;
          account_mask?: string | null;
          full_debit_account_number?: string | null;
          available_balance?: number;
          balance_updated_at?: string | null;
          balance_updated_by?: string | null;
          is_primary?: boolean;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Omit<CompanyBank, 'id'>>;
        Relationships: [];
      };
      payment_items: {
        Row: PaymentItem;
        Insert: {
          id?: string;
          company_id?: string;
          sheet_date?: string;
          vendor_id: string;
          source_bank_id: string;
          invoice_ref: string;
          due_date: string;
          purpose: string;
          payment_type?: PaymentType;
          payment_mode?: PaymentMode;
          amount: number;
          tds?: number;
          invoice_file_path?: string | null;
          status?: PaymentStatus;
          remarks?: string | null;
          rejection_reason?: string | null;
          utr_number?: string | null;
          cheque_number?: string | null;
          cheque_date?: string | null;
          receipt_file_path?: string | null;
          created_by: string;
          submitted_at?: string | null;
          verified_by?: string | null;
          verified_at?: string | null;
          approved_by?: string | null;
          approved_at?: string | null;
          paid_by?: string | null;
          paid_at?: string | null;
          audited_by?: string | null;
          audited_at?: string | null;
          audit_status?: AuditStatus;
          audit_note?: string | null;
          batch_id?: string | null;
          receipt_sent_at?: string | null;
          receipt_sent_by?: string | null;
          recurring_reminder_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Omit<PaymentItem, 'id' | 'net_payable'>>;
        Relationships: [];
      };
      payment_batches: {
        Row: PaymentBatch;
        Insert: {
          id?: string;
          company_id: string;
          batch_code: string;
          batch_date?: string;
          source_bank_id?: string | null;
          receipt_file_path: string;
          item_count: number;
          total_amount: number;
          notes?: string | null;
          audit_status?: AuditStatus;
          audit_note?: string | null;
          created_by: string;
          audited_at?: string | null;
          audited_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Omit<PaymentBatch, 'id'>>;
        Relationships: [];
      };
      notifications: {
        Row: Notification;
        Insert: {
          id?: string;
          company_id: string;
          recipient_user_id: string;
          payment_item_id?: string | null;
          payment_request_id?: string | null;
          action_url?: string | null;
          event_type: NotificationEvent;
          title: string;
          body: string;
          is_read?: boolean;
          created_at?: string;
        };
        Update: Partial<Omit<Notification, 'id'>>;
        Relationships: [];
      };
      payment_requests: {
        Row: PaymentRequest;
        Insert: {
          id?: string;
          company_id: string;
          vendor_id?: string | null;
          unlisted_vendor_name?: string | null;
          gross_amount: number;
          invoice_ref?: string | null;
          purpose: string;
          due_date?: string | null;
          remarks?: string | null;
          bill_file_path?: string | null;
          status?: PaymentRequestStatus;
          requested_by: string;
          requested_role: string;
          processed_by?: string | null;
          processed_at?: string | null;
          decline_reason?: string | null;
          converted_payment_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Omit<PaymentRequest, 'id'>>;
        Relationships: [];
      };
      push_subscriptions: {
        Row: PushSubscription;
        Insert: {
          id?: string;
          user_id: string;
          endpoint: string;
          p256dh: string;
          auth: string;
          created_at?: string;
        };
        Update: Partial<Omit<PushSubscription, 'id'>>;
        Relationships: [];
      };
      recurring_reminders: {
        Row: RecurringReminder;
        Insert: {
          id?: string;
          company_id: string;
          title: string;
          due_day_of_month: number;
          estimated_amount?: number | null;
          vendor_id?: string | null;
          remarks?: string | null;
          last_completed_month?: string | null;
          last_notified_month?: string | null;
          is_active?: boolean;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Omit<RecurringReminder, 'id'>>;
        Relationships: [];
      };
      payment_purposes: {
        Row: PaymentPurpose;
        Insert: {
          id?: string;
          company_id: string;
          label: string;
          created_by?: string | null;
          created_at?: string;
        };
        Update: Partial<Omit<PaymentPurpose, 'id'>>;
        Relationships: [];
      };
      audit_logs: {
        Row: AuditLog;
        Insert: {
          id?: number;
          table_name: string;
          record_id: string;
          company_id?: string | null;
          payment_item_id?: string | null;
          action: string;
          old_data?: Record<string, unknown> | null;
          new_data?: Record<string, unknown> | null;
          changed_by?: string | null;
          created_at?: string;
        };
        Update: Partial<Omit<AuditLog, 'id'>>;
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      get_my_role: {
        Args: Record<string, never>;
        Returns: UserRole;
      };
      is_admin_user: {
        Args: Record<string, never>;
        Returns: boolean;
      };
      has_company_access: {
        Args: { p_company_id: string };
        Returns: boolean;
      };
    };
    Enums: {
      user_role: UserRole;
      payment_status: PaymentStatus;
      payment_mode: PaymentMode;
      payment_type: PaymentType;
      notification_event: NotificationEvent;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};
