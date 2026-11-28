import ExcelJS from 'exceljs';
import { getBankNameFromIfsc } from '@/lib/bank-names';
import { extractIfscPrefix } from '@/lib/excel/ifsc';
import type { BankTemplateAdapter, BulkExportRow } from '@/lib/excel/types';

function getTodayISTParts(): { ddmmyyyy: string; yyyymmdd: string } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
  const dd = get('day');
  const mm = get('month');
  const yyyy = get('year');
  return {
    ddmmyyyy: `${dd}/${mm}/${yyyy}`,
    yyyymmdd: `${yyyy}${mm}${dd}`,
  };
}

function buildCustomerRef(row: BulkExportRow, index: number, yyyymmdd: string): string {
  const company = (row.companyCode || 'INDFURN')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase()
    .slice(0, 10);
  const seq = String(index + 1).padStart(2, '0');
  return `${company}${yyyymmdd}${seq}`.slice(0, 20);
}

const AXIS_PLACEHOLDER_VALUES = new Set([
  '',
  'na',
  'n/a',
  'n / a',
  'n.a.',
  'n.a',
  'none',
  'null',
  'nil',
  'undefined',
  '-',
  '--',
  '---',
  '—',
  '–',
  'not applicable',
  'not-applicable',
]);

/**
 * Strip leading spreadsheet formula trigger characters (=, +, -, @, \t, \r)
 * and unsafe control characters from free-text Axis Neo bulk upload fields
 * without adding quotes, keeping bank portal uploads valid while neutralizing Excel formulas.
 */
function sanitizeAxisFreeText(val: string | null | undefined): string {
  let str = (val || '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  while (/^[=+\-@\t\r]/.test(str)) {
    str = str.replace(/^[=+\-@\t\r]+/, '').trimStart();
  }
  return str;
}

/**
 * Clean optional Axis Neo fields so empty or placeholder values
 * ('NA', 'N/A', 'None', 'null', 'nil', '-', '—', etc.) become ''.
 */
function cleanOptionalAxisValue(val: string | null | undefined): string {
  const cleaned = sanitizeAxisFreeText(val);
  if (!cleaned) return '';
  if (AXIS_PLACEHOLDER_VALUES.has(cleaned.toLowerCase())) {
    return '';
  }
  return cleaned;
}

function cleanAxisAccountNumber(val: string | null | undefined): string {
  const noSpaces = String(val || '').replace(/\s+/g, '').trim();
  return cleanOptionalAxisValue(noSpaces);
}

function buildBeneficiaryCode(partyName: string): string {
  const cleaned = cleanOptionalAxisValue(partyName);
  return (
    (cleaned || 'VENDOR')
      .replace(/[^a-zA-Z0-9]/g, '')
      .toUpperCase()
      .slice(0, 15) || 'VENDOR'
  );
}

function resolveAxisPaymentMode(row: BulkExportRow): 'I' | 'IMPS' | 'R' | 'N' {
  const vendorPrefix = extractIfscPrefix(row.ifscCode);
  const bankPrefix = extractIfscPrefix(row.sourceBankIfscPrefix || 'UTIB') || 'UTIB';
  if (vendorPrefix && vendorPrefix === bankPrefix) {
    return 'I';
  }
  if (row.paymentMode === 'IMPS') {
    return 'IMPS';
  }
  return Number(row.netPayable) >= 200000 ? 'R' : 'N';
}

function styleAxisHeaderRow(sheet: ExcelJS.Worksheet) {
  const headerRow = sheet.getRow(1);
  headerRow.font = {
    name: 'Calibri',
    size: 11,
    bold: true,
    color: { argb: 'FF000000' },
  };
  headerRow.alignment = {
    horizontal: 'center',
    vertical: 'middle',
    wrapText: true,
  };
  headerRow.height = 30;
}

function enforceTextCell(row: ExcelJS.Row, key: string, value: string) {
  const cell = row.getCell(key);
  cell.numFmt = '@';
  cell.value = value ? value : null;
}

/**
 * Builder for Axis Bank's 8-column "Default - Within Axis Bank" template (Same-Bank UTIB IFT).
 */
async function buildWithinAxisBankWorkbook(rows: BulkExportRow[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Payment Desk';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Default - Within Axis Bank');

  sheet.columns = [
    { header: 'Debit Account Number  \r\n(Mandatory)', key: 'debitAccount', width: 24, style: { numFmt: '@' } },
    { header: 'Transaction Amount  \r\n(Mandatory)', key: 'amount', width: 18, style: { numFmt: '0.00' } },
    { header: 'Transaction Currency \n(Non-Mandatory)', key: 'currency', width: 18 },
    { header: 'Beneficiary Name  \r\n(Mandatory)', key: 'beneficiaryName', width: 30 },
    { header: 'Beneficiary Account Number  \r\n(Mandatory)', key: 'beneficiaryAccount', width: 26, style: { numFmt: '@' } },
    { header: 'Transaction Date  \r\n(Mandatory)', key: 'transactionDate', width: 18, style: { numFmt: '@' } },
    { header: 'Customer Reference Number  \r\n(Mandatory)', key: 'customerRef', width: 24, style: { numFmt: '@' } },
    { header: 'Beneficiary Code \n(Non-Mandatory)', key: 'beneficiaryCode', width: 20 },
  ];

  styleAxisHeaderRow(sheet);

  const { ddmmyyyy, yyyymmdd } = getTodayISTParts();

  rows.forEach((item, index) => {
    const amount = Math.round((Number(item.netPayable) || 0) * 100) / 100;
    const debitAccount = cleanAxisAccountNumber(item.sourceBankDebitAccount);
    const beneficiaryAccount = cleanAxisAccountNumber(item.accountNumber);
    const beneficiaryName =
      cleanOptionalAxisValue(item.beneficiaryName) ||
      cleanOptionalAxisValue(item.partyName);
    const beneficiaryCode = buildBeneficiaryCode(item.partyName || item.beneficiaryName);
    const customerRef = buildCustomerRef(item, index, yyyymmdd);

    const addedRow = sheet.addRow({
      debitAccount: debitAccount || undefined,
      amount,
      currency: 'INR',
      beneficiaryName: beneficiaryName || undefined,
      beneficiaryAccount: beneficiaryAccount || undefined,
      transactionDate: ddmmyyyy,
      customerRef,
      beneficiaryCode: beneficiaryCode || undefined,
    });

    enforceTextCell(addedRow, 'debitAccount', debitAccount);
    enforceTextCell(addedRow, 'beneficiaryAccount', beneficiaryAccount);
    enforceTextCell(addedRow, 'transactionDate', ddmmyyyy);
    enforceTextCell(addedRow, 'customerRef', customerRef);
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/**
 * Shared builder for Axis Bank's 31-column "Default - Across All Banks" template
 * used for Other-Bank (NEFT / RTGS) and Combined (I + NEFT + RTGS) uploads.
 */
async function buildAcrossAllBanksWorkbook(rows: BulkExportRow[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Payment Desk';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Default - Across All Banks');

  sheet.columns = [
    { header: 'Debit Account Number  \r\n(Mandatory)', key: 'debitAccount', width: 24, style: { numFmt: '@' } },
    { header: 'Transaction Amount  \r\n(Mandatory)', key: 'amount', width: 18, style: { numFmt: '0.00' } },
    { header: 'Transaction Currency \n(Non-Mandatory)', key: 'currency', width: 18 },
    { header: 'Beneficiary Name  \r\n(Mandatory)', key: 'beneficiaryName', width: 30 },
    { header: 'Beneficiary Account Number  \r\n(Mandatory)', key: 'beneficiaryAccount', width: 26, style: { numFmt: '@' } },
    { header: 'Beneficiary IFSC Code  \r\n(Mandatory)', key: 'ifscCode', width: 22 },
    { header: 'Transaction Date  \r\n(Mandatory)', key: 'transactionDate', width: 18, style: { numFmt: '@' } },
    { header: 'Payment Mode  \r\n(Mandatory)', key: 'paymentMode', width: 16 },
    { header: 'Customer Reference Number  \r\n(Mandatory)', key: 'customerRef', width: 24, style: { numFmt: '@' } },
    { header: 'Beneficiary Nickname/Code  \r\n(Mandatory)', key: 'beneficiaryCode', width: 24 },
    { header: 'Bank Account Type \n(Non-Mandatory)', key: 'bankAccountType', width: 18 },
    { header: 'Beneficiary Type \n(Non-Mandatory)', key: 'beneficiaryType', width: 18 },
    { header: 'LEI \n(Non-Mandatory)', key: 'lei', width: 16 },
    { header: 'Debit Narration \n(Non-Mandatory)', key: 'debitNarration', width: 32 },
    { header: 'Credit Narration \n(Non-Mandatory)', key: 'creditNarration', width: 32 },
    { header: 'Invoice Number \n(Non-Mandatory)', key: 'invoiceNumber', width: 20 },
    { header: 'Beneficiary Address 1 \n(Non-Mandatory)', key: 'addr1', width: 22 },
    { header: 'Beneficiary Address 2 \n(Non-Mandatory)', key: 'addr2', width: 22 },
    { header: 'Beneficiary Address 3 \n(Non-Mandatory)', key: 'addr3', width: 22 },
    { header: 'Beneficiary City \n(Non-Mandatory)', key: 'city', width: 16 },
    { header: 'Beneficiary State \n(Non-Mandatory)', key: 'state', width: 16 },
    { header: 'Beneficiary Pin Code \n(Non-Mandatory)', key: 'pincode', width: 18 },
    { header: 'Beneficiary Email address 1 \n(Non-Mandatory)', key: 'email1', width: 24 },
    { header: 'Beneficiary Email address 2 \n(Non-Mandatory)', key: 'email2', width: 24 },
    { header: 'Beneficiary Mobile Number \n(Non-Mandatory)', key: 'mobileNo', width: 22 },
    { header: 'Add Info1 \n(Non-Mandatory)', key: 'addInfo1', width: 16 },
    { header: 'Add Info2 \n(Non-Mandatory)', key: 'addInfo2', width: 16 },
    { header: 'Add Info3 \n(Non-Mandatory)', key: 'addInfo3', width: 16 },
    { header: 'Add Info4 \n(Non-Mandatory)', key: 'addInfo4', width: 16 },
    { header: 'Add Info5 \n(Non-Mandatory)', key: 'addInfo5', width: 16 },
    { header: 'Add Info6 \n(Non-Mandatory)', key: 'addInfo6', width: 16 },
  ];

  styleAxisHeaderRow(sheet);

  const { ddmmyyyy, yyyymmdd } = getTodayISTParts();

  rows.forEach((item, index) => {
    const amount = Math.round((Number(item.netPayable) || 0) * 100) / 100;
    const debitAccount = cleanAxisAccountNumber(item.sourceBankDebitAccount);
    const beneficiaryAccount = cleanAxisAccountNumber(item.accountNumber);
    const ifscCode = cleanOptionalAxisValue(item.ifscCode).toUpperCase();
    const beneficiaryName =
      cleanOptionalAxisValue(item.beneficiaryName) ||
      cleanOptionalAxisValue(item.partyName);
    const customerRef = buildCustomerRef(item, index, yyyymmdd);
    const invoiceNumber = cleanOptionalAxisValue(item.invoiceRef) || undefined;

    const addedRow = sheet.addRow({
      debitAccount: debitAccount || undefined,
      amount,
      currency: 'INR',
      beneficiaryName: beneficiaryName || undefined,
      beneficiaryAccount: beneficiaryAccount || undefined,
      ifscCode: ifscCode || undefined,
      transactionDate: ddmmyyyy,
      paymentMode: resolveAxisPaymentMode(item),
      customerRef,
      beneficiaryCode: buildBeneficiaryCode(item.partyName || item.beneficiaryName),
      bankAccountType: undefined,
      beneficiaryType: undefined,
      lei: undefined,
      debitNarration: undefined,
      creditNarration: undefined,
      invoiceNumber,
      addr1: undefined,
      addr2: undefined,
      addr3: undefined,
      city: undefined,
      state: undefined,
      pincode: undefined,
      email1: undefined,
      email2: undefined,
      mobileNo: undefined,
      addInfo1: undefined,
      addInfo2: undefined,
      addInfo3: undefined,
      addInfo4: undefined,
      addInfo5: undefined,
      addInfo6: undefined,
    });

    enforceTextCell(addedRow, 'debitAccount', debitAccount);
    enforceTextCell(addedRow, 'beneficiaryAccount', beneficiaryAccount);
    enforceTextCell(addedRow, 'transactionDate', ddmmyyyy);
    enforceTextCell(addedRow, 'customerRef', customerRef);
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/**
 * Axis Bank Neo for Corporates Bulk Upload Template Adapter
 * - buildSameBankWorkbook: 8-column "Default - Within Axis Bank"
 * - buildOtherBankWorkbook / buildCombinedWorkbook: 31-column "Default - Across All Banks"
 */
export const axisBankAdapter: BankTemplateAdapter = {
  bankShortCode: 'AXIS',

  buildSameBankWorkbook: (rows) => buildWithinAxisBankWorkbook(rows),
  buildOtherBankWorkbook: (rows) => buildAcrossAllBanksWorkbook(rows),
  buildCombinedWorkbook: (rows) => buildAcrossAllBanksWorkbook(rows),
};

function buildSalaryCustomerRef(row: BulkExportRow, index: number, yyyymmdd: string): string {
  const company = (row.companyCode || 'INDFURN')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase()
    .slice(0, 7);
  const seq = String(index + 1).padStart(2, '0');
  return `${company}SAL${yyyymmdd}${seq}`.slice(0, 20);
}

function resolveSalaryPaymentMode(row: BulkExportRow): 'I' | 'IMPS' | 'R' | 'N' {
  return resolveAxisPaymentMode(row);
}

function resolveSalaryBeneficiaryBankName(ifscCode: string): string | undefined {
  const cleanIfsc = cleanOptionalAxisValue(ifscCode).toUpperCase();
  if (!cleanIfsc) return undefined;
  const resolved = cleanOptionalAxisValue(getBankNameFromIfsc(cleanIfsc));
  if (!resolved || resolved === cleanIfsc.slice(0, 4)) {
    return undefined;
  }
  return resolved;
}

/**
 * Builder for Axis Neo Salary 8-column "Default - Within Axis Bank" template (Same-Bank UTIB IFT).
 * Note: Beneficiary Name is Column 8 (H), unlike the Vendor 8-column template.
 */
export async function buildSalarySameBankWorkbook(rows: BulkExportRow[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Payment Desk';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Default - Within Axis Bank');

  sheet.columns = [
    { header: 'Debit Account Number  \r\n(Mandatory)', key: 'debitAccount', width: 29, style: { numFmt: '@' } },
    { header: 'Transaction Amount  \r\n(Mandatory)', key: 'amount', width: 29, style: { numFmt: '0.00' } },
    { header: 'Transaction Currency \n(Non-Mandatory)', key: 'currency', width: 29 },
    { header: 'Beneficiary Account Number  \r\n(Mandatory)', key: 'beneficiaryAccount', width: 29, style: { numFmt: '@' } },
    { header: 'Transaction Date  \r\n(Mandatory)', key: 'transactionDate', width: 29, style: { numFmt: '@' } },
    { header: 'Customer Reference Number  \r\n(Mandatory)', key: 'customerRef', width: 29, style: { numFmt: '@' } },
    { header: 'Beneficiary Code \n(Non-Mandatory)', key: 'beneficiaryCode', width: 29 },
    { header: 'Beneficiary Name  \r\n(Mandatory)', key: 'beneficiaryName', width: 29 },
  ];

  styleAxisHeaderRow(sheet);

  const { ddmmyyyy, yyyymmdd } = getTodayISTParts();

  rows.forEach((item, index) => {
    const amount = Math.round((Number(item.netPayable) || 0) * 100) / 100;
    const debitAccount = cleanAxisAccountNumber(item.sourceBankDebitAccount);
    const beneficiaryAccount = cleanAxisAccountNumber(item.accountNumber);
    const customerRef = buildSalaryCustomerRef(item, index, yyyymmdd);
    const beneficiaryName =
      cleanOptionalAxisValue(item.beneficiaryName) ||
      cleanOptionalAxisValue(item.partyName);
    const beneficiaryCode = buildBeneficiaryCode(item.partyName || item.beneficiaryName);

    const addedRow = sheet.addRow({
      debitAccount: debitAccount || undefined,
      amount,
      currency: 'INR',
      beneficiaryAccount: beneficiaryAccount || undefined,
      transactionDate: ddmmyyyy,
      customerRef,
      beneficiaryCode: beneficiaryCode || undefined,
      beneficiaryName: beneficiaryName || undefined,
    });

    enforceTextCell(addedRow, 'debitAccount', debitAccount);
    addedRow.getCell('amount').value = amount;
    addedRow.getCell('amount').numFmt = '0.00';
    enforceTextCell(addedRow, 'beneficiaryAccount', beneficiaryAccount);
    enforceTextCell(addedRow, 'transactionDate', ddmmyyyy);
    enforceTextCell(addedRow, 'customerRef', customerRef);
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/**
 * Builder for Axis Neo Salary 29-column "Default - Across All Banks" template
 * used for Other-Bank (NEFT / RTGS) and Combined (I + NEFT + RTGS) salary uploads.
 */
export async function buildSalaryOtherBankWorkbook(rows: BulkExportRow[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Payment Desk';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Default - Across All Banks');

  sheet.columns = [
    { header: 'Debit Account Number  \r\n(Mandatory)', key: 'debitAccount', width: 29, style: { numFmt: '@' } },
    { header: 'Transaction Amount  \r\n(Mandatory)', key: 'amount', width: 29, style: { numFmt: '0.00' } },
    { header: 'Transaction Currency \n(Non-Mandatory)', key: 'currency', width: 29 },
    { header: 'Beneficiary Name  \r\n(Mandatory)', key: 'beneficiaryName', width: 29 },
    { header: 'Beneficiary Account Number  \r\n(Mandatory)', key: 'beneficiaryAccount', width: 29, style: { numFmt: '@' } },
    { header: 'Beneficiary IFSC Code  \r\n(Mandatory)', key: 'ifscCode', width: 29 },
    { header: 'Transaction Date  \r\n(Mandatory)', key: 'transactionDate', width: 29, style: { numFmt: '@' } },
    { header: 'Payment Mode  \r\n(Mandatory)', key: 'paymentMode', width: 29 },
    { header: 'Customer Reference Number  \r\n(Mandatory)', key: 'customerRef', width: 29, style: { numFmt: '@' } },
    { header: 'Beneficiary Nickname/Code  \r\n(Mandatory)', key: 'beneficiaryCode', width: 29 },
    { header: 'Bank Account Type \n(Non-Mandatory)', key: 'bankAccountType', width: 29 },
    { header: 'Debit Narration \n(Non-Mandatory)', key: 'debitNarration', width: 29 },
    { header: 'Credit Narration \n(Non-Mandatory)', key: 'creditNarration', width: 29 },
    { header: 'Beneficiary Address 1 \n(Non-Mandatory)', key: 'addr1', width: 29 },
    { header: 'Beneficiary Address 2 \n(Non-Mandatory)', key: 'addr2', width: 29 },
    { header: 'Beneficiary Address 3 \n(Non-Mandatory)', key: 'addr3', width: 29 },
    { header: 'Beneficiary City \n(Non-Mandatory)', key: 'city', width: 29 },
    { header: 'Beneficiary State \n(Non-Mandatory)', key: 'state', width: 29 },
    { header: 'Beneficiary Pin Code \n(Non-Mandatory)', key: 'pincode', width: 29 },
    { header: 'Beneficiary Bank Name \n(Non-Mandatory)', key: 'beneficiaryBankName', width: 29 },
    { header: 'Beneficiary Email address 1 \n(Non-Mandatory)', key: 'email1', width: 29 },
    { header: 'Beneficiary Email address 2 \n(Non-Mandatory)', key: 'email2', width: 29 },
    { header: 'Beneficiary Mobile Number \n(Non-Mandatory)', key: 'mobileNo', width: 29 },
    { header: 'Add Info1 \n(Non-Mandatory)', key: 'addInfo1', width: 29 },
    { header: 'Add Info2 \n(Non-Mandatory)', key: 'addInfo2', width: 29 },
    { header: 'Add Info3 \n(Non-Mandatory)', key: 'addInfo3', width: 29 },
    { header: 'Add Info4 \n(Non-Mandatory)', key: 'addInfo4', width: 29 },
    { header: 'Add Info5 \n(Non-Mandatory)', key: 'addInfo5', width: 29 },
    { header: 'Add Info6 \n(Non-Mandatory)', key: 'addInfo6', width: 29 },
  ];

  styleAxisHeaderRow(sheet);

  const { ddmmyyyy, yyyymmdd } = getTodayISTParts();

  rows.forEach((item, index) => {
    const amount = Math.round((Number(item.netPayable) || 0) * 100) / 100;
    const debitAccount = cleanAxisAccountNumber(item.sourceBankDebitAccount);
    const beneficiaryAccount = cleanAxisAccountNumber(item.accountNumber);
    const ifscCode = cleanOptionalAxisValue(item.ifscCode).toUpperCase();
    const customerRef = buildSalaryCustomerRef(item, index, yyyymmdd);
    const beneficiaryName =
      cleanOptionalAxisValue(item.beneficiaryName) ||
      cleanOptionalAxisValue(item.partyName);
    const beneficiaryCode = buildBeneficiaryCode(item.partyName || item.beneficiaryName);

    const addedRow = sheet.addRow({
      debitAccount: debitAccount || undefined,
      amount,
      currency: 'INR',
      beneficiaryName: beneficiaryName || undefined,
      beneficiaryAccount: beneficiaryAccount || undefined,
      ifscCode: ifscCode || undefined,
      transactionDate: ddmmyyyy,
      paymentMode: resolveSalaryPaymentMode(item),
      customerRef,
      beneficiaryCode,
      bankAccountType: undefined,
      debitNarration: undefined,
      creditNarration: undefined,
      addr1: undefined,
      addr2: undefined,
      addr3: undefined,
      city: undefined,
      state: undefined,
      pincode: undefined,
      beneficiaryBankName: resolveSalaryBeneficiaryBankName(ifscCode),
      email1: undefined,
      email2: undefined,
      mobileNo: undefined,
      addInfo1: undefined,
      addInfo2: undefined,
      addInfo3: undefined,
      addInfo4: undefined,
      addInfo5: undefined,
      addInfo6: undefined,
    });

    enforceTextCell(addedRow, 'debitAccount', debitAccount);
    addedRow.getCell('amount').value = amount;
    addedRow.getCell('amount').numFmt = '0.00';
    enforceTextCell(addedRow, 'beneficiaryAccount', beneficiaryAccount);
    enforceTextCell(addedRow, 'transactionDate', ddmmyyyy);
    enforceTextCell(addedRow, 'customerRef', customerRef);
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export async function buildSalaryCombinedWorkbook(rows: BulkExportRow[]): Promise<Buffer> {
  return buildSalaryOtherBankWorkbook(rows);
}
