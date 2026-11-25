'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  Calendar,
  CheckCircle2,
  Circle,
  Plus,
  ArrowRight,
  Edit2,
  Trash2,
  Loader2,
  Search,
  Building2,
  AlertCircle,
  IndianRupee,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  createReminder,
  updateReminder,
  deleteReminder,
  toggleReminderMonthDone,
} from '@/actions/reminders';
import { formatINR } from '@/lib/format';
import type { RecurringReminder, Vendor } from '@/types/database';

interface RemindersViewProps {
  initialReminders: RecurringReminder[];
  vendors: Vendor[];
  companyName: string;
}

function getCurrentMonthKey(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function getCurrentMonthLabel(): string {
  return new Date().toLocaleDateString('en-IN', {
    month: 'long',
    year: 'numeric',
  });
}

export function RemindersView({
  initialReminders,
  vendors,
  companyName,
}: RemindersViewProps) {
  const currentMonth = getCurrentMonthKey();
  const currentMonthLabel = getCurrentMonthLabel();

  const [reminders, setReminders] = React.useState<RecurringReminder[]>(initialReminders);
  const [searchQuery, setSearchQuery] = React.useState<string>('');
  const [filterTab, setFilterTab] = React.useState<'ALL' | 'PENDING' | 'DONE'>('ALL');

  // Modal State
  const [isFormOpen, setIsFormOpen] = React.useState<boolean>(false);
  const [editingReminder, setEditingReminder] = React.useState<RecurringReminder | null>(null);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);
  const [isTogglingId, setIsTogglingId] = React.useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState<boolean>(false);

  // Form State
  const [title, setTitle] = React.useState<string>('');
  const [dueDay, setDueDay] = React.useState<number>(5);
  const [estimatedAmount, setEstimatedAmount] = React.useState<string>('');
  const [vendorId, setVendorId] = React.useState<string>('');
  const [remarks, setRemarks] = React.useState<string>('');

  React.useEffect(() => {
    setReminders(initialReminders);
  }, [initialReminders]);

  const handleOpenAdd = () => {
    setEditingReminder(null);
    setTitle('');
    setDueDay(5);
    setEstimatedAmount('');
    setVendorId('');
    setRemarks('');
    setIsFormOpen(true);
  };

  const handleOpenEdit = (item: RecurringReminder) => {
    setEditingReminder(item);
    setTitle(item.title);
    setDueDay(item.due_day_of_month);
    setEstimatedAmount(item.estimated_amount ? item.estimated_amount.toString() : '');
    setVendorId(item.vendor_id || '');
    setRemarks(item.remarks || '');
    setIsFormOpen(true);
  };

  const handleSaveReminder = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const parsedAmount = estimatedAmount ? parseFloat(estimatedAmount) : null;
      const input = {
        title: title.trim(),
        due_day_of_month: Number(dueDay),
        estimated_amount: parsedAmount,
        vendor_id: vendorId || null,
        remarks: remarks.trim() || null,
        is_active: true,
      };

      if (editingReminder) {
        const res = await updateReminder(editingReminder.id, input);
        if (!res.success) {
          toast.error(res.error || 'Failed to update reminder.');
          return;
        }
        setReminders((prev) =>
          prev.map((r) => (r.id === editingReminder.id ? res.data : r))
        );
        toast.success('Reminder updated.');
      } else {
        const res = await createReminder(input);
        if (!res.success) {
          toast.error(res.error || 'Failed to create reminder.');
          return;
        }
        setReminders((prev) => [...prev, res.data].sort((a, b) => a.due_day_of_month - b.due_day_of_month));
        toast.success('Monthly reminder added.');
      }
      setIsFormOpen(false);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error saving reminder.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to remove this recurring reminder?')) return;
    setDeletingId(id);
    try {
      const res = await deleteReminder(id);
      if (!res.success) {
        toast.error(res.error || 'Failed to delete reminder.');
        return;
      }
      setReminders((prev) => prev.filter((r) => r.id !== id));
      toast.success('Reminder deleted.');
    } finally {
      setDeletingId(null);
    }
  };

  const handleToggleMonthDone = async (item: RecurringReminder) => {
    setIsTogglingId(item.id);
    const prevDone = item.last_completed_month === currentMonth;
    // Optimistic update
    setReminders((prev) =>
      prev.map((r) =>
        r.id === item.id
          ? {
            ...r,
            last_completed_month: prevDone ? null : currentMonth,
          }
          : r
      )
    );

    try {
      const res = await toggleReminderMonthDone(item.id, currentMonth);
      if (!res.success) {
        // Rollback
        setReminders((prev) =>
          prev.map((r) => (r.id === item.id ? item : r))
        );
        toast.error(res.error || 'Failed to update reminder status.');
        return;
      }
      setReminders((prev) =>
        prev.map((r) => (r.id === item.id ? res.data : r))
      );
      toast.success(
        prevDone
          ? `Marked "${item.title}" as pending for ${currentMonthLabel}.`
          : `Marked "${item.title}" as completed for ${currentMonthLabel}!`
      );
    } catch {
      setReminders((prev) =>
        prev.map((r) => (r.id === item.id ? item : r))
      );
      toast.error('Network error updating reminder.');
    } finally {
      setIsTogglingId(null);
    }
  };

  // Computations
  const totalItems = reminders.length;
  const completedItems = reminders.filter((r) => r.last_completed_month === currentMonth);
  const pendingItems = reminders.filter((r) => r.last_completed_month !== currentMonth);

  const totalBudget = reminders.reduce((sum, r) => sum + (Number(r.estimated_amount) || 0), 0);
  const completedBudget = completedItems.reduce((sum, r) => sum + (Number(r.estimated_amount) || 0), 0);
  const pendingBudget = pendingItems.reduce((sum, r) => sum + (Number(r.estimated_amount) || 0), 0);

  // Filtered
  const filtered = reminders
    .filter((r) => {
      const isDone = r.last_completed_month === currentMonth;
      if (filterTab === 'PENDING') return !isDone;
      if (filterTab === 'DONE') return isDone;
      return true;
    })
    .filter((r) => {
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      const titleMatch = r.title.toLowerCase().includes(q);
      const vendorName = r.vendor?.name || r.vendor?.party_name || '';
      const vendorMatch = vendorName.toLowerCase().includes(q);
      const remarksMatch = (r.remarks || '').toLowerCase().includes(q);
      return titleMatch || vendorMatch || remarksMatch;
    });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4 pb-4 sm:pb-5 border-b border-slate-200">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-lg sm:text-xl font-bold tracking-tight text-slate-900">
              Monthly Reminders — {companyName}
            </h1>
            <span className="px-2 py-0.5 rounded text-xs font-semibold bg-brand/10 text-brand shrink-0">
              {currentMonthLabel}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Accounts recurring checklist for fixed monthly dues (Rent, Electricity, Salaries, Subscriptions).
          </p>
        </div>

        <Button
          onClick={handleOpenAdd}
          className="w-full sm:w-auto min-h-[40px] bg-brand hover:bg-brand-hover text-white text-xs font-semibold shrink-0"
          size="sm"
        >
          <Plus className="w-4 h-4 mr-1.5" />
          Add Reminder
        </Button>
      </div>

      {/* Summary KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-sm flex items-center justify-between">
          <div>
            <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
              Total Budgeted
            </p>
            <p className="text-lg font-bold text-slate-900 tabular-nums mt-0.5">
              {formatINR(totalBudget)}
            </p>
            <p className="text-[11px] text-slate-400 mt-0.5">{totalItems} recurring obligations</p>
          </div>
          <div className="p-2.5 rounded-lg bg-slate-100 text-slate-600">
            <Calendar className="w-5 h-5" />
          </div>
        </div>

        <div className="p-4 rounded-xl border border-emerald-200 bg-emerald-50/40 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-[11px] font-semibold text-emerald-700 uppercase tracking-wider">
              Done for {currentMonthLabel}
            </p>
            <p className="text-lg font-bold text-emerald-800 tabular-nums mt-0.5">
              {formatINR(completedBudget)}
            </p>
            <p className="text-[11px] text-emerald-600 mt-0.5">
              {completedItems.length} of {totalItems} completed
            </p>
          </div>
          <div className="p-2.5 rounded-lg bg-emerald-100 text-emerald-700">
            <CheckCircle2 className="w-5 h-5" />
          </div>
        </div>

        <div className="p-4 rounded-xl border border-amber-200 bg-amber-50/40 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-[11px] font-semibold text-amber-700 uppercase tracking-wider">
              Pending Remaining
            </p>
            <p className="text-lg font-bold text-amber-800 tabular-nums mt-0.5">
              {formatINR(pendingBudget)}
            </p>
            <p className="text-[11px] text-amber-600 mt-0.5">{pendingItems.length} items to pay</p>
          </div>
          <div className="p-2.5 rounded-lg bg-amber-100 text-amber-700">
            <AlertCircle className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Filters & Search */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="grid grid-cols-3 sm:flex items-center gap-1 p-1 bg-slate-100 rounded-lg w-full sm:w-fit">
          <button
            type="button"
            onClick={() => setFilterTab('ALL')}
            className={`min-h-[36px] px-2.5 sm:px-3 py-1 rounded-md text-xs font-semibold transition-colors truncate ${filterTab === 'ALL'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
              }`}
          >
            All ({totalItems})
          </button>
          <button
            type="button"
            onClick={() => setFilterTab('PENDING')}
            className={`min-h-[36px] px-2.5 sm:px-3 py-1 rounded-md text-xs font-semibold transition-colors truncate ${filterTab === 'PENDING'
                ? 'bg-white text-amber-700 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
              }`}
          >
            Pending ({pendingItems.length})
          </button>
          <button
            type="button"
            onClick={() => setFilterTab('DONE')}
            className={`min-h-[36px] px-2.5 sm:px-3 py-1 rounded-md text-xs font-semibold transition-colors truncate ${filterTab === 'DONE'
                ? 'bg-white text-emerald-700 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
              }`}
          >
            Done ({completedItems.length})
          </button>
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search reminders or vendor..."
            className="w-full min-h-[38px] pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-1 focus:ring-brand focus:border-brand"
          />
        </div>
      </div>

      {/* Checklist View */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-12 text-center">
          <Calendar className="w-8 h-8 text-slate-300 mx-auto mb-2" />
          <p className="text-sm font-semibold text-slate-700">No recurring reminders found</p>
          <p className="text-xs text-slate-400 mt-1">
            {reminders.length === 0
              ? 'Add monthly fixed expenses like KSEB, rent, or staff salaries to track them reliably.'
              : 'Try clearing your search query or switching tabs.'}
          </p>
          {reminders.length === 0 && (
            <Button
              onClick={handleOpenAdd}
              size="sm"
              className="mt-4 bg-brand hover:bg-brand-hover text-white text-xs"
            >
              <Plus className="w-3.5 h-3.5 mr-1" />
              Add First Reminder
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((r) => {
            const isDone = r.last_completed_month === currentMonth;
            const vendor = r.vendor;
            const vendorDisplayName = vendor?.party_name || vendor?.name || 'No vendor linked';

            return (
              <div
                key={r.id}
                className={`p-4 rounded-xl border transition-all duration-150 bg-white shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4 ${isDone
                    ? 'border-emerald-200/70 bg-emerald-50/20'
                    : 'border-slate-200 hover:border-slate-300'
                  }`}
              >
                {/* Left Side: Checkbox + Title + Metadata */}
                <div className="flex items-start gap-3">
                  <button
                    type="button"
                    onClick={() => handleToggleMonthDone(r)}
                    disabled={isTogglingId === r.id}
                    title={isDone ? 'Click to mark as Pending' : 'Click to mark Done for this month'}
                    className="mt-0.5 text-slate-400 hover:text-emerald-600 transition-colors focus:outline-none disabled:opacity-50"
                  >
                    {isTogglingId === r.id ? (
                      <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
                    ) : isDone ? (
                      <CheckCircle2 className="w-5 h-5 text-emerald-600 fill-emerald-100" />
                    ) : (
                      <Circle className="w-5 h-5 text-slate-300 hover:text-slate-400" />
                    )}
                  </button>

                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={`text-sm font-bold ${isDone ? 'line-through text-slate-500' : 'text-slate-900'
                          }`}
                      >
                        {r.title}
                      </span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-700">
                        Due {r.due_day_of_month}th of every month
                      </span>
                      {isDone ? (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">
                          Done ({currentMonthLabel})
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-800">
                          Pending
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-3 text-xs text-slate-500 flex-wrap">
                      <div className="flex items-center gap-1 font-medium text-slate-700">
                        <Building2 className="w-3.5 h-3.5 text-slate-400" />
                        <span>{vendorDisplayName}</span>
                      </div>
                      {vendor?.account_number && (
                        <span className="text-[11px] text-slate-400 font-mono">
                          A/C: {vendor.account_number} • {vendor.ifsc_code}
                        </span>
                      )}
                      {r.remarks && (
                        <span className="text-slate-400 italic">“{r.remarks}”</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right Side: Estimated Amount & Quick Actions */}
                <div className="flex flex-wrap items-center justify-between md:justify-end gap-2.5 sm:gap-3 pt-2.5 md:pt-0 border-t md:border-t-0 border-slate-100">
                  <div className="text-left md:text-right pr-2">
                    <p className="text-[10px] text-slate-400 uppercase font-semibold">Estimated</p>
                    <p className="text-sm font-bold text-slate-900 tabular-nums">
                      {r.estimated_amount ? formatINR(r.estimated_amount) : 'NA'}
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {/* Create Payment Entry with Pre-fill */}
                    <Link
                      href={`/payments?fromReminder=${r.id}`}
                      className="min-h-[38px] inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg bg-brand text-white hover:bg-brand-hover shadow-sm transition-colors"
                      title="Create payment entry pre-filled with this reminder"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Create Entry</span>
                    </Link>

                    <button
                      type="button"
                      onClick={() => handleOpenEdit(r)}
                      className="min-h-[38px] min-w-[38px] inline-flex items-center justify-center p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-md transition-colors"
                      title="Edit reminder"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDelete(r.id)}
                      disabled={deletingId === r.id}
                      className="min-h-[38px] min-w-[38px] inline-flex items-center justify-center p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors disabled:opacity-50"
                      title="Delete reminder"
                    >
                      {deletingId === r.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add / Edit Reminder Dialog */}
      <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold text-slate-900">
              {editingReminder ? 'Edit Monthly Reminder' : 'Add Monthly Recurring Reminder'}
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              Record a recurring fixed monthly expense for Accounts checklist.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSaveReminder} className="space-y-4 py-2">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Obligation / Title <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. KSEB Electricity Bill, Office Rent, Staff Salaries"
                className="w-full px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-md text-slate-900 focus:outline-none focus:ring-1 focus:ring-brand focus:border-brand"
                required
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Due Day of Month (1-31) <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  min="1"
                  max="31"
                  value={dueDay}
                  onChange={(e) => setDueDay(parseInt(e.target.value, 10) || 1)}
                  className="w-full min-h-[40px] px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-md text-slate-900 focus:outline-none focus:ring-1 focus:ring-brand focus:border-brand tabular-nums"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Estimated Amount (₹)
                </label>
                <input
                  type="number"
                  step="any"
                  min="0"
                  value={estimatedAmount}
                  onChange={(e) => setEstimatedAmount(e.target.value)}
                  placeholder="Optional"
                  className="w-full min-h-[40px] px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-md text-slate-900 focus:outline-none focus:ring-1 focus:ring-brand focus:border-brand tabular-nums"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Linked Vendor / Beneficiary
              </label>
              <select
                value={vendorId}
                onChange={(e) => setVendorId(e.target.value)}
                className="w-full px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-md text-slate-900 focus:outline-none focus:ring-1 focus:ring-brand focus:border-brand"
              >
                <option value="">-- No specific vendor linked --</option>
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.party_name || v.name} {v.ifsc_code ? `(${v.ifsc_code})` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Remarks / Notes
              </label>
              <input
                type="text"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="Optional notes or consumer number"
                className="w-full px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-md text-slate-900 focus:outline-none focus:ring-1 focus:ring-brand focus:border-brand"
              />
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsFormOpen(false)}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={isSubmitting}
                className="bg-brand hover:bg-brand-hover text-white font-medium"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                    Saving...
                  </>
                ) : editingReminder ? (
                  'Update Reminder'
                ) : (
                  'Add Reminder'
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
