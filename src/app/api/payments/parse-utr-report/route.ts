import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { getCurrentUserContext } from '@/lib/auth';

const MAX_REPORT_BYTES = 4 * 1024 * 1024; // 4 MB
const MAX_REPORT_ROWS = 1000;

export interface ParsedUtrReportRow {
  utr: string;
  accountNumber: string;
  amount: number | null;
  beneficiaryName: string;
  status: string | null;
}

type ColumnKey =
  | 'utr'
  | 'accountNumber'
  | 'amount'
  | 'beneficiaryName'
  | 'status';

const HEADER_ALIASES: Record<ColumnKey, string[]> = {
  utr: [
    'utr',
    'utr number',
    'utr no',
    'utr / ref no',
    'utr ref no',
    'bank reference',
    'bank reference number',
    'bank ref no',
    'bank ref',
    'transaction reference',
    'transaction reference no',
    'transaction reference number',
    'transaction ref',
    'reference no',
    'reference number',
    'rrn',
    'payment reference',
    'payment ref',
  ],
  accountNumber: [
    'beneficiary account',
    'beneficiary account number',
    'beneficiary account no',
    'beneficiary a/c',
    'beneficiary a/c no',
    'credit account',
    'credit account no',
    'credit account number',
    'account number',
    'account no',
    'a/c no',
    'a/c number',
  ],
  amount: [
    'amount',
    'transaction amount',
    'txn amount',
    'net amount',
    'payable amount',
    'debit amount',
    'credit amount',
  ],
  beneficiaryName: [
    'beneficiary name',
    'payee name',
    'party name',
    'credit party name',
  ],
  status: ['status', 'transaction status', 'payment status', 'txn status'],
};

const FAILED_STATUS_KEYWORDS = [
  'failed',
  'fail',
  'rejected',
  'reject',
  'returned',
  'return',
  'reversed',
  'reverse',
  'cancelled',
  'cancel',
  'unsuccessful',
  'declined',
];

function normalizeHeaderPreserveSlash(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[()[\]]/g, ' ')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchHeaderColumn(headerText: string): ColumnKey | null {
  const norm = normalizeHeaderPreserveSlash(headerText);
  if (!norm) return null;
  const normNoSlash = norm.replace(/\//g, ' ').replace(/\s+/g, ' ').trim();

  for (const [key, aliases] of Object.entries(HEADER_ALIASES) as Array<
    [ColumnKey, string[]]
  >) {
    if (aliases.includes(norm) || aliases.includes(normNoSlash)) {
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
  let cleaned = raw.trim().replace(/[\s-]+/g, '');
  if (/^\d+\.0+$/.test(cleaned)) {
    cleaned = cleaned.replace(/\.0+$/, '');
  }
  return cleaned.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

function cleanUtrValue(raw: string): string {
  let cleaned = raw.trim();
  if (/^\d+\.0+$/.test(cleaned)) {
    cleaned = cleaned.replace(/\.0+$/, '');
  }
  return cleaned.replace(/\s+/g, '').toUpperCase();
}

function parseReportAmount(raw: string): number | null {
  const cleaned = raw.replace(/[^0-9.-]/g, '').trim();
  if (!cleaned) return null;
  const num = Number.parseFloat(cleaned);
  if (!Number.isFinite(num) || num <= 0) return null;
  return Math.round(num * 100) / 100;
}

function isFailedTransactionStatus(rawStatus: string): boolean {
  const lower = rawStatus.trim().toLowerCase();
  if (!lower) return false;
  return FAILED_STATUS_KEYWORDS.some((kw) => lower.includes(kw));
}

function parseCsvMatrix(csvText: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;

  const text = csvText.replace(/^\uFEFF/, '');

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

export async function POST(req: NextRequest) {
  try {
    const { user, profile, activeCompany } = await getCurrentUserContext();

    if (!user || !profile || !profile.is_active) {
      return NextResponse.json(
        { error: 'Unauthorized. Please sign in.' },
        { status: 401 }
      );
    }

    if (profile.role !== 'PREPARER' && !profile.is_admin) {
      return NextResponse.json(
        {
          error:
            'Access denied: Only Preparers or Administrators can parse bank UTR reports.',
        },
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
        { error: 'Please select a .xlsx or .csv bank status report.' },
        { status: 400 }
      );
    }

    if (file.size > MAX_REPORT_BYTES) {
      return NextResponse.json(
        { error: 'Bank report file exceeds the 4 MB limit.' },
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

    const rawMatrix: string[][] = [];

    if (isCsv) {
      const text = await file.text();
      const parsedCsv = parseCsvMatrix(text);
      for (const cells of parsedCsv) {
        if (cells.some((c) => c.trim().length > 0)) {
          rawMatrix.push(cells);
        }
      }
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

      worksheet.eachRow({ includeEmpty: false }, (row) => {
        const maxCol = Math.max(row.cellCount, worksheet.columnCount || 0, 12);
        const cells: string[] = [];
        for (let col = 1; col <= maxCol; col += 1) {
          cells.push(extractExcelCellText(row.getCell(col)));
        }
        if (cells.some((c) => c.length > 0)) {
          rawMatrix.push(cells);
        }
      });
    }

    if (rawMatrix.length < 2) {
      return NextResponse.json(
        {
          error:
            'No transaction rows found in the uploaded bank status report.',
        },
        { status: 400 }
      );
    }

    // Scan first 10 non-empty rows to locate the best matching table header row
    let bestHeaderIndex = -1;
    let bestColMap: Partial<Record<ColumnKey, number>> = {};
    let bestScore = -1;

    const scanLimit = Math.min(rawMatrix.length, 10);
    for (let rIdx = 0; rIdx < scanLimit; rIdx += 1) {
      const rowCells = rawMatrix[rIdx];
      const candidateMap: Partial<Record<ColumnKey, number>> = {};

      rowCells.forEach((cellText, colIdx) => {
        const matched = matchHeaderColumn(cellText);
        if (matched && candidateMap[matched] === undefined) {
          candidateMap[matched] = colIdx;
        }
      });

      const matchedKeys = Object.keys(candidateMap).length;
      if (candidateMap.utr !== undefined && matchedKeys > bestScore) {
        bestScore = matchedKeys;
        bestHeaderIndex = rIdx;
        bestColMap = candidateMap;
      }
    }

    if (bestHeaderIndex === -1 || bestColMap.utr === undefined) {
      return NextResponse.json(
        {
          error:
            'Could not detect a UTR / Bank Reference column in the first 10 rows. Ensure the file has columns like "UTR Number", "Beneficiary Account Number", and "Amount".',
        },
        { status: 400 }
      );
    }

    const dataRows = rawMatrix.slice(bestHeaderIndex + 1, bestHeaderIndex + 1 + MAX_REPORT_ROWS);
    const rows: ParsedUtrReportRow[] = [];
    let skippedFailedCount = 0;

    for (const cells of dataRows) {
      const getVal = (key: ColumnKey): string => {
        const idx = bestColMap[key];
        return idx !== undefined ? (cells[idx] || '').trim() : '';
      };

      const rawStatus = getVal('status');
      if (rawStatus && isFailedTransactionStatus(rawStatus)) {
        skippedFailedCount += 1;
        continue;
      }

      const rawUtr = getVal('utr');
      const utr = cleanUtrValue(rawUtr);
      if (!utr || utr === 'UTR' || utr === 'TOTAL') {
        continue;
      }

      const accountNumber = cleanAccountNumber(getVal('accountNumber'));
      const amount = parseReportAmount(getVal('amount'));
      const beneficiaryName = getVal('beneficiaryName');

      rows.push({
        utr,
        accountNumber,
        amount,
        beneficiaryName,
        status: rawStatus || null,
      });
    }

    return NextResponse.json(
      {
        rows,
        skippedFailedCount,
      },
      { status: 200 }
    );
  } catch (err: unknown) {
    console.error('[ParseUtrReport] Error:', err);
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : 'Failed to parse bank UTR report.',
      },
      { status: 500 }
    );
  }
}

