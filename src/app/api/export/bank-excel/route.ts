import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getCurrentUserContext } from '@/lib/auth';
import {
  getBankTemplateAdapter,
  splitRowsByIfsc,
  type BulkExportRow,
} from '@/lib/excel';

const exportRequestSchema = z.object({
  paymentIds: z.array(z.string().uuid()).min(1, 'At least one approved payment must be selected.'),
  bankId: z.string().uuid('A valid source bank ID is required.'),
  batchType: z.enum(['same_bank', 'other_bank', 'combined']),
});

export async function POST(req: NextRequest) {
  try {
    const { user, profile, activeCompany } = await getCurrentUserContext();

    if (!user || !profile || !profile.is_active) {
      return NextResponse.json(
        { error: 'Unauthorized. Please sign in.' },
        { status: 401 }
      );
    }

    // Strictly verify active PREPARER or is_admin = true
    if (profile.role !== 'PREPARER' && !profile.is_admin) {
      return NextResponse.json(
        { error: 'Access denied: Only Preparers or Administrators can export bank bulk files.' },
        { status: 403 }
      );
    }

    if (!activeCompany) {
      return NextResponse.json(
        { error: 'No active company workspace resolved.' },
        { status: 400 }
      );
    }

    const body = await req.json();
    const parsed = exportRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'Invalid export request payload.' },
        { status: 400 }
      );
    }

    const { paymentIds, bankId, batchType } = parsed.data;
    const supabase = await createClient();

    // Verify source bank belongs to activeCompany (explicitly select full_debit_account_number for PREPARER/is_admin)
    const { data: bank, error: bankError } = await supabase
      .from('company_banks')
      .select(
        'id, company_id, short_code, short_name, ifsc_prefix, bank_name, full_name, full_debit_account_number'
      )
      .eq('id', bankId)
      .eq('company_id', activeCompany.id)
      .single();

    if (bankError || !bank) {
      return NextResponse.json(
        { error: 'Selected bank not found for the active company.' },
        { status: 404 }
      );
    }

    const bankShortCode = (bank.short_code || bank.short_name || 'BANK').trim().toUpperCase();
    const bankIfscPrefix = (bank.ifsc_prefix || '').trim().toUpperCase();
    const fullDebitAccount = (bank.full_debit_account_number || '').trim();

    // Query APPROVED, NEFT_RTGS items scoped strictly to activeCompany and selected bank
    const { data: items, error: itemsError } = await supabase
      .from('payment_items')
      .select(
        'id, invoice_ref, purpose, sheet_date, net_payable, payment_mode, vendor:vendors(id, name, party_name, beneficiary_name, account_number, ifsc_code, whatsapp_number)'
      )
      .eq('company_id', activeCompany.id)
      .eq('status', 'APPROVED')
      .eq('payment_mode', 'NEFT_RTGS')
      .eq('source_bank_id', bankId)
      .in('id', paymentIds)
      .order('due_date', { ascending: true });

    if (itemsError) {
      return NextResponse.json(
        { error: itemsError.message || 'Failed to query approved payment items.' },
        { status: 500 }
      );
    }

    if (!items || items.length === 0) {
      return NextResponse.json(
        { error: 'No eligible APPROVED NEFT/RTGS payments found for the selected bank.' },
        { status: 400 }
      );
    }

    const companyCode = (activeCompany.code || 'INDFURN').trim().toUpperCase();

    const exportRows: BulkExportRow[] = items.map((item: any) => {
      const v = item.vendor || {};
      const partyName = (v.party_name || v.name || 'Unknown Party').trim();
      const beneficiaryName = (v.beneficiary_name || partyName).trim();
      const accountNumber = (v.account_number || '').trim();
      const ifscCode = (v.ifsc_code || '').trim().toUpperCase();

      return {
        paymentId: item.id,
        partyName,
        beneficiaryName,
        accountNumber,
        ifscCode,
        netPayable: Number(item.net_payable || 0),
        invoiceRef: item.invoice_ref || '',
        purpose: item.purpose || '',
        sheetDate: item.sheet_date || new Date().toISOString().split('T')[0],
        sourceBankShortCode: bankShortCode,
        sourceBankIfscPrefix: bankIfscPrefix,
        sourceBankDebitAccount: fullDebitAccount,
        whatsappNumber: v.whatsapp_number || null,
        companyCode,
        paymentMode: item.payment_mode,
      };
    });

    const split = splitRowsByIfsc(exportRows, bankIfscPrefix);
    const targetRows =
      batchType === 'combined'
        ? exportRows
        : batchType === 'same_bank'
          ? split.sameBankRows
          : split.otherBankRows;

    if (targetRows.length === 0) {
      return NextResponse.json(
        {
          error:
            batchType === 'same_bank'
              ? `No Same-Bank (${bankIfscPrefix}) entries found in this selection.`
              : batchType === 'other_bank'
                ? `No Other-Bank (NEFT/RTGS) entries found in this selection.`
                : `No eligible NEFT/RTGS entries found in this selection.`,
        },
        { status: 400 }
      );
    }

    const adapter = getBankTemplateAdapter(bankShortCode, bankIfscPrefix);
    const workbookBuffer =
      batchType === 'combined'
        ? await adapter.buildCombinedWorkbook(targetRows)
        : batchType === 'same_bank'
          ? await adapter.buildSameBankWorkbook(targetRows)
          : await adapter.buildOtherBankWorkbook(targetRows);

    const todayStr = new Date().toISOString().split('T')[0];
    const batchLabel =
      batchType === 'combined'
        ? 'ALL_BANKS'
        : batchType === 'same_bank'
          ? 'SAME_BANK'
          : 'OTHER_BANK';
    const filename = `${companyCode}_${bankShortCode}_${batchLabel}_${todayStr}.xlsx`;

    return new NextResponse(new Uint8Array(workbookBuffer), {
      status: 200,
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err: unknown) {
    console.error('Bank Excel export error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to generate Excel workbook.' },
      { status: 500 }
    );
  }
}
