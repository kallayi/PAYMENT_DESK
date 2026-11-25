'use client';

import * as React from 'react';
import { toPng } from 'html-to-image';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Download,
  Printer,
  Copy,
  Check,
  Loader2,
  MessageCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { getBankNameFromIfsc } from '@/lib/bank-names';
import { formatDDMMYYYY, formatINRPlain } from '@/lib/format';
import type { Company, PaymentItem } from '@/types/database';

interface PaymentAcknowledgementModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payment: PaymentItem | null;
  activeCompany?: Company | null;
  fallbackUserName?: string;
}

function formatDateAndTime24(isoString: string | null | undefined): string {
  if (!isoString) return '—';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${dd}-${mm}-${yyyy} ${hh}:${min}`;
  } catch {
    return isoString;
  }
}

function toTitleCaseCompany(code: string): string {
  const upper = code.trim().toUpperCase();
  if (upper === 'INDFURN') return 'Indfurn';
  if (upper === 'VINMORE') return 'Vinmore';
  return code;
}

function sanitizeFilenamePart(val: string): string {
  return (val || 'Advice').replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32);
}

export function PaymentAcknowledgementModal({
  open,
  onOpenChange,
  payment,
  activeCompany,
  fallbackUserName = 'Accounts Team',
}: PaymentAcknowledgementModalProps) {
  const slipRef = React.useRef<HTMLDivElement | null>(null);
  const [isExporting, setIsExporting] = React.useState<
    'WHATSAPP' | 'COPY' | 'PNG' | null
  >(null);
  const [copiedImage, setCopiedImage] = React.useState<boolean>(false);

  if (!payment) return null;

  const companyCode = (
    activeCompany?.code ||
    payment.company?.code ||
    'INDFURN'
  )
    .trim()
    .toUpperCase();
  const companyTitle = toTitleCaseCompany(companyCode);
  const companyEmail =
    activeCompany?.contact_email ||
    payment.company?.contact_email ||
    (companyCode === 'INDFURN' ? 'info@indfurn.in' : '');
  const companyPhone =
    activeCompany?.contact_phone ||
    payment.company?.contact_phone ||
    (companyCode === 'INDFURN' ? '9539 661 661' : '');

  const isCheque = payment.payment_mode === 'CHEQUE';
  const netPayable = Number(payment.net_payable || 0);
  const modeOfTransfer = isCheque
    ? 'CHEQUE'
    : netPayable >= 200000
      ? 'RTGS'
      : 'NEFT';

  const sourceBankName =
    payment.source_bank?.bank_name || payment.source_bank?.full_name || 'Axis Bank';
  const sourceAccountMasked =
    payment.source_bank?.account_number_masked ||
    payment.source_bank?.account_mask ||
    'XXXX XXXX XXX 5074';

  const paidDateOnly = payment.paid_at
    ? new Date(payment.paid_at).toISOString().split('T')[0]
    : payment.sheet_date;
  const transactionDateFormatted = formatDDMMYYYY(paidDateOnly);

  const partyName =
    payment.vendor?.party_name || payment.vendor?.name || 'Supplier';
  const beneficiaryName =
    payment.vendor?.beneficiary_name || partyName;
  const payeeBankName = getBankNameFromIfsc(payment.vendor?.ifsc_code);
  const payeeAccountNo =
    payment.vendor?.account_number || payment.vendor?.bank_account_no || '—';

  const referenceId =
    payment.invoice_ref || payment.id.slice(0, 8).toUpperCase();
  const settlementRef = isCheque
    ? payment.cheque_number || '—'
    : payment.utr_number || '—';
  const paidUserName = payment.payer?.full_name || fallbackUserName;
  const paidTimestampFormatted = formatDateAndTime24(
    payment.paid_at || payment.updated_at
  );

  const fileName = `${companyCode}_Payment_Advice_${sanitizeFilenamePart(
    beneficiaryName
  )}_${sanitizeFilenamePart(settlementRef)}.png`;

  const renderSlipToPngDataUrl = async (): Promise<string> => {
    if (!slipRef.current) {
      throw new Error('Payment advice slip is not ready.');
    }
    return toPng(slipRef.current, {
      pixelRatio: 2,
      backgroundColor: '#ffffff',
      cacheBust: true,
    });
  };

  const renderSlipToPngBlob = async (): Promise<{ dataUrl: string; blob: Blob }> => {
    const dataUrl = await renderSlipToPngDataUrl();
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    return { dataUrl, blob };
  };

  const copyPngBlobToClipboard = async (blob: Blob): Promise<boolean> => {
    if (
      typeof navigator === 'undefined' ||
      !navigator.clipboard ||
      typeof navigator.clipboard.write !== 'function' ||
      typeof ClipboardItem === 'undefined'
    ) {
      return false;
    }
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      return true;
    } catch {
      return false;
    }
  };

  const triggerBrowserDownload = (dataUrl: string, name: string) => {
    const link = document.createElement('a');
    link.download = name;
    link.href = dataUrl;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleDownloadPng = async () => {
    setIsExporting('PNG');
    try {
      const dataUrl = await renderSlipToPngDataUrl();
      triggerBrowserDownload(dataUrl, fileName);
      toast.success('Payment Acknowledgement PNG downloaded.');
    } catch {
      toast.error('Failed to render Payment Acknowledgement image.');
    } finally {
      setIsExporting(null);
    }
  };

  const handleCopyImage = async () => {
    setIsExporting('COPY');
    try {
      const { dataUrl, blob } = await renderSlipToPngBlob();
      const copied = await copyPngBlobToClipboard(blob);
      if (copied) {
        setCopiedImage(true);
        setTimeout(() => setCopiedImage(false), 2500);
        toast.success('Payment Acknowledgement image copied! Paste (Ctrl+V) in WhatsApp.');
      } else {
        triggerBrowserDownload(dataUrl, fileName);
        toast.info('Clipboard image copy unavailable in this browser — downloaded PNG instead.');
      }
    } catch {
      toast.error('Failed to copy Payment Acknowledgement image.');
    } finally {
      setIsExporting(null);
    }
  };

  const handleShareWhatsApp = async () => {
    setIsExporting('WHATSAPP');
    try {
      const { dataUrl, blob } = await renderSlipToPngBlob();
      const pngFile = new File([blob], fileName, { type: 'image/png' });

      // Mobile / Web Share API with attached PNG file (pure manual contact/group picker)
      if (
        typeof navigator !== 'undefined' &&
        typeof navigator.canShare === 'function' &&
        navigator.canShare({ files: [pngFile] })
      ) {
        try {
          await navigator.share({
            files: [pngFile],
            title: 'Payment Acknowledgement',
          });
          return;
        } catch (shareErr: unknown) {
          if (shareErr instanceof Error && shareErr.name === 'AbortError') {
            return;
          }
          // Fall through to desktop clipboard + WhatsApp Web flow if share fails
        }
      }

      // Desktop fallback: copy image to clipboard (or download if clipboard fails) + open WhatsApp Web contact picker
      const copied = await copyPngBlobToClipboard(blob);
      if (!copied) {
        triggerBrowserDownload(dataUrl, fileName);
      }

      window.open('https://web.whatsapp.com/', '_blank', 'noopener,noreferrer');

      if (copied) {
        toast.success(
          'Payment Acknowledgement image copied! Select the contact in WhatsApp and press Ctrl+V to send.'
        );
      } else {
        toast.success(
          'Payment Acknowledgement PNG downloaded! Select the contact in WhatsApp and attach the image.'
        );
      }
    } catch {
      toast.error('Could not prepare WhatsApp Payment Acknowledgement.');
    } finally {
      setIsExporting(null);
    }
  };

  const handlePrintPdf = () => {
    document.body.classList.add('printing-advice');
    const cleanup = () => {
      document.body.classList.remove('printing-advice');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    setTimeout(() => {
      window.print();
    }, 60);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-1rem)] sm:w-[calc(100vw-2rem)] max-w-2xl max-h-[92dvh] p-0 flex flex-col bg-slate-100 overflow-hidden gap-0">
        <DialogHeader className="px-4 sm:px-5 py-3.5 pr-10 bg-white border-b border-slate-200 space-y-0.5 shrink-0">
          <DialogTitle className="text-sm font-bold text-slate-900">
            Payment Acknowledgement (Payment Advice)
          </DialogTitle>
          <DialogDescription className="text-[11px] text-slate-500">
            Share directly via WhatsApp, download PNG, or print/save as PDF.
          </DialogDescription>
        </DialogHeader>

        {/* SCROLLABLE SLIP PREVIEW */}
        <div className="flex-1 overflow-y-auto p-2.5 sm:p-6 flex justify-center">
          <div
            ref={slipRef}
            id="printable-advice-slip"
            className="relative w-full max-w-[600px] bg-white border border-slate-200 shadow-sm rounded-sm px-4 py-5 sm:px-10 sm:py-9 text-slate-900 overflow-hidden"
            style={{ fontFamily: 'Inter, system-ui, -apple-system, sans-serif' }}
          >
            {/* Subtle Center / Diagonal Watermark */}
            <div
              aria-hidden="true"
              className="pointer-events-none select-none absolute inset-0 flex items-center justify-center overflow-hidden"
            >
              <span className="text-[64px] sm:text-[78px] font-black tracking-[0.28em] text-slate-200/45 -rotate-12 uppercase whitespace-nowrap">
                {companyCode}
              </span>
            </div>

            {/* Foreground Content */}
            <div className="relative z-10 space-y-5 text-[13px] leading-relaxed">
              {/* Top-Right Spaced Company Header */}
              <div className="flex items-center justify-end pb-1">
                <span className="text-sm font-semibold tracking-[0.38em] text-slate-500 uppercase">
                  {companyCode}
                </span>
              </div>

              {/* Greeting */}
              <div className="space-y-1.5 text-slate-800">
                <p className="font-medium">Dear Sir/Madam,</p>
                <p className="text-[12.5px] text-slate-700 leading-snug">
                  We would like to inform you that we have successfully processed your payment. Please find the payment details below for your reference.
                </p>
              </div>

              {/* Section 1: Payment Details */}
              <div className="pt-1">
                <h3 className="text-[13px] font-bold text-slate-900 border-b border-slate-200 pb-1 mb-2.5">
                  Payment Details
                </h3>
                <div className="space-y-1.5 text-[12.5px]">
                  <div className="grid grid-cols-12 items-baseline">
                    <span className="col-span-5 text-slate-600">Reference ID</span>
                    <span className="col-span-1 text-center text-slate-500">:</span>
                    <span className="col-span-6 font-medium text-slate-900 font-mono">
                      {referenceId}
                    </span>
                  </div>

                  {!isCheque ? (
                    <div className="grid grid-cols-12 items-baseline">
                      <span className="col-span-5 text-slate-600">UTR Number</span>
                      <span className="col-span-1 text-center text-slate-500">:</span>
                      <span className="col-span-6 font-bold text-slate-900 font-mono">
                        {settlementRef}
                      </span>
                    </div>
                  ) : (
                    <>
                      <div className="grid grid-cols-12 items-baseline">
                        <span className="col-span-5 text-slate-600">Cheque Number</span>
                        <span className="col-span-1 text-center text-slate-500">:</span>
                        <span className="col-span-6 font-bold text-slate-900 font-mono">
                          {settlementRef}
                        </span>
                      </div>
                      <div className="grid grid-cols-12 items-baseline">
                        <span className="col-span-5 text-slate-600">Cheque Date</span>
                        <span className="col-span-1 text-center text-slate-500">:</span>
                        <span className="col-span-6 font-medium text-slate-900 tabular-nums">
                          {formatDDMMYYYY(payment.cheque_date)}
                        </span>
                      </div>
                    </>
                  )}

                  <div className="grid grid-cols-12 items-baseline">
                    <span className="col-span-5 text-slate-600">Mode of Transfer</span>
                    <span className="col-span-1 text-center text-slate-500">:</span>
                    <span className="col-span-6 font-medium text-slate-900">
                      {modeOfTransfer}
                    </span>
                  </div>

                  <div className="grid grid-cols-12 items-baseline">
                    <span className="col-span-5 text-slate-600">Bank Name</span>
                    <span className="col-span-1 text-center text-slate-500">:</span>
                    <span className="col-span-6 font-medium text-slate-900">
                      {sourceBankName}
                    </span>
                  </div>

                  <div className="grid grid-cols-12 items-baseline">
                    <span className="col-span-5 text-slate-600">Account Number</span>
                    <span className="col-span-1 text-center text-slate-500">:</span>
                    <span className="col-span-6 font-medium text-slate-900 font-mono tabular-nums">
                      {sourceAccountMasked}
                    </span>
                  </div>

                  <div className="grid grid-cols-12 items-baseline">
                    <span className="col-span-5 text-slate-600">Amount</span>
                    <span className="col-span-1 text-center text-slate-500">:</span>
                    <span className="col-span-6 font-bold text-slate-950 tabular-nums text-[13.5px]">
                      ₹ {formatINRPlain(netPayable)}
                    </span>
                  </div>

                  <div className="grid grid-cols-12 items-baseline">
                    <span className="col-span-5 text-slate-600">Transaction Date</span>
                    <span className="col-span-1 text-center text-slate-500">:</span>
                    <span className="col-span-6 font-medium text-slate-900 tabular-nums">
                      {transactionDateFormatted}
                    </span>
                  </div>

                  <div className="grid grid-cols-12 items-baseline">
                    <span className="col-span-5 text-slate-600">Remark</span>
                    <span className="col-span-1 text-center text-slate-500">:</span>
                    <span className="col-span-6 font-medium text-slate-900 break-words">
                      {payment.remarks || payment.invoice_ref || '—'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Section 2: Payee Details */}
              <div className="pt-2">
                <h3 className="text-[13px] font-bold text-slate-900 border-b border-slate-200 pb-1 mb-2.5">
                  Payee Details
                </h3>
                <div className="space-y-1.5 text-[12.5px]">
                  <div className="grid grid-cols-12 items-baseline">
                    <span className="col-span-5 text-slate-600">Payee Type</span>
                    <span className="col-span-1 text-center text-slate-500">:</span>
                    <span className="col-span-6 font-medium text-slate-900">
                      Registered Payee
                    </span>
                  </div>

                  <div className="grid grid-cols-12 items-baseline">
                    <span className="col-span-5 text-slate-600">Payee Name</span>
                    <span className="col-span-1 text-center text-slate-500">:</span>
                    <span className="col-span-6 font-bold text-slate-900">
                      {beneficiaryName}
                    </span>
                  </div>

                  <div className="grid grid-cols-12 items-baseline">
                    <span className="col-span-5 text-slate-600">Payee Bank</span>
                    <span className="col-span-1 text-center text-slate-500">:</span>
                    <span className="col-span-6 font-medium text-slate-900">
                      {payeeBankName}
                    </span>
                  </div>

                  <div className="grid grid-cols-12 items-baseline">
                    <span className="col-span-5 text-slate-600">Payee Account Number</span>
                    <span className="col-span-1 text-center text-slate-500">:</span>
                    <span className="col-span-6 font-medium text-slate-900 font-mono tabular-nums">
                      {payeeAccountNo}
                    </span>
                  </div>
                </div>
              </div>

              {/* Closing */}
              <div className="pt-3 space-y-2 text-[12.5px] text-slate-700">
                <p>For any clarifications, please feel free to contact us.</p>
                <div>
                  <p className="text-slate-600">Best Regards</p>
                  <p className="font-bold text-slate-900 text-[13.5px]">{companyTitle}</p>
                </div>
              </div>

              {/* Bottom Metadata & Official Footer */}
              <div className="pt-5 border-t border-slate-200 space-y-3 text-[11px] text-slate-500">
                <div className="flex flex-col gap-0.5 tabular-nums">
                  <span>Date : {paidTimestampFormatted}</span>
                  <span>User : {paidUserName}</span>
                </div>

                {(companyEmail || companyPhone) && (
                  <div className="text-center text-[11px] font-medium text-slate-600 pt-1">
                    {companyEmail && <span>{companyEmail}</span>}
                    {companyEmail && companyPhone && <span className="mx-2">·</span>}
                    {companyPhone && <span>{companyPhone}</span>}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ACTION BAR FOOTER */}
        <div className="px-4 sm:px-5 py-3 bg-white border-t border-slate-200 shrink-0 pb-safe">
          <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center justify-end gap-2 w-full">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handlePrintPdf}
              disabled={isExporting !== null}
              className="w-full sm:w-auto text-xs min-h-[42px] sm:min-h-[38px]"
            >
              <Printer className="w-3.5 h-3.5 mr-1.5" />
              Save / Print PDF
            </Button>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleDownloadPng}
              disabled={isExporting !== null}
              className="w-full sm:w-auto text-xs min-h-[42px] sm:min-h-[38px]"
            >
              {isExporting === 'PNG' ? (
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              ) : (
                <Download className="w-3.5 h-3.5 mr-1.5" />
              )}
              Download PNG
            </Button>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleCopyImage}
              disabled={isExporting !== null}
              className="col-span-2 sm:col-span-1 w-full sm:w-auto text-xs min-h-[42px] sm:min-h-[38px]"
            >
              {isExporting === 'COPY' ? (
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              ) : copiedImage ? (
                <Check className="w-3.5 h-3.5 mr-1.5 text-emerald-600" />
              ) : (
                <Copy className="w-3.5 h-3.5 mr-1.5" />
              )}
              {copiedImage ? 'Copied!' : 'Copy Image'}
            </Button>

            <Button
              type="button"
              size="sm"
              onClick={handleShareWhatsApp}
              disabled={isExporting !== null}
              className="col-span-2 sm:col-span-1 w-full sm:w-auto text-xs min-h-[44px] sm:min-h-[38px] px-4 bg-[#15803D] hover:bg-[#166534] text-white font-semibold shadow-sm"
            >
              {isExporting === 'WHATSAPP' ? (
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              ) : (
                <MessageCircle className="w-3.5 h-3.5 mr-1.5" />
              )}
              Share to WhatsApp
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
