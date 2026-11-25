/**
 * Safe CSV Generation and Export utility for Payment Desk (v2)
 * Strictly prevents CSV Formula Injection (CWE-1236) by neutralizing formula prefixes.
 */

import type { PaymentItem } from '@/types/database';

/**
 * Sanitize a string cell to prevent spreadsheet formula injection.
 * If a value starts with `=`, `+`, `-`, `@`, `\t`, or `\r`, prepend with a single quote `'`.
 */
export function sanitizeCSVCell(value: unknown): string {
  if (value === null || value === undefined) {
    return '""';
  }

  let str = String(value);

  // Check for dangerous formula injection trigger characters
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }

  // Escape internal double quotes by doubling them
  const escaped = str.replace(/"/g, '""');
  return `"${escaped}"`;
}

/**
 * Generate standard CSV string from payment records.
 */
export function generatePaymentsCSV(items: PaymentItem[]): string {
  const headers = [
    'Sl No',
    'Sheet Date',
    'Due Date',
    'Party Name',
    'Beneficiary Name',
    'Account Number',
    'IFSC Code',
    'Invoice / Ref No',
    'Purpose',
    'Payment Type',
    'Payment Mode',
    'Gross Amount (INR)',
    'TDS (INR)',
    'Net Payable (INR)',
    'Bank',
    'Status',
    'UTR / Cheque Ref',
    'Audit Status',
    'Audited At',
    'Remarks',
  ];

  const rows = items.map((item, index) => {
    const partyName = item.vendor?.party_name || item.vendor?.name || 'Unknown Party';
    const beneficiaryName = item.vendor?.beneficiary_name || partyName;
    const refNo =
      item.payment_mode === 'CHEQUE' && item.cheque_number
        ? `CHQ #${item.cheque_number}${item.cheque_date ? ` (${item.cheque_date})` : ''}`
        : item.utr_number || '';
    const auditStatus =
      item.status === 'PAID'
        ? item.audited_at
          ? 'Audited'
          : 'Unaudited'
        : '—';

    return [
      sanitizeCSVCell(index + 1),
      sanitizeCSVCell(item.sheet_date),
      sanitizeCSVCell(item.due_date),
      sanitizeCSVCell(partyName),
      sanitizeCSVCell(beneficiaryName),
      sanitizeCSVCell(item.vendor?.account_number || ''),
      sanitizeCSVCell(item.vendor?.ifsc_code || ''),
      sanitizeCSVCell(item.invoice_ref),
      sanitizeCSVCell(item.purpose),
      sanitizeCSVCell(item.payment_type === 'ON_ACCOUNT' ? 'On Account' : 'Against Bill'),
      sanitizeCSVCell(item.payment_mode === 'CHEQUE' ? 'Cheque' : 'NEFT/RTGS'),
      sanitizeCSVCell(Number(item.amount || 0).toFixed(2)),
      sanitizeCSVCell(Number(item.tds || 0) > 0 ? Number(item.tds).toFixed(2) : 'NA'),
      sanitizeCSVCell(Number(item.net_payable || 0).toFixed(2)),
      sanitizeCSVCell(item.source_bank?.short_code || item.source_bank?.short_name || 'Bank'),
      sanitizeCSVCell(item.status),
      sanitizeCSVCell(refNo),
      sanitizeCSVCell(auditStatus),
      sanitizeCSVCell(item.audited_at || ''),
      sanitizeCSVCell(item.remarks || ''),
    ].join(',');
  });

  return [headers.map(sanitizeCSVCell).join(','), ...rows].join('\r\n');
}

/**
 * Trigger client-side file download for generated CSV string.
 */
export function downloadCSV(filename: string, csvContent: string): void {
  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename.endsWith('.csv') ? filename : `${filename}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
