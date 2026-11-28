'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
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
  CheckCircle2,
  Loader2,
  MessageCircle,
  Send,
} from 'lucide-react';
import { toast } from 'sonner';
import { markReceiptSent } from '@/actions/payments';
import { getBankNameFromIfsc } from '@/lib/bank-names';
import { formatDDMMYYYY, formatINRPlain } from '@/lib/format';
import type { Company, PaymentItem } from '@/types/database';

interface PaymentAcknowledgementModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payment: PaymentItem | null;
  activeCompany?: Company | null;
  fallbackUserName?: string;
  receiptSentAt?: string | null;
  onReceiptSent?: (paymentId: string, sentAt: string) => void;
}

function formatISTDate(isoString: string | null | undefined): string {
  if (!isoString) return '—';
  if (/^\d{4}-\d{2}-\d{2}$/.test(isoString.trim())) {
    return formatDDMMYYYY(isoString.trim());
  }
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).formatToParts(d);
    const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
    return `${get('day')}-${get('month')}-${get('year')}`;
  } catch {
    return isoString;
  }
}

function formatDateAndTime24(isoString: string | null | undefined): string {
  if (!isoString) return '—';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(d);
    const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
    return `${get('day')}-${get('month')}-${get('year')} ${get('hour')}:${get('minute')}`;
  } catch {
    return isoString;
  }
}

function formatConciseBankName(
  rawName: string | null | undefined,
  shortCode?: string | null
): string {
  const clean = (rawName || '').trim();
  const lower = clean.toLowerCase();
  const code = (shortCode || '').trim().toUpperCase();

  if (lower.includes('axis') || code === 'AXIS') return 'Axis Bank';
  if (lower.includes('south indian') || code === 'SIB') return 'South Indian Bank';
  if (lower.includes('hdfc') || code === 'HDFC') return 'HDFC Bank';
  if (lower.includes('kotak') || code === 'KOTAK') return 'Kotak Mahindra Bank';
  if (lower.includes('icici') || code === 'ICICI') return 'ICICI Bank';
  if (lower.includes('state bank') || code === 'SBI') return 'State Bank of India';

  return (
    clean
      .replace(/\bneo for corporates\b/gi, '')
      .replace(/\bcorporate\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim() || 'Axis Bank'
  );
}

function sanitizeFilenamePart(val: string): string {
  return (val || 'Advice').replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32);
}

type BrandKey = 'INDFURN' | 'VINMORE';

interface SlipViewData {
  brandKey: BrandKey;
  companyCode: string;
  companyTitle: string;
  companyEmail: string;
  companyPhone: string;
  isCheque: boolean;
  referenceId: string;
  settlementRef: string;
  chequeDateFormatted: string;
  modeOfTransfer: string;
  sourceBankName: string;
  sourceAccountMasked: string;
  amountFormatted: string;
  transactionDateFormatted: string;
  remarkText: string;
  beneficiaryName: string;
  payeeBankName: string;
  payeeAccountNo: string;
  paidTimestampFormatted: string;
  paidUserName: string;
}

const TEMPLATE_PATHS: Record<BrandKey, string> = {
  INDFURN: '/indfurn-acknowledgement-template.jpg',
  VINMORE: '/vinmore-acknowledgement-template.jpg',
};

const templateDataUrlCache = new Map<BrandKey, string>();
const templateLoadPromises = new Map<BrandKey, Promise<string | null>>();

/**
 * Fetches an official full-page letterhead JPG template and converts it to a
 * base64 Data URL via FileReader so `html-to-image` `toPng()` never exports a
 * blank background or fails due to external image timing.
 */
async function loadImageAsDataUrl(url: string): Promise<string | null> {
  if (typeof window === 'undefined') return null;

  try {
    const res = await fetch(url, { cache: 'force-cache' });
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        resolve(typeof reader.result === 'string' ? reader.result : null);
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

async function getCachedTemplateDataUrl(brandKey: BrandKey): Promise<string | null> {
  const cached = templateDataUrlCache.get(brandKey);
  if (cached) return cached;

  const inFlight = templateLoadPromises.get(brandKey);
  if (inFlight) return inFlight;

  const promise = loadImageAsDataUrl(TEMPLATE_PATHS[brandKey]).then((dataUrl) => {
    if (dataUrl) {
      templateDataUrlCache.set(brandKey, dataUrl);
    }
    templateLoadPromises.delete(brandKey);
    return dataUrl;
  });

  templateLoadPromises.set(brandKey, promise);
  return promise;
}

function AdviceSlipDocument({
  data,
  templateDataUrl,
  id,
  className = '',
  style,
}: {
  data: SlipViewData;
  templateDataUrl?: string | null;
  id?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const fallbackTemplatePath = TEMPLATE_PATHS[data.brandKey];

  return (
    <div
      id={id}
      className={`keep-light relative w-[620px] min-h-[877px] bg-white overflow-hidden text-[#111111] ${className}`}
      style={{
        fontFamily: 'Arial, Helvetica, Inter, sans-serif',
        backgroundColor: '#ffffff',
        color: '#111111',
        colorScheme: 'light',
        WebkitPrintColorAdjust: 'exact',
        printColorAdjust: 'exact',
        ...style,
      }}
    >
      {/* Full-Bleed Official A4 Letterhead Template (Contains Company Header & Watermark) */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={templateDataUrl || fallbackTemplatePath}
        alt=""
        aria-hidden="true"
        className="pointer-events-none select-none absolute inset-0 w-full h-full object-fill z-0"
        style={{ WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}
      />

      {/* Crisp Foreground Content Layout */}
      <div className="relative z-10 flex flex-col justify-between min-h-[877px] px-[38px] pt-[66px] pb-[34px] bg-transparent text-[#111111]">
        {/* Top Content Block */}
        <div className="bg-transparent text-[#111111]">
          {/* Salutation & Intro */}
          <div className="text-[13.5px] leading-[1.55] text-[#111111]">
            <p className="mb-3">Dear Sir/Madam,</p>
            <p>
              We would like to inform you that we have successfully processed your payment.
              <br />
              Please find the payment details below for your reference.
            </p>
          </div>

          {/* Section 1: Payment Details */}
          <h3 className="text-[14px] font-bold text-[#111111] mt-6 mb-2.5">
            Payment Details
          </h3>
          <div className="text-[13.2px] leading-[1.72] text-[#111111]">
            <div className="grid grid-cols-[172px_14px_1fr] items-baseline">
              <span>Reference ID</span>
              <span>:</span>
              <span>{data.referenceId}</span>
            </div>

            {!data.isCheque ? (
              <div className="grid grid-cols-[172px_14px_1fr] items-baseline">
                <span>UTR Number</span>
                <span>:</span>
                <span className="font-bold">{data.settlementRef}</span>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-[172px_14px_1fr] items-baseline">
                  <span>Cheque Number</span>
                  <span>:</span>
                  <span className="font-bold">{data.settlementRef}</span>
                </div>
                <div className="grid grid-cols-[172px_14px_1fr] items-baseline">
                  <span>Cheque Date</span>
                  <span>:</span>
                  <span className="tabular-nums">{data.chequeDateFormatted}</span>
                </div>
              </>
            )}

            <div className="grid grid-cols-[172px_14px_1fr] items-baseline">
              <span>Mode of Transfer</span>
              <span>:</span>
              <span>{data.modeOfTransfer}</span>
            </div>

            <div className="grid grid-cols-[172px_14px_1fr] items-baseline">
              <span>Bank Name</span>
              <span>:</span>
              <span>{data.sourceBankName}</span>
            </div>

            <div className="grid grid-cols-[172px_14px_1fr] items-baseline">
              <span>Account Number</span>
              <span>:</span>
              <span className="tabular-nums">{data.sourceAccountMasked}</span>
            </div>

            <div className="grid grid-cols-[172px_14px_1fr] items-baseline">
              <span>Amount</span>
              <span>:</span>
              <span className="font-bold tabular-nums">{data.amountFormatted}</span>
            </div>

            <div className="grid grid-cols-[172px_14px_1fr] items-baseline">
              <span>Transaction Date</span>
              <span>:</span>
              <span className="tabular-nums">{data.transactionDateFormatted}</span>
            </div>

            <div className="grid grid-cols-[172px_14px_1fr] items-baseline">
              <span>Remark</span>
              <span>:</span>
              <span className="break-words">{data.remarkText}</span>
            </div>
          </div>

          {/* Section 2: Payee Details */}
          <h3 className="text-[14px] font-bold text-[#111111] mt-6 mb-2.5">
            Payee Details
          </h3>
          <div className="text-[13.2px] leading-[1.72] text-[#111111]">
            <div className="grid grid-cols-[172px_14px_1fr] items-baseline">
              <span>Payee Type</span>
              <span>:</span>
              <span>Registered Payee</span>
            </div>

            <div className="grid grid-cols-[172px_14px_1fr] items-baseline">
              <span>Payee Name</span>
              <span>:</span>
              <span className="font-bold uppercase break-words">{data.beneficiaryName}</span>
            </div>

            <div className="grid grid-cols-[172px_14px_1fr] items-baseline">
              <span>Payee Bank</span>
              <span>:</span>
              <span>{data.payeeBankName}</span>
            </div>

            <div className="grid grid-cols-[172px_14px_1fr] items-baseline">
              <span>Payee Account Number</span>
              <span>:</span>
              <span className="tabular-nums">{data.payeeAccountNo}</span>
            </div>
          </div>

          {/* Closing Block */}
          <div className="mt-8 text-[13.5px] leading-[1.55] text-[#111111]">
            <p>For any clarifications, please feel free to contact us.</p>
            <div className="mt-5">
              <p>Best Regards</p>
              <p className="font-bold">{data.companyTitle}</p>
            </div>
          </div>
        </div>

        {/* Bottom Footer Block */}
        <div className="mt-10 bg-transparent">
          {/* Bottom-Left Audit Stamp */}
          <div className="text-[11.5px] leading-[1.75] text-[#222222] tabular-nums">
            <div>
              Date : &nbsp;&nbsp;{data.paidTimestampFormatted}
            </div>
            <div>
              User : &nbsp;&nbsp;{data.paidUserName}
            </div>
          </div>

          {/* Bottom-Center Contact Footer */}
          {(data.companyEmail || data.companyPhone) && (
            <div className="mt-6 text-center">
              <span className="text-[13px] text-[#5B767A] underline underline-offset-4">
                {data.companyEmail}
                {data.companyEmail && data.companyPhone ? '\u00A0\u00A0\u00A0' : ''}
                {data.companyPhone}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function PaymentAcknowledgementModal({
  open,
  onOpenChange,
  payment,
  activeCompany,
  fallbackUserName = 'Accounts Team',
  receiptSentAt,
  onReceiptSent,
}: PaymentAcknowledgementModalProps) {
  const previewContainerRef = React.useRef<HTMLDivElement | null>(null);
  const previewSlipRef = React.useRef<HTMLDivElement | null>(null);
  const exportRef = React.useRef<HTMLDivElement | null>(null);
  const [previewScale, setPreviewScale] = React.useState<number>(1);
  const [previewHeight, setPreviewHeight] = React.useState<number>(877);
  const [isExporting, setIsExporting] = React.useState<
    'WHATSAPP' | 'COPY' | 'PNG' | null
  >(null);
  const [copiedImage, setCopiedImage] = React.useState<boolean>(false);
  const [localReceiptSentAt, setLocalReceiptSentAt] = React.useState<string | null>(
    receiptSentAt ?? payment?.receipt_sent_at ?? null
  );
  const [isMarkingManualSent, setIsMarkingManualSent] = React.useState<boolean>(false);
  const autoMarkInFlightRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    setLocalReceiptSentAt(receiptSentAt ?? payment?.receipt_sent_at ?? null);
    autoMarkInFlightRef.current = null;
  }, [open, payment?.id, payment?.receipt_sent_at, receiptSentAt]);

  // Strictly key brandKey off company.code so editing display name never breaks template isolation
  const companyCodeHint = (activeCompany?.code || payment?.company?.code || '').trim().toUpperCase();
  const fallbackIdentity = companyCodeHint || (activeCompany?.name || payment?.company?.name || '').trim().toUpperCase();
  const brandKey: BrandKey = fallbackIdentity.includes('VINMORE') ? 'VINMORE' : 'INDFURN';

  const [templateDataUrl, setTemplateDataUrl] = React.useState<string | null>(
    () => templateDataUrlCache.get(brandKey) ?? null
  );
  const templatePromiseRef = React.useRef<Promise<string | null> | null>(null);

  // Preload company-specific A4 letterhead template Data URL whenever brandKey or modal open state changes
  React.useEffect(() => {
    let active = true;
    const cached = templateDataUrlCache.get(brandKey) ?? null;
    setTemplateDataUrl(cached);

    if (!open) {
      templatePromiseRef.current = cached ? Promise.resolve(cached) : null;
      return;
    }

    const promise = getCachedTemplateDataUrl(brandKey);
    templatePromiseRef.current = promise;

    promise.then((dataUrl) => {
      if (!active || !dataUrl) return;
      setTemplateDataUrl(dataUrl);
    });

    return () => {
      active = false;
    };
  }, [brandKey, open]);

  React.useEffect(() => {
    if (!open) return;

    let ro: ResizeObserver | null = null;
    const updateMetrics = () => {
      const container = previewContainerRef.current;
      if (container) {
        const available = container.clientWidth - 20;
        const nextScale = available > 0 ? Math.min(1, available / 620) : 1;
        setPreviewScale(nextScale);
      }
      const slipEl = previewSlipRef.current;
      if (slipEl && slipEl.scrollHeight > 0) {
        setPreviewHeight(slipEl.scrollHeight);
      }
    };

    const rafId = requestAnimationFrame(() => {
      updateMetrics();
      ro = new ResizeObserver(updateMetrics);
      if (previewContainerRef.current) ro.observe(previewContainerRef.current);
      if (previewSlipRef.current) ro.observe(previewSlipRef.current);
    });

    window.addEventListener('resize', updateMetrics);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', updateMetrics);
      ro?.disconnect();
    };
  }, [open, payment?.id]);

  if (!payment) return null;

  const companyCode = brandKey;
  const companyTitle =
    (activeCompany?.name || payment.company?.name || '').trim() ||
    (brandKey === 'VINMORE' ? 'Vinmore' : 'Indfurn');
  const companyEmail = (activeCompany?.contact_email ?? payment.company?.contact_email ?? '').trim();
  const companyPhone = (activeCompany?.contact_phone ?? payment.company?.contact_phone ?? '').trim();

  const isCheque = payment.payment_mode === 'CHEQUE';
  const netPayable = Number(payment.net_payable || 0);
  const modeOfTransfer = isCheque
    ? 'Cheque'
    : payment.payment_mode === 'IMPS'
      ? 'IMPS'
      : netPayable >= 200000
        ? 'RTGS'
        : 'NEFT';

  const sourceBankName = formatConciseBankName(
    payment.source_bank?.bank_name || payment.source_bank?.full_name,
    payment.source_bank?.short_code || payment.source_bank?.short_name
  );
  const sourceAccountMasked =
    payment.source_bank?.account_number_masked ||
    payment.source_bank?.account_mask ||
    '—';

  const transactionDateFormatted = formatISTDate(
    payment.paid_at || payment.sheet_date
  );

  const partyName =
    payment.vendor?.party_name || payment.vendor?.name || 'Supplier';
  const beneficiaryName =
    payment.vendor?.beneficiary_name || partyName;
  const payeeBankName = getBankNameFromIfsc(payment.vendor?.ifsc_code);
  const payeeAccountNo =
    payment.vendor?.account_number || payment.vendor?.bank_account_no || '—';

  const cleanRemarks = (payment.remarks || '').trim();
  const rawInvoiceRef = (payment.invoice_ref || '').trim();
  const isPlaceholderInvoice =
    !rawInvoiceRef ||
    ['na', 'n/a', '-', 'none'].includes(rawInvoiceRef.toLowerCase());
  const cleanInvoiceRef = isPlaceholderInvoice ? '' : rawInvoiceRef;

  const referenceId = cleanInvoiceRef || 'On Account';
  const remarkText =
    cleanRemarks && cleanRemarks.toLowerCase() !== cleanInvoiceRef.toLowerCase()
      ? cleanRemarks
      : cleanInvoiceRef
        ? `Against Invoice ${cleanInvoiceRef}`
        : payment.purpose || 'Payment Settlement';

  const settlementRef = isCheque
    ? payment.cheque_number || '—'
    : payment.utr_number || '—';
  const paidUserName = payment.payer?.full_name || fallbackUserName;
  const paidTimestampFormatted = formatDateAndTime24(
    payment.paid_at || payment.updated_at
  );

  const slipData: SlipViewData = {
    brandKey,
    companyCode,
    companyTitle,
    companyEmail,
    companyPhone,
    isCheque,
    referenceId,
    settlementRef,
    chequeDateFormatted: formatDDMMYYYY(payment.cheque_date),
    modeOfTransfer,
    sourceBankName,
    sourceAccountMasked,
    amountFormatted: `₹ ${formatINRPlain(netPayable)}`,
    transactionDateFormatted,
    remarkText,
    beneficiaryName,
    payeeBankName,
    payeeAccountNo,
    paidTimestampFormatted,
    paidUserName,
  };

  const fileName = `${companyCode}_Payment_Advice_${sanitizeFilenamePart(
    beneficiaryName
  )}_${sanitizeFilenamePart(settlementRef)}.png`;

  const ensureExportImagesLoaded = async (container: HTMLElement) => {
    const imgs = Array.from(container.querySelectorAll('img'));
    await Promise.all(
      imgs.map(async (img) => {
        if (!img.complete) {
          await new Promise<void>((resolve) => {
            const done = () => resolve();
            img.addEventListener('load', done, { once: true });
            img.addEventListener('error', done, { once: true });
            setTimeout(done, 1500);
          });
        }
        if (typeof img.decode === 'function') {
          try {
            await img.decode();
          } catch {
            // Ignore decode errors
          }
        }
      })
    );
  };

  const renderSlipToPngDataUrl = async (): Promise<string> => {
    const targetNode = exportRef.current;
    if (!targetNode) {
      throw new Error('Payment advice slip is not ready.');
    }

    if (!templateDataUrl) {
      const loadedUrl = await (
        templatePromiseRef.current ?? getCachedTemplateDataUrl(brandKey)
      );
      if (loadedUrl) {
        setTemplateDataUrl(loadedUrl);
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        );
      }
    }

    await ensureExportImagesLoaded(targetNode);
    const captureHeight = Math.max(877, targetNode.scrollHeight);
    return toPng(targetNode, {
      width: 620,
      height: captureHeight,
      pixelRatio: 2,
      backgroundColor: '#ffffff',
      cacheBust: false,
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

  const hasSettlementRef = Boolean(
    (payment.utr_number || payment.cheque_number || '').trim()
  );

  const triggerAutoMarkReceiptSent = (actionLabel: string) => {
    if (
      payment.status !== 'PAID' ||
      !hasSettlementRef ||
      localReceiptSentAt ||
      autoMarkInFlightRef.current === payment.id
    ) {
      return;
    }
    autoMarkInFlightRef.current = payment.id;
    const targetPaymentId = payment.id;

    void markReceiptSent({ paymentId: targetPaymentId, sent: true })
      .then((res) => {
        if (res.success) {
          const stampedAt = res.data.receipt_sent_at || new Date().toISOString();
          setLocalReceiptSentAt(stampedAt);
          onReceiptSent?.(targetPaymentId, stampedAt);
          toast.success(`${actionLabel} · Marked as Receipt Sent ✓`);
        }
      })
      .catch(() => {
        // Non-blocking background tracking
      })
      .finally(() => {
        if (autoMarkInFlightRef.current === targetPaymentId) {
          autoMarkInFlightRef.current = null;
        }
      });
  };

  const handleManualMarkSent = async () => {
    if (!hasSettlementRef || localReceiptSentAt || isMarkingManualSent) return;
    setIsMarkingManualSent(true);
    try {
      const res = await markReceiptSent({ paymentId: payment.id, sent: true });
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      const stampedAt = res.data.receipt_sent_at || new Date().toISOString();
      setLocalReceiptSentAt(stampedAt);
      onReceiptSent?.(payment.id, stampedAt);
      toast.success('Marked as Receipt Sent ✓');
    } catch {
      toast.error('Failed to mark receipt sent.');
    } finally {
      setIsMarkingManualSent(false);
    }
  };

  const handleDownloadPng = async () => {
    setIsExporting('PNG');
    try {
      const dataUrl = await renderSlipToPngDataUrl();
      triggerBrowserDownload(dataUrl, fileName);
      if (localReceiptSentAt || payment.status !== 'PAID' || !hasSettlementRef) {
        toast.success('Payment Acknowledgement PNG downloaded.');
      } else {
        triggerAutoMarkReceiptSent('Payment Advice downloaded');
      }
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
        if (localReceiptSentAt || payment.status !== 'PAID' || !hasSettlementRef) {
          toast.success('Payment Acknowledgement image copied! Paste (Ctrl+V) in WhatsApp.');
        } else {
          triggerAutoMarkReceiptSent('Payment Advice copied');
        }
      } else {
        triggerBrowserDownload(dataUrl, fileName);
        if (localReceiptSentAt || payment.status !== 'PAID' || !hasSettlementRef) {
          toast.info('Clipboard image copy unavailable in this browser — downloaded PNG instead.');
        } else {
          triggerAutoMarkReceiptSent('Payment Advice downloaded');
        }
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
          triggerAutoMarkReceiptSent('Payment Advice shared');
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
      triggerAutoMarkReceiptSent('Payment Advice shared');
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
      triggerAutoMarkReceiptSent('Payment Advice printed');
    }, 60);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="w-[calc(100vw-1rem)] sm:w-[calc(100vw-2rem)] max-w-2xl max-h-[90dvh] overflow-y-auto p-0 flex flex-col bg-slate-100 gap-0">
          <DialogHeader className="px-4 sm:px-5 py-3.5 pr-10 bg-white border-b border-slate-200 space-y-0.5 shrink-0">
            <DialogTitle className="text-sm font-bold text-slate-900">
              Payment Acknowledgement (Payment Advice)
            </DialogTitle>
            <DialogDescription className="text-[11px] text-slate-500">
              Share directly via WhatsApp, copy/download PNG, or save as PDF.
            </DialogDescription>
          </DialogHeader>

          {/* RESPONSIVE SCALED PREVIEW CONTAINER */}
          <div
            ref={previewContainerRef}
            className="flex-1 min-h-[260px] overflow-y-auto overflow-x-hidden p-2.5 sm:p-5 flex justify-center items-start"
          >
            <div
              className="shrink-0"
              style={{
                width: `${Math.round(620 * previewScale)}px`,
                height: `${Math.round(previewHeight * previewScale)}px`,
              }}
            >
              <div
                ref={previewSlipRef}
                className="origin-top-left shadow-sm"
                style={
                  previewScale < 1
                    ? {
                      transform: `scale(${previewScale})`,
                      width: '620px',
                    }
                    : { width: '620px' }
                }
              >
                <AdviceSlipDocument
                  id="advice-preview-slip"
                  data={slipData}
                  templateDataUrl={templateDataUrl}
                />
              </div>
            </div>
          </div>

          {/* OFF-SCREEN UNSCALED & UNCLIPPED CAPTURE NODE (620px fixed portrait) */}
          <div
            className="fixed -left-[9999px] top-0 pointer-events-none"
            aria-hidden="true"
          >
            <div ref={exportRef}>
              <AdviceSlipDocument
                id="advice-export-slip"
                data={slipData}
                templateDataUrl={templateDataUrl}
              />
            </div>
          </div>

          {/* ACTION BAR FOOTER */}
          <div className="px-4 sm:px-5 py-3 bg-white border-t border-slate-200 shrink-0 pb-safe space-y-2.5 sm:space-y-0 sm:flex sm:items-center sm:justify-between sm:gap-3">
            {/* Compact Receipt Sent Status Pill */}
            <div className="flex items-center justify-between sm:justify-start gap-2">
              {localReceiptSentAt ? (
                <span
                  title={`Sent: ${formatDateAndTime24(localReceiptSentAt)} IST`}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-[11px] font-bold shrink-0"
                >
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span>Receipt Sent ✓</span>
                </span>
              ) : payment.status === 'PAID' && hasSettlementRef ? (
                <button
                  type="button"
                  onClick={handleManualMarkSent}
                  disabled={isMarkingManualSent || isExporting !== null}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-800 text-[11px] font-semibold transition-colors cursor-pointer disabled:opacity-50"
                >
                  {isMarkingManualSent ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Send className="w-3 h-3" />
                  )}
                  <span>Mark as Sent</span>
                </button>
              ) : null}
            </div>

            <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center justify-end gap-2">
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
                className="w-full sm:w-auto text-xs min-h-[42px] sm:min-h-[38px]"
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
                className="w-full sm:w-auto text-xs min-h-[44px] sm:min-h-[38px] px-4 bg-[#15803D] hover:bg-[#166534] text-white font-semibold shadow-sm"
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

      {/* DEDICATED BODY-LEVEL SINGLE-PAGE A4 PRINT NODE (Hidden on screen, sole visible body child during print) */}
      {open && typeof document !== 'undefined'
        ? createPortal(
          <AdviceSlipDocument
            id="printable-advice-slip"
            data={slipData}
            templateDataUrl={templateDataUrl}
            className="hidden print:block"
          />,
          document.body
        )
        : null}
    </>
  );
}
