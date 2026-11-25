import ExcelJS from 'exceljs';
import type { BankTemplateAdapter, BulkExportRow } from '@/lib/excel/types';

function formatAxisDate(dateStr: string | null | undefined): string {
  const clean = (dateStr || '').trim();
  const match = clean.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    return `${match[3]}/${match[2]}/${match[1]}`;
  }
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yyyy = now.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function buildDebitNarration(row: BulkExportRow): string {
  const company = (row.companyCode || 'INDFURN').trim().toUpperCase();
  const inv = (row.invoiceRef || '').trim();
  const party = (row.partyName || '').trim();
  return `${company} ${inv} ${party}`.replace(/\s+/g, ' ').trim().slice(0, 50);
}

function buildCreditNarration(row: BulkExportRow): string {
  const company = (row.companyCode || 'INDFURN').trim().toUpperCase();
  const inv = (row.invoiceRef || '').trim();
  return `${company} ${inv}`.replace(/\s+/g, ' ').trim().slice(0, 50);
}

function extractTenDigitMobile(raw: string | null | undefined): string {
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 10) return '';
  return digits.slice(-10);
}

function resolveAxisPaymentMode(row: BulkExportRow): 'I' | 'RTGS' | 'NEFT' {
  const ifsc = (row.ifscCode || '').trim().toUpperCase();
  const prefix = (row.sourceBankIfscPrefix || 'UTIB').trim().toUpperCase() || 'UTIB';
  if (ifsc.startsWith(prefix)) {
    return 'I';
  }
  return Number(row.netPayable) >= 200000 ? 'RTGS' : 'NEFT';
}

function styleAxisHeaderRow(sheet: ExcelJS.Worksheet) {
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, size: 10, color: { argb: 'FF0F172A' } };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFF1F5F9' },
  };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  headerRow.height = 34;
}

/**
 * Shared builder for Axis Bank Neo "Default - Across All Banks" 31-column bulk upload sheet.
 * Works identically for Same-Bank (I), Other-Bank (NEFT/RTGS), and Combined batches.
 */
async function buildAxisDefaultAcrossAllBanksWorkbook(
  rows: BulkExportRow[]
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Payment Desk';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Default - Across All Banks');

  sheet.columns = [
    { header: 'Debit Account Number  \r\n(Mandatory)', key: 'debitAccount', width: 24, style: { numFmt: '@' } },
    { header: 'Transaction Amount \r\n(Mandatory)', key: 'amount', width: 18, style: { numFmt: '0.00' } },
    { header: 'Transaction Currency \r\n(Mandatory)', key: 'currency', width: 16 },
    { header: 'Beneficiary Name \r\n(Mandatory)', key: 'beneficiaryName', width: 30 },
    { header: 'Beneficiary Account Number \r\n(Mandatory)', key: 'beneficiaryAccount', width: 26, style: { numFmt: '@' } },
    { header: 'Beneficiary IFSC Code \r\n(Mandatory)', key: 'ifscCode', width: 20 },
    { header: 'Transaction Date (DD/MM/YYYY) \r\n(Mandatory)', key: 'transactionDate', width: 20, style: { numFmt: '@' } },
    { header: 'Payment Mode \r\n(Mandatory)', key: 'paymentMode', width: 16 },
    { header: 'Customer Reference Number', key: 'customerRef', width: 22 },
    { header: 'Beneficiary Nickname / Code', key: 'beneficiaryNickname', width: 20 },
    { header: 'LEI Number', key: 'leiNumber', width: 18 },
    { header: 'Invoice Details', key: 'invoiceDetails', width: 22 },
    { header: 'Beneficiary Address Line 1', key: 'addr1', width: 20 },
    { header: 'Beneficiary Address Line 2', key: 'addr2', width: 20 },
    { header: 'Beneficiary Address Line 3', key: 'addr3', width: 20 },
    { header: 'Beneficiary City', key: 'city', width: 16 },
    { header: 'Beneficiary State', key: 'state', width: 16 },
    { header: 'Beneficiary Pin Code', key: 'pincode', width: 14 },
    { header: 'Payable Location', key: 'payableLocation', width: 16 },
    { header: 'Print Location', key: 'printLocation', width: 16 },
    { header: 'Delivery Mode', key: 'deliveryMode', width: 16 },
    { header: 'Cheque Number', key: 'chequeNumber', width: 16 },
    { header: 'Debit Narration', key: 'debitNarration', width: 34 },
    { header: 'Credit Narration', key: 'creditNarration', width: 28 },
    { header: 'Beneficiary Mobile No / SMS', key: 'mobileNo', width: 20, style: { numFmt: '@' } },
    { header: 'Beneficiary Email ID', key: 'emailId', width: 24 },
    { header: 'Email Body', key: 'emailBody', width: 24 },
    { header: 'Enrichment 1', key: 'enrichment1', width: 28 },
    { header: 'Enrichment 2', key: 'enrichment2', width: 18 },
    { header: 'Enrichment 3', key: 'enrichment3', width: 18 },
    { header: 'Enrichment 4', key: 'enrichment4', width: 18 },
  ];

  styleAxisHeaderRow(sheet);

  rows.forEach((item) => {
    const amount = Math.round((Number(item.netPayable) || 0) * 100) / 100;
    const debitAccount = String(item.sourceBankDebitAccount || '').trim();
    const beneficiaryAccount = String(item.accountNumber || '').trim();
    const transactionDate = formatAxisDate(item.sheetDate);
    const mobileNo = extractTenDigitMobile(item.whatsappNumber);

    const addedRow = sheet.addRow({
      debitAccount,
      amount,
      currency: 'INR',
      beneficiaryName: item.beneficiaryName.trim(),
      beneficiaryAccount,
      ifscCode: (item.ifscCode || '').trim().toUpperCase(),
      transactionDate,
      paymentMode: resolveAxisPaymentMode(item),
      customerRef: (item.invoiceRef || '').trim().slice(0, 30),
      beneficiaryNickname: '',
      leiNumber: '',
      invoiceDetails: (item.invoiceRef || '').trim().slice(0, 50),
      addr1: '',
      addr2: '',
      addr3: '',
      city: '',
      state: '',
      pincode: '',
      payableLocation: '',
      printLocation: '',
      deliveryMode: '',
      chequeNumber: '',
      debitNarration: buildDebitNarration(item),
      creditNarration: buildCreditNarration(item),
      mobileNo,
      emailId: '',
      emailBody: '',
      enrichment1: (item.purpose || '').trim().slice(0, 100),
      enrichment2: '',
      enrichment3: '',
      enrichment4: '',
    });

    // Enforce explicit Text format (@) on account numbers, date string, and mobile
    const debitCell = addedRow.getCell('debitAccount');
    debitCell.value = debitAccount;
    debitCell.numFmt = '@';

    const beneAccCell = addedRow.getCell('beneficiaryAccount');
    beneAccCell.value = beneficiaryAccount;
    beneAccCell.numFmt = '@';

    const dateCell = addedRow.getCell('transactionDate');
    dateCell.value = transactionDate;
    dateCell.numFmt = '@';

    if (mobileNo) {
      const mobileCell = addedRow.getCell('mobileNo');
      mobileCell.value = mobileNo;
      mobileCell.numFmt = '@';
    }
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/**
 * Axis Bank Neo for Corporates Bulk Upload Template Adapter
 * Produces the official 31-column "Default - Across All Banks" .xlsx format
 * for Same-Bank (I), Other-Bank (NEFT/RTGS), and Combined batches.
 */
export const axisBankAdapter: BankTemplateAdapter = {
  bankShortCode: 'AXIS',

  buildSameBankWorkbook: (rows) => buildAxisDefaultAcrossAllBanksWorkbook(rows),
  buildOtherBankWorkbook: (rows) => buildAxisDefaultAcrossAllBanksWorkbook(rows),
  buildCombinedWorkbook: (rows) => buildAxisDefaultAcrossAllBanksWorkbook(rows),
};
