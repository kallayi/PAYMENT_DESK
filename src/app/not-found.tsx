import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 text-center bg-[#F8FAFC]">
      <div className="w-12 h-12 rounded-full bg-white border border-slate-200 flex items-center justify-center mb-4 shadow-sm">
        <span className="text-sm font-bold text-slate-700">404</span>
      </div>
      <h1 className="text-xl font-bold tracking-tight text-slate-900 mb-1">
        Page Not Found
      </h1>
      <p className="text-xs text-slate-500 mb-6 max-w-sm">
        The requested page does not exist or has been relocated.
      </p>
      <Link
        href="/"
        className="min-h-[40px] px-4 rounded-lg bg-slate-900 text-white text-xs font-medium inline-flex items-center justify-center hover:bg-slate-800 transition-colors shadow-sm"
      >
        Return to Dashboard
      </Link>
    </div>
  );
}
