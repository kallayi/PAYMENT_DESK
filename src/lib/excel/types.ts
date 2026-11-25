export type BankBatchType = 'same_bank' | 'other_bank';

export interface BulkExportRow {
  paymentId: string;
  partyName: string;
  beneficiaryName: string;
  accountNumber: string;
  ifscCode: string;
  netPayable: number;
  invoiceRef: string;
  purpose: string;
  sheetDate: string;
  sourceBankShortCode: string;
  sourceBankIfscPrefix: string;
  companyCode: string;
  paymentMode?: 'NEFT_RTGS' | 'CHEQUE';
}

export interface IfscSplitResult {
  sameBankRows: BulkExportRow[];
  otherBankRows: BulkExportRow[];
  skippedChequeCount: number;
  sameBankTotal: number;
  otherBankTotal: number;
}

export interface BankTemplateAdapter {
  bankShortCode: string;
  buildSameBankWorkbook(rows: BulkExportRow[]): Promise<Buffer>;
  buildOtherBankWorkbook(rows: BulkExportRow[]): Promise<Buffer>;
}
