import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { createClient } from '@/lib/supabase/server';
import { getCurrentUserContext } from '@/lib/auth';
import { sanitizeSpreadsheetText } from '@/lib/format';

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

export async function GET(req: NextRequest) {
  try {
    const { user, profile, activeCompany } = await getCurrentUserContext();

    if (!user || !profile || !profile.is_active) {
      return NextResponse.json(
        { error: 'Unauthorized. Please sign in.' },
        { status: 401 }
      );
    }

    if (!activeCompany) {
      return NextResponse.json(
        { error: 'No active company workspace resolved.' },
        { status: 400 }
      );
    }

    const mode = req.nextUrl.searchParams.get('mode');
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Payment Desk';
    workbook.created = new Date();

    if (mode === 'template') {
      const sheet = workbook.addWorksheet('Vendors_Import_Template');

      sheet.columns = [
        { header: 'Party Name', key: 'partyName', width: 28 },
        { header: 'Beneficiary Name', key: 'beneficiaryName', width: 30 },
        { header: 'Account Number', key: 'accountNumber', width: 26, style: { numFmt: '@' } },
        { header: 'IFSC Code', key: 'ifscCode', width: 16 },
        { header: 'Remarks', key: 'remarks', width: 34 },
      ];

      styleHeaderRow(sheet);

      // Explicitly pre-format Column C (Account Number) as Text (@) across template rows
      const accountCol = sheet.getColumn(3);
      accountCol.numFmt = '@';

      const sampleRow = sheet.addRow({
        partyName: 'Naas Hardware',
        beneficiaryName: 'Manoj K',
        accountNumber: '918020045612890',
        ifscCode: 'UTIB0000412',
        remarks: 'Sample row - replace or delete',
      });

      const sampleAccCell = sampleRow.getCell('accountNumber');
      sampleAccCell.value = '918020045612890';
      sampleAccCell.numFmt = '@';

      // Pre-format blank data rows 3..200 Account Number column as Text so Excel keeps leading zeros
      for (let r = 3; r <= 200; r += 1) {
        sheet.getCell(r, 3).numFmt = '@';
      }

      const buffer = await workbook.xlsx.writeBuffer();
      const filename = 'Payment_Desk_Vendor_Import_Template.xlsx';

      return new NextResponse(new Uint8Array(buffer), {
        status: 200,
        headers: {
          'Content-Type':
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Cache-Control': 'no-store',
        },
      });
    }

    // Default mode: Export active company's vendors
    const supabase = await createClient();
    const { data: vendors, error } = await supabase
      .from('vendors')
      .select(
        'party_name, name, beneficiary_name, account_number, bank_account_no, ifsc_code, remarks, notes, is_active'
      )
      .eq('company_id', activeCompany.id)
      .order('party_name', { ascending: true });

    if (error) {
      return NextResponse.json(
        { error: error.message || 'Failed to fetch vendors.' },
        { status: 500 }
      );
    }

    const companyCode = (activeCompany.code || 'INDFURN')
      .replace(/[^a-zA-Z0-9_-]/g, '')
      .toUpperCase();
    const sheet = workbook.addWorksheet(`${companyCode}_Vendors`);

    sheet.columns = [
      { header: 'Party Name', key: 'partyName', width: 28 },
      { header: 'Beneficiary Name', key: 'beneficiaryName', width: 30 },
      { header: 'Account Number', key: 'accountNumber', width: 26, style: { numFmt: '@' } },
      { header: 'IFSC Code', key: 'ifscCode', width: 16 },
      { header: 'Remarks', key: 'remarks', width: 34 },
      { header: 'Status', key: 'status', width: 12 },
    ];

    styleHeaderRow(sheet);

    (vendors || []).forEach((v) => {
      const partyName = (v.party_name || v.name || '').trim();
      const beneficiaryName = (v.beneficiary_name || partyName).trim();
      const accountNumber = String(v.account_number || v.bank_account_no || '').trim();
      const ifscCode = (v.ifsc_code || '').trim().toUpperCase();
      const remarks = (v.remarks || v.notes || '').trim();
      const status = v.is_active ? 'Active' : 'Inactive';

      const addedRow = sheet.addRow({
        partyName: sanitizeSpreadsheetText(partyName),
        beneficiaryName: sanitizeSpreadsheetText(beneficiaryName),
        accountNumber,
        ifscCode,
        remarks: sanitizeSpreadsheetText(remarks),
        status,
      });

      const accCell = addedRow.getCell('accountNumber');
      accCell.value = accountNumber;
      accCell.numFmt = '@';
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const todayStr = new Date().toISOString().split('T')[0];
    const filename = `${companyCode}_Vendors_${todayStr}.xlsx`;

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err: unknown) {
    console.error('Vendor Excel export error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to export vendor Excel.' },
      { status: 500 }
    );
  }
}
