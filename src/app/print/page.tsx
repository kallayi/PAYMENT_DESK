import * as React from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getCurrentUserContext } from '@/lib/auth';
import { PrintSheetView } from '@/components/print/print-sheet-view';
import { formatHumanDate } from '@/lib/format';
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

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const MONTHS_FULL = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function toISTDateIso(value: string | null | undefined): string {
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const ms = new Date(value).getTime();
  if (isNaN(ms)) return value.slice(0, 10);
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
}

function formatFullMonthLabel(monthKey: string): string {
  const [yStr, mStr] = monthKey.split('-');
  const mIdx = parseInt(mStr, 10) - 1;
  return `${MONTHS_FULL[mIdx] || mStr} ${yStr}`;
}

export const metadata = {
  title: 'Settled Payment Report & Voucher | Payment Desk',
  description: 'Printable A4 PDF Payment Approval & Settled History Report.',
};

interface PrintPageProps {
  searchParams: Promise<{
    view?: string;
    date?: string;
    month?: string;
    from?: string;
    to?: string;
    status?: string;
    bank?: string;
    bankId?: string;
    vendorId?: string;
    mode?: string;
    audit?: string;
    q?: string;
  }>;
}

export default async function PrintPage({ searchParams }: PrintPageProps) {
  const resolvedParams = await searchParams;
  const viewMode = (resolvedParams?.view || '').trim().toLowerCase();
  const isHistoryMode = viewMode === 'history';

  const selectedDate = resolvedParams?.date || 'ALL';
  const monthFilter = (resolvedParams?.month || '').trim();
  const dateFrom = (resolvedParams?.from || '').trim();
  const dateTo = (resolvedParams?.to || '').trim();
  const statusFilter = resolvedParams?.status || 'ALL';
  const bankFilter = resolvedParams?.bankId || resolvedParams?.bank || 'ALL';
  const vendorFilter = resolvedParams?.vendorId || 'ALL';
  const modeFilter = resolvedParams?.mode || 'ALL';
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

  if (isHistoryMode) {
    // STRICT HISTORY MODE: ONLY PAID rows enter evaluation (never Draft, Pending, On Hold, Approved, or Rejected)
    query = query.eq('status', 'PAID');
  } else {
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
    if (auditFilter === 'AUDITED') {
      query = query.eq('status', 'PAID').not('audited_at', 'is', null);
    } else if (auditFilter === 'UNAUDITED') {
      query = query.eq('status', 'PAID').is('audited_at', null);
    }
  }

  if (bankFilter !== 'ALL') {
    query = query.eq('source_bank_id', bankFilter);
  }
  if (vendorFilter !== 'ALL') {
    query = query.eq('vendor_id', vendorFilter);
  }
  if (modeFilter === 'NEFT_RTGS' || modeFilter === 'IMPS' || modeFilter === 'CHEQUE') {
    query = query.eq('payment_mode', modeFilter);
  }

  query = isHistoryMode
    ? query
      .order('paid_at', { ascending: false, nullsFirst: false })
      .order('updated_at', { ascending: false })
    : query
      .order('sheet_date', { ascending: false })
      .order('created_at', { ascending: true });

  const [paymentsRes, vendorNameRes, bankNameRes] = await Promise.all([
    query,
    vendorFilter !== 'ALL' && activeCompany
      ? supabase
        .from('vendors')
        .select('party_name, name')
        .eq('id', vendorFilter)
        .eq('company_id', activeCompany.id)
        .maybeSingle()
      : Promise.resolve({ data: null }),
    bankFilter !== 'ALL' && activeCompany
      ? supabase
        .from('company_banks')
        .select('short_code, short_name, bank_name')
        .eq('id', bankFilter)
        .eq('company_id', activeCompany.id)
        .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  if (paymentsRes.error) {
    console.error('Error fetching print items:', paymentsRes.error);
  }

  const canSeeFullDebitAc = profile.role === 'PREPARER' || profile.is_admin;
  let payments = ((paymentsRes.data || []) as PaymentItem[]).map((p) =>
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

  // Filter by IST paid_at date/month in History mode (or optional month filter in standard mode)
  if (isHistoryMode) {
    if (dateFrom || dateTo) {
      payments = payments.filter((p) => {
        const paidIsoIST = toISTDateIso(p.paid_at || p.updated_at || p.sheet_date);
        if (dateFrom && paidIsoIST < dateFrom) return false;
        if (dateTo && paidIsoIST > dateTo) return false;
        return true;
      });
    } else if (monthFilter && monthFilter !== 'all' && /^\d{4}-\d{2}$/.test(monthFilter)) {
      payments = payments.filter((p) => {
        const paidIsoIST = toISTDateIso(p.paid_at || p.updated_at || p.sheet_date);
        return paidIsoIST.startsWith(monthFilter);
      });
    }
  } else if (
    monthFilter &&
    monthFilter !== 'all' &&
    /^\d{4}-\d{2}$/.test(monthFilter) &&
    selectedDate === 'ALL' &&
    !dateFrom &&
    !dateTo
  ) {
    payments = payments.filter((p) => {
      const refIso = toISTDateIso(p.paid_at || p.updated_at || p.sheet_date);
      return refIso.startsWith(monthFilter);
    });
  }

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

  let excludedPendingReceiptCount = 0;

  if (isHistoryMode) {
    const totalMatchingPaid = payments.length;
    payments = payments.filter((p) => {
      const hasSettlementRef = Boolean((p.utr_number || p.cheque_number || '').trim());
      const hasReceiptSent = Boolean(p.receipt_sent_at);
      return p.status === 'PAID' && hasSettlementRef && hasReceiptSent;
    });
    excludedPendingReceiptCount = Math.max(0, totalMatchingPaid - payments.length);
  }

  // Build readable Period & Filter summaries
  let periodSubtitle = 'All Settled History';
  if (isHistoryMode) {
    if (dateFrom && dateTo && dateFrom === dateTo) {
      periodSubtitle = `Date: ${formatHumanDate(dateFrom)}`;
    } else if (dateFrom || dateTo) {
      periodSubtitle = `Period: ${dateFrom ? formatHumanDate(dateFrom) : 'Start'} – ${dateTo ? formatHumanDate(dateTo) : 'Present'}`;
    } else if (monthFilter && monthFilter !== 'all' && /^\d{4}-\d{2}$/.test(monthFilter)) {
      periodSubtitle = `Period: ${formatFullMonthLabel(monthFilter)}`;
    } else {
      periodSubtitle = 'All Settled History';
    }
  } else {
    const summaryParts: string[] = [];
    if (selectedDate !== 'ALL') summaryParts.push(`Sheet Date: ${selectedDate}`);
    else if (dateFrom || dateTo) summaryParts.push(`Range: ${dateFrom || '...'} to ${dateTo || '...'}`);
    else if (monthFilter && monthFilter !== 'all') summaryParts.push(`Month: ${monthFilter}`);
    else summaryParts.push('All Dates');

    if (statusFilter !== 'ALL') summaryParts.push(`Status: ${statusFilter}`);
    if (auditFilter !== 'ALL') summaryParts.push(`Audit: ${auditFilter}`);
    if (searchQuery) summaryParts.push(`Query: "${resolvedParams?.q}"`);
    periodSubtitle = summaryParts.join(' · ');
  }

  const activeFilters: string[] = [];
  if (vendorNameRes.data) {
    activeFilters.push(`Vendor: ${vendorNameRes.data.party_name || vendorNameRes.data.name}`);
  }
  if (bankNameRes.data) {
    activeFilters.push(
      `Bank: ${bankNameRes.data.short_code || bankNameRes.data.short_name || bankNameRes.data.bank_name}`
    );
  }
  if (modeFilter === 'NEFT_RTGS') activeFilters.push('Mode: NEFT / RTGS');
  else if (modeFilter === 'IMPS') activeFilters.push('Mode: IMPS');
  else if (modeFilter === 'CHEQUE') activeFilters.push('Mode: Cheque');
  if (isHistoryMode && searchQuery) {
    activeFilters.push(`Search: "${resolvedParams?.q}"`);
  }

  return (
    <PrintSheetView
      payments={payments}
      printMode={isHistoryMode ? 'history' : 'voucher'}
      companyCode={activeCompany?.code || 'INDFURN'}
      companyName={activeCompany?.name || 'INDFURN'}
      contactEmail={activeCompany?.contact_email || null}
      contactPhone={activeCompany?.contact_phone || null}
      filterSummary={periodSubtitle}
      extraFilterLabel={activeFilters.join(' · ') || null}
      printedByName={profile.full_name || 'Authorized User'}
      excludedPendingReceiptCount={excludedPendingReceiptCount}
    />
  );
}
