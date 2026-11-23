'use client';

import * as React from 'react';
import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Eye, EyeOff, AlertCircle, Loader2 } from 'lucide-react';
import { login } from '@/actions/auth';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialError = searchParams.get('error');

  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [showPassword, setShowPassword] = React.useState(false);
  const [error, setError] = React.useState<string | null>(
    initialError === 'disabled'
      ? 'Your account has been disabled. Please contact the administrator.'
      : null
  );
  const [isPending, startTransition] = React.useTransition();

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const formData = new FormData();
    formData.append('email', email);
    formData.append('password', password);

    startTransition(async () => {
      const res = await login(formData);
      if (!res.success) {
        setError(res.error);
      } else {
        router.push(res.data.redirectUrl);
        router.refresh();
      }
    });
  }

  return (
    <div className="w-full max-w-sm">
      {/* Centered White Login Card */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 sm:p-7 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        {/* Brand Mark */}
        <div className="flex flex-col items-center text-center mb-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.png"
            alt="INDFURN Logo"
            className="h-12 max-h-[52px] w-auto object-contain mb-2"
          />
          <p className="text-xs text-slate-500 font-medium">Payment Approval Portal</p>
        </div>

        {/* Inline Error Banner */}
        {error && (
          <div
            role="alert"
            className="mb-4 px-3 py-2.5 rounded-lg bg-rose-50 border border-rose-200 text-xs font-medium text-rose-700 flex items-start gap-2"
          >
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
            <span className="leading-snug">{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="login-email" className="block text-xs font-medium text-slate-700 mb-1.5">
              Email or Username
            </Label>
            <Input
              id="login-email"
              type="text"
              required
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="e.g. accounts@indfurn.com"
              disabled={isPending}
              className="w-full min-h-[44px]"
            />
          </div>

          <div>
            <Label htmlFor="login-password" className="block text-xs font-medium text-slate-700 mb-1.5">
              Password
            </Label>
            <div className="relative">
              <Input
                id="login-password"
                type={showPassword ? 'text' : 'password'}
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                disabled={isPending}
                className="w-full min-h-[44px] pr-11"
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                tabIndex={-1}
                className="absolute right-1 top-1/2 -translate-y-1/2 w-9 h-9 rounded-md flex items-center justify-center text-slate-400 hover:text-slate-700 transition-colors"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <Button
            type="submit"
            disabled={isPending}
            className="w-full min-h-[44px] rounded-lg bg-slate-900 hover:bg-slate-800 active:scale-[0.99] text-white text-sm font-medium transition-all"
          >
            {isPending ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Signing In...</span>
              </span>
            ) : (
              'Sign In'
            )}
          </Button>
        </form>
      </div>

      {/* Subtle Footer */}
      <div className="mt-4 text-center text-[11px] text-slate-400">
        <span>INDFURN Internal PWA</span>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-[#F8FAFC] flex flex-col items-center justify-center px-4 py-8">
      <Suspense fallback={<div className="w-full max-w-sm h-64 rounded-xl bg-white border border-slate-200 animate-pulse" />}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
