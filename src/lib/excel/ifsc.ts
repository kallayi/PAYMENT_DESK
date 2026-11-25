import type { BulkExportRow, IfscSplitResult } from '@/lib/excel/types';

/**
 * Extract the 4-character uppercase bank identifier prefix from an Indian IFSC code.
 * Example: 'UTIB0001462' -> 'UTIB', 'SIBL0000123' -> 'SIBL'
 */
export function extractIfscPrefix(ifscCode: string | null | undefined): string {
  return (ifscCode || '').trim().toUpperCase().slice(0, 4);
}

/**
 * Auto-classify approved NEFT/RTGS payment items into Same-Bank (Internal Fund Transfer)
 * vs Other-Bank (NEFT/RTGS) batches by comparing the vendor IFSC prefix with the
 * source company bank IFSC prefix.
 *
 * Automatically excludes CHEQUE payments from bank Excel export and reports their count.
 */
export function splitRowsByIfsc(
  rows: BulkExportRow[],
  sourceBankIfscPrefix: string
): IfscSplitResult {
  const normalizedBankPrefix = extractIfscPrefix(sourceBankIfscPrefix);

  const sameBankRows: BulkExportRow[] = [];
  const otherBankRows: BulkExportRow[] = [];
  let skippedChequeCount = 0;

  for (const row of rows) {
    if (row.paymentMode === 'CHEQUE') {
      skippedChequeCount += 1;
      continue;
    }

    const vendorPrefix = extractIfscPrefix(row.ifscCode);
    if (normalizedBankPrefix && vendorPrefix === normalizedBankPrefix) {
      sameBankRows.push(row);
    } else {
      otherBankRows.push(row);
    }
  }

  const sameBankTotal =
    Math.round(sameBankRows.reduce((sum, r) => sum + (Number(r.netPayable) || 0), 0) * 100) / 100;
  const otherBankTotal =
    Math.round(otherBankRows.reduce((sum, r) => sum + (Number(r.netPayable) || 0), 0) * 100) / 100;

  return {
    sameBankRows,
    otherBankRows,
    skippedChequeCount,
    sameBankTotal,
    otherBankTotal,
  };
}
