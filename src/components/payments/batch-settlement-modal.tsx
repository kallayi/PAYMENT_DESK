'use client';

import * as React from 'react';
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  ClipboardPaste,
  ExternalLink,
  Eye,
  EyeOff,
  FileSpreadsheet,
  FileText,
  Landmark,
  Layers,
  Loader2,
  Receipt,
  Send,
  Trash2,
  UploadCloud,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { toast } from 'sonner';

import { settlePaymentBatch, uploadReceiptFile } from '@/actions/payments';
import { getSignedFileUrl } from '@/actions/storage';
import { PaymentAcknowledgementModal } from '@/components/payments/payment-acknowledgement-modal';
import { BankBadge, PaymentModeBadge } from '@/components/payments/payment-status-badge';
import { DatePicker } from '@/components/ui/date-picker';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  formatHumanDate,
  formatINR,
  getTodayISTDateString,
  round2,
} from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Company, PaymentBatch, PaymentItem } from '@/types/database';

interface BatchSettlementModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedItems: PaymentItem[];
  activeCompany?: Company | null;
  fallbackUserName?: string;
  onSuccess: (result: { batch: PaymentBatch; payments: PaymentItem[] }) => void;
}

interface RowRefState {
  utr_number: string;
  cheque_number: string;
  cheque_date: string;
}

interface ParsedUtrReportRow {
  utr: string;
  accountNumber: string;
  amount: number | null;
  beneficiaryName: string;
  status: string | null;
}

type AxisGroupKey = 'SAME_BANK' | 'OTHER_BANK' | 'CHEQUE';

function resolveSourceIfscPrefix(item: PaymentItem): string {
  const explicitPrefix = (item.source_bank?.ifsc_prefix || '').trim().toUpperCase();
  if (explicitPrefix) return explicitPrefix.slice(0, 4);

  const bankCode = (
    item.source_bank?.short_code ||
    item.source_bank?.short_name ||
    item.source_bank?.bank_name ||
    item.source_bank?.full_name ||
    ''
  )
    .trim()
    .toUpperCase();
  if (bankCode.includes('AXIS')) return 'UTIB';
  if (bankCode.includes('HDFC')) return 'HDFC';
  if (bankCode.includes('KOTAK')) return 'KKBK';
  if (bankCode.includes('SIB') || bankCode.includes('SOUTH INDIAN')) return 'SIBL';
  return '';
}

function getAxisGroupKey(item: PaymentItem): AxisGroupKey {
  if (item.payment_mode === 'CHEQUE') return 'CHEQUE';
  const sourcePrefix = resolveSourceIfscPrefix(item);
  const vendorPrefix = (item.vendor?.ifsc_code || '').trim().toUpperCase().slice(0, 4);
  if (sourcePrefix && vendorPrefix && sourcePrefix === vendorPrefix) {
    return 'SAME_BANK';
  }
  return 'OTHER_BANK';
}

function getAxisGroupRank(key: AxisGroupKey): number {
  if (key === 'SAME_BANK') return 0;
  if (key === 'OTHER_BANK') return 1;
  return 2;
}

function sortItemsForAxisOrder(items: PaymentItem[]): PaymentItem[] {
  return [...items].sort(
    (a, b) => getAxisGroupRank(getAxisGroupKey(a)) - getAxisGroupRank(getAxisGroupKey(b))
  );
}

function normalizeAccount(val: string | null | undefined): string {
  return (val || '').trim().replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

function accountsEqual(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const trimA = a.replace(/^0+/, '');
  const trimB = b.replace(/^0+/, '');
  return Boolean(trimA && trimB && trimA === trimB);
}

function normalizeName(val: string | null | undefined): string {
  return (val || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function amountsMatch(itemAmount: number, reportAmount: number | null): boolean {
  if (reportAmount === null || !Number.isFinite(reportAmount)) return false;
  return Math.abs(Number(itemAmount || 0) - reportAmount) <= 0.01;
}

function matchBankReportRows(
  items: PaymentItem[],
  reportRows: ParsedUtrReportRow[]
): {
  matches: Map<string, string>;
  nonChequeCount: number;
} {
  const nonChequeItems = items.filter((item) => item.payment_mode !== 'CHEQUE');
  const matches = new Map<string, string>();
  const usedReportIndices = new Set<number>();

  // Helper to get canonical non-zero account key for uniqueness counting
  const accKey = (acc: string) => {
    const norm = normalizeAccount(acc);
    return norm.replace(/^0+/, '') || norm;
  };

  // Precompute account uniqueness counts across non-Cheque batch items & report rows
  const batchAccCounts = new Map<string, number>();
  for (const item of nonChequeItems) {
    const key = accKey(item.vendor?.account_number || item.vendor?.bank_account_no || '');
    if (key) batchAccCounts.set(key, (batchAccCounts.get(key) || 0) + 1);
  }

  const reportAccCounts = new Map<string, number>();
  for (const r of reportRows) {
    const key = accKey(r.accountNumber);
    if (key) reportAccCounts.set(key, (reportAccCounts.get(key) || 0) + 1);
  }

  // Pass 1: Exact normalized Beneficiary Account Number AND exact Net Payable Amount (within ₹0.01)
  for (const item of nonChequeItems) {
    const itemAcc = normalizeAccount(
      item.vendor?.account_number || item.vendor?.bank_account_no
    );
    if (!itemAcc) continue;

    const rIdx = reportRows.findIndex(
      (r, idx) =>
        !usedReportIndices.has(idx) &&
        accountsEqual(itemAcc, normalizeAccount(r.accountNumber)) &&
        amountsMatch(item.net_payable, r.amount)
    );
    if (rIdx !== -1) {
      usedReportIndices.add(rIdx);
      matches.set(item.id, reportRows[rIdx].utr.toUpperCase());
    }
  }

  // Pass 2: Exact normalized Beneficiary Account Number (only if unique in batchItems and reportRows)
  for (const item of nonChequeItems) {
    if (matches.has(item.id)) continue;
    const itemAcc = normalizeAccount(
      item.vendor?.account_number || item.vendor?.bank_account_no
    );
    const key = accKey(itemAcc);
    if (!itemAcc || !key) continue;
    if ((batchAccCounts.get(key) || 0) !== 1 || (reportAccCounts.get(key) || 0) !== 1) {
      continue;
    }

    const rIdx = reportRows.findIndex(
      (r, idx) =>
        !usedReportIndices.has(idx) &&
        accountsEqual(itemAcc, normalizeAccount(r.accountNumber))
    );
    if (rIdx !== -1) {
      usedReportIndices.add(rIdx);
      matches.set(item.id, reportRows[rIdx].utr.toUpperCase());
    }
  }

  // Pass 3: Exact normalized Beneficiary/Party Name AND exact Net Payable Amount (within ₹0.01)
  for (const item of nonChequeItems) {
    if (matches.has(item.id)) continue;
    const candidateNames = new Set(
      [
        normalizeName(item.vendor?.beneficiary_name),
        normalizeName(item.vendor?.party_name),
        normalizeName(item.vendor?.name),
      ].filter(Boolean)
    );
    if (candidateNames.size === 0) continue;

    const rIdx = reportRows.findIndex(
      (r, idx) =>
        !usedReportIndices.has(idx) &&
        candidateNames.has(normalizeName(r.beneficiaryName)) &&
        amountsMatch(item.net_payable, r.amount)
    );
    if (rIdx !== -1) {
      usedReportIndices.add(rIdx);
      matches.set(item.id, reportRows[rIdx].utr.toUpperCase());
    }
  }

  return {
    matches,
    nonChequeCount: nonChequeItems.length,
  };
}

export function BatchSettlementModal({
  open,
  onOpenChange,
  selectedItems,
  activeCompany,
  fallbackUserName,
  onSuccess,
}: BatchSettlementModalProps) {
  const dialogContentRef = React.useRef<HTMLDivElement | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const utrReportInputRef = React.useRef<HTMLInputElement | null>(null);
  const highlightTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const focusFirstEmptyRefInput = React.useCallback(() => {
    const root = dialogContentRef.current;
    if (!root) return;
    const candidates = Array.from(
      root.querySelectorAll<HTMLInputElement>('input[data-batch-ref-input="true"]')
    ).filter((el) => el.offsetParent !== null && !el.disabled);
    if (candidates.length === 0) return;
    const firstEmpty = candidates.find((el) => !el.value.trim()) || candidates[0];
    firstEmpty.focus();
  }, []);

  const [batchItems, setBatchItems] = React.useState<PaymentItem[]>([]);
  const [batchDate, setBatchDate] = React.useState<string>(getTodayISTDateString());
  const [notes, setNotes] = React.useState<string>('');
  const [rowRefs, setRowRefs] = React.useState<Record<string, RowRefState>>({});

  // Single combined receipt upload state
  const [receiptFilePath, setReceiptFilePath] = React.useState<string | null>(null);
  const [receiptFileName, setReceiptFileName] = React.useState<string | null>(null);
  const [receiptMimeType, setReceiptMimeType] = React.useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);
  const [showInlinePreview, setShowInlinePreview] = React.useState<boolean>(false);
  const [imageZoomed, setImageZoomed] = React.useState<boolean>(false);
  const [isDragging, setIsDragging] = React.useState<boolean>(false);
  const [isUploading, setIsUploading] = React.useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = React.useState<boolean>(false);
  const [formError, setFormError] = React.useState<string | null>(null);

  // Bulk UTR entry helpers state
  const [isParsingUtrReport, setIsParsingUtrReport] = React.useState<boolean>(false);
  const [showPasteBox, setShowPasteBox] = React.useState<boolean>(false);
  const [pasteText, setPasteText] = React.useState<string>('');
  const [autoMatchedIds, setAutoMatchedIds] = React.useState<Set<string>>(
    () => new Set()
  );

  // Post-settlement success view state
  const [settledResult, setSettledResult] = React.useState<{
    batch: PaymentBatch;
    payments: PaymentItem[];
  } | null>(null);
  const [advicePayment, setAdvicePayment] = React.useState<PaymentItem | null>(null);

  // Initialize / reset state cleanly when modal opens with a fresh selection
  React.useEffect(() => {
    if (!open) return;

    if (highlightTimeoutRef.current) {
      clearTimeout(highlightTimeoutRef.current);
      highlightTimeoutRef.current = null;
    }

    const todayIst = getTodayISTDateString();
    const sorted = sortItemsForAxisOrder(selectedItems);
    setBatchItems(sorted);
    setBatchDate(todayIst);
    setNotes('');
    setReceiptFilePath(null);
    setReceiptFileName(null);
    setReceiptMimeType(null);
    setPreviewUrl(null);
    setShowInlinePreview(false);
    setImageZoomed(false);
    setIsDragging(false);
    setIsUploading(false);
    setIsSubmitting(false);
    setIsParsingUtrReport(false);
    setShowPasteBox(false);
    setPasteText('');
    setAutoMatchedIds(new Set());
    setFormError(null);
    setSettledResult(null);
    setAdvicePayment(null);

    const initialMap: Record<string, RowRefState> = {};
    for (const item of sorted) {
      initialMap[item.id] = {
        utr_number: item.utr_number ? item.utr_number.toUpperCase() : '',
        cheque_number: item.cheque_number ? item.cheque_number.toUpperCase() : '',
        cheque_date: item.cheque_date || todayIst,
      };
    }
    setRowRefs(initialMap);

    const timer = setTimeout(() => {
      focusFirstEmptyRefInput();
    }, 60);
    return () => clearTimeout(timer);
  }, [open, selectedItems, focusFirstEmptyRefInput]);

  React.useEffect(() => {
    return () => {
      if (highlightTimeoutRef.current) {
        clearTimeout(highlightTimeoutRef.current);
      }
    };
  }, []);

  const flashHighlightedRows = (ids: string[]) => {
    if (ids.length === 0) return;
    setAutoMatchedIds(new Set(ids));
    if (highlightTimeoutRef.current) {
      clearTimeout(highlightTimeoutRef.current);
    }
    highlightTimeoutRef.current = setTimeout(() => {
      setAutoMatchedIds(new Set());
      highlightTimeoutRef.current = null;
    }, 2800);
  };

  const groupCounts = React.useMemo(() => {
    const counts: Record<AxisGroupKey, number> = {
      SAME_BANK: 0,
      OTHER_BANK: 0,
      CHEQUE: 0,
    };
    for (const item of batchItems) {
      counts[getAxisGroupKey(item)] += 1;
    }
    return counts;
  }, [batchItems]);

  const distinctGroupCount = React.useMemo(
    () =>
      (['SAME_BANK', 'OTHER_BANK', 'CHEQUE'] as AxisGroupKey[]).filter(
        (key) => groupCounts[key] > 0
      ).length,
    [groupCounts]
  );

  const primarySameBankPrefix = React.useMemo(() => {
    const firstSame = batchItems.find((i) => getAxisGroupKey(i) === 'SAME_BANK');
    return firstSame ? resolveSourceIfscPrefix(firstSame) : '';
  }, [batchItems]);

  const totalAmount = React.useMemo(
    () =>
      round2(
        batchItems.reduce((sum, item) => sum + Number(item.net_payable || 0), 0)
      ),
    [batchItems]
  );

  const uniqueBankNames = React.useMemo(() => {
    const names = new Set<string>();
    for (const item of batchItems) {
      const bankLabel =
        item.source_bank?.short_code ||
        item.source_bank?.short_name ||
        item.source_bank?.bank_name ||
        item.source_bank?.full_name;
      if (bankLabel) {
        names.add(bankLabel);
      }
    }
    return Array.from(names);
  }, [batchItems]);

  // Live in-batch duplicate UTR detection
  const duplicateUtrMap = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of batchItems) {
      if (item.payment_mode === 'CHEQUE') continue;
      const utr = (rowRefs[item.id]?.utr_number || '').trim().toUpperCase();
      if (!utr) continue;
      counts.set(utr, (counts.get(utr) || 0) + 1);
    }
    const dupes = new Set<string>();
    for (const [utr, count] of counts.entries()) {
      if (count > 1) dupes.add(utr);
    }
    return dupes;
  }, [batchItems, rowRefs]);

  const missingRefCount = React.useMemo(() => {
    let missing = 0;
    for (const item of batchItems) {
      const ref = rowRefs[item.id];
      if (item.payment_mode === 'CHEQUE') {
        if (!ref?.cheque_number.trim()) missing += 1;
      } else {
        if (!ref?.utr_number.trim()) missing += 1;
      }
    }
    return missing;
  }, [batchItems, rowRefs]);

  const nonChequeCount = React.useMemo(
    () => batchItems.filter((item) => item.payment_mode !== 'CHEQUE').length,
    [batchItems]
  );

  const canSubmit =
    batchItems.length > 0 &&
    Boolean(receiptFilePath) &&
    missingRefCount === 0 &&
    duplicateUtrMap.size === 0 &&
    !isUploading &&
    !isSubmitting;

  const updateRowField = (
    paymentId: string,
    field: keyof RowRefState,
    value: string
  ) => {
    setFormError(null);
    setRowRefs((prev) => ({
      ...prev,
      [paymentId]: {
        utr_number: prev[paymentId]?.utr_number || '',
        cheque_number: prev[paymentId]?.cheque_number || '',
        cheque_date: prev[paymentId]?.cheque_date || batchDate,
        [field]: value,
      },
    }));
  };

  const handleRemoveFromBatch = (paymentId: string) => {
    if (batchItems.length <= 1 || isSubmitting) return;
    setFormError(null);
    setBatchItems((prev) => prev.filter((item) => item.id !== paymentId));
    setAutoMatchedIds((prev) => {
      if (!prev.has(paymentId)) return prev;
      const next = new Set(prev);
      next.delete(paymentId);
      return next;
    });
    toast.info('Removed payment from this batch (it stays Ready to Pay).');
  };

  const handleAutoFillReportChange = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (file.size > 4 * 1024 * 1024) {
      toast.error('Bank report file exceeds 4 MB limit.');
      return;
    }

    setFormError(null);
    setIsParsingUtrReport(true);
    try {
      const fd = new FormData();
      fd.append('file', file);

      const res = await fetch('/api/payments/parse-utr-report', {
        method: 'POST',
        body: fd,
      });

      const payload = (await res.json().catch(() => ({}))) as {
        rows?: ParsedUtrReportRow[];
        skippedFailedCount?: number;
        error?: string;
      };

      if (!res.ok) {
        toast.error(payload.error || 'Failed to parse bank UTR report.');
        return;
      }

      const reportRows = payload.rows || [];
      if (reportRows.length === 0) {
        toast.warning('No valid settled UTR rows found in the uploaded bank report.');
        return;
      }

      const { matches, nonChequeCount: eligibleCount } = matchBankReportRows(
        batchItems,
        reportRows
      );

      if (matches.size === 0) {
        toast.warning(
          'No matching UTR rows found. Check that beneficiary accounts/names and amounts match.'
        );
        return;
      }

      setRowRefs((prev) => {
        const next = { ...prev };
        for (const [paymentId, utr] of matches.entries()) {
          next[paymentId] = {
            utr_number: utr,
            cheque_number: prev[paymentId]?.cheque_number || '',
            cheque_date: prev[paymentId]?.cheque_date || batchDate,
          };
        }
        return next;
      });

      flashHighlightedRows(Array.from(matches.keys()));

      const remaining = Math.max(0, eligibleCount - matches.size);
      const skippedNotice =
        payload.skippedFailedCount && payload.skippedFailedCount > 0
          ? ` (${payload.skippedFailedCount} failed row(s) skipped)`
          : '';

      if (remaining === 0) {
        toast.success(
          `Auto-filled ${matches.size} of ${eligibleCount} UTRs from bank report${skippedNotice}. Please review before confirming.`
        );
      } else {
        toast.success(
          `Auto-filled ${matches.size} of ${eligibleCount} UTRs from bank report${skippedNotice}. Please review & fill ${remaining} remaining.`
        );
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to read bank UTR report.'
      );
    } finally {
      setIsParsingUtrReport(false);
    }
  };

  const handleApplyPastedUtrs = () => {
    const tokens = pasteText
      .split(/[\r\n,;\t]+/)
      .map((t) => t.trim().toUpperCase())
      .filter(Boolean);

    if (tokens.length === 0) {
      toast.error('Paste at least one UTR number (one per line).');
      return;
    }

    const emptyEligibleItems = batchItems.filter((item) => {
      if (item.payment_mode === 'CHEQUE') return false;
      return !(rowRefs[item.id]?.utr_number || '').trim();
    });

    if (emptyEligibleItems.length === 0) {
      toast.info('All non-Cheque rows already have UTR values.');
      return;
    }

    const countToApply = Math.min(tokens.length, emptyEligibleItems.length);
    const updatedIds: string[] = [];

    setRowRefs((prev) => {
      const next = { ...prev };
      for (let i = 0; i < countToApply; i += 1) {
        const item = emptyEligibleItems[i];
        next[item.id] = {
          utr_number: tokens[i],
          cheque_number: prev[item.id]?.cheque_number || '',
          cheque_date: prev[item.id]?.cheque_date || batchDate,
        };
        updatedIds.push(item.id);
      }
      return next;
    });

    flashHighlightedRows(updatedIds);
    setPasteText('');
    setShowPasteBox(false);
    toast.success(`Applied ${countToApply} UTR${countToApply === 1 ? '' : 's'} to empty rows.`);
  };

  const handleFileUpload = async (file: File) => {
    setFormError(null);

    if (file.size > 4 * 1024 * 1024) {
      const msg = 'Combined Bank Receipt PDF/Image must be 4 MB or smaller.';
      setFormError(msg);
      toast.error(msg);
      return;
    }

    const allowedTypes = [
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/webp',
    ];
    if (file.type && !allowedTypes.includes(file.type)) {
      const msg = 'Allowed formats: PDF, JPG, PNG, or WebP.';
      setFormError(msg);
      toast.error(msg);
      return;
    }

    setIsUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('paymentId', 'batch');

      const uploadRes = await uploadReceiptFile(fd);
      if (!uploadRes.success) {
        setFormError(uploadRes.error);
        toast.error(uploadRes.error);
        return;
      }

      setReceiptFilePath(uploadRes.data.filePath);
      setReceiptFileName(uploadRes.data.fileName || file.name);
      setReceiptMimeType(
        file.type ||
          (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/*')
      );

      const signedRes = await getSignedFileUrl(
        'bank-receipts',
        uploadRes.data.filePath
      );
      if (signedRes.success) {
        setPreviewUrl(signedRes.data.signedUrl);
        setShowInlinePreview(true);
      } else {
        setPreviewUrl(null);
        setShowInlinePreview(false);
      }

      toast.success('Combined Bank Receipt uploaded');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Receipt upload failed.';
      setFormError(msg);
      toast.error(msg);
    } finally {
      setIsUploading(false);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      void handleFileUpload(file);
    }
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      void handleFileUpload(file);
    }
  };

  const clearUploadedReceipt = () => {
    setReceiptFilePath(null);
    setReceiptFileName(null);
    setReceiptMimeType(null);
    setPreviewUrl(null);
    setShowInlinePreview(false);
    setImageZoomed(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (batchItems.length === 0) {
      setFormError('Select at least one Ready-to-Pay item.');
      return;
    }

    if (!receiptFilePath) {
      setFormError('Upload the combined Bank Receipt PDF or image before settling.');
      return;
    }

    if (missingRefCount > 0) {
      setFormError(
        `${missingRefCount} payment${missingRefCount > 1 ? 's are' : ' is'} missing a UTR or Cheque Number.`
      );
      return;
    }

    if (duplicateUtrMap.size > 0) {
      setFormError(
        `Duplicate UTR detected in this batch: ${Array.from(duplicateUtrMap).join(', ')}. Each payment requires a unique UTR.`
      );
      return;
    }

    setIsSubmitting(true);
    try {
      const payloadItems = batchItems.map((item) => {
        const ref = rowRefs[item.id];
        if (item.payment_mode === 'CHEQUE') {
          return {
            payment_id: item.id,
            cheque_number: (ref?.cheque_number || '').trim().toUpperCase(),
            cheque_date: ref?.cheque_date || batchDate,
          };
        }
        return {
          payment_id: item.id,
          utr_number: (ref?.utr_number || '').trim().toUpperCase(),
        };
      });

      const res = await settlePaymentBatch({
        batch_date: batchDate,
        receipt_file_path: receiptFilePath,
        notes: notes.trim() || undefined,
        items: payloadItems,
      });

      if (!res.success) {
        setFormError(res.error);
        toast.error(res.error);
        return;
      }

      toast.success(
        `Batch ${res.data.batch.batch_code} settled (${res.data.batch.item_count} paid)`
      );
      onSuccess(res.data);
      setSettledResult(res.data);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Failed to settle payment batch.';
      setFormError(msg);
      toast.error(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCloseModal = () => {
    if (isSubmitting) return;
    onOpenChange(false);
  };

  const isPdfReceipt =
    receiptMimeType === 'application/pdf' ||
    (receiptFileName?.toLowerCase().endsWith('.pdf') ?? false);

  const showSplitPdfPane = Boolean(
    receiptFilePath && previewUrl && showInlinePreview && !settledResult
  );

  const getSectionLabel = (groupKey: AxisGroupKey): string => {
    if (groupKey === 'SAME_BANK') {
      return `Same-Bank · ${primarySameBankPrefix || 'UTIB'} (${groupCounts.SAME_BANK})`;
    }
    if (groupKey === 'OTHER_BANK') {
      return `Other-Bank · NEFT / RTGS / IMPS (${groupCounts.OTHER_BANK})`;
    }
    return `Cheque (${groupCounts.CHEQUE})`;
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => !isSubmitting && onOpenChange(next)}>
        <DialogContent
          ref={dialogContentRef}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            requestAnimationFrame(() => focusFirstEmptyRefInput());
          }}
          className={cn(
            'w-[calc(100vw-1rem)] sm:w-[calc(100vw-2rem)] p-0 overflow-hidden gap-0 transition-all',
            showSplitPdfPane ? 'max-w-6xl' : 'max-w-4xl'
          )}
        >
          {settledResult ? (
            /* ============================================================
               POST-SETTLEMENT SUCCESS VIEW + WHATSAPP PAYMENT ADVICE LINKS
            ============================================================ */
            <div className="flex flex-col max-h-[88dvh]">
              <DialogHeader className="px-5 py-4 border-b border-slate-200 bg-emerald-50/70">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-full bg-emerald-100 border border-emerald-200 text-emerald-700 flex items-center justify-center shrink-0">
                    <CheckCircle2 className="w-5 h-5" />
                  </div>
                  <div className="min-w-0 flex-1 pr-6">
                    <DialogTitle className="text-base sm:text-lg font-bold text-slate-900">
                      Day Batch Settled Successfully
                    </DialogTitle>
                    <DialogDescription className="text-xs sm:text-sm text-slate-600 mt-0.5">
                      Batch{' '}
                      <span className="font-mono font-bold text-slate-900">
                        {settledResult.batch.batch_code}
                      </span>{' '}
                      · {settledResult.batch.item_count} payment
                      {settledResult.batch.item_count === 1 ? '' : 's'} totaling{' '}
                      <span className="font-bold text-slate-900 tabular-nums">
                        {formatINR(settledResult.batch.total_amount)}
                      </span>{' '}
                      marked Paid with 1 combined Bank Receipt.
                    </DialogDescription>
                  </div>
                </div>
              </DialogHeader>

              <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-3">
                <div className="rounded-lg border border-slate-200 bg-slate-50/80 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2 text-slate-600">
                    <Receipt className="w-4 h-4 text-brand shrink-0" />
                    <span>
                      Send individual Payment Advice slips to vendors via WhatsApp or download PNG/PDF:
                    </span>
                  </div>
                  <span className="font-mono font-semibold text-slate-700">
                    {formatHumanDate(settledResult.batch.batch_date)}
                  </span>
                </div>

                <div className="divide-y divide-slate-200 border border-slate-200 rounded-xl overflow-hidden bg-white">
                  {settledResult.payments.map((payment) => {
                    const vendorName =
                      payment.vendor?.party_name ||
                      payment.vendor?.name ||
                      payment.vendor?.beneficiary_name ||
                      'Beneficiary';
                    const refText =
                      payment.payment_mode === 'CHEQUE'
                        ? payment.cheque_number
                          ? `CHQ ${payment.cheque_number}`
                          : 'Cheque'
                        : payment.utr_number || 'Paid';

                    return (
                      <div
                        key={payment.id}
                        className="px-3.5 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                      >
                        <div className="min-w-0 space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-semibold text-slate-900 truncate">
                              {vendorName}
                            </span>
                            <PaymentModeBadge mode={payment.payment_mode} />
                            {payment.receipt_sent_at && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                Advice Sent ✓
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2.5 text-xs text-slate-500 flex-wrap">
                            <span className="font-bold text-slate-900 tabular-nums">
                              {formatINR(payment.net_payable)}
                            </span>
                            <span>·</span>
                            <span className="font-mono text-slate-700">{refText}</span>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => setAdvicePayment(payment)}
                          className="min-h-[40px] px-3 py-1.5 rounded-lg bg-brand hover:bg-brand-hover text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 shrink-0 transition-colors cursor-pointer"
                        >
                          <Send className="w-3.5 h-3.5" />
                          <span>Payment Advice / WhatsApp</span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="px-5 py-3.5 border-t border-slate-200 bg-slate-50 flex items-center justify-end">
                <button
                  type="button"
                  onClick={handleCloseModal}
                  className="min-h-[44px] px-5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold transition-colors cursor-pointer"
                >
                  Done
                </button>
              </div>
            </div>
          ) : (
            /* ============================================================
               BATCH SETTLEMENT ENTRY FORM (WITH SIDE-BY-SIDE PDF VIEWER)
            ============================================================ */
            <form onSubmit={handleSubmit} className="flex flex-col max-h-[90dvh]">
              <DialogHeader className="px-5 py-4 border-b border-slate-200 bg-slate-50/70 shrink-0">
                <div className="flex items-start justify-between gap-3 pr-6">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-brand-tint text-brand text-[11px] font-bold uppercase tracking-wider">
                        <Layers className="w-3 h-3" />
                        Day Batch Settlement
                      </span>
                      <span className="text-xs font-medium text-slate-500">
                        {formatHumanDate(batchDate)}
                      </span>
                    </div>
                    <DialogTitle className="text-base sm:text-lg font-bold text-slate-900">
                      Settle {batchItems.length} Payment
                      {batchItems.length === 1 ? '' : 's'} with Combined Bank PDF
                    </DialogTitle>
                    <DialogDescription className="text-xs text-slate-500">
                      Enter or auto-fill UTR/Cheque references first, then attach the combined bank confirmation PDF/image below.
                    </DialogDescription>
                  </div>

                  <div className="hidden sm:flex flex-col items-end shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-2">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                      Batch Total
                    </span>
                    <span className="text-lg font-bold text-slate-900 tabular-nums">
                      {formatINR(totalAmount)}
                    </span>
                  </div>
                </div>
              </DialogHeader>

              <div
                className={cn(
                  'flex-1 min-h-0 p-4 sm:p-5',
                  showSplitPdfPane
                    ? 'overflow-y-auto lg:overflow-hidden lg:grid lg:grid-cols-12 lg:gap-5'
                    : 'overflow-y-auto space-y-4'
                )}
              >
                {/* LEFT COLUMN: Metadata Strip, Section 1 (UTR List FIRST), Section 2 (Compact Bank PDF Strip) */}
                <div
                  className={cn(
                    'space-y-4',
                    showSplitPdfPane &&
                      'lg:col-span-7 lg:overflow-y-auto lg:pr-1.5 lg:max-h-[calc(90dvh-165px)]'
                  )}
                >
                  {/* Slim 1-Row Batch Metadata Strip */}
                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end">
                    <div className="sm:col-span-4 space-y-1">
                      <label className="text-[11px] font-semibold text-slate-700 flex items-center gap-1">
                        <CalendarDays className="w-3.5 h-3.5 text-slate-400" />
                        <span>Batch Date</span>
                      </label>
                      <DatePicker
                        size="sm"
                        value={batchDate}
                        onChange={(val) => setBatchDate(val || getTodayISTDateString())}
                        disabled={isSubmitting}
                      />
                    </div>

                    <div className="sm:col-span-5 space-y-1">
                      <label
                        htmlFor="batch-notes"
                        className="text-[11px] font-semibold text-slate-700"
                      >
                        Batch Notes (optional)
                      </label>
                      <input
                        id="batch-notes"
                        type="text"
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        maxLength={500}
                        disabled={isSubmitting}
                        placeholder="e.g., Axis Afternoon Bulk Run"
                        className="w-full h-9 px-3 rounded-lg border border-slate-200 bg-white text-xs sm:text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand"
                      />
                    </div>

                    <div className="sm:col-span-3 h-9 rounded-lg border border-slate-200 bg-slate-50 px-3 flex items-center justify-between gap-2">
                      <span className="text-[11px] font-medium text-slate-500 flex items-center gap-1 truncate">
                        <Landmark className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span className="truncate">
                          {uniqueBankNames.length === 1
                            ? uniqueBankNames[0]
                            : uniqueBankNames.length > 1
                            ? `${uniqueBankNames.length} Banks`
                            : 'Batch'}
                        </span>
                      </span>
                      <span className="text-xs sm:text-sm font-bold text-slate-900 tabular-nums shrink-0">
                        {formatINR(totalAmount)}
                      </span>
                    </div>
                  </div>

                  {/* SECTION 1 (TOP): Per-Item UTR / Cheque Entry + Bulk UTR Entry Helpers */}
                  <div className="space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <label className="text-xs font-semibold text-slate-800">
                        1. Enter UTR / Cheque Numbers for This Batch ({batchItems.length}) *
                      </label>
                      <div className="flex items-center gap-2 text-[11px]">
                        {duplicateUtrMap.size > 0 && (
                          <span className="font-semibold text-rose-600">
                            Duplicate UTR found
                          </span>
                        )}
                        {missingRefCount > 0 && (
                          <span className="font-medium text-amber-700">
                            {missingRefCount} pending reference{missingRefCount === 1 ? '' : 's'}
                          </span>
                        )}
                        {missingRefCount === 0 && duplicateUtrMap.size === 0 && (
                          <span className="font-semibold text-emerald-700">
                            All references filled ✓
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Two Fast Bulk UTR Entry Helpers */}
                    {nonChequeCount > 0 && (
                      <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-2.5 space-y-2.5">
                        <input
                          ref={utrReportInputRef}
                          type="file"
                          accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                          onChange={handleAutoFillReportChange}
                          className="hidden"
                        />

                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-[11px] font-medium text-slate-600">
                            Fast UTR Fill (sorted in Axis Excel order):
                          </span>
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              disabled={isParsingUtrReport || isSubmitting}
                              onClick={() => utrReportInputRef.current?.click()}
                              className="h-8 px-2.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-800 text-[11px] font-semibold inline-flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer disabled:opacity-50"
                            >
                              {isParsingUtrReport ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin text-brand" />
                              ) : (
                                <FileSpreadsheet className="w-3.5 h-3.5 text-brand" />
                              )}
                              <span>
                                {isParsingUtrReport
                                  ? 'Reading Report…'
                                  : 'Auto-Fill UTRs (.xlsx / .csv)'}
                              </span>
                            </button>

                            <button
                              type="button"
                              disabled={isSubmitting}
                              onClick={() => setShowPasteBox((prev) => !prev)}
                              className={cn(
                                'h-8 px-2.5 rounded-lg border text-[11px] font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer',
                                showPasteBox
                                  ? 'border-brand/40 bg-brand-tint text-brand'
                                  : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
                              )}
                            >
                              <ClipboardPaste className="w-3.5 h-3.5" />
                              <span>Paste UTR List</span>
                            </button>
                          </div>
                        </div>

                        {showPasteBox && (
                          <div className="rounded-lg border border-slate-200 bg-white p-2.5 space-y-2">
                            <textarea
                              rows={3}
                              value={pasteText}
                              onChange={(e) => setPasteText(e.target.value)}
                              placeholder="Paste UTR numbers copied from Axis Neo or Excel (one per line)…"
                              className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand"
                            />
                            <div className="flex items-center justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  setShowPasteBox(false);
                                  setPasteText('');
                                }}
                                className="h-7 px-2.5 rounded-md border border-slate-200 text-[11px] font-medium text-slate-600 hover:bg-slate-50 cursor-pointer"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                onClick={handleApplyPastedUtrs}
                                className="h-7 px-3 rounded-md bg-brand hover:bg-brand-hover text-white text-[11px] font-semibold cursor-pointer"
                              >
                                Apply to Empty Rows
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Desktop Table */}
                    <div className="hidden md:block rounded-xl border border-slate-200 overflow-hidden bg-white">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                            <th className="py-2.5 px-3">Payee & Bank</th>
                            <th className="py-2.5 px-3">Mode</th>
                            <th className="py-2.5 px-3 text-right">Net Amount</th>
                            <th className="py-2.5 px-3 w-[250px]">UTR / Cheque Reference *</th>
                            {batchItems.length > 1 && <th className="py-2.5 pr-2 w-8" />}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200">
                          {batchItems.map((item, idx) => {
                            const groupKey = getAxisGroupKey(item);
                            const prevGroupKey =
                              idx > 0 ? getAxisGroupKey(batchItems[idx - 1]) : null;
                            const showGroupHeader =
                              distinctGroupCount > 1 && groupKey !== prevGroupKey;

                            const vendorName =
                              item.vendor?.party_name ||
                              item.vendor?.name ||
                              item.vendor?.beneficiary_name ||
                              'Beneficiary';
                            const accountNo =
                              item.vendor?.account_number || item.vendor?.bank_account_no;
                            const ref = rowRefs[item.id] || {
                              utr_number: '',
                              cheque_number: '',
                              cheque_date: batchDate,
                            };
                            const isCheque = item.payment_mode === 'CHEQUE';
                            const normalizedUtr = ref.utr_number.trim().toUpperCase();
                            const isDupUtr =
                              !isCheque &&
                              Boolean(normalizedUtr) &&
                              duplicateUtrMap.has(normalizedUtr);
                            const isHighlighted = autoMatchedIds.has(item.id);

                            return (
                              <React.Fragment key={item.id}>
                                {showGroupHeader && (
                                  <tr className="bg-slate-50/90 border-y border-slate-200">
                                    <td
                                      colSpan={batchItems.length > 1 ? 5 : 4}
                                      className="py-1.5 px-3 text-[10px] font-bold uppercase tracking-wider text-slate-500"
                                    >
                                      {getSectionLabel(groupKey)}
                                    </td>
                                  </tr>
                                )}
                                <tr
                                  className={cn(
                                    'align-top transition-colors',
                                    isHighlighted
                                      ? 'bg-emerald-50/70'
                                      : 'hover:bg-slate-50/50'
                                  )}
                                >
                                  <td className="py-2.5 px-3">
                                    <div className="space-y-1">
                                      <p className="text-xs font-semibold text-slate-900">
                                        {vendorName}
                                      </p>
                                      <div className="flex items-center gap-1.5 flex-wrap">
                                        <BankBadge
                                          shortName={
                                            item.source_bank?.short_code ||
                                            item.source_bank?.short_name
                                          }
                                          fullName={
                                            item.source_bank?.bank_name ||
                                            item.source_bank?.full_name
                                          }
                                        />
                                        {accountNo && (
                                          <span className="text-[11px] font-mono text-slate-500">
                                            ···{accountNo.slice(-4)}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  </td>
                                  <td className="py-2.5 px-3">
                                    <PaymentModeBadge mode={item.payment_mode} compact />
                                  </td>
                                  <td className="py-2.5 px-3 text-right">
                                    <span className="text-xs font-bold text-slate-900 tabular-nums">
                                      {formatINR(item.net_payable)}
                                    </span>
                                  </td>
                                  <td className="py-2 px-3">
                                    {isCheque ? (
                                      <div className="grid grid-cols-2 gap-1.5">
                                        <input
                                          type="text"
                                          data-batch-ref-input="true"
                                          value={ref.cheque_number}
                                          onChange={(e) =>
                                            updateRowField(
                                              item.id,
                                              'cheque_number',
                                              e.target.value.toUpperCase()
                                            )
                                          }
                                          placeholder="Cheque No *"
                                          disabled={isSubmitting}
                                          className="h-9 px-2.5 rounded-lg border border-slate-200 bg-white font-mono text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand"
                                        />
                                        <DatePicker
                                          size="sm"
                                          value={ref.cheque_date || batchDate}
                                          onChange={(val) =>
                                            updateRowField(
                                              item.id,
                                              'cheque_date',
                                              val || batchDate
                                            )
                                          }
                                          disabled={isSubmitting}
                                        />
                                      </div>
                                    ) : (
                                      <div className="space-y-1">
                                        <input
                                          type="text"
                                          data-batch-ref-input="true"
                                          value={ref.utr_number}
                                          onChange={(e) =>
                                            updateRowField(
                                              item.id,
                                              'utr_number',
                                              e.target.value.toUpperCase()
                                            )
                                          }
                                          placeholder="Enter Bank UTR / Ref *"
                                          disabled={isSubmitting}
                                          className={cn(
                                            'w-full h-9 px-2.5 rounded-lg border bg-white font-mono text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 transition-colors',
                                            isDupUtr
                                              ? 'border-rose-400 focus:ring-rose-200 focus:border-rose-500 bg-rose-50/40'
                                              : isHighlighted
                                              ? 'border-emerald-400 ring-2 ring-emerald-200'
                                              : 'border-slate-200 focus:ring-brand/20 focus:border-brand'
                                          )}
                                        />
                                        {isDupUtr && (
                                          <p className="text-[10px] font-semibold text-rose-600">
                                            Duplicate UTR in batch
                                          </p>
                                        )}
                                      </div>
                                    )}
                                  </td>
                                  {batchItems.length > 1 && (
                                    <td className="py-2 pr-2 text-right">
                                      <button
                                        type="button"
                                        onClick={() => handleRemoveFromBatch(item.id)}
                                        disabled={isSubmitting}
                                        title="Remove from this batch"
                                        aria-label={`Remove ${vendorName} from this batch`}
                                        className="w-7 h-7 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 inline-flex items-center justify-center transition-colors cursor-pointer disabled:opacity-40"
                                      >
                                        <X className="w-3.5 h-3.5" />
                                      </button>
                                    </td>
                                  )}
                                </tr>
                              </React.Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* Mobile Cards */}
                    <div className="md:hidden space-y-2.5">
                      {batchItems.map((item, idx) => {
                        const groupKey = getAxisGroupKey(item);
                        const prevGroupKey =
                          idx > 0 ? getAxisGroupKey(batchItems[idx - 1]) : null;
                        const showGroupHeader =
                          distinctGroupCount > 1 && groupKey !== prevGroupKey;

                        const vendorName =
                          item.vendor?.party_name ||
                          item.vendor?.name ||
                          item.vendor?.beneficiary_name ||
                          'Beneficiary';
                        const ref = rowRefs[item.id] || {
                          utr_number: '',
                          cheque_number: '',
                          cheque_date: batchDate,
                        };
                        const isCheque = item.payment_mode === 'CHEQUE';
                        const normalizedUtr = ref.utr_number.trim().toUpperCase();
                        const isDupUtr =
                          !isCheque &&
                          Boolean(normalizedUtr) &&
                          duplicateUtrMap.has(normalizedUtr);
                        const isHighlighted = autoMatchedIds.has(item.id);

                        return (
                          <React.Fragment key={item.id}>
                            {showGroupHeader && (
                              <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-500 border-b border-slate-200">
                                {getSectionLabel(groupKey)}
                              </div>
                            )}
                            <div
                              className={cn(
                                'rounded-xl border bg-white p-3 space-y-2.5 transition-colors',
                                isHighlighted
                                  ? 'border-emerald-400 bg-emerald-50/50'
                                  : 'border-slate-200'
                              )}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0 space-y-1">
                                  <p className="text-xs font-semibold text-slate-900 truncate">
                                    {vendorName}
                                  </p>
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <PaymentModeBadge mode={item.payment_mode} compact />
                                    <BankBadge
                                      shortName={
                                        item.source_bank?.short_code ||
                                        item.source_bank?.short_name
                                      }
                                      fullName={
                                        item.source_bank?.bank_name ||
                                        item.source_bank?.full_name
                                      }
                                    />
                                  </div>
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  <span className="text-sm font-bold text-slate-900 tabular-nums">
                                    {formatINR(item.net_payable)}
                                  </span>
                                  {batchItems.length > 1 && (
                                    <button
                                      type="button"
                                      onClick={() => handleRemoveFromBatch(item.id)}
                                      disabled={isSubmitting}
                                      title="Remove from this batch"
                                      aria-label={`Remove ${vendorName} from this batch`}
                                      className="w-7 h-7 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 inline-flex items-center justify-center transition-colors cursor-pointer"
                                    >
                                      <X className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                </div>
                              </div>

                              {isCheque ? (
                                <div className="grid grid-cols-2 gap-2">
                                  <input
                                    type="text"
                                    data-batch-ref-input="true"
                                    value={ref.cheque_number}
                                    onChange={(e) =>
                                      updateRowField(
                                        item.id,
                                        'cheque_number',
                                        e.target.value.toUpperCase()
                                      )
                                    }
                                    placeholder="Cheque No *"
                                    disabled={isSubmitting}
                                    className="h-11 px-3 rounded-lg border border-slate-200 bg-white font-mono text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand"
                                  />
                                  <DatePicker
                                    value={ref.cheque_date || batchDate}
                                    onChange={(val) =>
                                      updateRowField(
                                        item.id,
                                        'cheque_date',
                                        val || batchDate
                                      )
                                    }
                                    disabled={isSubmitting}
                                  />
                                </div>
                              ) : (
                                <div className="space-y-1">
                                  <input
                                    type="text"
                                    data-batch-ref-input="true"
                                    value={ref.utr_number}
                                    onChange={(e) =>
                                      updateRowField(
                                        item.id,
                                        'utr_number',
                                        e.target.value.toUpperCase()
                                      )
                                    }
                                    placeholder="Enter Bank UTR / Ref *"
                                    disabled={isSubmitting}
                                    className={cn(
                                      'w-full h-11 px-3 rounded-lg border bg-white font-mono text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2',
                                      isDupUtr
                                        ? 'border-rose-400 focus:ring-rose-200 focus:border-rose-500 bg-rose-50/40'
                                        : isHighlighted
                                        ? 'border-emerald-400 ring-2 ring-emerald-200'
                                        : 'border-slate-200 focus:ring-brand/20 focus:border-brand'
                                    )}
                                  />
                                  {isDupUtr && (
                                    <p className="text-[11px] font-semibold text-rose-600">
                                      Duplicate UTR in batch
                                    </p>
                                  )}
                                </div>
                              )}
                            </div>
                          </React.Fragment>
                        );
                      })}
                    </div>
                  </div>

                  {/* SECTION 2 (BELOW UTR LIST): Compact Combined Bank Receipt Upload */}
                  <div className="space-y-2 pt-1">
                    <div className="flex items-center justify-between gap-2">
                      <label className="text-xs font-semibold text-slate-800">
                        2. Attach Combined Bank Confirmation Receipt (PDF / Image) *
                      </label>
                      {receiptFilePath && (
                        <button
                          type="button"
                          onClick={clearUploadedReceipt}
                          disabled={isSubmitting}
                          className="text-xs font-semibold text-rose-600 hover:text-rose-700 inline-flex items-center gap-1 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Replace File</span>
                        </button>
                      )}
                    </div>

                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="application/pdf,image/jpeg,image/png,image/webp"
                      onChange={handleFileInputChange}
                      className="hidden"
                    />

                    {!receiptFilePath ? (
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => !isUploading && fileInputRef.current?.click()}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            if (!isUploading) fileInputRef.current?.click();
                          }
                        }}
                        onDragOver={(e) => {
                          e.preventDefault();
                          setIsDragging(true);
                        }}
                        onDragLeave={() => setIsDragging(false)}
                        onDrop={handleDrop}
                        className={cn(
                          'rounded-xl border-2 border-dashed px-3.5 py-2.5 flex items-center justify-between gap-3 transition-colors cursor-pointer',
                          isDragging
                            ? 'border-brand bg-brand-tint/40'
                            : 'border-slate-300 bg-slate-50/70 hover:border-brand/60 hover:bg-slate-50'
                        )}
                      >
                        {isUploading ? (
                          <div className="flex items-center gap-2 text-slate-600 py-0.5">
                            <Loader2 className="w-4 h-4 animate-spin text-brand shrink-0" />
                            <p className="text-xs font-semibold">
                              Uploading combined bank receipt…
                            </p>
                          </div>
                        ) : (
                          <>
                            <div className="flex items-center gap-2.5 min-w-0">
                              <UploadCloud className="w-5 h-5 text-brand shrink-0" />
                              <div className="min-w-0">
                                <p className="text-xs font-semibold text-slate-800 truncate">
                                  Drop combined Bank Advice PDF/Image here or{' '}
                                  <span className="text-brand underline">browse</span>
                                </p>
                                <p className="text-[11px] text-slate-500 truncate">
                                  Attaches to all {batchItems.length} payment
                                  {batchItems.length === 1 ? '' : 's'} (PDF, JPG, PNG, WebP · max 4 MB)
                                </p>
                              </div>
                            </div>
                            <span className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-[11px] font-semibold text-slate-700 shrink-0 shadow-2xs">
                              Choose File
                            </span>
                          </>
                        )}
                      </div>
                    ) : (
                      <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 space-y-2.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                              <FileText className="w-4 h-4" />
                            </div>
                            <div className="min-w-0">
                              <p className="text-xs font-semibold text-slate-900 truncate">
                                {receiptFileName || 'Combined Bank Receipt'}
                              </p>
                              <p className="text-[11px] text-emerald-700 font-medium">
                                Uploaded · Attached to all {batchItems.length} payment
                                {batchItems.length === 1 ? '' : 's'}
                              </p>
                            </div>
                          </div>

                          {previewUrl && (
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => setShowInlinePreview((prev) => !prev)}
                                className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 inline-flex items-center gap-1 cursor-pointer"
                              >
                                {showInlinePreview ? (
                                  <>
                                    <EyeOff className="w-3.5 h-3.5" />
                                    <span>Hide PDF Preview</span>
                                  </>
                                ) : (
                                  <>
                                    <Eye className="w-3.5 h-3.5" />
                                    <span>Show Bank PDF Preview</span>
                                  </>
                                )}
                              </button>
                              <a
                                href={previewUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 inline-flex items-center gap-1"
                              >
                                <span>Open</span>
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {formError && (
                    <div className="rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 flex items-start gap-2 text-xs text-rose-700">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>{formError}</span>
                    </div>
                  )}
                </div>

                {/* RIGHT COLUMN: Sticky Embedded Bank Confirmation PDF / Image Reader */}
                {showSplitPdfPane && previewUrl && (
                  <div className="mt-4 lg:mt-0 lg:col-span-5 flex flex-col rounded-xl border border-slate-200 bg-slate-50 overflow-hidden h-[460px] lg:h-[calc(90dvh-165px)]">
                    <div className="px-3 py-2 bg-white border-b border-slate-200 flex items-center justify-between gap-2 shrink-0">
                      <span className="text-xs font-semibold text-slate-800 truncate">
                        Bank Receipt Reader
                      </span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {!isPdfReceipt && (
                          <button
                            type="button"
                            onClick={() => setImageZoomed((prev) => !prev)}
                            className="px-2 py-1 rounded-md border border-slate-200 bg-white hover:bg-slate-50 text-[11px] font-semibold text-slate-700 inline-flex items-center gap-1 cursor-pointer"
                          >
                            {imageZoomed ? (
                              <>
                                <ZoomOut className="w-3 h-3" />
                                <span>Fit</span>
                              </>
                            ) : (
                              <>
                                <ZoomIn className="w-3 h-3" />
                                <span>Zoom</span>
                              </>
                            )}
                          </button>
                        )}
                        <a
                          href={previewUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-2 py-1 rounded-md border border-slate-200 bg-white hover:bg-slate-50 text-[11px] font-semibold text-slate-700 inline-flex items-center gap-1"
                        >
                          <span>Open in New Tab</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                        <button
                          type="button"
                          onClick={() => setShowInlinePreview(false)}
                          className="px-2 py-1 rounded-md border border-slate-200 bg-white hover:bg-slate-50 text-[11px] font-semibold text-slate-600 cursor-pointer"
                        >
                          Hide
                        </button>
                      </div>
                    </div>

                    <div className="flex-1 min-h-0 overflow-auto bg-slate-100">
                      {isPdfReceipt ? (
                        <iframe
                          src={previewUrl}
                          title="Combined Bank Receipt PDF"
                          className="w-full h-[540px] lg:h-full border-0 bg-white"
                        />
                      ) : (
                        <div className="p-2 flex items-start justify-center min-h-full">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={previewUrl}
                            alt="Combined Bank Receipt"
                            onClick={() => setImageZoomed((prev) => !prev)}
                            className={cn(
                              'rounded border border-slate-200 bg-white transition-transform cursor-zoom-in',
                              imageZoomed
                                ? 'w-[160%] max-w-none cursor-zoom-out'
                                : 'max-w-full max-h-[540px] object-contain'
                            )}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="px-5 py-3.5 border-t border-slate-200 bg-slate-50 flex flex-col-reverse sm:flex-row sm:items-center justify-between gap-2.5 shrink-0">
                <p className="text-[11px] text-slate-500">
                  All {batchItems.length} payment
                  {batchItems.length === 1 ? '' : 's'} will be marked Paid together and grouped for Audit.
                </p>

                <div className="flex items-center gap-2 sm:justify-end">
                  <button
                    type="button"
                    onClick={handleCloseModal}
                    disabled={isSubmitting}
                    className="min-h-[44px] px-4 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={!canSubmit}
                    className="min-h-[44px] flex-1 sm:flex-initial px-5 py-2 rounded-lg bg-brand hover:bg-brand-hover disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs sm:text-sm font-semibold inline-flex items-center justify-center gap-2 shadow-sm transition-colors cursor-pointer"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Settling Batch…</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-4 h-4" />
                        <span>
                          Confirm Batch Settlement ({batchItems.length} Paid)
                        </span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Post-settlement individual Payment Advice / WhatsApp modal */}
      <PaymentAcknowledgementModal
        open={Boolean(advicePayment)}
        onOpenChange={(next) => {
          if (!next) setAdvicePayment(null);
        }}
        payment={advicePayment}
        activeCompany={activeCompany}
        fallbackUserName={fallbackUserName}
        receiptSentAt={advicePayment?.receipt_sent_at || null}
        onReceiptSent={(paymentId, sentAt) => {
          setSettledResult((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              payments: prev.payments.map((item) =>
                item.id === paymentId
                  ? { ...item, receipt_sent_at: sentAt }
                  : item
              ),
            };
          });
        }}
      />
    </>
  );
}
