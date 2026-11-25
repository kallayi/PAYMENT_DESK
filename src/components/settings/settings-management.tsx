'use client';

import * as React from 'react';
import { UserPlus, Plus, Loader2, Edit2, Shield, Building2, Check, Star } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { createUser, updateUser, toggleUserActive } from '@/actions/auth';
import { createCompanyBank, updateCompanyBank, toggleCompanyBankActive } from '@/actions/banks';
import {
  createUserSchema,
  updateUserSchema,
  companyBankSchema,
  type CreateUserInput,
  type UpdateUserInput,
  type CompanyBankInput,
} from '@/lib/validators';
import type { Profile, CompanyBank, Company, UserRole } from '@/types/database';
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

export type EnrichedProfile = Profile & {
  email?: string;
  assignedCompanies?: Company[];
};

interface SettingsManagementProps {
  currentUserId: string;
  initialUsers: EnrichedProfile[];
  initialBanks: CompanyBank[];
  activeCompany: Company | null;
  allCompanies: Company[];
}

export function SettingsManagement({
  currentUserId,
  initialUsers,
  initialBanks,
  activeCompany,
  allCompanies,
}: SettingsManagementProps) {
  const [activeTab, setActiveTab] = React.useState<'users' | 'banks'>('users');
  const [users, setUsers] = React.useState<EnrichedProfile[]>(initialUsers);
  const [banks, setBanks] = React.useState<CompanyBank[]>(initialBanks);

  // Dialog visibility
  const [isAddUserOpen, setIsAddUserOpen] = React.useState(false);
  const [editingUser, setEditingUser] = React.useState<EnrichedProfile | null>(null);

  const [isAddBankOpen, setIsAddBankOpen] = React.useState(false);
  const [editingBank, setEditingBank] = React.useState<CompanyBank | null>(null);

  const [isPending, startTransition] = React.useTransition();

  React.useEffect(() => {
    setUsers(initialUsers);
  }, [initialUsers]);

  React.useEffect(() => {
    setBanks(initialBanks);
  }, [initialBanks]);

  // React Hook Form for Add User
  const addUserForm = useForm<CreateUserInput>({
    resolver: zodResolver(createUserSchema),
    defaultValues: {
      full_name: '',
      email: '',
      password: '',
      role: 'PREPARER',
      is_admin: false,
      company_ids: allCompanies.map((c) => c.id),
    },
  });

  // React Hook Form for Edit User
  const editUserForm = useForm<UpdateUserInput>({
    resolver: zodResolver(updateUserSchema),
    defaultValues: {
      user_id: '',
      full_name: '',
      role: 'PREPARER',
      is_admin: false,
      is_active: true,
      company_ids: [],
    },
  });

  // React Hook Form for Add Bank
  const addBankForm = useForm<CompanyBankInput>({
    resolver: zodResolver(companyBankSchema),
    defaultValues: {
      bank_name: '',
      short_code: '',
      ifsc_prefix: '',
      account_number_masked: '',
      is_primary: false,
      is_active: true,
    },
  });

  // React Hook Form for Edit Bank
  const editBankForm = useForm<CompanyBankInput>({
    resolver: zodResolver(companyBankSchema),
    defaultValues: {
      bank_name: '',
      short_code: '',
      ifsc_prefix: '',
      account_number_masked: '',
      is_primary: false,
      is_active: true,
    },
  });

  function openAddUser() {
    addUserForm.reset({
      full_name: '',
      email: '',
      password: '',
      role: 'PREPARER',
      is_admin: false,
      company_ids: allCompanies.map((c) => c.id),
    });
    setIsAddUserOpen(true);
  }

  function openEditUser(user: EnrichedProfile) {
    setEditingUser(user);
    const assignedIds = (user.assignedCompanies || []).map((c) => c.id);
    editUserForm.reset({
      user_id: user.id,
      full_name: user.full_name,
      role: user.role,
      is_admin: user.is_admin,
      is_active: user.is_active,
      company_ids: assignedIds.length > 0 ? assignedIds : allCompanies.map((c) => c.id),
    });
  }

  function openAddBank() {
    addBankForm.reset({
      bank_name: '',
      short_code: '',
      ifsc_prefix: '',
      account_number_masked: '',
      is_primary: false,
      is_active: true,
    });
    setIsAddBankOpen(true);
  }

  function openEditBank(bank: CompanyBank) {
    setEditingBank(bank);
    editBankForm.reset({
      bank_name: bank.bank_name || bank.full_name,
      short_code: bank.short_code || bank.short_name,
      ifsc_prefix: bank.ifsc_prefix || (bank.short_code || bank.short_name).slice(0, 4),
      account_number_masked: bank.account_number_masked || bank.account_mask || '',
      is_primary: Boolean(bank.is_primary),
      is_active: Boolean(bank.is_active),
    });
  }

  // Submit Add User
  function onAddUserSubmit(data: CreateUserInput) {
    startTransition(async () => {
      const res = await createUser(data);
      if (!res.success) {
        toast.error(res.error);
      } else {
        toast.success(`Created ${data.role} account for ${res.data.full_name}`);
        const assigned = allCompanies.filter((c) => (data.company_ids || []).includes(c.id));
        setUsers((prev) => [
          ...prev,
          { ...res.data, email: data.email, assignedCompanies: assigned },
        ]);
        setIsAddUserOpen(false);
      }
    });
  }

  // Submit Edit User
  function onEditUserSubmit(data: UpdateUserInput) {
    startTransition(async () => {
      const res = await updateUser(data);
      if (!res.success) {
        toast.error(res.error);
      } else {
        toast.success(`Updated account for ${res.data.full_name}`);
        const assigned = allCompanies.filter((c) => data.company_ids.includes(c.id));
        setUsers((prev) =>
          prev.map((u) =>
            u.id === data.user_id ? { ...res.data, email: u.email, assignedCompanies: assigned } : u
          )
        );
        setEditingUser(null);
      }
    });
  }

  // Toggle user active status
  function handleToggleUserActive(userId: string) {
    startTransition(async () => {
      const res = await toggleUserActive(userId);
      if (!res.success) {
        toast.error(res.error);
      } else {
        toast.info(
          `${res.data.full_name} is now ${res.data.is_active ? 'Active' : 'Disabled'}`
        );
        setUsers((prev) =>
          prev.map((u) => (u.id === userId ? { ...u, is_active: res.data.is_active } : u))
        );
      }
    });
  }

  // Submit Add Bank
  function onAddBankSubmit(data: CompanyBankInput) {
    startTransition(async () => {
      const res = await createCompanyBank({
        ...data,
        company_id: activeCompany?.id,
      });
      if (!res.success) {
        toast.error(res.error);
      } else {
        toast.success(`Added bank "${res.data.bank_name || res.data.full_name}"`);
        setBanks((prev) => [...prev, res.data]);
        setIsAddBankOpen(false);
      }
    });
  }

  // Submit Edit Bank
  function onEditBankSubmit(data: CompanyBankInput) {
    if (!editingBank) return;
    startTransition(async () => {
      const res = await updateCompanyBank(editingBank.id, data);
      if (!res.success) {
        toast.error(res.error);
      } else {
        toast.success(`Updated bank "${res.data.bank_name || res.data.full_name}"`);
        setBanks((prev) =>
          prev.map((b) => (b.id === editingBank.id ? res.data : b))
        );
        setEditingBank(null);
      }
    });
  }

  // Toggle Bank active status
  function handleToggleBankActive(bankId: string) {
    startTransition(async () => {
      const res = await toggleCompanyBankActive(bankId);
      if (!res.success) {
        toast.error(res.error);
      } else {
        toast.info(
          `${res.data.bank_name || res.data.full_name} is now ${res.data.is_active ? 'Active' : 'Inactive'}`
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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">Admin Settings</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Manage team accounts, multi-company access, and company disbursement banks.
          </p>
        </div>
        {activeTab === 'users' ? (
          <Button
            type="button"
            onClick={openAddUser}
            className="min-h-[40px] px-4 rounded-lg bg-[#7F1D1D] hover:bg-[#991B1B] text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 shadow-xs transition-colors cursor-pointer"
          >
            <UserPlus className="w-4 h-4" />
            <span>Add Team Member</span>
          </Button>
        ) : (
          <Button
            type="button"
            onClick={openAddBank}
            className="min-h-[40px] px-4 rounded-lg bg-[#7F1D1D] hover:bg-[#991B1B] text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 shadow-xs transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Add Bank</span>
          </Button>
        )}
      </div>

      {/* 2-Tab Pill Switcher */}
      <div className="inline-flex items-center p-1 rounded-lg bg-slate-100 border border-slate-200/80 mb-6 select-none">
        <button
          type="button"
          onClick={() => setActiveTab('users')}
          className={`min-h-[36px] px-4 rounded-md text-xs font-semibold transition-all cursor-pointer ${
            activeTab === 'users'
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Team & Access ({users.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('banks')}
          className={`min-h-[36px] px-4 rounded-md text-xs font-semibold transition-all cursor-pointer ${
            activeTab === 'banks'
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Company Banks ({banks.length})
        </button>
      </div>

      {/* TAB 1: USERS & ACCESS */}
      {activeTab === 'users' && (
        <div className="space-y-4">
          {/* Desktop Table (md+) */}
          <div className="hidden md:block bg-white rounded-xl border border-slate-200 overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <th className="py-3 pl-5 pr-3">User & Email</th>
                  <th className="py-3 px-3">Role</th>
                  <th className="py-3 px-3">Company Access</th>
                  <th className="py-3 px-3">Status</th>
                  <th className="py-3 pl-3 pr-5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {users.map((u) => {
                  const isSelf = u.id === currentUserId;
                  const roleBadge =
                    u.role === 'APPROVER'
                      ? 'bg-[#7F1D1D] text-white'
                      : u.role === 'VERIFIER'
                        ? 'bg-amber-100 text-amber-900 border border-amber-200'
                        : u.role === 'AUDITOR'
                          ? 'bg-purple-100 text-purple-900 border border-purple-200'
                          : 'bg-blue-50 text-blue-700 border border-blue-200';

                  return (
                    <tr key={u.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3.5 pl-5 pr-3">
                        <div className="flex items-center gap-1.5 font-bold text-slate-900">
                          <span>{u.full_name}</span>
                          {u.is_admin && (
                            <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-900 text-white">
                              Admin
                            </span>
                          )}
                          {isSelf && (
                            <span className="text-[10px] font-medium text-slate-400 bg-slate-100 px-1 rounded">
                              You
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">{u.email || '—'}</div>
                      </td>
                      <td className="py-3.5 px-3">
                        <span
                          className={`inline-flex px-2 py-0.5 rounded-md text-[11px] font-bold ${roleBadge}`}
                        >
                          {u.role}
                        </span>
                      </td>
                      <td className="py-3.5 px-3">
                        <div className="flex flex-wrap gap-1">
                          {u.is_admin ? (
                            <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                              Both (INDFURN & VINMORE)
                            </span>
                          ) : (u.assignedCompanies || []).length > 0 ? (
                            u.assignedCompanies!.map((c) => (
                              <span
                                key={c.id}
                                className="text-[11px] font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-800 border border-slate-200"
                              >
                                {c.code}
                              </span>
                            ))
                          ) : (
                            <span className="text-xs text-slate-400">None</span>
                          )}
                        </div>
                      </td>
                      <td className="py-3.5 px-3">
                        <span
                          className={`inline-flex items-center gap-1.5 text-xs font-semibold ${
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
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => openEditUser(u)}
                            className="px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-700 text-xs font-medium inline-flex items-center gap-1 transition-colors cursor-pointer"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                            <span>Edit</span>
                          </button>
                          {isSelf ? (
                            <span className="text-xs text-slate-400 italic px-2">Locked</span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleToggleUserActive(u.id)}
                              disabled={isPending}
                              className={`px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${
                                u.is_active
                                  ? 'border-slate-200 text-slate-600 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-200'
                                  : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                              }`}
                            >
                              {u.is_active ? 'Disable' : 'Enable'}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile User Cards (< md) */}
          <div className="md:hidden space-y-3">
            {users.map((u) => {
              const isSelf = u.id === currentUserId;
              return (
                <div
                  key={u.id}
                  className="bg-white rounded-xl border border-slate-200 p-4 space-y-2.5 shadow-xs"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-1.5 font-bold text-slate-900 text-sm">
                        <span>{u.full_name}</span>
                        {u.is_admin && (
                          <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-900 text-white">
                            Admin
                          </span>
                        )}
                      </div>
                      {u.email && <div className="text-xs text-slate-500 mt-0.5">{u.email}</div>}
                    </div>
                    <span
                      className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                        u.role === 'APPROVER'
                          ? 'bg-[#7F1D1D] text-white'
                          : u.role === 'VERIFIER'
                            ? 'bg-amber-100 text-amber-900 border border-amber-200'
                            : u.role === 'AUDITOR'
                              ? 'bg-purple-100 text-purple-900 border border-purple-200'
                              : 'bg-blue-50 text-blue-700 border border-blue-200'
                      }`}
                    >
                      {u.role}
                    </span>
                  </div>

                  <div className="flex items-center gap-1 text-xs text-slate-600">
                    <span className="text-slate-400">Companies:</span>
                    {u.is_admin ? (
                      <span className="font-semibold text-slate-700">Both</span>
                    ) : (u.assignedCompanies || []).length > 0 ? (
                      u.assignedCompanies!.map((c) => (
                        <span key={c.id} className="font-bold text-slate-800">
                          {c.code}
                        </span>
                      ))
                    ) : (
                      <span className="text-slate-400">None</span>
                    )}
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                    <span
                      className={`text-xs font-semibold ${
                        u.is_active ? 'text-emerald-700' : 'text-slate-400'
                      }`}
                    >
                      {u.is_active ? 'Active' : 'Disabled'}
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => openEditUser(u)}
                        className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Edit
                      </button>
                      {!isSelf && (
                        <button
                          type="button"
                          onClick={() => handleToggleUserActive(u.id)}
                          disabled={isPending}
                          className={`px-2.5 py-1.5 rounded-lg border text-xs font-medium ${
                            u.is_active
                              ? 'border-slate-200 text-slate-600 hover:bg-rose-50 hover:text-rose-700'
                              : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          }`}
                        >
                          {u.is_active ? 'Disable' : 'Enable'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 2: COMPANY BANKS */}
      {activeTab === 'banks' && (
        <div className="space-y-4">
          {activeCompany && (
            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200/80 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Building2 className="w-4 h-4 text-[#7F1D1D]" />
                <span className="text-xs font-semibold text-slate-800">
                  Disbursement Banks for <span className="font-bold text-[#7F1D1D]">{activeCompany.name}</span>
                </span>
              </div>
              <span className="text-[11px] text-slate-500 font-medium">
                {banks.length} bank accounts configured
              </span>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {banks.map((b) => (
              <div
                key={b.id}
                className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 flex flex-col justify-between gap-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-slate-900">
                        {b.bank_name || b.full_name}
                      </span>
                      <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-800 text-[11px] font-bold">
                        {b.short_code || b.short_name}
                      </span>
                      {b.is_primary && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-800 border border-amber-200 text-[10px] font-bold">
                          <Star className="w-3 h-3 fill-amber-500 text-amber-500" />
                          <span>Primary</span>
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-500 mt-1">
                      IFSC Prefix: <span className="font-mono font-bold text-slate-800">{b.ifsc_prefix || '—'}</span> · A/C: <span className="tabular-nums font-medium text-slate-700">{b.account_number_masked || b.account_mask || 'Not set'}</span>
                    </div>
                  </div>
                  <span
                    className={`text-[11px] font-semibold px-2 py-0.5 rounded-md ${
                      b.is_active
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        : 'bg-slate-100 text-slate-500 border border-slate-200'
                    }`}
                  >
                    {b.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>

                <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => openEditBank(b)}
                    className="min-h-[34px] px-3 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold inline-flex items-center gap-1 transition-colors cursor-pointer"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                    <span>Edit</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleToggleBankActive(b.id)}
                    disabled={isPending}
                    className={`min-h-[34px] px-3 rounded-lg border text-xs font-semibold transition-colors cursor-pointer ${
                      b.is_active
                        ? 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100'
                        : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                    }`}
                  >
                    {b.is_active ? 'Disable' : 'Enable'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* MODAL: ADD TEAM MEMBER */}
      <Dialog open={isAddUserOpen} onOpenChange={setIsAddUserOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Team Member</DialogTitle>
            <DialogDescription>
              Create a new user account with role-based access and company scoping.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={addUserForm.handleSubmit(onAddUserSubmit)} className="space-y-4">
            <div>
              <Label htmlFor="au-name" className="block text-xs font-semibold text-slate-700 mb-1">
                Full Name <span className="text-rose-600">*</span>
              </Label>
              <Input
                id="au-name"
                {...addUserForm.register('full_name')}
                placeholder="e.g. Favas K."
                disabled={isPending}
                className="w-full min-h-[42px]"
              />
              {addUserForm.formState.errors.full_name && (
                <p className="text-[11px] text-rose-600 mt-1">
                  {addUserForm.formState.errors.full_name.message}
                </p>
              )}
            </div>

            <div>
              <Label htmlFor="au-email" className="block text-xs font-semibold text-slate-700 mb-1">
                Email / Login Username <span className="text-rose-600">*</span>
              </Label>
              <Input
                id="au-email"
                type="email"
                {...addUserForm.register('email')}
                placeholder="e.g. accounts@indfurn.com"
                disabled={isPending}
                className="w-full min-h-[42px]"
              />
              {addUserForm.formState.errors.email && (
                <p className="text-[11px] text-rose-600 mt-1">
                  {addUserForm.formState.errors.email.message}
                </p>
              )}
            </div>

            <div>
              <Label htmlFor="au-pass" className="block text-xs font-semibold text-slate-700 mb-1">
                Password <span className="text-rose-600">*</span>
              </Label>
              <Input
                id="au-pass"
                type="password"
                {...addUserForm.register('password')}
                placeholder="Minimum 6 characters"
                disabled={isPending}
                className="w-full min-h-[42px]"
              />
              {addUserForm.formState.errors.password && (
                <p className="text-[11px] text-rose-600 mt-1">
                  {addUserForm.formState.errors.password.message}
                </p>
              )}
            </div>

            <div>
              <Label htmlFor="au-role" className="block text-xs font-semibold text-slate-700 mb-1">
                Operational Role <span className="text-rose-600">*</span>
              </Label>
              <select
                id="au-role"
                {...addUserForm.register('role')}
                disabled={isPending}
                className="w-full min-h-[42px] px-3 rounded-lg border border-slate-200 bg-white text-sm outline-hidden focus:border-[#7F1D1D] cursor-pointer"
              >
                <option value="PREPARER">Preparer (Accounts Executive — Prepares & Executes)</option>
                <option value="VERIFIER">Verifier (Senior Accountant — First Review)</option>
                <option value="APPROVER">Approver (Owner / Final Authority — Approves Dues)</option>
                <option value="AUDITOR">Auditor (Internal/External Auditor — Read-Only Audit)</option>
              </select>
            </div>

            <div className="flex items-center gap-2 p-2.5 rounded-lg bg-slate-50 border border-slate-200/80">
              <input
                id="au-admin"
                type="checkbox"
                {...addUserForm.register('is_admin')}
                className="w-4 h-4 text-[#7F1D1D] rounded border-slate-300 focus:ring-[#7F1D1D]"
              />
              <Label htmlFor="au-admin" className="text-xs font-medium text-slate-800 cursor-pointer">
                Grant Admin Privileges (Can manage users & banks)
              </Label>
            </div>

            {/* Company Access Checkboxes */}
            <div>
              <Label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Assigned Company Workspaces <span className="text-rose-600">*</span>
              </Label>
              <div className="grid grid-cols-2 gap-2">
                {allCompanies.map((c) => {
                  const currentIds = addUserForm.watch('company_ids') || [];
                  const isChecked = currentIds.includes(c.id);

                  return (
                    <label
                      key={c.id}
                      className={`flex items-center gap-2 p-2.5 rounded-lg border text-xs font-medium cursor-pointer transition-colors ${
                        isChecked
                          ? 'border-[#7F1D1D] bg-rose-50/50 text-slate-900 font-bold'
                          : 'border-slate-200 hover:bg-slate-50 text-slate-600'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={(e) => {
                          if (e.target.checked) {
                            addUserForm.setValue('company_ids', [...currentIds, c.id]);
                          } else {
                            addUserForm.setValue(
                              'company_ids',
                              currentIds.filter((id) => id !== c.id)
                            );
                          }
                        }}
                        className="w-4 h-4 text-[#7F1D1D] rounded border-slate-300 focus:ring-[#7F1D1D]"
                      />
                      <span>{c.name}</span>
                    </label>
                  );
                })}
              </div>
              {addUserForm.formState.errors.company_ids && (
                <p className="text-[11px] text-rose-600 mt-1">
                  {addUserForm.formState.errors.company_ids.message}
                </p>
              )}
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsAddUserOpen(false)}
                disabled={isPending}
                className="min-h-[40px] cursor-pointer"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isPending}
                className="min-h-[40px] bg-[#7F1D1D] hover:bg-[#991B1B] text-white cursor-pointer font-semibold"
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
          </form>
        </DialogContent>
      </Dialog>

      {/* MODAL: EDIT TEAM MEMBER */}
      <Dialog
        open={Boolean(editingUser)}
        onOpenChange={(open) => {
          if (!open) setEditingUser(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Team Member</DialogTitle>
            <DialogDescription>
              Update role, admin privilege, company scoping, and active status.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={editUserForm.handleSubmit(onEditUserSubmit)} className="space-y-4">
            <div>
              <Label htmlFor="eu-name" className="block text-xs font-semibold text-slate-700 mb-1">
                Full Name <span className="text-rose-600">*</span>
              </Label>
              <Input
                id="eu-name"
                {...editUserForm.register('full_name')}
                disabled={isPending}
                className="w-full min-h-[42px]"
              />
              {editUserForm.formState.errors.full_name && (
                <p className="text-[11px] text-rose-600 mt-1">
                  {editUserForm.formState.errors.full_name.message}
                </p>
              )}
            </div>

            <div>
              <Label htmlFor="eu-role" className="block text-xs font-semibold text-slate-700 mb-1">
                Operational Role <span className="text-rose-600">*</span>
              </Label>
              <select
                id="eu-role"
                {...editUserForm.register('role')}
                disabled={isPending}
                className="w-full min-h-[42px] px-3 rounded-lg border border-slate-200 bg-white text-sm outline-hidden focus:border-[#7F1D1D] cursor-pointer"
              >
                <option value="PREPARER">Preparer (Accounts Executive)</option>
                <option value="VERIFIER">Verifier (Senior Accountant)</option>
                <option value="APPROVER">Approver (Owner / Final Authority)</option>
                <option value="AUDITOR">Auditor (Internal / External Auditor)</option>
              </select>
            </div>

            {/* Self-Lockout Protection Notice */}
            {editingUser?.id === currentUserId ? (
              <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
                You are currently editing your own administrator account. Admin privilege and active status are locked for safety.
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center gap-2 p-2.5 rounded-lg bg-slate-50 border border-slate-200/80">
                  <input
                    id="eu-admin"
                    type="checkbox"
                    {...editUserForm.register('is_admin')}
                    className="w-4 h-4 text-[#7F1D1D] rounded border-slate-300 focus:ring-[#7F1D1D]"
                  />
                  <Label htmlFor="eu-admin" className="text-xs font-medium text-slate-800 cursor-pointer">
                    Grant Admin Privileges
                  </Label>
                </div>

                <div className="flex items-center gap-2 p-2.5 rounded-lg bg-slate-50 border border-slate-200/80">
                  <input
                    id="eu-active"
                    type="checkbox"
                    {...editUserForm.register('is_active')}
                    className="w-4 h-4 text-emerald-600 rounded border-slate-300 focus:ring-emerald-600"
                  />
                  <Label htmlFor="eu-active" className="text-xs font-medium text-slate-800 cursor-pointer">
                    Account Active (User can log in)
                  </Label>
                </div>
              </div>
            )}

            {/* Company Access Checkboxes */}
            <div>
              <Label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Assigned Company Workspaces <span className="text-rose-600">*</span>
              </Label>
              <div className="grid grid-cols-2 gap-2">
                {allCompanies.map((c) => {
                  const currentIds = editUserForm.watch('company_ids') || [];
                  const isChecked = currentIds.includes(c.id);

                  return (
                    <label
                      key={c.id}
                      className={`flex items-center gap-2 p-2.5 rounded-lg border text-xs font-medium cursor-pointer transition-colors ${
                        isChecked
                          ? 'border-[#7F1D1D] bg-rose-50/50 text-slate-900 font-bold'
                          : 'border-slate-200 hover:bg-slate-50 text-slate-600'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={(e) => {
                          if (e.target.checked) {
                            editUserForm.setValue('company_ids', [...currentIds, c.id]);
                          } else {
                            editUserForm.setValue(
                              'company_ids',
                              currentIds.filter((id) => id !== c.id)
                            );
                          }
                        }}
                        className="w-4 h-4 text-[#7F1D1D] rounded border-slate-300 focus:ring-[#7F1D1D]"
                      />
                      <span>{c.name}</span>
                    </label>
                  );
                })}
              </div>
              {editUserForm.formState.errors.company_ids && (
                <p className="text-[11px] text-rose-600 mt-1">
                  {editUserForm.formState.errors.company_ids.message}
                </p>
              )}
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditingUser(null)}
                disabled={isPending}
                className="min-h-[40px] cursor-pointer"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isPending}
                className="min-h-[40px] bg-[#7F1D1D] hover:bg-[#991B1B] text-white cursor-pointer font-semibold"
              >
                {isPending ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Saving...</span>
                  </span>
                ) : (
                  'Save Changes'
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* MODAL: ADD COMPANY BANK */}
      <Dialog open={isAddBankOpen} onOpenChange={setIsAddBankOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Company Bank</DialogTitle>
            <DialogDescription>
              Add a bank account for {activeCompany?.name || 'the active company'}.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={addBankForm.handleSubmit(onAddBankSubmit)} className="space-y-4">
            <div>
              <Label htmlFor="ab-name" className="block text-xs font-semibold text-slate-700 mb-1">
                Bank Name <span className="text-rose-600">*</span>
              </Label>
              <Input
                id="ab-name"
                {...addBankForm.register('bank_name')}
                placeholder="e.g. Axis Bank Neo for Corporates"
                disabled={isPending}
                className="w-full min-h-[42px]"
              />
              {addBankForm.formState.errors.bank_name && (
                <p className="text-[11px] text-rose-600 mt-1">
                  {addBankForm.formState.errors.bank_name.message}
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="ab-short" className="block text-xs font-semibold text-slate-700 mb-1">
                  Short Code <span className="text-rose-600">*</span>
                </Label>
                <Input
                  id="ab-short"
                  {...addBankForm.register('short_code')}
                  placeholder="e.g. AXIS"
                  disabled={isPending}
                  className="w-full min-h-[42px] uppercase font-bold"
                />
                {addBankForm.formState.errors.short_code && (
                  <p className="text-[11px] text-rose-600 mt-1">
                    {addBankForm.formState.errors.short_code.message}
                  </p>
                )}
              </div>
              <div>
                <Label htmlFor="ab-prefix" className="block text-xs font-semibold text-slate-700 mb-1">
                  IFSC Prefix (4-chars) <span className="text-rose-600">*</span>
                </Label>
                <Input
                  id="ab-prefix"
                  {...addBankForm.register('ifsc_prefix')}
                  maxLength={4}
                  placeholder="e.g. UTIB"
                  disabled={isPending}
                  className="w-full min-h-[42px] uppercase font-mono font-bold"
                />
                {addBankForm.formState.errors.ifsc_prefix && (
                  <p className="text-[11px] text-rose-600 mt-1">
                    {addBankForm.formState.errors.ifsc_prefix.message}
                  </p>
                )}
              </div>
            </div>

            <div>
              <Label htmlFor="ab-mask" className="block text-xs font-semibold text-slate-700 mb-1">
                Masked Account Number
              </Label>
              <Input
                id="ab-mask"
                {...addBankForm.register('account_number_masked')}
                placeholder="e.g. XXXX4821"
                disabled={isPending}
                className="w-full min-h-[42px] tabular-nums"
              />
            </div>

            <div className="flex items-center gap-2 p-2.5 rounded-lg bg-slate-50 border border-slate-200/80">
              <input
                id="ab-primary"
                type="checkbox"
                {...addBankForm.register('is_primary')}
                className="w-4 h-4 text-[#7F1D1D] rounded border-slate-300 focus:ring-[#7F1D1D]"
              />
              <Label htmlFor="ab-primary" className="text-xs font-medium text-slate-800 cursor-pointer">
                Set as Primary Disbursement Bank
              </Label>
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsAddBankOpen(false)}
                disabled={isPending}
                className="min-h-[40px] cursor-pointer"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isPending}
                className="min-h-[40px] bg-[#7F1D1D] hover:bg-[#991B1B] text-white cursor-pointer font-semibold"
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
          </form>
        </DialogContent>
      </Dialog>

      {/* MODAL: EDIT COMPANY BANK */}
      <Dialog
        open={Boolean(editingBank)}
        onOpenChange={(open) => {
          if (!open) setEditingBank(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Company Bank</DialogTitle>
            <DialogDescription>
              Update bank name, IFSC prefix, or masked account number.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={editBankForm.handleSubmit(onEditBankSubmit)} className="space-y-4">
            <div>
              <Label htmlFor="eb-name" className="block text-xs font-semibold text-slate-700 mb-1">
                Bank Name <span className="text-rose-600">*</span>
              </Label>
              <Input
                id="eb-name"
                {...editBankForm.register('bank_name')}
                disabled={isPending}
                className="w-full min-h-[42px]"
              />
              {editBankForm.formState.errors.bank_name && (
                <p className="text-[11px] text-rose-600 mt-1">
                  {editBankForm.formState.errors.bank_name.message}
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="eb-short" className="block text-xs font-semibold text-slate-700 mb-1">
                  Short Code <span className="text-rose-600">*</span>
                </Label>
                <Input
                  id="eb-short"
                  {...editBankForm.register('short_code')}
                  disabled={isPending}
                  className="w-full min-h-[42px] uppercase font-bold"
                />
                {editBankForm.formState.errors.short_code && (
                  <p className="text-[11px] text-rose-600 mt-1">
                    {editBankForm.formState.errors.short_code.message}
                  </p>
                )}
              </div>
              <div>
                <Label htmlFor="eb-prefix" className="block text-xs font-semibold text-slate-700 mb-1">
                  IFSC Prefix (4-chars) <span className="text-rose-600">*</span>
                </Label>
                <Input
                  id="eb-prefix"
                  {...editBankForm.register('ifsc_prefix')}
                  maxLength={4}
                  disabled={isPending}
                  className="w-full min-h-[42px] uppercase font-mono font-bold"
                />
                {editBankForm.formState.errors.ifsc_prefix && (
                  <p className="text-[11px] text-rose-600 mt-1">
                    {editBankForm.formState.errors.ifsc_prefix.message}
                  </p>
                )}
              </div>
            </div>

            <div>
              <Label htmlFor="eb-mask" className="block text-xs font-semibold text-slate-700 mb-1">
                Masked Account Number
              </Label>
              <Input
                id="eb-mask"
                {...editBankForm.register('account_number_masked')}
                disabled={isPending}
                className="w-full min-h-[42px] tabular-nums"
              />
            </div>

            <div className="flex items-center gap-2 p-2.5 rounded-lg bg-slate-50 border border-slate-200/80">
              <input
                id="eb-primary"
                type="checkbox"
                {...editBankForm.register('is_primary')}
                className="w-4 h-4 text-[#7F1D1D] rounded border-slate-300 focus:ring-[#7F1D1D]"
              />
              <Label htmlFor="eb-primary" className="text-xs font-medium text-slate-800 cursor-pointer">
                Primary Disbursement Bank
              </Label>
            </div>

            <div className="flex items-center gap-2 p-2.5 rounded-lg bg-slate-50 border border-slate-200/80">
              <input
                id="eb-active"
                type="checkbox"
                {...editBankForm.register('is_active')}
                className="w-4 h-4 text-emerald-600 rounded border-slate-300 focus:ring-emerald-600"
              />
              <Label htmlFor="eb-active" className="text-xs font-medium text-slate-800 cursor-pointer">
                Active for Batch Disbursements
              </Label>
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditingBank(null)}
                disabled={isPending}
                className="min-h-[40px] cursor-pointer"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isPending}
                className="min-h-[40px] bg-[#7F1D1D] hover:bg-[#991B1B] text-white cursor-pointer font-semibold"
              >
                {isPending ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Saving...</span>
                  </span>
                ) : (
                  'Save Changes'
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
