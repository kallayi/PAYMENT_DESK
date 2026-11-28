import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { createClient } from '@/lib/supabase/server';
import { getCurrentUserContext } from '@/lib/auth';

const MAX_IMPORT_BYTES = 4 * 1024 * 1024; // 4 MB
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
  | 'sr_no'
  | 'party_name'
  | 'beneficiary_name'
  | 'beneficiary_code'
  | 'account_number'
  | 'ifsc_code'
  | 'bank_name'
  | 'remarks';

const HEADER_ALIASES: Record<ColumnKey, string[]> = {
  sr_no: ['sr no', 'sr. no', 's no', 's. no', 'sl no', 'sl. no', 'serial no'],
  party_name: [
    'party name',
    'beneficiary code / party name',
    'vendor name',
    'trade name',
    'supplier name',
    'name',
  ],
  beneficiary_name: [
    'beneficiary name',
    'account holder',
    'payee name',
    'bank account name',
    'beneficiary name (bank a/c)',
  ],
  beneficiary_code: [
    'beneficiary code',
    'bene code',
    'vendor code',
    'party code',
    'code',
  ],
  account_number: [
    'beneficiary account number',
    'beneficiary account no',
    'beneficiary a/c',
    'beneficiary a/c no',
    'account number',
    'account no',
    'a/c no',
    'a/c number',
    'bank account no',
    'bank account number',
  ],
  ifsc_code: ['ifsc', 'ifsc code', 'beneficiary ifsc', 'beneficiary ifsc code'],
  bank_name: [
    'beneficiary bank name',
    'bank name',
    'payee bank',
    'beneficiary bank',
  ],
  remarks: ['remarks', 'notes', 'note', 'description'],
};

function normalizeHeaderPreservePunct(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeHeaderStripDots(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\./g, ' ')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchHeaderColumn(headerText: string): ColumnKey | null {
  const withDots = normalizeHeaderPreservePunct(headerText);
  const withoutDots = normalizeHeaderStripDots(headerText);
  if (!withDots && !withoutDots) return null;

  for (const [key, aliases] of Object.entries(HEADER_ALIASES) as Array<
    [ColumnKey, string[]]
  >) {
    if (aliases.includes(withDots) || aliases.includes(withoutDots)) {
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
    // Preserve formatted text when cell carries a leading-zero custom numFmt
    const fmt = typeof cell.numFmt === 'string' ? cell.numFmt : '';
    if (/^0+$/.test(fmt) && cell.text) {
      return cell.text.trim();
    }
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
        if (!Number.isFinite(val.result)) return '';
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
  // Never strip leading zeros (e.g. '0047083000000698' must remain intact)
  let cleaned = raw.trim().replace(/[\s-]+/g, '');
  if (/^\d+\.0+$/.test(cleaned)) {
    cleaned = cleaned.replace(/\.0+$/, '');
  }
  return cleaned;
}

function normalizeAccountKey(raw: string | null | undefined): string {
  return (raw || '').trim().replace(/[\s-]+/g, '').toUpperCase();
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

function isSampleTemplateRow(params: {
  partyName: string;
  beneficiaryName: string;
  accountNumber: string;
  beneficiaryCode: string;
  remarks: string;
}): boolean {
  const { partyName, beneficiaryName, accountNumber, beneficiaryCode, remarks } = params;
  if (remarks.toLowerCase().includes('sample row - replace or delete')) {
    return true;
  }
  if (
    partyName.toLowerCase() === 'naas hardware' &&
    accountNumber === '918020045612890'
  ) {
    return true;
  }
  if (
    accountNumber === '0047083000001234' &&
    (beneficiaryName.toLowerCase() === 'sample supplier pvt ltd' ||
      beneficiaryCode.toLowerCase() === 'samplesuppliersib1234')
  ) {
    return true;
  }
  return false;
}

function buildAutoRemarks(
  rawRemarks: string,
  beneficiaryCode: string,
  bankName: string
): string | null {
  if (rawRemarks) return rawRemarks;
  if (beneficiaryCode && bankName) return `Code: ${beneficiaryCode} · ${bankName}`;
  if (beneficiaryCode) return `Code: ${beneficiaryCode}`;
  if (bankName) return bankName;
  return null;
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
        { error: 'File size exceeds the 4 MB limit.' },
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
            'No data rows found. Ensure headers are present along with at least one vendor record.',
        },
        { status: 400 }
      );
    }

    // Scan first 5 non-empty rows to locate the header row cleanly
    let headerIdx = -1;
    let colIndexMap: Partial<Record<ColumnKey, number>> = {};

    const headerScanLimit = Math.min(rawMatrix.length, 5);
    for (let r = 0; r < headerScanLimit; r += 1) {
      const candidateMap: Partial<Record<ColumnKey, number>> = {};
      rawMatrix[r].cells.forEach((cellText, colIdx) => {
        const matched = matchHeaderColumn(cellText);
        if (matched && candidateMap[matched] === undefined) {
          candidateMap[matched] = colIdx;
        }
      });

      const hasAccount = candidateMap.account_number !== undefined;
      const hasIfsc = candidateMap.ifsc_code !== undefined;
      const hasName =
        candidateMap.beneficiary_name !== undefined ||
        candidateMap.party_name !== undefined;

      if (hasAccount && hasIfsc && hasName) {
        headerIdx = r;
        colIndexMap = candidateMap;
        break;
      }
    }

    if (headerIdx === -1) {
      return NextResponse.json(
        {
          error:
            'Required columns missing. Expected headers: "Sr. No", "Beneficiary Account Number", "Beneficiary Name", "Beneficiary Code", "IFSC code", "Beneficiary Bank Name" (or "Party Name"). Download the Sample Template (.xlsx) for exact formatting.',
        },
        { status: 400 }
      );
    }

    const dataRows = rawMatrix.slice(headerIdx + 1);
    if (dataRows.length > MAX_IMPORT_ROWS) {
      return NextResponse.json(
        {
          error: `File contains ${dataRows.length} rows. Please split uploads into batches of up to ${MAX_IMPORT_ROWS} rows.`,
        },
        { status: 400 }
      );
    }

    // Fetch existing vendors in activeCompany for both party_name AND account_number checks
    const supabase = await createClient();
    const { data: existingVendors, error: existingErr } = await supabase
      .from('vendors')
      .select('party_name, name, account_number, bank_account_no')
      .eq('company_id', activeCompany.id);

    if (existingErr) {
      return NextResponse.json(
        { error: existingErr.message || 'Failed to check existing company vendors.' },
        { status: 500 }
      );
    }

    const existingPartySet = new Set<string>();
    const existingAccountSet = new Set<string>();
    const existingPartyAccountsMap = new Map<string, Set<string>>();

    for (const v of existingVendors || []) {
      const party = (v.party_name || v.name || '').trim().toLowerCase();
      const accKey = normalizeAccountKey(v.account_number || v.bank_account_no);
      if (party) {
        existingPartySet.add(party);
        if (!existingPartyAccountsMap.has(party)) {
          existingPartyAccountsMap.set(party, new Set());
        }
        if (accKey) {
          existingPartyAccountsMap.get(party)!.add(accKey);
        }
      }
      if (accKey) {
        existingAccountSet.add(accKey);
      }
    }

    // Pass 1: Stage non-blank, non-sample rows & count distinct account numbers per baseName
    interface StagedRow {
      rowNumber: number;
      rawParty: string;
      rawBeneficiary: string;
      rawCode: string;
      cleanedAccount: string;
      accKey: string;
      cleanedIfsc: string;
      rawBankName: string;
      rawRemarks: string;
    }

    const stagedRows: StagedRow[] = [];
    const fileAccountsByBaseName = new Map<string, Set<string>>();

    for (const entry of dataRows) {
      const getVal = (key: ColumnKey): string => {
        const idx = colIndexMap[key];
        return idx !== undefined ? (entry.cells[idx] || '').trim() : '';
      };

      const rawParty = getVal('party_name');
      const rawBeneficiary = getVal('beneficiary_name');
      const rawCode = getVal('beneficiary_code');
      const rawAccount = getVal('account_number');
      const rawIfsc = getVal('ifsc_code');
      const rawBankName = getVal('bank_name');
      const rawRemarks = getVal('remarks');

      if (
        !rawParty &&
        !rawBeneficiary &&
        !rawCode &&
        !rawAccount &&
        !rawIfsc &&
        !rawBankName &&
        !rawRemarks
      ) {
        continue;
      }

      const cleanedAccount = cleanAccountNumber(rawAccount);
      const cleanedIfsc = rawIfsc.replace(/\s+/g, '').toUpperCase();

      if (
        isSampleTemplateRow({
          partyName: rawParty,
          beneficiaryName: rawBeneficiary,
          accountNumber: cleanedAccount,
          beneficiaryCode: rawCode,
          remarks: rawRemarks,
        })
      ) {
        continue;
      }

      const accKey = normalizeAccountKey(cleanedAccount);
      const baseNameKey = (rawParty || rawBeneficiary).trim().toLowerCase();
      if (baseNameKey && !rawParty) {
        if (!fileAccountsByBaseName.has(baseNameKey)) {
          fileAccountsByBaseName.set(baseNameKey, new Set());
        }
        fileAccountsByBaseName.get(baseNameKey)!.add(accKey || `ROW_${entry.rowNumber}`);
      }

      stagedRows.push({
        rowNumber: entry.rowNumber,
        rawParty,
        rawBeneficiary,
        rawCode,
        cleanedAccount,
        accKey,
        cleanedIfsc,
        rawBankName,
        rawRemarks,
      });
    }

    // Pass 2: Derive deterministic party_name, remarks, validate & detect duplicates
    const seenAccountSet = new Set<string>();
    const seenPartySet = new Set<string>();
    const parsedRows: ParsedVendorRow[] = [];

    for (const row of stagedRows) {
      const beneficiaryName = row.rawBeneficiary || row.rawParty;

      let partyName = row.rawParty;
      if (!partyName && beneficiaryName) {
        const baseKey = beneficiaryName.toLowerCase();
        const fileDistinctAccounts = fileAccountsByBaseName.get(baseKey)?.size || 0;
        const dbAccountsForBase = existingPartyAccountsMap.get(baseKey);
        const dbHasDifferentAccount = Boolean(
          dbAccountsForBase &&
            dbAccountsForBase.size > 0 &&
            (!row.accKey || !dbAccountsForBase.has(row.accKey))
        );

        if (fileDistinctAccounts > 1 || dbHasDifferentAccount) {
          const prefix = row.cleanedIfsc.slice(0, 4) || 'BANK';
          const last4 = row.cleanedAccount.slice(-4) || 'ACCT';
          partyName = row.rawCode
            ? `${beneficiaryName} (${row.rawCode})`
            : `${beneficiaryName} (${prefix} · ${last4})`;

          // Ensure disambiguated party_name stays unique across distinct accounts even if code collides
          const isNewAccount =
            row.accKey &&
            !existingAccountSet.has(row.accKey) &&
            !seenAccountSet.has(row.accKey);
          if (
            isNewAccount &&
            (existingPartySet.has(partyName.toLowerCase()) ||
              seenPartySet.has(partyName.toLowerCase()))
          ) {
            partyName = row.rawCode
              ? `${beneficiaryName} (${row.rawCode} · ${last4})`
              : `${beneficiaryName} (${prefix} · ${row.cleanedAccount})`;
          }
        } else {
          partyName = beneficiaryName;
        }
      }

      const remarks = buildAutoRemarks(row.rawRemarks, row.rawCode, row.rawBankName);
      const errors: string[] = [];

      if (!partyName) {
        errors.push('Party Name required');
      }
      if (!beneficiaryName) {
        errors.push('Beneficiary Name required');
      }
      if (!row.cleanedAccount) {
        errors.push('Account Number required');
      } else if (
        !/^[A-Za-z0-9]+$/.test(row.cleanedAccount) ||
        row.cleanedAccount.length < 6
      ) {
        errors.push('Account Number must be at least 6 alphanumeric characters');
      }
      if (!row.cleanedIfsc || !IFSC_REGEX.test(row.cleanedIfsc)) {
        errors.push('Invalid IFSC (must be 11 chars e.g. UTIB0000412)');
      }

      let status: ParsedVendorStatus = 'valid';
      let errorMsg: string | undefined;

      if (errors.length > 0) {
        status = 'invalid';
        errorMsg = errors.join('; ');
      } else {
        const partyKey = partyName.toLowerCase();
        if (row.accKey && existingAccountSet.has(row.accKey)) {
          status = 'duplicate_existing';
          errorMsg = `Account number already exists in ${activeCompany.name}`;
        } else if (existingPartySet.has(partyKey)) {
          status = 'duplicate_existing';
          errorMsg = `Already exists in ${activeCompany.name}`;
        } else if (row.accKey && seenAccountSet.has(row.accKey)) {
          status = 'duplicate_in_file';
          errorMsg = 'Duplicate Account Number in this file';
        } else if (seenPartySet.has(partyKey)) {
          status = 'duplicate_in_file';
          errorMsg = 'Duplicate Party Name in this file';
        } else {
          if (row.accKey) seenAccountSet.add(row.accKey);
          seenPartySet.add(partyKey);
        }
      }

      parsedRows.push({
        rowNumber: row.rowNumber,
        party_name: partyName,
        beneficiary_name: beneficiaryName,
        account_number: row.cleanedAccount,
        ifsc_code: row.cleanedIfsc,
        remarks,
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
