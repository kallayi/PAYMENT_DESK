'use client';

import * as React from 'react';
import { UserPlus, Plus, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { createUser, toggleUserActive } from '@/actions/auth';
import { createCompanyBank, toggleCompanyBankActive } from '@/actions/banks';
import type { Profile, CompanyBank } from '@/types/database';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface SettingsManagementProps {
  currentUserId: string;
  initialUsers: Profile[];
  initialBanks: CompanyBank[];
}

export function SettingsManagement({
  currentUserId,
  initialUsers,
  initialBanks,
}: SettingsManagementProps) {
  const [activeTab, setActiveTab] = React.useState<'users' | 'banks'>('users');
  const [users, setUsers] = React.useState<Profile[]>(initialUsers);
  const [banks, setBanks] = React.useState<CompanyBank[]>(initialBanks);

  // User modal state
  const [isUserModalOpen, setIsUserModalOpen] = React.useState(false);
  const [fullName, setFullName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [role, setRole] = React.useState<'STAFF' | 'ACCOUNTANT'>('ACCOUNTANT');
  const [userError, setUserError] = React.useState<string | null>(null);

  // Bank modal state
  const [isBankModalOpen, setIsBankModalOpen] = React.useState(false);
  const [bankFullName, setBankFullName] = React.useState('');
  const [bankShortName, setBankShortName] = React.useState('');
  const [accountMask, setAccountMask] = React.useState('');
  const [bankError, setBankError] = React.useState<string | null>(null);

  const [isPending, startTransition] = React.useTransition();

  React.useEffect(() => {
    setUsers(initialUsers);
  }, [initialUsers]);

  React.useEffect(() => {
    setBanks(initialBanks);
  }, [initialBanks]);

  function openCreateUserModal() {
    setFullName('');
    setEmail('');
    setPassword('');
    setRole('ACCOUNTANT');
    setUserError(null);
    setIsUserModalOpen(true);
  }

  function openAddBankModal() {
    setBankFullName('');
    setBankShortName('');
    setAccountMask('');
    setBankError(null);
    setIsBankModalOpen(true);
  }

  function handleCreateUser(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setUserError(null);

    startTransition(async () => {
      const res = await createUser({
        full_name: fullName.trim(),
        email: email.trim(),
        password,
        role,
      });

      if (!res.success) {
        setUserError(res.error);
        toast.error(res.error);
      } else {
        toast.success(`Created ${role.toLowerCase()} account for ${res.data.full_name}`);
        setUsers((prev) => [...prev, res.data]);
        setIsUserModalOpen(false);
      }
    });
  }

  function handleToggleUser(userId: string) {
    startTransition(async () => {
      const res = await toggleUserActive(userId);
      if (!res.success) {
        toast.error(res.error);
      } else {
        toast.info(`${res.data.full_name} is now ${res.data.is_active ? 'Active' : 'Disabled'}`);
        setUsers((prev) =>
          prev.map((u) => (u.id === userId ? { ...u, is_active: res.data.is_active } : u))
        );
      }
    });
  }

  function handleAddBank(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBankError(null);

    startTransition(async () => {
      const res = await createCompanyBank({
        full_name: bankFullName.trim(),
        short_name: bankShortName.trim(),
        account_mask: accountMask.trim() || undefined,
      });

      if (!res.success) {
        setBankError(res.error);
        toast.error(res.error);
      } else {
        toast.success(`Added bank "${res.data.full_name}"`);
        setBanks((prev) => [...prev, res.data]);
        setIsBankModalOpen(false);
      }
    });
  }

  function handleToggleBank(bankId: string) {
    startTransition(async () => {
      const res = await toggleCompanyBankActive(bankId);
      if (!res.success) {
        toast.error(res.error);
      } else {
        toast.info(
          `${res.data.full_name} is now ${res.data.is_active ? 'Active' : 'Inactive'}`
        );
        setBanks((prev) =>
          prev.map((b) => (b.id === bankId ? { ...b, is_active: res.data.is_active } : b))
        );
      }
    });
  }

  return (
    <div>
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">Settings</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Manage team accounts and company disbursement banks.
          </p>
        </div>
        {activeTab === 'users' ? (
          <Button
            type="button"
            onClick={openCreateUserModal}
            className="min-h-[44px] sm:min-h-[38px] px-4 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium inline-flex items-center justify-center gap-1.5 shadow-sm transition-colors"
          >
            <UserPlus className="w-4 h-4" />
            <span>Create User</span>
          </Button>
        ) : (
          <Button
            type="button"
            onClick={openAddBankModal}
            className="min-h-[44px] sm:min-h-[38px] px-4 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium inline-flex items-center justify-center gap-1.5 shadow-sm transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>Add Bank</span>
          </Button>
        )}
      </div>

      {/* 2-Tab Pill Toggle */}
      <div className="inline-flex items-center p-1 rounded-lg bg-slate-100 border border-slate-200/80 mb-5">
        <button
          type="button"
          onClick={() => setActiveTab('users')}
          className={`min-h-[38px] px-4 rounded-md text-xs font-medium transition-all ${
            activeTab === 'users'
              ? 'bg-white text-slate-900 shadow-sm'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Team Users ({users.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('banks')}
          className={`min-h-[38px] px-4 rounded-md text-xs font-medium transition-all ${
            activeTab === 'banks'
              ? 'bg-white text-slate-900 shadow-sm'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Company Banks ({banks.length})
        </button>
      </div>

      {activeTab === 'users' ? (
        <>
          {/* Desktop Users Table (md+) */}
          <div className="hidden md:block bg-white rounded-xl border border-slate-200 overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <th className="py-3 pl-5 pr-3">Full Name</th>
                  <th className="py-3 px-3">Role</th>
                  <th className="py-3 px-3">Status</th>
                  <th className="py-3 pl-3 pr-5 text-right">Access</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {users.map((u) => {
                  const isSelf = u.id === currentUserId;
                  const roleBadge =
                    u.role === 'OWNER'
                      ? 'bg-slate-900 text-white'
                      : u.role === 'ACCOUNTANT'
                        ? 'bg-blue-50 text-blue-700 border border-blue-200'
                        : 'bg-slate-100 text-slate-700 border border-slate-200';

                  return (
                    <tr key={u.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3.5 pl-5 pr-3 font-medium text-slate-900">{u.full_name}</td>
                      <td className="py-3.5 px-3">
                        <span
                          className={`inline-flex px-2 py-0.5 rounded-md text-[11px] font-medium ${roleBadge}`}
                        >
                          {u.role}
                        </span>
                      </td>
                      <td className="py-3.5 px-3">
                        <span
                          className={`inline-flex items-center gap-1.5 text-xs font-medium ${
                            u.is_active ? 'text-emerald-700' : 'text-slate-400'
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              u.is_active ? 'bg-emerald-600' : 'bg-slate-300'
                            }`}
                          />
                          {u.is_active ? 'Active' : 'Disabled'}
                        </span>
                      </td>
                      <td className="py-3.5 pl-3 pr-5 text-right">
                        {isSelf ? (
                          <span className="text-xs text-slate-400">Current Admin</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleToggleUser(u.id)}
                            disabled={isPending}
                            className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                              u.is_active
                                ? 'border-slate-200 text-slate-600 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-200'
                                : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                            }`}
                          >
                            {u.is_active ? 'Disable' : 'Enable'}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile Users Cards (< md) */}
          <div className="md:hidden space-y-3">
            {users.map((u) => {
              const isSelf = u.id === currentUserId;
              return (
                <div
                  key={u.id}
                  className="bg-white rounded-xl border border-slate-200 p-4 flex items-center justify-between gap-3 shadow-sm"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-900 truncate">
                      {u.full_name}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      Role: <span className="font-medium text-slate-700">{u.role}</span>
                    </div>
                    <div
                      className={`text-[11px] mt-1 font-medium ${
                        u.is_active ? 'text-emerald-700' : 'text-slate-400'
                      }`}
                    >
                      {u.is_active ? 'Active' : 'Disabled'}
                    </div>
                  </div>
                  {isSelf ? (
                    <span className="text-[11px] text-slate-400 shrink-0">You</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleToggleUser(u.id)}
                      disabled={isPending}
                      className={`min-h-[44px] px-3.5 rounded-lg border text-xs font-medium shrink-0 transition-colors ${
                        u.is_active
                          ? 'border-slate-200 text-slate-700 hover:bg-rose-50 hover:text-rose-700'
                          : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                      }`}
                    >
                      {u.is_active ? 'Disable' : 'Enable'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </>
      ) : (
        /* Company Banks Grid */
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {banks.map((b) => (
            <div
              key={b.id}
              className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 flex items-center justify-between gap-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-slate-900">{b.full_name}</span>
                  <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 text-[11px] font-medium">
                    {b.short_name}
                  </span>
                </div>
                <div className="text-xs text-slate-500 mt-1 tabular-nums">
                  A/C: {b.account_mask || 'Not set'}
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleToggleBank(b.id)}
                disabled={isPending}
                className={`min-h-[38px] px-3 rounded-lg border text-xs font-medium transition-colors ${
                  b.is_active
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                    : 'border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100'
                }`}
              >
                {b.is_active ? 'Active' : 'Inactive'}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Create Team User Modal */}
      <Dialog open={isUserModalOpen} onOpenChange={setIsUserModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create Team User</DialogTitle>
            <DialogDescription>
              New users can immediately sign in from the login screen.
            </DialogDescription>
          </DialogHeader>

          {userError && (
            <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700 font-medium">
              {userError}
            </div>
          )}

          <form id="create-user-form" onSubmit={handleCreateUser} className="space-y-3.5">
            <div>
              <Label htmlFor="cu-name" className="block text-xs font-medium text-slate-700 mb-1">
                Full Name <span className="text-rose-600">*</span>
              </Label>
              <Input
                id="cu-name"
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="e.g., Arjun Menon"
                disabled={isPending}
                className="w-full min-h-[44px]"
              />
            </div>

            <div>
              <Label htmlFor="cu-email" className="block text-xs font-medium text-slate-700 mb-1">
                Email / Login Username <span className="text-rose-600">*</span>
              </Label>
              <Input
                id="cu-email"
                type="text"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="e.g., arjun@indfurn.com"
                disabled={isPending}
                className="w-full min-h-[44px]"
              />
            </div>

            <div>
              <Label htmlFor="cu-pass" className="block text-xs font-medium text-slate-700 mb-1">
                Password <span className="text-rose-600">*</span>
              </Label>
              <Input
                id="cu-pass"
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimum 6 characters"
                disabled={isPending}
                className="w-full min-h-[44px]"
              />
            </div>

            <div>
              <Label htmlFor="cu-role" className="block text-xs font-medium text-slate-700 mb-1">
                Role <span className="text-rose-600">*</span>
              </Label>
              <select
                id="cu-role"
                value={role}
                onChange={(e) => setRole(e.target.value as 'STAFF' | 'ACCOUNTANT')}
                disabled={isPending}
                className="w-full min-h-[44px] px-3 rounded-lg border border-slate-200 bg-white text-sm outline-none focus:border-slate-900"
              >
                <option value="ACCOUNTANT">Accountant (Payments, UTR & Vendors)</option>
                <option value="STAFF">Stock Staff (Upload Supplier Bills Only)</option>
              </select>
            </div>
          </form>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsUserModalOpen(false)}
              disabled={isPending}
              className="min-h-[44px]"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form="create-user-form"
              disabled={isPending}
              className="min-h-[44px] bg-slate-900 hover:bg-slate-800 text-white"
            >
              {isPending ? (
                <span className="inline-flex items-center gap-1.5">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Creating...</span>
                </span>
              ) : (
                'Create Account'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Company Bank Modal */}
      <Dialog open={isBankModalOpen} onOpenChange={setIsBankModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Company Bank</DialogTitle>
            <DialogDescription>
              Add a new company bank account for payment disbursements.
            </DialogDescription>
          </DialogHeader>

          {bankError && (
            <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700 font-medium">
              {bankError}
            </div>
          )}

          <form id="add-bank-form" onSubmit={handleAddBank} className="space-y-3.5">
            <div>
              <Label htmlFor="ab-name" className="block text-xs font-medium text-slate-700 mb-1">
                Bank Full Name <span className="text-rose-600">*</span>
              </Label>
              <Input
                id="ab-name"
                type="text"
                required
                value={bankFullName}
                onChange={(e) => setBankFullName(e.target.value)}
                placeholder="e.g., HDFC Bank Corporate"
                disabled={isPending}
                className="w-full min-h-[44px]"
              />
            </div>

            <div>
              <Label htmlFor="ab-short" className="block text-xs font-medium text-slate-700 mb-1">
                Short Label <span className="text-rose-600">*</span>
              </Label>
              <Input
                id="ab-short"
                type="text"
                required
                value={bankShortName}
                onChange={(e) => setBankShortName(e.target.value)}
                placeholder="e.g., HDFC"
                disabled={isPending}
                className="w-full min-h-[44px]"
              />
            </div>

            <div>
              <Label htmlFor="ab-mask" className="block text-xs font-medium text-slate-700 mb-1">
                Masked Account No
              </Label>
              <Input
                id="ab-mask"
                type="text"
                value={accountMask}
                onChange={(e) => setAccountMask(e.target.value)}
                placeholder="e.g., XXXX4410"
                disabled={isPending}
                className="w-full min-h-[44px] tabular-nums"
              />
            </div>
          </form>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsBankModalOpen(false)}
              disabled={isPending}
              className="min-h-[44px]"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form="add-bank-form"
              disabled={isPending}
              className="min-h-[44px] bg-slate-900 hover:bg-slate-800 text-white"
            >
              {isPending ? (
                <span className="inline-flex items-center gap-1.5">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Adding...</span>
                </span>
              ) : (
                'Add Bank'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
