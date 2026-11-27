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

/**
 * Loads a PNG asset, auto-crops transparent borders (a > 10), and recolors
 * via `source-in` onto an offscreen canvas so white or oversized-padding logos
 * render crisply in Screen Preview, Exported PNG, and Print/PDF.
 */
async function buildCanvasRecoloredDataUrl(
  logoSrc: string,
  fillColor: string
): Promise<string | null> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return null;
  }

  let objectUrl: string | null = null;
  try {
    const res = await fetch(logoSrc, { cache: 'force-cache' });
    if (!res.ok) return null;
    const blob = await res.blob();
    objectUrl = URL.createObjectURL(blob);

    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.crossOrigin = 'anonymous';
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Failed to decode logo image'));
      el.src = objectUrl!;
    });

    if (typeof img.decode === 'function') {
      try {
        await img.decode();
      } catch {
        // Proceed with loaded image
      }
    }

    const srcW = img.naturalWidth || img.width;
    const srcH = img.naturalHeight || img.height;
    if (!srcW || !srcH) return null;

    const srcCanvas = document.createElement('canvas');
    srcCanvas.width = srcW;
    srcCanvas.height = srcH;
    const srcCtx = srcCanvas.getContext('2d', { willReadFrequently: true });
    if (!srcCtx) return null;

    srcCtx.drawImage(img, 0, 0, srcW, srcH);

    // Find tight bounding box of non-transparent pixels (a > 10)
    const { data } = srcCtx.getImageData(0, 0, srcW, srcH);
    let minX = srcW;
    let minY = srcH;
    let maxX = -1;
    let maxY = -1;

    for (let y = 0; y < srcH; y += 1) {
      const rowOffset = y * srcW * 4;
      for (let x = 0; x < srcW; x += 1) {
        const alpha = data[rowOffset + x * 4 + 3];
        if (alpha > 10) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    if (maxX < minX || maxY < minY) {
      return null;
    }

    const cropW = maxX - minX + 1;
    const cropH = maxY - minY + 1;

    const outCanvas = document.createElement('canvas');
    outCanvas.width = cropW;
    outCanvas.height = cropH;
    const outCtx = outCanvas.getContext('2d');
    if (!outCtx) return null;

    outCtx.drawImage(srcCanvas, minX, minY, cropW, cropH, 0, 0, cropW, cropH);
    outCtx.globalCompositeOperation = 'source-in';
    outCtx.fillStyle = fillColor;
    outCtx.fillRect(0, 0, cropW, cropH);
    outCtx.globalCompositeOperation = 'source-over';

    return outCanvas.toDataURL('image/png');
  } catch {
    return null;
  } finally {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
    }
  }
}

function AdviceSlipDocument({
  data,
  watermarkDataUrl,
  headerLogoDataUrl,
  id,
  className = '',
  style,
}: {
  data: SlipViewData;
  watermarkDataUrl?: string | null;
  headerLogoDataUrl?: string | null;
  id?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const isVinmore = data.brandKey === 'VINMORE';

  return (
    <div
      id={id}
      className={`keep-light relative w-[620px] min-h-[775px] bg-white overflow-hidden px-[28px] py-[24px] text-[#111111] ${className}`}
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
      {/* Background Centered Watermark (Strictly Company-Isolated) */}
      {watermarkDataUrl ? (
        <div
          aria-hidden="true"
          className={
            isVinmore
              ? 'pointer-events-none select-none absolute top-[235px] left-1/2 -translate-x-1/2 w-[330px] max-w-[60%] z-0 flex items-center justify-center bg-transparent'
              : 'pointer-events-none select-none absolute top-[118px] left-1/2 -translate-x-1/2 w-[300px] z-0 flex items-center justify-center bg-transparent'
          }
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={watermarkDataUrl}
            alt=""
            className={
              isVinmore
                ? 'w-[330px] max-w-full h-auto object-contain block'
                : 'w-[300px] h-auto object-contain block'
            }
            style={{
              WebkitPrintColorAdjust: 'exact',
              printColorAdjust: 'exact',
            }}
          />
        </div>
      ) : null}

      {/* Foreground Content */}
      <div className="relative z-10 bg-transparent">
        {/* Top-Right Company Letterhead Header (Strictly Company-Isolated) */}
        {isVinmore ? (
          <div className="flex justify-end pr-[64px] min-h-[26px] items-center">
            {headerLogoDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={headerLogoDataUrl}
                alt="Vinmore"
                className="h-[22px] w-auto object-contain block"
                style={{
                  WebkitPrintColorAdjust: 'exact',
                  printColorAdjust: 'exact',
                }}
              />
            ) : null}
          </div>
        ) : (
          <div className="text-right pr-[88px]">
            <span className="text-[19px] font-semibold tracking-[0.22em] text-[#B8B8B8] uppercase">
              INDFURN
            </span>
          </div>
        )}

        {/* Salutation & Intro Paragraph */}
        <p className="mt-3 mb-2 text-[13.5px] leading-[1.5] text-[#111111]">
          Dear Sir/Madam,
        </p>
        <p className="mb-3 text-[13.5px] leading-[1.5] text-[#111111]">
          We would like to inform you that we have successfully processed your payment.
          <br />
          Please find the payment details below for your reference.
        </p>

        {/* Section 1: Payment Details */}
        <h3 className="text-[14px] font-bold text-[#111111] mt-3 mb-2">
          Payment Details
        </h3>
        <div className="text-[13px] leading-[1.62] text-[#111111]">
          <div className="grid grid-cols-[168px_14px_1fr] items-baseline">
            <span>Reference ID</span>
            <span>:</span>
            <span>{data.referenceId}</span>
          </div>

          {!data.isCheque ? (
            <div className="grid grid-cols-[168px_14px_1fr] items-baseline">
              <span>UTR Number</span>
              <span>:</span>
              <span className="font-bold">{data.settlementRef}</span>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-[168px_14px_1fr] items-baseline">
                <span>Cheque Number</span>
                <span>:</span>
                <span className="font-bold">{data.settlementRef}</span>
              </div>
              <div className="grid grid-cols-[168px_14px_1fr] items-baseline">
                <span>Cheque Date</span>
                <span>:</span>
                <span className="tabular-nums">{data.chequeDateFormatted}</span>
              </div>
            </>
          )}

          <div className="grid grid-cols-[168px_14px_1fr] items-baseline">
            <span>Mode of Transfer</span>
            <span>:</span>
            <span>{data.modeOfTransfer}</span>
          </div>

          <div className="grid grid-cols-[168px_14px_1fr] items-baseline">
            <span>Bank Name</span>
            <span>:</span>
            <span>{data.sourceBankName}</span>
          </div>

          <div className="grid grid-cols-[168px_14px_1fr] items-baseline">
            <span>Account Number</span>
            <span>:</span>
            <span className="tabular-nums">{data.sourceAccountMasked}</span>
          </div>

          <div className="grid grid-cols-[168px_14px_1fr] items-baseline">
            <span>Amount</span>
            <span>:</span>
            <span className="font-bold tabular-nums">{data.amountFormatted}</span>
          </div>

          <div className="grid grid-cols-[168px_14px_1fr] items-baseline">
            <span>Transaction Date</span>
            <span>:</span>
            <span className="tabular-nums">{data.transactionDateFormatted}</span>
          </div>

          <div className="grid grid-cols-[168px_14px_1fr] items-baseline">
            <span>Remark</span>
            <span>:</span>
            <span className="break-words">{data.remarkText}</span>
          </div>
        </div>

        {/* Section 2: Payee Details */}
        <h3 className="text-[14px] font-bold text-[#111111] mt-4 mb-2">
          Payee Details
        </h3>
        <div className="text-[13px] leading-[1.62] text-[#111111]">
          <div className="grid grid-cols-[168px_14px_1fr] items-baseline">
            <span>Payee Type</span>
            <span>:</span>
            <span>Registered Payee</span>
          </div>

          <div className="grid grid-cols-[168px_14px_1fr] items-baseline">
            <span>Payee Name</span>
            <span>:</span>
            <span className="font-bold uppercase break-words">{data.beneficiaryName}</span>
          </div>

          <div className="grid grid-cols-[168px_14px_1fr] items-baseline">
            <span>Payee Bank</span>
            <span>:</span>
            <span>{data.payeeBankName}</span>
          </div>

          <div className="grid grid-cols-[168px_14px_1fr] items-baseline">
            <span>Payee Account Number</span>
            <span>:</span>
            <span className="tabular-nums">{data.payeeAccountNo}</span>
          </div>
        </div>

        {/* Closing Block */}
        <div className="mt-6 mb-3 text-[13.5px] leading-[1.5] text-[#111111]">
          <p className="mb-3">For any clarifications, please feel free to contact us.</p>
          <div className="mt-4">
            <p>Best Regards</p>
            <p className="font-bold">{data.companyTitle}</p>
          </div>
        </div>

        {/* Bottom-Left Audit Stamp */}
        <div className="mt-8 text-[11px] leading-[1.7] text-[#111111] tabular-nums">
          <div>
            Date : &nbsp;&nbsp;{data.paidTimestampFormatted}
          </div>
          <div>
            User : &nbsp;&nbsp;{data.paidUserName}
          </div>
        </div>

        {/* Bottom-Center Contact Footer */}
        {(data.companyEmail || data.companyPhone) && (
          <div className="mt-5 text-center">
            <span className="text-[13px] text-[#5B767A] underline underline-offset-4">
              {data.companyEmail}
              {data.companyEmail && data.companyPhone ? '\u00A0\u00A0\u00A0' : ''}
              {data.companyPhone}
            </span>
          </div>
        )}
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
  const [previewHeight, setPreviewHeight] = React.useState<number>(775);
  const [isExporting, setIsExporting] = React.useState<
    'WHATSAPP' | 'COPY' | 'PNG' | null
  >(null);
  const [copiedImage, setCopiedImage] = React.useState<boolean>(false);
  const [localReceiptSentAt, setLocalReceiptSentAt] = React.useState<string | null>(
    receiptSentAt ?? payment?.receipt_sent_at ?? null
  );
  const [isMarkingManualSent, setIsMarkingManualSent] = React.useState<boolean>(false);
  const autoMarkInFlightRef = React.useRef<string | null>(null);
  const [watermarkDataUrl, setWatermarkDataUrl] = React.useState<string | null>(null);
  const [headerLogoDataUrl, setHeaderLogoDataUrl] = React.useState<string | null>(null);
  const brandAssetsPromiseRef = React.useRef<
    Promise<{ watermark: string | null; header: string | null }> | null
  >(null);

  React.useEffect(() => {
    setLocalReceiptSentAt(receiptSentAt ?? payment?.receipt_sent_at ?? null);
    autoMarkInFlightRef.current = null;
  }, [open, payment?.id, payment?.receipt_sent_at, receiptSentAt]);

  // Strictly key brandKey off company.code so editing display name never breaks logo/watermark isolation
  const companyCodeHint = (activeCompany?.code || payment?.company?.code || '').trim().toUpperCase();
  const fallbackIdentity = companyCodeHint || (activeCompany?.name || payment?.company?.name || '').trim().toUpperCase();
  const brandKey: BrandKey = fallbackIdentity.includes('VINMORE') ? 'VINMORE' : 'INDFURN';

  // Reset & pre-bake company-specific canvas assets whenever brandKey or modal open state changes
  React.useEffect(() => {
    let active = true;
    setWatermarkDataUrl(null);
    setHeaderLogoDataUrl(null);

    if (!open) {
      brandAssetsPromiseRef.current = null;
      return;
    }

    const promise =
      brandKey === 'VINMORE'
        ? Promise.all([
          buildCanvasRecoloredDataUrl('/vinmore-centre-logo.png', '#E8E8E8'),
          buildCanvasRecoloredDataUrl('/vinmore-titles-logo.png', '#A3A3A3'),
        ]).then(([watermark, header]) => ({ watermark, header }))
        : buildCanvasRecoloredDataUrl('/logo.png', '#E8E8E8').then((watermark) => ({
          watermark,
          header: null,
        }));

    brandAssetsPromiseRef.current = promise;

    promise.then(({ watermark, header }) => {
      if (!active) return;
      setWatermarkDataUrl(watermark);
      setHeaderLogoDataUrl(header);
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
    'XXXX XXXX XXX 5074';

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
  const cleanInvoiceRef = (payment.invoice_ref || '').trim();
  const hasDistinctRemarks = Boolean(cleanRemarks && cleanRemarks !== cleanInvoiceRef);
  const referenceId = hasDistinctRemarks ? cleanInvoiceRef || '0' : '0';
  const remarkText = hasDistinctRemarks ? cleanRemarks : cleanInvoiceRef || '-';

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

    const needsAssets =
      !watermarkDataUrl || (brandKey === 'VINMORE' && !headerLogoDataUrl);

    if (needsAssets && brandAssetsPromiseRef.current) {
      const assets = await brandAssetsPromiseRef.current;
      setWatermarkDataUrl(assets.watermark);
      setHeaderLogoDataUrl(assets.header);
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      );
    }

    await ensureExportImagesLoaded(targetNode);
    const captureHeight = Math.max(775, targetNode.scrollHeight);
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
                  watermarkDataUrl={watermarkDataUrl}
                  headerLogoDataUrl={headerLogoDataUrl}
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
                watermarkDataUrl={watermarkDataUrl}
                headerLogoDataUrl={headerLogoDataUrl}
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
            watermarkDataUrl={watermarkDataUrl}
            headerLogoDataUrl={headerLogoDataUrl}
            className="hidden print:block"
          />,
          document.body
        )
        : null}
    </>
  );
}
