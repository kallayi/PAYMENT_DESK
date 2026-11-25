import ExcelJS from 'exceljs';
import { axisBankAdapter } from '@/lib/excel/axis-adapter';
import type { BankTemplateAdapter, BulkExportRow } from '@/lib/excel/types';

export * from '@/lib/excel/types';
export * from '@/lib/excel/ifsc';

function createGenericBankAdapter(bankShortCode: string): BankTemplateAdapter {
  const code = bankShortCode.trim().toUpperCase() || 'BANK';

  const buildWorkbook = async (
    rows: BulkExportRow[],
    isSameBank: boolean
  ): Promise<Buffer> => {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Payment Desk';
    workbook.created = new Date();

    const sheetName = isSameBank ? `${code}_Same_Bank` : `${code}_NEFT_RTGS`;
    const sheet = workbook.addWorksheet(sheetName);

    sheet.columns = [
      { header: 'Sl No', key: 'slNo', width: 8 },
      { header: 'Transfer Type', key: 'transferType', width: 14 },
      { header: 'Beneficiary Name', key: 'beneficiaryName', width: 30 },
      { header: 'Account Number', key: 'accountNumber', width: 26, style: { numFmt: '@' } },
      { header: 'IFSC Code', key: 'ifscCode', width: 16 },
      { header: 'Amount (INR)', key: 'amount', width: 16, style: { numFmt: '0.00' } },
      { header: 'Narration', key: 'narration', width: 42 },
      { header: 'Payment Date', key: 'sheetDate', width: 14 },
    ];

    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, size: 11, color: { argb: 'FF0F172A' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFF1F5F9' },
    };
    headerRow.height = 24;

    rows.forEach((item, index) => {
      const amount = Math.round((Number(item.netPayable) || 0) * 100) / 100;
      const transferType = isSameBank ? 'IFT' : amount >= 200000 ? 'RTGS' : 'NEFT';
      const narration = `${item.companyCode} ${item.invoiceRef} ${item.partyName}`
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 50);

      const addedRow = sheet.addRow({
        slNo: index + 1,
        transferType,
        beneficiaryName: item.beneficiaryName.trim(),
        accountNumber: String(item.accountNumber || '').trim(),
        ifscCode: (item.ifscCode || '').trim().toUpperCase(),
        amount,
        narration,
        sheetDate: item.sheetDate,
      });

      const accCell = addedRow.getCell('accountNumber');
      accCell.value = String(item.accountNumber || '').trim();
      accCell.numFmt = '@';
    });

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  };

  return {
    bankShortCode: code,
    buildSameBankWorkbook: (rows) => buildWorkbook(rows, true),
    buildOtherBankWorkbook: (rows) => buildWorkbook(rows, false),
  };
}

const BANK_ADAPTER_REGISTRY: Record<string, BankTemplateAdapter> = {
  AXIS: axisBankAdapter,
  UTIB: axisBankAdapter,
  SIB: createGenericBankAdapter('SIB'),
  SIBL: createGenericBankAdapter('SIB'),
  HDFC: createGenericBankAdapter('HDFC'),
  KOTAK: createGenericBankAdapter('KOTAK'),
  KKBK: createGenericBankAdapter('KOTAK'),
};

/**
 * Retrieve the matching Bank Template Adapter by bank short code or IFSC prefix.
 * Falls back cleanly to a generic bank bulk template if a custom bank is added.
 */
export function getBankTemplateAdapter(
  shortCode: string | null | undefined,
  ifscPrefix?: string | null
): BankTemplateAdapter {
  const cleanCode = (shortCode || '').trim().toUpperCase();
  const cleanPrefix = (ifscPrefix || '').trim().toUpperCase();

  if (cleanCode && BANK_ADAPTER_REGISTRY[cleanCode]) {
    return BANK_ADAPTER_REGISTRY[cleanCode];
  }
  if (cleanPrefix && BANK_ADAPTER_REGISTRY[cleanPrefix]) {
    return BANK_ADAPTER_REGISTRY[cleanPrefix];
  }

  return createGenericBankAdapter(cleanCode || cleanPrefix || 'BANK');
}
