import * as React from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getCurrentUserAndProfile } from '@/lib/auth';
import { PrintSheetView } from '@/components/print/print-sheet-view';
import type { PaymentItem } from '@/types/database';

export const metadata = {
  title: 'Payment Approval Form | INDFURN',
  description: 'Physical A4 Printable Payment Approval Form replica.',
};

interface PrintPageProps {
  searchParams: Promise<{
    date?: string;
  }>;
}

export default async function PrintPage({ searchParams }: PrintPageProps) {
  const resolvedParams = await searchParams;
  const selectedDate = resolvedParams?.date || 'ALL';

  const { user, profile } = await getCurrentUserAndProfile();

  if (!user) {
    redirect('/login');
  }

  if (!profile || !profile.is_active) {
    redirect('/login?error=disabled');
  }

  // Strict role check: Only Owner and Accountant can view print approval forms
  if (profile.role !== 'OWNER' && profile.role !== 'ACCOUNTANT') {
    redirect('/login');
  }

  const supabase = await createClient();

  // Build query
  let query = supabase
    .from('payment_items')
    .select(
      '*, vendor:vendors(id, name, gstin), source_bank:company_banks(id, short_name, full_name), creator:profiles!payment_items_created_by_fkey(id, full_name, role), approver:profiles!payment_items_approved_by_fkey(id, full_name, role)'
    )
    .neq('status', 'DRAFT')
    .neq('status', 'CANCELLED');

  if (selectedDate !== 'ALL') {
    query = query.eq('sheet_date', selectedDate);
  }

  query = query
    .order('sheet_date', { ascending: false })
    .order('created_at', { ascending: true });

  const { data: paymentsData, error } = await query;

  if (error) {
    console.error('Error fetching print items:', error);
  }

  const payments = (paymentsData || []) as PaymentItem[];

  return (
    <PrintSheetView
      payments={payments}
      selectedDate={selectedDate}
      userRole={profile.role}
      userName={profile.full_name || 'User'}
    />
  );
}
