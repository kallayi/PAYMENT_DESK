import * as React from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getCurrentUserContext } from '@/lib/auth';
import { PrintSheetView } from '@/components/print/print-sheet-view';
import type { PaymentItem, PaymentStatus } from '@/types/database';

const VALID_PAYMENT_STATUSES: PaymentStatus[] = [
  'DRAFT',
  'PENDING_VERIFICATION',
  'PENDING_APPROVAL',
  'APPROVED',
  'PAID',
  'ON_HOLD',
  'REJECTED',
  'CANCELLED',
];

export const metadata = {
  title: 'Payment Approval & Disbursement Voucher | Payment Desk',
  description: 'Printable A4 PDF Payment Approval & Disbursement Voucher.',
};

interface PrintPageProps {
  searchParams: Promise<{
    date?: string;
    from?: string;
    to?: string;
    status?: string;
    bank?: string;
    audit?: string;
    q?: string;
  }>;
}

export default async function PrintPage({ searchParams }: PrintPageProps) {
  const resolvedParams = await searchParams;
  const selectedDate = resolvedParams?.date || 'ALL';
  const dateFrom = resolvedParams?.from || '';
  const dateTo = resolvedParams?.to || '';
  const statusFilter = resolvedParams?.status || 'ALL';
  const bankFilter = resolvedParams?.bank || 'ALL';
  const auditFilter = resolvedParams?.audit || 'ALL';
  const searchQuery = (resolvedParams?.q || '').trim().toLowerCase();

  const { user, profile, activeCompany } = await getCurrentUserContext();

  if (!user) {
    redirect('/login');
  }

  if (!profile || !profile.is_active) {
    redirect('/login?error=disabled');
  }

  const supabase = await createClient();

  let query = supabase
    .from('payment_items')
    .select(
      '*, vendor:vendors(*), source_bank:company_banks(*), creator:profiles!created_by(id, full_name, role), verifier:profiles!verified_by(id, full_name, role), approver:profiles!approved_by(id, full_name, role), payer:profiles!paid_by(id, full_name, role), auditor:profiles!audited_by(id, full_name, role)'
    );

  if (activeCompany) {
    query = query.eq('company_id', activeCompany.id);
  }

  if (statusFilter !== 'ALL' && VALID_PAYMENT_STATUSES.includes(statusFilter as PaymentStatus)) {
    query = query.eq('status', statusFilter as PaymentStatus);
  } else {
    query = query.neq('status', 'DRAFT').neq('status', 'CANCELLED');
  }

  if (selectedDate !== 'ALL') {
    query = query.eq('sheet_date', selectedDate);
  }
  if (dateFrom) {
    query = query.gte('sheet_date', dateFrom);
  }
  if (dateTo) {
    query = query.lte('sheet_date', dateTo);
  }
  if (bankFilter !== 'ALL') {
    query = query.eq('source_bank_id', bankFilter);
  }
  if (auditFilter === 'AUDITED') {
    query = query.eq('status', 'PAID').not('audited_at', 'is', null);
  } else if (auditFilter === 'UNAUDITED') {
    query = query.eq('status', 'PAID').is('audited_at', null);
  }

  query = query
    .order('sheet_date', { ascending: false })
    .order('created_at', { ascending: true });

  const { data: paymentsData, error } = await query;

  if (error) {
    console.error('Error fetching print items:', error);
  }

  const canSeeFullDebitAc = profile.role === 'PREPARER' || profile.is_admin;
  let payments = ((paymentsData || []) as PaymentItem[]).map((p) =>
    canSeeFullDebitAc || !p.source_bank
      ? p
      : {
        ...p,
        source_bank: {
          ...p.source_bank,
          full_debit_account_number: null,
        },
      }
  );

  if (searchQuery) {
    payments = payments.filter((p) => {
      const party = (p.vendor?.party_name || p.vendor?.name || '').toLowerCase();
      const ben = (p.vendor?.beneficiary_name || '').toLowerCase();
      const ref = (p.invoice_ref || '').toLowerCase();
      const purpose = (p.purpose || '').toLowerCase();
      const utr = (p.utr_number || '').toLowerCase();
      const chq = (p.cheque_number || '').toLowerCase();
      return (
        party.includes(searchQuery) ||
        ben.includes(searchQuery) ||
        ref.includes(searchQuery) ||
        purpose.includes(searchQuery) ||
        utr.includes(searchQuery) ||
        chq.includes(searchQuery)
      );
    });
  }

  // Build readable filter summary
  const summaryParts: string[] = [];
  if (selectedDate !== 'ALL') summaryParts.push(`Sheet Date: ${selectedDate}`);
  else if (dateFrom || dateTo) summaryParts.push(`Range: ${dateFrom || '...'} to ${dateTo || '...'}`);
  else summaryParts.push('All Dates');

  if (statusFilter !== 'ALL') summaryParts.push(`Status: ${statusFilter}`);
  if (auditFilter !== 'ALL') summaryParts.push(`Audit: ${auditFilter}`);
  if (searchQuery) summaryParts.push(`Query: "${resolvedParams?.q}"`);

  return (
    <PrintSheetView
      payments={payments}
      companyCode={activeCompany?.code || 'INDFURN'}
      companyName={activeCompany?.name || 'INDFURN'}
      filterSummary={summaryParts.join(' · ')}
    />
  );
}
