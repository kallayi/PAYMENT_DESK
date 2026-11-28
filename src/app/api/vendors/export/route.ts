import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { createClient } from '@/lib/supabase/server';
import { getCurrentUserContext } from '@/lib/auth';
import { getBankNameFromIfsc } from '@/lib/bank-names';
import { getTodayISTDateString, sanitizeSpreadsheetText } from '@/lib/format';

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
      const sheet = workbook.addWorksheet('Sheet 1');

      sheet.columns = [
        { header: 'Sr. No', key: 'srNo', width: 10 },
        {
          header: 'Beneficiary Account Number',
          key: 'accountNumber',
          width: 26,
          style: { numFmt: '@' },
        },
        { header: 'Beneficiary Name', key: 'beneficiaryName', width: 36 },
        { header: 'Beneficiary Code', key: 'beneficiaryCode', width: 24 },
        { header: 'IFSC code', key: 'ifscCode', width: 16 },
        { header: 'Beneficiary Bank Name', key: 'bankName', width: 30 },
      ];

      styleHeaderRow(sheet);

      // Pre-format Column B (Beneficiary Account Number) as Text (@) so leading zeros stay intact
      const accountCol = sheet.getColumn(2);
      accountCol.numFmt = '@';

      const sampleRow = sheet.addRow({
        srNo: 1,
        accountNumber: '0047083000001234',
        beneficiaryName: 'SAMPLE SUPPLIER PVT LTD',
        beneficiaryCode: 'SampleSupplierSIB1234',
        ifscCode: 'SIBL0000047',
        bankName: 'SOUTH INDIAN BANK',
      });

      const sampleAccCell = sampleRow.getCell('accountNumber');
      sampleAccCell.value = '0047083000001234';
      sampleAccCell.numFmt = '@';

      // Pre-format rows 2..500 Account Number column as Text (@)
      for (let r = 2; r <= 500; r += 1) {
        sheet.getCell(r, 2).numFmt = '@';
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

    // Default mode: Export active company's vendors aligned with official 6-col bank format
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
      { header: 'Sr. No', key: 'srNo', width: 10 },
      {
        header: 'Beneficiary Account Number',
        key: 'accountNumber',
        width: 26,
        style: { numFmt: '@' },
      },
      { header: 'Beneficiary Name', key: 'beneficiaryName', width: 36 },
      { header: 'Beneficiary Code / Party Name', key: 'partyName', width: 30 },
      { header: 'IFSC code', key: 'ifscCode', width: 16 },
      { header: 'Beneficiary Bank Name', key: 'bankName', width: 28 },
      { header: 'Remarks', key: 'remarks', width: 32 },
      { header: 'Status', key: 'status', width: 12 },
    ];

    styleHeaderRow(sheet);
    sheet.getColumn(2).numFmt = '@';

    (vendors || []).forEach((v, idx) => {
      const rawPartyName = (v.party_name || v.name || '').trim();
      const rawBeneficiaryName = (v.beneficiary_name || rawPartyName).trim();
      const accountNumber = String(v.account_number || v.bank_account_no || '').trim();
      const ifscCode = (v.ifsc_code || '').trim().toUpperCase();
      const derivedBankName = getBankNameFromIfsc(ifscCode);
      const rawRemarks = (v.remarks || v.notes || '').trim();
      const status = v.is_active ? 'Active' : 'Inactive';

      const addedRow = sheet.addRow({
        srNo: idx + 1,
        accountNumber,
        beneficiaryName: sanitizeSpreadsheetText(rawBeneficiaryName),
        partyName: sanitizeSpreadsheetText(rawPartyName),
        ifscCode,
        bankName:
          derivedBankName === '—'
            ? '—'
            : sanitizeSpreadsheetText(derivedBankName),
        remarks: sanitizeSpreadsheetText(rawRemarks),
        status,
      });

      const accCell = addedRow.getCell('accountNumber');
      accCell.value = accountNumber;
      accCell.numFmt = '@';
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const todayStr = getTodayISTDateString();
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
