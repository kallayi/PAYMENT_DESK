'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  Check,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileText,
  Inbox,
  Landmark,
  Loader2,
  Lock,
  Paperclip,
  Plus,
  Search,
  Send,
  Upload,
  UserPlus,
  X,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { PurposeCombobox } from '@/components/payments/purpose-combobox';
import { DatePicker } from '@/components/ui/date-picker';
import { IndianAmountInput } from '@/components/ui/indian-amount-input';
import { PaymentUrlSync, usePaymentHighlight } from '@/components/layout/payment-url-sync';
import {
  cancelPaymentRequest,
  createPaymentRequest,
  declinePaymentRequest,
  submitRequestToWorkflow,
  uploadRequestBillFile,
} from '@/actions/requests';
import { createVendor } from '@/actions/vendors';
import { getSignedFileUrl } from '@/actions/storage';
import { getBankNameFromIfsc } from '@/lib/bank-names';
import { leanVendorSchema } from '@/lib/validators';
import { formatHumanDate, formatINR, formatShortDate, getTodayISTDateString } from '@/lib/format';
import type {
  CompanyBank,
  PaymentMode,
  PaymentPurpose,
  PaymentRequest,
  UserRole,
  Vendor,
} from '@/types/database';

interface PaymentRequestsWorkspaceProps {
  initialRequests: PaymentRequest[];
  vendors: Vendor[];
  banks: CompanyBank[];
  initialPurposes: PaymentPurpose[];
  companyName: string;
  currentUserId: string;
  userRole: UserRole;
  isAdmin: boolean;
}

type RequestsTab = 'PENDING' | 'SUBMITTED' | 'CLOSED';

function formatVendorMaskedAc(accountNo: string | null | undefined): string {
  const clean = (accountNo || '').trim();
  if (!clean) return 'A/C on file';
  if (clean.length <= 4) return `•••• ${clean}`;
  return `•••• ${clean.slice(-4)}`;
}

function getRequesterRoleMeta(
  requestedRole: string,
  requesterProfileRole?: string | null
): {
  roleLabel: string;
  className: string;
} {
  const effectiveRole = (
    requesterProfileRole && requesterProfileRole !== 'ADMIN'
      ? requesterProfileRole
      : requestedRole || ''
  ).toUpperCase();

  if (effectiveRole === 'APPROVER') {
    return {
      roleLabel: 'Approver',
      className: 'bg-brand/10 text-brand border-brand/25',
    };
  }
  if (effectiveRole === 'VERIFIER') {
    return {
      roleLabel: 'Verifier',
      className: 'bg-amber-50 text-amber-800 border-amber-200',
    };
  }
  if (effectiveRole === 'ADMIN') {
    return {
      roleLabel: 'Approver',
      className: 'bg-slate-900 text-white border-slate-800',
    };
  }
  return {
    roleLabel: effectiveRole
      ? effectiveRole.charAt(0) + effectiveRole.slice(1).toLowerCase()
      : 'Staff',
    className: 'bg-slate-100 text-slate-700 border-slate-200',
  };
}

function formatRelativeTime(isoString: string): string {
  try {
    const diffMs = Date.now() - new Date(isoString).getTime();
    const diffMin = Math.max(0, Math.floor(diffMs / 60000));
    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDays = Math.floor(diffHr / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    return formatHumanDate(isoString.split('T')[0]);
  } catch {
    return '';
  }
}

interface SearchableVendorPickerProps {
  vendors: Vendor[];
  selectedVendorId: string;
  onSelectVendor: (vendorId: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

function SearchableVendorPicker({
  vendors,
  selectedVendorId,
  onSelectVendor,
  disabled = false,
  placeholder = 'Search vendor by party name, beneficiary, or IFSC...',
}: SearchableVendorPickerProps) {
  const [searchText, setSearchText] = React.useState('');
  const [isOpen, setIsOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    const handleOutside = (e: MouseEvent | TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('touchstart', handleOutside);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('touchstart', handleOutside);
    };
  }, []);

  const selectedVendor = React.useMemo(
    () => vendors.find((v) => v.id === selectedVendorId) || null,
    [vendors, selectedVendorId]
  );

  const filtered = React.useMemo(() => {
    const q = searchText.trim().toLowerCase();
    if (!q) return vendors;
    return vendors.filter(
      (v) =>
        (v.party_name || v.name || '').toLowerCase().includes(q) ||
        (v.beneficiary_name || '').toLowerCase().includes(q) ||
        (v.ifsc_code || '').toLowerCase().includes(q)
    );
  }, [vendors, searchText]);

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          type="text"
          disabled={disabled}
          value={isOpen ? searchText : selectedVendor ? selectedVendor.party_name || selectedVendor.name : searchText}
          onFocus={() => {
            setSearchText('');
            setIsOpen(true);
          }}
          onChange={(e) => {
            setSearchText(e.target.value);
            if (!isOpen) setIsOpen(true);
          }}
          placeholder={placeholder}
          className="w-full min-h-[40px] pl-8 pr-8 rounded-lg border border-slate-300 bg-white text-xs sm:text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-brand disabled:opacity-50"
        />
        {selectedVendor && !isOpen && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              onSelectVendor('');
              setSearchText('');
              setIsOpen(true);
            }}
            aria-label="Clear selected vendor"
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {isOpen && (
        <div className="absolute left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-xl max-h-56 overflow-y-auto z-50 divide-y divide-slate-100">
          {filtered.length === 0 ? (
            <div className="px-3 py-3 text-xs text-slate-500 text-center">
              No active vendors match your search.
            </div>
          ) : (
            filtered.map((v) => {
              const name = v.party_name || v.name || 'Vendor';
              const isSelected = v.id === selectedVendorId;
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => {
                    onSelectVendor(v.id);
                    setSearchText('');
                    setIsOpen(false);
                  }}
                  className={`w-full px-3 py-2 text-left flex items-center justify-between gap-2 text-xs transition-colors cursor-pointer ${isSelected ? 'bg-brand-tint text-brand font-semibold' : 'hover:bg-slate-50 text-slate-800'
                    }`}
                >
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{name}</div>
                    <div className="text-[10px] text-slate-500 font-mono truncate">
                      {v.beneficiary_name || name}
                      {v.account_number ? ` · A/C ${v.account_number}` : ''}
                      {v.ifsc_code ? ` · ${v.ifsc_code}` : ''}
                    </div>
                  </div>
                  {isSelected && <Check className="w-3.5 h-3.5 text-brand shrink-0" />}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

export function PaymentRequestsWorkspace({
  initialRequests,
  vendors: initialVendors,
  banks: initialBanks,
  initialPurposes,
  companyName,
  currentUserId,
  userRole,
  isAdmin,
}: PaymentRequestsWorkspaceProps) {
  const router = useRouter();
  const [, startRefreshTransition] = React.useTransition();
  const refreshServerState = React.useCallback(() => {
    startRefreshTransition(() => {
      router.refresh();
    });
  }, [router]);

  const [requests, setRequests] = React.useState<PaymentRequest[]>(initialRequests);
  const [vendors, setVendors] = React.useState<Vendor[]>(initialVendors);
  const [banks, setBanks] = React.useState<CompanyBank[]>(initialBanks);
  const [purposes, setPurposes] = React.useState<PaymentPurpose[]>(initialPurposes);
  const [activeTab, setActiveTab] = React.useState<RequestsTab>('PENDING');

  // Permissions
  const isVerifierOnly = userRole === 'VERIFIER' && !isAdmin;
  const canUseUnlistedVendor = !isVerifierOnly;
  const canCreateRequest = userRole === 'APPROVER' || userRole === 'VERIFIER' || isAdmin;
  const canProcessRequest = userRole === 'PREPARER';

  // Create Request Modal State
  const [isNewModalOpen, setIsNewModalOpen] = React.useState(false);
  const [useUnlistedVendor, setUseUnlistedVendor] = React.useState(false);
  const [newVendorId, setNewVendorId] = React.useState('');
  const [newUnlistedVendorName, setNewUnlistedVendorName] = React.useState('');
  const [newAmount, setNewAmount] = React.useState('');
  const [newInvoiceRef, setNewInvoiceRef] = React.useState('');
  const [newPurpose, setNewPurpose] = React.useState('');
  const [newDueDate, setNewDueDate] = React.useState('');
  const [newRemarks, setNewRemarks] = React.useState('');
  const [newBillPath, setNewBillPath] = React.useState<string | null>(null);
  const [newBillName, setNewBillName] = React.useState<string | null>(null);
  const [isUploadingNewBill, setIsUploadingNewBill] = React.useState(false);
  const [isCreatingRequest, setIsCreatingRequest] = React.useState(false);
  const newFileInputRef = React.useRef<HTMLInputElement | null>(null);

  // Preparer "Review & Submit to Workflow" Modal State
  const [reviewingRequest, setReviewingRequest] = React.useState<PaymentRequest | null>(null);
  const [subVendorId, setSubVendorId] = React.useState('');
  const [subBankId, setSubBankId] = React.useState('');
  const [subMode, setSubMode] = React.useState<PaymentMode>('NEFT_RTGS');
  const [subGrossAmount, setSubGrossAmount] = React.useState('');
  const [subTdsAmount, setSubTdsAmount] = React.useState('0');
  const [subInvoiceRef, setSubInvoiceRef] = React.useState('');
  const [subPurpose, setSubPurpose] = React.useState('');
  const [subDueDate, setSubDueDate] = React.useState('');
  const [subRemarks, setSubRemarks] = React.useState('');
  const [subBillPath, setSubBillPath] = React.useState<string | null>(null);
  const [isSubmittingWorkflow, setIsSubmittingWorkflow] = React.useState(false);

  // Shared Create Complete Vendor Modal (Verifier & Preparer)
  const [vendorModalTarget, setVendorModalTarget] = React.useState<
    'NEW_REQUEST' | 'REVIEW_MODAL' | null
  >(null);
  const [newVendorPartyName, setNewVendorPartyName] = React.useState('');
  const [newVendorBeneficiaryName, setNewVendorBeneficiaryName] = React.useState('');
  const [newVendorAccountNumber, setNewVendorAccountNumber] = React.useState('');
  const [newVendorIfscCode, setNewVendorIfscCode] = React.useState('');
  const [isSavingNewVendor, setIsSavingNewVendor] = React.useState(false);

  // Decline Modal State
  const [decliningRequest, setDecliningRequest] = React.useState<PaymentRequest | null>(null);
  const [declineReason, setDeclineReason] = React.useState('');
  const [isDeclining, setIsDeclining] = React.useState(false);

  // Row / Action states
  const [cancellingId, setCancellingId] = React.useState<string | null>(null);
  const [viewingFileId, setViewingFileId] = React.useState<string | null>(null);

  // Sync props from RealtimeSync router.refresh()
  React.useEffect(() => {
    setRequests(initialRequests);
  }, [initialRequests]);
  React.useEffect(() => {
    setVendors(initialVendors);
  }, [initialVendors]);
  React.useEffect(() => {
    setBanks(initialBanks);
  }, [initialBanks]);
  React.useEffect(() => {
    setPurposes(initialPurposes);
  }, [initialPurposes]);

  // Deep-link ?highlight=<id> auto-tab & highlight
  const { highlightedId, triggerHighlight } = usePaymentHighlight();
  const requestsRef = React.useRef(requests);
  requestsRef.current = requests;

  const handleUrlParams = React.useCallback(
    ({ tab, highlightId }: { tab: string | null; highlightId: string | null }) => {
      const normalizedTab = tab?.toUpperCase();
      if (normalizedTab === 'PENDING' || normalizedTab === 'SUBMITTED' || normalizedTab === 'CLOSED') {
        setActiveTab(normalizedTab);
      } else if (highlightId) {
        const target = requestsRef.current.find((r) => r.id === highlightId);
        if (target) {
          if (target.status === 'PENDING') setActiveTab('PENDING');
          else if (target.status === 'SUBMITTED') setActiveTab('SUBMITTED');
          else setActiveTab('CLOSED');
        }
      }
      if (highlightId) {
        triggerHighlight(highlightId);
      }
    },
    [triggerHighlight]
  );

  const pendingRequests = React.useMemo(
    () => requests.filter((r) => r.status === 'PENDING'),
    [requests]
  );
  const submittedRequests = React.useMemo(
    () => requests.filter((r) => r.status === 'SUBMITTED'),
    [requests]
  );
  const closedRequests = React.useMemo(
    () => requests.filter((r) => r.status === 'DECLINED' || r.status === 'CANCELLED'),
    [requests]
  );

  const visibleRequests =
    activeTab === 'PENDING'
      ? pendingRequests
      : activeTab === 'SUBMITTED'
        ? submittedRequests
        : closedRequests;

  function openNewRequestModal() {
    setUseUnlistedVendor(false);
    setNewVendorId('');
    setNewUnlistedVendorName('');
    setNewAmount('');
    setNewInvoiceRef('');
    setNewPurpose('');
    setNewDueDate(getTodayISTDateString());
    setNewRemarks('');
    setNewBillPath(null);
    setNewBillName(null);
    setIsNewModalOpen(true);
  }

  function openReviewModal(req: PaymentRequest) {
    if (!canProcessRequest) return;
    setReviewingRequest(req);
    setSubVendorId(req.vendor_id || '');
    const primaryBank = banks.find((b) => b.is_primary && b.is_active) || banks.find((b) => b.is_active);
    setSubBankId(primaryBank?.id || '');
    setSubMode('NEFT_RTGS');
    setSubGrossAmount(String(req.gross_amount));
    setSubTdsAmount('0');
    setSubInvoiceRef(req.invoice_ref || '');
    setSubPurpose(req.purpose || '');
    setSubDueDate(req.due_date || getTodayISTDateString());
    setSubRemarks(req.remarks || '');
    setSubBillPath(req.bill_file_path || null);
  }

  function openAddVendorModal(target: 'NEW_REQUEST' | 'REVIEW_MODAL', prefillPartyName = '') {
    const trimmed = prefillPartyName.trim();
    setNewVendorPartyName(trimmed);
    setNewVendorBeneficiaryName(trimmed);
    setNewVendorAccountNumber('');
    setNewVendorIfscCode('');
    setVendorModalTarget(target);
  }

  async function handleNewBillUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error('File exceeds 5 MB limit.');
      if (newFileInputRef.current) newFileInputRef.current.value = '';
      return;
    }

    setIsUploadingNewBill(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await uploadRequestBillFile(formData);
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      setNewBillPath(res.data.filePath);
      setNewBillName(res.data.fileName);
      toast.success('Bill uploaded.');
    } catch {
      toast.error('Failed to upload bill attachment.');
    } finally {
      setIsUploadingNewBill(false);
    }
  }

  async function handleCreateRequestSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsedAmt = parseFloat(newAmount);
    if (!parsedAmt || parsedAmt <= 0) {
      toast.error('Please enter an amount greater than 0.');
      return;
    }
    if (isVerifierOnly && !newVendorId) {
      toast.error('Please select a vendor or click "+ Add New Vendor" with bank details.');
      return;
    }
    if (!isVerifierOnly && !useUnlistedVendor && !newVendorId) {
      toast.error('Please select a vendor or toggle "Vendor not in list yet?".');
      return;
    }
    if (!isVerifierOnly && useUnlistedVendor && !newUnlistedVendorName.trim()) {
      toast.error('Please enter the vendor name.');
      return;
    }
    if (!newPurpose.trim()) {
      toast.error('Purpose is required.');
      return;
    }

    const allowUnlisted = canUseUnlistedVendor && useUnlistedVendor;
    setIsCreatingRequest(true);
    try {
      const res = await createPaymentRequest({
        vendor_id: allowUnlisted ? null : newVendorId,
        unlisted_vendor_name: allowUnlisted ? newUnlistedVendorName.trim() : null,
        gross_amount: parsedAmt,
        invoice_ref: newInvoiceRef.trim() || null,
        purpose: newPurpose.trim(),
        due_date: newDueDate || null,
        remarks: newRemarks.trim() || null,
        bill_file_path: newBillPath,
      });

      if (!res.success) {
        toast.error(res.error);
        return;
      }

      setRequests((prev) => [res.data, ...prev]);
      setActiveTab('PENDING');
      setIsNewModalOpen(false);
      toast.success('Payment request sent to Accounts Preparer.');
      refreshServerState();
    } catch {
      toast.error('Network error while sending payment request.');
    } finally {
      setIsCreatingRequest(false);
    }
  }

  async function handleSaveNewVendorModal(e: React.FormEvent) {
    e.preventDefault();
    const validation = leanVendorSchema.safeParse({
      party_name: newVendorPartyName,
      beneficiary_name: newVendorBeneficiaryName,
      account_number: newVendorAccountNumber,
      ifsc_code: newVendorIfscCode,
    });

    if (!validation.success) {
      toast.error(validation.error.issues[0]?.message || 'Please complete all vendor fields.');
      return;
    }

    setIsSavingNewVendor(true);
    try {
      const res = await createVendor({
        party_name: validation.data.party_name,
        beneficiary_name: validation.data.beneficiary_name,
        account_number: validation.data.account_number,
        ifsc_code: validation.data.ifsc_code,
      });
      if (!res.success) {
        toast.error(res.error);
        return;
      }

      const createdVendor = res.data;
      setVendors((prev) =>
        [createdVendor, ...prev].sort((a, b) =>
          (a.party_name || a.name || '').localeCompare(b.party_name || b.name || '')
        )
      );

      if (vendorModalTarget === 'NEW_REQUEST') {
        setNewVendorId(createdVendor.id);
        setUseUnlistedVendor(false);
      } else if (vendorModalTarget === 'REVIEW_MODAL') {
        setSubVendorId(createdVendor.id);
      }

      setVendorModalTarget(null);
      const bankLabel = getBankNameFromIfsc(createdVendor.ifsc_code);
      toast.success(
        `Added vendor "${createdVendor.party_name || createdVendor.name}" (${bankLabel}) & linked!`
      );
      refreshServerState();
    } catch {
      toast.error('Failed to register vendor.');
    } finally {
      setIsSavingNewVendor(false);
    }
  }

  async function handleSubmitToWorkflow(e: React.FormEvent) {
    e.preventDefault();
    if (!reviewingRequest) return;

    if (!subVendorId) {
      toast.error('Please select or create a matching company vendor.');
      return;
    }
    if (!subBankId) {
      toast.error('Please select a source bank for disbursement.');
      return;
    }
    const grossNum = parseFloat(subGrossAmount) || 0;
    const tdsNum = parseFloat(subTdsAmount) || 0;
    if (grossNum <= 0) {
      toast.error('Gross amount must be greater than 0.');
      return;
    }
    if (tdsNum < 0 || tdsNum > grossNum) {
      toast.error('TDS must be between 0 and Gross Amount.');
      return;
    }
    if (!subPurpose.trim()) {
      toast.error('Purpose is required.');
      return;
    }

    setIsSubmittingWorkflow(true);
    try {
      const res = await submitRequestToWorkflow({
        request_id: reviewingRequest.id,
        vendor_id: subVendorId,
        source_bank_id: subBankId,
        disbursement_mode: subMode,
        gross_amount: grossNum,
        tds_amount: tdsNum,
        invoice_ref: subInvoiceRef.trim() || null,
        purpose: subPurpose.trim(),
        due_date: subDueDate || null,
        remarks: subRemarks.trim() || null,
        bill_file_path: subBillPath,
      });

      if (!res.success) {
        toast.error(res.error);
        return;
      }

      setRequests((prev) =>
        prev.map((r) => (r.id === reviewingRequest.id ? res.data.request : r))
      );
      setReviewingRequest(null);
      toast.success('Submitted straight to Verifier workflow!');
      refreshServerState();
    } catch {
      toast.error('Network error submitting payment to workflow.');
    } finally {
      setIsSubmittingWorkflow(false);
    }
  }

  async function handleConfirmDecline(e: React.FormEvent) {
    e.preventDefault();
    if (!decliningRequest || !declineReason.trim()) return;

    setIsDeclining(true);
    try {
      const res = await declinePaymentRequest({
        request_id: decliningRequest.id,
        reason: declineReason.trim(),
      });
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      setRequests((prev) =>
        prev.map((r) => (r.id === decliningRequest.id ? res.data : r))
      );
      setDecliningRequest(null);
      setDeclineReason('');
      toast.success('Payment request declined and requester notified.');
      refreshServerState();
    } catch {
      toast.error('Network error while declining request.');
    } finally {
      setIsDeclining(false);
    }
  }

  async function handleCancelRequest(reqItem: PaymentRequest) {
    setCancellingId(reqItem.id);
    try {
      const res = await cancelPaymentRequest({ request_id: reqItem.id });
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      setRequests((prev) =>
        prev.map((r) => (r.id === reqItem.id ? res.data : r))
      );
      toast.info('Payment request cancelled.');
      refreshServerState();
    } catch {
      toast.error('Network error cancelling request.');
    } finally {
      setCancellingId(null);
    }
  }

  async function handlePreviewBill(targetId: string, filePath: string) {
    setViewingFileId(targetId);
    try {
      const res = await getSignedFileUrl('supplier-invoices', filePath);
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      window.open(res.data.signedUrl, '_blank', 'noopener,noreferrer');
    } catch {
      toast.error('Failed to open bill attachment.');
    } finally {
      setViewingFileId(null);
    }
  }

  // Review modal live bank balance calculations & linked vendor preview
  const subGrossNum = parseFloat(subGrossAmount) || 0;
  const subTdsNum = parseFloat(subTdsAmount) || 0;
  const subNetPayable = Math.max(0, subGrossNum - subTdsNum);
  const selectedBankObj = banks.find((b) => b.id === subBankId) || null;
  const selectedBankBalance = Number(selectedBankObj?.available_balance ?? 0);
  const projectedRemaining = selectedBankBalance - subNetPayable;
  const isBankShortfall = Boolean(selectedBankObj) && projectedRemaining < 0;
  const linkedSubVendor = React.useMemo(
    () => vendors.find((v) => v.id === subVendorId) || null,
    [vendors, subVendorId]
  );
  const liveIfscBankName = React.useMemo(() => {
    const cleaned = newVendorIfscCode.trim().toUpperCase();
    return cleaned.length >= 4 ? getBankNameFromIfsc(cleaned) : '';
  }, [newVendorIfscCode]);

  return (
    <div className="w-full max-w-6xl mx-auto space-y-4 sm:space-y-5 pb-10">
      <PaymentUrlSync onParams={handleUrlParams} />

      {/* Header Row */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:pb-4 sm:border-b sm:border-slate-200">
        <div className="hidden sm:block min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold tracking-tight text-slate-900">
              Direct Payment Requests — {companyName}
            </h1>
            {pendingRequests.length > 0 && (
              <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-brand text-white tabular-nums">
                {pendingRequests.length} pending
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Pre-filled payment requests sent directly by Approver, Admin, or Verifier to Accounts before entering the verification queue.
          </p>
        </div>

        {canCreateRequest && (
          <Button
            type="button"
            onClick={openNewRequestModal}
            className="w-full sm:w-auto min-h-[42px] sm:min-h-[38px] px-4 rounded-lg bg-brand hover:bg-brand-hover text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 shadow-sm cursor-pointer shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>New Payment Request</span>
          </Button>
        )}
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 -mx-3 px-3 sm:mx-0 sm:px-0 border-b border-slate-200/80">
        <button
          type="button"
          onClick={() => setActiveTab('PENDING')}
          className={`min-h-[38px] px-3.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap inline-flex items-center gap-2 transition-colors cursor-pointer shrink-0 ${activeTab === 'PENDING'
              ? 'bg-brand text-white shadow-sm'
              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
        >
          <span>Pending Inbox ({pendingRequests.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('SUBMITTED')}
          className={`min-h-[38px] px-3.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap inline-flex items-center gap-2 transition-colors cursor-pointer shrink-0 ${activeTab === 'SUBMITTED'
              ? 'bg-emerald-700 text-white shadow-sm'
              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
        >
          <span>Sent to Workflow ({submittedRequests.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('CLOSED')}
          className={`min-h-[38px] px-3.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap inline-flex items-center gap-2 transition-colors cursor-pointer shrink-0 ${activeTab === 'CLOSED'
              ? 'bg-slate-900 text-white shadow-sm'
              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
        >
          <span>Declined / Cancelled ({closedRequests.length})</span>
        </button>
      </div>

      {/* Request Cards List */}
      {visibleRequests.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-10 sm:p-12 text-center shadow-sm">
          <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-2.5 text-slate-400">
            <Inbox className="w-5 h-5" />
          </div>
          <p className="text-sm font-semibold text-slate-900">
            {activeTab === 'PENDING'
              ? 'No pending payment requests'
              : activeTab === 'SUBMITTED'
                ? 'No requests converted yet'
                : 'No declined or cancelled requests'}
          </p>
          <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
            {activeTab === 'PENDING'
              ? canCreateRequest
                ? 'Use "+ New Payment Request" to send a bill or advance instruction straight to Accounts.'
                : 'Incoming payment instructions from Approver, Admin, or Verifier appear here for bank assignment.'
              : 'Processed requests stay archived here with full traceability.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {visibleRequests.map((req) => {
            const partyName =
              req.vendor?.party_name ||
              req.vendor?.name ||
              req.unlisted_vendor_name ||
              'Unknown Vendor';
            const isUnlisted = !req.vendor_id && Boolean(req.unlisted_vendor_name);
            const requesterName = req.requester?.full_name || 'Authorized User';
            const roleMeta = getRequesterRoleMeta(req.requested_role, req.requester?.role);
            const isHighlighted = highlightedId === req.id;

            return (
              <article
                key={req.id}
                data-payment-id={req.id}
                className={`bg-white rounded-xl border p-3.5 sm:p-5 shadow-sm space-y-3 transition-all ${isHighlighted
                    ? 'border-brand ring-2 ring-brand animate-pulse'
                    : 'border-slate-200 hover:border-slate-300'
                  }`}
              >
                {/* Header: Origin Badge + Vendor + Amount */}
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2.5">
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span
                        className={`px-2 py-0.5 rounded-md border text-[11px] font-semibold shrink-0 ${roleMeta.className}`}
                      >
                        Requested by {requesterName} · {roleMeta.roleLabel}
                      </span>
                      <span className="text-[11px] text-slate-400 inline-flex items-center gap-1 shrink-0">
                        <Clock className="w-3 h-3" />
                        {formatRelativeTime(req.created_at)}
                      </span>
                      {isUnlisted && (
                        <span className="px-1.5 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-800 text-[10px] font-semibold">
                          New / Unlisted Vendor
                        </span>
                      )}
                      {req.status === 'SUBMITTED' && (
                        <span className="px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-[10px] font-bold inline-flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" />
                          <span>In Workflow</span>
                        </span>
                      )}
                      {req.status === 'DECLINED' && (
                        <span className="px-2 py-0.5 rounded-full bg-rose-50 border border-rose-200 text-rose-700 text-[10px] font-bold">
                          Declined
                        </span>
                      )}
                      {req.status === 'CANCELLED' && (
                        <span className="px-2 py-0.5 rounded-full bg-slate-100 border border-slate-200 text-slate-600 text-[10px] font-bold">
                          Cancelled
                        </span>
                      )}
                    </div>

                    <h2 className="text-sm sm:text-base font-bold text-slate-900 leading-snug break-words">
                      {partyName}
                    </h2>

                    <div className="text-xs text-slate-600 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="font-medium text-slate-800">{req.purpose}</span>
                      {req.invoice_ref && (
                        <>
                          <span className="text-slate-300">·</span>
                          <span className="font-mono text-slate-700">Ref: {req.invoice_ref}</span>
                        </>
                      )}
                      {req.due_date && (
                        <>
                          <span className="text-slate-300">·</span>
                          <span className="tabular-nums">
                            Due: <strong className="font-medium text-slate-800">{formatShortDate(req.due_date)}</strong>
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex sm:flex-col items-baseline sm:items-end justify-between gap-2 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100 shrink-0">
                    <div className="text-base sm:text-lg font-bold text-slate-900 tabular-nums">
                      {formatINR(req.gross_amount)}
                    </div>
                    {req.bill_file_path && (
                      <button
                        type="button"
                        onClick={() => handlePreviewBill(req.id, req.bill_file_path!)}
                        disabled={viewingFileId === req.id}
                        className="text-xs font-semibold text-brand hover:underline inline-flex items-center gap-1 cursor-pointer"
                      >
                        {viewingFileId === req.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Paperclip className="w-3.5 h-3.5" />
                        )}
                        <span>View Bill</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Remarks / Instructions */}
                {req.remarks && (
                  <div className="text-xs bg-slate-50 border border-slate-100 rounded-lg px-3 py-2 text-slate-700 break-words">
                    <span className="font-semibold text-slate-500">Note: </span>
                    {req.remarks}
                  </div>
                )}

                {/* Prominent Unlisted Vendor Warning Callout on PENDING Card */}
                {req.status === 'PENDING' && isUnlisted && (
                  <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                    <div className="space-y-1 min-w-0">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 border border-amber-300 text-[10px] font-bold uppercase tracking-wide text-amber-900">
                        <AlertTriangle className="w-3 h-3 shrink-0" />
                        <span>New Vendor · Not in Company Database</span>
                      </span>
                      <p className="text-xs text-amber-900 leading-snug">
                        {requesterName} requested &ldquo;{req.unlisted_vendor_name}&rdquo;, which isn&apos;t in {companyName}&apos;s vendor list yet.
                      </p>
                    </div>
                    {canProcessRequest && (
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => {
                          openReviewModal(req);
                          openAddVendorModal('REVIEW_MODAL', req.unlisted_vendor_name || '');
                        }}
                        className="min-h-[38px] px-3.5 rounded-lg bg-amber-700 hover:bg-amber-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 shadow-sm shrink-0 cursor-pointer"
                      >
                        <UserPlus className="w-3.5 h-3.5" />
                        <span>+ Create Vendor &amp; Link</span>
                      </Button>
                    )}
                  </div>
                )}

                {/* Decline reason callout */}
                {req.status === 'DECLINED' && req.decline_reason && (
                  <div className="text-xs bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 text-rose-700 break-words">
                    <span className="font-bold">Declined reason: </span>
                    {req.decline_reason}
                  </div>
                )}

                {/* Card Actions Footer */}
                {req.status === 'PENDING' ||
                  (req.status === 'SUBMITTED' && req.converted_payment_id) ? (
                  <div className="pt-2.5 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
                    {req.status === 'PENDING' && (
                      <>
                        <div className="flex flex-wrap items-center gap-2 flex-1">
                          {canProcessRequest ? (
                            <>
                              <Button
                                type="button"
                                size="sm"
                                onClick={() => openReviewModal(req)}
                                className="min-h-[40px] px-4 rounded-lg bg-brand hover:bg-brand-hover text-white text-xs font-semibold inline-flex items-center gap-1.5 shadow-sm cursor-pointer"
                              >
                                <Send className="w-3.5 h-3.5" />
                                <span>Review &amp; Submit to Workflow</span>
                              </Button>

                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setDecliningRequest(req);
                                  setDeclineReason('');
                                }}
                                className="min-h-[40px] px-3 rounded-lg border-rose-200 text-rose-700 hover:bg-rose-50 text-xs font-semibold cursor-pointer"
                              >
                                <XCircle className="w-3.5 h-3.5 mr-1" />
                                <span>Decline</span>
                              </Button>
                            </>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-800 text-[11px] font-semibold">
                              <Clock className="w-3 h-3 shrink-0" />
                              <span>Waiting on Preparer</span>
                            </span>
                          )}
                        </div>

                        {(req.requested_by === currentUserId || isAdmin) && (
                          <button
                            type="button"
                            onClick={() => handleCancelRequest(req)}
                            disabled={cancellingId === req.id}
                            className="min-h-[36px] px-2.5 rounded-lg text-xs font-medium text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors cursor-pointer disabled:opacity-50"
                          >
                            {cancellingId === req.id ? 'Cancelling...' : 'Cancel Request'}
                          </button>
                        )}
                      </>
                    )}

                    {req.status === 'SUBMITTED' && req.converted_payment_id && (
                      <div className="w-full flex items-center justify-between gap-2 text-xs">
                        <span className="text-slate-500">
                          Processed by{' '}
                          <strong className="text-slate-800">
                            {req.processor?.full_name || 'Accounts'}
                          </strong>
                        </span>
                        <Link
                          href={`/tracker?highlight=${encodeURIComponent(req.converted_payment_id)}`}
                          className="font-semibold text-brand hover:underline inline-flex items-center gap-1"
                        >
                          <span>Track Status</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </Link>
                      </div>
                    )}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}

      {/* MODAL 1: + NEW PAYMENT REQUEST (Approver / Admin / Verifier) */}
      <Dialog
        open={isNewModalOpen}
        onOpenChange={(open) => {
          if (!isCreatingRequest) setIsNewModalOpen(open);
        }}
      >
        <DialogContent className="max-w-lg max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-slate-900">
              Send Direct Payment Request
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              Pre-fill payment details for Accounts ({companyName}). Preparer will review bank balances and submit to workflow.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateRequestSubmit} className="space-y-4">
            {/* Role-Differentiated Vendor Picker */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-xs font-semibold text-slate-700">
                  Vendor / Party <span className="text-rose-600">*</span>
                </Label>
                {canUseUnlistedVendor ? (
                  <button
                    type="button"
                    onClick={() => setUseUnlistedVendor((prev) => !prev)}
                    className="text-[11px] font-semibold text-brand hover:underline cursor-pointer"
                  >
                    {useUnlistedVendor
                      ? 'Choose from vendor list'
                      : 'New / Unlisted Vendor? Type name only'}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => openAddVendorModal('NEW_REQUEST')}
                    className="text-[11px] font-semibold text-brand hover:underline inline-flex items-center gap-1 cursor-pointer"
                  >
                    <UserPlus className="w-3 h-3" />
                    <span>+ Add New Vendor</span>
                  </button>
                )}
              </div>

              {canUseUnlistedVendor && useUnlistedVendor ? (
                <div className="space-y-1">
                  <Input
                    type="text"
                    value={newUnlistedVendorName}
                    onChange={(e) => setNewUnlistedVendorName(e.target.value)}
                    placeholder="Enter vendor or payee name..."
                    disabled={isCreatingRequest}
                    className="min-h-[40px] text-sm"
                  />
                  <p className="text-[11px] text-slate-500">
                    Fast entry: Accounts will complete bank &amp; IFSC details before submission.
                  </p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <SearchableVendorPicker
                    vendors={vendors}
                    selectedVendorId={newVendorId}
                    onSelectVendor={setNewVendorId}
                    disabled={isCreatingRequest}
                  />
                  {isVerifierOnly && (
                    <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
                      <span>Not in list? Complete full vendor bank details to register.</span>
                      <button
                        type="button"
                        onClick={() => openAddVendorModal('NEW_REQUEST')}
                        className="px-2.5 py-1 rounded-md border border-slate-200 bg-slate-50 hover:bg-slate-100 text-brand font-semibold inline-flex items-center gap-1 shrink-0 cursor-pointer"
                      >
                        <UserPlus className="w-3 h-3" />
                        <span>+ Add New Vendor</span>
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Amount & Invoice Ref */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label htmlFor="req-amount" className="block text-xs font-semibold text-slate-700 mb-1">
                  Amount (₹) <span className="text-rose-600">*</span>
                </Label>
                <IndianAmountInput
                  id="req-amount"
                  required
                  value={newAmount}
                  onValueChange={setNewAmount}
                  placeholder="e.g. 25,000"
                  disabled={isCreatingRequest}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 min-h-[40px] text-sm tabular-nums font-semibold"
                />
              </div>
              <div>
                <Label htmlFor="req-inv" className="block text-xs font-semibold text-slate-700 mb-1">
                  Invoice / Bill Ref
                </Label>
                <Input
                  id="req-inv"
                  type="text"
                  value={newInvoiceRef}
                  onChange={(e) => setNewInvoiceRef(e.target.value)}
                  placeholder="e.g. INV-1042 or NA"
                  disabled={isCreatingRequest}
                  className="min-h-[40px] text-sm font-mono"
                />
              </div>
            </div>

            {/* Purpose & Due Date */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <Label htmlFor="req-purpose" className="block text-xs font-semibold text-slate-700 mb-1">
                  Purpose <span className="text-rose-600">*</span>
                </Label>
                <PurposeCombobox
                  id="req-purpose"
                  value={newPurpose}
                  onChange={setNewPurpose}
                  purposes={purposes}
                  onPurposesChange={setPurposes}
                  disabled={isCreatingRequest}
                />
              </div>
              <div>
                <Label htmlFor="req-due" className="block text-xs font-semibold text-slate-700 mb-1">
                  Due Date
                </Label>
                <DatePicker
                  id="req-due"
                  value={newDueDate}
                  onChange={setNewDueDate}
                  placeholder="Select due date"
                  disabled={isCreatingRequest}
                  allowClear
                />
              </div>
            </div>

            {/* Remarks */}
            <div>
              <Label htmlFor="req-remarks" className="block text-xs font-semibold text-slate-700 mb-1">
                Remarks / Instructions for Preparer
              </Label>
              <Textarea
                id="req-remarks"
                rows={2}
                value={newRemarks}
                onChange={(e) => setNewRemarks(e.target.value)}
                placeholder="e.g. Release today via Axis after verifying GST bill..."
                disabled={isCreatingRequest}
                className="text-xs"
              />
            </div>

            {/* Optional Bill Upload */}
            <div className="space-y-1.5">
              <Label className="block text-xs font-semibold text-slate-700">
                Bill PDF / Image (Optional)
              </Label>
              <input
                ref={newFileInputRef}
                type="file"
                accept="application/pdf,image/jpeg,image/png,image/webp"
                onChange={handleNewBillUpload}
                className="hidden"
              />
              {newBillPath ? (
                <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-200 text-xs">
                  <span className="truncate font-medium text-emerald-800 inline-flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{newBillName || 'Bill attached'}</span>
                  </span>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => handlePreviewBill('new-bill', newBillPath)}
                      className="text-emerald-700 font-semibold hover:underline cursor-pointer inline-flex items-center gap-0.5"
                    >
                      <ExternalLink className="w-3 h-3" />
                      <span>View</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setNewBillPath(null);
                        setNewBillName(null);
                        if (newFileInputRef.current) newFileInputRef.current.value = '';
                      }}
                      className="text-slate-400 hover:text-rose-600 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={isUploadingNewBill || isCreatingRequest}
                  onClick={() => newFileInputRef.current?.click()}
                  className="w-full min-h-[40px] px-3 py-2 rounded-lg border border-dashed border-slate-300 hover:border-slate-400 bg-slate-50 text-xs font-medium text-slate-600 flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  {isUploadingNewBill ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Uploading bill...</span>
                    </>
                  ) : (
                    <>
                      <Upload className="w-3.5 h-3.5" />
                      <span>Attach PDF or Image (max 5 MB)</span>
                    </>
                  )}
                </button>
              )}
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsNewModalOpen(false)}
                disabled={isCreatingRequest}
                className="min-h-[40px] cursor-pointer"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isCreatingRequest || isUploadingNewBill}
                className="min-h-[40px] bg-brand hover:bg-brand-hover text-white font-semibold cursor-pointer"
              >
                {isCreatingRequest ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Sending Request...</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5">
                    <Send className="w-3.5 h-3.5" />
                    <span>Send to Preparer</span>
                  </span>
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* MODAL 2: PREPARER "REVIEW & SUBMIT TO WORKFLOW" */}
      <Dialog
        open={canProcessRequest && Boolean(reviewingRequest)}
        onOpenChange={(open) => {
          if (!open && !isSubmittingWorkflow) setReviewingRequest(null);
        }}
      >
        <DialogContent className="max-w-xl max-h-[92dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-slate-900">
              Review &amp; Submit to Workflow
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              Assign a source bank after checking live balance, optionally set TDS, and submit straight to Verifier.
            </DialogDescription>
          </DialogHeader>

          {reviewingRequest && (() => {
            const lockedVendor = linkedSubVendor || reviewingRequest.vendor || null;
            const hasLockedExistingVendor = Boolean(reviewingRequest.vendor_id);
            const reviewingRequesterName =
              reviewingRequest.requester?.full_name || 'Requester';

            return (
            <form onSubmit={handleSubmitToWorkflow} className="space-y-4">
              {/* STRICT VENDOR LOCK SECTION */}
              {hasLockedExistingVendor ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50/90 p-3.5 space-y-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      Company Vendor
                    </span>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-200/80 border border-slate-300/70 text-[10px] font-bold text-slate-700">
                      <Lock className="w-3 h-3 shrink-0" />
                      <span>Locked by Requester</span>
                    </span>
                  </div>

                  {lockedVendor ? (
                    <div className="space-y-1">
                      <p className="text-sm font-bold text-slate-900">
                        {lockedVendor.party_name || lockedVendor.name}
                      </p>
                      <p className="text-xs text-slate-600">
                        Beneficiary:{' '}
                        <span className="font-semibold text-slate-800">
                          {lockedVendor.beneficiary_name ||
                            lockedVendor.party_name ||
                            lockedVendor.name}
                        </span>
                      </p>
                      <div className="flex items-center gap-2 flex-wrap text-xs text-slate-600 pt-0.5">
                        <span className="inline-flex items-center gap-1 font-medium text-slate-800">
                          <Landmark className="w-3.5 h-3.5 text-brand shrink-0" />
                          {getBankNameFromIfsc(lockedVendor.ifsc_code)}
                        </span>
                        <span className="text-slate-300">·</span>
                        <span className="font-mono text-slate-800">
                          A/C {formatVendorMaskedAc(lockedVendor.account_number || lockedVendor.bank_account_no)}
                        </span>
                        {lockedVendor.ifsc_code && (
                          <>
                            <span className="text-slate-300">·</span>
                            <span className="font-mono font-semibold text-slate-800">
                              {lockedVendor.ifsc_code}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-rose-600 font-medium">
                      Locked vendor record could not be loaded.
                    </p>
                  )}
                </div>
              ) : linkedSubVendor ? (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/80 p-3.5 space-y-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-800">
                      Company Vendor
                    </span>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 border border-emerald-300 text-[10px] font-bold text-emerald-800">
                      <CheckCircle2 className="w-3 h-3 shrink-0" />
                      <span>Created &amp; Linked ✓</span>
                    </span>
                  </div>

                  <div className="space-y-1">
                    <p className="text-sm font-bold text-slate-900">
                      {linkedSubVendor.party_name || linkedSubVendor.name}
                    </p>
                    <p className="text-xs text-slate-700">
                      Beneficiary:{' '}
                      <span className="font-semibold text-slate-900">
                        {linkedSubVendor.beneficiary_name ||
                          linkedSubVendor.party_name ||
                          linkedSubVendor.name}
                      </span>
                    </p>
                    <div className="flex items-center gap-2 flex-wrap text-xs text-slate-700 pt-0.5">
                      <span className="inline-flex items-center gap-1 font-medium text-slate-900">
                        <Landmark className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                        {getBankNameFromIfsc(linkedSubVendor.ifsc_code)}
                      </span>
                      <span className="text-emerald-300">·</span>
                      <span className="font-mono text-slate-900">
                        A/C {formatVendorMaskedAc(linkedSubVendor.account_number || linkedSubVendor.bank_account_no)}
                      </span>
                      {linkedSubVendor.ifsc_code && (
                        <>
                          <span className="text-emerald-300">·</span>
                          <span className="font-mono font-semibold text-slate-900">
                            {linkedSubVendor.ifsc_code}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                  <div className="space-y-1 min-w-0">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 border border-amber-300 text-[10px] font-bold uppercase tracking-wide text-amber-900">
                      <AlertTriangle className="w-3 h-3 shrink-0" />
                      <span>New Vendor · Not in Company Database</span>
                    </span>
                    <p className="text-xs text-amber-900 leading-snug">
                      {reviewingRequesterName} requested &ldquo;{reviewingRequest.unlisted_vendor_name || 'Vendor'}&rdquo;, which isn&apos;t in {companyName}&apos;s vendor list yet.
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() =>
                      openAddVendorModal(
                        'REVIEW_MODAL',
                        reviewingRequest.unlisted_vendor_name || ''
                      )
                    }
                    className="min-h-[38px] px-3.5 rounded-lg bg-amber-700 hover:bg-amber-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 shadow-sm shrink-0 cursor-pointer"
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    <span>+ Create Vendor &amp; Link</span>
                  </Button>
                </div>
              )}

              {/* PROMINENT SOURCE BANK PICKER WITH LIVE BALANCES & PROJECTED REMAINING */}
              <div className="space-y-2">
                <Label className="block text-xs font-semibold text-slate-700">
                  Source Bank (Live Balance) <span className="text-rose-600">*</span>
                </Label>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {banks
                    .filter((b) => b.is_active)
                    .map((bank) => {
                      const isPicked = subBankId === bank.id;
                      const bal = Number(bank.available_balance ?? 0);
                      const proj = bal - subNetPayable;
                      const shortCode = bank.short_code || bank.short_name || 'BANK';

                      return (
                        <button
                          key={bank.id}
                          type="button"
                          onClick={() => setSubBankId(bank.id)}
                          disabled={isSubmittingWorkflow}
                          className={`p-2.5 rounded-lg border text-left transition-all cursor-pointer ${isPicked
                              ? 'border-brand ring-1 ring-brand bg-brand-tint/60'
                              : 'border-slate-200 bg-white hover:bg-slate-50'
                            }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-bold text-slate-900 inline-flex items-center gap-1.5 truncate">
                              <Landmark className="w-3.5 h-3.5 text-brand shrink-0" />
                              <span className="truncate">{shortCode}</span>
                            </span>
                            <span className="text-xs font-bold tabular-nums text-slate-900">
                              {formatINR(bal)}
                            </span>
                          </div>
                          <div className="text-[10px] text-slate-500 mt-1 flex items-center justify-between gap-2 tabular-nums">
                            <span className="truncate">{bank.bank_name || bank.full_name}</span>
                            {isPicked && (
                              <span
                                className={`font-bold shrink-0 ${proj < 0 ? 'text-rose-600' : 'text-emerald-700'
                                  }`}
                              >
                                Left: {formatINR(proj)}
                              </span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                </div>

                {selectedBankObj && (
                  <div
                    className={`px-3 py-2 rounded-lg border text-xs flex items-center justify-between gap-2 tabular-nums ${isBankShortfall
                        ? 'bg-rose-50 border-rose-200 text-rose-700'
                        : 'bg-emerald-50 border-emerald-200 text-emerald-800'
                      }`}
                  >
                    <span className="inline-flex items-center gap-1.5 font-semibold">
                      {isBankShortfall ? (
                        <>
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                          <span>
                            Insufficient balance in {selectedBankObj.short_code || selectedBankObj.short_name} (Shortfall {formatINR(Math.abs(projectedRemaining))})
                          </span>
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                          <span>
                            Projected remaining after payment:
                          </span>
                        </>
                      )}
                    </span>
                    <span className="font-bold shrink-0">{formatINR(projectedRemaining)}</span>
                  </div>
                )}
              </div>

              {/* Disbursement Mode + Gross / TDS / Net Payable */}
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                <div className="sm:col-span-5">
                  <Label className="block text-xs font-semibold text-slate-700 mb-1">
                    Mode
                  </Label>
                  <div className="grid grid-cols-3 p-0.5 rounded-lg bg-slate-100 border border-slate-200 gap-0.5">
                    {(['NEFT_RTGS', 'IMPS', 'CHEQUE'] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setSubMode(mode)}
                        className={`min-h-[34px] px-1 rounded-md text-[11px] font-semibold transition-all cursor-pointer whitespace-nowrap ${subMode === mode
                            ? 'bg-white text-slate-900 shadow-sm'
                            : 'text-slate-600 hover:text-slate-900'
                          }`}
                      >
                        {mode === 'NEFT_RTGS' ? 'NEFT / RTGS' : mode === 'IMPS' ? 'IMPS' : 'Cheque'}
                      </button>
                    ))}
                  </div>
                  {subMode === 'IMPS' && (
                    <p className="mt-1 text-[10px] font-medium text-emerald-700">
                      Instant 24×7 transfer
                    </p>
                  )}
                </div>

                <div className="sm:col-span-4">
                  <Label htmlFor="sub-gross" className="block text-xs font-semibold text-slate-700 mb-1">
                    Gross Amount (₹) <span className="text-rose-600">*</span>
                  </Label>
                  <IndianAmountInput
                    id="sub-gross"
                    required
                    value={subGrossAmount}
                    onValueChange={setSubGrossAmount}
                    disabled={isSubmittingWorkflow}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 min-h-[40px] text-sm tabular-nums font-semibold"
                  />
                </div>

                <div className="sm:col-span-3">
                  <Label htmlFor="sub-tds" className="block text-xs font-semibold text-slate-700 mb-1">
                    TDS (₹)
                  </Label>
                  <IndianAmountInput
                    id="sub-tds"
                    value={subTdsAmount}
                    onValueChange={setSubTdsAmount}
                    disabled={isSubmittingWorkflow}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 min-h-[40px] text-sm tabular-nums"
                  />
                </div>
              </div>

              <div className="px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-600">Net Payable to Disburse:</span>
                <span className="text-sm font-bold text-slate-900 tabular-nums">
                  {formatINR(subNetPayable)}
                </span>
              </div>

              {/* Invoice Ref, Due Date & Purpose */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <Label htmlFor="sub-inv" className="block text-xs font-semibold text-slate-700 mb-1">
                    Invoice / Bill Ref
                  </Label>
                  <Input
                    id="sub-inv"
                    type="text"
                    value={subInvoiceRef}
                    onChange={(e) => setSubInvoiceRef(e.target.value)}
                    placeholder="NA"
                    disabled={isSubmittingWorkflow}
                    className="min-h-[40px] text-xs font-mono"
                  />
                </div>
                <div className="sm:col-span-2">
                  <Label htmlFor="sub-purpose" className="block text-xs font-semibold text-slate-700 mb-1">
                    Purpose <span className="text-rose-600">*</span>
                  </Label>
                  <PurposeCombobox
                    id="sub-purpose"
                    value={subPurpose}
                    onChange={setSubPurpose}
                    purposes={purposes}
                    onPurposesChange={setPurposes}
                    disabled={isSubmittingWorkflow}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <Label htmlFor="sub-due" className="block text-xs font-semibold text-slate-700 mb-1">
                    Due Date
                  </Label>
                  <DatePicker
                    id="sub-due"
                    value={subDueDate}
                    onChange={setSubDueDate}
                    placeholder="Select due date"
                    disabled={isSubmittingWorkflow}
                    allowClear
                  />
                </div>
                <div className="sm:col-span-2">
                  <Label htmlFor="sub-remarks" className="block text-xs font-semibold text-slate-700 mb-1">
                    Remarks
                  </Label>
                  <Input
                    id="sub-remarks"
                    type="text"
                    value={subRemarks}
                    onChange={(e) => setSubRemarks(e.target.value)}
                    disabled={isSubmittingWorkflow}
                    className="min-h-[40px] text-xs"
                  />
                </div>
              </div>

              <DialogFooter className="pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setReviewingRequest(null)}
                  disabled={isSubmittingWorkflow}
                  className="min-h-[40px] cursor-pointer"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={isSubmittingWorkflow || !subBankId || !subVendorId}
                  className="min-h-[40px] bg-brand hover:bg-brand-hover text-white font-semibold cursor-pointer"
                >
                  {isSubmittingWorkflow ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Submitting...</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5">
                      <Building2 className="w-3.5 h-3.5" />
                      <span>Approve &amp; Submit to Workflow</span>
                    </span>
                  )}
                </Button>
              </DialogFooter>
            </form>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* MODAL 3: DECLINE REQUEST */}
      <Dialog
        open={canProcessRequest && Boolean(decliningRequest)}
        onOpenChange={(open) => {
          if (!open && !isDeclining) setDecliningRequest(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-rose-700">
              Decline Payment Request
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              Provide a brief reason so the requester knows why this request was declined.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleConfirmDecline} className="space-y-4">
            <div>
              <Label htmlFor="decline-reason" className="block text-xs font-semibold text-slate-700 mb-1">
                Reason <span className="text-rose-600">*</span>
              </Label>
              <Textarea
                id="decline-reason"
                rows={3}
                required
                value={declineReason}
                onChange={(e) => setDeclineReason(e.target.value)}
                placeholder="e.g. Duplicate request — invoice already paid under UTR..."
                disabled={isDeclining}
                className="text-xs"
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDecliningRequest(null)}
                disabled={isDeclining}
                className="min-h-[40px] cursor-pointer"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isDeclining || !declineReason.trim()}
                className="min-h-[40px] bg-rose-600 hover:bg-rose-700 text-white font-semibold cursor-pointer"
              >
                {isDeclining ? 'Declining...' : 'Confirm Decline'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* MODAL 4: SHARED ADD COMPANY VENDOR DIALOG (Verifier & Preparer) */}
      <Dialog
        open={Boolean(vendorModalTarget)}
        onOpenChange={(open) => {
          if (!open && !isSavingNewVendor) setVendorModalTarget(null);
        }}
      >
        <DialogContent className="max-w-md max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-slate-900">
              Create Vendor &amp; Bank Details
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              Add verified supplier bank details to {companyName} so payments can be queued and exported cleanly.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSaveNewVendorModal} className="space-y-4">
            <div>
              <Label htmlFor="nv-party" className="block text-xs font-semibold text-slate-700 mb-1">
                Party Name <span className="text-rose-600">*</span>
              </Label>
              <Input
                id="nv-party"
                type="text"
                required
                value={newVendorPartyName}
                onChange={(e) => setNewVendorPartyName(e.target.value)}
                placeholder="e.g. Shree Laxmi Timber Traders"
                disabled={isSavingNewVendor}
                className="min-h-[40px] text-sm"
              />
            </div>

            <div>
              <div className="flex items-center justify-between gap-2 mb-1">
                <Label htmlFor="nv-beneficiary" className="text-xs font-semibold text-slate-700">
                  Beneficiary Name (as per Bank) <span className="text-rose-600">*</span>
                </Label>
                <button
                  type="button"
                  onClick={() => setNewVendorBeneficiaryName(newVendorPartyName.trim())}
                  disabled={!newVendorPartyName.trim() || isSavingNewVendor}
                  className="text-[11px] font-semibold text-brand hover:underline cursor-pointer disabled:opacity-40"
                >
                  Same as Party Name
                </button>
              </div>
              <Input
                id="nv-beneficiary"
                type="text"
                required
                value={newVendorBeneficiaryName}
                onChange={(e) => setNewVendorBeneficiaryName(e.target.value)}
                placeholder="Exact bank account holder name"
                disabled={isSavingNewVendor}
                className="min-h-[40px] text-sm"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label htmlFor="nv-account" className="block text-xs font-semibold text-slate-700 mb-1">
                  Account Number <span className="text-rose-600">*</span>
                </Label>
                <Input
                  id="nv-account"
                  type="text"
                  required
                  value={newVendorAccountNumber}
                  onChange={(e) => setNewVendorAccountNumber(e.target.value.replace(/\s+/g, ''))}
                  placeholder="e.g. 918020012345678"
                  disabled={isSavingNewVendor}
                  className="min-h-[40px] font-mono tabular-nums text-sm"
                />
              </div>

              <div>
                <Label htmlFor="nv-ifsc" className="block text-xs font-semibold text-slate-700 mb-1">
                  IFSC Code <span className="text-rose-600">*</span>
                </Label>
                <Input
                  id="nv-ifsc"
                  type="text"
                  required
                  maxLength={11}
                  value={newVendorIfscCode}
                  onChange={(e) =>
                    setNewVendorIfscCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))
                  }
                  placeholder="e.g. UTIB0001462"
                  disabled={isSavingNewVendor}
                  className="min-h-[40px] font-mono uppercase font-bold text-sm"
                />
                {liveIfscBankName && (
                  <p className="text-[11px] font-medium text-emerald-700 mt-1 flex items-center gap-1">
                    <Landmark className="w-3 h-3 shrink-0" />
                    <span>{liveIfscBankName}</span>
                  </p>
                )}
              </div>
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setVendorModalTarget(null)}
                disabled={isSavingNewVendor}
                className="min-h-[40px] cursor-pointer"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isSavingNewVendor}
                className="min-h-[40px] bg-brand hover:bg-brand-hover text-white font-semibold cursor-pointer"
              >
                {isSavingNewVendor ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Saving Vendor...</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5">
                    <UserPlus className="w-3.5 h-3.5" />
                    <span>Save Vendor &amp; Link</span>
                  </span>
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
