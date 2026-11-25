import ExcelJS from 'exceljs';
import type { BankTemplateAdapter, BulkExportRow } from '@/lib/excel/types';

function buildNarration(row: BulkExportRow): string {
  const company = (row.companyCode || 'INDFURN').trim().toUpperCase();
  const inv = (row.invoiceRef || '').trim();
  const party = (row.partyName || '').trim();
  return `${company} ${inv} ${party}`.replace(/\s+/g, ' ').trim().slice(0, 50);
}

function getTransferType(amount: number): 'NEFT' | 'RTGS' {
  return Number(amount) >= 200000 ? 'RTGS' : 'NEFT';
}

function styleHeaderRow(sheet: ExcelJS.Worksheet) {
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, size: 11, color: { argb: 'FF0F172A' } };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFF1F5F9' },
  };
  headerRow.alignment = { vertical: 'middle', horizontal: 'left' };
  headerRow.height = 24;
}

/**
 * Axis Bank Neo for Corporates Bulk Upload Template Adapter
 * Produces Same-Bank (Internal Fund Transfer) and Other-Bank (NEFT / RTGS) .xlsx workbooks.
 * Strictly maps vendor.beneficiary_name (never party_name) and text-formats Account Numbers (@).
 */
export const axisBankAdapter: BankTemplateAdapter = {
  bankShortCode: 'AXIS',

  async buildSameBankWorkbook(rows: BulkExportRow[]): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Payment Desk';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Axis_Same_Bank_IFT');

    sheet.columns = [
      { header: 'Sl No', key: 'slNo', width: 8 },
      { header: 'Beneficiary Name', key: 'beneficiaryName', width: 30 },
      { header: 'Beneficiary Account Number', key: 'accountNumber', width: 26, style: { numFmt: '@' } },
      { header: 'Transaction Type', key: 'transactionType', width: 18 },
      { header: 'Amount (INR)', key: 'amount', width: 16, style: { numFmt: '0.00' } },
      { header: 'Narration / Remarks', key: 'narration', width: 40 },
      { header: 'Payment Date', key: 'sheetDate', width: 14 },
    ];

    styleHeaderRow(sheet);

    rows.forEach((item, index) => {
      const addedRow = sheet.addRow({
        slNo: index + 1,
        beneficiaryName: item.beneficiaryName.trim(),
        accountNumber: String(item.accountNumber || '').trim(),
        transactionType: 'IFT',
        amount: Math.round((Number(item.netPayable) || 0) * 100) / 100,
        narration: buildNarration(item),
        sheetDate: item.sheetDate,
      });

      const accCell = addedRow.getCell('accountNumber');
      accCell.value = String(item.accountNumber || '').trim();
      accCell.numFmt = '@';
    });

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  },

  async buildOtherBankWorkbook(rows: BulkExportRow[]): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Payment Desk';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Axis_Other_Bank_NEFT_RTGS');

    sheet.columns = [
      { header: 'Sl No', key: 'slNo', width: 8 },
      { header: 'Payment Mode', key: 'transferType', width: 14 },
      { header: 'Beneficiary Name', key: 'beneficiaryName', width: 30 },
      { header: 'Beneficiary Account Number', key: 'accountNumber', width: 26, style: { numFmt: '@' } },
      { header: 'Beneficiary IFSC Code', key: 'ifscCode', width: 16 },
      { header: 'Amount (INR)', key: 'amount', width: 16, style: { numFmt: '0.00' } },
      { header: 'Narration / Remarks', key: 'narration', width: 40 },
      { header: 'Payment Date', key: 'sheetDate', width: 14 },
    ];

    styleHeaderRow(sheet);

    rows.forEach((item, index) => {
      const amount = Math.round((Number(item.netPayable) || 0) * 100) / 100;
      const addedRow = sheet.addRow({
        slNo: index + 1,
        transferType: getTransferType(amount),
        beneficiaryName: item.beneficiaryName.trim(),
        accountNumber: String(item.accountNumber || '').trim(),
        ifscCode: (item.ifscCode || '').trim().toUpperCase(),
        amount,
        narration: buildNarration(item),
        sheetDate: item.sheetDate,
      });

      const accCell = addedRow.getCell('accountNumber');
      accCell.value = String(item.accountNumber || '').trim();
      accCell.numFmt = '@';
    });

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  },
};
