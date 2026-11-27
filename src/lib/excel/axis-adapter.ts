import ExcelJS from 'exceljs';
import { getBankNameFromIfsc } from '@/lib/bank-names';
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

function getTodayDDMMYYYY(): string {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yyyy = now.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function getTodayYYYYMMDD(): string {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yyyy = now.getFullYear();
  return `${yyyy}${mm}${dd}`;
}

function buildCustomerRef(row: BulkExportRow, index: number): string {
  const company = (row.companyCode || 'INDFURN')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase()
    .slice(0, 10);
  const datePart = getTodayYYYYMMDD();
  const seq = String(index + 1).padStart(2, '0');
  return `${company}${datePart}${seq}`.slice(0, 20);
}

function buildBeneficiaryCode(partyName: string): string {
  return (
    (partyName || 'VENDOR')
      .replace(/[^a-zA-Z0-9]/g, '')
      .toUpperCase()
      .slice(0, 15) || 'VENDOR'
  );
}

function buildDebitNarration(row: BulkExportRow): string {
  const party = (row.partyName || '').trim();
  const inv = (row.invoiceRef || '').trim();
  return `${party} ${inv}`.replace(/\s+/g, ' ').trim().slice(0, 30);
}

function buildCreditNarration(row: BulkExportRow): string {
  const company = (row.companyCode || 'INDFURN').trim().toUpperCase();
  const inv = (row.invoiceRef || '').trim();
  return `${company} ${inv}`.replace(/\s+/g, ' ').trim().slice(0, 30);
}

function resolveAxisPaymentMode(row: BulkExportRow): 'I' | 'IMPS' | 'RTGS' | 'NEFT' {
  const ifsc = (row.ifscCode || '').trim().toUpperCase();
  const prefix = (row.sourceBankIfscPrefix || 'UTIB').trim().toUpperCase() || 'UTIB';
  if (ifsc.startsWith(prefix)) {
    return 'I';
  }
  if (row.paymentMode === 'IMPS') {
    return 'IMPS';
  }
  return Number(row.netPayable) >= 200000 ? 'RTGS' : 'NEFT';
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
  cell.value = value;
  cell.numFmt = '@';
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

  const todayDDMMYYYY = getTodayDDMMYYYY();

  rows.forEach((item, index) => {
    const amount = Math.round((Number(item.netPayable) || 0) * 100) / 100;
    const debitAccount = String(item.sourceBankDebitAccount || '').trim();
    const beneficiaryAccount = String(item.accountNumber || '').trim();
    const customerRef = buildCustomerRef(item, index);

    const addedRow = sheet.addRow({
      debitAccount,
      amount,
      currency: 'INR',
      beneficiaryName: item.beneficiaryName.trim(),
      beneficiaryAccount,
      transactionDate: todayDDMMYYYY,
      customerRef,
      beneficiaryCode: buildBeneficiaryCode(item.partyName),
    });

    enforceTextCell(addedRow, 'debitAccount', debitAccount);
    enforceTextCell(addedRow, 'beneficiaryAccount', beneficiaryAccount);
    enforceTextCell(addedRow, 'transactionDate', todayDDMMYYYY);
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

  const todayDDMMYYYY = getTodayDDMMYYYY();

  rows.forEach((item, index) => {
    const amount = Math.round((Number(item.netPayable) || 0) * 100) / 100;
    const debitAccount = String(item.sourceBankDebitAccount || '').trim();
    const beneficiaryAccount = String(item.accountNumber || '').trim();
    const customerRef = buildCustomerRef(item, index);

    const addedRow = sheet.addRow({
      debitAccount,
      amount,
      currency: 'INR',
      beneficiaryName: item.beneficiaryName.trim(),
      beneficiaryAccount,
      ifscCode: (item.ifscCode || '').trim().toUpperCase(),
      transactionDate: todayDDMMYYYY,
      paymentMode: resolveAxisPaymentMode(item),
      customerRef,
      beneficiaryCode: buildBeneficiaryCode(item.partyName),
      bankAccountType: '',
      beneficiaryType: '',
      lei: '',
      debitNarration: buildDebitNarration(item),
      creditNarration: buildCreditNarration(item),
      invoiceNumber: (item.invoiceRef || '').trim(),
      addr1: '',
      addr2: '',
      addr3: '',
      city: '',
      state: '',
      pincode: '',
      email1: '',
      email2: '',
      mobileNo: '',
      addInfo1: '',
      addInfo2: '',
      addInfo3: '',
      addInfo4: '',
      addInfo5: '',
      addInfo6: '',
    });

    enforceTextCell(addedRow, 'debitAccount', debitAccount);
    enforceTextCell(addedRow, 'beneficiaryAccount', beneficiaryAccount);
    enforceTextCell(addedRow, 'transactionDate', todayDDMMYYYY);
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

function buildSalaryDebitNarration(row: BulkExportRow): string {
  const party = (row.partyName || row.beneficiaryName || '')
    .replace(/[^a-zA-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const inv = (row.invoiceRef || '')
    .replace(/[^a-zA-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const useInv =
    inv.length > 0 &&
    !['NA', 'ON ACCOUNT'].includes(inv.toUpperCase()) &&
    inv.toUpperCase().includes('SAL');
  return `${party} ${useInv ? inv : 'SALARY'}`.replace(/\s+/g, ' ').trim().slice(0, 30);
}

function buildSalaryCreditNarration(row: BulkExportRow): string {
  const company = (row.companyCode || 'INDFURN')
    .replace(/[^a-zA-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
  return `${company} SALARY`.replace(/\s+/g, ' ').trim().slice(0, 30);
}

function resolveSalaryPaymentMode(row: BulkExportRow): 'I' | 'IMPS' | 'RTGS' | 'NEFT' {
  const ifsc = (row.ifscCode || '').trim().toUpperCase();
  if (ifsc.startsWith('UTIB')) {
    return 'I';
  }
  if (row.paymentMode === 'IMPS') {
    return 'IMPS';
  }
  return Number(row.netPayable) >= 200000 ? 'RTGS' : 'NEFT';
}

function resolveSalaryBeneficiaryBankName(ifscCode: string): string {
  const cleanIfsc = (ifscCode || '').trim().toUpperCase();
  if (!cleanIfsc) return '';
  const resolved = getBankNameFromIfsc(cleanIfsc);
  if (!resolved || resolved === '—' || resolved === cleanIfsc.slice(0, 4)) {
    return '';
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
    const debitAccount = String(item.sourceBankDebitAccount || '').trim();
    const beneficiaryAccount = String(item.accountNumber || '').trim();
    const customerRef = buildSalaryCustomerRef(item, index, yyyymmdd);
    const beneficiaryName = (item.beneficiaryName || item.partyName || '').trim();
    const beneficiaryCode = buildBeneficiaryCode(item.partyName || item.beneficiaryName);

    const addedRow = sheet.addRow({
      debitAccount,
      amount,
      currency: 'INR',
      beneficiaryAccount,
      transactionDate: ddmmyyyy,
      customerRef,
      beneficiaryCode,
      beneficiaryName,
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
    const debitAccount = String(item.sourceBankDebitAccount || '').trim();
    const beneficiaryAccount = String(item.accountNumber || '').trim();
    const ifscCode = (item.ifscCode || '').trim().toUpperCase();
    const customerRef = buildSalaryCustomerRef(item, index, yyyymmdd);
    const beneficiaryName = (item.beneficiaryName || item.partyName || '').trim();
    const beneficiaryCode = buildBeneficiaryCode(item.partyName || item.beneficiaryName);

    const addedRow = sheet.addRow({
      debitAccount,
      amount,
      currency: 'INR',
      beneficiaryName,
      beneficiaryAccount,
      ifscCode,
      transactionDate: ddmmyyyy,
      paymentMode: resolveSalaryPaymentMode(item),
      customerRef,
      beneficiaryCode,
      bankAccountType: '',
      debitNarration: buildSalaryDebitNarration(item),
      creditNarration: buildSalaryCreditNarration(item),
      addr1: '',
      addr2: '',
      addr3: '',
      city: '',
      state: '',
      pincode: '',
      beneficiaryBankName: resolveSalaryBeneficiaryBankName(ifscCode),
      email1: '',
      email2: '',
      mobileNo: '',
      addInfo1: '',
      addInfo2: '',
      addInfo3: '',
      addInfo4: '',
      addInfo5: '',
      addInfo6: '',
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
