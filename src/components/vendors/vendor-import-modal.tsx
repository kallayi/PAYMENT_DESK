'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  FileSpreadsheet,
  Upload,
  Download,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';
import { bulkCreateVendors } from '@/actions/vendors';
import type { Company } from '@/types/database';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

type ParsedStatus = 'valid' | 'duplicate_existing' | 'duplicate_in_file' | 'invalid';

interface ParsedVendorRow {
  rowNumber: number;
  party_name: string;
  beneficiary_name: string;
  account_number: string;
  ifsc_code: string;
  remarks: string | null;
  status: ParsedStatus;
  error?: string;
}

interface ParseSummary {
  total: number;
  valid: number;
  duplicates: number;
  invalid: number;
}

interface VendorImportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeCompany: Company | null;
}

export function VendorImportModal({
  open,
  onOpenChange,
  activeCompany,
}: VendorImportModalProps) {
  const router = useRouter();
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  const [selectedFileName, setSelectedFileName] = React.useState<string>('');
  const [parsedRows, setParsedRows] = React.useState<ParsedVendorRow[] | null>(null);
  const [summary, setSummary] = React.useState<ParseSummary | null>(null);
  const [parseError, setParseError] = React.useState<string | null>(null);
  const [isDragging, setIsDragging] = React.useState<boolean>(false);
  const [isParsing, setIsParsing] = React.useState<boolean>(false);
  const [isDownloadingTemplate, setIsDownloadingTemplate] = React.useState<boolean>(false);
  const [isImporting, setIsImporting] = React.useState<boolean>(false);

  const resetState = React.useCallback(() => {
    setSelectedFileName('');
    setParsedRows(null);
    setSummary(null);
    setParseError(null);
    setIsDragging(false);
    setIsParsing(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  React.useEffect(() => {
    if (!open) {
      resetState();
    }
  }, [open, resetState]);

  const handleDownloadTemplate = async () => {
    setIsDownloadingTemplate(true);
    try {
      const res = await fetch('/api/vendors/export?mode=template');
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Download failed' }));
        toast.error(err.error || 'Failed to download template.');
        return;
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'Payment_Desk_Vendor_Import_Template.xlsx';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast.success('Sample Excel template downloaded.');
    } catch {
      toast.error('Network error while downloading template.');
    } finally {
      setIsDownloadingTemplate(false);
    }
  };

  const handleFileSelected = async (file: File) => {
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      toast.error('File size exceeds the 5 MB limit.');
      return;
    }

    const lower = file.name.toLowerCase();
    if (!lower.endsWith('.xlsx') && !lower.endsWith('.csv')) {
      toast.error('Please upload a .xlsx or .csv file.');
      return;
    }

    setSelectedFileName(file.name);
    setParseError(null);
    setParsedRows(null);
    setSummary(null);
    setIsParsing(true);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/vendors/import-parse', {
        method: 'POST',
        body: formData,
      });

      const payload = await res.json().catch(() => ({ error: 'Invalid server response' }));

      if (!res.ok) {
        setParseError(payload.error || 'Failed to parse uploaded file.');
        toast.error(payload.error || 'Failed to parse uploaded file.');
        return;
      }

      setParsedRows(payload.rows || []);
      setSummary(payload.summary || { total: 0, valid: 0, duplicates: 0, invalid: 0 });
    } catch {
      setParseError('Network error while parsing Excel file.');
      toast.error('Network error while parsing Excel file.');
    } finally {
      setIsParsing(false);
    }
  };

  const handleConfirmImport = async () => {
    if (!parsedRows) return;
    const validRows = parsedRows.filter((r) => r.status === 'valid');
    if (validRows.length === 0) return;

    setIsImporting(true);
    try {
      const payload = validRows.map((r) => ({
        party_name: r.party_name,
        beneficiary_name: r.beneficiary_name,
        account_number: r.account_number,
        ifsc_code: r.ifsc_code,
        remarks: r.remarks,
      }));

      const res = await bulkCreateVendors(payload);
      if (!res.success) {
        toast.error(res.error || 'Failed to import vendors.');
        return;
      }

      const skippedTotal = (summary?.duplicates || 0) + res.data.skippedDuplicates;
      const companyLabel = activeCompany?.name || activeCompany?.code || 'workspace';
      toast.success(
        `Imported ${res.data.insertedCount} vendor${res.data.insertedCount === 1 ? '' : 's'} into ${companyLabel}${
          skippedTotal > 0 ? ` (${skippedTotal} duplicate${skippedTotal === 1 ? '' : 's'} skipped)` : ''
        }`
      );
      router.refresh();
      onOpenChange(false);
    } catch {
      toast.error('Unexpected error during bulk vendor import.');
    } finally {
      setIsImporting(false);
    }
  };

  const validCount = summary?.valid || 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-1.5rem)] max-w-3xl max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-[#7F1D1D]/10 text-[#7F1D1D] shrink-0">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <DialogTitle>Bulk Import Vendors from Excel</DialogTitle>
              <DialogDescription>
                Upload a .xlsx or .csv sheet to register multiple supplier bank accounts safely.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4">
          {/* Top Helper Strip */}
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <div className="flex items-center gap-2 flex-wrap text-xs">
              <span className="text-slate-500 font-medium">Importing into:</span>
              <span className="px-2 py-0.5 rounded-md bg-[#7F1D1D] text-white font-bold text-[11px]">
                {activeCompany?.name || activeCompany?.code || 'Active Company'}
              </span>
            </div>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleDownloadTemplate}
              disabled={isDownloadingTemplate || isImporting}
              className="w-full sm:w-auto min-h-[38px] text-xs font-semibold border-slate-300 bg-white hover:bg-slate-100 cursor-pointer"
            >
              {isDownloadingTemplate ? (
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              ) : (
                <Download className="w-3.5 h-3.5 mr-1.5 text-[#7F1D1D]" />
              )}
              <span>Download Sample Template (.xlsx)</span>
            </Button>
          </div>

          {/* File Dropzone */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFileSelected(file);
            }}
          />

          {!parsedRows && (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                const file = e.dataTransfer.files?.[0];
                if (file) void handleFileSelected(file);
              }}
              onClick={() => !isParsing && fileInputRef.current?.click()}
              className={`rounded-xl border-2 border-dashed p-6 sm:p-8 text-center transition-colors cursor-pointer ${
                isDragging
                  ? 'border-[#7F1D1D] bg-rose-50/40'
                  : 'border-slate-300 bg-slate-50/60 hover:bg-slate-50 hover:border-slate-400'
              }`}
            >
              {isParsing ? (
                <div className="flex flex-col items-center gap-2 py-2">
                  <Loader2 className="w-7 h-7 animate-spin text-[#7F1D1D]" />
                  <p className="text-xs font-semibold text-slate-800">
                    Parsing & validating {selectedFileName}...
                  </p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <div className="w-10 h-10 rounded-full bg-white border border-slate-200 flex items-center justify-center text-[#7F1D1D] shadow-sm">
                    <Upload className="w-5 h-5" />
                  </div>
                  <div className="text-xs font-semibold text-slate-900">
                    Click to choose an Excel (.xlsx) or CSV file, or drag & drop here
                  </div>
                  <p className="text-[11px] text-slate-500 max-w-md">
                    Columns: Party Name, Beneficiary Name, Account Number, IFSC Code, Remarks (max 5 MB, up to 500 rows).
                  </p>
                </div>
              )}
            </div>
          )}

          {parseError && (
            <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-start gap-2">
              <XCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span>{parseError}</span>
            </div>
          )}

          {/* Validation Summary Chips + Preview Table */}
          {parsedRows && summary && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-800 border border-emerald-200 tabular-nums">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Ready to Import: {summary.valid}</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-800 border border-amber-200 tabular-nums">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                    <span>Duplicates Skipped: {summary.duplicates}</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-rose-50 text-rose-800 border border-rose-200 tabular-nums">
                    <XCircle className="w-3.5 h-3.5 text-rose-600" />
                    <span>Errors: {summary.invalid}</span>
                  </span>
                </div>

                {selectedFileName && (
                  <span className="text-[11px] text-slate-500 font-medium truncate max-w-[220px]">
                    File: {selectedFileName}
                  </span>
                )}
              </div>

              {parsedRows.length === 0 ? (
                <div className="p-6 rounded-xl border border-slate-200 bg-slate-50 text-center text-xs text-slate-500">
                  No vendor rows remained after skipping blank and sample template rows.
                </div>
              ) : (
                <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                  <div className="overflow-x-auto max-h-[340px] overflow-y-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-500 z-10">
                        <tr>
                          <th className="py-2.5 px-3 w-12">Row</th>
                          <th className="py-2.5 px-3">Party Name</th>
                          <th className="py-2.5 px-3">Beneficiary Name</th>
                          <th className="py-2.5 px-3">Account No</th>
                          <th className="py-2.5 px-3">IFSC</th>
                          <th className="py-2.5 px-3">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {parsedRows.map((row) => {
                          const statusBadge =
                            row.status === 'valid' ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                                <CheckCircle2 className="w-3 h-3" />
                                <span>Ready</span>
                              </span>
                            ) : row.status === 'duplicate_existing' ||
                              row.status === 'duplicate_in_file' ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">
                                <AlertTriangle className="w-3 h-3" />
                                <span>Duplicate</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800">
                                <XCircle className="w-3 h-3" />
                                <span>Invalid</span>
                              </span>
                            );

                          return (
                            <tr
                              key={`${row.rowNumber}-${row.party_name}`}
                              className={
                                row.status === 'invalid'
                                  ? 'bg-rose-50/30'
                                  : row.status !== 'valid'
                                    ? 'bg-amber-50/20'
                                    : 'hover:bg-slate-50/60'
                              }
                            >
                              <td className="py-2 px-3 tabular-nums text-slate-400 font-mono">
                                {row.rowNumber}
                              </td>
                              <td className="py-2 px-3 font-semibold text-slate-900">
                                {row.party_name || <span className="text-rose-500 italic">Missing</span>}
                              </td>
                              <td className="py-2 px-3 text-slate-700">
                                {row.beneficiary_name || '—'}
                              </td>
                              <td className="py-2 px-3 font-mono tabular-nums text-slate-700">
                                {row.account_number || '—'}
                              </td>
                              <td className="py-2 px-3 font-mono font-bold text-slate-800">
                                {row.ifsc_code || '—'}
                              </td>
                              <td className="py-2 px-3">
                                <div className="space-y-0.5">
                                  {statusBadge}
                                  {row.error && (
                                    <div className="text-[10px] text-slate-600 leading-snug max-w-[220px]">
                                      {row.error}
                                    </div>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="pt-2 border-t border-slate-100 flex-col-reverse sm:flex-row sm:justify-between gap-2">
          <div className="flex flex-col-reverse sm:flex-row gap-2 w-full sm:w-auto">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isImporting}
              className="min-h-[40px] cursor-pointer"
            >
              Cancel
            </Button>
            {parsedRows && (
              <Button
                type="button"
                variant="outline"
                onClick={resetState}
                disabled={isImporting || isParsing}
                className="min-h-[40px] cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                <span>Upload Different File</span>
              </Button>
            )}
          </div>

          <Button
            type="button"
            disabled={validCount === 0 || isImporting || isParsing}
            onClick={handleConfirmImport}
            className="min-h-[42px] sm:min-h-[40px] bg-[#7F1D1D] hover:bg-[#991B1B] text-white font-semibold cursor-pointer"
          >
            {isImporting ? (
              <span className="inline-flex items-center gap-1.5">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Importing...</span>
              </span>
            ) : (
              <span>
                Import {validCount} Valid Vendor{validCount === 1 ? '' : 's'}
              </span>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
