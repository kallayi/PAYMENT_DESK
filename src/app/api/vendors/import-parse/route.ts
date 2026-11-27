import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { createClient } from '@/lib/supabase/server';
import { getCurrentUserContext } from '@/lib/auth';

const MAX_IMPORT_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_IMPORT_ROWS = 500;
const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;

export type ParsedVendorStatus =
  | 'valid'
  | 'duplicate_existing'
  | 'duplicate_in_file'
  | 'invalid';

export interface ParsedVendorRow {
  rowNumber: number;
  party_name: string;
  beneficiary_name: string;
  account_number: string;
  ifsc_code: string;
  remarks: string | null;
  status: ParsedVendorStatus;
  error?: string;
}

type ColumnKey =
  | 'party_name'
  | 'beneficiary_name'
  | 'account_number'
  | 'ifsc_code'
  | 'remarks';

const HEADER_ALIASES: Record<ColumnKey, string[]> = {
  party_name: ['party name', 'vendor name', 'trade name', 'supplier name', 'name'],
  beneficiary_name: [
    'beneficiary name',
    'account holder',
    'payee name',
    'bank account name',
    'beneficiary name (bank a/c)',
  ],
  account_number: [
    'account number',
    'account no',
    'a/c no',
    'a/c number',
    'beneficiary account number',
    'bank account no',
    'bank account number',
  ],
  ifsc_code: ['ifsc', 'ifsc code', 'beneficiary ifsc', 'beneficiary ifsc code'],
  remarks: ['remarks', 'notes', 'note', 'description'],
};

function normalizeHeader(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function matchHeaderColumn(headerText: string): ColumnKey | null {
  const norm = normalizeHeader(headerText);
  if (!norm) return null;

  for (const [key, aliases] of Object.entries(HEADER_ALIASES) as Array<
    [ColumnKey, string[]]
  >) {
    if (aliases.includes(norm)) {
      return key;
    }
  }
  return null;
}

function extractExcelCellText(cell: ExcelJS.Cell): string {
  const val = cell.value;
  if (val === null || val === undefined) return '';

  if (typeof val === 'string') return val.trim();
  if (typeof val === 'number') {
    if (!Number.isFinite(val)) return '';
    return Number.isInteger(val)
      ? val.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 0 })
      : String(val).trim();
  }
  if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
  if (val instanceof Date) return val.toISOString().split('T')[0];

  if (typeof val === 'object') {
    if ('richText' in val && Array.isArray(val.richText)) {
      return val.richText
        .map((part) => part.text || '')
        .join('')
        .trim();
    }
    if ('text' in val && typeof val.text === 'string') {
      return val.text.trim();
    }
    if ('result' in val && val.result !== undefined && val.result !== null) {
      if (typeof val.result === 'number') {
        return Number.isInteger(val.result)
          ? val.result.toLocaleString('en-US', {
            useGrouping: false,
            maximumFractionDigits: 0,
          })
          : String(val.result).trim();
      }
      return String(val.result).trim();
    }
  }

  return (cell.text || '').trim();
}

function cleanAccountNumber(raw: string): string {
  let cleaned = raw.trim().replace(/[\s-]+/g, '');
  if (/^\d+\.0+$/.test(cleaned)) {
    cleaned = cleaned.replace(/\.0+$/, '');
  }
  return cleaned;
}

function parseCsvMatrix(csvText: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;

  const text = csvText.replace(/^\uFEFF/, ''); // strip UTF-8 BOM

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        currentField += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        currentField += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      currentRow.push(currentField.trim());
      currentField = '';
    } else if (ch === '\r' && next === '\n') {
      currentRow.push(currentField.trim());
      rows.push(currentRow);
      currentRow = [];
      currentField = '';
      i += 1;
    } else if (ch === '\n' || ch === '\r') {
      currentRow.push(currentField.trim());
      rows.push(currentRow);
      currentRow = [];
      currentField = '';
    } else {
      currentField += ch;
    }
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    rows.push(currentRow);
  }

  return rows;
}

function isSampleTemplateRow(
  partyName: string,
  accountNumber: string,
  remarks: string
): boolean {
  if (remarks.toLowerCase().includes('sample row - replace or delete')) {
    return true;
  }
  if (
    partyName.toLowerCase() === 'naas hardware' &&
    accountNumber === '918020045612890'
  ) {
    return true;
  }
  return false;
}

export async function POST(req: NextRequest) {
  try {
    const { user, profile, activeCompany } = await getCurrentUserContext();

    if (!user || !profile || !profile.is_active) {
      return NextResponse.json(
        { error: 'Unauthorized. Please sign in.' },
        { status: 401 }
      );
    }

    if (profile.role !== 'PREPARER' && profile.role !== 'VERIFIER' && !profile.is_admin) {
      return NextResponse.json(
        { error: 'Access denied: Only Preparers, Verifiers, or Administrators can import vendors.' },
        { status: 403 }
      );
    }

    if (!activeCompany) {
      return NextResponse.json(
        { error: 'No active company workspace resolved.' },
        { status: 400 }
      );
    }

    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file || file.size === 0) {
      return NextResponse.json(
        { error: 'Please select a .xlsx or .csv file to import.' },
        { status: 400 }
      );
    }

    if (file.size > MAX_IMPORT_BYTES) {
      return NextResponse.json(
        { error: 'File size exceeds the 5 MB limit.' },
        { status: 400 }
      );
    }

    const lowerName = file.name.toLowerCase();
    const isCsv =
      lowerName.endsWith('.csv') ||
      file.type === 'text/csv' ||
      file.type === 'application/csv';
    const isXlsx =
      lowerName.endsWith('.xlsx') ||
      file.type ===
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

    if (!isCsv && !isXlsx) {
      return NextResponse.json(
        { error: 'Unsupported format. Please upload a .xlsx or .csv file.' },
        { status: 400 }
      );
    }

    // Extract raw 2D matrix from .xlsx or .csv
    const rawMatrix: Array<{ rowNumber: number; cells: string[] }> = [];

    if (isCsv) {
      const text = await file.text();
      const parsedCsv = parseCsvMatrix(text);
      parsedCsv.forEach((cells, idx) => {
        if (cells.some((c) => c.trim().length > 0)) {
          rawMatrix.push({ rowNumber: idx + 1, cells });
        }
      });
    } else {
      const arrayBuffer = await file.arrayBuffer();
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(arrayBuffer);

      const worksheet = workbook.worksheets[0];
      if (!worksheet) {
        return NextResponse.json(
          { error: 'The uploaded Excel file contains no worksheets.' },
          { status: 400 }
        );
      }

      worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
        const maxCol = Math.max(row.cellCount, worksheet.columnCount || 0, 10);
        const cells: string[] = [];
        for (let col = 1; col <= maxCol; col += 1) {
          cells.push(extractExcelCellText(row.getCell(col)));
        }
        if (cells.some((c) => c.length > 0)) {
          rawMatrix.push({ rowNumber, cells });
        }
      });
    }

    if (rawMatrix.length < 2) {
      return NextResponse.json(
        {
          error:
            'No data rows found. Ensure Row 1 contains headers and Row 2+ contains vendor records.',
        },
        { status: 400 }
      );
    }

    // Map headers from first non-empty row
    const headerRow = rawMatrix[0];
    const colIndexMap: Partial<Record<ColumnKey, number>> = {};

    headerRow.cells.forEach((cellText, colIdx) => {
      const matched = matchHeaderColumn(cellText);
      if (matched && colIndexMap[matched] === undefined) {
        colIndexMap[matched] = colIdx;
      }
    });

    if (
      colIndexMap.party_name === undefined ||
      colIndexMap.account_number === undefined ||
      colIndexMap.ifsc_code === undefined
    ) {
      return NextResponse.json(
        {
          error:
            'Required columns missing. Expected headers: "Party Name", "Beneficiary Name", "Account Number", and "IFSC Code". Download the Sample Template (.xlsx) for exact formatting.',
        },
        { status: 400 }
      );
    }

    const dataRows = rawMatrix.slice(1);
    if (dataRows.length > MAX_IMPORT_ROWS) {
      return NextResponse.json(
        {
          error: `File contains ${dataRows.length} rows. Please split uploads into batches of up to ${MAX_IMPORT_ROWS} rows.`,
        },
        { status: 400 }
      );
    }

    // Fetch existing vendors in activeCompany for duplicate detection
    const supabase = await createClient();
    const { data: existingVendors, error: existingErr } = await supabase
      .from('vendors')
      .select('party_name, name')
      .eq('company_id', activeCompany.id);

    if (existingErr) {
      return NextResponse.json(
        { error: existingErr.message || 'Failed to check existing company vendors.' },
        { status: 500 }
      );
    }

    const existingPartySet = new Set<string>(
      (existingVendors || [])
        .map((v) => (v.party_name || v.name || '').trim().toLowerCase())
        .filter(Boolean)
    );

    const seenInFile = new Set<string>();
    const parsedRows: ParsedVendorRow[] = [];

    for (const entry of dataRows) {
      const getVal = (key: ColumnKey): string => {
        const idx = colIndexMap[key];
        return idx !== undefined ? (entry.cells[idx] || '').trim() : '';
      };

      const rawParty = getVal('party_name');
      const rawBeneficiary = getVal('beneficiary_name');
      const rawAccount = getVal('account_number');
      const rawIfsc = getVal('ifsc_code');
      const rawRemarks = getVal('remarks');

      // Skip blank rows
      if (!rawParty && !rawBeneficiary && !rawAccount && !rawIfsc && !rawRemarks) {
        continue;
      }

      const cleanedAccount = cleanAccountNumber(rawAccount);
      const cleanedIfsc = rawIfsc.replace(/\s+/g, '').toUpperCase();

      // Skip sample instruction row if left untouched
      if (isSampleTemplateRow(rawParty, cleanedAccount, rawRemarks)) {
        continue;
      }

      const partyName = rawParty;
      const beneficiaryName = rawBeneficiary || partyName;
      const errors: string[] = [];

      if (!partyName) {
        errors.push('Party Name required');
      }
      if (!beneficiaryName) {
        errors.push('Beneficiary Name required');
      }
      if (!cleanedAccount) {
        errors.push('Account Number required');
      } else if (!/^[A-Za-z0-9]+$/.test(cleanedAccount) || cleanedAccount.length < 6) {
        errors.push('Account Number must be at least 6 alphanumeric characters');
      }
      if (!cleanedIfsc || !IFSC_REGEX.test(cleanedIfsc)) {
        errors.push('Invalid IFSC (must be 11 chars e.g. UTIB0000412)');
      }

      let status: ParsedVendorStatus = 'valid';
      let errorMsg: string | undefined;

      if (errors.length > 0) {
        status = 'invalid';
        errorMsg = errors.join('; ');
      } else {
        const key = partyName.toLowerCase();
        if (existingPartySet.has(key)) {
          status = 'duplicate_existing';
          errorMsg = `Already exists in ${activeCompany.name}`;
        } else if (seenInFile.has(key)) {
          status = 'duplicate_in_file';
          errorMsg = 'Duplicate Party Name in this file';
        } else {
          seenInFile.add(key);
        }
      }

      parsedRows.push({
        rowNumber: entry.rowNumber,
        party_name: partyName,
        beneficiary_name: beneficiaryName,
        account_number: cleanedAccount,
        ifsc_code: cleanedIfsc,
        remarks: rawRemarks || null,
        status,
        error: errorMsg,
      });
    }

    const summary = {
      total: parsedRows.length,
      valid: parsedRows.filter((r) => r.status === 'valid').length,
      duplicates: parsedRows.filter(
        (r) => r.status === 'duplicate_existing' || r.status === 'duplicate_in_file'
      ).length,
      invalid: parsedRows.filter((r) => r.status === 'invalid').length,
    };

    return NextResponse.json({ rows: parsedRows, summary }, { status: 200 });
  } catch (err: unknown) {
    console.error('Vendor import parse error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to parse vendor upload file.' },
      { status: 500 }
    );
  }
}
