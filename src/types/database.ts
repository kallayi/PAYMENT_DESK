// ==========================================
// Strict Database & Application Types for INDFURN PayFlow
// Simplified 2-Role Architecture: ACCOUNTANT and OWNER
// ==========================================

export type UserRole = 'ACCOUNTANT' | 'OWNER';

export type PaymentStatus =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'ON_HOLD'
  | 'APPROVED'
  | 'PAID'
  | 'REJECTED'
  | 'CANCELLED';

export type Profile = {
  id: string;
  full_name: string;
  role: UserRole;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type Vendor = {
  id: string;
  name: string;
  gstin: string | null;
  bank_account_no: string | null;
  ifsc_code: string | null;
  notes: string | null;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
};

export type CompanyBank = {
  id: string;
  short_name: string;
  full_name: string;
  account_mask: string | null;
  is_active: boolean;
  created_at: string;
};

export type PaymentItem = {
  id: string;
  sheet_date: string;
  vendor_id: string;
  invoice_ref: string;
  due_date: string;
  purpose: string;
  amount: number;
  tds: number;
  net_payable: number;
  source_bank_id: string;
  invoice_file_path: string | null;
  status: PaymentStatus;
  remarks: string | null;
  rejection_reason: string | null;
  utr_number: string | null;
  receipt_file_path: string | null;
  created_by: string;
  submitted_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  paid_by: string | null;
  paid_at: string | null;
  created_at: string;
  updated_at: string;

  // Joined relations
  vendor?: Vendor;
  source_bank?: CompanyBank;
  creator?: Profile;
  approver?: Profile | null;
  payer?: Profile | null;
};

export type AuditLog = {
  id: number;
  table_name: string;
  record_id: string;
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
      profiles: {
        Row: Profile;
        Insert: Partial<Profile> & { id: string; full_name: string; role?: UserRole };
        Update: Partial<Profile>;
        Relationships: [];
      };
      vendors: {
        Row: Vendor;
        Insert: {
          id?: string;
          name: string;
          gstin?: string | null;
          bank_account_no?: string | null;
          ifsc_code?: string | null;
          notes?: string | null;
          is_active?: boolean;
          created_by?: string | null;
          created_at?: string;
        };
        Update: Partial<Omit<Vendor, 'id'>>;
        Relationships: [];
      };
      company_banks: {
        Row: CompanyBank;
        Insert: {
          id?: string;
          short_name: string;
          full_name: string;
          account_mask?: string | null;
          is_active?: boolean;
          created_at?: string;
        };
        Update: Partial<Omit<CompanyBank, 'id'>>;
        Relationships: [];
      };
      payment_items: {
        Row: PaymentItem;
        Insert: {
          id?: string;
          sheet_date: string;
          vendor_id: string;
          invoice_ref: string;
          due_date: string;
          purpose: string;
          amount: number;
          tds?: number;
          source_bank_id: string;
          invoice_file_path?: string | null;
          status?: PaymentStatus;
          remarks?: string | null;
          rejection_reason?: string | null;
          utr_number?: string | null;
          receipt_file_path?: string | null;
          created_by: string;
          submitted_at?: string | null;
          approved_by?: string | null;
          approved_at?: string | null;
          paid_by?: string | null;
          paid_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Omit<PaymentItem, 'id' | 'net_payable'>>;
        Relationships: [];
      };
      audit_logs: {
        Row: AuditLog;
        Insert: {
          id?: number;
          table_name: string;
          record_id: string;
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
    };
    Enums: {
      user_role: UserRole;
      payment_status: PaymentStatus;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};
